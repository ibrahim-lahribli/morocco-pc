'use strict';

// packages/recommendation-runtime/test/filtering-pipeline.test.js — the Engine
// 2D filtering composition now lives in this package, batch
// `step-5-w1-final-loaders`.
//
// What it proves, and why each point is here rather than in the L1 suite that
// stayed at the old path (src/recommendation/filtering/pipeline.test.js):
//   1. the module is loadable from its NEW path and exports exactly
//      `filterCandidatesForRecommendation`;
//   2. the old path is the SAME module by identity;
//   3. it calls the filtering-context loader ONCE and nothing else: the recorded
//      statement sequence is byte-for-byte the sequence the loader alone issues
//      for the same candidate pool (so the composition invents no query, skips
//      none and reorders none);
//   4. every statement is issued on the EXACT client object the caller passed
//      in — the composition never wraps, clones or replaces it;
//   5. the pure filter runs AFTER the last statement and issues no query of its
//      own: the result is `filterCandidates(context)` on the loaded context,
//      frozen, with PASS / UNKNOWN / REJECT preserved.
//
// Correction of the batch brief, recorded here on purpose: this module does NOT
// call the candidate loader. It receives an already-loaded Engine 2C result
// `{ input, pool }`, so the candidates-then-context ordering belongs to
// orchestrator/run.js (pinned in src/recommendation/orchestrator/run.test.js),
// not to this file. What is pinned here is the ordering the module actually
// owns: context load, then filter.
//
// DB-free: statements are issued against a recording fake client that returns
// no rows. No database, no environment, no clock.
//
//   npm run test:runtime        (from the repo root)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const pipeline = require('../src/filtering/pipeline');
const { loadFilteringContext } = require('../src/filtering/context-loader');
const core = require('../../recommendation-core');
const shim = require('../../../src/recommendation/filtering/pipeline');

const CPU_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MB_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** The Engine 2C result, in a shape the context loader validates. */
function candidatePool() {
  return {
    input: {
      budget_amount: 8000,
      currency: 'MAD',
      use_case: 'GAMING',
      required_roles: ['CPU', 'MOTHERBOARD'],
    },
    pool: [
      { component_role: 'CPU', category: 'CPU', product_id: CPU_ID, product_variant_id: null },
      { component_role: 'MOTHERBOARD', category: 'MOTHERBOARD', product_id: MB_ID, product_variant_id: null },
    ],
  };
}

/**
 * A client that records every statement and returns no rows. The receiver is
 * recorded too, so identity of the passed-through client is observable.
 */
function recordingClient() {
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({ sql: String(sql), params, receiver: this });
      return { rows: [] };
    },
  };
  return { client, statements };
}

test('filtering pipeline: new path is loadable and the old path is the same module', () => {
  assert.deepEqual(Object.keys(pipeline), ['filterCandidatesForRecommendation']);
  assert.equal(typeof pipeline.filterCandidatesForRecommendation, 'function');
  assert.equal(shim, pipeline);
  assert.equal(shim.filterCandidatesForRecommendation, pipeline.filterCandidatesForRecommendation);
});

test('filtering pipeline: every statement is issued on the exact client passed in', async () => {
  const { client, statements } = recordingClient();
  await pipeline.filterCandidatesForRecommendation(candidatePool(), client);

  assert.ok(statements.length > 0, 'the context loader must issue statements');
  for (const statement of statements) {
    assert.equal(statement.receiver, client, 'a query was issued on a client other than the caller-supplied one');
  }
});

test('filtering pipeline: the statement sequence is the loader alone, then the pure filter', async () => {
  const composed = recordingClient();
  const result = await pipeline.filterCandidatesForRecommendation(candidatePool(), composed.client);

  const loaderOnly = recordingClient();
  const context = await loadFilteringContext(candidatePool(), loaderOnly.client);

  assert.deepEqual(
    composed.statements.map((statement) => statement.sql),
    loaderOnly.statements.map((statement) => statement.sql),
    'the composition must not add, drop or reorder a loader statement'
  );
  assert.deepEqual(
    composed.statements.map((statement) => statement.params),
    loaderOnly.statements.map((statement) => statement.params),
    'every loader statement must keep its parameter array'
  );

  // The filter is pure: it issues no statement of its own.
  assert.equal(composed.statements.length, loaderOnly.statements.length);

  // And the result IS the pure filter applied to that context.
  const expected = core.filtering.filterCandidates(context);
  assert.deepEqual(result, expected);
  assert.deepEqual(Object.keys(result), ['results']);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.results));
});

test('filtering pipeline: the same pool yields the same result on every run', async () => {
  const first = await pipeline.filterCandidatesForRecommendation(candidatePool(), recordingClient().client);
  const second = await pipeline.filterCandidatesForRecommendation(candidatePool(), recordingClient().client);
  assert.deepEqual(second, first);
});
