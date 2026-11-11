'use strict';

// packages/database-guard/test/db-url.test.js — the guard's own tests.
//
// Moved here from scripts/lib/db-url.test.js when the guard became a package.
// `apps/api/test/unit/db-guard.test.js` deliberately did NOT move: it tests the
// API's pool configuration (resolvePoolConfig, STATEMENT_TIMEOUT_MS,
// APPLICATION_NAME), not this package.
//
// Uses node:test + node:assert/strict only. Every case passes its env object as
// a parameter, so nothing here reads `.env` and nothing opens a database.
//   npm run test:database-guard
//   node --test "packages/database-guard/test/*.test.js"

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guard = require('../src');
const { resolveTestDbUrl, getWriteTestDbUrl, describeTarget, toDirectUrl } = guard;

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

describe('getWriteTestDbUrl', () => {
  it('resolves from the environment object it is given', () => {
    const out = getWriteTestDbUrl({ DATABASE_URL: DIRECT, TEST_DATABASE_URL: DIFFERENT });
    assert.equal(out.connectionString, DIFFERENT);
  });

  it('does not fall back to .env or process.env when an env object is passed', () => {
    // The guard is a library: a caller that supplies an env object must get a
    // decision about THAT object. If it loaded .env (or merged process.env),
    // this throw would depend on the developer machine instead of the input.
    assert.throws(
      () => getWriteTestDbUrl({ DATABASE_URL: DIRECT }),
      { message: 'TEST_DATABASE_URL is not set' }
    );
  });
});

describe('describeTarget / toDirectUrl', () => {
  const POOLED = 'postgresql://u:p@ep-cool-name-12345678-pooler.c-4.us-east-2.aws.neon.tech/neondb';
  const POOLED_DIRECT = 'postgresql://u:p@ep-cool-name-12345678.c-4.us-east-2.aws.neon.tech/neondb';

  it('names the endpoint and flags a pooled host', () => {
    assert.deepEqual(describeTarget(POOLED), {
      endpointId: 'ep-cool-name-12345678', pooled: true, database: 'neondb',
    });
  });

  it('flags a direct host and leaves it unchanged', () => {
    assert.deepEqual(describeTarget(POOLED_DIRECT), {
      endpointId: 'ep-cool-name-12345678', pooled: false, database: 'neondb',
    });
    assert.equal(toDirectUrl(POOLED_DIRECT), POOLED_DIRECT);
  });

  it('strips -pooler from the first label only and preserves credentials exactly', () => {
    const secret = 'postgresql://user:p%40ss-w0rd@ep-cool-name-12345678-pooler.c-4.us-east-2.aws.neon.tech:5432/neondb';
    const direct = toDirectUrl(secret);
    assert.equal(direct, 'postgresql://user:p%40ss-w0rd@ep-cool-name-12345678.c-4.us-east-2.aws.neon.tech:5432/neondb');
    assert.ok(direct.includes('p%40ss-w0rd'), 'credential must not be re-encoded or dropped');
    assert.equal(direct.includes('-pooler'), false);
  });
});

// --- package boundary -------------------------------------------------------
// The package contract is exactly seven exports and zero third-party runtime
// dependencies. These assertions are what make the RFC's §9.4 claim a gate
// rather than a sentence: an import of `pg`, `dotenv` or an API module fails
// here, in the package's own suite, without any other project installed.

describe('package boundary', () => {
  const SOURCE = path.resolve(__dirname, '..', 'src', 'index.js');
  const source = fs.readFileSync(SOURCE, 'utf8');
  // Comments name the modules this package must NOT require (dotenv is the
  // documented example), so the scans below read code only.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('exposes exactly the seven documented exports', () => {
    assert.deepEqual(Object.keys(guard).sort(), [
      'CONNECTION_TIMEOUT_MILLIS',
      'describeTarget',
      'getWriteTestDbUrl',
      'normalizeHost',
      'normalizeTarget',
      'resolveTestDbUrl',
      'toDirectUrl',
    ]);
  });

  it('requires nothing at all - zero third-party runtime dependencies', () => {
    const requirements = [...code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((match) => match[1]);
    assert.deepEqual(requirements, [], 'the guard must not require any module, relative or not');
    for (const forbidden of ['pg', 'dotenv']) {
      assert.ok(
        !requirements.includes(forbidden),
        'the guard must not require ' + forbidden
      );
    }
  });

  it('never loads .env itself', () => {
    assert.ok(!/dotenv/.test(code), 'dotenv must not be called, only mentioned in comments');
  });
});
