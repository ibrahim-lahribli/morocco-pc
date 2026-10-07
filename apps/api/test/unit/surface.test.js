'use strict';

/**
 * apps/api/test/unit/surface.test.js - server-wide behaviour that is not a
 * route contract: the database-down health verdict and the CORS policy.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = require('../helpers/stub');

test('health stays 200 and reports db down when the probe fails', async () => {
  const pool = stub.createPoolStub({ queryError: 'connection refused' });
  const app = stub.createTestApp({ pool });

  const response = await app.inject({ method: 'GET', url: '/v1/health' });
  assert.equal(response.statusCode, 200, 'the process is up even when the database is not');
  assert.equal(response.json().status, 'ok');
  assert.equal(response.json().db, 'down');
  assert.ok(!JSON.stringify(response.json()).includes('connection refused'), 'no internal detail leaks');
});

test('health reports db down when there is no pool at all', async () => {
  const app = stub.createTestApp({ pool: null });
  const response = await app.inject({ method: 'GET', url: '/v1/health' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().db, 'down');
});

test('CORS is disabled when ALLOWED_ORIGINS is empty - no header at all', async () => {
  const app = stub.createTestApp();
  const response = await app.inject({
    method: 'GET',
    url: '/v1/health',
    headers: { origin: 'https://evil.example' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('CORS reflects a configured origin', async () => {
  const app = stub.createTestApp({ env: { ALLOWED_ORIGINS: 'https://shop.example' } });
  const response = await app.inject({
    method: 'GET',
    url: '/v1/health',
    headers: { origin: 'https://shop.example' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['access-control-allow-origin'], 'https://shop.example');
});
