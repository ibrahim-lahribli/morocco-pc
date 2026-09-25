'use strict';

// scripts/test-orchestrator-commit.js - Decision 19.1 / 19.2 real-database test.
//
// Purpose: prove the commit wrapper (src/recommendation/orchestrator/commit.js)
// against a real PostgreSQL database - the parts a fake client cannot prove: a
// committed pass is really visible on ANOTHER session, a writer error really
// persists nothing, and the re-run guard really refuses a second attempt.
//
// Safety contract (mirrors scripts/lib/db-url.js and
// scripts/measure-orchestrator.js):
//   * Target is TEST_DATABASE_URL only. getWriteTestDbUrl() throws unless
//     TEST_DATABASE_URL is set, DATABASE_URL is set, and the two hosts differ
//     (pooled vs direct counts as the same endpoint). The shared DATABASE_URL
//     is never contacted.
//   * Only the HOST of TEST_DATABASE_URL is printed - never credentials, user,
//     port or path.
//   * Pattern: measure-orchestrator.js's ISOLATED-WRITE pattern, deliberately
//     NOT scripts/test-layer4.js's outer BEGIN. The wrapper under test issues
//     BEGIN/COMMIT on the same session, so nesting it inside an outer test
//     transaction would make the wrapper's COMMIT end the OUTER transaction
//     (defeating the outer ROLLBACK safety net) and no commit could ever be
//     observed. Every row this script creates is therefore committed on
//     purpose and deleted by captured id in a finally block, in reverse
//     dependency order.
//   * Cleanup is idempotent and by captured id only. If the script dies between
//     a write and the cleanup, the next run prints the leftover ids for a human
//     decision; it never deletes rows it did not create.
//   * Only recommendation_query rows this run inserted (random UUIDs it
//     generated) and their dependents are ever touched.
//
// Run: node scripts/test-orchestrator-commit.js
// Deliberately NOT named *.test.js: `npm run test:unit` globs src/**/*.test.js,
// so no generic runner ever discovers a test that writes to a database.

require('dotenv').config();
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

const { getWriteTestDbUrl } = require('./lib/db-url');
const { runRecommendationCommit } = require('../src/recommendation/orchestrator/commit');
const { ERROR_CODES, CandidateSelectionError } = require('../src/recommendation/candidates/errors');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('PASS: ' + message);
    passed++;
  } else {
    console.log('FAIL: ' + message);
    failed++;
  }
}

function describe(error) {
  if (!error) return 'no error';
  return (error && error.code ? error.code + ' ' : '') + (error ? error.message : String(error));
}

/** Run fn, require it to throw, then require the predicate on the error. */
async function rejectsWith(fn, predicate, expected, label) {
  let error = null;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  if (error === null) {
    assert(false, label + ' (nothing was thrown; expected ' + expected + ')');
    return null;
  }
  assert(predicate(error), label + ' [' + describe(error) + ']');
  return error;
}

/** The wrapper's fail-fast refusal contract: INVALID_INPUT on field query_id. */
const isGuardRefusal = (error) => error instanceof CandidateSelectionError
  && error.code === ERROR_CODES.INVALID_INPUT
  && error.field === 'query_id';

/** Hostname only - never credentials, user, port or path. */
const hostOf = (connectionString) => new URL(connectionString).hostname;

async function scalar(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0];
}

/** Row counts this wrapper owns, for one query, in one statement. */
async function countsForQuery(client, queryId) {
  return scalar(
    client,
    'SELECT (SELECT count(*)::int FROM build_candidate WHERE recommendation_query_id = $1) AS candidates,'
      + ' (SELECT count(*)::int FROM recommendation_result WHERE recommendation_query_id = $1) AS results,'
      + ' (SELECT count(*)::int FROM build_component c JOIN build_candidate b ON b.id = c.build_candidate_id'
      + '   WHERE b.recommendation_query_id = $1) AS components',
    [queryId]
  );
}

