'use strict';

// packages/recommendation-runtime/test/composite-lifecycle.test.js — the F1
// lifecycle gate (owner decision of 2026-11-26, docs/MIXED_BARRELS.md §5.4).
//
// WHAT IT ENFORCES. The owner approved `src/{candidates,filtering,scoring}/index.js`
// as an unpublished, step-6-scoped exception to RFC §6.4, under six conditions.
// Conditions 1-3 were already executable here (key sets and `scoring`'s key order
// in test/namespace-barrels.test.js, the unpublished negative in
// test/surface.test.js and scripts/lib/runtime-package-exports.test.js). The one
// nothing executed was condition 5 - that step 6 DELETES the composites when it
// rewrites the orchestrator's specifiers - so a finished migration and a
// half-finished one both looked green.
//
// This gate closes that with two valid end states and NO third:
//   ACTIVE   - the orchestrator requires the composites from exactly the four
//              committed modules; all six conditions are observable.
//   MIGRATED - no orchestrator module requires a composite, and no trace of the
//              exception survives (files, core-spreading barrels, old-path shims,
//              in-package or path-based consumers).
// Anything in between FAILS, because a partially migrated tree writes the same
// rows through two different code paths with nobody checking either.
//
// THE MIGRATED BRANCH IS PROVEN, NOT HOPED FOR. The state logic lives in
// ./composite-lifecycle-scanner.js as a pure function, and the synthetic-tree
// block below drives it through ACTIVE, MIGRATED, PARTIAL and each MIGRATED
// failure. Without that, the branch that runs at step 6 would be code executed
// for the first time on the day it is supposed to block a merge.
//
// DB-free and dependency-free: node:test + node:assert + node:fs + node:path.
//
//   npm run test:runtime        (from the repo root)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  EXPECTED_ACTIVE_DEPENDENCIES,
  STAGES,
  assess,
  classifyLifecycle,
  coreEntrySpread,
  legacyBarrelStagesIn,
  legacyConsumerReferences,
  runtimeCompositeConsumers,
  runtimeSurfacePublishers,
  stagesRequiredBy,
  stripComments,
} = require('./composite-lifecycle-scanner');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const RUNTIME_SRC = path.join(PACKAGE_ROOT, 'src');
const ORCHESTRATOR = path.join(RUNTIME_SRC, 'orchestrator');
const OLD_TREE = path.join(REPO_ROOT, 'src', 'recommendation');

// The two test-directory files that legitimately contain the specifier and path
// literals this gate searches for. Every OTHER reference is a consumer.
const SELF = new Set([__filename, path.join(__dirname, 'composite-lifecycle-scanner.js')]);

// A reference to a runtime composite: either a repository path into the package,
// or (checked separately) a `require('../<stage>')` inside the package.
const RUNTIME_COMPOSITE_REFERENCE = /recommendation-runtime[\\/]+src[\\/]+(candidates|filtering|scoring)\b/;

// Directories that are never part of the consumer inventory: dependencies, Git
// internals, documentation (prose mentions the paths on purpose) and scratch.
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', '.git', 'docs', '.freebuff', '.next', 'coverage', 'dist', 'build',
]);

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort();
}

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(path.join(dir, entry.name), visit);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) visit(path.join(dir, entry.name));
  }
}

function relativeToRepo(absolute) {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}

/**
 * The discovery guard's REQUIRED list, read as data. A rename that drops a suite
 * is exactly the failure the gate must not be blind to.
 */
function discoveryRequired() {
  const source = fs.readFileSync(path.join(__dirname, 'assert-discovery.js'), 'utf8');
  const block = source.match(/const REQUIRED = \[([\s\S]*?)\];/);
  if (block === null) return [];
  return [...block[1].matchAll(/'([^']+\.test\.js)'/g)].map((match) => match[1]);
}

