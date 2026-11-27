'use strict';

// ---------------------------------------------------------------------------
// Decision 17 (src/recommendation/orchestrator/): barrel contract and the
// module-wide source boundary.
//
// This file proves ONLY that index.js is a thin, boundary-only public surface
// and that no orchestrator source performs a write or reaches for a driver.
// Behaviour is covered by run.test.js / snapshot.test.js.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const orchestrator = require('./index');
const run = require('./run');
const snapshot = require('./snapshot');
const fullRun = require('./full-run');
const swapPreview = require('./swap-preview');
const swapCommit = require('./swap-commit');

/** Strip block and line comments so a source assertion cannot self-match docs. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Step 5 W3: every source assertion scans the IMPLEMENTATION under the runtime
// package. The barrel/identity tests below still load the old path, which is an
// identity shim - but reading the shim's TEXT would prove nothing.
const IMPLEMENTATION_DIR = path.resolve(
  __dirname,
  '../../../packages/recommendation-runtime/src/orchestrator'
);
const readSource = (file) => fs.readFileSync(path.join(IMPLEMENTATION_DIR, file), 'utf8');
const requiresOf = (file) => [...stripComments(readSource(file)).matchAll(/require\('([^']+)'\)/g)]
  .map((match) => match[1])
  .sort();

test('orchestrator barrel exposes exactly the Decision 17 + 21 + 55 + 56 entry points', () => {
  assert.deepEqual(Object.keys(orchestrator), [
    'runRecommendation',
    'runRecommendationSnapshot',
    'runRecommendationFullRun',
    // Decision 55 item 4: the read-only swap preview and its snapshot wrapper.
    'evaluateSwapPreview',
    'evaluateSwapPreviewSnapshot',
    // Decision 56: the WRITE half - the commit and its one-swap read.
    'commitSwap',
    'commitSwapInTransaction',
    'readCommittedSwap',
  ]);
  assert.equal(typeof orchestrator.runRecommendation, 'function');
  assert.equal(typeof orchestrator.runRecommendationSnapshot, 'function');
  assert.equal(typeof orchestrator.runRecommendationFullRun, 'function');
  assert.equal(typeof orchestrator.evaluateSwapPreview, 'function');
  assert.equal(typeof orchestrator.evaluateSwapPreviewSnapshot, 'function');
  assert.equal(orchestrator.runRecommendation.length, 1);
  // Decision 35 added an optional third parameter (engine options) to both
  // wrappers, so their arity is pinned at 3 rather than 2.
  assert.equal(orchestrator.runRecommendationSnapshot.length, 3);
  assert.equal(orchestrator.runRecommendationFullRun.length, 3);
  // Decision 55: both take ONE argument object, because a preview's inputs are
  // named fields rather than positional caller-owned values.
  assert.equal(orchestrator.evaluateSwapPreview.length, 1);
  assert.equal(orchestrator.evaluateSwapPreviewSnapshot.length, 2);
  assert.equal(typeof orchestrator.commitSwap, 'function');
  assert.equal(orchestrator.commitSwap.length, 1);
  assert.equal(orchestrator.commitSwapInTransaction.length, 2);
  assert.equal(orchestrator.readCommittedSwap.length, 2);
});

test('orchestrator barrel re-exports by identity - no wrapper, no copy', () => {
  assert.equal(orchestrator.runRecommendation, run.runRecommendation);
  assert.equal(orchestrator.runRecommendationSnapshot, snapshot.runRecommendationSnapshot);
  assert.equal(orchestrator.runRecommendationFullRun, fullRun.runRecommendationFullRun);
  assert.equal(orchestrator.evaluateSwapPreview, swapPreview.evaluateSwapPreview);
  assert.equal(orchestrator.evaluateSwapPreviewSnapshot, swapPreview.evaluateSwapPreviewSnapshot);
  assert.equal(orchestrator.commitSwap, swapCommit.commitSwap);
  assert.equal(orchestrator.commitSwapInTransaction, swapCommit.commitSwapInTransaction);
  assert.equal(orchestrator.readCommittedSwap, swapCommit.readCommittedSwap);
});

test('no orchestrator source writes, commits, or reaches for a driver', () => {
  const banned = [
    "require('pg')", "require('node:pg')", 'new Pool', 'new Client',
    'INSERT', 'UPDATE', 'DELETE', 'COMMIT', 'TRUNCATE', 'CREATE TABLE', 'ALTER TABLE',
    'DROP ',
  ];
  // `commit.js` and `swap-commit.js` are the module's TWO write wrappers, and
  // they are excluded here by design - each is asserted on its own terms below
  // (INSERT yes, UPDATE/DELETE never).
  for (const file of ['index.js', 'run.js', 'snapshot.js', 'full-run.js', 'swap-preview.js']) {
    const source = stripComments(readSource(file));
    for (const token of banned) {
      assert.ok(!source.includes(token), file + ' must not contain ' + token);
    }
  }

  // BEGIN belongs to the snapshot wrappers alone: runRecommendation and
  // evaluateSwapPreview issue no transaction control at all (Decision 17.5,
  // applied to Decision 55's preview).
  assert.equal(stripComments(readSource('run.js')).includes('BEGIN'), false);
  assert.equal(stripComments(readSource('index.js')).includes('BEGIN'), false);
  assert.equal(stripComments(readSource('full-run.js')).includes('BEGIN'), false);
  // swap-preview.js holds the SAME two constants - its OWN snapshot wrapper owns
  // them, exactly as ./snapshot does for a pass.
  assert.ok(stripComments(readSource('swap-preview.js')).includes('BEGIN'));
  assert.ok(stripComments(readSource('snapshot.js')).includes('BEGIN'));

  // Decision 56: swap-commit.js is a WRITE wrapper, so it may INSERT - and it
  // must never UPDATE or DELETE, because the pass is a record (item 1). This is
  // the mechanical half of that decision, not a stylistic one.
  const commitSource = stripComments(readSource('swap-commit.js'));
  assert.ok(commitSource.includes('INSERT'));
  assert.equal(commitSource.includes('UPDATE '), false, 'swap-commit.js must never UPDATE');
  assert.equal(commitSource.includes('DELETE'), false, 'swap-commit.js must never DELETE');
  assert.ok(commitSource.includes('BEGIN'));
});

test('orchestrator modules import exactly their collaborators', () => {
  // run.js keeps every loader and the pure filter; the assemble-and-score half
  // moved to ./compute, so `../assembly` and `../retention` are no longer its
  // collaborators - ./compute is. The pin is exact, not a subset: the seam is
  // the only new edge, and no stage internal was imported to replace them.
  assert.deepEqual(requiresOf('run.js'), [
    '../candidates',
    '../core-entry',
    '../filtering',
    '../offers',
    '../query',
    '../scoring',
    './compute',
  ]);
  // ./compute is pure composition: the three stage barrels it calls through and
  // the shared error vocabulary. No loader, no query module, no as-of parser.
  assert.deepEqual(requiresOf('compute.js'), ['../core-entry', '../scoring']);
  assert.deepEqual(requiresOf('snapshot.js'), ['../core-entry', './run']);
  assert.deepEqual(requiresOf('index.js'), [
    './full-run',
    './run',
    './snapshot',
    './swap-commit',
    './swap-preview',
  ]);
  assert.deepEqual(requiresOf('full-run.js'), ['../core-entry', './commit', './snapshot']);
  // Decision 55: the preview composes 2B/2C/Stage 1/2D through their barrels and
  // hands the verdict to Engine 3 - it never reaches for a stage internal, and
  // it deliberately does NOT require ../scoring or ../retention (see the
  // module header: neither a pass's scoring model nor its retention is read).
  assert.deepEqual(requiresOf('swap-preview.js'), [
    '../candidates',
    '../core-entry',
    '../filtering',
    '../offers',
    '../query',
  ]);
  // Decision 56: the commit reuses the preview's composition and adds the two
  // things a write needs - the engine's whole-build verdict and Engine 4's
  // score under the pass's own pinned model. It reaches for no stage internal.
  assert.deepEqual(requiresOf('swap-commit.js'), [
    '../core-entry',
    '../scoring',
    './run',
    './swap-preview',
    // The row ids are generated in JS, as the pass's writer does (Decision 19.4).
    'node:crypto',
  ]);
});

// Step 5 W3: '../core-entry' is a DEVICE, not a licence. Each module may reach
// the core only through the namespaces and members recorded here - the exact
// take commit 598e442 made, proven member-for-member identical to the old
// specifiers' exports (PR #72 Phase 2 A1: 26 / 26 identity checks at both
// 598e442^ and 598e442).
//
//   * a DESTRUCTURED take (`const { A, B } = core.<ns>`) pins the name list;
//   * a NAMESPACE take (`const local = core.<ns>`) pins the members the module
//     actually READS from it, so deleting a call is a failing diff too.
const CORE_MEMBERS = {
  'commit.js': {
    candidates: ['CandidateSelectionError', 'ERROR_CODES'],
  },
  'compute.js': {
    retention: ['computeBudgetFloor', 'computeRoleTargets', 'excludedCpuProductIds', 'retainTopKPerRole'],
    assembly: ['assembleBuildsForRecommendation'],
    candidates: ['CandidateSelectionError', 'ERROR_CODES'],
  },
  'full-run.js': {
    ranking: ['rankBuilds', 'selectArchetypes'],
    explanation: ['explainSelection'],
  },
  'run.js': {
    offers: ['parseAsOf'],
    candidates: ['CandidateSelectionError', 'ERROR_CODES'],
  },
  'snapshot.js': {
    candidates: ['CandidateSelectionError', 'ERROR_CODES'],
  },
  'swap-commit.js': {
    assembly: ['EXPANSION_ORDER', 'evaluateBuild'],
    candidates: ['CandidateSelectionError', 'ERROR_CODES'],
  },
  'swap-preview.js': {
    assembly: ['EXPANSION_ORDER', 'evaluateBuildReplacement', 'lookupPrice'],
    candidates: ['CandidateSelectionError', 'ERROR_CODES'],
  },
};

/** The namespaces and members one module takes from ../core-entry. */
function coreMembersOf(file) {
  const source = stripComments(readSource(file));
  const coreVars = [...source.matchAll(/const\s+(\w+)\s*=\s*require\('\.\.\/core-entry'\)/g)]
    .map((match) => match[1]);
  assert.equal(coreVars.length, 1,
    file + ' must reach the core through exactly one core-entry require');
  const core = coreVars[0];
  const taken = {};

  // const { A, B } = core.<ns>;  -> the destructured name list IS the member list.
  for (const match of source.matchAll(
    new RegExp('const\\s*\\{([^}]*)\\}\\s*=\\s*' + core + '\\.(\\w+);', 'g')
  )) {
    taken[match[2]] = match[1].split(',').map((name) => name.trim()).filter(Boolean).sort();
  }

  // const local = core.<ns>;     -> pin the members the module READS.
  for (const match of source.matchAll(
    new RegExp('const\\s+(\\w+)\\s*=\\s*' + core + '\\.(\\w+);', 'g')
  )) {
    const members = new Set();
    for (const use of source.matchAll(new RegExp('\\b' + match[1] + '\\.(\\w+)', 'g'))) {
      members.add(use[1]);
    }
    taken[match[2]] = [...members].sort();
  }

  const ordered = {};
  for (const namespace of Object.keys(taken).sort()) ordered[namespace] = taken[namespace];
  return ordered;
}

