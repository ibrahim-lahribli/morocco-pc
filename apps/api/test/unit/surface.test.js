'use strict';

/**
 * apps/api/test/unit/surface.test.js - server-wide behaviour that is not a
 * route contract: the database-down health verdict.
 *
 * The CORS policy lives in `cors.test.js` (Platform P2 Sprint 4): it used to be
 * two tests here, and moving them keeps one owner for one behaviour rather than
 * two files asserting the same header.
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
