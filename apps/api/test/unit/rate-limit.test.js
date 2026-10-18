'use strict';

/**
 * apps/api/test/unit/rate-limit.test.js - the per-route request caps.
 *
 * A GET is cheap (one indexed read) and a POST runs an entire engine pass, so
 * they must not share a budget. These tests pin the split: 30/min on POST,
 * 120/min on GET, and they assert the BOUNDARY (the request just past the limit
 * is the first rejected), not merely that a 429 exists somewhere.
 *
 * The bucket KEY is the second half of the contract (Platform P2 Sprint 2): the
 * limiter counts `request.ip`, and `request.ip` is only the CLIENT when the
 * trusted proxy is configured in `TRUST_PROXY`. `parseTrustProxy`'s own contract
 * lives in `trust-proxy.test.js`; what is pinned here is the consequence - a
 * forwarded header can either separate two clients or be ignored entirely.
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

// --- trustProxy: which address the limiter buckets on (P2 Sprint 2) ----------

/**
 * Two addresses that are plainly distinct, and neither is the socket.
 * Used both as a single forward and as the RIGHTMOST entry (the one a real proxy
 * appends) of a two-entry chain.
 */
const CLIENT_A = '203.0.113.9';
const CLIENT_B = '198.51.100.7';

/**
 * `inject`'s socket address is 127.0.0.1, so naming it is exactly "one proxy hop
 * in front of the process" - the shape a same-host reverse proxy has. A numeric
 * hop count is NOT accepted here: fastify@5.12 disables numeric trust outright
 * (see `trust-proxy.test.js`), so it would silently ignore the headers below.
 */
const TRUSTED_PROXY = '127.0.0.1';

function postAs(app, forwardedFor) {
  const headers = forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor };
  return app.inject({
    method: 'POST',
    url: '/v1/recommendations',
    payload: stub.validBody(),
    headers,
  });
}

/** A request that reached the route: anything else (a 500, say) is a failure here. */
function assertServed(response, label) {
  assert.ok(
    response.statusCode === 200 || response.statusCode === 201,
    label + ': unexpected status ' + response.statusCode
  );
}

// Scenario 2.1. The DEFAULT is untrusted, so the header must not be able to
// split one caller's budget into many: alternating two forward values still
// spends a single 30/min bucket.
test('trustProxy off (the default) ignores X-Forwarded-For: two addresses share one bucket', async () => {
  const app = stub.createTestApp();
  let firstLimitedAt = -1;

  for (let index = 0; index <= POST_LIMIT; index += 1) {
    const response = await postAs(app, index % 2 === 0 ? CLIENT_A : CLIENT_B);
    if (response.statusCode === 429) {
      firstLimitedAt = index;
      break;
    }
    assertServed(response, 'request ' + (index + 1));
  }

  assert.equal(firstLimitedAt, POST_LIMIT, 'a forwarded header must not mint a bucket');
});

// Scenario 2.2. One trusted proxy: the two addresses are two clients, so each
// gets its own 30, and neither is limited early.
test('a trusted proxy gives each forwarded address its own bucket', async () => {
  const app = stub.createTestApp({ trustProxy: TRUSTED_PROXY });

  for (let index = 0; index < POST_LIMIT; index += 1) {
    const a = await postAs(app, CLIENT_A);
    const b = await postAs(app, CLIENT_B);
    assertServed(a, 'client A at request ' + (index + 1));
    assertServed(b, 'client B at request ' + (index + 1));
  }

  assert.equal((await postAs(app, CLIENT_A)).statusCode, 429, 'A is now over its own 30');
  assert.equal((await postAs(app, CLIENT_B)).statusCode, 429, 'B is over its own 30 too');
});

// Scenario 2.3. Trusting the proxy fixes WHICH entry is the client: Fastify stops
// at the first untrusted hop, so a client that wrote its own `X-Forwarded-For`
// has that prefix ignored - it can neither move the client to another bucket nor
// mint a new one.
test('a trusted proxy reads the address it appended, not a client-written prefix', async () => {
  const app = stub.createTestApp({ trustProxy: TRUSTED_PROXY });
  const spoofedChain = '192.0.2.55, ' + CLIENT_A;

  for (let index = 0; index < POST_LIMIT; index += 1) {
    const response = await postAs(app, spoofedChain);
    assertServed(response, 'chained request ' + (index + 1));
  }

  assert.equal(
    (await postAs(app, CLIENT_A)).statusCode,
    429,
    'the same real client without a prefix lands in the SAME bucket'
  );
  assert.equal(
    (await postAs(app, '192.0.2.99, ' + CLIENT_A)).statusCode,
    429,
    'a NEW spoofed prefix must not mint a fresh bucket'
  );
});
