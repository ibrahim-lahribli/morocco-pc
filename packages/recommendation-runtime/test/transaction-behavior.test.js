'use strict';

// packages/recommendation-runtime/test/transaction-behavior.test.js — the
// orchestrator's BEHAVIOURAL transaction contract, pinned at its CURRENT legacy
// paths (`src/recommendation/orchestrator/`) through the public barrel.
//
// PR #67 is tests-only: no orchestrator module moves here. W3 (PR #68) moves the
// seven modules, and this file is the specification that move must keep — it
// calls the barrel exactly as a consumer does, over a recording fake client,
// with no database anywhere.
//
// What the existing per-module suites already pin (and this file therefore does
// NOT re-run):
//   snapshot.test.js      BEGIN/ROLLBACK, the full error matrix, failing BEGIN
//   commit.test.js        BEGIN, guards, writers, COMMIT, the full error matrix
//   swap-commit.test.js   commitSwapInTransaction's boundary, failing BEGIN/COMMIT
//   swap-preview.test.js  the preview snapshot wrapper, always ROLLBACK
//   run.test.js           statement order, the transaction timestamp, asOf
//   full-run.test.js      stage order, pass facts, zero-build/zero-selected
//
// What only this file measures — the cross-module handoff requirements:
//   C1  the snapshot entry point: READ ONLY open, ROLLBACK always, never COMMIT
//   C2  the commit entry point: exact BEGIN, writes, COMMIT; ROLLBACK on any
//       thrown write error with no COMMIT, original error propagating
//   C3  the swap pair: commitSwapInTransaction owns its commit boundary,
//       evaluateSwapPreview opens no committing transaction
//   C4  run.js owns no transaction: no BEGIN/COMMIT/ROLLBACK is issued by it
//   C5  full-run and the preview never nest: at most ONE transaction open at a
//       time across the whole recorded statement log
//   C6  one client: every statement is issued on the same injected object
//   C7  release semantics: the orchestrator never releases, ends or reconnects
//       the client it was given — the caller owns it (pinned, not "fixed")
//
// Determinism: no clock read (the fake timestamp is a fixed Date), no
// randomness asserted, no I/O beyond the injected client.
//
//   node --test packages/recommendation-runtime/test/transaction-behavior.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');

// The surface W3 moves: the barrel at its legacy path, plus the collaborator
// namespaces the composition calls through (the documented stub seam).
const orchestrator = require('../../../src/recommendation/orchestrator');
const runModule = require('../../../src/recommendation/orchestrator/run');
const commitModule = require('../../../src/recommendation/orchestrator/commit');
const snapshotModule = require('../../../src/recommendation/orchestrator/snapshot');
const swapPreviewModule = require('../../../src/recommendation/orchestrator/swap-preview');
const swapCommitModule = require('../../../src/recommendation/orchestrator/swap-commit');
const ranking = require('../../../src/recommendation/ranking');
const explanation = require('../../../src/recommendation/explanation');
const query = require('../../../src/recommendation/query');
const candidates = require('../../../src/recommendation/candidates');
const offers = require('../../../src/recommendation/offers');
const filtering = require('../../../src/recommendation/filtering');
const scoring = require('../../../src/recommendation/scoring');
const compute = require('../../../src/recommendation/orchestrator/compute');
const { CandidateSelectionError } = require('../../../src/recommendation/candidates/errors');

const {
  createRecordingClient,
  statementsOf,
  transactionLog,
  maxOpenTransactions,
  issuesNoTransactionControl,
} = require('./recording-client');

const READ_ONLY_BEGIN = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const PLAIN_BEGIN = 'BEGIN';
const COMMIT = 'COMMIT';
const ROLLBACK = 'ROLLBACK';

const LOCK_RECOMMENDATION_QUERY_SQL =
  'SELECT id FROM recommendation_query WHERE id = $1 FOR UPDATE';
const EXISTING_BUILD_CANDIDATES_SQL =
  'SELECT 1 FROM build_candidate WHERE recommendation_query_id = $1 LIMIT 1';
const NOW_SQL = 'SELECT CURRENT_TIMESTAMP AS now';

const QUERY_ID = '00000000-0000-4000-8000-000000000b01';

/** One entry validateSelected accepts: the minimum a real persist pass writes. */
const PERSISTED_PRICE = Object.freeze({
  selected_price: 1200,
  currency: 'MAD',
  store_id: null,
  price_checked_at: null,
  offer_id: '11111111-1111-4111-8111-111111111111',
  offer_class: 'SEED_UNVERIFIED',
});

