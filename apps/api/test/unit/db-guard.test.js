'use strict';

/**
 * apps/api/test/unit/db-guard.test.js - the pool refuses a write-capable start
 * against the shared database.
 *
 * DB-free: `resolvePoolConfig` only parses strings. This is the guard that
 * stands between a `npm run start:api` in a fresh shell and the single shared
 * dev database, so it is pinned by test rather than by a comment.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePoolConfig, STATEMENT_TIMEOUT_MS, APPLICATION_NAME } = require('../../src/db');

const SHARED = 'postgres://user:secret@shared.example.com:5432/neondb';
const BRANCH = 'postgres://user:secret@branch.example.com:5432/neondb';

test('a start without TEST_DATABASE_URL is refused, and the message names no URL', () => {
  assert.throws(
    () => resolvePoolConfig({ DATABASE_URL: SHARED }),
    (error) => {
      assert.match(error.message, /TEST_DATABASE_URL is not set/);
      assert.ok(!error.message.includes('shared.example.com'), 'the guard must not echo a host');
      assert.ok(!error.message.includes('secret'), 'the guard must not echo a credential');
      return true;
    }
  );
});

test('TEST_DATABASE_URL pointing at the shared endpoint is refused', () => {
  assert.throws(
    () => resolvePoolConfig({ DATABASE_URL: SHARED, TEST_DATABASE_URL: SHARED }),
    /must not target the shared database/
  );
  // The -pooler suffix is normalized away, so a pooled URL of the same endpoint is also refused.
  assert.throws(
    () => resolvePoolConfig({
      DATABASE_URL: SHARED,
      TEST_DATABASE_URL: 'postgres://user:secret@shared-pooler.example.com:5432/neondb',
    }),
    /must not target the shared database/
  );
});

test('the default target is the isolated branch, with the documented defaults', () => {
  const config = resolvePoolConfig({ DATABASE_URL: SHARED, TEST_DATABASE_URL: BRANCH });

  assert.equal(config.connectionString, BRANCH);
  assert.equal(config.statement_timeout, STATEMENT_TIMEOUT_MS);
  assert.equal(config.application_name, APPLICATION_NAME);
  assert.equal(typeof config.connectionTimeoutMillis, 'number');
});

test('API_ALLOW_SHARED=1 is the explicit opt-in to the shared database', () => {
  const config = resolvePoolConfig({ DATABASE_URL: SHARED, API_ALLOW_SHARED: '1' });
  assert.equal(config.connectionString, SHARED);
  assert.equal(config.statement_timeout, STATEMENT_TIMEOUT_MS);
});

test('API_ALLOW_SHARED=1 without DATABASE_URL still fails closed', () => {
  assert.throws(() => resolvePoolConfig({ API_ALLOW_SHARED: '1' }), /requires DATABASE_URL/);
});
