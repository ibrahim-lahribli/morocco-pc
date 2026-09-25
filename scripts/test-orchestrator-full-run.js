'use strict';

// scripts/test-orchestrator-full-run.js - Decision 21 real-database test.
// Proves runRecommendationFullRun end to end on test-scratch: one real query
// is scored, ranked, diversity-selected, and persisted (visible on a second
// connection); a second full-run for the same query_id hits the re-run guard.
// Safety contract mirrors scripts/test-orchestrator-commit.js: TEST_DATABASE_URL
// only, host-only logging, ISOLATED-WRITE (no outer BEGIN), cleanup by
// captured id in reverse dependency order. NOT named *.test.js so the unit
// runner never discovers it. A NEW script (not an extension of the commit
// script) because the fixture, preflight, and cleanup contracts differ.

require('dotenv').config();
const { Client } = require('pg');

const { getWriteTestDbUrl } = require('./lib/db-url');
const { runRecommendationFullRun } = require('../src/recommendation/orchestrator/full-run');
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

const isGuardRefusal = (error) => error instanceof CandidateSelectionError
  && error.code === ERROR_CODES.INVALID_INPUT
  && error.field === 'query_id';

const hostOf = (connectionString) => new URL(connectionString).hostname;

async function count(client, sql, params = []) {
  const result = await client.query(sql, params);
  return Number(result.rows[0].count);
}

async function scalar(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0];
}

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

const EXPECTED = { products: 15, models: 1, offers: 16, assessments: 25, queries: 0 };

async function preflight(client) {
  const products = await count(client, "SELECT count(*)::int AS count FROM product WHERE name LIKE 'Seed %'");
  const models = await count(client,
    "SELECT count(*)::int AS count FROM scoring_model WHERE name = 'seed-minimal-v1' AND version = '1.0.0' AND is_active = true");
  const offers = await count(client,
    "SELECT count(*)::int AS count FROM store_offer o JOIN product p ON p.id = o.product_id WHERE p.name LIKE 'Seed %'");
  const assessments = await count(client,
    "SELECT count(*)::int AS count FROM component_assessment a JOIN product p ON p.id = a.product_id WHERE p.name LIKE 'Seed %'");
  const queries = await count(client, 'SELECT count(*)::int AS count FROM recommendation_query');
  const buildCandidates = await count(client, 'SELECT count(*)::int AS count FROM build_candidate');
  const observed = { products, models, offers, assessments, queries };
  const mismatches = [];
  for (const key of Object.keys(EXPECTED)) {
    if (observed[key] !== EXPECTED[key]) {
      mismatches.push(key + ': expected ' + EXPECTED[key] + ', found ' + observed[key]);
    }
  }
  if (mismatches.length > 0) {
    throw new Error('PREFLIGHT FAILED (no write was performed): ' + mismatches.join('; ')
      + ' - reset the test branch from its parent and run the seeds first');
  }
  if (buildCandidates !== 0) {
    throw new Error('PREFLIGHT FAILED: build_candidate is not empty (' + buildCandidates + ' rows)');
  }
  const model = await client.query(
    "SELECT id FROM scoring_model WHERE name = 'seed-minimal-v1' AND version = '1.0.0' AND is_active = true");
  return { observed, scoringModelId: model.rows[0].id };
}

async function insertQuery(client, scoringModelId) {
  const inserted = await client.query(
    'INSERT INTO recommendation_query (scoring_model_id, budget_amount, currency, use_case)'
      + " VALUES ($1, '15000', 'MAD', 'GAMING') RETURNING id",
    [scoringModelId]
  );
  return inserted.rows[0].id;
}

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

