'use strict';

/**
 * apps/api/test/db/swap-preview.db.test.js - Decision 55's preview against the
 * real engine, the real catalog and a real persisted pass.
 *
 * TEST BRANCH ONLY. `resolveTestDbUrl` runs at module scope, so a missing or
 * shared-pointing TEST_DATABASE_URL fails the file instead of skipping it.
 *
 * What only a real database can prove here:
 *   - the preview's `picked` map really reconstructs from the persisted
 *     `build_component` identities PLUS the live Engine 2D verdicts (the unit
 *     suites stub one side or the other);
 *   - swapping a component for ITSELF reproduces the build's own total, which is
 *     the strongest available round-trip: same product, same carrier, same
 *     verdict, delta 0;
 *   - a genuinely incompatible candidate really answers FAIL with a reason code
 *     from the engine, and both previews write NOTHING.
 *
 * The two swaps are chosen from the catalog, not hardcoded: the self-swap uses
 * the build's own CPU, and the failing swap asks the database for an ACTIVE
 * motherboard on a DIFFERENT socket than that CPU (7 boards across 3 sockets on
 * the branch), which `cpu_motherboard` rejects as HARD.
 *
 * Cleanup is dependency order and is scoped to this run's query id:
 * build_rejection -> recommendation_result -> build_component ->
 * build_candidate -> recommendation_query -> recommendation_profile. A leftover
 * `recommendation_query` row would block `npm run eval:scenarios`'s preflight,
 * so the residue is asserted zero AND the whole-table counts are compared with
 * the pre-run snapshot.
 */

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const { resolveTestDbUrl } = require('../../../../scripts/lib/db-url');
const { buildApp } = require('../../src/app');
const repository = require('../../src/repository');
const engine = require('../../src/engine');
const { STATEMENT_TIMEOUT_MS } = require('../../src/db');

/** A deploy tag of its own, so the POST below cannot answer from a reused pass. */
const ENGINE_VERSION = 'db-test-swap-preview';

const POOL_CONFIG = resolveTestDbUrl(process.env);

function createPool() {
  return new Pool({
    connectionString: POOL_CONFIG.connectionString,
    connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: 'morocco-pc-api-test',
  });
}

function createApp(pool) {
  return buildApp({
    pool,
    repository,
    engine,
    engineVersion: ENGINE_VERSION,
    env: { ENGINE_VERSION, ALLOWED_ORIGINS: '' },
    logger: false,
  });
}

async function cleanup(pool, queryIds) {
  if (queryIds.length === 0) {
    return;
  }
  // A swap COMMIT could have run against one of this run's builds (the file
  // shares its pass fixtures), and `recommendation_swap` holds FKs to BOTH the
  // result and the derived candidate: it is the first row to go.
  await pool.query(
    'DELETE FROM recommendation_swap WHERE source_result_id IN'
    + ' (SELECT id FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[]))'
    + ' OR build_candidate_id IN'
    + ' (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))',
    [queryIds]
  );
  await pool.query('DELETE FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])', [queryIds]);
  await pool.query('DELETE FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])', [queryIds]);
  await pool.query(
    'DELETE FROM build_component WHERE build_candidate_id IN'
    + ' (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))',
    [queryIds]
  );
  await pool.query('DELETE FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])', [queryIds]);

  const profiles = (await pool.query(
    'SELECT DISTINCT recommendation_profile_id AS id FROM recommendation_query'
    + ' WHERE id = ANY($1::uuid[]) AND recommendation_profile_id IS NOT NULL',
    [queryIds]
  )).rows.map((row) => row.id);

  await pool.query('DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])', [queryIds]);

  if (profiles.length > 0) {
    await pool.query('DELETE FROM recommendation_profile WHERE id = ANY($1::uuid[])', [profiles]);
  }
}

/** Whole-table counts for the six Layer 4 tables this path can touch. */
async function countAll(pool) {
  const result = await pool.query(
    'SELECT'
    + ' (SELECT count(*)::int FROM recommendation_profile) AS profiles,'
    + ' (SELECT count(*)::int FROM recommendation_query) AS queries,'
    + ' (SELECT count(*)::int FROM recommendation_result) AS results,'
    + ' (SELECT count(*)::int FROM build_candidate) AS candidates,'
    + ' (SELECT count(*)::int FROM build_component) AS components,'
    + ' (SELECT count(*)::int FROM build_rejection) AS rejections'
  );
  return result.rows[0];
}

async function residueFor(pool, queryIds) {
  const result = await pool.query(
    'SELECT'
    + ' (SELECT count(*)::int FROM recommendation_query WHERE id = ANY($1::uuid[])) AS queries,'
    + ' (SELECT count(*)::int FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])) AS candidates,'
    + ' (SELECT count(*)::int FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])) AS results,'
    + ' (SELECT count(*)::int FROM build_component WHERE build_candidate_id IN'
    + '   (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))) AS components,'
    + ' (SELECT count(*)::int FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])) AS rejections',
    [queryIds]
  );
  return result.rows[0];
}

function previewUrl(queryId, rank, params) {
  return '/v1/recommendations/' + queryId + '/builds/' + rank + '/swap-preview?'
    + new URLSearchParams(params).toString();
}

