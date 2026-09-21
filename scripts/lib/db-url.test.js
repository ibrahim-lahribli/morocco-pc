'use strict';

// scripts/lib/db-url.test.js — guard tests for the isolated write-test DB URL.
//
// Uses node:test + node:assert/strict only. Tests the pure resolveTestDbUrl()
// (env passed as a parameter; no dotenv, no DB connection opened here).
// NOT part of `npm run test:unit` (that glob is `src/**/*.test.js`); run with:
//   node --test scripts/lib/db-url.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { resolveTestDbUrl } = require('./db-url');

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
