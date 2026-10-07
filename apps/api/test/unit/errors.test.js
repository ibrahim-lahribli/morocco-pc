'use strict';

/**
 * apps/api/test/unit/errors.test.js - every non-2xx path, and the two 2xx
 * paths that look like errors.
 *
 * DB-free. The engine is stubbed to throw exactly the codes the real engine
 * raises, so the mapping is pinned without a database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = require('../helpers/stub');

function errorWithCode(code) {
  const error = new Error('engine failure: ' + code);
  error.code = code;
  return error;
}

test('a schema violation is a 422 with per-field details', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/recommendations',
    payload: { budget_amount: 20000, currency: 'MAD' }, // use_case missing
  });

  assert.equal(response.statusCode, 422);
  const body = response.json();
  assert.equal(body.error, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(body.details) && body.details.length > 0);
  assert.ok(body.details.some((detail) => detail.field === 'use_case'));
});

test('a numeric string budget is rejected: the engine takes a number', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/recommendations',
    payload: stub.validBody({ budget_amount: '20000' }),
  });

  assert.equal(response.statusCode, 422);
  assert.ok(response.json().details.some((detail) => detail.field === 'budget_amount'));
});

test('an unknown body field is rejected rather than silently dropped', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/recommendations',
    payload: stub.validBody({ gpu_brand: 'NVIDIA' }),
  });

  assert.equal(response.statusCode, 422);
  assert.ok(response.json().details.some((detail) => detail.field === 'gpu_brand'));
});

test('a value outside the advertised vocabulary is a 422, not a silent default', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/recommendations',
    payload: stub.validBody({ use_case: 'OFFICE' }), // active model requires GPU => not offered
  });

  assert.equal(response.statusCode, 422);
  assert.ok(response.json().details.some((detail) => detail.field === 'use_case'));
});

test('an oversized body is a 413', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/recommendations',
    payload: stub.validBody({ padding: 'x'.repeat(20000) }),
  });

  assert.equal(response.statusCode, 413);
  assert.equal(response.json().error, 'PAYLOAD_TOO_LARGE');
});

test('a known query with zero builds carries reason EMPTY_CANDIDATE_POOL and a 200', async () => {
  const repository = stub.createRepositoryStub({
    async readRecommendationResult() {
      return { found: true, query: stub.QUERY_ROW, rows: [] };
    },
  });
  const engine = stub.createEngineStub(async () => {
    throw errorWithCode('EMPTY_CANDIDATE_POOL');
  });
  const app = stub.createTestApp({ repository, engine });

  const response = await app.inject({ method: 'POST', url: '/v1/recommendations', payload: stub.validBody() });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.builds, []);
  assert.equal(body.reason, 'EMPTY_CANDIDATE_POOL');
  assert.equal(body.budget_floor, null, 'decision 27 computes the floor AFTER Stage 1, so this path has none');
});

test('a pinned scoring model that vanishes mid-pass is a 503', async () => {
  const engine = stub.createEngineStub(async () => {
    throw errorWithCode('SCORING_MODEL_UNAVAILABLE');
  });
  const app = stub.createTestApp({ engine });

  const response = await app.inject({ method: 'POST', url: '/v1/recommendations', payload: stub.validBody() });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, 'SCORING_MODEL_UNAVAILABLE');
});

test('an unexpected engine failure is a generic 500 carrying only a request id', async () => {
  const engine = stub.createEngineStub(async () => {
    throw new Error('relation "secret_table" does not exist');
  });
  const app = stub.createTestApp({ engine });

  const response = await app.inject({ method: 'POST', url: '/v1/recommendations', payload: stub.validBody() });
  assert.equal(response.statusCode, 500);
  const body = response.json();
  assert.equal(body.error, 'INTERNAL_ERROR');
  assert.equal(body.message, 'Internal server error');
  assert.equal(typeof body.request_id, 'string');
  assert.ok(body.request_id.length > 0);
  assert.ok(!JSON.stringify(body).includes('secret_table'), 'no internal detail leaks to the client');
});

test('with no active scoring model, POST and GET /v1/meta/options both answer 503', async () => {
  const repository = stub.createRepositoryStub({
    async selectActiveScoringModel() {
      return null;
    },
  });
  const app = stub.createTestApp({ repository });

  const post = await app.inject({ method: 'POST', url: '/v1/recommendations', payload: stub.validBody() });
  assert.equal(post.statusCode, 503);
  assert.equal(post.json().error, 'SCORING_MODEL_UNAVAILABLE');

  const meta = await app.inject({ method: 'GET', url: '/v1/meta/options' });
  assert.equal(meta.statusCode, 503, 'never an empty option list');
  assert.equal(meta.json().error, 'SCORING_MODEL_UNAVAILABLE');
});

test('GET of an unknown query id is a 404 - never a re-run, never a 500', async () => {
  const repository = stub.createRepositoryStub({
    async readRecommendationResult() {
      return { found: false };
    },
  });
  const engine = stub.createEngineStub();
  const app = stub.createTestApp({ repository, engine });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/recommendations/99999999-9999-4999-8999-999999999999',
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'NOT_FOUND');
  assert.equal(engine.calls.length, 0, 'a 404 never touches the engine');
});

test('a malformed id is a 404, not a PostgreSQL 22P02 reaching the client as a 500', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({ method: 'GET', url: '/v1/recommendations/not-a-uuid' });
  assert.equal(response.statusCode, 404);
});