const SELECTED = Object.freeze([
  Object.freeze({
    persisted_rank: 1,
    total_price: 1200,
    build_score: 55,
    compatibility_status: 'PASS',
    explanation: 'rank 1',
    build: Object.freeze({
      components: Object.freeze([
        Object.freeze({
          product_id: 'gpu-1',
          component_role: 'GPU',
          status: 'PASS',
          price: PERSISTED_PRICE,
        }),
      ]),
    }),
  }),
]);

/** The snapshot result full-run consumes, shaped exactly as run.js returns it. */
const SNAP = Object.freeze({
  query_id: QUERY_ID,
  scoring_model_id: '30000000-0000-4000-8000-000000000001',
  builds: Object.freeze([]),
  budget_amount: 10000,
  currency: 'MAD',
  priority: 'PERFORMANCE',
  archetype_objectives: null,
  build_contributions: Object.freeze([]),
  budget_floor: Object.freeze({ cheapest_total: 9000, currency: 'MAD', within_budget: true }),
  filter_verdicts: Object.freeze([]),
});

/**
 * Replace properties on collaborator namespaces for the duration of `body`.
 * This is the seam the modules themselves document (they call through their
 * namespace objects, never destructured), and every stub is restored even when
 * the body throws.
 */
async function withStubs(stubs, body) {
  const saved = stubs.map(([target, key]) => [target, key, target[key]]);
  try {
    for (const [target, key, value] of stubs) target[key] = value;
    return await body();
  } finally {
    for (const [target, key, value] of saved) target[key] = value;
  }
}

/** A client whose guards say "the query row exists and has no candidates". */
function guardedClient(onQuery) {
  return createRecordingClient({
    onQuery(sql, params, callNumber) {
      if (sql === LOCK_RECOMMENDATION_QUERY_SQL) return { rows: [{ id: QUERY_ID }] };
      if (sql === EXISTING_BUILD_CANDIDATES_SQL) return { rows: [] };
      if (typeof onQuery === 'function') return onQuery(sql, params, callNumber);
      return undefined;
    },
  });
}

const lifecycleCalls = (client) =>
  client.lifecycle.release + client.lifecycle.end + client.lifecycle.connect;

// ---------------------------------------------------------------------------
// 0. The statements this suite pins are the modules' own constants.
// ---------------------------------------------------------------------------

test('the pinned transaction statements are the modules\' exact constants', () => {
  assert.equal(snapshotModule.BEGIN_SQL, READ_ONLY_BEGIN);
  assert.equal(snapshotModule.ROLLBACK_SQL, ROLLBACK);
  assert.equal(swapPreviewModule.BEGIN_SQL, READ_ONLY_BEGIN);
  assert.equal(swapPreviewModule.ROLLBACK_SQL, ROLLBACK);
  assert.equal(commitModule.BEGIN_SQL, PLAIN_BEGIN);
  assert.equal(commitModule.COMMIT_SQL, COMMIT);
  assert.equal(commitModule.ROLLBACK_SQL, ROLLBACK);
  assert.equal(commitModule.LOCK_RECOMMENDATION_QUERY_SQL, LOCK_RECOMMENDATION_QUERY_SQL);
  assert.equal(commitModule.EXISTING_BUILD_CANDIDATES_SQL, EXISTING_BUILD_CANDIDATES_SQL);
  assert.equal(swapCommitModule.BEGIN_SQL, PLAIN_BEGIN);
  assert.equal(swapCommitModule.COMMIT_SQL, COMMIT);
  assert.equal(swapCommitModule.ROLLBACK_SQL, ROLLBACK);
  assert.equal(runModule.SELECT_NOW_SQL, NOW_SQL);
});

// ---------------------------------------------------------------------------
// C1 — the snapshot entry point: READ ONLY, ROLLBACK on both paths, no COMMIT.
// ---------------------------------------------------------------------------

test('C1: runRecommendationSnapshot opens READ ONLY, runs the pass, then ROLLBACK - never COMMIT', async () => {
  const client = createRecordingClient();
  const result = await withStubs(
    [[runModule, 'runRecommendation', async () => SNAP]],
    () => orchestrator.runRecommendationSnapshot(client, QUERY_ID)
  );

  assert.equal(result, SNAP);
  assert.deepEqual(statementsOf(client), [READ_ONLY_BEGIN, ROLLBACK]);
  assert.equal(maxOpenTransactions(client), 1);
  assert.ok(!statementsOf(client).includes(COMMIT), 'the read pass must never commit');
  assert.equal(lifecycleCalls(client), 0);
});