/** One observation of the real tree, in the shape assess() takes. */
function observe() {
  const dependencies = {};
  for (const file of listJsFiles(ORCHESTRATOR)) {
    dependencies[file] = stagesRequiredBy(fs.readFileSync(path.join(ORCHESTRATOR, file), 'utf8'));
  }

  // Every runtime source file, at any depth: a composite does not have to sit at
  // `src/<stage>/index.js` to publish the core surface, so the observation must
  // not be able to miss a nested one.
  const runtimeSources = [];
  walk(RUNTIME_SRC, (absolute) => {
    runtimeSources.push({
      path: 'src/' + path.relative(RUNTIME_SRC, absolute).split(path.sep).join('/'),
      source: fs.readFileSync(absolute, 'utf8'),
    });
  });

  // The composite signature as this gate defines it: a runtime file that spreads
  // or re-exports the pure core's SURFACE. Keyed on the export behaviour, never on
  // the bare specifier: a barrel that imports one core function to call it is not
  // publishing a core namespace, and flagging it would make the gate accuse
  // legitimate Core use.
  const coreSpreaders = runtimeSurfacePublishers(runtimeSources);

  // The composite FILE set, by its expected path: what the owner's condition 5
  // names explicitly. Detected by existence, so a deleted file is a fact and not
  // an inference from a failed read.
  const compositeFiles = STAGES
    .map((stage) => 'src/' + stage + '/index.js')
    .filter((relative) => fs.existsSync(path.join(PACKAGE_ROOT, relative)));

  // EXISTENCE and CONTENTS are observed separately on purpose: MIGRATED fails on
  // the FILE existing at all, whatever it now re-exports, because the owner's
  // condition says DELETED and a repointed shim is the same debt under a new name.
  const shimFiles = [];
  const shimRefsRuntime = {};
  for (const stage of STAGES) {
    const shim = path.join(OLD_TREE, stage, 'index.js');
    if (!fs.existsSync(shim)) {
      shimRefsRuntime[stage] = false;
      continue;
    }
    shimFiles.push(stage);
    shimRefsRuntime[stage] = RUNTIME_COMPOSITE_REFERENCE.test(
      stripComments(fs.readFileSync(shim, 'utf8'))
    );
  }

  // Consumers of the OLD path, from real require/import SPECIFIERS only: a path
  // recorded as data (scripts/audit-pr2-test-ownership.js) or written in prose is
  // not a consumer, and neither is a require of a subpath module.
  const legacyReferences = [];
  const references = [];
  walk(REPO_ROOT, (absolute) => {
    if (SELF.has(absolute)) return;
    const relative = relativeToRepo(absolute);
    const source = fs.readFileSync(absolute, 'utf8');
    legacyReferences.push(...legacyConsumerReferences([{ path: relative, source }]));
    if (RUNTIME_COMPOSITE_REFERENCE.test(stripComments(source))) {
      references.push(relative + ' (path into the runtime composite)');
    }
  });
  // Inside the package the exception is the composite SPECIFIER itself, at any
  // depth. The composite directories are allowed to BE the composite; nothing
  // else may require one.
  references.push(...runtimeCompositeConsumers(runtimeSources));

  const manifest = require('../package.json');
  return {
    dependencies,
    compositeFiles,
    coreSpreaders,
    shimFiles,
    shimRefsRuntime,
    legacyReferences,
    exportsKeys: Object.keys(manifest.exports),
    rootKeys: Object.keys(require('..')),
    snapshotExports: require('./export-surface.json').exports,
    discoveryRequired: discoveryRequired(),
    compositeSuitePresent: fs.existsSync(__filename),
    references,
  };
}

const observation = observe();
const verdict = assess(observation);

// The two valid end states as observations, shared by every synthetic fixture
// below. Kept at module scope so a test can force a MIGRATED verdict from any
// detector without re-declaring the whole shape.
const baseActive = {
  dependencies: { ...EXPECTED_ACTIVE_DEPENDENCIES },
  compositeFiles: STAGES.map((stage) => 'src/' + stage + '/index.js'),
  coreSpreaders: STAGES.map((stage) => 'src/' + stage + '/index.js'),
  shimFiles: [...STAGES],
  shimRefsRuntime: { candidates: true, filtering: true, scoring: true },
  legacyReferences: [],
  exportsKeys: ['.', './loaders', './orchestrator', './persistence'],
  rootKeys: ['loaders', 'orchestrator', 'persistence'],
  snapshotExports: ['loaders', 'orchestrator', 'persistence'],
  discoveryRequired: ['composite-lifecycle.test.js', 'namespace-barrels.test.js'],
  compositeSuitePresent: true,
  references: [],
};

