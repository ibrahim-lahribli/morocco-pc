'use strict';

/**
 * apps/api/test/db/recommendations.db.test.js - the API against the real
 * engine and the real database.
 *
 * TEST BRANCH ONLY. `resolveTestDbUrl` runs at module scope and throws when
 * TEST_DATABASE_URL is absent or points at the shared endpoint, so a missing
 * environment fails the suite loudly instead of skipping it.
 *
 * What only a real database can prove, and therefore what these tests are for:
 *   - the engine really produces builds through the API's one client checkout,
 *     and every component is labelled from the persisted join;
 *   - GET reads back EXACTLY what POST persisted (the same statement, so this
 *     is the round-trip the fake-client tests cannot perform);
 *   - no engine call happens on GET (spied, not asserted by inspection);
 *   - the API's own writes leave zero residue - verified, not assumed.
 *
 * Cleanup order is dependency order: build_rejection -> recommendation_result
 * -> build_component -> build_candidate -> recommendation_query ->
 * recommendation_profile. The profile id must be CAPTURED before the query is
 * deleted, because the FK runs query -> profile with NO ACTION, so the query
 * row has to go first.
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

const ENGINE_VERSION = 'db-test-sha';

// Module scope on purpose: an unusable environment fails the file, not a test.
const POOL_CONFIG = resolveTestDbUrl(process.env);

function createPool() {
  return new Pool({
    connectionString: POOL_CONFIG.connectionString,
    connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: 'morocco-pc-api-test',
  });
}

function createApp(pool, overrides) {
  return buildApp(Object.assign({
    pool,
    repository,
    engine,
    engineVersion: ENGINE_VERSION,
    env: { ENGINE_VERSION, ALLOWED_ORIGINS: '' },
    logger: false,
  }, overrides || {}));
}

async function cleanup(pool, queryIds) {
  if (queryIds.length === 0) {
    return;
  }
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

test('the API round-trips a real recommendation and leaves no residue', async () => {
  const pool = createPool();
  const app = createApp(pool);
  const createdQueryIds = [];

  try {
    // ---- 0. the real active model drives the advertised vocabulary ----------
    const metaResponse = await app.inject({ method: 'GET', url: '/v1/meta/options' });
    assert.equal(metaResponse.statusCode, 200);
    const useCases = metaResponse.json().use_cases.map((option) => option.value);
    assert.ok(useCases.includes('GAMING'), 'the seed model requires GPU for GAMING');
    assert.ok(useCases.includes('WORKSTATION'));

    // ---- 1. a valid POST produces real, labelled builds --------------------
    const created = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 20000, currency: 'MAD', use_case: 'GAMING' },
    });
    assert.equal(created.statusCode, 201, 'a 20000 MAD GAMING budget must assemble at least one build');
    const post = created.json();
    createdQueryIds.push(post.id);

    assert.ok(post.builds.length > 0);
    assert.equal(post.engine_version, ENGINE_VERSION);
    assert.equal(post.disclaimer, 'Prix indicatifs, non actualisés.');
    assert.equal(post.served_by.engine_version, ENGINE_VERSION);
    assert.equal(post.reason, null);
    assert.ok(post.budget_floor !== null, 'Stage 1 succeeded, so the floor was computed');

    for (const build of post.builds) {
      assert.ok(build.components.length > 0, 'every build carries its components');
      assert.equal(typeof build.total_price, 'number');
      assert.ok(['indicative', 'verified'].includes(build.price_status));
      for (const component of build.components) {
        assert.equal(typeof component.product_id, 'string');
        assert.ok(component.name.length > 0, 'the product name comes from the persisted join');
        assert.equal(typeof component.price_used, 'number');
        assert.ok(['SEED_UNVERIFIED', 'VERIFIED'].includes(component.offer_class));
        // The seed catalog is 100% seed offers, so the provenance label is real.
        assert.equal(component.offer_class, 'SEED_UNVERIFIED');
      }
    }
    assert.ok(post.builds.every((build) => build.price_status === 'indicative'));

    // ---- 2. GET is identical on persisted fields and never re-runs the engine
    let engineCalls = 0;
    const spyApp = createApp(pool, {
      engine: {
        async runFullRun(client, queryId) {
          engineCalls += 1;
          return engine.runFullRun(client, queryId);
        },
      },
    });

    const fetched = await spyApp.inject({ method: 'GET', url: '/v1/recommendations/' + post.id });
    assert.equal(fetched.statusCode, 200);
    const get = fetched.json();

    assert.equal(engineCalls, 0, 'GET reads persisted rows only - it never re-runs the engine');
    assert.deepEqual(get.builds, post.builds, 'POST and GET agree on every persisted build field');
    assert.equal(get.generated_at, post.generated_at);
    assert.equal(get.budget_amount, post.budget_amount);
    assert.equal(get.use_case, post.use_case);
    assert.equal(get.currency, post.currency);
    assert.equal(get.budget_floor, null);
    assert.equal(get.engine_version, null);
    assert.equal(get.served_by.engine_version, ENGINE_VERSION);

    // ---- 3. an impossible budget is a 200 with an empty list and a floor ----
    const empty = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 1000, currency: 'MAD', use_case: 'GAMING' },
    });
    const emptyBody = empty.json();
    if (emptyBody.id) {
      createdQueryIds.push(emptyBody.id);
    }
    assert.equal(empty.statusCode, 200, 'a zero-build pass is a valid answer, not an error');
    assert.deepEqual(emptyBody.builds, []);
    assert.ok(emptyBody.budget_floor !== null, 'the pool was non-empty, so the floor exists');
    assert.equal(emptyBody.budget_floor.within_budget, false);
    assert.equal(emptyBody.budget_floor.budget_amount, 1000);
    assert.equal(emptyBody.reason, null);

    // ---- 4. vocabulary derived from the REAL model -------------------------
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 20000, currency: 'MAD', use_case: 'OFFICE' },
    });
    assert.equal(rejected.statusCode, 422, 'OFFICE is not in the active model gpu_required_use_cases');

    // ---- 5. an unknown id is a 404 ----------------------------------------
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/recommendations/00000000-0000-4000-8000-000000000000',
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    try {
      await cleanup(pool, createdQueryIds);
      const residue = await residueFor(pool, createdQueryIds);
      const total = Number(residue.queries) + Number(residue.candidates) + Number(residue.results)
        + Number(residue.components) + Number(residue.rejections);
      assert.equal(total, 0, 'this run left no rows behind: ' + JSON.stringify(residue));
    } finally {
      await pool.end();
    }
  }
});
