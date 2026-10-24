'use strict';

/**
 * apps/api/test/unit/contract.test.js - the published response contract.
 *
 * DB-free: `fastify.inject` against stubs. These tests pin the two properties
 * the API's usefulness rests on - that the wire shape is exactly the TypeBox
 * contract, and that POST and GET cannot disagree about a persisted field.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Value } = require('@sinclair/typebox/value');

const contracts = require('../../src/contracts');
const stub = require('../helpers/stub');
const { findSeedNames, assertNoSeedNames } = require('../helpers/seed-guard');

/** Collect TypeBox validation errors as readable strings (empty means valid). */
function contractErrors(schema, value) {
  return [...Value.Errors(schema, value)].map((error) => (error.path || '/') + ' ' + error.message);
}

async function createRecommendation(app) {
  return app.inject({ method: 'POST', url: '/v1/recommendations', payload: stub.validBody() });
}

test('POST returns 201 and a body that matches the published response contract', async () => {
  const app = stub.createTestApp();
  const response = await createRecommendation(app);

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, body), []);

  assert.equal(body.id, stub.QUERY_ROW.id);
  assert.equal(body.currency, 'MAD');
  assert.equal(body.use_case, 'GAMING');
  assert.equal(body.disclaimer, 'Prix indicatifs, non actualisés.');
  assert.equal(body.engine_version, stub.TEST_ENGINE_VERSION);
  assert.equal(body.reason, null);
  assert.equal(body.served_by.engine_version, stub.TEST_ENGINE_VERSION);
  assert.equal(body.builds.length, 2);
});

test('POST and GET differ in NO persisted field - the read path has no exceptions', async () => {
  // The engine stub returns a floor that is NOT the persisted one, so a
  // presenter still serving the engine's in-memory result would be caught here
  // rather than passing by coincidence.
  const engine = stub.createEngineStub(async () => ({
    budget_floor: Object.assign({}, stub.SAMPLE_BUDGET_FLOOR, {
      cheapest_total: 12345,
      within_budget: true,
    }),
  }));
  const app = stub.createTestApp({ engine });

  const post = (await createRecommendation(app)).json();
  const engineCallsAfterPost = engine.calls.length;

  const fetched = await app.inject({ method: 'GET', url: '/v1/recommendations/' + post.id });
  assert.equal(fetched.statusCode, 200);
  const get = fetched.json();

  // The whole point: one read path, so these cannot drift. Fully deep-equal is
  // now the right assertion - before migration 019 the two verbs legitimately
  // differed on two pass-only facts, and there is no such fact left.
  assert.deepEqual(get, post, 'GET equals POST on every field');
  assert.deepEqual(get.builds, post.builds);
  assert.equal(get.id, post.id);
  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, get), []);

  // The PERSISTED floor is what both verbs serve - never the engine's copy.
  assert.equal(post.budget_floor.cheapest_total, stub.SAMPLE_BUDGET_FLOOR.cheapest_total);
  assert.notEqual(post.budget_floor.cheapest_total, 12345, 'the engine result never reaches the wire');
  assert.equal(get.budget_floor.cheapest_total, post.budget_floor.cheapest_total);

  // engine_version is the deploy recorded on the persisted result rows, and
  // served_by is the deploy that answered - distinct questions, one answer here.
  assert.equal(post.engine_version, stub.TEST_ENGINE_VERSION);
  assert.equal(get.engine_version, stub.TEST_ENGINE_VERSION);
  assert.equal(get.served_by.engine_version, stub.TEST_ENGINE_VERSION);

  assert.equal(engine.calls.length, engineCallsAfterPost, 'GET must never re-run the engine');
});

test('every build carries its OWN persisted engine version and nominating archetype', async () => {
  const app = stub.createTestApp();
  const body = (await createRecommendation(app)).json();

  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, body), []);
  assert.deepEqual(
    body.builds.map((build) => build.engine_version),
    [stub.TEST_ENGINE_VERSION, stub.TEST_ENGINE_VERSION],
    'the engine version is read per result row'
  );
  assert.deepEqual(
    body.builds.map((build) => build.strategy_key),
    ['PERFORMANCE', 'VALUE'],
    'each rank carries its own archetype - a presenter that read one row for all builds fails here'
  );
  assert.equal(body.engine_version, stub.TEST_ENGINE_VERSION, 'the query-level value is the persisted one');
});