const baseMigrated = {
  dependencies: { 'run.js': [], 'swap-preview.js': [], 'swap-commit.js': [], 'compute.js': [] },
  compositeFiles: [],
  coreSpreaders: [],
  shimFiles: [],
  shimRefsRuntime: { candidates: false, filtering: false, scoring: false },
  legacyReferences: [],
  exportsKeys: ['.', './loaders', './orchestrator', './persistence'],
  rootKeys: ['loaders', 'orchestrator', 'persistence'],
  snapshotExports: ['loaders', 'orchestrator', 'persistence'],
  discoveryRequired: ['composite-lifecycle.test.js', 'namespace-barrels.test.js'],
  compositeSuitePresent: true,
  references: [],
};

describe('F1 lifecycle — the real tree is in exactly one valid state', () => {
  it('classifies as ACTIVE or MIGRATED, and no condition is violated', () => {
    assert.ok(
      verdict.state === 'ACTIVE' || verdict.state === 'MIGRATED',
      'the tree is in state ' + verdict.state + ': ' + verdict.problems.join(' | ')
    );
    assert.deepEqual(verdict.problems, []);
  });

  it('ACTIVE: exactly the three composites exist and nothing else spreads the core', () => {
    if (verdict.state !== 'ACTIVE') return;
    assert.deepEqual(observation.compositeFiles, STAGES.map((stage) => 'src/' + stage + '/index.js'));
    assert.deepEqual(observation.coreSpreaders, STAGES.map((stage) => 'src/' + stage + '/index.js'));
  });

  it('ACTIVE: the four committed orchestrator consumers are the only ones', () => {
    if (verdict.state !== 'ACTIVE') return;
    assert.deepEqual(verdict.dependencies, {
      'run.js': ['candidates', 'filtering', 'scoring'],
      'swap-preview.js': ['candidates', 'filtering'],
      'swap-commit.js': ['scoring'],
      'compute.js': ['scoring'],
    });
  });

  it('ACTIVE: the old paths are identity shims to the composites (the patch seam)', (t) => {
    if (verdict.state !== 'ACTIVE') {
      t.skip('the composites are gone, so there is no seam left to check');
      return;
    }
    for (const stage of STAGES) {
      assert.equal(
        require(path.join(OLD_TREE, stage)),
        require(path.join(RUNTIME_SRC, stage)),
        'src/recommendation/' + stage + ' is not the runtime composite object'
      );
    }
  });

  it('the gate itself stays discoverable', () => {
    assert.ok(
      observation.discoveryRequired.includes('composite-lifecycle.test.js'),
      'assert-discovery.js must list this suite, or a rename silently drops the gate'
    );
  });
});

describe('F1 lifecycle — specifier recognition', () => {
  it('counts the barrel specifier in every accepted spelling', () => {
    assert.deepEqual(stagesRequiredBy("const a = require('../candidates');"), ['candidates']);
    assert.deepEqual(stagesRequiredBy('const a = require("../filtering/index");'), ['filtering']);
    assert.deepEqual(stagesRequiredBy("const a = require('../scoring/index.js');"), ['scoring']);
    assert.deepEqual(
      stagesRequiredBy("require('../scoring');\nrequire('../candidates');\nrequire('../filtering');"),
      ['candidates', 'filtering', 'scoring'],
      'the result is in canonical order, never source order'
    );
  });

  it('does not mistake a subpath module or the core adapter for a composite', () => {
    assert.deepEqual(stagesRequiredBy("const { ERROR_CODES } = require('../candidates/errors');"), []);
    assert.deepEqual(stagesRequiredBy("const core = require('../core-entry');"), []);
    assert.deepEqual(stagesRequiredBy("require('./compute');"), []);
    assert.deepEqual(stagesRequiredBy('// require(\'../candidates\')'), []);
  });
});