async function testFullPass(client, other, ctx, createdIds) {
  console.log('\n--- 1. full pass (score, rank, select, persist; visible on second connection) ---');
  const queryId = await insertQuery(client, ctx.scoringModelId);
  createdIds.push(queryId);

  const result = await runRecommendationFullRun(client, queryId);
  assert(Object.isFrozen(result), 'the full-run result is frozen');
  assert(result.query_id === queryId, 'the result echoes the pinned query id');
  assert(typeof result.scoring_model_id === 'string', 'the result carries the scoring model id');
  assert(Array.isArray(result.builds), 'the result carries the scored builds array');
  assert(Array.isArray(result.ranked), 'the result carries the full ranked list');
  assert(Array.isArray(result.top_n), 'the result carries the top_n slice');
  assert(Array.isArray(result.selected), 'the result carries the diversity-selected array');
  assert(typeof result.dropped_count === 'number', 'the result carries dropped_count');
  assert(result.selected.length > 0, 'the seed query produced a non-empty selection (' + result.selected.length + ')');
  assert(result.ranked.length >= result.selected.length, 'ranked covers at least the selected rows');
  assert(result.top_n.length <= 10, 'top_n is capped at TOP_N_PERSISTED (10)');
  assert(result.persisted_ranks.length === result.selected.length,
    'persisted_ranks matches the selection size: ' + JSON.stringify(result.persisted_ranks));
  assert(result.build_candidate_ids.length === result.selected.length
    && result.recommendation_result_ids.length === result.selected.length,
    'one build_candidate id and one recommendation_result id per selected row');

  const counted = await countsForQuery(other, queryId);
  assert(counted.candidates === result.selected.length && counted.results === result.selected.length,
    'a second connection sees the committed rows: ' + JSON.stringify(counted));
  assert(counted.components > 0, 'build_component rows landed too: ' + JSON.stringify(counted));

  const rows = (await other.query(
    'SELECT b.id, r.rank, r.explanation FROM build_candidate b JOIN recommendation_result r ON r.build_candidate_id = b.id'
      + ' WHERE b.recommendation_query_id = $1 ORDER BY r.rank',
    [queryId]
  )).rows;
  assert(rows.length === result.selected.length, 'candidate/result join returns every persisted rank');
  const storedIds = rows.map((row) => row.id).sort();
  assert(JSON.stringify(storedIds) === JSON.stringify(result.build_candidate_ids.slice().sort()),
    'the stored build_candidate ids are exactly the ids the full run returned');
  assert(JSON.stringify(rows.map((row) => row.rank)) === JSON.stringify(result.persisted_ranks),
    'stored recommendation_result ranks match persisted_ranks');

  // Decision 22 item 5 verification: explanation is non-null, non-empty string reaching the DB
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const expectedExplanation = result.selected[i].explanation;
    assert(typeof row.explanation === 'string' && row.explanation.trim().length > 0,
      'persisted explanation is non-empty string for rank ' + row.rank);
    assert(row.explanation === expectedExplanation,
      'persisted explanation matches Engine 6 generated text for rank ' + row.rank + ': ' + row.explanation);
  }
  return queryId;
}

async function testRerunGuard(client, other, queryId) {
  console.log('\n--- 2. re-run guard (second full-run for the same query_id is refused) ---');
  const before = await countsForQuery(other, queryId);
  await rejectsWith(
    () => runRecommendationFullRun(client, queryId),
    isGuardRefusal,
    'CandidateSelectionError INVALID_INPUT on field query_id',
    'a second full-run for the same query_id is refused fail-fast'
  );
  const after = await countsForQuery(other, queryId);
  assert(JSON.stringify(after) === JSON.stringify(before),
    'the refused re-run changed no row count: ' + JSON.stringify(after));
  const probe = await client.query('SELECT 1 AS ok');
  assert(probe.rows[0].ok === 1, 'the session is usable after the fail-fast ROLLBACK');
}

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
    console.log('preflight ok: seed-minimal-v1, ' + JSON.stringify(ctx.observed));
    await other.connect();
    console.log('second connection open (persisted rows are checked from it)');
    const queryId = await testFullPass(client, other, ctx, createdIds);
    await testRerunGuard(client, other, queryId);
  } finally {
    if (connected) {
      try {
        await cleanup(client, createdIds);
        const leftovers = await client.query(
          'SELECT (SELECT count(*)::int FROM recommendation_query WHERE id = ANY($1::uuid[])) AS queries,'
            + ' (SELECT count(*)::int FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])) AS candidates,'
            + ' (SELECT count(*)::int FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])) AS results',
          [createdIds.length === 0 ? ['00000000-0000-0000-0000-000000000000'] : createdIds]
        );
        const clean = leftovers.rows[0].queries === 0 && leftovers.rows[0].candidates === 0
          && leftovers.rows[0].results === 0;
        assert(clean, 'cleanup removed every row this run created (' + JSON.stringify(leftovers.rows[0]) + ')');
      } catch (cleanupError) {
        console.error('CLEANUP FAILED:', cleanupError.message, '- ids created by this run were:', createdIds.join(', '));
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
