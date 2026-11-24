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
const assembly = require('../../../src/recommendation/assembly');
const compute = require('../../../src/recommendation/orchestrator/compute');
const { CandidateSelectionError, ERROR_CODES } = require('../../../src/recommendation/candidates/errors');

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

// ---------------------------------------------------------------------------
// C3 fixtures — a VALID `commitSwap` call.
//
// Same ids, same persisted build and same Stage 1 carrier as
// `src/recommendation/orchestrator/swap-commit.test.js`, so the statement log
// C3 records below is a REAL swap commit (BEGIN-less, on the caller's handle)
// rather than a validation failure. The read half is stubbed through the
// documented namespace seam; only the write path reaches the recording client.
// ---------------------------------------------------------------------------

const swapUuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const swapVariantUuid = (n) => '00000000-0000-4000-9000-' + String(n).padStart(12, '0');

const SWAP_QUERY_ID = swapUuid(901);
const SWAP_RESULT_ID = swapUuid(904);
const SWAP_MODEL_ID = swapUuid(902);
const SWAP_STORE_ID = swapUuid(903);
const ALT_CPU_ID = swapUuid(11);
const GPU_VARIANT_ID = swapVariantUuid(1);

/** The persisted build's identity per role, in EXPANSION_ORDER. */
const SWAP_ROLE_IDS = Object.freeze({
  CPU: swapUuid(1),
  MOTHERBOARD: swapUuid(2),
  RAM: swapUuid(3),
  GPU: swapUuid(4),
  PSU: swapUuid(5),
  CASE: swapUuid(6),
  CPU_COOLER: swapUuid(7),
  SSD_BOOT: swapUuid(8),
});

/** Deliberately NOT the carrier's CPU price: the swap reprices ONE role only. */
const SWAP_PERSISTED_PRICES = Object.freeze({
  CPU: 1999,
  MOTHERBOARD: 1200,
  RAM: 700,
  GPU: 3200,
  PSU: 650,
  CASE: 900,
  CPU_COOLER: 350,
  SSD_BOOT: 800,
});
const SWAP_PERSISTED_TOTAL = 9799;
const SWAP_CANDIDATE_PRICE = 2400;

const SWAP_QUERY_INPUT = Object.freeze({
  query_id: SWAP_QUERY_ID,
  scoring_model_id: SWAP_MODEL_ID,
  input: Object.freeze({ budget_amount: 20000, currency: 'MAD', use_case: 'GAMING' }),
  priority: null,
  resolution: null,
});

/** One live Engine 2D verdict, in the shape `composeSwap` indexes by identity. */
function swapVerdict(role, productId, variantId, status) {
  return Object.freeze({
    product_id: productId,
    product_variant_id: variantId,
    category: candidates.expectedCategoryForRole(role),
    component_role: role,
    status,
    reason: null,
    relationships: Object.freeze({}),
    unknown_pairwise_count: 0,
    compatibility_notes: Object.freeze([]),
  });
}

/** The persisted build as the API reads it: identity AND the carrier columns. */
function swapPersistedBuild() {
  return Object.keys(SWAP_ROLE_IDS).map((role) => Object.freeze({
    role,
    product_id: SWAP_ROLE_IDS[role],
    product_variant_id: role === 'GPU' ? GPU_VARIANT_ID : null,
    selected_price: SWAP_PERSISTED_PRICES[role].toFixed(2),
    currency: 'MAD',
    store_id: SWAP_STORE_ID,
    price_checked_at: '2026-10-01T00:00:00.000Z',
    offer_class: 'SEED_UNVERIFIED',
    store_offer_id: swapUuid(500 + Object.keys(SWAP_ROLE_IDS).indexOf(role)),
  }));
}