/** The same counts for a set of ids (cleanup verification). */
async function countsForQueries(client, queryIds) {
  return scalar(
    client,
    'SELECT (SELECT count(*)::int FROM recommendation_query WHERE id = ANY($1::uuid[])) AS queries,'
      + ' (SELECT count(*)::int FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])) AS candidates,'
      + ' (SELECT count(*)::int FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])) AS results,'
      + ' (SELECT count(*)::int FROM build_component c JOIN build_candidate b ON b.id = c.build_candidate_id'
      + '   WHERE b.recommendation_query_id = ANY($1::uuid[])) AS components',
    [queryIds]
  );
}


/** One synthetic component: real product_id (FK), no store snapshot. */
function makeComponent(role, productId, price, status) {
  return {
    component_role: role,
    product_id: productId,
    product_variant_id: null,
    category: 'IGNORED-CATEGORY',
    status: status || 'PASS',
    // store_id null + price_checked_at null: the store/price mapping is pinned
    // by persistence/persist-ranked.test.js; these fixtures exist to prove
    // transaction semantics, so their preconditions stay minimal.
    price: { selected_price: price, currency: 'MAD', store_id: null, price_checked_at: null },
  };
}

/** One ranked entry, shaped as the Decision 18/20 `selected` contract. */
function makeEntry(rank, components) {
  const total = components.reduce((sum, component) => sum + component.price.selected_price, 0);
  return {
    persisted_rank: rank,
    build_score: 85.5 - rank,
    total_price: total,
    compatibility_status: rank === 1 ? 'PASS' : 'UNKNOWN',
    signature: 'test-orchestrator-commit-' + rank,
    explanation: 'Ranked ' + rank + ': commit test explanation',
    build: { currency: 'MAD', components },
  };
}

/** One harness-owned recommendation_query row (profile FK left NULL). */
async function insertQuery(client, scoringModelId) {
  const id = randomUUID();
  await client.query(
    'INSERT INTO recommendation_query'
      + ' (id, recommendation_profile_id, scoring_model_id, budget_amount, currency, use_case)'
      + ' VALUES ($1, NULL, $2, $3, $4, $5)',
    [id, scoringModelId, 15000, 'MAD', 'GAMING']
  );
  return id;
}

/** Reverse-dependency cleanup of exactly the ids this run created. */
async function cleanup(client, queryIds) {
  if (queryIds.length === 0) return;
  await client.query(
    'DELETE FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])',
    [queryIds]
  );
  await client.query(
    'DELETE FROM build_component WHERE build_candidate_id IN'
      + ' (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))',
    [queryIds]
  );
  await client.query(
    'DELETE FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])',
    [queryIds]
  );
  await client.query('DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])', [queryIds]);
}

/**
 * Read-only preflight. Aborts (before any write) unless the test branch can
 * satisfy the fixtures: at least two products (component FKs) and one
 * scoring_model row (query FK). Nothing is created or changed here.
 */
async function preflight(client) {
  const products = await client.query('SELECT id FROM product ORDER BY id LIMIT 4');
  const model = await client.query(
    'SELECT id, name, version FROM scoring_model ORDER BY name, version LIMIT 1'
  );
  const observed = await scalar(
    client,
    'SELECT (SELECT count(*)::int FROM recommendation_query) AS queries,'
      + ' (SELECT count(*)::int FROM build_candidate) AS candidates,'
      + ' (SELECT count(*)::int FROM build_component) AS components,'
      + ' (SELECT count(*)::int FROM recommendation_result) AS results'
  );

  if (products.rows.length < 2) {
    throw new Error('PREFLIGHT FAILED (no write was performed): fewer than 2 product rows exist'
      + ' on the test branch - reset it from its parent and run the seeds first');
  }
  if (model.rows.length === 0) {
    throw new Error('PREFLIGHT FAILED (no write was performed): no scoring_model row exists'
      + ' on the test branch - reset it from its parent and run the seeds first');
  }

  return {
    productIds: products.rows.map((row) => row.id),
    scoringModelId: model.rows[0].id,
    modelLabel: model.rows[0].name + ' ' + model.rows[0].version,
    observed,
  };
}

// ---------------------------------------------------------------------------
// 1. Successful commit: the rows land and are visible on ANOTHER session.
// ---------------------------------------------------------------------------