test('a real pass can be previewed against the live catalog, and nothing is written', async () => {
  const pool = createPool();
  const app = createApp(pool);
  const before = await countAll(pool);
  let queryId = null;

  try {
    // 1. A real pass, so the build is a genuine persisted record.
    const created = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 20000, currency: 'MAD', use_case: 'GAMING' },
    });
    assert.equal(created.statusCode, 201, 'a 20000 MAD GAMING budget must assemble at least one build');
    queryId = created.json().id;
    const rank = created.json().builds[0].rank;

    // 2. The read the route depends on: rank resolved through
    //    recommendation_result, with a candidate AND real component rows.
    const persisted = await repository.readBuildForSwap(pool, queryId, rank);
    assert.equal(persisted.found, true, 'the committed build must be addressable by rank');
    assert.ok(persisted.build.components.length >= 4, 'a real build carries its components');
    assert.ok(persisted.build.catalog_version, 'the pass recorded a catalog version');
    assert.equal(
      persisted.build.components.every((component) => typeof component.product_id === 'string'),
      true,
      'every component carries its identity'
    );

    const cpu = persisted.build.components.find((component) => component.role === 'CPU');
    const board = persisted.build.components.find((component) => component.role === 'MOTHERBOARD');
    assert.ok(cpu && board, 'the persisted build has a CPU and a motherboard');

    // 3. A PASS case that cannot be flaky: the build's own CPU, which the live
    //    catalog must still judge the same way the pass did.
    const selfSwap = await app.inject({
      method: 'GET',
      url: previewUrl(queryId, rank, { role: 'CPU', product_id: cpu.product_id }),
    });
    assert.equal(selfSwap.statusCode, 200, 'a preview of the build itself is evaluable');
    assert.equal(selfSwap.headers['cache-control'], 'no-store');
    const self = selfSwap.json();

    assert.equal(
      self.compatibility.status === 'PASS' || self.compatibility.status === 'UNKNOWN',
      true,
      're-substituting a build member cannot be incompatible: got ' + self.compatibility.status
    );
    assert.equal(self.price.previous, self.price.next, 'the same product costs the same');
    assert.equal(self.price.delta, 0);
    assert.equal(self.price.offer_class, 'SEED_UNVERIFIED', 'the branch catalog is seed pricing');
    assert.equal(self.price.price_status, 'indicative', 'and a seed price is never advertised as verified');
    assert.equal(
      self.budget.total,
      Number(persisted.build.total_price),
      'the previewed total reproduces the persisted one exactly'
    );
    assert.equal(self.budget.delta, 0);
    assert.equal(self.budget.within_budget, true);
    assert.match(self.catalog_version, /^[0-9a-f]{32}$/, 'the LIVE digest is served');
    assert.equal(self.engine_version, ENGINE_VERSION);

    // 4. A FAIL case from real data: an ACTIVE board on a different socket than
    //    this build's CPU, which `cpu_motherboard` rejects as HARD. Chosen from
    //    the catalog rather than hardcoded, and required to have an eligible
    //    offer so the answer is a PAIR failure rather than an eligibility one.
    const mismatched = (await pool.query(
      'SELECT m.product_id'
      + ' FROM motherboard_spec m'
      + ' JOIN product p ON p.id = m.product_id'
      + ' JOIN cpu_spec c ON c.product_id = $1'
      + ' WHERE m.socket_id <> c.socket_id'
      + "   AND p.lifecycle_status = 'ACTIVE'"
      + '   AND m.product_id <> $2'
      + '   AND EXISTS (SELECT 1 FROM store_offer o'
      + '     WHERE o.product_id = m.product_id AND o.currency = $3'
      + "       AND o.price > 0 AND o.availability <> 'OUT_OF_STOCK')"
      + ' ORDER BY m.product_id ASC'
      + ' LIMIT 1',
      [cpu.product_id, board.product_id, 'MAD']
    )).rows[0];
    assert.ok(
      mismatched,
      'the branch catalog must hold an ACTIVE motherboard on a different socket with a MAD offer'
    );

    const failSwap = await app.inject({
      method: 'GET',
      url: previewUrl(queryId, rank, { role: 'MOTHERBOARD', product_id: mismatched.product_id }),
    });
    assert.equal(failSwap.statusCode, 200, 'an incompatible swap is a RESULT, not an error');
    const fail = failSwap.json();

    assert.equal(fail.compatibility.status, 'FAIL', 'a socket mismatch is HARD');
    assert.equal(fail.compatibility.pairs.length > 0, true);
    const failed = fail.compatibility.pairs.filter((pair) => pair.status === 'FAIL');
    assert.ok(failed.length > 0, 'the FAIL carries at least one failing pair');
    assert.equal(
      failed.every((pair) => typeof pair.reason === 'string' && pair.reason.length > 0),
      true,
      'every failing pair names its rule'
    );
    assert.ok(
      failed.some((pair) => pair.check === 'cpu_motherboard'),
      'the socket relationship is the one that failed'
    );

    // The candidate IS priced - it is eligible, just incompatible - which is what
    // distinguishes this FAIL from the eligibility one.
    assert.equal(typeof fail.price.next, 'number');
    assert.equal(typeof fail.price.delta, 'number');
    assert.equal(typeof fail.budget.total, 'number');
  } finally {
    await cleanup(pool, queryId === null ? [] : [queryId]);
    await app.close();
    await pool.end();
  }

  // 5. Nothing was written, and nothing was left behind.
  const verifyPool = createPool();
  try {
    const after = await countAll(verifyPool);
    assert.deepEqual(after, before, 'the preview wrote no Layer 4 row; the cleanup restored the rest');
    const residue = await residueFor(verifyPool, [queryId]);
    assert.deepEqual(
      residue,
      { queries: 0, candidates: 0, results: 0, components: 0, rejections: 0 },
      'a leftover recommendation_query row would block eval:scenarios'
    );
  } finally {
    await verifyPool.end();
  }
});