describe('F1 lifecycle — state classification is total and has no gap', () => {
  it('the committed consumer map is ACTIVE', () => {
    assert.equal(classifyLifecycle({ ...EXPECTED_ACTIVE_DEPENDENCIES }).state, 'ACTIVE');
  });

  it('no consumer at all is MIGRATED', () => {
    assert.equal(classifyLifecycle({ 'run.js': [], 'compute.js': [] }).state, 'MIGRATED');
  });

  it('one migrated consumer and three intact ones is PARTIAL, never ACTIVE', () => {
    const halfDone = {
      'run.js': ['candidates', 'filtering', 'scoring'],
      'swap-preview.js': ['candidates', 'filtering'],
      'swap-commit.js': ['scoring'],
      'compute.js': [],
    };
    assert.equal(classifyLifecycle(halfDone).state, 'PARTIAL');
  });

  it('a fifth module joining the exception is PARTIAL, never ACTIVE', () => {
    const grew = { ...EXPECTED_ACTIVE_DEPENDENCIES, 'new-stage.js': ['scoring'] };
    assert.equal(classifyLifecycle(grew).state, 'PARTIAL');
  });

  it('a consumer that dropped one of its three stages is PARTIAL', () => {
    const narrowed = { ...EXPECTED_ACTIVE_DEPENDENCIES, 'run.js': ['candidates', 'filtering'] };
    assert.equal(classifyLifecycle(narrowed).state, 'PARTIAL');
  });
});