test('C1: a thrown error inside the snapshot still ends with ROLLBACK and propagates unchanged', async () => {
  const client = createRecordingClient();
  const sentinel = Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });

  await assert.rejects(
    withStubs(
      [[runModule, 'runRecommendation', async () => { throw sentinel; }]],
      () => orchestrator.runRecommendationSnapshot(client, QUERY_ID)
    ),
    (error) => error === sentinel
  );

  assert.deepEqual(statementsOf(client), [READ_ONLY_BEGIN, ROLLBACK]);
  assert.ok(!statementsOf(client).includes(COMMIT));
  assert.equal(lifecycleCalls(client), 0);
});

// ---------------------------------------------------------------------------
// C2 — the commit entry point: BEGIN, writes, COMMIT; ROLLBACK on error.
// ---------------------------------------------------------------------------

test('C2: the commit entry point runs BEGIN, both guards, the writes, then COMMIT', async () => {
  const client = guardedClient();

  // runRecommendationCommit is INTERNAL to the pass: the barrel publishes the
  // eight entry points, and this wrapper is reached at its own legacy path.
  await commitModule.runRecommendationCommit(client, QUERY_ID, SELECTED);

  const statements = statementsOf(client);
  assert.equal(statements[0], PLAIN_BEGIN);
  assert.equal(statements[1], LOCK_RECOMMENDATION_QUERY_SQL);
  assert.equal(statements[2], EXISTING_BUILD_CANDIDATES_SQL);

  const commitIndex = statements.indexOf(COMMIT);
  assert.equal(commitIndex, statements.length - 1, 'COMMIT must be the last statement');
  const writes = statements.slice(3, commitIndex);
  assert.equal(writes.length, 3, 'one INSERT per table for a single-build pass');
  for (const sql of writes) {
    assert.match(sql, /^INSERT INTO (build_candidate|build_component|recommendation_result) /);
  }
  assert.deepEqual(transactionLog(client).map((call) => call.sql), [PLAIN_BEGIN, COMMIT]);
  assert.equal(maxOpenTransactions(client), 1);
  assert.equal(lifecycleCalls(client), 0);
});

test('C2: a zero-build pass still opens and commits the transaction, with no INSERT', async () => {
  const client = guardedClient();

  await commitModule.runRecommendationCommit(client, QUERY_ID, []);

  assert.deepEqual(statementsOf(client), [
    PLAIN_BEGIN,
    LOCK_RECOMMENDATION_QUERY_SQL,
    EXISTING_BUILD_CANDIDATES_SQL,
    COMMIT,
  ]);
  assert.equal(lifecycleCalls(client), 0);
});

test('C2: a write step that throws rolls back, never commits, and the original error propagates', async () => {
  const client = guardedClient();

  await assert.rejects(
    commitModule.runRecommendationCommit(client, QUERY_ID, 'not-an-array'),
    (error) => error instanceof CandidateSelectionError
      && error.code === 'INVALID_INPUT'
      && error.field === 'selected'
  );

  const statements = statementsOf(client);
  assert.ok(!statements.includes(COMMIT), 'a failed write must never commit');
  assert.equal(statements[statements.length - 1], ROLLBACK);
  assert.deepEqual(transactionLog(client).map((call) => call.sql), [PLAIN_BEGIN, ROLLBACK]);
  assert.equal(lifecycleCalls(client), 0);
});

test('C2: a failing COMMIT rolls back, and the commit error wins over a failing ROLLBACK', async () => {
  const commitError = new Error('commit failed');
  const rollbackError = new Error('rollback failed');
  const client = guardedClient((sql) => {
    if (sql === COMMIT) throw commitError;
    if (sql === ROLLBACK) throw rollbackError;
    return undefined;
  });

  await assert.rejects(
    commitModule.runRecommendationCommit(client, QUERY_ID, []),
    (error) => error === commitError
  );

  const statements = statementsOf(client);
  assert.equal(statements.filter((sql) => sql === COMMIT).length, 1);
  assert.equal(statements[statements.length - 1], ROLLBACK);
  assert.ok(!statements.slice(0, -1).includes(ROLLBACK));
  assert.equal(lifecycleCalls(client), 0);
});

// ---------------------------------------------------------------------------
// C3 — the swap pair: the commit own its boundary, the preview never commits.
// ---------------------------------------------------------------------------

