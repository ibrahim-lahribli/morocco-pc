'use strict';

/**
 * apps/api/test/unit/openapi-coverage.test.js - the OpenAPI document as a GATE,
 * not a description (Platform P2 Sprint 5).
 *
 * `openapi-snapshot.test.js` proves the document has not CHANGED; this file
 * proves it is COMPLETE. Without it a new route can ship fully served and absent
 * from the contract, and every test still passes, because the snapshot only
 * compares the document with itself.
 *
 * The gate enumerates the routes Fastify actually registered (via `onRoute`,
 * attached after `buildApp` but before boot, so it sees the routes registered
 * inside the app's plugin) and requires, for every non-exempt route:
 *   1. a matching `paths` entry for the OpenAPI path (":id" -> "{id}");
 *   2. at least one response declaring a JSON schema;
 *   3. `429` and `500` declared WITH a schema - the rate limiter and the generic
 *      error handler apply to every route, so an undeclared one is an
 *      undocumented behaviour a client cannot see.
 *
 * Three route families are exempt, and each one is a real route this gate would
 * otherwise report: HEAD routes Fastify synthesizes for every GET (not a
 * published operation), the CORS preflight wildcard `OPTIONS *`, and
 * `/v1/docs/json` (the document endpoint cannot document itself - its own
 * `schema.hide` says so). The exemptions are asserted to MATCH something, so a
 * stale exemption cannot silently excuse a route that no longer exists while a
 * new hidden route would still fail.
 *
 * The pure half is proven with synthetic routes: an undocumented route, a route
 * whose responses carry no schema, and a route missing its 429/500 each produce
 * a gap. That is the failing test the plan asks for, without adding a
 * deliberately broken route to a real app.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = require('../helpers/stub');

/** The 429 and 500 every route must declare, with a schema. */
const REQUIRED_ERROR_RESPONSES = Object.freeze(['429', '500']);

