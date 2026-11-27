'use strict';

// packages/recommendation-runtime/test/orchestrator-index.test.js — the
// orchestrator namespace, batch `step-5-w3-orchestrator`.
//
// The eight entry points moved into this package with their bytes unchanged and
// an identity shim at the old path, so this file can prove what the batch
// claims by identity alone: the old path and the new path are the same object,
// the surface is exactly the eight entries of docs/ORCHESTRATOR_ENTRY_POINTS.md
// in that table's order, and every entry is the module's own function.
//
// `runRecommendationCommit` is deliberately absent: it is internal to
// ./commit.js (required directly by ./full-run.js), not one of the eight. A
// barrel that re-exported it would publish a write entry point the RFC §11.5
// table does not name.
//
// DB-free and dependency-free: loading the barrels issues no statement.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const orchestrator = require('../src/orchestrator');
const shim = require('../../../src/recommendation/orchestrator');

const run = require('../src/orchestrator/run');
const snapshot = require('../src/orchestrator/snapshot');
const fullRun = require('../src/orchestrator/full-run');
const swapPreview = require('../src/orchestrator/swap-preview');
const swapCommit = require('../src/orchestrator/swap-commit');

const EXPECTED = [
  'runRecommendation',
  'runRecommendationSnapshot',
  'runRecommendationFullRun',
  'evaluateSwapPreview',
  'evaluateSwapPreviewSnapshot',
  'commitSwap',
  'commitSwapInTransaction',
  'readCommittedSwap',
];

test('orchestrator: the old path is the same module as the new path', () => {
  assert.equal(shim, orchestrator);
});

test('orchestrator: publishes exactly the eight documented entry points, in order', () => {
  assert.deepEqual(Object.keys(orchestrator), EXPECTED);
});

test('orchestrator: every entry point is its module export, by identity', () => {
  const sources = {
    runRecommendation: run.runRecommendation,
    runRecommendationSnapshot: snapshot.runRecommendationSnapshot,
    runRecommendationFullRun: fullRun.runRecommendationFullRun,
    evaluateSwapPreview: swapPreview.evaluateSwapPreview,
    evaluateSwapPreviewSnapshot: swapPreview.evaluateSwapPreviewSnapshot,
    commitSwap: swapCommit.commitSwap,
    commitSwapInTransaction: swapCommit.commitSwapInTransaction,
    readCommittedSwap: swapCommit.readCommittedSwap,
  };
  for (const key of EXPECTED) {
    assert.equal(orchestrator[key], sources[key], key + ' is not its module export');
    assert.equal(shim[key], sources[key], key + ' differs through the old path');
    assert.equal(typeof orchestrator[key], 'function', key + ' must be a function');
  }
});

test('orchestrator: runRecommendationCommit stays internal', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(orchestrator, 'runRecommendationCommit'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(require('../src/orchestrator/commit'), 'runRecommendationCommit'),
    true,
    'the commit wrapper must still be reachable from its own module'
  );
});

// ---------------------------------------------------------------------------
// Source assertions carried over from src/recommendation/orchestrator/index.test.js
// (phase 5d). That file is the only one that pinned them, and step 6 deletes it
// together with the old path, so the package proves them against its own src/.
// `stripComments` is the lifecycle scanner's lexer, not a second stripper.
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./composite-lifecycle-scanner');

const IMPLEMENTATION_DIR = path.join(__dirname, '..', 'src', 'orchestrator');

const readSource = (file) => fs.readFileSync(path.join(IMPLEMENTATION_DIR, file), 'utf8');
const requiresOf = (file) => [...stripComments(readSource(file)).matchAll(/require\('([^']+)'\)/g)]
  .map((match) => match[1])
  .sort();

test('no orchestrator source writes, commits, or reaches for a driver', () => {
  const banned = [
    "require('pg')", "require('node:pg')", 'new Pool', 'new Client',
    'INSERT', 'UPDATE', 'DELETE', 'COMMIT', 'TRUNCATE', 'CREATE TABLE', 'ALTER TABLE',
    'DROP ',
  ];
  for (const file of ['index.js', 'run.js', 'snapshot.js', 'full-run.js', 'swap-preview.js']) {
    const source = stripComments(readSource(file));
    for (const token of banned) {
      assert.ok(!source.includes(token), file + ' must not contain ' + token);
    }
  }

  assert.equal(stripComments(readSource('run.js')).includes('BEGIN'), false);
  assert.equal(stripComments(readSource('index.js')).includes('BEGIN'), false);
  assert.equal(stripComments(readSource('full-run.js')).includes('BEGIN'), false);
  assert.ok(stripComments(readSource('swap-preview.js')).includes('BEGIN'));
  assert.ok(stripComments(readSource('snapshot.js')).includes('BEGIN'));

  const commitSource = stripComments(readSource('swap-commit.js'));
  assert.ok(commitSource.includes('INSERT'));
  assert.equal(commitSource.includes('UPDATE '), false, 'swap-commit.js must never UPDATE');
  assert.equal(commitSource.includes('DELETE'), false, 'swap-commit.js must never DELETE');
  assert.ok(commitSource.includes('BEGIN'));
});

test('orchestrator modules import exactly their collaborators', () => {
  assert.deepEqual(requiresOf('run.js'), [
    '../candidates',
    '../core-entry',
    '../filtering',
    '../offers',
    '../query',
    '../scoring',
    './compute',
  ]);
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
  assert.deepEqual(requiresOf('swap-preview.js'), [
    '../candidates',
    '../core-entry',
    '../filtering',
    '../offers',
    '../query',
  ]);
  assert.deepEqual(requiresOf('swap-commit.js'), [
    '../core-entry',
    '../scoring',
    './run',
    './swap-preview',
    'node:crypto',
  ]);
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
  assert.ok(source.includes('assembly.evaluateBuildReplacement('));
  assert.ok(source.includes('assembly.lookupPrice('));
});
