'use strict';

/**
 * apps/api/test/db/presets.db.test.js - GET /v1/presets and the generator that
 * fills it, against REAL rows.
 *
 * TEST BRANCH ONLY. `resolveTestDbUrl` runs at module scope and throws when
 * TEST_DATABASE_URL is absent or points at the shared endpoint, so a missing
 * environment fails the suite loudly instead of skipping it.
 *
 * What only a real database can prove, and therefore what these tests are for:
 *
 *   1. The derived `price_status` is computed from rows the statement actually
 *      reads. A stub asserts what the ROUTE does with counts; only real
 *      `recommendation_result` / `build_component` rows prove the COUNTS are
 *      right - and one wrong count here is a landing page claiming a verified
 *      price it cannot substantiate.
 *   2. A superseded catalog version is INVISIBLE, not merely least-preferred. The
 *      endpoint selects by the current version, and this is the read that decides
 *      whether a price update answers with the builds it just invalidated.
 *   3. The generator's idempotency holds through the real writer: a key that
 *      already has a preset runs NO pass, and a second run writes nothing. The
 *      proof is a row count and a pass count that do not move - plus the
 *      endpoint serving the id the first run created.
 *   4. The endpoint's answer and `GET /v1/recommendations/{id}` agree: a preset
 *      is a POINTER to an ordinary pass, so following it must land on the same
 *      pass, at the same catalog version. A second write path for presets would
 *      break that, which is why the generator reuses the API's own.
 *
 * The transaction in the first test runs on a DEDICATED connection, not on the
 * Pool: `pool.query('BEGIN')` would check a connection out for the BEGIN and
 * release it again, so the following statements could land on a different
 * connection and the closing ROLLBACK would undo nothing while looking correct.
 * A checked-out client is the only form in which a BEGIN means what it says.
 *
 * The second test runs a real pass, which CANNOT be rolled back (the engine's
 * commit owns its own transaction, so an outer BEGIN would be ended by the inner
 * COMMIT - the reason a seed carrying its own COMMIT cannot be rehearsed inside
 * one either). It therefore cleans up explicitly, in dependency order, and
 * asserts residue LAST - scoped to what it created, never whole-table.
 *
 * WHY THE RESIDUE CHECK IS SCOPED, measured 2026-10-16: `node --test` runs the
 * db suite's files in PARALLEL processes, and `recommendations.db.test.js`
 * commits real passes while this file runs. A whole-table before/after
 * comparison therefore measures the OTHER suite's work as if it were ours - it
 * failed here with profiles 1 -> 2 and results 0 -> 1 under a cleanup that was
 * in fact complete. Scoping to this test's own key, pass ids and profile ids is
 * both honest and stable. The one global count kept is `recommendation_preset`,
 * because no other suite writes that table.
 */

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool, Client } = require('pg');

const { resolveTestDbUrl, getWriteTestDbUrl } = require('../../../../scripts/lib/db-url');
const { buildApp } = require('../../src/app');
const repository = require('../../src/repository');
const engine = require('../../src/engine');
const { STATEMENT_TIMEOUT_MS } = require('../../src/db');
const { priceStatusFor } = require('../../src/routes/presets');
const generator = require('../../../../scripts/generate-presets');

const ENGINE_VERSION = 'db-test-sha';
const CURRENCY = 'MAD';
/** The ribbon's cheapest budget: one pass is enough to prove the key. */
const TEST_BUDGET = 6000;

// Module scope on purpose: an unusable environment fails the file, not a test.
const POOL_CONFIG = resolveTestDbUrl(process.env);

/** Two distinct, well-formed digests - the values only need to differ. */
const VERSION_CURRENT = 'a'.repeat(32);
const VERSION_SUPERSEDED = 'b'.repeat(32);
const VERSION_UNKNOWN = 'c'.repeat(32);

function createPool() {
  return new Pool({
    connectionString: POOL_CONFIG.connectionString,
    connectionTimeoutMillis: POOL_CONFIG.connectionTimeoutMillis,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: 'morocco-pc-presets-test',
  });
}

