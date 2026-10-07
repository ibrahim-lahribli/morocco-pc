'use strict';

/**
 * apps/api/test/run-db-tests.js - the `npm run test:api:db` launcher.
 *
 * Why a launcher instead of a plain `node --test` glob:
 *
 *   1. FAIL FAST, NEVER SKIP. The DB-backed suite writes Layer 4 rows, so it
 *      must only ever run against the isolated TEST branch. The environment is
 *      checked here, before Node loads a single test file, and a missing or
 *      shared-pointing TEST_DATABASE_URL is a non-zero exit - not a skipped
 *      suite that a green CI run would misread as coverage.
 *   2. ZERO TESTS IS A FAILURE. A renamed file or a bad glob would otherwise
 *      exit 0 having proved nothing.
 *
 * The exit status is the child's own; the helpers only add the guards on top.
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveTestDbUrl } = require('../../../scripts/lib/db-url');

const DB_DIR = path.join(__dirname, 'db');

function fail(message) {
  console.error('test:api:db: ' + message);
  process.exit(1);
}

// Throws when TEST_DATABASE_URL is absent, unparseable, or equal to
// DATABASE_URL. The thrown messages never contain a URL or a host.
try {
  resolveTestDbUrl(process.env);
} catch (error) {
  fail('cannot run - ' + error.message);
  fail('set TEST_DATABASE_URL (a Neon branch, different from DATABASE_URL) and retry');
}

const files = fs.existsSync(DB_DIR)
  ? fs.readdirSync(DB_DIR)
    .filter((name) => name.endsWith('.db.test.js'))
    .sort()
    .map((name) => path.join(DB_DIR, name))
  : [];

if (files.length === 0) {
  fail('found no *.db.test.js files under ' + DB_DIR);
}

const result = spawnSync(process.execPath, ['--test'].concat(files), { encoding: 'utf8' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');

const output = (result.stdout || '') + '\n' + (result.stderr || '');

/**
 * Read a summary counter. Node 22 prints `# pass N`; Node 24 prints `ℹ pass N`.
 * An unreadable count returns 0, which the guard below treats as a failure -
 * the safe direction.
 */
function summaryCount(label) {
  const match = output.match(new RegExp('^(?:#|ℹ)\\s*' + label + '\\s+(\\d+)\\s*$', 'm'));
  return match ? Number(match[1]) : 0;
}

const passed = summaryCount('pass');
const failed = summaryCount('fail');

if (passed === 0) {
  fail('ran 0 tests - refusing to report success');
}

if (failed > 0 || result.status !== 0) {
  fail(passed + ' passed, ' + failed + ' failed');
}

console.log('test:api:db: ' + passed + ' passed, 0 failed');
