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

test('the 429 carries the error envelope, a request id and Retry-After', async () => {
  const app = stub.createTestApp();
  let limited = null;

  for (let index = 0; index <= POST_LIMIT; index += 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      payload: stub.validBody(),
    });
    if (response.statusCode === 429) {
      limited = response;
      break;
    }
  }

  assert.ok(limited, 'the request past the limit must be the 429 this test inspects');
  assert.match(limited.headers['content-type'], /^application\/json/);

  const body = limited.json();
  assert.equal(body.error, 'RATE_LIMITED', 'the standard envelope, not the plugin\'s raw body');
  assert.equal(body.message, 'Too many requests');
  assert.equal(typeof body.request_id, 'string', 'a limit that fires is traceable to one request');
  assert.ok(body.request_id.length > 0);

  // Measured, not assumed (PLAN_PLATFORM_P2.md Sprint 4 Step 2): the plugin sends
  // `Retry-After` in SECONDS, and the window is exactly one minute.
  assert.equal(limited.headers['retry-after'], '60', 'the caller is told how long to wait');
  assert.equal(limited.headers['x-ratelimit-limit'], String(POST_LIMIT));
  assert.equal(limited.headers['x-ratelimit-remaining'], '0');
});
