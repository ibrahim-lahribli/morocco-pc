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
const os = require('node:os');
const path = require('node:path');

const {
  EXPECTED_ACTIVE_DEPENDENCIES,
  REPO_SKIP_DIRS,
  SRC_SKIP_DIRS,
  STAGES,
  assess,
  classifyLifecycle,
  collectJsSources,
  compositeDependencies,
  coreEntrySpread,
  legacyBarrelStagesIn,
  legacyConsumerReferences,
  runtimeCompositeConsumers,
  runtimeSurfacePublishers,
  stagesRequiredBy,
  stripComments,
  walkJs,
} = require('./composite-lifecycle-scanner');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const RUNTIME_SRC = path.join(PACKAGE_ROOT, 'src');
const OLD_TREE = path.join(REPO_ROOT, 'src', 'recommendation');

// The two test-directory files that legitimately contain the specifier and path
// literals this gate searches for. Every OTHER reference is a consumer.
const SELF = new Set([__filename, path.join(__dirname, 'composite-lifecycle-scanner.js')]);

// A reference to a runtime composite: either a repository path into the package,
// or (checked separately) a `require('../<stage>')` inside the package.
const RUNTIME_COMPOSITE_REFERENCE = /recommendation-runtime[\\/]+src[\\/]+(candidates|filtering|scoring)\b/;

// The inventory walk (skip sets, extension filter, fail-closed read) lives with
// the detectors in ./composite-lifecycle-scanner.js: `walkJs` and
// `collectJsSources`, so both observe() walks and every fixture-tree probe run
// through the same code.

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
  // Every runtime source file, at any depth: a composite does not have to sit at
  // `src/<stage>/index.js` to publish the core surface, so the observation must
  // not be able to miss a nested one. The SAME inventory supplies the consumer
  // map, so a nested consumer cannot hide behind its depth either: exactly four
  // top-level orchestrator modules are committed, so any other key in this map
  // is a fifth consumer.
  // The package's own src/ tree skips ONLY node_modules (SRC_SKIP_DIRS): a
  // composite or a consumer relocated under a build-shaped directory is still
  // live code the gate must read. An entry the walk reports but the read cannot
  // open (broken symlink, unreadable file) becomes a PROBLEM, never a throw.
  const srcInventory = collectJsSources(RUNTIME_SRC, { skipDirectories: SRC_SKIP_DIRS });
  const runtimeSources = srcInventory.files.map((entry) => ({
    path: 'src/' + path.relative(RUNTIME_SRC, entry.path).split(path.sep).join('/'),
    source: entry.source,
  }));

  // Resolution-based, at any depth: a specifier counts by the FILE it resolves
  // to, a `require` the gate cannot read statically becomes a problem the
  // verdict must carry, and a module that only re-exports a consumer inherits
  // that consumer's dependencies.
  const { dependencies, problems: unresolved } = compositeDependencies(runtimeSources);

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
  const repoInventory = collectJsSources(REPO_ROOT);
  for (const entry of repoInventory.files) {
    if (SELF.has(entry.path)) continue;
    const relative = relativeToRepo(entry.path);
    legacyReferences.push(...legacyConsumerReferences([{ path: relative, source: entry.source }]));
    if (RUNTIME_COMPOSITE_REFERENCE.test(stripComments(entry.source))) {
      references.push(relative + ' (path into the runtime composite)');
    }
  }
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
    unresolved,
    inventoryProblems: srcInventory.problems.concat(repoInventory.problems),
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

  // A nested module that still requires a composite is the specifier step 6 has
  // to rewrite, whatever its depth - and the SPECIFIER has to be the one that
  // actually reaches the composite from where the file sits. From
  // `src/orchestrator/nested/`, that is `../../candidates`.
  it('reports a nested in-package consumer of a composite specifier', () => {
    assert.deepEqual(
      runtimeCompositeConsumers([
        { path: 'src/candidates/index.js', source: "module.exports = { a: require('./loader') };" },
        { path: 'src/orchestrator/nested/run.js', source: "const c = require('../../candidates');" },
      ]),
      ['src/orchestrator/nested/run.js requires src/candidates']
    );
  });
});

