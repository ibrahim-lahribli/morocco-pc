'use strict';

// scripts/test-orchestrator-full-run.js - Decision 21 real-database test.
// Proves runRecommendationFullRun end to end on test-scratch: one real query
// is scored, ranked, diversity-selected, and persisted (visible on a second
// connection); a second full-run for the same query_id hits the re-run guard.
// It also proves the Decision 46 pass facts LAND (Platform migration 019): the
// Decision 27 floor on the query row and engine_version / strategy_key on every
// result row - and that an ABSENT engineVersion option persists SQL NULL rather
// than a guessed placeholder. Those are assertions over the committed rows, and
// the floor is compared by CONTENT (see canonicalJson) because jsonb reorders
// keys and the engine's cheapest_by_role is a null-prototype object.
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
const modelPin = require('./lib/model-pin');

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

// Compare two JSON-shaped values by CONTENT, not by identity of their objects.
// Two boundary facts make the obvious comparators wrong here:
//   * jsonb does NOT preserve key order, so a raw JSON.stringify comparison
//     compares key order rather than content;
//   * the floor's `cheapest_by_role` is a deliberately NULL-PROTOTYPE object
//     (retention/budget-floor.js uses Object.create(null) so a role named
//     "__proto__" cannot collide with an inherited property), while the driver
//     hands back a plain object - and util.isDeepStrictEqual compares
//     prototypes, so it rejects two identical payloads.
// A key-sorted stringify ignores both differences and compares values.
function canonicalJson(value) {
  return JSON.stringify(value, (key, entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const sorted = {};
    for (const name of Object.keys(entry).sort()) sorted[name] = entry[name];
    return sorted;
  });
}

// Decision 46 / migration 019: read back the facts a pass recorded about
// itself. The floor is jsonb (parsed into an object by node-postgres) and the
// two result columns are TEXT; an absent or pre-019 fact is SQL NULL.
async function readPassFacts(client, queryId) {
  const floor = (await client.query(
    'SELECT budget_floor FROM recommendation_query WHERE id = $1',
    [queryId]
  )).rows[0].budget_floor;
  const rows = (await client.query(
    'SELECT rank, engine_version, strategy_key FROM recommendation_result'
      + ' WHERE recommendation_query_id = $1 ORDER BY rank',
    [queryId]
  )).rows;
  return {
    floor,
    ranks: rows.map((row) => row.rank),
    engineVersions: rows.map((row) => row.engine_version),
    strategyKeys: rows.map((row) => row.strategy_key),
  };
}

// Canonical seeded state of the test branch: seeds 001 (15 products) + 002
// (85 products, catalog expansion) = 100 Seed products / 101 Seed offers;
// seed 003 (connector data, no new rows) + 004a (87 GPU/PSU assessment rows,
// OG-01 batch 1) + 004b (63 CPU/MOTHERBOARD rows + 60 SSD/RAM rows, OG-01
// batch 2) = 235 assessments. Update this when a seed file changes the canonical
// catalog (AGENTS.md section 8 same-session rule).
// `models` counts the rows matching the PIN (Step-2 item 1 / OG-39), not the
// active models: a two-active-model branch must still resolve its pin to one.
const EXPECTED = { products: 100, models: 1, offers: 101, assessments: 280, queries: 0 };

async function preflight(client, pin = modelPin.DEFAULT_MODEL_PIN) {
  const pinParts = modelPin.parseModelPin(pin);
  const products = await count(client, "SELECT count(*)::int AS count FROM product WHERE name LIKE 'Seed %'");
  const models = await count(client,
    'SELECT count(*)::int AS count FROM scoring_model WHERE name = $1 AND version = $2 AND is_active = true',
    [pinParts.name, pinParts.version]);
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
  // Step-2 item 1 (OG-39): resolve the PIN instead of a hard-coded name.
  const model = await modelPin.resolvePinnedModel(client, pin);
  return { observed, scoringModelId: model.id, pin };
}