test('orchestrator modules take exactly these members from ../core-entry', () => {
  for (const file of Object.keys(CORE_MEMBERS)) {
    assert.deepEqual(coreMembersOf(file), CORE_MEMBERS[file],
      file + ' must read exactly the recorded core members');
  }
  // index.js is the one orchestrator module that takes nothing from the core.
  assert.equal(/require\('\.\.\/core-entry'\)/.test(stripComments(readSource('index.js'))), false);
});

test('run.js composes the two Engine 2D stages itself (the B2-G helper is never imported)', () => {
  const source = stripComments(readSource('run.js'));
  assert.ok(source.includes('filtering.loadFilteringContext('));
  assert.ok(source.includes('filtering.filterCandidates('));
  assert.equal(source.includes('filterCandidatesForRecommendation'), false);
});

test('swap-preview.js takes the SAME Engine 2D path, and prices through the engine', () => {
  const source = stripComments(readSource('swap-preview.js'));
  assert.ok(source.includes('filtering.loadFilteringContext('));
  assert.ok(source.includes('filtering.filterCandidates('));
  assert.equal(source.includes('filterCandidatesForRecommendation'), false);
  // The verdict and the price are the ENGINE's; a re-implementation here would
  // be the second vocabulary Decision 55 exists to prevent.
  assert.ok(source.includes('assembly.evaluateBuildReplacement('));
  assert.ok(source.includes('assembly.lookupPrice('));
});

test('the barrel is a boundary only: no logic, no policy', () => {
  const source = stripComments(readSource('index.js'));
  for (const token of ['function ', 'if (', 'for (', 'await ', '=>']) {
    assert.ok(!source.includes(token), 'index.js must stay a boundary-only barrel: ' + token);
  }
});