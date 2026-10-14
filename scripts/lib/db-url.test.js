'use strict';

// scripts/lib/db-url.test.js — guard tests for the isolated write-test DB URL.
//
// Uses node:test + node:assert/strict only. Tests the pure resolveTestDbUrl()
// (env passed as a parameter; no dotenv, no DB connection opened here).
// NOT part of `npm run test:unit` (that glob is `src/**/*.test.js`); run with:
//   node --test scripts/lib/db-url.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { resolveTestDbUrl, describeTarget, toDirectUrl } = require('./db-url');

const DIRECT = 'postgresql://writer@example-direct.neon.tech:5432/morocco_pc';
const DIFFERENT = 'postgresql://writer@example-branch.neon.tech:5432/morocco_pc';

describe('resolveTestDbUrl', () => {
  it('throws when TEST_DATABASE_URL is unset', () => {
    assert.throws(
      () => resolveTestDbUrl({ DATABASE_URL: DIRECT }),
      { message: 'TEST_DATABASE_URL is not set' }
    );
  });

  it('throws when TEST_DATABASE_URL is empty', () => {
    assert.throws(
      () => resolveTestDbUrl({ DATABASE_URL: DIRECT, TEST_DATABASE_URL: '   ' }),
      { message: 'TEST_DATABASE_URL is not set' }
    );
  });

  it('throws when TEST_DATABASE_URL is unparseable', () => {
    assert.throws(
      () => resolveTestDbUrl({ DATABASE_URL: DIRECT, TEST_DATABASE_URL: 'not a url' }),
      { message: 'TEST_DATABASE_URL is not a valid URL' }
    );
  });

  it('throws when TEST_DATABASE_URL is an identical string', () => {
    assert.throws(
      () => resolveTestDbUrl({ DATABASE_URL: DIRECT, TEST_DATABASE_URL: DIRECT }),
      { message: 'TEST_DATABASE_URL must not target the shared database' }
    );
  });

  it('throws for pooled-vs-direct same endpoint', () => {
    const pooled = 'postgresql://writer@example-direct-pooler.neon.tech:5432/morocco_pc';
    assert.throws(
      () => resolveTestDbUrl({ DATABASE_URL: DIRECT, TEST_DATABASE_URL: pooled }),
      { message: 'TEST_DATABASE_URL must not target the shared database' }
    );
  });

  it('returns the test connection for a different endpoint', () => {
    const out = resolveTestDbUrl({ DATABASE_URL: DIRECT, TEST_DATABASE_URL: DIFFERENT });
    assert.equal(out.connectionString, DIFFERENT);
    assert.equal(out.connectionTimeoutMillis, 15000);
  });

  it('error messages never include URL, credential, or host values', () => {
    const secret = 'postgresql://user:s3cret@example-direct.neon.tech:5432/morocco_pc';
    let caught = null;
    try {
      resolveTestDbUrl({ DATABASE_URL: DIRECT, TEST_DATABASE_URL: secret });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'expected a throw');
    assert.ok(!caught.message.includes('s3cret'), 'message leaks credential');
    assert.ok(!caught.message.includes('example-direct'), 'message leaks host');
    assert.ok(!caught.message.includes('postgresql://'), 'message leaks URL');
  });
});
describe('describeTarget / toDirectUrl', () => {
  const POOLED = 'postgresql://u:p@ep-cool-name-12345678-pooler.c-4.us-east-2.aws.neon.tech/neondb';
  const DIRECT = 'postgresql://u:p@ep-cool-name-12345678.c-4.us-east-2.aws.neon.tech/neondb';

  it('names the endpoint and flags a pooled host', () => {
    assert.deepEqual(describeTarget(POOLED), {
      endpointId: 'ep-cool-name-12345678', pooled: true, database: 'neondb',
    });
  });

  it('flags a direct host and leaves it unchanged', () => {
    assert.deepEqual(describeTarget(DIRECT), {
      endpointId: 'ep-cool-name-12345678', pooled: false, database: 'neondb',
    });
    assert.equal(toDirectUrl(DIRECT), DIRECT);
  });

  it('strips -pooler from the first label only and preserves credentials exactly', () => {
    const secret = 'postgresql://user:p%40ss-w0rd@ep-cool-name-12345678-pooler.c-4.us-east-2.aws.neon.tech:5432/neondb';
    const direct = toDirectUrl(secret);
    assert.equal(direct, 'postgresql://user:p%40ss-w0rd@ep-cool-name-12345678.c-4.us-east-2.aws.neon.tech:5432/neondb');
    assert.ok(direct.includes('p%40ss-w0rd'), 'credential must not be re-encoded or dropped');
    assert.equal(direct.includes('-pooler'), false);
  });
});