/** The live 2C pool: every persisted identity, plus the CPU candidate. */
const SWAP_POOL = Object.keys(SWAP_ROLE_IDS).map((role) => ({
  component_role: role,
  product_id: SWAP_ROLE_IDS[role],
  product_variant_id: role === 'GPU' ? GPU_VARIANT_ID : null,
  category: candidates.expectedCategoryForRole(role),
})).concat([
  { component_role: 'CPU', product_id: ALT_CPU_ID, product_variant_id: null, category: 'CPU' },
]);

/** Stage 1's carrier, built by the REAL validator from fixed rows. */
function swapCarrier() {
  const rows = Object.keys(SWAP_ROLE_IDS).map((role) => ({
    component_role: role,
    product_id: SWAP_ROLE_IDS[role],
    product_variant_id: role === 'GPU' ? GPU_VARIANT_ID : null,
    selected_price: SWAP_PERSISTED_PRICES[role],
  }));
  rows.push({
    component_role: 'CPU',
    product_id: ALT_CPU_ID,
    product_variant_id: null,
    selected_price: SWAP_CANDIDATE_PRICE,
  });

  const raw = Object.create(null);
  for (const row of rows) {
    raw[assembly.priceKey(row.product_id, row.product_variant_id, row.component_role)] = {
      selected_price: row.selected_price,
      currency: 'MAD',
      store_id: SWAP_STORE_ID,
      price_checked_at: '2030-01-01T00:00:00.000Z',
      offer_id: swapUuid(600),
      offer_class: 'SEED_UNVERIFIED',
    };
  }
  return assembly.validatePrices(raw);
}

/** The read half `commitSwap` composes, stubbed at the namespace seam. */
function swapCompositionStubs() {
  const filteringContext = Object.freeze({ candidates: Object.freeze({}) });
  return [
    [query, 'loadQueryInput', async () => SWAP_QUERY_INPUT],
    [candidates, 'loadCandidates', async () => ({ input: SWAP_QUERY_INPUT.input, candidates: SWAP_POOL })],
    [candidates, 'selectCandidatePool', (input) => ({ input, pool: SWAP_POOL })],
    [offers, 'selectOfferPrices', () => ({
      input: SWAP_QUERY_INPUT.input,
      pool: SWAP_POOL,
      prices: swapCarrier(),
    })],
    [filtering, 'loadFilteringContext', async () => filteringContext],
    [filtering, 'filterCandidates', () => ({
      results: [
        swapVerdict('CPU', SWAP_ROLE_IDS.CPU, null, 'PASS'),
        swapVerdict('CPU', ALT_CPU_ID, null, 'PASS'),
        swapVerdict('MOTHERBOARD', SWAP_ROLE_IDS.MOTHERBOARD, null, 'PASS'),
        swapVerdict('RAM', SWAP_ROLE_IDS.RAM, null, 'PASS'),
        swapVerdict('GPU', SWAP_ROLE_IDS.GPU, GPU_VARIANT_ID, 'PASS'),
        swapVerdict('PSU', SWAP_ROLE_IDS.PSU, null, 'PASS'),
        swapVerdict('CASE', SWAP_ROLE_IDS.CASE, null, 'PASS'),
        swapVerdict('CPU_COOLER', SWAP_ROLE_IDS.CPU_COOLER, null, 'PASS'),
        swapVerdict('SSD_BOOT', SWAP_ROLE_IDS.SSD_BOOT, null, 'PASS'),
      ],
    })],
    [assembly, 'evaluateBuildReplacement', () => ({
      status: 'PASS',
      pairs: Object.freeze([]),
      unknown_pairwise_count: 0,
    })],
    [assembly, 'evaluateBuild', () => ({
      status: 'PASS',
      pairs: Object.freeze([]),
      unknown_pairwise_count: 2,
    })],
    [scoring, 'loadScoringModel', async () => ({ id: SWAP_MODEL_ID, configuration: Object.freeze({}) })],
    [scoring, 'loadComponentAssessments', async () => ({ assessments: Object.freeze({}), loaded_at: null })],
    [scoring, 'computeBuildScore', () => 74.256],
  ];
}