test('a NOT-RECORDED pass fact is served as null, never as the answering deploy', async () => {
  // A row written before migration 019, or by a pass with no engine version:
  // the columns are genuinely NULL, and NULL means UNKNOWN here.
  const repository = stub.createRepositoryStub({
    async readRecommendationResult() {
      return {
        found: true,
        query: Object.assign({}, stub.QUERY_ROW, { budget_floor: null }),
        rows: stub.SAMPLE_ROWS.map((row) => Object.assign({}, row, {
          engine_version: null,
          strategy_key: null,
        })),
      };
    },
  });
  const app = stub.createTestApp({ repository });
  const body = (await createRecommendation(app)).json();

  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, body), []);
  assert.equal(body.budget_floor, null, 'no floor was recorded, and none is invented');
  assert.equal(body.engine_version, null);
  assert.deepEqual(body.builds.map((build) => build.strategy_key), [null, null]);
  assert.equal(body.builds.length, 2, 'the builds still serialize with null provenance');
  assert.equal(
    body.served_by.engine_version,
    stub.TEST_ENGINE_VERSION,
    'served_by is a different question and is always answered'
  );
});

test('NUMERIC columns are served as numbers, never as the strings pg returns', async () => {
  const app = stub.createTestApp();
  const body = (await createRecommendation(app)).json();

  assert.equal(typeof body.budget_amount, 'number');
  assert.equal(body.budget_amount, 20000);
  assert.equal(typeof body.builds[0].total_price, 'number');
  assert.equal(body.builds[0].total_price, 12000);
  assert.equal(body.builds[1].total_price, 9800.5);
  assert.equal(typeof body.builds[1].build_score, 'number');
  assert.equal(body.builds[1].build_score, 70);
  assert.equal(typeof body.builds[0].components[0].price_used, 'number');
  assert.equal(body.builds[0].components[0].price_used, 1999);
});

test('components are labelled from the persisted join and price_status is derived', async () => {
  const app = stub.createTestApp();
  const body = (await createRecommendation(app)).json();

  const [build1, build2] = body.builds;
  assert.equal(build1.price_status, 'indicative', 'any SEED_UNVERIFIED component makes the build indicative');
  assert.equal(build2.price_status, 'verified', 'all-VERIFIED components make the build verified');

  assert.equal(build1.components.length, 2);
  assert.equal(build2.components.length, 1, 'a LEFT-JOIN null component row is dropped');

  const cpu = build1.components.find((component) => component.role === 'CPU');
  assert.deepEqual(cpu, {
    role: 'CPU',
    product_id: 'p-cpu',
    // Post-020 identity: the served name is display_name and the slug is its
    // machine form. The exact shape is asserted, not relaxed - a presenter that
    // read `product.name` would serve 'Seed CPU Alpha' with no slug at all.
    name: 'CPU Alpha',
    slug: 'cpu-alpha',
    variant: null,
    price_used: 1999,
    offer_class: 'SEED_UNVERIFIED',
    store_offer_id: 'so-cpu',
  });
  const gpu = build1.components.find((component) => component.role === 'GPU');
  assert.equal(gpu.variant, 'GPU-BETA-8G', 'a non-null variant is served as its sku');

  assert.equal(body.generated_at, '2026-10-07T09:00:06.000Z', 'generated_at is the newest persisted result time');
});

test('a zero-build pass is a 200 with an empty list and its PERSISTED floor', async () => {
  // Decision 27 computes the floor unconditionally and Decision 46 writes it
  // unconditionally, so a pass that assembled nothing still explains why - and
  // that explanation survives to a later GET. Only the query row carries it:
  // there is no result row to hold a pass engine version.
  const persistedFloor = Object.assign({}, stub.SAMPLE_BUDGET_FLOOR, {
    cheapest_total: 99999,
    within_budget: false,
  });
  const repository = stub.createRepositoryStub({
    async readRecommendationResult() {
      return {
        found: true,
        query: Object.assign({}, stub.QUERY_ROW, { budget_floor: persistedFloor }),
        rows: [],
      };
    },
  });
  const app = stub.createTestApp({ repository });

  const response = await createRecommendation(app);
  assert.equal(response.statusCode, 200, 'zero builds is a valid answer, not an error');
  const body = response.json();
  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, body), []);
  assert.deepEqual(body.builds, []);
  assert.equal(body.budget_floor.cheapest_total, 99999);
  assert.equal(body.budget_floor.within_budget, false);
  assert.equal(body.engine_version, null, 'no result row was written, so no pass engine version was recorded');
  assert.equal(body.served_by.engine_version, stub.TEST_ENGINE_VERSION);
  assert.equal(body.reason, null);
  assert.equal(body.generated_at, '2026-10-07T09:00:00.000Z', 'falls back to the query created_at');
});

