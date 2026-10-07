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

test('POST and GET agree on every persisted field and differ only on the pass-only fields', async () => {
  const engine = stub.createEngineStub();
  const app = stub.createTestApp({ engine });

  const post = (await createRecommendation(app)).json();
  const engineCallsAfterPost = engine.calls.length;

  const fetched = await app.inject({ method: 'GET', url: '/v1/recommendations/' + post.id });
  assert.equal(fetched.statusCode, 200);
  const get = fetched.json();

  // The whole point: one read path, so these cannot drift.
  assert.deepEqual(get.builds, post.builds);
  assert.equal(get.generated_at, post.generated_at);
  assert.equal(get.budget_amount, post.budget_amount);
  assert.equal(get.currency, post.currency);
  assert.equal(get.use_case, post.use_case);
  assert.equal(get.id, post.id);
  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, get), []);

  // Pass-only facts: present on POST, explicitly null on GET.
  assert.equal(post.budget_floor.cheapest_total, 4477);
  assert.equal(post.engine_version, stub.TEST_ENGINE_VERSION);
  assert.equal(get.budget_floor, null);
  assert.equal(get.engine_version, null);
  assert.equal(get.served_by.engine_version, stub.TEST_ENGINE_VERSION);

  assert.equal(engine.calls.length, engineCallsAfterPost, 'GET must never re-run the engine');
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
    name: 'Seed CPU Alpha',
    variant: null,
    price_used: 1999,
    offer_class: 'SEED_UNVERIFIED',
    store_offer_id: 'so-cpu',
  });
  const gpu = build1.components.find((component) => component.role === 'GPU');
  assert.equal(gpu.variant, 'GPU-BETA-8G', 'a non-null variant is served as its sku');

  assert.equal(body.generated_at, '2026-10-07T09:00:06.000Z', 'generated_at is the newest persisted result time');
});

test('a query with zero builds is a 200 with an empty list and a budget floor', async () => {
  const repository = stub.createRepositoryStub({
    async readRecommendationResult() {
      return { found: true, query: stub.QUERY_ROW, rows: [] };
    },
  });
  const engine = stub.createEngineStub(async () => ({
    budget_floor: Object.assign({}, stub.SAMPLE_BUDGET_FLOOR, {
      cheapest_total: 99999,
      within_budget: false,
    }),
  }));
  const app = stub.createTestApp({ repository, engine });

  const response = await createRecommendation(app);
  assert.equal(response.statusCode, 200, 'zero builds is a valid answer, not an error');
  const body = response.json();
  assert.deepEqual(contractErrors(contracts.RecommendationResponseSchema, body), []);
  assert.deepEqual(body.builds, []);
  assert.equal(body.budget_floor.within_budget, false);
  assert.equal(body.reason, null);
  assert.equal(body.generated_at, '2026-10-07T09:00:00.000Z', 'falls back to the query created_at');
});

test('GET /v1/meta/options matches its contract and labels in French', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({ method: 'GET', url: '/v1/meta/options' });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(contractErrors(contracts.MetaOptionsSchema, body), []);
  assert.deepEqual(body.use_cases.map((option) => option.value), ['GAMING', 'WORKSTATION']);
  assert.deepEqual(body.currencies.map((option) => option.value), ['MAD']);
  assert.deepEqual(body.priorities.map((option) => option.value), [1, 2, 3, 4, 5]);
  assert.equal(body.use_cases[0].label, 'Jeux vidéo');
  assert.equal(body.currencies[0].label, 'Dirham marocain (MAD)');
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
  assert.ok(document.paths['/v1/recommendations'], 'the recommendation path is documented');
  assert.ok(document.paths['/v1/recommendations/{id}'], 'the read path is documented');
});