/** A dedicated connection, the only form in which BEGIN means anything. */
async function createClient() {
  const client = new Client({ ...POOL_CONFIG, application_name: 'morocco-pc-presets-test' });
  await client.connect();
  return client;
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

/** How many preset rows exist anywhere - only this suite writes that table. */
async function presetCount(db) {
  return (await db.query('SELECT count(*)::int AS n FROM recommendation_preset')).rows[0].n;
}

/** The active model, chosen exactly the way the API's repository chooses it. */
async function activeModel(db) {
  const row = (await db.query(
    'SELECT id, configuration FROM scoring_model WHERE is_active = true'
    + ' ORDER BY created_at DESC, id ASC LIMIT 1'
  )).rows[0];
  assert.ok(row, 'the TEST branch must have an active scoring model for this suite to mean anything');
  return row;
}

/** One real product, ordered so the choice is deterministic (never a bare LIMIT 1). */
async function anyProductId(db) {
  return (await db.query('SELECT id FROM product ORDER BY id ASC LIMIT 1')).rows[0].id;
}

/**
 * A minimal, valid query row. `id` is OMITTED rather than passed as NULL - the
 * column's `gen_random_uuid()` DEFAULT applies only to an omitted column, so the
 * `RETURNING id` is the only id and it is the one the row really has.
 */
async function insertQuery(db, modelId, useCase, budgetAmount, catalogVersion) {
  return (await db.query(
    'INSERT INTO recommendation_query'
    + ' (scoring_model_id, budget_amount, currency, use_case, catalog_version)'
    + ' VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [modelId, budgetAmount, CURRENCY, useCase, catalogVersion]
  )).rows[0].id;
}

/**
 * A committed pass's result: one rank-1 build with the given components.
 * `score` is a NUMERIC string, exactly as pg would hand it back - the presenter
 * converts, and a JS number here would hide a conversion that stopped working.
 */
async function insertBuild(db, queryId, options) {
  const candidateId = (await db.query(
    'INSERT INTO build_candidate (recommendation_query_id, total_price, score, compatibility_status)'
    + " VALUES ($1, $2, $3, 'PASS') RETURNING id",
    [queryId, options.totalPrice || '9000.00', options.score]
  )).rows[0].id;

  await db.query(
    'INSERT INTO recommendation_result (recommendation_query_id, build_candidate_id, rank, engine_version)'
    + ' VALUES ($1, $2, 1, $3)',
    [queryId, candidateId, ENGINE_VERSION]
  );

  for (const component of options.components) {
    await db.query(
      'INSERT INTO build_component'
      + ' (build_candidate_id, product_id, component_role, selected_price, currency, offer_class)'
      + ' VALUES ($1, $2, $3, $4, $5, $6)',
      [candidateId, component.productId, component.role || 'CPU', '1999.00', CURRENCY, component.offerClass]
    );
  }
  return candidateId;
}

/** How many preset rows exist for one exact key. */
async function presetRowsFor(db, key) {
  return (await db.query(
    'SELECT count(*)::int AS n FROM recommendation_preset'
    + ' WHERE use_case = $1 AND currency = $2 AND catalog_version = $3 AND budget_amount = $4',
    [key.useCase, key.currency, key.catalogVersion, key.budgetAmount]
  )).rows[0].n;
}

/**
 * Residue for THIS test, scoped to the key and ids it created (see the header
 * for why a whole-table comparison is not stable here).
 *
 * `preset_rows_in_scope` counts every preset of this test's `(use_case,
 * currency, catalog_version)` scope, not just its own ids: the cleanup deletes
 * that scope, so a surviving row would be an untracked leak. The remaining
 * counts are by id - the passes this run created, their result/candidate/
 * component/rejection rows, and the profiles captured before the passes were
 * removed (the FK runs query -> profile with NO ACTION, so the query must go
 * first and the profile id has to be captured while it still exists).
 */
async function residueFor(db, key, queryIds, profileIds) {
  const result = await db.query(
    'SELECT'
    + ' (SELECT count(*)::int FROM recommendation_preset'
    + '   WHERE use_case = $1 AND currency = $2 AND catalog_version = $3) AS preset_rows_in_scope,'
    + ' (SELECT count(*)::int FROM recommendation_query WHERE id = ANY($4::uuid[])) AS queries,'
    + ' (SELECT count(*)::int FROM recommendation_profile WHERE id = ANY($5::uuid[])) AS profiles,'
    + ' (SELECT count(*)::int FROM recommendation_result WHERE recommendation_query_id = ANY($4::uuid[])) AS results,'
    + ' (SELECT count(*)::int FROM build_candidate WHERE recommendation_query_id = ANY($4::uuid[])) AS candidates,'
    + ' (SELECT count(*)::int FROM build_component WHERE build_candidate_id IN'
    + '   (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($4::uuid[]))) AS components,'
    + ' (SELECT count(*)::int FROM build_rejection WHERE recommendation_query_id = ANY($4::uuid[])) AS rejections',
    [key.useCase, key.currency, key.catalogVersion, queryIds, profileIds]
  );
  return result.rows[0];
}

test('the presets read derives status from real rows, and a superseded catalog version stays invisible', async () => {
  const client = await createClient();
  const tracked = [];
  let rolledBack = false;

  try {
    const model = await activeModel(client);
    const productId = await anyProductId(client);
    const otherUseCase = engine.useCaseVocabulary(model.configuration)
      .find((value) => value !== 'GAMING');
    assert.ok(otherUseCase, 'the active model must declare a second use case for the scoping assertion to mean anything');

    await client.query('BEGIN');

    // Five GAMING passes at the CURRENT version, one per derivation state, plus
    // two rows that must NOT appear in the answer: a superseded version's row and
    // a different use case's row.
    const noBuild = await insertQuery(client, model.id, 'GAMING', 6000, VERSION_CURRENT);
    const verified = await insertQuery(client, model.id, 'GAMING', 8000, VERSION_CURRENT);
    const indicative = await insertQuery(client, model.id, 'GAMING', 10000, VERSION_CURRENT);
    const superseded = await insertQuery(client, model.id, 'GAMING', 6000, VERSION_SUPERSEDED);
    const listed = await insertQuery(client, model.id, 'GAMING', 12000, VERSION_CURRENT);
    const other = await insertQuery(client, model.id, otherUseCase, 6000, VERSION_CURRENT);
    tracked.push(noBuild, verified, indicative, superseded, listed, other);

    // `noBuild` stays a committed pass with NOTHING assembled (no result row at
    // all). The other two carry one rank-1 build each, differing ONLY in the
    // component's offer_class - which is the whole input to the derived status.
    await insertBuild(client, verified, {
      score: '61.25',
      components: [{ productId, offerClass: 'VERIFIED' }],
    });
    await insertBuild(client, indicative, {
      score: '58.15',
      components: [{ productId, offerClass: 'SEED_UNVERIFIED' }],
    });

    await repository.upsertPreset(client, {
      useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_CURRENT, budgetAmount: 6000, queryId: noBuild,
    });
    await repository.upsertPreset(client, {
      useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_CURRENT, budgetAmount: 8000, queryId: verified,
    });
    await repository.upsertPreset(client, {
      useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_CURRENT, budgetAmount: 10000, queryId: indicative,
    });
    await repository.upsertPreset(client, {
      useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_SUPERSEDED, budgetAmount: 6000, queryId: superseded,
    });
    await repository.upsertPreset(client, {
      useCase: otherUseCase, currency: CURRENCY, catalogVersion: VERSION_CURRENT, budgetAmount: 6000, queryId: other,
    });

    const rows = await repository.selectPresets(client, {
      useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_CURRENT,
    });

    // Cheapest first, and ONLY the current version's GAMING rows: the superseded
    // row and the other use case are absent, which is what makes a price update
    // unable to answer with the builds it invalidated.
    assert.deepEqual(rows.map((row) => row.budget_amount), ['6000', '8000', '10000']);
    assert.deepEqual(rows.map((row) => row.recommendation_id), [noBuild, verified, indicative]);

    // The counts the derivation stands on, straight from the statement.
    assert.deepEqual(
      rows.map((row) => [row.build_count, row.rank1_component_count, row.rank1_unverified_count]),
      [
        [0, 0, 0], // assembled nothing: no result rows at all
        [1, 1, 0], // one component, and it IS verified
        [1, 1, 1], // one component, and it is not
      ]
    );
    assert.deepEqual(rows.map((row) => row.build_score), [null, '61.25', '58.15']);
    // The derived status, through the ROUTE's own helper rather than a copy: a
    // second implementation here would agree with itself and prove nothing.
    assert.deepEqual(rows.map((row) => priceStatusFor(row)), [null, 'verified', 'indicative']);

    // An UNKNOWN catalog version matches nothing - a miss, never a match
    // (Decision 47 item 10) - so no reply can be built from rows whose catalog
    // state nobody recorded.
    assert.deepEqual(
      await repository.selectPresets(client, {
        useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_UNKNOWN,
      }),
      []
    );
    // And the use case is part of the key, not a filter applied afterwards.
    assert.deepEqual(
      (await repository.selectPresets(client, {
        useCase: otherUseCase, currency: CURRENCY, catalogVersion: VERSION_CURRENT,
      })).map((row) => row.budget_amount),
      ['6000']
    );

    // The key lookup the generator's SKIP stands on: exact on all four parts.
    assert.equal(
      await repository.findPresetQueryId(client, {
        useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_CURRENT, budgetAmount: 6000,
      }),
      noBuild
    );
    assert.equal(
      await repository.findPresetQueryId(client, {
        useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_UNKNOWN, budgetAmount: 6000,
      }),
      null
    );

    // Replace-idempotence at the ROW level (Decision 31's convention): writing
    // the same key again converges on ONE row and MOVES the pointer, rather than
    // raising 23505. The pointer's abandoned pass is exactly what the generator's
    // skip check exists to prevent in normal operation, since nothing would then
    // reference it.
    const replaced = await repository.upsertPreset(client, {
      useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_CURRENT, budgetAmount: 6000, queryId: listed,
    });
    assert.equal(replaced.queryId, listed);
    assert.equal(await presetRowsFor(client, {
      useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_CURRENT, budgetAmount: 6000,
    }), 1, 'still ONE row for the key, not two');

    // Replace-idempotence must not be bought by dropping the row's identity: a
    // second key for the same family is a separate landing page.
    assert.equal(await presetRowsFor(client, {
      useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_CURRENT, budgetAmount: 10000,
    }), 1, 'the other budget in the same family is untouched');

    // Pruning a family down to the current version returns the passes it
    // superseded, so their dependent rows can be removed with them.
    const pruned = await repository.deleteSupersededPresets(client, {
      useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_CURRENT, budgetAmount: 6000,
    });
    assert.deepEqual(pruned, [superseded]);
    assert.deepEqual(
      await repository.selectPresets(client, {
        useCase: 'GAMING', currency: CURRENCY, catalogVersion: VERSION_SUPERSEDED,
      }),
      []
    );

    await client.query('ROLLBACK');
    rolledBack = true;
  } finally {
    if (!rolledBack) {
      await client.query('ROLLBACK').catch(() => {});
    }
    // Residue is checked, not assumed: "it was rolled back" is a claim.
    const residue = await client.query(
      'SELECT'
      + ' (SELECT count(*)::int FROM recommendation_preset WHERE query_id = ANY($1::uuid[])) AS presets,'
      + ' (SELECT count(*)::int FROM recommendation_query WHERE id = ANY($1::uuid[])) AS queries,'
      + ' (SELECT count(*)::int FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])) AS results,'
      + ' (SELECT count(*)::int FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])) AS candidates',
      [tracked]
    );
    assert.deepEqual(residue.rows[0], { presets: 0, queries: 0, results: 0, candidates: 0 });
    await client.end().catch(() => {});
  }
});

test('a generated ribbon is idempotent per key and is served by GET /v1/presets', async () => {
  const pool = createPool();
  const app = createApp(pool);
  const created = [];
  let key = null;
  let presetsBefore = null;
  let writer = null;

  try {
    presetsBefore = await presetCount(pool);
    const model = await activeModel(pool);
    const vocabulary = engine.useCaseVocabulary(model.configuration);
    assert.ok(Array.isArray(vocabulary) && vocabulary.length > 0, 'the active model must declare a vocabulary');
    const useCase = vocabulary.includes('GAMING') ? 'GAMING' : vocabulary[0];
    const catalogVersion = await engine.catalogVersion(pool);

    // The ribbon's cheapest budget: this suite runs ONE pass, because the KEY is
    // what is under test, not the ribbon width.
    key = {
      scoringModelId: model.id,
      useCase,
      currency: CURRENCY,
      catalogVersion,
      budgetAmount: TEST_BUDGET,
    };

    // The generator writes through the guarded TEST-branch client, the same one
    // the CLI uses - never the shared database.
    writer = new Client({ ...getWriteTestDbUrl(), connectionTimeoutMillis: 15000 });
    await writer.connect();

    assert.equal(await repository.findPresetQueryId(writer, key), null, 'the key is new before the run');
    assert.equal(await presetRowsFor(writer, key), 0);

    const first = await generator.ensureKey(writer, key);
    assert.equal(first.status, 'created', 'a miss must run one pass and record it');
    created.push(first.queryId);

    // Recorded, and findable by the exact key - which is what makes the second
    // run a skip rather than a second pass.
    assert.equal(await repository.findPresetQueryId(writer, key), first.queryId);
    assert.equal(await presetRowsFor(writer, key), 1);

    // Served by the endpoint, at the version the route itself computed. This is
    // the acceptance the sprint is for: generated, persisted, served.
    const served = await app.inject({
      method: 'GET',
      url: '/v1/presets?use_case=' + encodeURIComponent(useCase) + '&currency=' + CURRENCY,
    });
    assert.equal(served.statusCode, 200);
    const body = served.json();
    assert.equal(body.catalog_version, catalogVersion, 'the reply names the catalog it selected by');
    const entry = body.presets.find((preset) => preset.budget_amount === key.budgetAmount);
    assert.ok(entry, 'the generated budget is served');
    assert.equal(entry.recommendation_id, first.queryId);
    assert.ok(
      entry.price_status === 'verified' || entry.price_status === 'indicative' || entry.price_status === null,
      'the derived status is one of the three contract values'
    );

    // A preset is a POINTER, not a copy: following it lands on the same pass,
    // read through the same statement the POST reply uses.
    const followed = await app.inject({ method: 'GET', url: '/v1/recommendations/' + first.queryId });
    assert.equal(followed.statusCode, 200, 'the preset points at a real recommendation');
    assert.equal(followed.json().catalog_version, catalogVersion);
    assert.equal(followed.json().use_case, useCase);
    assert.equal(followed.json().budget_amount, key.budgetAmount);

    // THE IDEMPOTENCY CLAIM: a second run of the same key runs NO pass and writes
    // NOTHING. Asserted three ways, because each alone is weak - the returned
    // status could lie, the upsert could restore the row count, and the pass
    // count is what catches a second pass.
    const passesBeforeSecondRun = (await pool.query(
      'SELECT count(*)::int AS n FROM recommendation_query WHERE id = ANY($1::uuid[])', [created]
    )).rows[0].n;
    const second = await generator.ensureKey(writer, key);
    assert.equal(second.status, 'kept', 'the second run must skip, not regenerate');
    assert.equal(second.queryId, first.queryId, 'and it must keep the ORIGINAL pass');
    assert.equal(await presetRowsFor(writer, key), 1, 'no duplicate row');
    assert.equal(
      (await pool.query(
        'SELECT count(*)::int AS n FROM recommendation_query WHERE id = ANY($1::uuid[])', [created]
      )).rows[0].n,
      passesBeforeSecondRun,
      'and no second pass: the tracked pass count is unchanged'
    );
  } finally {
    // Cleanup order is dependency order, and each step is independent: a throw in
    // one must not skip the next, or the residue assertion would report a failure
    // the skipped step caused.
    const failures = [];
    const createdIds = [...new Set(created.filter((id) => typeof id === 'string'))];
    let profileIds = [];

    if (writer !== null) {
      // Captured BEFORE the passes are deleted: the profile id lives on the
      // query row, and the FK runs query -> profile with NO ACTION.
      try {
        profileIds = (await writer.query(
          'SELECT DISTINCT recommendation_profile_id AS id FROM recommendation_query'
          + ' WHERE id = ANY($1::uuid[]) AND recommendation_profile_id IS NOT NULL',
          [createdIds]
        )).rows.map((row) => row.id);
      } catch (error) {
        failures.push('capture profile ids: ' + error.message);
      }
      try {
        // Scoped to this key - never global, so a concurrent run's rows are not
        // collaterally deleted.
        await repository.deletePresets(writer, {
          useCase: key ? key.useCase : null,
          currency: CURRENCY,
          catalogVersion: key ? key.catalogVersion : null,
        });
      } catch (error) {
        failures.push('deletePresets: ' + error.message);
      }
      try {
        // EVERY pass this test created, tracked rather than derived from the
        // preset rows: a pointer that moved would leave its pass unreferenced,
        // and an unreferenced query row is what blocks the golden harness.
        await generator.deletePasses(writer, createdIds);
      } catch (error) {
        failures.push('deletePasses: ' + error.message);
      }
      await writer.end().catch(() => {});
    }

    assert.deepEqual(failures, [], 'cleanup must run to completion');
    if (key !== null) {
      assert.deepEqual(
        await residueFor(pool, key, createdIds, profileIds),
        {
          preset_rows_in_scope: 0,
          queries: 0,
          profiles: 0,
          results: 0,
          candidates: 0,
          components: 0,
          rejections: 0,
        },
        'every row this test created must be gone'
      );
    }
    if (presetsBefore !== null) {
      // Global on purpose: no other db suite writes `recommendation_preset`, so
      // this one count IS stable under the parallel run.
      assert.equal(await presetCount(pool), presetsBefore, 'no preset row anywhere leaked');
    }
    await pool.end();
  }
});