test('GET /v1/meta/options matches its contract and labels in French', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({ method: 'GET', url: '/v1/meta/options' });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(contractErrors(contracts.MetaOptionsSchema, body), []);
  // Byte-identity for the LEGACY model: the whole option list, values AND labels
  // in order. Before P2 Sprint 1 this list was derived inside `meta.js`; it is
  // now derived by the engine's `listUseCases` and handed in, so this is the
  // assertion that proves the two sources agree exactly - not merely on the
  // values, but on the pairs the API serves.
  assert.deepEqual(body.use_cases, [
    { value: 'GAMING', label: 'Jeux vidéo' },
    { value: 'WORKSTATION', label: 'Travail professionnel' },
  ]);
  assert.deepEqual(body.currencies.map((option) => option.value), ['MAD']);
  assert.deepEqual(body.priorities.map((option) => option.value), [1, 2, 3, 4, 5]);
  assert.equal(body.currencies[0].label, 'Dirham marocain (MAD)');
  // Decision 52: the LEGACY model's configuration declares no per-resolution
  // reader, so `resolution` is not advertised as applied - which is what stops
  // the wizard asking a question nothing downstream reads (CD-1).
  assert.deepEqual(body.inputs_applied, ['use_case', 'priority']);
});

test('GET /v1/meta/options advertises resolution once the model declares a reader', async () => {
  const app = stub.createTestApp({
    repository: stub.createRepositoryStub({
      async selectActiveScoringModel() {
        return stub.PROFILE_MODEL;
      },
    }),
  });
  const body = (await app.inject({ method: 'GET', url: '/v1/meta/options' })).json();

  assert.deepEqual(contractErrors(contracts.MetaOptionsSchema, body), []);
  assert.deepEqual(body.inputs_applied, ['use_case', 'resolution', 'priority']);
});

test('input_effects states what each input changed, and a GET revisit reports the same thing', async () => {
  const app = stub.createTestApp();
  const created = await createRecommendation(app);
  const body = created.json();

  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, body), []);
  // The fixture's model is the LEGACY shape and the fixture query pins
  // resolution 1440p / priority 5 with two builds: the legacy list still decides
  // the GPU requirement, nothing reads the resolution, and the archetype order
  // is the priority's (5 puts PERFORMANCE first, unlike the default 3). Three
  // DIFFERENT reasons, one per input - which is what makes this a statement
  // about the pass rather than a constant.
  assert.deepEqual(body.input_effects, [
    { input: 'use_case', effect: 'APPLIED', reason: 'GPU_POLICY_ONLY' },
    { input: 'resolution', effect: 'NO_EFFECT', reason: 'NO_RESOLUTION_POLICY' },
    { input: 'priority', effect: 'APPLIED', reason: 'STRATEGY_ORDER' },
  ]);

  const fetched = await app.inject({ method: 'GET', url: '/v1/recommendations/' + body.id });
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(
    fetched.json().input_effects,
    body.input_effects,
    'POST and GET derive the effects from the same persisted rows'
  );
});