async function testSuccessfulCommit(client, other, ctx, createdIds) {
  console.log('\n--- 1. successful commit (committed rows visible on a second connection) ---');
  const queryId = await insertQuery(client, ctx.scoringModelId);
  createdIds.push(queryId);

  const [cpu, motherboard, ram] = ctx.productIds;
  const selected = [
    makeEntry(1, [makeComponent('CPU', cpu, 1000), makeComponent('MOTHERBOARD', motherboard, 1500)]),
    makeEntry(2, [makeComponent('CPU', cpu, 1000), makeComponent('RAM', ram, 800)]),
  ];

  const result = await runRecommendationCommit(client, queryId, selected);
  assert(result.query_id === queryId, 'the writer result echoes the pinned query id');
  assert(Object.isFrozen(result) && Object.isFrozen(result.build_candidate_ids)
    && Object.isFrozen(result.recommendation_result_ids),
  'the writer result is frozen (Decision 19 contract)');
  assert(JSON.stringify(result.persisted_ranks) === '[1,2]',
    'persisted_ranks = [1,2] (' + JSON.stringify(result.persisted_ranks) + ')');

  const counted = await countsForQuery(other, queryId);
  assert(counted.candidates === 2 && counted.results === 2 && counted.components === 4,
    'a second connection sees the committed rows: ' + JSON.stringify(counted));

  const rows = (await other.query(
    'SELECT b.id, b.total_price::text AS total, b.compatibility_status::text AS status, r.rank'
      + ' FROM build_candidate b JOIN recommendation_result r ON r.build_candidate_id = b.id'
      + ' WHERE b.recommendation_query_id = $1 ORDER BY r.rank',
    [queryId]
  )).rows;
  assert(rows.length === 2 && rows[0].rank === 1 && rows[1].rank === 2,
    'both candidates join their recommendation_result row at ranks 1 and 2');
  assert(rows.length === 2 && Number(rows[0].total) === 2500 && rows[0].status === 'PASS',
    'rank 1 persisted total_price 2500 / status PASS ('
      + (rows[0] ? rows[0].total + ' / ' + rows[0].status : 'no row') + ')');
  assert(rows.length === 2 && Number(rows[1].total) === 1800 && rows[1].status === 'UNKNOWN',
    'rank 2 persisted total_price 1800 / status UNKNOWN ('
      + (rows[1] ? rows[1].total + ' / ' + rows[1].status : 'no row') + ')');
  const storedIds = rows.map((row) => row.id).sort();
  assert(JSON.stringify(storedIds) === JSON.stringify(result.build_candidate_ids.slice().sort()),
    'the stored build_candidate ids are exactly the ids the wrapper returned');
}

// ---------------------------------------------------------------------------
// 2. Writer error mid-transaction: ROLLBACK persists nothing.
// ---------------------------------------------------------------------------

async function testRollbackOnWriterError(client, other, ctx, createdIds) {
  console.log('\n--- 2. writer error mid-transaction (rollback persists nothing) ---');
  const queryId = await insertQuery(client, ctx.scoringModelId);
  createdIds.push(queryId);

  const [cpu, motherboard] = ctx.productIds;
  // The SECOND component of the FIRST entry carries a product_id that does not
  // exist, so the FK violation happens after the first build_candidate row and
  // its first component row were already written - the partial write this test
  // must not find afterwards.
  const selected = [
    makeEntry(1, [
      makeComponent('CPU', cpu, 1000),
      makeComponent('MOTHERBOARD', randomUUID(), 1500),
    ]),
    makeEntry(2, [makeComponent('CPU', cpu, 1000), makeComponent('RAM', motherboard, 800)]),
  ];

  const error = await rejectsWith(
    () => runRecommendationCommit(client, queryId, selected),
    (caught) => caught && caught.code === '23503',
    'the raw foreign-key error 23503',
    'a mid-write failure propagates unchanged (raw pg 23503, not a guard refusal)'
  );
  assert(error !== null && error.code === '23503',
    'the failure is the injected FK violation, not a guard refusal ['
      + describe(error) + ']');

  const own = await countsForQuery(client, queryId);
  assert(own.candidates === 0 && own.components === 0 && own.results === 0,
    'the partially written transaction was rolled back on its own session: ' + JSON.stringify(own));
  const observed = await countsForQuery(other, queryId);
  assert(observed.candidates === 0 && observed.components === 0 && observed.results === 0,
    'nothing is visible on a second connection either: ' + JSON.stringify(observed));
  const probe = await client.query('SELECT 1 AS ok');
  assert(probe.rows[0].ok === 1,
    'the session is usable again after the wrapper ROLLBACK (no open/aborted transaction)');
}