describe('F1 lifecycle — the verdicts the fixtures force, both ways', () => {
  it('a fully satisfied ACTIVE observation passes', () => {
    assert.deepEqual(assess(baseActive), {
      state: 'ACTIVE',
      problems: [],
      dependencies: { ...EXPECTED_ACTIVE_DEPENDENCIES },
    });
  });

  it('ACTIVE fails when a fourth file spreads the core', () => {
    const problems = assess({
      ...baseActive,
      coreSpreaders: [...baseActive.coreSpreaders, 'src/explanation/index.js'],
    }).problems;
    assert.equal(problems.length, 1);
    assert.match(problems[0], /only runtime files that may spread or re-export a core surface/);
  });

  it('ACTIVE fails when a composite becomes published', () => {
    const problems = assess({ ...baseActive, exportsKeys: ['.', './loaders', './candidates'] }).problems;
    assert.equal(problems.length, 1);
    assert.match(problems[0], /publishes candidates/);
  });

  it('ACTIVE fails when the old-path shim stops re-exporting the composite', () => {
    const problems = assess({
      ...baseActive,
      shimRefsRuntime: { candidates: true, filtering: false, scoring: true },
    }).problems;
    assert.equal(problems.length, 1);
    assert.match(problems[0], /src\/recommendation\/filtering\/index\.js/);
  });

  it('ACTIVE fails when the key-set proof leaves the discovery list', () => {
    const problems = assess({ ...baseActive, discoveryRequired: ['composite-lifecycle.test.js'] }).problems;
    assert.equal(problems.length, 1);
    assert.match(problems[0], /namespace-barrels\.test\.js/);
  });

  // The four MIGRATED failures are the point of the whole file: they are what
  // fires at step 6 if the migration forgets the removal obligation.
  it('MIGRATED passes only when nothing of the exception survives', () => {
    assert.deepEqual(assess(baseMigrated).problems, []);
    assert.equal(assess(baseMigrated).state, 'MIGRATED');
  });

  it('MIGRATED fails while a composite implementation file remains', () => {
    const problems = assess({ ...baseMigrated, compositeFiles: ['src/scoring/index.js'] }).problems;
    assert.equal(problems.length, 1, problems.join(' | '));
    assert.match(problems[0], /composite implementation files remain: src\/scoring\/index\.js/);
    assert.match(problems[0], /DELETED/);
  });

  it('MIGRATED fails while a runtime barrel still spreads the core', () => {
    const problems = assess({ ...baseMigrated, coreSpreaders: ['src/filtering/index.js'] }).problems;
    assert.equal(problems.length, 1, problems.join(' | '));
    assert.match(problems[0], /still spread or re-export a core surface/);
  });

  it('MIGRATED fails while an old-path shim still re-exports a composite', () => {
    const problems = assess({
      ...baseMigrated,
      shimFiles: ['scoring'],
      shimRefsRuntime: { candidates: false, filtering: false, scoring: true },
    }).problems;
    assert.equal(problems.length, 1, problems.join(' | '));
    assert.match(problems[0], /src\/recommendation\/scoring\/index\.js still exists/);
    assert.match(problems[0], /still re-exports the runtime composite/);
  });

  // 2.1 - the shim that outlives step 6 by being repointed instead of deleted.
  // This is the case the old messenger could not see: contents say "not a
  // composite", so a contents-only check passed while the compatibility path
  // survived.
  it('MIGRATED fails while an old-path shim survives by re-pointing elsewhere', () => {
    const problems = assess({
      ...baseMigrated,
      shimFiles: ['candidates'],
      shimRefsRuntime: { candidates: false, filtering: false, scoring: false },
    }).problems;
    assert.equal(problems.length, 1, problems.join(' | '));
    assert.match(problems[0], /src\/recommendation\/candidates\/index\.js still exists/);
    assert.match(problems[0], /DELETED, not repointed/);
  });

  // 2.2 - step 6 could delete every file and shim and still leave a consumer
  // importing the old path; then the import resolves to nothing, or to whatever
  // someone re-adds there later. The consumer is the failure.
  it('MIGRATED fails while a consumer still imports a legacy barrel', () => {
    const problems = assess({
      ...baseMigrated,
      legacyReferences: [
        'apps/api/src/engine.js imports src/recommendation/candidates, src/recommendation/filtering, src/recommendation/scoring',
      ],
    }).problems;
    assert.equal(problems.length, 1, problems.join(' | '));
    assert.match(problems[0], /consumers still import a legacy compatibility barrel/);
    assert.match(problems[0], /apps\/api\/src\/engine\.js/);
  });

  // The ACTIVE half of the same observation: the legacy importer is the patch
  // seam the exception exists to serve, so ACTIVE must not fail on it.
  it('ACTIVE tolerates a legacy importer, because that is the documented seam', () => {
    const verdictActive = assess({
      ...baseActive,
      legacyReferences: ['apps/api/src/engine.js imports src/recommendation/candidates'],
    });
    assert.equal(verdictActive.state, 'ACTIVE');
    assert.deepEqual(verdictActive.problems, []);
  });

  it('MIGRATED fails while an obsolete compatibility consumer still requires one', () => {
    const problems = assess({
      ...baseMigrated,
      references: ['apps/api/src/engine.js (path into the runtime composite)'],
    }).problems;
    assert.equal(problems.length, 1, problems.join(' | '));
    assert.match(problems[0], /obsolete compatibility consumers/);
    assert.match(problems[0], /apps\/api\/src\/engine\.js/);
  });

  it('PARTIAL fails and names the observed matrix, so the state is diagnosable', () => {
    const partial = assess({
      ...baseMigrated,
      dependencies: { ...EXPECTED_ACTIVE_DEPENDENCIES, 'compute.js': [] },
    });
    assert.equal(partial.state, 'PARTIAL');
    assert.equal(partial.problems.length, 1);
    assert.match(partial.problems[0], /PARTIAL MIGRATION/);
    assert.match(partial.problems[0], /compute\.js -> \(none\)|run\.js -> candidates\+filtering\+scoring/);
  });
});