test('input_effects is UNKNOWN when the pass did not record a model configuration', async () => {
  // Models the LEFT JOIN in SELECT_QUERY_SQL missing its row (a deleted model):
  // `configuration` is absent, `scoring_model_id` is still recorded. The answer
  // must be UNKNOWN - never an invented effect, and never the CURRENT model's
  // configuration borrowed on the pass's behalf.
  const row = Object.assign({}, stub.QUERY_ROW, { configuration: undefined });
  const app = stub.createTestApp({
    repository: stub.createRepositoryStub({
      async readRecommendationResult() {
        return { found: true, query: row, rows: stub.SAMPLE_ROWS };
      },
    }),
  });
  const body = (await app.inject({ method: 'GET', url: '/v1/recommendations/' + row.id })).json();

  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, body), []);
  assert.deepEqual(body.input_effects[0], {
    input: 'use_case', effect: 'UNKNOWN', reason: 'NOT_RECORDED',
  });
  assert.deepEqual(body.input_effects[1], {
    input: 'resolution', effect: 'UNKNOWN', reason: 'NOT_RECORDED',
  });
  // Priority needs no configuration: the builds' strategy keys are enough.
  assert.deepEqual(body.input_effects[2], {
    input: 'priority', effect: 'APPLIED', reason: 'STRATEGY_ORDER',
  });

  // The neutral value is still NO_EFFECT with the SAME missing configuration:
  // 3 is the order an omitted priority produces, so it cannot be credited with
  // a change - the one case where the two facts (provided, and effective) part.
  const neutral = Object.assign({}, row, { priority: 3 });
  const neutralBody = (await stub.createTestApp({
    repository: stub.createRepositoryStub({
      async readRecommendationResult() {
        return { found: true, query: neutral, rows: stub.SAMPLE_ROWS };
      },
    }),
  }).inject({ method: 'GET', url: '/v1/recommendations/' + neutral.id })).json();
  assert.deepEqual(neutralBody.input_effects[2], {
    input: 'priority', effect: 'NO_EFFECT', reason: 'DEFAULT_ORDER',
  });
});

test('GET /v1/health matches its contract', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({ method: 'GET', url: '/v1/health' });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(contractErrors(contracts.HealthResponseSchema, body), []);
  assert.equal(body.db, 'ok');
  assert.equal(body.engine_version, stub.TEST_ENGINE_VERSION);
});

test('the OpenAPI document is served as JSON at /v1/docs/json', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({ method: 'GET', url: '/v1/docs/json' });

  assert.equal(response.statusCode, 200);
  const document = response.json();
  assert.equal(document.openapi, '3.0.3');
  assert.equal(document.info.title, 'morocco-pc API');
  assert.equal(document.info.version, '1.7.0', 'the contract version names the current surface (adds input effects)');
  assert.ok(document.paths['/v1/recommendations'], 'the recommendation path is documented');
  assert.ok(document.paths['/v1/recommendations/{id}'], 'the read path is documented');
});

test('every component serves its persisted slug, and no name carries the "Seed " prefix', async () => {
  const app = stub.createTestApp();
  const body = (await createRecommendation(app)).json();

  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, body), []);

  const components = body.builds.flatMap((build) => build.components);
  assert.equal(components.length, 3, 'the fixture must carry components for this to prove anything');
  assert.deepEqual(
    components.map((component) => component.slug),
    ['cpu-alpha', 'gpu-beta', 'cpu-gamma'],
    'slug is read per component row, from the persisted column'
  );
  assert.deepEqual(
    components.map((component) => component.name),
    ['CPU Alpha', 'GPU Beta', 'CPU Gamma'],
    'name is the persisted display_name'
  );

  // The guard, run on the payload the route actually produced. The fixture
  // models the post-020 join, where `product_name` IS the aliased
  // COALESCE(display_name, name), so it cannot by itself distinguish the two
  // columns - the DB suite is what proves the alias is applied to REAL rows,
  // whose `product.name` still carries the `Seed ` prefix (migration 020's
  // whole point is that it stops being served).
  assertNoSeedNames(body);
});

test('the no-Seed guard FIRES - a prefixed name is not merely unasserted', async () => {
  // Proves the guard is live rather than vacuous: without this, a guard whose
  // walk was broken (wrong field name, wrong nesting) would report zero
  // offenders on every suite and look identical to a clean catalog.
  const app = stub.createTestApp();
  const body = (await createRecommendation(app)).json();

  body.builds[0].components[0].name = 'Seed CPU Alpha';
  const offenders = findSeedNames(body);
  assert.equal(offenders.length, 1, 'the guard sees exactly the sabotaged component');
  assert.equal(offenders[0].product_id, 'p-cpu', 'the failure names the row to look at');
  assert.throws(() => assertNoSeedNames(body), /Seed CPU Alpha/, 'and the assertion throws on it');
});

