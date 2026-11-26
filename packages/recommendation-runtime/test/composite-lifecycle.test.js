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

  const compositeFiles = [];
  const coreSpreaders = [];
  for (const entry of fs.readdirSync(RUNTIME_SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const index = path.join(RUNTIME_SRC, entry.name, 'index.js');
    if (!fs.existsSync(index)) continue;
    const source = fs.readFileSync(index, 'utf8');
    const relative = 'src/' + entry.name + '/index.js';
    // The composite signature as this gate defines it: a top-level runtime barrel
    // that reaches the pure core directly. Deliberately conservative - a new
    // barrel that wants a core constant has to pass through the owner's
    // condition 6 rather than slip into the exception.
    if (source.includes("require('../core-entry')")) coreSpreaders.push(relative);
    if (STAGES.includes(entry.name)) compositeFiles.push(relative);
  }

  const shimRefsRuntime = {};
  for (const stage of STAGES) {
    const shim = path.join(OLD_TREE, stage, 'index.js');
    shimRefsRuntime[stage] = fs.existsSync(shim)
      && RUNTIME_COMPOSITE_REFERENCE.test(stripComments(fs.readFileSync(shim, 'utf8')));
  }

  const references = [];
  walk(REPO_ROOT, (absolute) => {
    if (SELF.has(absolute)) return;
    const source = stripComments(fs.readFileSync(absolute, 'utf8'));
    const relative = relativeToRepo(absolute);
    if (RUNTIME_COMPOSITE_REFERENCE.test(source)) {
      references.push(relative + ' (path into the runtime composite)');
      return;
    }
    if (!absolute.startsWith(RUNTIME_SRC + path.sep)) return;
    if (!fs.readdirSync(RUNTIME_SRC).includes(path.basename(path.dirname(absolute)))) return;
    // Inside the package, the exception is the composite specifier itself. The
    // composite directories are allowed to BE the composite; nothing else may
    // require one.
    const directory = path.dirname(absolute);
    if (STAGES.includes(path.basename(directory))) return;
    const stages = stagesRequiredBy(source);
    if (stages.length > 0) references.push(relative + ' requires ../' + stages.join(', ../'));
  });

  const manifest = require('../package.json');
  return {
    dependencies,
    compositeFiles,
    coreSpreaders,
    shimRefsRuntime,
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
  const baseActive = {
    dependencies: { ...EXPECTED_ACTIVE_DEPENDENCIES },
    compositeFiles: STAGES.map((stage) => 'src/' + stage + '/index.js'),
    coreSpreaders: STAGES.map((stage) => 'src/' + stage + '/index.js'),
    shimRefsRuntime: { candidates: true, filtering: true, scoring: true },
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
    shimRefsRuntime: { candidates: false, filtering: false, scoring: false },
    exportsKeys: ['.', './loaders', './orchestrator', './persistence'],
    rootKeys: ['loaders', 'orchestrator', 'persistence'],
    snapshotExports: ['loaders', 'orchestrator', 'persistence'],
    discoveryRequired: ['composite-lifecycle.test.js', 'namespace-barrels.test.js'],
    compositeSuitePresent: true,
    references: [],
  };

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
    assert.match(problems[0], /only runtime files that may spread a core namespace/);
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
    assert.match(problems[0], /still spread a core namespace/);
  });

  it('MIGRATED fails while an old-path shim still re-exports a composite', () => {
    const problems = assess({
      ...baseMigrated,
      shimRefsRuntime: { candidates: false, filtering: false, scoring: true },
    }).problems;
    assert.equal(problems.length, 1, problems.join(' | '));
    assert.match(problems[0], /src\/recommendation\/scoring\/index\.js still re-exports/);
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