// ---------------------------------------------------------------------------
// 3. Re-run guard: a query that already has build_candidate rows is refused.
// ---------------------------------------------------------------------------

async function testRerunGuard(client, other, ctx, createdIds) {
  console.log('\n--- 3. re-run guard (no overwrite, no delete, no upsert) ---');
  const queryId = await insertQuery(client, ctx.scoringModelId);
  createdIds.push(queryId);

  const [cpu, motherboard] = ctx.productIds;
  await runRecommendationCommit(client, queryId, [
    makeEntry(1, [makeComponent('CPU', cpu, 1000), makeComponent('MOTHERBOARD', motherboard, 1500)]),
  ]);
  const before = await countsForQuery(other, queryId);
  assert(before.candidates === 1 && before.components === 2 && before.results === 1,
    'setup: the first pass committed 1 candidate / 2 components / 1 result: ' + JSON.stringify(before));
  const firstIds = (await other.query(
    'SELECT id FROM build_candidate WHERE recommendation_query_id = $1', [queryId]
  )).rows.map((row) => row.id);

  await rejectsWith(
    () => runRecommendationCommit(client, queryId, [makeEntry(1, [makeComponent('CPU', cpu, 4242)])]),
    isGuardRefusal,
    'CandidateSelectionError INVALID_INPUT on field query_id',
    'a second commit for the same query_id is refused fail-fast'
  );

  const after = await countsForQuery(other, queryId);
  assert(JSON.stringify(after) === JSON.stringify(before),
    'the refused attempt changed no row count: ' + JSON.stringify(after));
  const stillThere = (await other.query(
    'SELECT id FROM build_candidate WHERE recommendation_query_id = $1', [queryId]
  )).rows.map((row) => row.id);
  assert(JSON.stringify(stillThere.sort()) === JSON.stringify(firstIds.slice().sort()),
    'the original build_candidate rows are the same rows (nothing replaced them)');
  const refusedWrite = await scalar(
    other,
    'SELECT count(*)::int AS n FROM build_component WHERE build_candidate_id = ANY($1::uuid[])'
      + ' AND selected_price = 4242',
    [firstIds]
  );
  assert(refusedWrite.n === 0,
    'the refused attempt wrote no component row (the guard runs before any write)');

  // The guard is a QUERY-level rule, not a write-level one: an empty re-run of
  // an already-persisted query is refused as well.
  await rejectsWith(
    () => runRecommendationCommit(client, queryId, []),
    isGuardRefusal,
    'CandidateSelectionError INVALID_INPUT on field query_id',
    'a zero-build re-run of an already-persisted query is refused too'
  );
  const afterEmpty = await countsForQuery(other, queryId);
  assert(JSON.stringify(afterEmpty) === JSON.stringify(before),
    'the refused zero-build re-run wrote nothing: ' + JSON.stringify(afterEmpty));
}

// ---------------------------------------------------------------------------
// 4. Guard 1: an unknown recommendation_query id fails fast.
// ---------------------------------------------------------------------------

async function testUnknownQueryId(client, ctx) {
  console.log('\n--- 4. unknown query_id (guard 1 fail-fast) ---');
  const missing = randomUUID();
  const [cpu] = ctx.productIds;

  await rejectsWith(
    () => runRecommendationCommit(client, missing, [makeEntry(1, [makeComponent('CPU', cpu, 1000)])]),
    isGuardRefusal,
    'CandidateSelectionError INVALID_INPUT on field query_id',
    'an unknown query_id is refused fail-fast'
  );

  const rows = await scalar(
    client,
    'SELECT count(*)::int AS n FROM recommendation_query WHERE id = $1',
    [missing]
  );
  assert(rows.n === 0, 'the guard never inserts a recommendation_query row');
  const counted = await countsForQuery(client, missing);
  assert(counted.candidates === 0 && counted.components === 0 && counted.results === 0,
    'an unknown query_id writes nothing: ' + JSON.stringify(counted));
  const probe = await client.query('SELECT 1 AS ok');
  assert(probe.rows[0].ok === 1,
    'the session is clean after the fail-fast ROLLBACK (no aborted transaction state)');
}