describe('F1 lifecycle — the comment lexer (a false negative is the dangerous direction)', () => {
  it('keeps the rest of the line after a string that contains //', () => {
    const source = "const url = 'https://example.test/x'; require('../candidates');";
    assert.ok(stripComments(source).includes("require('../candidates')"), stripComments(source));
    assert.deepEqual(stagesRequiredBy(source), ['candidates']);
  });

  it('keeps a template literal that contains // intact', () => {
    assert.deepEqual(stagesRequiredBy('const t = `a // b`; require(\'../filtering\');'), ['filtering']);
  });

  it('still removes real line and block comments', () => {
    assert.ok(!stripComments("// require('../candidates')\nconst a = 1;").includes('candidates'));
    assert.ok(!stripComments("/* require('../candidates') */\nconst a = 1;").includes('candidates'));
    assert.deepEqual(stagesRequiredBy("require('../scoring'); // require('../candidates')"), ['scoring']);
  });

  it('does not let a quote inside a regex literal open a phantom string', () => {
    assert.deepEqual(stagesRequiredBy("const re = /['\"]/; require('../candidates');"), ['candidates']);
  });
});

describe('F1 lifecycle — core spreaders: export behaviour, quote style, nesting', () => {
  const sealed = "const core = require('../core-entry');\n"
    + 'module.exports = { ...core.candidates, loadCandidates };';

  it('flags the committed composite shape', () => {
    assert.equal(coreEntrySpread(sealed), true);
  });

  it('flags the shape one directory deeper, in any quote style, with or without .js', () => {
    assert.equal(
      coreEntrySpread('const core = require("../../core-entry.js");\nmodule.exports = { ...core };'),
      true
    );
  });

  it('flags every inline re-export form', () => {
    assert.equal(coreEntrySpread("module.exports = { ...require('../core-entry') };"), true);
    assert.equal(coreEntrySpread("module.exports = require('../core-entry');"), true);
    assert.equal(coreEntrySpread("module.exports = Object.assign({}, require('../core-entry'));"), true);
    assert.equal(coreEntrySpread("const core = require('../core-entry');\nmodule.exports = core;"), true);
  });

  it('flags the explicit member-by-member re-export the scoring composite uses', () => {
    assert.equal(
      coreEntrySpread("const pure = require('../core-entry').scoring;\n"
        + 'module.exports = { a: pure.a, b: pure.b, load };'),
      true
    );
  });

  it('does not flag a core member that is called, not published', () => {
    assert.equal(
      coreEntrySpread("const pure = require('../core-entry');\n"
        + 'module.exports = { a: () => pure.a() };'),
      false
    );
  });

  it('does not flag a module that uses one core function internally', () => {
    assert.equal(
      coreEntrySpread("const core = require('../core-entry');\n"
        + 'module.exports = { load: () => core.loadCandidates() };'),
      false
    );
  });

  it('does not flag a spread that happens before the export', () => {
    assert.equal(
      coreEntrySpread("const core = require('../core-entry');\n"
        + 'const merged = { ...core.candidates };\nmodule.exports = { merged };'),
      false
    );
  });

  it('does not flag a file with no core import at all', () => {
    assert.equal(coreEntrySpread('module.exports = { loadCandidates };'), false);
  });

  // 2.3 - a composite does not have to sit at `src/<stage>/index.js`. The
  // observation walks every source file under the package's `src/`, so a nested
  // one is judged on the same behaviour and cannot hide from the gate.
  it('finds a composite relocated into a nested runtime directory', () => {
    const nested = 'src/orchestrator/filtering/index.js';
    assert.deepEqual(
      runtimeSurfacePublishers([
        { path: 'src/index.js', source: "module.exports = { loaders: require('./loaders') };" },
        { path: nested, source: sealed },
      ]),
      [nested]
    );
  });

  it('rejects ACTIVE and MIGRATED when a nested composite spreads the core', () => {
    const nested = 'src/orchestrator/filtering/index.js';
    const activeProblems = assess({ ...baseActive, coreSpreaders: [...baseActive.coreSpreaders, nested] }).problems;
    assert.equal(activeProblems.length, 1, activeProblems.join(' | '));
    assert.match(activeProblems[0], /only runtime files that may spread or re-export a core surface/);
    assert.match(activeProblems[0], /src\/orchestrator\/filtering\/index\.js/);

    const migratedProblems = assess({ ...baseMigrated, coreSpreaders: [nested] }).problems;
    assert.equal(migratedProblems.length, 1, migratedProblems.join(' | '));
    assert.match(migratedProblems[0], /still spread or re-export a core surface/);
    assert.match(migratedProblems[0], /src\/orchestrator\/filtering\/index\.js/);
  });

  it('does not flag a nested module that only calls a core function', () => {
    assert.deepEqual(
      runtimeSurfacePublishers([
        {
          path: 'src/orchestrator/helpers/index.js',
          source: "const core = require('../../core-entry');\nmodule.exports = { run: () => core.selectCandidatePool() };",
        },
      ]),
      []
    );
  });
});