test('C3: commitSwapInTransaction opens and rolls back its own boundary, and never commits a failure', async () => {
  const client = createRecordingClient();

  await assert.rejects(
    orchestrator.commitSwapInTransaction(client, {}),
    (error) => error instanceof Error
  );

  assert.deepEqual(statementsOf(client), [PLAIN_BEGIN, ROLLBACK]);
  assert.ok(!statementsOf(client).includes(COMMIT));
  assert.equal(maxOpenTransactions(client), 1);
  assert.equal(lifecycleCalls(client), 0);
});

test('C3: commitSwap itself owns no transaction control - it runs on the caller\'s handle', async () => {
  const client = createRecordingClient();

  await assert.rejects(
    orchestrator.commitSwap(Object.assign({}, {}, { db: client })),
    (error) => error instanceof Error
  );

  assert.ok(issuesNoTransactionControl(client), 'commitSwap must not BEGIN, COMMIT or ROLLBACK');
  assert.equal(lifecycleCalls(client), 0);
});

test('C3: evaluateSwapPreview issues statements but no committing transaction', async () => {
  const client = createRecordingClient();
  const probeError = new Error('probe stop');

  await assert.rejects(
    withStubs(
      [[query, 'loadQueryInput', async (queryId, db) => {
        await db.query('SELECT 1 AS probe');
        throw probeError;
      }]],
      () => orchestrator.evaluateSwapPreview({
        db: client,
        queryId: QUERY_ID,
        role: 'GPU',
        productId: 'gpu-9',
        buildComponents: [{ role: 'GPU', product_id: 'gpu-1', product_variant_id: null }],
      })
    ),
    (error) => error === probeError
  );

  assert.deepEqual(statementsOf(client), ['SELECT 1 AS probe']);
  assert.ok(issuesNoTransactionControl(client), 'the preview must not own a transaction');
  assert.equal(lifecycleCalls(client), 0);
});

test('C3: evaluateSwapPreviewSnapshot opens READ ONLY and always rolls back, never commits', async () => {
  const client = createRecordingClient();

  await assert.rejects(
    orchestrator.evaluateSwapPreviewSnapshot(client, {}),
    (error) => error instanceof Error
  );

  assert.deepEqual(statementsOf(client), [READ_ONLY_BEGIN, ROLLBACK]);
  assert.ok(!statementsOf(client).includes(COMMIT));
  assert.equal(lifecycleCalls(client), 0);
});

// ---------------------------------------------------------------------------
// C4 — run.js owns no transaction: exactly one autocommit statement.
// ---------------------------------------------------------------------------

test('C4: a run issues exactly one statement - the transaction timestamp - and no transaction control', async () => {
  const client = createRecordingClient({
    onQuery(sql) {
      if (sql === NOW_SQL) return { rows: [{ now: new Date('2026-01-01T00:00:00.000Z') }] };
      return undefined;
    },
  });

  const computed = Object.freeze({ query_id: QUERY_ID, builds: Object.freeze([]) });

  const result = await withStubs(
    [
      [query, 'loadQueryInput', async () => ({ scoring_model_id: 'sm-1', input: {} })],
      [scoring, 'loadScoringModel', async () => ({ configuration: {} })],
      [candidates, 'loadCandidates', async () => ({ input: {}, candidates: [] })],
      [candidates, 'selectCandidatePool', () => ({ pool: [] })],
      [offers, 'selectOfferPrices', async () => ({ pool: [] })],
      [filtering, 'loadFilteringContext', async () => ({})],
      [filtering, 'filterCandidates', () => ({ results: [] })],
      [scoring, 'loadComponentAssessments', async () => ({ assessments: [] })],
      [compute, 'computeFromLoaded', () => computed],
    ],
    () => orchestrator.runRecommendation({ db: client, queryId: QUERY_ID })
  );

  assert.equal(result, computed);
  assert.deepEqual(statementsOf(client), [NOW_SQL]);
  assert.ok(issuesNoTransactionControl(client), 'run.js must never open, commit or roll back');
  assert.equal(lifecycleCalls(client), 0);
});

// ---------------------------------------------------------------------------
// C5 — no nesting: at most one transaction open at any time.
// ---------------------------------------------------------------------------