// The six fixtures of the L1/L2 fix, one per way the pre-fix scanner could pass
// a tree it had not actually judged. Each fails on the scanner at `5aab9a6`:
// the specifier now counts by the FILE it resolves to, at any depth, and a
// `require` the gate cannot read is a problem instead of a blind spot.
describe('F1 lifecycle — resolution, depth and the fail-closed require', () => {
  it('(a) resolves a composite from a nested module, one level deeper than the committed consumers', () => {
    assert.deepEqual(
      stagesRequiredBy("const c = require('../../candidates');", 'src/orchestrator/lib/x.js'),
      ['candidates']
    );
    const { dependencies } = compositeDependencies([
      { path: 'src/orchestrator/lib/x.js', source: "const c = require('../../candidates');" },
    ]);
    assert.deepEqual(dependencies, { 'src/orchestrator/lib/x.js': ['candidates'] });
  });

  it('(b) counts the /index and /index.js spellings by the file they resolve to', () => {
    const spellings = "const a = require('../candidates/index');\nconst b = require('../candidates/index.js');";
    assert.deepEqual(stagesRequiredBy(spellings, 'src/persistence/relay.js'), ['candidates']);
    // One level down the same text names `src/orchestrator/candidates`, which is
    // not the composite: resolution decides, not the spelling.
    assert.deepEqual(stagesRequiredBy(spellings, 'src/orchestrator/lib/x.js'), []);
  });

  it('(c) reports a file that only RE-EXPORTS the module which requires a composite', () => {
    const sources = [
      {
        path: 'src/orchestrator/impl.js',
        source: "const scoring = require('../scoring');\nmodule.exports = { rank: () => scoring.rankBuilds };" },
      { path: 'src/orchestrator/relay.js', source: "module.exports = require('./impl');" },
    ];
    const { dependencies, problems } = compositeDependencies(sources);
    assert.deepEqual(problems, []);
    assert.deepEqual(dependencies, { 'impl.js': ['scoring'], 'relay.js': ['scoring'] });
    assert.deepEqual(runtimeCompositeConsumers(sources), [
      'src/orchestrator/impl.js requires src/scoring',
      'src/orchestrator/relay.js requires src/scoring',
    ]);
    const verdictRelay = assess({ ...baseActive, dependencies });
    assert.equal(verdictRelay.state, 'PARTIAL');
    assert.equal(verdictRelay.problems.length, 1, verdictRelay.problems.join(' | '));
    assert.match(verdictRelay.problems[0], /UNEXPECTED CONSUMERS/);
    assert.match(verdictRelay.problems[0], /relay\.js/);
  });

  it('(d) fails closed on a require it cannot read, in every state', () => {
    const unreadable = [
      {
        path: 'src/orchestrator/lib/dynamic.js',
        source: "const stage = process.argv[2];\nconst m = require(path.join(__dirname, stage));",
      },
      {
        path: 'src/orchestrator/lib/templated.js',
        source: 'const which = process.argv[2];\nconst m = require(`../${which}`);',
      },
    ];
    const { problems } = compositeDependencies(unreadable);
    assert.equal(problems.length, 2, problems.join(' | '));
    assert.match(
      problems[0],
      /^src\/orchestrator\/lib\/dynamic\.js requires a module through a non-literal expression/
    );
    assert.match(problems[1], /^src\/orchestrator\/lib\/templated\.js/);
    for (const base of [baseActive, baseMigrated]) {
      const verdictUnreadable = assess({ ...base, unresolved: problems });
      assert.equal(verdictUnreadable.problems.length, 2, verdictUnreadable.problems.join(' | '));
      assert.match(verdictUnreadable.problems[0], /non-literal expression/);
    }
  });

  it('(e) a nested unexpected consumer turns ACTIVE into a named failure', () => {
    const sources = [
      {
        path: 'src/orchestrator/run.js',
        source: "require('../candidates');\nrequire('../filtering');\nrequire('../scoring');",
      },
      { path: 'src/orchestrator/swap-preview.js', source: "require('../candidates');\nrequire('../filtering');" },
      { path: 'src/orchestrator/swap-commit.js', source: "require('../scoring');" },
      { path: 'src/orchestrator/compute.js', source: "require('../scoring');" },
      { path: 'src/orchestrator/lib/extra.js', source: "require('../../scoring');" },
    ];
    const { dependencies } = compositeDependencies(sources);
    assert.deepEqual(dependencies, {
      ...EXPECTED_ACTIVE_DEPENDENCIES,
      'src/orchestrator/lib/extra.js': ['scoring'],
    });
    const verdictNested = assess({ ...baseActive, dependencies });
    assert.equal(verdictNested.state, 'PARTIAL');
    assert.equal(verdictNested.problems.length, 1, verdictNested.problems.join(' | '));
    assert.match(verdictNested.problems[0], /UNEXPECTED CONSUMERS/);
    assert.match(verdictNested.problems[0], /src\/orchestrator\/lib\/extra\.js/);
  });

  it('(f) does not flag a ./candidates that does not resolve to the composite', () => {
    assert.deepEqual(stagesRequiredBy("require('./candidates');", 'src/persistence/notes.js'), []);
    const { dependencies } = compositeDependencies([
      { path: 'src/persistence/notes.js', source: "const local = require('./candidates');" },
      { path: 'src/orchestrator/lib/candidates.js', source: 'module.exports = {};' },
      { path: 'src/orchestrator/lib/x.js', source: "const local = require('./candidates');" },
    ]);
    assert.deepEqual(dependencies, {});
  });
});