/** The VALID argument object: every field `commitSwap` documents as required. */
function swapCommitArgs(client) {
  return {
    db: client,
    queryId: SWAP_QUERY_ID,
    sourceResultId: SWAP_RESULT_ID,
    role: 'CPU',
    productId: ALT_CPU_ID,
    buildComponents: swapPersistedBuild(),
    persistedTotalPrice: SWAP_PERSISTED_TOTAL,
    catalogVersion: 'a'.repeat(32),
    engineVersion: 'test-deploy',
  };
}

/** A client that answers the write path, so a commit can actually complete. */
function swapWriteClient() {
  return createRecordingClient({
    onQuery(sql, params) {
      if (sql === NOW_SQL) return { rows: [{ now: new Date('2026-01-01T00:00:00.000Z') }] };
      if (sql === swapCommitModule.INSERT_BUILD_CANDIDATE_SQL) return { rows: [{ id: params[0] }] };
      if (sql === swapCommitModule.INSERT_RECOMMENDATION_SWAP_SQL) {
        return { rows: [{ created_at: new Date('2026-01-01T00:00:00.000Z') }] };
      }
      return undefined;
    },
  });
}

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
  const client = swapWriteClient();

  const result = await withStubs(
    swapCompositionStubs(),
    () => orchestrator.commitSwap(swapCommitArgs(client))
  );

  // The fixtures must carry the commit all the way through: a refusal here
  // would issue no statement and the invariants below would be vacuous.
  assert.equal(result.committed, true, 'the commit must succeed, not refuse');
  assert.equal(result.build.total_price, SWAP_PERSISTED_TOTAL - SWAP_PERSISTED_PRICES.CPU + SWAP_CANDIDATE_PRICE);

  const statements = statementsOf(client);
  assert.ok(statements.length > 0, 'the recorded statement log must be non-empty');
  assert.deepEqual(statements, [
    NOW_SQL,
    swapCommitModule.INSERT_BUILD_CANDIDATE_SQL,
    swapCommitModule.INSERT_BUILD_COMPONENT_SQL,
    swapCommitModule.INSERT_RECOMMENDATION_SWAP_SQL,
  ]);

  // No transaction control of its own: the caller owns BEGIN/COMMIT/ROLLBACK.
  assert.ok(issuesNoTransactionControl(client), 'commitSwap must not BEGIN, COMMIT or ROLLBACK');
  assert.deepEqual(transactionLog(client), []);
  for (const keyword of ['BEGIN', 'COMMIT', 'ROLLBACK']) {
    assert.ok(
      !statements.some((sql) => sql === keyword || sql.startsWith(keyword + ' ')),
      `commitSwap must never issue ${keyword}`
    );
  }
  assert.equal(maxOpenTransactions(client), 0);

  // One handle: every statement lands on the injected client, and its
  // lifecycle is untouched.
  assert.equal(new Set(client.calls.map((call) => call.receiver)).size, 1);
  assert.ok(client.calls.every((call) => call.receiver === client));
  assert.equal(client.lifecycle.connect, 0, 'no second connection is opened');
  assert.equal(client.lifecycle.release, 0, 'the caller owns the handle');
  assert.equal(client.lifecycle.end, 0);
  assert.equal(lifecycleCalls(client), 0);
});

test('C3: commitSwap refuses an incomplete argument object before any statement', async () => {
  // The validation-failure behaviour the old C3 case was accidentally pinning,
  // now pinned deliberately and named as such.
  const client = createRecordingClient();

  await assert.rejects(
    orchestrator.commitSwap({ db: client }),
    (error) => error instanceof CandidateSelectionError
      && error.code === ERROR_CODES.INVALID_INPUT
      && error.field === 'sourceResultId'
  );

  assert.deepEqual(statementsOf(client), [], 'validation precedes every statement');
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
