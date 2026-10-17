'use strict';

/**
 * apps/api/test/unit/cors.test.js - the CORS allow-list, PROVEN (Platform P2
 * Sprint 4).
 *
 * CORS was already implemented (`ALLOWED_ORIGINS` -> `parseOrigins`, empty means
 * fully disabled rather than "reflect any origin") and documented, but nothing
 * pinned it. The failure this file exists to prevent is the safe default quietly
 * becoming unsafe: a change that reflects any origin, or one that turns an empty
 * allow-list into a wildcard, would pass every other suite because a browser is
 * the only client that enforces CORS.
 *
 * What is pinned, per PLAN_PLATFORM_P2.md Sprint 4:
 *   * an allowed origin gets `Access-Control-Allow-Origin` ECHOING that exact
 *     origin (not `*`, which would make the allow-list meaningless) and a
 *     successful preflight;
 *   * a disallowed origin gets NO ACAO header, and the request itself is still
 *     served (CORS is a browser policy, not authentication);
 *   * an empty allow-list sends no ACAO for any origin;
 *   * a comma-separated list admits every listed origin and no other.
 *
 * The app is built with stubs: no database, no network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = require('../helpers/stub');

const ALLOWED = 'https://example.ma';
const SECOND = 'https://shop.example.ma';

/** A preflight, as a browser sends it before a JSON POST. */
function preflight(app, origin) {
  return app.inject({
    method: 'OPTIONS',
    url: '/v1/recommendations',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
}

test('an allowed origin is echoed exactly, and its preflight succeeds', async () => {
  const app = stub.createTestApp({ env: { ALLOWED_ORIGINS: ALLOWED } });

  const response = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin: ALLOWED } });
  assert.equal(response.statusCode, 200);
  assert.equal(
    response.headers['access-control-allow-origin'],
    ALLOWED,
    'the exact origin is echoed - a wildcard would defeat the allow-list'
  );

  const options = await preflight(app, ALLOWED);
  assert.ok(options.statusCode === 204 || options.statusCode === 200, 'preflight answers 204/200');
  assert.equal(options.headers['access-control-allow-origin'], ALLOWED);
  assert.match(
    options.headers['access-control-allow-methods'],
    /\bPOST\b/,
    'the preflight advertises the method the browser asked about'
  );
  assert.match(options.headers['access-control-allow-headers'], /content-type/, 'and the request headers');
});

test('a disallowed origin gets NO ACAO header, and the request is still served', async () => {
  const app = stub.createTestApp({ env: { ALLOWED_ORIGINS: ALLOWED } });

  const response = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin: 'https://evil.example' } });
  assert.equal(response.statusCode, 200, 'CORS is a browser policy, not authentication');
  assert.equal(
    response.headers['access-control-allow-origin'],
    undefined,
    'a non-allow-listed origin must not be granted access'
  );

  // The preflight itself answers, but without the grant: the browser then refuses
  // to send the real request. Answering 204 is not permission.
  const options = await preflight(app, 'https://evil.example');
  assert.equal(options.headers['access-control-allow-origin'], undefined);
});

test('an empty allow-list disables CORS entirely - it never reflects any origin', async () => {
  const app = stub.createTestApp(); // the stub's env has ALLOWED_ORIGINS: ''

  for (const origin of [ALLOWED, 'https://evil.example', 'null']) {
    const response = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin } });
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers['access-control-allow-origin'],
      undefined,
      'with an empty allow-list, ' + origin + ' must not be granted'
    );
  }
});

test('a comma-separated list admits every listed origin and no other', async () => {
  const app = stub.createTestApp({ env: { ALLOWED_ORIGINS: ' ' + ALLOWED + ' , ' + SECOND + ' ' } });

  for (const origin of [ALLOWED, SECOND]) {
    const response = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin } });
    assert.equal(response.headers['access-control-allow-origin'], origin, origin + ' is allow-listed (trimmed)');
  }
  const other = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin: 'https://other.example' } });
  assert.equal(other.headers['access-control-allow-origin'], undefined);
});
