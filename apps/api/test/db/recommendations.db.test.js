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

/**
 * Whole-table row counts for the six tables the API/engine path touches.
 * Used for the before/after comparison around the whole run: after cleanup,
 * every count must equal its pre-run value — scoped-to-our-ids zero would miss
 * a row written OUTSIDE the tracked ids (e.g. by a crashed pass), a global
 * comparison does not.
 */
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

test('the API round-trips a real recommendation and leaves no residue', async () => {
  const pool = createPool();
  const app = createApp(pool);
  const createdQueryIds = [];
  let beforeCounts = null;

  try {
    // ---- baseline: whole-table counts BEFORE anything runs ------------------
    beforeCounts = await countAll(pool);

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
    // Full-body deep equality: GET must equal POST on EVERY field except the
    // two pass-only facts, which GET serves as null by contract. A field-by-
    // field comparison would silently pass on a field one path forgets.
    assert.deepEqual(
      get,
      Object.assign({}, post, { budget_floor: null, engine_version: null }),
      'GET is POST minus the two pass-only facts, deep-equal on everything else'
    );

    // ---- 2b. residue exists BEFORE cleanup, with the expected shape ---------
    // (asserting zero AFTER cleanup only proves something if cleanup had real
    // rows to remove; this pins what the pass actually persisted.)
    const persisted = await residueFor(pool, [post.id]);
    assert.equal(Number(persisted.queries), 1, 'the POST persisted exactly one query row');
    // One recommendation_result AND one build_candidate row per persisted build.
    assert.equal(Number(persisted.results), post.builds.length, 'one result row per persisted build');
    assert.equal(Number(persisted.candidates), post.builds.length, 'one candidate row per persisted build');
    // ...and the two agree EXACTLY: a build with a candidate but no result row
    // (or the reverse) is a persistence defect, not a preference.
    assert.equal(
      Number(persisted.results),
      Number(persisted.candidates),
      'recommendation_result and build_candidate counts agree exactly'
    );

    // Every candidate carries at least one component row. Asserted per candidate,
    // not just in aggregate: an aggregate `components >= candidates` check passes
    // with any distribution, so one component-less candidate could hide behind
    // another that carries two.
    const perCandidate = (await pool.query(
      'SELECT b.id AS id,'
      + ' (SELECT count(*)::int FROM build_component c WHERE c.build_candidate_id = b.id) AS components'
      + ' FROM build_candidate b WHERE b.recommendation_query_id = $1 ORDER BY b.id',
      [post.id]
    )).rows;
    assert.equal(perCandidate.length, Number(persisted.candidates), 'one row per candidate');
    for (const row of perCandidate) {
      assert.ok(Number(row.components) >= 1, 'candidate ' + row.id + ' carries at least one component');
    }

    // The read-back is LOSSLESS for this query: SELECT_BUILDS_SQL returns exactly
    // one row per persisted build_component row. This replaces a weaker
    // `components >= candidates` check, which would still pass if the read-back's
    // INNER JOINs silently dropped rows whose build_candidate was missing - the
    // "returned ids never written" trap this repo has hit before. A component-less
    // candidate would legitimately come back as one null-component row, and the
    // per-candidate assertion above rules that case out, so equality is exact.
    const readBack = await repository.readRecommendationResult(pool, post.id);
    assert.equal(readBack.found, true, 'the query row is known to the read path');
    assert.equal(
      readBack.rows.length,
      Number(persisted.components),
      'read-back returns exactly one row per persisted component (no join drop): rows='
      + readBack.rows.length + ' components=' + persisted.components
    );
    // And no result row orphans its candidate: an INNER JOIN would drop such a
    // row silently, so assert the join key actually resolves.
    const orphans = (await pool.query(
      'SELECT count(*)::int AS n FROM recommendation_result r'
      + ' LEFT JOIN build_candidate b ON b.id = r.build_candidate_id'
      + ' WHERE r.recommendation_query_id = $1 AND b.id IS NULL',
      [post.id]
    )).rows[0];
    assert.equal(Number(orphans.n), 0, 'no recommendation_result row orphans its build_candidate');
    assert.ok(Number(persisted.rejections) >= 0, 'rejection diagnostics are readable');

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
    const pre422 = await countAll(pool);
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 20000, currency: 'MAD', use_case: 'OFFICE' },
    });
    assert.equal(rejected.statusCode, 422, 'OFFICE is not in the active model gpu_required_use_cases');
    // The 422 short-circuits BEFORE any INSERT, so nothing may be written.
    assert.deepEqual(
      await countAll(pool),
      pre422,
      'a 422 validation rejection writes zero rows in all six tables'
    );

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
      // Global before/after: scoped residue zero cannot catch a row written
      // outside the tracked ids (a crashed pass, an untracked query); the
      // whole-table counts must return to their pre-run values.
      if (beforeCounts !== null) {
        assert.deepEqual(
          await countAll(pool),
          beforeCounts,
          'whole-table row counts returned to their pre-run values'
        );
      }
    } finally {
      await pool.end();
    }
  }
});