// ---------------------------------------------------------------------------
// 5. Zero builds (Decision 19.3 / 18-D8): valid outcome, persists nothing.
// ---------------------------------------------------------------------------

async function testZeroBuild(client, other, ctx, createdIds) {
  console.log('\n--- 5. zero builds (valid outcome, zero writes, query stays un-persisted) ---');
  const queryId = await insertQuery(client, ctx.scoringModelId);
  createdIds.push(queryId);

  const result = await runRecommendationCommit(client, queryId, []);
  assert(result.query_id === queryId && Object.isFrozen(result)
    && result.persisted_ranks.length === 0 && result.build_candidate_ids.length === 0
    && result.recommendation_result_ids.length === 0,
  'a zero-build pass returns frozen empties: ' + JSON.stringify(result));

  const counted = await countsForQuery(other, queryId);
  assert(counted.candidates === 0 && counted.components === 0 && counted.results === 0,
    'a zero-build pass persists nothing: ' + JSON.stringify(counted));

  const [cpu, motherboard] = ctx.productIds;
  const later = await runRecommendationCommit(client, queryId, [
    makeEntry(1, [makeComponent('CPU', cpu, 1000), makeComponent('MOTHERBOARD', motherboard, 1500)]),
  ]);
  assert(later.build_candidate_ids.length === 1,
    'because nothing was persisted, a later non-empty pass for the same query_id is still allowed');
  const after = await countsForQuery(other, queryId);
  assert(after.candidates === 1 && after.components === 2 && after.results === 1,
    'the later pass committed exactly 1 candidate / 2 components / 1 result: ' + JSON.stringify(after));
}

// ---------------------------------------------------------------------------
// Main: connect, preflight, run the five cases, clean up, report.
// ---------------------------------------------------------------------------

async function main() {
  const dbConfig = getWriteTestDbUrl();
  const client = new Client({
    connectionString: dbConfig.connectionString,
    connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
  });
  const other = new Client({
    connectionString: dbConfig.connectionString,
    connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
  });
  const createdIds = [];
  let connected = false;

  try {
    await client.connect();
    connected = true;
    console.log('target: test-scratch only (host: ' + hostOf(dbConfig.connectionString) + ')');
    console.log('the shared DATABASE_URL is never contacted and never printed');

    const ctx = await preflight(client);
    console.log('preflight ok: scoring_model ' + ctx.modelLabel
      + ', ' + ctx.productIds.length + ' product id(s) available');
    console.log('Layer 4 write tables before this run: ' + JSON.stringify(ctx.observed));

    await other.connect();
    console.log('second connection open (commit visibility is checked from it)');

    await testSuccessfulCommit(client, other, ctx, createdIds);
    await testRollbackOnWriterError(client, other, ctx, createdIds);
    await testRerunGuard(client, other, ctx, createdIds);
    await testUnknownQueryId(client, ctx);
    await testZeroBuild(client, other, ctx, createdIds);
  } finally {
    if (connected) {
      try {
        await cleanup(client, createdIds);
        const leftovers = await countsForQueries(client, createdIds);
        const clean = leftovers.queries === 0 && leftovers.candidates === 0
          && leftovers.components === 0 && leftovers.results === 0;
        assert(clean, 'cleanup removed every row this run created (' + JSON.stringify(leftovers) + ')');
      } catch (cleanupError) {
        console.error('CLEANUP FAILED:', cleanupError.message,
          '- ids created by this run were:', createdIds.join(', '));
        failed++;
      }
    }
    try {
      await other.end();
    } catch (endError) {
      void endError;
    }
    try {
      await client.end();
    } catch (endError) {
      void endError;
    }
  }

  console.log('\n== RESULT: ' + passed + ' pass / ' + failed + ' fail');
}

main().then(
  () => process.exit(failed > 0 ? 1 : 0),
  (error) => {
    console.error('TEST FAILED:', error.message);
    process.exit(1);
  }
);
