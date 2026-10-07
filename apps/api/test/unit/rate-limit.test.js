'use strict';

/**
 * apps/api/test/unit/rate-limit.test.js - the per-route request caps.
 *
 * A GET is cheap (one indexed read) and a POST runs an entire engine pass, so
 * they must not share a budget. These tests pin the split: 30/min on POST,
 * 120/min on GET, and they assert the BOUNDARY (the request just past the limit
 * is the first rejected), not merely that a 429 exists somewhere.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = require('../helpers/stub');

const POST_LIMIT = 30;
const GET_LIMIT = 120;

test('POST is capped at 30 requests per minute, and the 31st is the first rejected', async () => {
  const app = stub.createTestApp();
  let firstLimitedAt = -1;

  for (let index = 0; index <= POST_LIMIT; index += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: stub.validBody(),
    });
    if (response.statusCode === 429) {
      firstLimitedAt = index;
      break;
    }
    assert.ok(
      response.statusCode === 200 || response.statusCode === 201,
      'unexpected status before the limit: ' + response.statusCode
    );
  }

  assert.equal(firstLimitedAt, POST_LIMIT);
});

test('GET is capped at 120 requests per minute, and only the excess is rejected', async () => {
  const app = stub.createTestApp();
  const url = '/v1/recommendations/' + stub.QUERY_ROW.id;
  let limited = 0;

  for (let index = 0; index <= GET_LIMIT; index += 1) {
    const response = await app.inject({ method: 'GET', url });
    if (response.statusCode === 429) {
      limited += 1;
    }
  }

  assert.equal(limited, 1);
});