// --- Request dedupe (Platform P1 Sprint 5, Decision 47) ---------------------
//
// These pin the four behaviours the sprint's scenarios name, DB-free. The DB
// suite is what proves the ROW counts; here the proxy for "created no rows" is
// `createRecommendationQuery`, which inserts the profile AND the query in one
// transaction, so a call count of 1 means one profile row and one query row.
//
// A NOTE ON THE STUB'S IDS: `createRecommendationQuery` always returns
// `QUERY_ROW.id`, so "the same id" is not by itself evidence of a reuse - which
// is why every assertion below also counts the creates and the ENGINE CALLS. A
// reuse that quietly ran the engine anyway would pass an id check and fail here.

/**
 * The components of the dedupe key, named once so the stub below compares what
 * the real statement compares.
 */
const REUSE_KEY_FIELDS = [
  'scoringModelId', 'budgetAmount', 'currency', 'useCase',
  'resolution', 'priority', 'catalogVersion', 'engineVersion',
];

/**
 * A repository stub that stores one pass and then reports it reusable FOR THE
 * KEY IT WAS CREATED UNDER.
 *
 * The key comparison is the point: a stub that returned a hit to every later
 * lookup would make the "a different budget is a different request" scenario
 * pass or fail for reasons of its own, and would have hidden a real bug either
 * way. It mirrors `SELECT_REUSABLE_QUERY_SQL`, which matches all eight
 * components or nothing.
 */
function reusableRepository() {
  const creates = [];
  const finds = [];
  let storedKey = null;
  let storedHit = null;
  const repository = stub.createRepositoryStub({
    async findReusableQuery(_db, key) {
      finds.push(key);
      if (storedHit === null) {
        return null;
      }
      const same = REUSE_KEY_FIELDS.every((field) => storedKey[field] === key[field]);
      return same ? storedHit : null;
    },
    async createRecommendationQuery(_client, input) {
      creates.push(input);
      // The key that MISSED and caused this create is the key the pass is
      // reusable under - which is exactly what the database records.
      storedKey = finds[finds.length - 1];
      storedHit = Object.freeze({ queryId: stub.QUERY_ROW.id });
      return Object.freeze({ profileId: 'prof-1', queryId: stub.QUERY_ROW.id });
    },
  });
  return { repository, creates, finds };
}

test('a repeated identical POST is answered from the stored pass: 200, reused true, no second pass', async () => {
  const { repository, creates, finds } = reusableRepository();
  const engine = stub.createEngineStub();
  const app = stub.createTestApp({ repository, engine });

  const first = await createRecommendation(app);
  assert.equal(first.statusCode, 201, 'the first POST created a pass that produced builds');
  const firstBody = first.json();
  assert.equal(firstBody.reused, false, 'nothing was reused by a POST that ran its own pass');
  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, firstBody), []);
  assert.equal(creates.length, 1, 'the first POST wrote one profile+query pair');
  assert.equal(engine.calls.length, 1, 'the first POST ran one engine pass');

  const second = await createRecommendation(app);
  assert.equal(second.statusCode, 200, 'a reuse created nothing, so it is a 200 and not a 201');
  const secondBody = second.json();
  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, secondBody), []);
  assert.equal(secondBody.reused, true);
  assert.equal(secondBody.id, firstBody.id, 'the ORIGINAL id is returned, which is what makes a share link stable');
  assert.equal(creates.length, 1, 'a reuse inserts no second profile and no second query');
  assert.equal(engine.calls.length, 1, 'a reuse runs no second engine pass - the whole point of the sprint');

  // The reused reply is read through the SAME statement every GET uses, so it
  // cannot differ from a first reply about a persisted field. `reused` is the
  // only field that legitimately differs, and it is a REQUEST fact.
  const fetched = await app.inject({ method: 'GET', url: '/v1/recommendations/' + secondBody.id });
  assert.equal(fetched.statusCode, 200);
  const getBody = fetched.json();
  assert.deepEqual(
    Object.assign({}, secondBody, { reused: undefined }),
    Object.assign({}, getBody, { reused: undefined }),
    'a reused POST reply equals a GET on every field except the request-scoped `reused`'
  );
  assert.equal(getBody.reused, false, 'a GET never reports a reuse');
  assert.equal(engine.calls.length, 1, 'GET never re-runs the engine either');

  assert.equal(finds.length, 2, 'deDUPE looks BEFORE it creates, on every POST');
});