// Three defects the adversarial pass found at `a846638`, where the gate returned
// ACTIVE with zero problems on a tree that really did reach a composite.
describe('F1 lifecycle — the inventory is complete or the verdict is not ACTIVE', () => {
  it('(k) inventories .cjs and .mjs sources, not only .js', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-src-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.cjs'), "require('../../candidates');\n");
      fs.writeFileSync(path.join(dir, 'b.mjs'), "import x from '../../candidates';\n");
      fs.writeFileSync(path.join(dir, 'c.json'), '{}\n');
      const found = [];
      walkJs(dir, (absolute) => found.push(path.basename(absolute)), { skipDirectories: SRC_SKIP_DIRS });
      assert.deepEqual(found.sort(), ['a.cjs', 'b.mjs']);

      const { dependencies } = compositeDependencies([
        { path: 'src/orchestrator/lib/a.cjs', source: "require('../../candidates');" },
        { path: 'src/orchestrator/lib/b.mjs', source: "import x from '../../candidates';" },
      ]);
      assert.deepEqual(dependencies, {
        'src/orchestrator/lib/a.cjs': ['candidates'],
        'src/orchestrator/lib/b.mjs': ['candidates'],
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(i) resolves a dynamic import, and fails closed on an aliased require', () => {
    // A literal dynamic import is resolvable, so it is a dependency like any other.
    assert.deepEqual(
      stagesRequiredBy("module.exports = () => import('../../candidates');", 'src/orchestrator/lib/dyn.js'),
      ['candidates']
    );

    const aliased = [
      {
        path: 'src/orchestrator/lib/alias.js',
        source: "const r = require;\nmodule.exports = r('../../candidates');",
      },
      {
        path: 'src/orchestrator/lib/cr.js',
        source: "const { createRequire } = require('node:module');\nmodule.exports = createRequire(__filename)('../../candidates');",
      },
    ];
    const { problems } = compositeDependencies(aliased);
    assert.equal(problems.length, 2, problems.join(' | '));
    assert.match(problems[0], /aliased require/);
    assert.match(problems[1], /createRequire/);
    for (const base of [baseActive, baseMigrated]) {
      const verdictAliased = assess({ ...base, unresolved: problems });
      assert.equal(verdictAliased.problems.length, 2, verdictAliased.problems.join(' | '));
      assert.match(verdictAliased.problems[0], /aliased require/);
    }
  });

  it('(n) detects every re-export relay shape, not just module.exports = require', () => {
    const sources = [
      { path: 'src/orchestrator/impl.js', source: "require('../scoring');" },
      { path: 'src/orchestrator/r1.js', source: "module.exports = require('./impl');" },
      { path: 'src/orchestrator/r2.js', source: "module.exports = { ...require('./impl') };" },
      { path: 'src/orchestrator/r3.js', source: "Object.assign(module.exports, require('./impl'));" },
      { path: 'src/orchestrator/r4.js', source: "module.exports = Object.assign({}, require('./impl'));" },
    ];
    const { dependencies } = compositeDependencies(sources);
    assert.deepEqual(dependencies, {
      'impl.js': ['scoring'],
      'r1.js': ['scoring'],
      'r2.js': ['scoring'],
      'r3.js': ['scoring'],
      'r4.js': ['scoring'],
    });
  });
});

// Phase 5b, items 1a/1b: the package's own src/ walk skipped build-shaped
// directories (dist/, build/, docs/, .next/) exactly like the repo walk, and the
// extension filter's operator precedence (`isFile() && .js || .cjs || .mjs`)
// applied the .cjs/.mjs tests to EVERY non-directory entry: an unresolvable
// symlink named x.cjs was visited and its read threw, while a symlinked .js
// consumer was silently skipped (isFile() is false for a link). Both walks now
// come from collectJsSources: the src inventory skips only node_modules, every
// non-directory .js/.cjs/.mjs entry is attempted, and an entry the read cannot
// open is a problem the verdict carries — never a throw, never silence.
// A throwaway COPY of this package (src/ and test/), so a probe exercises the
// real walk over a real layout instead of an array the test hand-built.
// Module scope: the 1a/1b tests and the phase-5b probe table share it.
function makeFixturePackage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-fixture-'));
  const pkg = path.join(root, 'packages', 'recommendation-runtime');
  fs.mkdirSync(pkg, { recursive: true });
  fs.cpSync(path.join(PACKAGE_ROOT, 'src'), path.join(pkg, 'src'), { recursive: true });
  fs.cpSync(path.join(PACKAGE_ROOT, 'test'), path.join(pkg, 'test'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'runtime-fixture' }));
  return {
    root,
    pkg,
    src: path.join(pkg, 'src'),
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('F1 lifecycle — the src inventory skips only node_modules, and unreadable entries fail closed', () => {
  function writeConsumer(pkgSrc, relative) {
    const file = path.join(pkgSrc, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "const scoring = require('../../scoring');\nmodule.exports = scoring;\n");
    return file;
  }

  it('1a: a composite consumer under build-shaped directories IS inventoried (src walk)', () => {
    const temp = makeFixturePackage();
    try {
      for (const dir of ['build', 'dist', 'docs', '.next']) {
        writeConsumer(temp.src, 'orchestrator/' + dir + '/extra.js');
      }
      const inventory = collectJsSources(temp.src, { skipDirectories: SRC_SKIP_DIRS });
      assert.deepEqual(inventory.problems, [], inventory.problems.join(' | '));
      const { dependencies } = compositeDependencies(
        inventory.files.map((entry) => ({
          path: 'src/' + path.relative(temp.src, entry.path).split(path.sep).join('/'),
          source: entry.source,
        }))
      );
      for (const dir of ['build', 'dist', 'docs', '.next']) {
        assert.deepEqual(
          dependencies['src/orchestrator/' + dir + '/extra.js'],
          ['scoring'],
          'a consumer under src/orchestrator/' + dir + '/ must reach the dependency map'
        );
      }
      const verdict = assess({ ...baseActive, dependencies });
      assert.equal(verdict.state, 'PARTIAL');
      assert.ok(
        verdict.problems.some((text) => text.includes('PARTIAL MIGRATION')),
        verdict.problems.join(' | ')
      );
    } finally {
      temp.dispose();
    }
  });

  it('1a: the repo-wide walk keeps hiding build-shaped directories, and SRC_SKIP_DIRS hides only node_modules', () => {
    const temp = makeFixturePackage();
    try {
      writeConsumer(temp.src, 'orchestrator/dist/extra.js');
      const repoKept = [];
      walkJs(temp.root, (absolute) => repoKept.push(absolute), { skipDirectories: REPO_SKIP_DIRS });
      assert.ok(
        !repoKept.some((absolute) => absolute.includes(path.join('dist', 'extra.js'))),
        'the consumer inventory changed the repo walk, which is scoped by design'
      );
      const srcKept = [];
      walkJs(temp.root, (absolute) => srcKept.push(absolute), { skipDirectories: SRC_SKIP_DIRS });
      assert.ok(
        srcKept.some((absolute) => absolute.includes(path.join('dist', 'extra.js'))),
        'the src walk must not hide build-shaped directories'
      );
      assert.deepEqual([...SRC_SKIP_DIRS], ['node_modules']);
      assert.ok(REPO_SKIP_DIRS.has('node_modules') && REPO_SKIP_DIRS.has('docs'));
    } finally {
      temp.dispose();
    }
  });

  it('1b: a directory named x.cjs / x.mjs is skipped, not read (no throw, no fake entry)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-dir-cjs-'));
    try {
      fs.mkdirSync(path.join(dir, 'fake.cjs'));
      fs.mkdirSync(path.join(dir, 'fake.mjs'));
      fs.writeFileSync(path.join(dir, 'real.cjs'), "require('../../candidates');\n");
      const inventory = collectJsSources(dir, { skipDirectories: SRC_SKIP_DIRS });
      assert.deepEqual(inventory.problems, [], inventory.problems.join(' | '));
      assert.deepEqual(inventory.files.map((entry) => path.basename(entry.path)), ['real.cjs']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('1b: an entry whose read throws becomes a fail-closed problem on every verdict', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-unreadable-'));
    try {
      fs.writeFileSync(path.join(dir, 'ok.js'), "require('../../candidates');\n");
      fs.writeFileSync(path.join(dir, 'locked.js'), "require('../../candidates');\n");
      const inventory = collectJsSources(dir, {
        skipDirectories: SRC_SKIP_DIRS,
        readFile: (absolute) => {
          if (path.basename(absolute) === 'locked.js') {
            const err = new Error('simulated: EPERM reading ' + absolute);
            err.code = 'EPERM';
            throw err;
          }
          return fs.readFileSync(absolute, 'utf8');
        },
      });
      assert.deepEqual(inventory.files.map((entry) => path.basename(entry.path)), ['ok.js']);
      assert.equal(inventory.problems.length, 1, inventory.problems.join(' | '));
      assert.match(inventory.problems[0], /locked\.js/);
      assert.match(inventory.problems[0], /EPERM/);
      for (const base of [baseActive, baseMigrated]) {
        const verdict = assess({ ...base, inventoryProblems: inventory.problems });
        assert.equal(verdict.problems.length, 1, verdict.problems.join(' | '));
        assert.match(verdict.problems[0], /fails closed/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('1b: a broken symlink (or a symlink the read cannot open) is a PROBLEM, never a throw', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-broken-link-'));
    try {
      fs.writeFileSync(path.join(dir, 'target.js'), "require('../../candidates');\n");
      try {
        fs.symlinkSync(path.join(dir, 'missing.js'), path.join(dir, 'broken.js'));
      } catch (err) {
        t.skip('this platform/checkout does not allow creating symlinks (' + err.code + ')');
        return;
      }
      const inventory = collectJsSources(dir, { skipDirectories: SRC_SKIP_DIRS });
      assert.equal(inventory.problems.length, 1, inventory.problems.join(' | '));
      assert.match(inventory.problems[0], /broken\.js/);
      assert.match(inventory.problems[0], /could not be read/);
      assert.deepEqual(inventory.files.map((entry) => path.basename(entry.path)), ['target.js']);

      // The observation-level wiring: an inventory problem reaches every verdict.
      for (const base of [baseActive, baseMigrated]) {
        const verdict = assess({ ...base, inventoryProblems: inventory.problems });
        assert.equal(verdict.problems.length, 1, verdict.problems.join(' | '));
        assert.match(verdict.problems[0], /fails closed/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Phase 5b, probe h2: an uninterpolated template literal IS a static string.
// Before the fix, `` require(`../../candidates`) `` matched neither the
// literal-specifier patterns (quote classes excluded backticks) nor a plain
// skip, so a real consumer read as ONE unresolved dynamic load instead of a
// counted dependency: the right direction (never ACTIVE), the wrong form.
// h3 pins the other side of the same line — a `$` sends the call to the
// fail-closed list, interpolated or not.
describe('F1 lifecycle — a backtick specifier without substitution is a literal', () => {
  it("h2 fix: backtick require('../../candidates') counts as a dependency, not a problem", () => {
    const { dependencies, problems } = compositeDependencies([
      { path: 'src/orchestrator/lib/h2.js', source: 'require(`../../candidates`);\n' },
    ]);
    assert.deepEqual(problems, [], problems.join(' | '));
    assert.deepEqual(dependencies, { 'src/orchestrator/lib/h2.js': ['candidates'] });
  });

  it('h3 fix-side: a $ anywhere in the template fails closed, never counts', () => {
    const { dependencies, problems } = compositeDependencies([
      { path: 'src/orchestrator/lib/h3.js', source: "require(`../../${'candidates'}`);\n" },
    ]);
    assert.deepEqual(dependencies, {});
    assert.equal(problems.length, 1, problems.join(' | '));
  });

  it('the fix does not soften the quoted or dynamic-import paths', () => {
    const quoted = compositeDependencies([
      { path: 'src/orchestrator/lib/a.js', source: 'require(\'../../candidates\');\n' },
    ]);
    const imported = compositeDependencies([
      { path: 'src/orchestrator/lib/b.mjs', source: 'await import(`../../scoring`);\n' },
    ]);
    assert.deepEqual(quoted.dependencies, { 'src/orchestrator/lib/a.js': ['candidates'] });
    assert.deepEqual(quoted.problems, []);
    assert.deepEqual(imported.dependencies, { 'src/orchestrator/lib/b.mjs': ['scoring'] });
    assert.deepEqual(imported.problems, []);
  });
});

// Phase 5b, item 1f (probe o1): the spreader detector keyed on the index of
// `module.exports`, so a file that publishes the core surface ONLY through the
// `exports` object — the shape CJS allows without ever naming `module.exports`
// — escaped the composite signature check entirely. Every form below is the
// same publication; internal use (a CALLED member, a non-core binding) must
// stay unflagged, which is the rule that keeps legitimate Core use out of the
// gate's crosshairs.
describe('F1 lifecycle — publication through `exports.<name>` needs no `module.exports`', () => {
  const coreBinding = "const core = require('../core-entry');\n";

  it('o1 fix: exports.member = core.member is a composite signature', () => {
    assert.equal(coreEntrySpread(coreBinding + 'exports.candidates = core.candidates;\n'), true);
  });

  it('o1 fix: Object.assign(exports, core) is a composite signature', () => {
    assert.equal(coreEntrySpread(coreBinding + 'Object.assign(exports, core.scoring);\n'), true);
  });

  it('o1 fix: inline core-entry publication onto exports is caught too', () => {
    assert.equal(
      coreEntrySpread("exports.candidates = require('../core-entry').candidates;\n"),
      true
    );
    assert.equal(coreEntrySpread("exports.all = { ...require('../core-entry') };\n"), true);
  });

  it('the fix keeps internal use unflagged: called members, non-core bindings', () => {
    assert.equal(coreEntrySpread(coreBinding + 'exports.value = wrap(core.purity());\n'), false);
    assert.equal(
      coreEntrySpread("const own = require('./loader');\nexports.x = own.x;\n"),
      false
    );
  });
});

// Phase 5b, item 1d: the owner's probe table, committed. 26 cases g1-n3 plus the
// out-of-numbering o1 spreader probe. Every fixture is written into a copy of
// this package under the OS temp directory, so the probe travels the REAL
// inventory walk and the REAL resolution rules — file placement (top-level vs
// lib/) is part of each probe, exactly as in the owner's list.
//
// Reading the expectations: for a counted row the dependency appears under its
// resolution key and the verdict stops being clean ACTIVE; for a fail-closed row
// the construct is NOT counted and instead rides the verdict as a problem (a
// require the scanner cannot read must never pass silently). Rows tagged LIMIT
// (j4, k3, l1, l2, n3) adopt the observed 32d3607 behavior as expected, per the
// owner's ruling; each names its limit in the test title. h2 and o1 pin the
// post-fix correct verdicts delivered by the two fix commits immediately above.
describe('F1 lifecycle — phase 5b probe table (g1-n3 + o1)', () => {
  function fixtureProbe(mutate) {
    const temp = makeFixturePackage();
    try {
      const write = (relative, source) => {
        const rel = relative.replace(/^src\//, '');
        const file = path.join(temp.src, ...rel.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, source);
        return file;
      };
      mutate(temp, write);
      const inventory = collectJsSources(temp.src, { skipDirectories: SRC_SKIP_DIRS });
      assert.deepEqual(inventory.problems, [], inventory.problems.join(' | '));
      const runtimeSources = inventory.files.map((entry) => ({
        path: 'src/' + path.relative(temp.src, entry.path).split(path.sep).join('/'),
        source: entry.source,
      }));
      const { dependencies, problems } = compositeDependencies(runtimeSources);
      const coreSpreaders = runtimeSurfacePublishers(runtimeSources);
      const verdict = assess({ ...baseActive, dependencies, unresolved: problems, coreSpreaders });
      return {
        dependencies,
        problems,
        coreSpreaders,
        state: verdict.state,
        verdictProblems: verdict.problems,
        unchanged: () => assert.deepEqual(dependencies, EXPECTED_ACTIVE_DEPENDENCIES),
        count: (key, stages) => {
          assert.deepEqual(dependencies[key], stages, key + ': counted stages');
        },
        absent: (key) => assert.ok(!(key in dependencies), key + ': unexpectedly counted'),
      };
    } finally {
      temp.dispose();
    }
  }

  const LIB = 'src/orchestrator/lib/';
  const TOP = 'src/orchestrator/';

  it('baseline: an untouched copy still observes ACTIVE with zero problems', () => {
    const probe = fixtureProbe(() => {});
    assert.deepEqual(probe.dependencies, EXPECTED_ACTIVE_DEPENDENCIES);
    assert.equal(probe.state, 'ACTIVE');
    assert.deepEqual(probe.verdictProblems, [], probe.verdictProblems.join(' | '));
    assert.deepEqual(probe.coreSpreaders.sort(), STAGES.map((s) => 'src/' + s + '/index.js'));
  });

  it('g1: multi-line require specifier is counted', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'g1.js', "const x = require(\n  '../../candidates'\n);\nmodule.exports = x;\n")
    );
    probe.count(LIB + 'g1.js', ['candidates']);
    assert.deepEqual(probe.problems, []);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('g2: space between require and the parenthesis is counted', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'g2.js', "const x = require ('../../candidates');\nmodule.exports = x;\n")
    );
    probe.count(LIB + 'g2.js', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('h1: double-quoted specifier is counted', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'h1.js', 'const x = require("../../candidates");\nmodule.exports = x;\n')
    );
    probe.count(LIB + 'h1.js', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('h2: backtick WITHOUT substitution is a literal, counted (fix commit above)', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'h2.js', 'const x = require(`../../candidates`);\nmodule.exports = x;\n')
    );
    probe.count(LIB + 'h2.js', ['candidates']);
    assert.deepEqual(probe.problems, []);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('h3: backtick WITH interpolation fails closed as a problem, never counted', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'h3.js', "const x = require(`../../${'candidates'}`);\nmodule.exports = x;\n")
    );
    probe.absent(LIB + 'h3.js');
    assert.equal(probe.problems.length, 1, probe.problems.join(' | '));
    assert.ok(probe.verdictProblems.length > 0, 'the problem must ride the verdict');
  });

  it('i1: require used as a VALUE fails closed (aliased), never counted', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'i1.js', "const r = require;\nconst x = r('../../candidates');\nmodule.exports = x;\n")
    );
    probe.absent(LIB + 'i1.js');
    assert.equal(probe.problems.length, 1, probe.problems.join(' | '));
    assert.match(probe.problems[0], /aliased require/);
  });

  it('i2: module.require is counted', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'i2.js', "const x = module.require('../../candidates');\nmodule.exports = x;\n")
    );
    probe.count(LIB + 'i2.js', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('i3: createRequire fails closed, never counted', () => {
    const probe = fixtureProbe((t, write) =>
      write(
        LIB + 'i3.js',
        "const { createRequire } = require('module');\nconst req = createRequire(__filename);\nconst x = req('../../candidates');\nmodule.exports = x;\n"
      )
    );
    probe.absent(LIB + 'i3.js');
    assert.equal(probe.problems.length, 1, probe.problems.join(' | '));
    assert.match(probe.problems[0], /createRequire/);
  });

  it('i4: await import with a literal specifier is counted', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'i4.js', "const x = await import('../../candidates');\nmodule.exports = x;\n")
    );
    probe.count(LIB + 'i4.js', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('i5: require.resolve counts as the dependency it is (A2)', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'i5.js', "const p = require.resolve('../../candidates');\nmodule.exports = p;\n")
    );
    probe.count(LIB + 'i5.js', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it("j1: '../candidates/' resolving to the barrel is counted", () => {
    const probe = fixtureProbe((t, write) =>
      write(TOP + 'j1.js', "const x = require('../candidates/');\nmodule.exports = x;\n")
    );
    probe.count('j1.js', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it("j2: '../candidates/index' is counted", () => {
    const probe = fixtureProbe((t, write) =>
      write(TOP + 'j2.js', "const x = require('../candidates/index');\nmodule.exports = x;\n")
    );
    probe.count('j2.js', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it("j3: '../candidates/index.js' is counted", () => {
    const probe = fixtureProbe((t, write) =>
      write(TOP + 'j3.js', "const x = require('../candidates/index.js');\nmodule.exports = x;\n")
    );
    probe.count('j3.js', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('j4 LIMIT: ../../src/candidates from lib/ resolves OUTSIDE the package — invisible at 32d3607, adopted', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'j4.js', "const x = require('../../src/candidates');\nmodule.exports = x;\n")
    );
    probe.unchanged();
    assert.deepEqual(probe.problems, []);
    assert.equal(probe.state, 'ACTIVE');
  });

  it('k1: a consumer in a .cjs file is inventoried and counted', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'k1.cjs', "require('../../candidates');\nmodule.exports = 1;\n")
    );
    probe.count(LIB + 'k1.cjs', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('k2: a consumer in a .mjs file is inventoried and counted', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'k2.mjs', "require('../../candidates');\nexport default 1;\n")
    );
    probe.count(LIB + 'k2.mjs', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('k3 LIMIT: a .json file holding the path as DATA is not scanned — adopted', () => {
    const probe = fixtureProbe((t, write) =>
      write(TOP + 'k3.json', '{ "composite": "../candidates" }\n')
    );
    probe.unchanged();
    assert.deepEqual(probe.problems, []);
    assert.equal(probe.state, 'ACTIVE');
  });

  it('l1 LIMIT: a commented-out require is stripped, clean — observed equals correct here', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'l1.js', "// const x = require('../../candidates');\nmodule.exports = 1;\n")
    );
    probe.unchanged();
    assert.deepEqual(probe.problems, []);
    assert.equal(probe.state, 'ACTIVE');
  });

  it("l2 LIMIT: require inside a STRING is a documented false positive — counted, observed adopted", () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'l2.js', 'const doc = "run: require(\'../../candidates\') for composites";\nmodule.exports = doc;\n')
    );
    probe.count(LIB + 'l2.js', ['candidates']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('m1: compute.js gaining ../candidates lands in the pin and fails as PARTIAL', () => {
    const probe = fixtureProbe((t) =>
      fs.appendFileSync(
        path.join(t.src, 'orchestrator', 'compute.js'),
        "\nconst extraCandidates = require('../candidates');\n"
      )
    );
    assert.deepEqual(probe.dependencies['compute.js'], ['candidates', 'scoring']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('m2: run.js losing ../filtering lands in the pin and fails as PARTIAL', () => {
    const probe = fixtureProbe((t) => {
      const file = path.join(t.src, 'orchestrator', 'run.js');
      const source = fs.readFileSync(file, 'utf8');
      assert.ok(source.includes("'../filtering'"), 'fixture run.js must carry the committed filtering require');
      fs.writeFileSync(file, source.split("'../filtering'").join("'../filtering-retired'"));
    });
    assert.deepEqual(probe.dependencies['run.js'], ['candidates', 'scoring']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('m3: deleting compute.js leaves three consumers and fails as PARTIAL', () => {
    const probe = fixtureProbe((t) => {
      fs.rmSync(path.join(t.src, 'orchestrator', 'compute.js'));
    });
    probe.absent('compute.js');
    assert.equal(Object.keys(probe.dependencies).length, 3);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('m4: a NEW fifth consumer at depth (lib/extra.js) is caught, not hidden', () => {
    const probe = fixtureProbe((t, write) =>
      write(LIB + 'extra.js', "require('../../scoring');\nmodule.exports = 1;\n")
    );
    probe.count(LIB + 'extra.js', ['scoring']);
    assert.equal(probe.state, 'PARTIAL');
    assert.match(
      probe.verdictProblems.join(' | '),
      /UNEXPECTED CONSUMERS .*src\/orchestrator\/lib\/extra\.js/
    );
  });

  it('n1: a spread relay of a consumer inherits the consumer dependencies', () => {
    const probe = fixtureProbe((t, write) =>
      write(TOP + 'n1.js', "module.exports = { ...require('./run') };\n")
    );
    probe.count('n1.js', ['candidates', 'filtering', 'scoring']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('n2: an Object.assign relay of a consumer inherits the consumer dependencies', () => {
    const probe = fixtureProbe((t, write) =>
      write(TOP + 'n2.js', "Object.assign(module.exports, require('./run'));\n")
    );
    probe.count('n2.js', ['candidates', 'filtering', 'scoring']);
    assert.equal(probe.state, 'PARTIAL');
  });

  it('n3 LIMIT: a module that requires a consumer but re-exports NOTHING is not counted — adopted', () => {
    const probe = fixtureProbe((t, write) =>
      write(TOP + 'n3.js', "require('./run');\nmodule.exports = { label: 'no relay' };\n")
    );
    probe.unchanged();
    assert.deepEqual(probe.problems, []);
    assert.equal(probe.state, 'ACTIVE');
  });

  it('o1: exports.member = core.member publishes the surface with NO module.exports (fix commit above)', () => {
    const probe = fixtureProbe((t, write) =>
      write(TOP + 'spreader.js', "const core = require('../core-entry');\nexports.candidates = core.candidates;\n")
    );
    assert.ok(
      probe.coreSpreaders.includes('src/orchestrator/spreader.js'),
      'coreSpreaders: ' + probe.coreSpreaders.join(', ')
    );
    assert.ok(probe.verdictProblems.length > 0, 'a fourth core-surface publisher must carry a problem');
  });
});