describe('F1 lifecycle — legacy consumers are specifiers, not strings', () => {
  it('finds the API engine import of all three barrels', () => {
    const source = [
      "const candidates = require('../../../src/recommendation/candidates');",
      "const filtering = require('../../../src/recommendation/filtering');",
      "const scoring = require('../../../src/recommendation/scoring');",
    ].join('\n');
    assert.deepEqual(legacyBarrelStagesIn(source), ['candidates', 'filtering', 'scoring']);
  });

  it('accepts the index spellings, in canonical order', () => {
    assert.deepEqual(
      legacyBarrelStagesIn("require('../../src/recommendation/scoring/index.js');\n"
        + "require('../../src/recommendation/candidates/index');"),
      ['candidates', 'scoring']
    );
  });

  it('does not count a subpath module, the runtime package or the core adapter', () => {
    assert.deepEqual(legacyBarrelStagesIn("require('../../../src/recommendation/candidates/loader');"), []);
    assert.deepEqual(legacyBarrelStagesIn("require('../../../src/recommendation-runtime/src/candidates');"), []);
    assert.deepEqual(legacyBarrelStagesIn("require('../core-entry');"), []);
  });

  it('does not count a path recorded as data or written in a comment', () => {
    assert.deepEqual(legacyBarrelStagesIn("const old = 'test/recommendation/candidates/x.test.js';"), []);
    assert.deepEqual(legacyBarrelStagesIn("// require('../../src/recommendation/candidates')\nconst a = 1;"), []);
  });

  // 2.2 - end to end: a real consumer SOURCE goes through the specifier detector
  // and then into the verdict. The scanner must reject MIGRATED, not merely be
  // handed a string that already says so.
  it('rejects MIGRATED from a consumer source that still imports a legacy barrel', () => {
    const sources = [
      { path: 'apps/api/src/engine.js', source: "const candidates = require('../../../src/recommendation/candidates');" },
      { path: 'apps/api/src/db.js', source: "const { Client } = require('pg');" },
    ];
    const legacyReferences = legacyConsumerReferences(sources);
    assert.equal(legacyReferences.length, 1, legacyReferences.join(' | '));
    assert.match(legacyReferences[0], /^apps\/api\/src\/engine\.js imports src\/recommendation\/candidates$/);

    const verdictMigrated = assess({ ...baseMigrated, legacyReferences });
    assert.equal(verdictMigrated.state, 'MIGRATED');
    assert.equal(verdictMigrated.problems.length, 1, verdictMigrated.problems.join(' | '));
    assert.match(verdictMigrated.problems[0], /apps\/api\/src\/engine\.js/);

    // The same source in ACTIVE is the documented patch seam, so it passes.
    assert.deepEqual(assess({ ...baseActive, legacyReferences }).problems, []);
  });

  // A nested module that still says `require('../candidates')` is the specifier
  // step 6 has to rewrite, whatever its depth.
  it('reports a nested in-package consumer of a composite specifier', () => {
    assert.deepEqual(
      runtimeCompositeConsumers([
        { path: 'src/candidates/index.js', source: "module.exports = { a: require('./loader') };" },
        { path: 'src/orchestrator/nested/run.js', source: "const c = require('../candidates');" },
      ]),
      ['src/orchestrator/nested/run.js requires ../candidates']
    );
  });
});