test('the dedupe key is the request identity plus both versions - never the profile name', async () => {
  const { repository, finds } = reusableRepository();
  const app = stub.createTestApp({ repository });

  await createRecommendation(app);
  assert.equal(finds.length, 1);
  const key = finds[0];

  // Every component the sprint names, asserted individually so a renamed or a
  // dropped key cannot pass by matching a shape.
  assert.equal(key.scoringModelId, stub.ACTIVE_MODEL.id, 'the model id is the RESOLVED active model, not the request');
  assert.equal(key.budgetAmount, 20000);
  assert.equal(key.currency, 'MAD');
  assert.equal(key.useCase, 'GAMING');
  assert.equal(key.resolution, undefined, 'an omitted resolution stays undefined, never a substitute');
  assert.equal(key.priority, undefined);
  assert.equal(key.catalogVersion, stub.TEST_CATALOG_VERSION, 'the catalog version is part of the key');
  assert.equal(key.engineVersion, stub.TEST_ENGINE_VERSION, 'so is the deploy that would answer');
  assert.equal(
    Object.prototype.hasOwnProperty.call(key, 'profileId'),
    false,
    'the profile id is never part of the key: it is per-request by construction and identifies nothing'
  );
});

test('a POST differing only in budget is a different request and runs its own pass', async () => {
  const { repository, creates, finds } = reusableRepository();
  const engine = stub.createEngineStub();
  const app = stub.createTestApp({ repository, engine });

  await createRecommendation(app);
  const second = await app.inject({
    method: 'POST',
    url: '/v1/recommendations',
    payload: stub.validBody({ budget_amount: 25000 }),
  });

  assert.equal(second.statusCode, 201);
  assert.equal(second.json().reused, false);
  assert.equal(finds[1].budgetAmount, 25000, 'the lookup was made with the NEW budget');
  assert.equal(creates.length, 2, 'a different request writes its own pass');
  assert.equal(engine.calls.length, 2);
  assert.equal(creates[1].budgetAmount, 25000, 'and the persisted row records the budget that was asked for');
});

test('an unavailable catalog digest degrades to NULL and disables reuse - never a stale answer', async () => {
  // Decision 47 item 10: an UNKNOWN version is a MISS, never a match. The pass
  // still runs, because a dedupe key is not part of the answer.
  const { repository, creates, finds } = reusableRepository();
  const engine = stub.createEngineStub();
  engine.catalogVersion = async () => { throw new Error('digest unavailable'); };
  const app = stub.createTestApp({ repository, engine });

  const response = await createRecommendation(app);
  assert.equal(response.statusCode, 201, 'a broken cache key must not break the product');
  const body = response.json();
  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, body), []);
  assert.equal(finds[0].catalogVersion, null, 'the lookup is made with NULL, which cannot match a recorded version');
  assert.equal(creates[0].catalogVersion, null, 'the row records NULL - not recorded, never an invented value');
  assert.equal(body.catalog_version, stub.TEST_CATALOG_VERSION, 'the response serves what the ROW holds');
});

test('a recorded catalog version is served, and an unrecorded one is null rather than invented', async () => {
  const app = stub.createTestApp();
  const body = (await createRecommendation(app)).json();
  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, body), []);
  assert.equal(body.catalog_version, stub.TEST_CATALOG_VERSION, 'read back from the row like every other field');

  // A pre-021 row, which genuinely recorded nothing. NULL means UNKNOWN.
  const preMigration = stub.createRepositoryStub({
    async readRecommendationResult() {
      return {
        found: true,
        query: Object.assign({}, stub.QUERY_ROW, { catalog_version: null }),
        rows: stub.SAMPLE_ROWS,
      };
    },
  });
  const legacy = (await createRecommendation(stub.createTestApp({ repository: preMigration }))).json();
  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, legacy), []);
  assert.equal(legacy.catalog_version, null, 'not recorded, and not derived from anything');
});