/** ":id" in Fastify's route table -> "{id}" in an OpenAPI path. */
function openapiPath(url) {
  return url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Why a route is outside the contract, or null when it must be documented.
 * An exemption is a REASON, not a silent skip.
 */
function exemptionReason(route) {
  if (route.method === 'HEAD') {
    return 'synthesized by Fastify for every GET route; not a published operation';
  }
  if (route.method === 'OPTIONS' && route.url === '*') {
    return 'the @fastify/cors preflight wildcard route; not an API operation';
  }
  if (route.method === 'GET' && route.url === '/v1/docs/json') {
    return 'serves the OpenAPI document itself, which is hidden from its own spec';
  }
  return null;
}

/** Does this OpenAPI response declare a JSON body schema? */
function hasJsonSchema(response) {
  const content = response && response.content;
  return Boolean(content && content['application/json'] && content['application/json'].schema);
}

/**
 * Every way a served route can be missing from the contract.
 *
 * @param {object} document the served OpenAPI document
 * @param {Array<{method: string, url: string}>} routes the registered routes
 * @returns {Array<{route: string, reason: string}>} [] when the contract is complete
 */
function coverageGaps(document, routes) {
  if (document === null || typeof document !== 'object' || typeof document.paths !== 'object' || document.paths === null) {
    throw new TypeError('coverageGaps requires an OpenAPI document with a paths object');
  }
  if (!Array.isArray(routes)) {
    throw new TypeError('coverageGaps requires an array of routes');
  }

  const gaps = [];
  for (const route of routes) {
    if (route === null || typeof route !== 'object' || typeof route.method !== 'string' || typeof route.url !== 'string') {
      throw new TypeError('every route must carry a string method and url');
    }
    const label = route.method + ' ' + route.url;
    if (exemptionReason(route) !== null) continue;

    const operation = document.paths[openapiPath(route.url)];
    const documented = operation && operation[route.method.toLowerCase()];
    if (!documented) {
      gaps.push({ route: label, reason: 'undocumented route: no matching paths entry' });
      continue;
    }

    const responses = documented.responses || {};
    const codes = Object.keys(responses);
    if (codes.length === 0) {
      gaps.push({ route: label, reason: 'no responses declared at all' });
      continue;
    }
    if (!codes.some((code) => hasJsonSchema(responses[code]))) {
      gaps.push({ route: label, reason: 'no response declares a JSON schema' });
      continue;
    }
    for (const code of REQUIRED_ERROR_RESPONSES) {
      if (!responses[code]) {
        gaps.push({ route: label, reason: 'missing the ' + code + ' error response' });
      } else if (!hasJsonSchema(responses[code])) {
        gaps.push({ route: label, reason: 'the ' + code + ' response declares no JSON schema' });
      }
    }
  }
  return gaps;
}

/** A complete synthetic operation, so each test can break exactly one thing. */
function operation() {
  return {
    responses: {
      200: { content: { 'application/json': { schema: { type: 'object' } } } },
      429: { content: { 'application/json': { schema: { type: 'object' } } } },
      500: { content: { 'application/json': { schema: { type: 'object' } } } },
    },
  };
}

test('the gate is silent on a complete contract', () => {
  const document = { paths: { '/v1/ok': { get: operation() } } };
  assert.deepEqual(coverageGaps(document, [{ method: 'GET', url: '/v1/ok' }]), []);
});

test('the gate FAILS on an undocumented route, an untyped response and a missing 429/500', () => {
  const routes = [
    { method: 'GET', url: '/v1/ok' },
    { method: 'GET', url: '/v1/missing' },
  ];
  assert.deepEqual(
    coverageGaps({ paths: { '/v1/ok': { get: operation() } } }, routes),
    [{ route: 'GET /v1/missing', reason: 'undocumented route: no matching paths entry' }]
  );

  const untyped = { paths: { '/v1/ok': { get: { responses: { 200: { description: 'no content' } } } } } };
  assert.deepEqual(
    coverageGaps(untyped, [{ method: 'GET', url: '/v1/ok' }]),
    [{ route: 'GET /v1/ok', reason: 'no response declares a JSON schema' }]
  );

  const noErrors = operation();
  delete noErrors.responses['429'];
  delete noErrors.responses['500'];
  assert.deepEqual(
    coverageGaps({ paths: { '/v1/ok': { get: noErrors } } }, [{ method: 'GET', url: '/v1/ok' }]),
    [
      { route: 'GET /v1/ok', reason: 'missing the 429 error response' },
      { route: 'GET /v1/ok', reason: 'missing the 500 error response' },
    ]
  );
});

test('":id" in the route table matches "{id}" in the document', () => {
  const document = { paths: { '/v1/things/{id}': { get: operation() } } };
  assert.deepEqual(coverageGaps(document, [{ method: 'GET', url: '/v1/things/:id' }]), []);
});

test('the gate refuses malformed input rather than reporting a clean contract', () => {
  assert.throws(() => coverageGaps(null, []), /paths object/);
  assert.throws(() => coverageGaps({ paths: {} }, null), /array of routes/);
  assert.throws(() => coverageGaps({ paths: {} }, [{ url: '/v1/ok' }]), /string method and url/);
});

test('every served API route is documented, with its success and error responses', async () => {
  const app = stub.createTestApp();
  const routes = [];
  // Registered before boot: Fastify adds the app's own plugin routes only when
  // the instance becomes ready, so the hook sees them (and the synthesized HEAD
  // routes, and the CORS wildcard).
  app.addHook('onRoute', (route) => {
    if (typeof route.method === 'string') routes.push({ method: route.method, url: route.url });
  });
  await app.ready();

  const document = app.swagger();
  const gaps = coverageGaps(document, routes);

  // Guard against a vacuous pass: the hook must have seen the real surface.
  const documentedRoutes = routes
    .filter((route) => exemptionReason(route) === null)
    .map((route) => route.method + ' ' + route.url)
    .sort();
  assert.deepEqual(documentedRoutes, [
    'GET /v1/catalog/products',
    'GET /v1/catalog/products/:slug',
    'GET /v1/catalog/products/:slug/price-history',
    'GET /v1/health',
    'GET /v1/meta/options',
    'GET /v1/presets',
    'GET /v1/recommendations/:id',
    'POST /v1/recommendations',
  ]);

  assert.deepEqual(gaps, [], 'a served route that is not in the contract (or lacks 429/500) is a gap');
  await app.close();
});

test('the exemptions all match real routes, so no exemption is stale', async () => {
  const app = stub.createTestApp();
  const routes = [];
  app.addHook('onRoute', (route) => {
    if (typeof route.method === 'string') routes.push({ method: route.method, url: route.url });
  });
  await app.ready();

  const exempt = routes.filter((route) => exemptionReason(route) !== null);
  assert.ok(exempt.some((route) => route.method === 'HEAD'), 'HEAD routes exist and are exempt');
  assert.ok(exempt.some((route) => route.method === 'OPTIONS' && route.url === '*'), 'the CORS wildcard exists');
  assert.ok(
    exempt.some((route) => route.method === 'GET' && route.url === '/v1/docs/json'),
    'the document endpoint exists'
  );
  await app.close();
});

test('the document endpoint is still served, and is absent from its own document', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({ method: 'GET', url: '/v1/docs/json' });
  assert.equal(response.statusCode, 200);
  assert.equal(
    response.json().paths['/v1/docs/json'],
    undefined,
    'a docs route inside its own spec would be documented but pointless, and the exemption assumes it is absent'
  );
  await app.close();
});

module.exports = { coverageGaps, exemptionReason, openapiPath };