async function insertQuery(client, scoringModelId) {
  const inserted = await client.query(
    'INSERT INTO recommendation_query (scoring_model_id, budget_amount, currency, use_case)'
      + " VALUES ($1, '20000', 'MAD', 'GAMING') RETURNING id",
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

  // Decision 46 / migration 019: the pass facts must actually LAND on the rows
  // they describe. persistPassFacts is UPDATE-only, so a statement that matched
  // no row would still exit 0 and leave this gate green on an empty story -
  // which is why the facts are read back here instead of trusted.
  const facts = await readPassFacts(other, queryId);
  assert(facts.floor !== null && typeof facts.floor === 'object' && !Array.isArray(facts.floor),
    'the Decision 27 floor landed on the query row as a jsonb object: ' + JSON.stringify(facts.floor));
  assert(canonicalJson(facts.floor) === canonicalJson(result.budget_floor),
    'the persisted floor equals the floor the full run returned, key order and null-prototype aside');
  assert(typeof facts.floor.cheapest_total === 'number' && typeof facts.floor.currency === 'string',
    'the persisted floor is the real diagnostic payload, not an empty object or a re-encoded string');
  assert(facts.ranks.length === result.selected.length,
    'every persisted rank was read back for its pass facts: ' + JSON.stringify(facts.ranks));
  assert(facts.strategyKeys.length === result.selected.length
    && facts.strategyKeys.every((key) => typeof key === 'string' && key.length > 0),
    'every result row carries the archetype that nominated it: ' + JSON.stringify(facts.strategyKeys));
  assert(JSON.stringify(facts.strategyKeys)
    === JSON.stringify(result.selected.map((row) => row.strategy_key)),
    'the persisted strategy keys match the selected archetypes in rank order (the CONTENT half of'
      + ' the persistPassFacts rank alignment, which only a read-back can pin)');
  assert(facts.engineVersions.every((version) => version === null),
    'an ABSENT engineVersion option persists SQL NULL, never a guess: ' + JSON.stringify(facts.engineVersions));
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

// Decision 46: a caller-supplied engineVersion must survive verbatim to every
// result row of the pass it describes. This needs its own query because the
// first pass deliberately ran without the option, and the value is a fact about
// the CALLER (which deploy produced these rows) - so it must arrive from the
// argument, never from an engine constant and never from process.env.
async function testPassFactsEngineVersion(client, other, ctx, createdIds) {
  console.log('\n--- 3. the pass facts carry a supplied engine version ---');
  const queryId = await insertQuery(client, ctx.scoringModelId);
  createdIds.push(queryId);

  const engineVersion = 'pass-facts-gate@1.0.0';
  const result = await runRecommendationFullRun(client, queryId, { engineVersion });
  assert(result.selected.length > 0, 'the second pass selected a build too');

  const facts = await readPassFacts(other, queryId);
  assert(facts.ranks.length === result.selected.length
    && facts.engineVersions.length === result.selected.length,
    'one pass-fact result row per selected build (ranks ' + JSON.stringify(facts.ranks) + ')');
  assert(facts.engineVersions.every((version) => version === engineVersion),
    'the supplied engineVersion reached EVERY result row verbatim: ' + JSON.stringify(facts.engineVersions));
  assert(JSON.stringify(facts.strategyKeys)
    === JSON.stringify(result.selected.map((row) => row.strategy_key)),
    'the strategy keys still match the selected archetypes in rank order: ' + JSON.stringify(facts.strategyKeys));
  assert(canonicalJson(facts.floor) === canonicalJson(result.budget_floor),
    'the floor of the second pass landed too');
  return queryId;
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
    const pin = modelPin.modelPinValue(modelPin.readModelPinFlag(process.argv.slice(2)));
    const ctx = await preflight(client, pin);
    console.log('preflight ok: ' + ctx.pin + ', ' + JSON.stringify(ctx.observed));
    await other.connect();
    console.log('second connection open (persisted rows are checked from it)');
    const queryId = await testFullPass(client, other, ctx, createdIds);
    await testRerunGuard(client, other, queryId);
    await testPassFactsEngineVersion(client, other, ctx, createdIds);
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
