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

const { resolveTestDbUrl, getWriteTestDbUrl } = require('../../../../packages/database-guard/src');
const { buildApp } = require('../../src/app');
const repository = require('../../src/repository');
const engine = require('../../src/engine');
const { STATEMENT_TIMEOUT_MS } = require('../../src/db');
const { priceStatusFor } = require('../../src/routes/presets');
const generator = require('../../../../scripts/generate-presets');

const ENGINE_VERSION = 'db-test-sha';
const CURRENCY = 'MAD';
/**
 * A budget the catalog can actually build at. Deliberately NOT the ribbon's
 * cheapest (6 000): since R-26 a key whose pass assembles nothing is recorded
 * nowhere, and 6 000 sits in the measured zero-build band - the cheapest real
 * build was ~7 877 MAD on 2026-10-02 (AGENTS.md section 6) - so that value could
 * only ever assert the PRE-R-26 behaviour, a preset pointing at `builds: []`.
 * 12 000 clears the band with headroom for either declared use case, and one
 * pass is still all this test needs to prove the key.
 */
const TEST_BUDGET = 12000;

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
 *
 * `explicitId` exists for exactly one purpose: forcing a DETERMINISTIC failure.
 * Passing an id that is already taken raises 23505 without a race, a timeout or
 * an outage, which is how the partial-setup test drives its second insert to
 * fail.
 */
