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