test('C5: a full run composes the read transaction and the write transaction sequentially', async () => {
  const client = guardedClient();

  const result = await withStubs(
    [
      [runModule, 'runRecommendation', async () => SNAP],
      [ranking, 'rankBuilds', () => ({ ranked: Object.freeze([]), top_n: Object.freeze([]) })],
      [ranking, 'selectArchetypes', () => ({
        archetypes: Object.freeze([]),
        reason_codes: Object.freeze([]),
      })],
      [explanation, 'explainSelection', () => Object.freeze([])],
    ],
    () => orchestrator.runRecommendationFullRun(client, QUERY_ID, {})
  );

  assert.equal(result.query_id, QUERY_ID);
  assert.equal(maxOpenTransactions(client), 1, 'the two transactions must never overlap');

  const transactions = transactionLog(client);
  assert.deepEqual(
    transactions.map((call) => call.sql),
    [READ_ONLY_BEGIN, ROLLBACK, PLAIN_BEGIN, COMMIT]
  );
  assert.ok(
    transactions[1].index < transactions[2].index,
    'the snapshot must be closed before the write transaction opens'
  );

  // The write pass ran on the same session, after the read pass closed.
  const statements = statementsOf(client);
  assert.equal(statements[statements.length - 1], COMMIT);
  assert.ok(statements.indexOf(LOCK_RECOMMENDATION_QUERY_SQL) > transactions[2].index);
  assert.equal(lifecycleCalls(client), 0);
});

test('C5: the preview snapshot never nests either - one open transaction at a time', async () => {
  const client = createRecordingClient();

  await assert.rejects(
    orchestrator.evaluateSwapPreviewSnapshot(client, {}),
    (error) => error instanceof Error
  );

  assert.equal(maxOpenTransactions(client), 1);
  assert.deepEqual(transactionLog(client).map((call) => call.sql), [READ_ONLY_BEGIN, ROLLBACK]);
});

// ---------------------------------------------------------------------------
// C6 — one client: every statement lands on the injected object.
// ---------------------------------------------------------------------------

test('C6: every statement of a full run is issued on the same injected client', async () => {
  const client = guardedClient();

  await withStubs(
    [
      [runModule, 'runRecommendation', async () => SNAP],
      [ranking, 'rankBuilds', () => ({ ranked: Object.freeze([]), top_n: Object.freeze([]) })],
      [ranking, 'selectArchetypes', () => ({
        archetypes: Object.freeze([]),
        reason_codes: Object.freeze([]),
      })],
      [explanation, 'explainSelection', () => Object.freeze([])],
    ],
    () => orchestrator.runRecommendationFullRun(client, QUERY_ID, {})
  );

  assert.ok(client.calls.length >= 6, 'a full run must issue the read, guards, facts and commit');
  assert.equal(new Set(client.calls.map((call) => call.receiver)).size, 1);
  assert.ok(client.calls.every((call) => call.receiver === client));
  assert.equal(client.lifecycle.connect, 0, 'no second connection is opened');
});

// ---------------------------------------------------------------------------
// C7 — release semantics: the caller owns the client; the orchestrator never
// touches its lifecycle. This pins CURRENT behaviour, it does not endorse a
// different one.
// ---------------------------------------------------------------------------

test('C7: no entry point releases, ends or reconnects the client it is handed, even on errors', async () => {
  const readClient = createRecordingClient();
  await assert.rejects(
    withStubs(
      [[runModule, 'runRecommendation', async () => { throw new Error('pass failed'); }]],
      () => orchestrator.runRecommendationSnapshot(readClient, QUERY_ID)
    ),
    /pass failed/
  );
  assert.equal(readClient.lifecycle.release, 0);
  assert.equal(readClient.lifecycle.end, 0);

  const writeClient = createRecordingClient();
  await assert.rejects(
    commitModule.runRecommendationCommit(writeClient, QUERY_ID, 'not-an-array'),
    (error) => error instanceof CandidateSelectionError
  );
  assert.equal(writeClient.lifecycle.release, 0);
  assert.equal(writeClient.lifecycle.end, 0);

  const swapClient = createRecordingClient();
  await assert.rejects(orchestrator.commitSwapInTransaction(swapClient, {}), (error) => error instanceof Error);
  assert.equal(swapClient.lifecycle.release, 0);
  assert.equal(swapClient.lifecycle.end, 0);

  const previewClient = createRecordingClient();
  await assert.rejects(orchestrator.evaluateSwapPreviewSnapshot(previewClient, {}), (error) => error instanceof Error);
  assert.equal(previewClient.lifecycle.release, 0);
  assert.equal(previewClient.lifecycle.end, 0);
});