async function insertQuery(db, modelId, useCase, budgetAmount, catalogVersion, explicitId = null) {
  if (explicitId !== null) {
    return (await db.query(
      'INSERT INTO recommendation_query'
      + ' (id, scoring_model_id, budget_amount, currency, use_case, catalog_version)'
      + ' VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [explicitId, modelId, budgetAmount, CURRENCY, useCase, catalogVersion]
    )).rows[0].id;
  }
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

/** How many pass rows exist for these exact ids. */
async function queryRowsFor(db, queryIds) {
  return (await db.query(
    'SELECT count(*)::int AS n FROM recommendation_query WHERE id = ANY($1::uuid[])',
    [queryIds]
  )).rows[0].n;
}

/**
 * Insert a preset row for a key WITHOUT replacing an existing one, and return
 * the query id it wrote - or null when the key was already occupied.
 *
 * `repository.upsertPreset` is deliberately replace-idempotent
 * (`ON CONFLICT ... DO UPDATE SET query_id = EXCLUDED.query_id`), which is right
 * for the generator and wrong for an ownership fixture: on a database that
 * already carries the key, an upsert would MOVE a preset this test does not own,
 * and the cleanup that follows would delete the pointer it had just moved while
 * the original pass stayed behind, orphaned. `DO NOTHING` makes a collision a
 * no-op instead, so the fixture fails loudly and the pre-existing row keeps its
 * original query id and pass.
 */
async function insertOwnedPresetRow(db, key, queryId) {
  const rows = (await db.query(
    'INSERT INTO recommendation_preset (use_case, currency, catalog_version, budget_amount, query_id)'
    + ' VALUES ($1, $2, $3, $4, $5)'
    + ' ON CONFLICT (use_case, currency, catalog_version, budget_amount) DO NOTHING'
    + ' RETURNING query_id',
    [key.useCase, key.currency, key.catalogVersion, key.budgetAmount, queryId]
  )).rows;
  return rows.length === 1 ? rows[0].query_id : null;
}

/**
 * THE CLEANUP CONTRACT, in one place: every pass id this run OWNS, removed by
 * identity, in dependency order, each step independent of the last.
 *
 * The callers all register an id the moment its insert COMMITS - never after the
 * whole fixture succeeded - because a setup that throws between two inserts must
 * still be able to name the row the first one wrote. A registration that waited
 * for the end of the setup would leave that row orphaned, which is the state the
 * golden harness refuses to run beside.
 *
 * @param {object} client the writer connection
 * @param {string[]} createdIds every pass id this run created and owns
 * @returns {Promise<{failures: string[], profileIds: string[]}>} what failed, and
 *   the profile ids captured before their passes went (the FK query -> profile
 *   runs with NO ACTION, so the query must be deleted first and its profile id
 *   read while the row still exists)
 */
async function runOwnedCleanup(client, createdIds) {
  const failures = [];
  let profileIds = [];

  try {
    profileIds = (await client.query(
      'SELECT DISTINCT recommendation_profile_id AS id FROM recommendation_query'
      + ' WHERE id = ANY($1::uuid[]) AND recommendation_profile_id IS NOT NULL',
      [createdIds]
    )).rows.map((row) => row.id);
  } catch (error) {
    failures.push('capture profile ids: ' + error.message);
  }
  try {
    // By the ids this run created - never by key scope, and never global, so a
    // sibling budget or a concurrent run's rows are not collaterally deleted.
    await deleteCreatedPresets(client, createdIds);
  } catch (error) {
    failures.push('deleteCreatedPresets: ' + error.message);
  }
  try {
    // EVERY pass this run created, tracked rather than derived from the preset
    // rows: a pointer that moved would leave its pass unreferenced.
    await generator.deletePasses(client, createdIds);
  } catch (error) {
    failures.push('deletePasses: ' + error.message);
  }

  return { failures, profileIds };
}

/**
 * Remove ONLY the preset rows this run created, named by the passes they point
 * at. Never by key scope: every sibling budget at the same catalog version
 * shares that scope, and a sibling is not this run's row to delete. Measured
 * 2026-11-25 on the nightly: a scope delete removed 17 sibling rows and the
 * global tripwire below reported `36 !== 53` for a cleanup that was entirely
 * successful. The failure was in the CLAIM, not the cleanup.
 */
async function deleteCreatedPresets(client, createdIds) {
  return repository.deletePresetByQueryId(client, createdIds);
}

/**
 * Residue for THIS test, scoped to the ids it created (see the header for why a
 * whole-table comparison is not stable here).
 *
 * Every count is by id, `preset_rows` included: the cleanup deletes the preset
 * rows whose `query_id` is this run's, so a row still pointing at one of these
 * passes is a leak, while a sibling preset pointing somewhere else is simply not
 * this test's business. The remaining counts are the passes this run created,
 * their result/candidate/component/rejection rows, and the profiles captured
 * before the passes were removed (the FK runs query -> profile with NO ACTION,
 * so the query must go first and the profile id has to be captured while it
 * still exists).
 */
async function residueFor(db, queryIds, profileIds) {
  const result = await db.query(
    'SELECT'
    + ' (SELECT count(*)::int FROM recommendation_preset'
    + '   WHERE query_id = ANY($1::uuid[])) AS preset_rows,'
    + ' (SELECT count(*)::int FROM recommendation_query WHERE id = ANY($1::uuid[])) AS queries,'
    + ' (SELECT count(*)::int FROM recommendation_profile WHERE id = ANY($2::uuid[])) AS profiles,'
    + ' (SELECT count(*)::int FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])) AS results,'
    + ' (SELECT count(*)::int FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])) AS candidates,'
    + ' (SELECT count(*)::int FROM build_component WHERE build_candidate_id IN'
    + '   (SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[]))) AS components,'
    + ' (SELECT count(*)::int FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])) AS rejections',
    [queryIds, profileIds]
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
      const cleanup = await runOwnedCleanup(writer, createdIds);
      failures.push(...cleanup.failures);
      profileIds = cleanup.profileIds;
      await writer.end().catch(() => {});
    }

    assert.deepEqual(failures, [], 'cleanup must run to completion');
    if (key !== null) {
      assert.deepEqual(
        await residueFor(pool, createdIds, profileIds),
        {
          preset_rows: 0,
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

/**
 * THE CLEANUP CONTRACT, which the nightly test:api:db run found broken.
 *
 * The cleanup above used to delete by KEY SCOPE - `deletePresets` with
 * (use_case, currency, catalog_version) - while the tripwire below it asserts a
 * GLOBAL preset count. On a database carrying a real shelf (a catalog version
 * with 17 generated budgets), the cleanup deleted 17 rows it never wrote and the
 * tripwire reported `36 !== 53`: the test destroyed data, then blamed itself.
 *
 * So the property is not "the scope is empty afterwards". It is "what this run
 * wrote is gone, and what it did not write is untouched" - which only ids can
 * decide. This test plants both: one sibling row in exactly the same scope and
 * one row of its own, then runs the SAME cleanup helper the suite's finally
 * block runs. On a scope delete the sibling disappears; on an id delete it must
 * survive.
 */
test('cleanup deletes only the rows this run created: a sibling budget in the same scope survives', async () => {
  const writer = new Client({ ...getWriteTestDbUrl(), connectionTimeoutMillis: 15000 });
  let mineKey = null;
  let siblingKey = null;
  const createdIds = [];

  try {
    await writer.connect();
    const model = await activeModel(writer);
    const vocabulary = engine.useCaseVocabulary(model.configuration);
    const useCase = vocabulary.includes('GAMING') ? 'GAMING' : vocabulary[0];
    const catalogVersion = await engine.catalogVersion(writer);

    // Two budgets in ONE scope - same use case, currency and catalog version.
    // Deliberately not the suite's TEST_BUDGET: this test asserts survival, not
    // generation, so it must not race the other test's key for any reason.
    mineKey = {
      scoringModelId: model.id, useCase, currency: CURRENCY, catalogVersion, budgetAmount: 41000,
    };
    siblingKey = {
      scoringModelId: model.id, useCase, currency: CURRENCY, catalogVersion, budgetAmount: 42000,
    };

    // Registered the moment each insert COMMITS: a throw between the two must
    // still leave the first pass known to the cleanup below.
    const siblingQueryId = await insertQuery(writer, model.id, useCase, siblingKey.budgetAmount, catalogVersion);
    createdIds.push(siblingQueryId);
    const mineQueryId = await insertQuery(writer, model.id, useCase, mineKey.budgetAmount, catalogVersion);
    createdIds.push(mineQueryId);

    // Insert-only, never `upsertPreset`: a fixture that REPLACED an existing
    // pointer would take ownership of a row this test did not write, and the
    // cleanup below would then delete the pointer it had just moved. A null here
    // means another run already owns the key; the assertion is the failure, the
    // pre-existing row keeps its own query_id and pass, and `finally` deletes
    // only the ids in `createdIds`.
    assert.equal(
      await insertOwnedPresetRow(writer, siblingKey, siblingQueryId),
      siblingQueryId,
      'the sibling fixture key must be free for this run'
    );
    assert.equal(
      await insertOwnedPresetRow(writer, mineKey, mineQueryId),
      mineQueryId,
      'the fixture key must be free for this run'
    );

    // Precondition: without two live rows in one scope the assertion below would
    // pass on an empty database for the wrong reason.
    assert.equal(await presetRowsFor(writer, siblingKey), 1);
    assert.equal(await presetRowsFor(writer, mineKey), 1);

    const deleted = await deleteCreatedPresets(writer, [mineQueryId]);
    assert.deepEqual(deleted, [mineQueryId], 'it removes the row it was given, by id');

    // The row this run created is gone...
    assert.equal(await presetRowsFor(writer, mineKey), 0);
    assert.equal(await repository.findPresetQueryId(writer, mineKey), null);

    // ...and the sibling, in the SAME scope, is untouched. A scope delete makes
    // this assertion fail, which is exactly the nightly's `36 !== 53`.
    assert.equal(await presetRowsFor(writer, siblingKey), 1, 'a sibling budget in the same scope must survive');
    assert.equal(await repository.findPresetQueryId(writer, siblingKey), siblingQueryId);
  } finally {
    // Corners are cleaned even on a failed assertion, through the SAME helper
    // the fixture uses: by id, each step independent of the last.
    const failures = [];
    let residue = null;
    const cleanup = await runOwnedCleanup(writer, createdIds);
    failures.push(...cleanup.failures);
    // Measured AFTER the passes are gone: residueFor counts them by id, so
    // measuring first would report the rows this very block is about to delete
    // and the assertion below could never reach `queries: 0`.
    try {
      residue = await residueFor(writer, createdIds, cleanup.profileIds);
    } catch (error) {
      failures.push('residueFor: ' + error.message);
    }
    await writer.end().catch(() => {});
    assert.deepEqual(failures, [], 'cleanup must run to completion');
    assert.deepEqual(residue, {
      preset_rows: 0,
      queries: 0,
      profiles: 0,
      results: 0,
      candidates: 0,
      components: 0,
      rejections: 0,
    }, 'this test leaves nothing of its own behind');
  }
});

/**
 * THE FIXTURE'S OTHER HALF: the key is ALREADY taken.
 *
 * The regression test above proves the cleanup is id-safe, but it used to create
 * its fixtures with `repository.upsertPreset` - replace-idempotent on purpose.
 * On a persistent TEST database that already carried either fixture key, the
 * fixture would have MOVED the existing pointer, and the cleanup would then have
 * deleted the row it had just moved: a preset the test never wrote, destroyed,
 * with its original pass left orphaned. The throwaway shelf that verified this
 * PR avoided those two budgets, so the collision was never exercised.
 *
 * The fixture is insert-only now (`ON CONFLICT DO NOTHING`), and this test proves
 * the consequence rather than the statement text: a taken key reports that no
 * row was inserted, the pre-existing row keeps its original pointer and pass, and
 * the cleanup path run afterwards deletes neither.
 */
test('a fixture key that is already taken fails without touching the row that owns it', async () => {
  const writer = new Client({ ...getWriteTestDbUrl(), connectionTimeoutMillis: 15000 });
  const createdIds = []; // passes this test wrote for the ATTEMPT
  const plantedIds = []; // the pre-existing preset's pass
  let key = null;

  try {
    await writer.connect();
    const model = await activeModel(writer);
    const vocabulary = engine.useCaseVocabulary(model.configuration);
    const useCase = vocabulary.includes('GAMING') ? 'GAMING' : vocabulary[0];
    const catalogVersion = await engine.catalogVersion(writer);

    // A third budget outside the ribbon (6 000-40 000 in 2 000 steps) and
    // distinct from the two the sibling test uses, so the fixtures cannot
    // collide with each other.
    key = {
      scoringModelId: model.id, useCase, currency: CURRENCY, catalogVersion, budgetAmount: 43000,
    };

    // The PRE-EXISTING preset: a row at this key that this test must not own.
    const plantedQueryId = await insertQuery(writer, model.id, useCase, key.budgetAmount, catalogVersion);
    plantedIds.push(plantedQueryId);
    assert.equal(
      await insertOwnedPresetRow(writer, key, plantedQueryId),
      plantedQueryId,
      'the planted row must be new; a null here is residue from an earlier failed run'
    );

    // The fixture attempt at the SAME key, carrying a pass of its own.
    const attemptQueryId = await insertQuery(writer, model.id, useCase, key.budgetAmount, catalogVersion);
    createdIds.push(attemptQueryId);

    // The insert reports that NOTHING was written...
    assert.equal(
      await insertOwnedPresetRow(writer, key, attemptQueryId),
      null,
      'a taken key must report that no row was inserted, never replace the pointer'
    );
    // ...the key still has exactly one row, pointing at the pre-existing pass...
    assert.equal(await presetRowsFor(writer, key), 1, 'the collision must neither add nor remove a row');
    assert.equal(
      await repository.findPresetQueryId(writer, key),
      plantedQueryId,
      'the pre-existing pointer is unchanged'
    );
    // ...and neither pass was replaced or removed.
    assert.equal(await queryRowsFor(writer, [plantedQueryId]), 1, 'the pre-existing pass survives');
    assert.equal(await queryRowsFor(writer, [attemptQueryId]), 1, 'the attempt has its own pass to clean up');

    // Now the cleanup path a failed fixture would run, by the ids the FIXTURE
    // created. It names nothing the pre-existing row points at, so it removes
    // no preset row at all.
    assert.deepEqual(
      await deleteCreatedPresets(writer, createdIds),
      [],
      'the fixture ids own no preset row, so nothing is deleted'
    );
    assert.equal(await presetRowsFor(writer, key), 1, 'the pre-existing preset survives the cleanup');
    assert.equal(await repository.findPresetQueryId(writer, key), plantedQueryId);
    assert.equal(await queryRowsFor(writer, [plantedQueryId]), 1, 'and so does its pass');
  } finally {
    const failures = [];
    try {
      await deleteCreatedPresets(writer, createdIds);
    } catch (error) {
      failures.push('deleteCreatedPresets (attempt): ' + error.message);
    }
    try {
      // The planted row is this test's own residue, so it goes too - by id.
      await deleteCreatedPresets(writer, plantedIds);
    } catch (error) {
      failures.push('deleteCreatedPresets (planted): ' + error.message);
    }
    try {
      await generator.deletePasses(writer, createdIds.concat(plantedIds));
    } catch (error) {
      failures.push('deletePasses: ' + error.message);
    }
    let residue = null;
    try {
      // AFTER the passes are gone, for the same reason as the sibling test:
      // residueFor counts them by id and would otherwise report rows this very
      // block is about to delete.
      residue = await residueFor(writer, createdIds.concat(plantedIds), []);
    } catch (error) {
      failures.push('residueFor: ' + error.message);
    }
    await writer.end().catch(() => {});
    assert.deepEqual(failures, [], 'cleanup must run to completion');
    assert.deepEqual(residue, {
      preset_rows: 0,
      queries: 0,
      profiles: 0,
      results: 0,
      candidates: 0,
      components: 0,
      rejections: 0,
    }, 'this test leaves nothing of its own behind');
  }
});

/**
 * THE THIRD FAILURE MODE: the setup dies halfway.
 *
 * The collision test proves a taken key is refused, and the sibling test proves
 * an id-scoped cleanup spares rows it does not own. Neither covers a setup that
 * COMMITS one pass and then throws before the next one. When the ids were
 * recorded only after the whole setup succeeded, that committed pass was
 * invisible to the `finally` block: `createdIds` stayed empty, the cleanup had
 * nothing to name, and the run left an orphaned `recommendation_query` behind -
 * exactly the row the golden harness refuses to run beside.
 *
 * The failure here is deliberate and deterministic: the second insert reuses the
 * first pass's primary key, so PostgreSQL raises 23505 without a race, a timeout
 * or an outage. What is under test is not the error but the CONSEQUENCE - the id
 * registered immediately after the first insert is enough for the cleanup to find
 * and remove it, and nothing belonging to another owner is touched.
 */
test('a partial setup failure still removes the pass it already committed', async () => {
  const writer = new Client({ ...getWriteTestDbUrl(), connectionTimeoutMillis: 15000 });
  const createdIds = []; // every pass THIS attempt committed, registered on commit
  const foreignIds = []; // the planted owner's pass, which must survive
  let foreignKey = null;
  let presetsBefore = null;
  let cleanup = null;
  let profileIds = [];

  try {
    await writer.connect();
    presetsBefore = await presetCount(writer);
    const model = await activeModel(writer);
    const vocabulary = engine.useCaseVocabulary(model.configuration);
    const useCase = vocabulary.includes('GAMING') ? 'GAMING' : vocabulary[0];
    const catalogVersion = await engine.catalogVersion(writer);

    // A planted owner in the SAME scope, at a budget no other fixture uses: if
    // the partial-setup cleanup reached for a scope instead of ids, this row is
    // what it would destroy.
    foreignKey = {
      scoringModelId: model.id, useCase, currency: CURRENCY, catalogVersion, budgetAmount: 44000,
    };
    const foreignQueryId = await insertQuery(writer, model.id, useCase, foreignKey.budgetAmount, catalogVersion);
    foreignIds.push(foreignQueryId);
    assert.equal(
      await insertOwnedPresetRow(writer, foreignKey, foreignQueryId),
      foreignQueryId,
      'the planted owner key must be free for this run'
    );

    // The setup under test. The first pass is registered the moment it commits -
    // that single line is the fix this test exists to pin.
    const partialKey = { ...foreignKey, budgetAmount: 45000 };
    const firstId = await insertQuery(writer, model.id, useCase, partialKey.budgetAmount, catalogVersion);
    createdIds.push(firstId);
    assert.equal(await queryRowsFor(writer, [firstId]), 1, 'the first setup insert committed');

    // The SECOND setup operation is made to fail on purpose.
    await assert.rejects(
      () => insertQuery(writer, model.id, useCase, partialKey.budgetAmount, catalogVersion, firstId),
      (error) => error.code === '23505',
      'the second insert must fail on the reused primary key'
    );

    // The SAME cleanup the fixture's `finally` block runs, run now because the
    // setup threw. Nothing here is special-cased for the failure.
    cleanup = await runOwnedCleanup(writer, createdIds);
    profileIds = cleanup.profileIds;
    assert.deepEqual(cleanup.failures, [], 'cleanup must run to completion');

    assert.deepEqual(
      await residueFor(writer, createdIds, profileIds),
      {
        preset_rows: 0,
        queries: 0,
        profiles: 0,
        results: 0,
        candidates: 0,
        components: 0,
        rejections: 0,
      },
      'the pass the first insert committed must be gone'
    );
    assert.equal(await queryRowsFor(writer, createdIds), 0, 'no recommendation_query residue remains');

    // And the owner this run never wrote is untouched: pointer and pass.
    assert.equal(await presetRowsFor(writer, foreignKey), 1, 'a preset this run did not write must survive');
    assert.equal(await repository.findPresetQueryId(writer, foreignKey), foreignQueryId);
    assert.equal(await queryRowsFor(writer, [foreignQueryId]), 1, 'and so must its pass');
    // The planted row is still there, so the count is what it was plus exactly
    // one: the cleanup removed its own row and nothing else anywhere.
    assert.equal(
      await presetCount(writer),
      presetsBefore + 1,
      'the partial cleanup deleted nothing beyond the pass it owned'
    );
  } finally {
    // The failure path above already cleaned up; a throw from an assertion (or
    // the connect) has not, so the finally block covers both by re-running the
    // same idempotent helper only when it has not run.
    const failures = cleanup === null ? [] : cleanup.failures.slice();
    if (cleanup === null) {
      const fallback = await runOwnedCleanup(writer, createdIds);
      failures.push(...fallback.failures);
      profileIds = fallback.profileIds;
    }
    // The planted row is this test's own residue, so it goes too - by id.
    const foreignCleanup = await runOwnedCleanup(writer, foreignIds);
    failures.push(...foreignCleanup.failures);
    let residue = null;
    try {
      residue = await residueFor(
        writer,
        createdIds.concat(foreignIds),
        profileIds.concat(foreignCleanup.profileIds)
      );
    } catch (error) {
      failures.push('residueFor: ' + error.message);
    }
    let finalCount = null;
    try {
      finalCount = await presetCount(writer);
    } catch (error) {
      failures.push('presetCount: ' + error.message);
    }
    await writer.end().catch(() => {});
    assert.deepEqual(failures, [], 'cleanup must run to completion');
    assert.deepEqual(residue, {
      preset_rows: 0,
      queries: 0,
      profiles: 0,
      results: 0,
      candidates: 0,
      components: 0,
      rejections: 0,
    }, 'this test leaves nothing of its own behind');
    if (presetsBefore !== null) {
      // Global on purpose, the same tripwire the fixture uses.
      assert.equal(finalCount, presetsBefore, 'no preset row anywhere leaked');
    }
  }
});
