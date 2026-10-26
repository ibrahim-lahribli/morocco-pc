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
const { assertNoSeedNames } = require('../helpers/seed-guard');
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
  // The committed swap (023) references the result AND the derived candidate, so
  // a swapped pass cannot be deleted without it going first.
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
    // Seed 013 must be applied to THIS BRANCH for the suite to be meaningful:
    // `launch-v2` is the model that declares `use_case_profiles`, and without it
    // the served vocabulary is the legacy pair and OFFICE is unobservable.
    const metaResponse = await app.inject({ method: 'GET', url: '/v1/meta/options' });
    assert.equal(metaResponse.statusCode, 200);
    const options = metaResponse.json().use_cases;
    const useCases = options.map((option) => option.value);
    assert.ok(useCases.includes('GAMING'), 'the seed model requires GPU for GAMING');
    assert.ok(useCases.includes('WORKSTATION'));
    // Order is the JSONB key order of `use_case_profiles` (jsonb does not keep
    // declaration order), so compare the SET, not a sequence.
    assert.deepEqual([...useCases].sort(), ['GAMING', 'OFFICE', 'WORKSTATION'],
      'the branch must have seed 013 applied (launch-v2 active); advertised: ' + JSON.stringify(useCases));
    const office = options.find((option) => option.value === 'OFFICE');
    assert.equal(office.label, 'Bureautique', 'OFFICE is advertised WITH its French label');

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
    assert.equal(post.reused, false, 'the first POST of this key ran its own pass');

    // ---- 1a. the catalog version is REAL, computed and persisted ------------
    // Decision 47: the digest is what a later request compares against, so a
    // null or malformed value here would silently disable reuse forever.
    assert.match(post.catalog_version, /^[0-9a-f]{32}$/, 'the served catalog version is a 32-hex digest');
    const persistedVersion = (await pool.query(
      'SELECT catalog_version FROM recommendation_query WHERE id = $1',
      [post.id]
    )).rows[0].catalog_version;
    assert.equal(persistedVersion, post.catalog_version, 'the served value is the one the ROW records');

    for (const build of post.builds) {
      assert.ok(build.components.length > 0, 'every build carries its components');
      assert.equal(typeof build.total_price, 'number');
      assert.ok(['indicative', 'verified'].includes(build.price_status));
      for (const component of build.components) {
        assert.equal(typeof component.product_id, 'string');
        // Product identity (migration 020), read from the real rows: the name
        // is display_name and the slug is its machine form. A presenter that
        // went back to reading `product.name` serves the `Seed ` prefix and
        // the raw catalogue name, and both assertions below catch it.
        assert.equal(typeof component.name, 'string');
        assert.ok(component.name.length > 0, 'the display name comes from the persisted join');
        assert.equal(typeof component.slug, 'string', 'every post-020 product row carries a slug');
        assert.match(
          component.slug,
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
          'the served slug satisfies chk_product_slug_format: ' + component.slug
        );
        assert.equal(typeof component.price_used, 'number');
        assert.ok(['SEED_UNVERIFIED', 'VERIFIED'].includes(component.offer_class));
        // The seed catalog is 100% seed offers, so the provenance label is real.
        assert.equal(component.offer_class, 'SEED_UNVERIFIED');
      }
    }
    assert.ok(post.builds.every((build) => build.price_status === 'indicative'));

    // The catalog's own rows, not a fixture: 020 backfilled display_name for
    // all 100 products, so no served name may still carry the prefix. This is
    // the assertion that would have failed before 020 was applied.
    assertNoSeedNames(post);
    const seededNames = post.builds.flatMap((build) => build.components.map((c) => c.name));
    assert.ok(seededNames.length > 0, 'the no-Seed assertion above inspected at least one name');

    // ---- 1b. the pass facts came back from the ROWS, so the engine_version
    // the API reports is the one it pushed DOWN to the engine (the Sprint 2
    // handoff), not a value served from the engine's in-memory result.
    for (const build of post.builds) {
      assert.equal(build.engine_version, ENGINE_VERSION, 'each build records the deploy that produced it');
      assert.ok(
        ['PERFORMANCE', 'BALANCED', 'VALUE'].includes(build.strategy_key),
        'each build records the E4 archetype that nominated it: ' + build.strategy_key
      );
    }
    const provenanceRows = (await pool.query(
      'SELECT r.rank, r.engine_version, r.strategy_key FROM recommendation_result r'
      + ' WHERE r.recommendation_query_id = $1 ORDER BY r.rank',
      [post.id]
    )).rows;
    assert.deepEqual(
      provenanceRows.map((row) => row.engine_version),
      post.builds.map(() => ENGINE_VERSION),
      'every persisted result row names the deploy, so the read-back is not a coincidence'
    );
    assert.deepEqual(
      provenanceRows.map((row) => row.strategy_key),
      post.builds.map((build) => build.strategy_key),
      'the served strategy_key is exactly the persisted one, rank for rank'
    );
    assert.ok(
      post.budget_floor.cheapest_total !== null && post.budget_floor.within_budget !== null,
      'the persisted floor is the real diagnostic'
    );

    // ---- 1c. DEDUPE: an identical POST reuses this pass (Sprint 5.1) --------
    // Two assertions matter equally: the SAME id comes back, and no second set
    // of rows is written. The counts are compared against the state the first
    // POST left behind, so this does not depend on the suite running on a
    // pristine database - only on this POST not adding anything.
    const afterFirst = await countAll(pool);
    const repeat = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 20000, currency: 'MAD', use_case: 'GAMING' },
    });
    assert.equal(repeat.statusCode, 200, 'a reuse created a pass it did not need to create, so it is a 200');
    const repeated = repeat.json();
    assert.equal(repeated.reused, true, 'the second identical POST reports the reuse');
    assert.equal(repeated.id, post.id, 'and returns the ORIGINAL id, which is what keeps a share link stable');
    assert.deepEqual(
      await countAll(pool),
      afterFirst,
      'a reused POST writes NOTHING: no second profile, query, candidate, component or result row'
    );
    assert.equal(repeated.catalog_version, post.catalog_version, 'a reuse is the same catalog by construction');
    assert.deepEqual(repeated.builds, post.builds, 'the reused reply is the same persisted answer');

    // ---- 1d. a DIFFERENT request is not a reuse (Sprint 5.2) ---------------
    const differentBudget = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 21000, currency: 'MAD', use_case: 'GAMING' },
    });
    const differentBody = differentBudget.json();
    if (differentBody.id) {
      createdQueryIds.push(differentBody.id);
    }
    // Both statuses are accepted here ON PURPOSE: the property under test is
    // that a different request is not a REUSE, and 21000 MAD may legitimately
    // assemble nothing (200) just as 20000 assembles builds (201). Pinning 201
    // would make this assertion a claim about the catalog rather than about the
    // dedupe key.
    assert.ok(
      differentBudget.statusCode === 201 || differentBudget.statusCode === 200,
      'a different budget still gets a valid answer: got ' + differentBudget.statusCode
    );
    assert.equal(differentBody.reused, false, 'a different budget is never a reuse');
    assert.notEqual(differentBody.id, post.id, 'a different budget gets its own id');

    // ---- 1e. a different DEPLOY is not a reuse (the engine-version half) ---
    // The stored pass's result rows name ENGINE_VERSION; this app answers as a
    // different one, so the pass must NOT be served - a redeploy can change what
    // the engine returns for the same catalog and request.
    const otherDeploy = createApp(pool, { engineVersion: ENGINE_VERSION + '-next' });
    const afterDeploy = await countAll(pool);
    const redeployed = await otherDeploy.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 20000, currency: 'MAD', use_case: 'GAMING' },
    });
    const redeployedBody = redeployed.json();
    if (redeployedBody.id) {
      createdQueryIds.push(redeployedBody.id);
    }
    assert.equal(redeployed.statusCode, 201, 'a new deploy runs its own pass rather than reusing an older one');
    assert.equal(redeployedBody.reused, false);
    assert.notEqual(redeployedBody.id, post.id, 'the older deploy\'s pass is not served');
    const afterDeployCounts = await countAll(pool);
    assert.equal(
      Number(afterDeployCounts.queries),
      Number(afterDeploy.queries) + 1,
      'the new deploy wrote exactly one query row'
    );

    // ---- 2. GET is identical on persisted fields and never re-runs the engine
    let engineCalls = 0;
    const spyApp = createApp(pool, {
      engine: {
        // The third argument MUST be forwarded: engineVersion is what Decision
        // 46 persists onto each result row, and a spy that swallowed it would
        // leave the column NULL and make a read-path test fail for a reason
        // that has nothing to do with the read path.
        async runFullRun(client, queryId, engineVersion) {
          engineCalls += 1;
          return engine.runFullRun(client, queryId, engineVersion);
        },
      },
    });

    const fetched = await spyApp.inject({ method: 'GET', url: '/v1/recommendations/' + post.id });
    assert.equal(fetched.statusCode, 200);
    const get = fetched.json();

    assert.equal(engineCalls, 0, 'GET reads persisted rows only - it never re-runs the engine');
    assert.equal(get.reused, false, 'a GET never reports a reuse: `reused` describes a POST');
    assert.deepEqual(get.builds, post.builds, 'POST and GET agree on every persisted build field');
    assert.equal(get.generated_at, post.generated_at);
    assert.equal(get.budget_amount, post.budget_amount);
    assert.equal(get.use_case, post.use_case);
    assert.equal(get.currency, post.currency);
    assert.equal(get.served_by.engine_version, ENGINE_VERSION);
    // Full-body deep equality with NO exception list. Before migration 019 this
    // had to subtract the two pass-only facts (`budget_floor`, `engine_version`),
    // which GET served as null by contract; they are columns now, so a later GET
    // reproduces the POST reply exactly - including the nested JSONB floor.
    assert.deepEqual(get, post, 'GET equals POST on every field, with no pass-only exception');

    // A SECOND read of the same rows must be byte-identical to the first: the
    // read path is idempotent, and jsonb key order is normalized by the column
    // type rather than by luck of the insert.
    const refetched = await app.inject({ method: 'GET', url: '/v1/recommendations/' + post.id });
    assert.equal(refetched.statusCode, 200);
    assert.deepEqual(refetched.json(), get, 'a second GET reads back byte-identical rows');

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
    // The floor is PERSISTED for a zero-build pass too (Decision 27 computes it
    // unconditionally and Decision 46 writes it unconditionally), so a later GET
    // can still explain the emptiness. A floor that existed only in the POST
    // reply would be exactly the A1/A3 gap migration 019 closed.
    assert.equal(emptyBody.engine_version, null, 'no result row exists, so no pass engine version was recorded');
    assert.equal(emptyBody.served_by.engine_version, ENGINE_VERSION);
    const emptyRow = (await pool.query(
      'SELECT budget_floor FROM recommendation_query WHERE id = $1',
      [emptyBody.id]
    )).rows[0];
    assert.ok(emptyRow.budget_floor !== null, 'the zero-build floor is in the COLUMN, not just the reply');
    assert.equal(emptyRow.budget_floor.within_budget, false);
    const emptyRefetch = await app.inject({ method: 'GET', url: '/v1/recommendations/' + emptyBody.id });
    assert.deepEqual(
      emptyRefetch.json().budget_floor,
      emptyBody.budget_floor,
      'a GET of the empty pass reproduces the floor POST reported'
    );
    assert.equal(emptyRefetch.json().engine_version, null);

    // ---- 3b. a zero-build pass is REUSED too (Sprint scenario 5.5) ---------
    // A committed pass that assembled NOTHING is a valid answer, so a repeat
    // must be served from it - 200 with an empty list, exactly as the first
    // reply was - rather than running a second pass. It is reusable BECAUSE it
    // committed: Decision 46's persistPassFacts writes the floor
    // unconditionally, and this pass's floor exists (the budget is disproven),
    // so `budget_floor IS NOT NULL` holds. The contrast is the
    // EMPTY_CANDIDATE_POOL case, which throws in the read pass - before
    // runRecommendationCommit - and therefore leaves a NULL floor, which is why
    // its `reason` is never lost by a reuse: such a row is not reusable at all.
    const afterEmpty = await countAll(pool);
    const emptyRepeat = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 1000, currency: 'MAD', use_case: 'GAMING' },
    });
    assert.equal(emptyRepeat.statusCode, 200, 'a reused zero-build pass is still a valid 200 answer');
    const emptyRepeated = emptyRepeat.json();
    assert.equal(emptyRepeated.reused, true, 'the committed zero-build pass answers the repeat');
    assert.equal(emptyRepeated.id, emptyBody.id, 'and it hands back the ORIGINAL id');
    assert.deepEqual(emptyRepeated.builds, [], 'still zero builds - emptiness is not an error');
    assert.equal(
      emptyRepeated.reason,
      emptyBody.reason,
      'the reused reply carries the same `reason` the first reply did (both null here)'
    );
    assert.deepEqual(
      await countAll(pool),
      afterEmpty,
      'a reused zero-build POST writes nothing either'
    );

    // ---- 4. vocabulary derived from the REAL model -------------------------
    // The vocabulary is the ACTIVE model's (Decision 37), and with seed 013 on
    // this branch that model is `launch-v2`, which declares OFFICE. So OFFICE is
    // not merely advertised by GET - it survives the POST gate too (OG-38).
    const officePost = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 20000, currency: 'MAD', use_case: 'OFFICE' },
    });
    const officeBody = officePost.json();
    if (officeBody.id) {
      createdQueryIds.push(officeBody.id);
    }
    assert.ok(
      officePost.statusCode === 201 || officePost.statusCode === 200,
      'an advertised use case must be ACCEPTED when the model declares it: got '
        + officePost.statusCode + ' ' + JSON.stringify(officeBody.details || officeBody)
    );
    assert.equal(officeBody.use_case, 'OFFICE', 'the accepted use case is what was persisted');

    // The other direction is unchanged: a value the model does NOT declare is a
    // 422, and it short-circuits BEFORE any INSERT, so nothing may be written.
    const pre422 = await countAll(pool);
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: { budget_amount: 20000, currency: 'MAD', use_case: 'STREAMING' },
    });
    assert.equal(rejected.statusCode, 422, 'STREAMING is declared by no active model');
    assert.match(rejected.json().details[0].message, /GAMING, OFFICE, WORKSTATION/,
      'the 422 names the vocabulary the active model actually declares');
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
