'use strict';

// scripts/lib/run-migrations-cli.test.js — the SHARED-APPLY REFUSAL PATHS of
// scripts/run-migrations.js (Checkpoint 5, step 1).
//
// Why these tests look unusual: the refusal lives in main(), which has to
// connect before it can decide anything (the pending set comes from the
// ledger), so a pure unit test cannot reach it. These tests inject a fake `pg`
// module through Module._load and call the real main(), which gives three
// things a message-only assertion cannot:
//
//   1. the exit code — non-zero on refusal, and NOT for --dry-run / --check,
//   2. the pending filenames printed alongside the refusal,
//   3. proof that NO apply statement reached the client. applyMigration always
//      opens a transaction first, so "no BEGIN and no INSERT into
//      schema_migrations" means the ledger cannot have moved.
//
// ORDER MATTERS: run-migrations.js binds `Client` from `pg` at module load, so
// the stub has to be installed BEFORE the module is required — hence the cache
// delete in loadRunner(). Installing it afterwards would leave the real pg
// Client in place and every test here would "pass" against a dead connection.
//
// Nothing is written anywhere: `pg` is stubbed AND DATABASE_URL points at an
// unroutable `.invalid` host, so even a broken stub cannot reach a database.
// The audit log is only written after the apply loop COMPLETES, which no test
// here allows (the valid-restore-point case is made to fail on BEGIN).
//
// NOT part of `npm run test:unit` (that glob is `src/**/*.test.js`); run with:
//   npm run test:scripts

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const RUNNER = '../run-migrations';
const FAKE_SHARED = 'postgres://stub:stub@stub.invalid/stubdb';
const FAKE_TEST = 'postgres://stub:stub@branch.invalid/branchdb';
const AUDIT_LOG = path.join(__dirname, '..', '..', 'database', 'migration-applies.jsonl');

const ALL_MIGRATIONS = fs
  .readdirSync(path.join(__dirname, '..', '..', 'database', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

// parseArgs never touches pg, so it is safe to load once up front.
const { parseArgs } = require(RUNNER);
const { APPLY_LOG_FIELDS } = require('./migrations');

/** Size of the audit log, or 0 when it does not exist yet. */
function auditLogSize() {
  try {
    return fs.statSync(AUDIT_LOG).size;
  } catch (_err) {
    return 0;
  }
}

/** Require run-migrations.js fresh, so it picks up whatever `pg` is installed. */
function loadRunner() {
  const resolved = require.resolve(RUNNER);
  delete require.cache[resolved];
  return require(resolved);
}

/**
 * Replace the `pg` module for the duration of one main() call.
 * `failOnBegin` makes the first apply transaction blow up, which is how the
 * "the guard let this through" test avoids ever reaching the audit-log write.
 */
function installFakePg(ledgerFiles, opts = {}) {
  const original = Module._load;
  const calls = [];
  class FakeClient {
    async connect() {}
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      if (/SELECT filename FROM schema_migrations/i.test(text)) {
        return { rows: ledgerFiles.map((filename) => ({ filename })), rowCount: ledgerFiles.length };
      }
      if (/gen_random_uuid/.test(text)) return { rows: [{ gen_random_uuid: 'stub-uuid' }], rowCount: 1 };
      if (opts.failOnBegin && /^\s*BEGIN\s*$/i.test(text)) throw new Error('SIMULATED BEGIN FAILURE');
      return { rows: [], rowCount: 0 };
    }
    async end() {}
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'pg') return { Client: FakeClient };
    return original.call(this, request, parent, isMain);
  };
  return {
    calls,
    restore: () => {
      Module._load = original;
    },
  };
}

/**
 * Run main() with the fake pg installed, capturing output, the exit code and
 * every statement that reached the client. Restores console, process.env and
 * process.exitCode in a finally so one failing test cannot poison the next.
 */
async function runMain(argv, { ledger = [], env = {}, failOnBegin = false } = {}) {
  const fake = installFakePg(ledger, { failOnBegin });
  const out = [];
  const err = [];
  const originalLog = console.log;
  const originalError = console.error;
  const previousExitCode = process.exitCode;
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  };
  console.log = (...args) => out.push(args.map(String).join(' '));
  console.error = (...args) => err.push(args.map(String).join(' '));
  process.env.DATABASE_URL = FAKE_SHARED;
  delete process.env.TEST_DATABASE_URL;
  Object.assign(process.env, env);
  process.exitCode = undefined;
  try {
    const { main } = loadRunner();
    await main(argv);
    return {
      calls: fake.calls,
      out: out.join('\n'),
      err: err.join('\n'),
      exitCode: process.exitCode,
      applyStatements: fake.calls.filter(
        (sql) => /^\s*BEGIN\s*$/i.test(sql) || /INSERT INTO schema_migrations/i.test(sql)
      ),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    fake.restore();
    process.exitCode = previousExitCode;
    for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL']) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
}

describe('run-migrations parseArgs', () => {
  it('accepts a known mode and defaults the restore point to null', () => {
    const parsed = parseArgs(['--dry-run']);
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.restorePoint, null);
    assert.ok(parsed.flags.has('--dry-run'));
  });

  it('reads the --restore-point=<id> value', () => {
    const parsed = parseArgs(['--restore-point=br-abc12345']);
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.restorePoint, 'br-abc12345');
  });

  // The empty value must survive parsing so the guard can refuse it; collapsing
  // it to null would make it indistinguishable from a missing flag.
  it('returns an empty string for --restore-point=', () => {
    assert.equal(parseArgs(['--restore-point=']).restorePoint, '');
  });

  it('reports an unknown flag as an error instead of exiting', () => {
    assert.match(parseArgs(['--nope']).error, /usage/);
    // The space form is NOT a mode: `--restore-point br-abc12345` must fail loudly
    // rather than silently running with no restore point recorded.
    assert.match(parseArgs(['--restore-point', 'br-abc12345']).error, /usage/);
  });

  it('rejects --baseline combined with a read-only mode', () => {
    assert.match(parseArgs(['--baseline', '--check']).error, /cannot be combined/);
    assert.match(parseArgs(['--baseline', '--dry-run']).error, /cannot be combined/);
    assert.match(parseArgs(['--baseline', '--offline']).error, /cannot be combined/);
  });

  it('accepts every documented mode', () => {
    for (const mode of ['--dry-run', '--check', '--baseline', '--offline', '--test-db']) {
      assert.equal(parseArgs([mode]).error, undefined, `${mode} must be accepted`);
    }
  });
});

describe('run-migrations shared-apply refusal', () => {
  const PARTIAL_LEDGER = ['001_extensions.sql'];

  it('refuses a shared apply with no restore point and names the pending files', async () => {
    const res = await runMain([], { ledger: PARTIAL_LEDGER });
    assert.equal(res.exitCode, 1, 'a refusal must exit non-zero');
    assert.match(res.err, /refusing to apply to the shared DATABASE_URL/);
    assert.match(res.err, /--restore-point/);
    assert.match(res.err, /002_enums\.sql/, 'the refusal must name what was NOT applied');
    assert.match(res.out, /Pending migrations:/);
    assert.deepEqual(res.applyStatements, [], 'a refusal must not touch the ledger');
  });

  it('refuses the pasted placeholder', async () => {
    const res = await runMain(['--restore-point=<PASTE ID HERE>'], { ledger: PARTIAL_LEDGER });
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /refusing to apply/);
    assert.deepEqual(res.applyStatements, []);
  });

  it('refuses an id that is too short', async () => {
    const res = await runMain(['--restore-point=abc'], { ledger: PARTIAL_LEDGER });
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /refusing to apply/);
    assert.deepEqual(res.applyStatements, []);
  });

  it('refuses an empty restore point', async () => {
    const res = await runMain(['--restore-point='], { ledger: PARTIAL_LEDGER });
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /refusing to apply/);
    assert.deepEqual(res.applyStatements, []);
  });

  // The boundary the refusal exists to protect: a valid id lets the run through.
  // failOnBegin keeps this test from ever reaching the audit-log write.
  it('lets a valid restore point through the guard', async () => {
    const res = await runMain(['--restore-point=br-abc12345'], { ledger: PARTIAL_LEDGER, failOnBegin: true });
    assert.doesNotMatch(res.err, /refusing to apply/, 'a valid restore point must not be refused');
    assert.match(res.err, /SIMULATED BEGIN FAILURE/, 'the run must have reached the apply loop');
    assert.ok(
      res.applyStatements.some((sql) => /^\s*BEGIN\s*$/i.test(sql)),
      'the apply transaction must have been opened'
    );
    assert.deepEqual(
      res.applyStatements.filter((sql) => /INSERT INTO schema_migrations/i.test(sql)),
      [],
      'a failed apply must not record a ledger row'
    );
  });

  it('never refuses --dry-run and writes nothing', async () => {
    const res = await runMain(['--dry-run'], { ledger: PARTIAL_LEDGER });
    assert.equal(res.exitCode, undefined, 'the CLI exits 0');
    assert.doesNotMatch(res.err, /refusing to apply/);
    assert.match(res.out, /DRY-RUN/);
    assert.deepEqual(res.applyStatements, []);
  });

  it('never refuses --check, which fails for its own reason', async () => {
    const res = await runMain(['--check'], { ledger: PARTIAL_LEDGER });
    assert.equal(res.exitCode, 1);
    assert.doesNotMatch(res.err, /refusing to apply/);
    assert.match(res.out, /RESULT: FAIL - pending migrations/);
    assert.deepEqual(res.applyStatements, []);
  });

  it('never refuses a shared run whose ledger is complete', async () => {
    const res = await runMain([], { ledger: ALL_MIGRATIONS });
    assert.equal(res.exitCode, undefined, 'the CLI exits 0');
    assert.doesNotMatch(res.err, /refusing to apply/);
    assert.match(res.out, /No pending migrations/);
    assert.deepEqual(res.applyStatements, []);
  });

  // --test-db is an isolated Neon branch and is deliberately never gated.
  it('never refuses the TEST branch and never writes the shared audit log', async () => {
    const before = auditLogSize();
    const res = await runMain(['--test-db'], {
      ledger: PARTIAL_LEDGER,
      env: { TEST_DATABASE_URL: FAKE_TEST },
    });
    assert.equal(res.exitCode, undefined, 'the CLI exits 0');
    assert.doesNotMatch(res.err, /refusing to apply/);
    assert.ok(
      res.applyStatements.some((sql) => /^\s*BEGIN\s*$/i.test(sql)),
      'the TEST target must actually apply without a restore point'
    );
    assert.equal(auditLogSize(), before, 'a TEST apply must not append to the shared audit log');
  });
});

describe('run-migrations shared --baseline refusal', () => {
  const PARTIAL_LEDGER = ['001_extensions.sql'];
  const PENDING_COUNT = ALL_MIGRATIONS.length - PARTIAL_LEDGER.length;

  // --baseline runs no SQL, but a ledger row it writes without applying anything
  // leaves the database behind its own ledger — the reason it is guarded at all.
  it('refuses a shared --baseline with no restore point and leaves the ledger unchanged', async () => {
    const res = await runMain(['--baseline'], { ledger: PARTIAL_LEDGER });
    assert.equal(res.exitCode, 1, 'a refusal must exit non-zero');
    assert.match(res.err, /refusing to baseline the shared DATABASE_URL/);
    assert.match(res.err, /002_enums\.sql/, 'the refusal must name what was NOT recorded');
    assert.deepEqual(
      res.calls.filter((sql) => /INSERT INTO schema_migrations/i.test(sql)),
      [],
      'a refused baseline must not write a single ledger row'
    );
  });

  it('refuses a shared --baseline with a malformed id', async () => {
    const res = await runMain(['--baseline', '--restore-point=<PASTE ID HERE>'], { ledger: PARTIAL_LEDGER });
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /refusing to baseline/);
    assert.deepEqual(
      res.calls.filter((sql) => /INSERT INTO schema_migrations/i.test(sql)),
      []
    );
  });

  it('lets a valid restore point baseline, printing every file it records', async () => {
    const before = auditLogSize();
    const res = await runMain(['--baseline', '--restore-point=br-abc12345'], { ledger: PARTIAL_LEDGER });
    assert.equal(res.exitCode, undefined, 'the CLI exits 0');
    assert.doesNotMatch(res.err, /refusing to/);
    assert.match(
      res.out,
      new RegExp(`BASELINE: recording ${PENDING_COUNT} file\\(s\\) as applied WITHOUT running them`)
    );
    assert.match(res.out, / 002_enums\.sql/, 'each recorded filename must be listed');
    assert.equal(
      res.calls.filter((sql) => /INSERT INTO schema_migrations/i.test(sql)).length,
      PENDING_COUNT,
      'baseline must record exactly the pending files'
    );
    assert.deepEqual(
      res.calls.filter((sql) => /^\s*BEGIN\s*$/i.test(sql)),
      [],
      'baseline must never open an apply transaction'
    );
    assert.equal(auditLogSize(), before, 'baseline applies nothing, so it must not append to the audit log');
  });

  it('never refuses a TEST-branch baseline', async () => {
    const res = await runMain(['--baseline', '--test-db'], {
      ledger: PARTIAL_LEDGER,
      env: { TEST_DATABASE_URL: FAKE_TEST },
    });
    assert.equal(res.exitCode, undefined, 'the CLI exits 0');
    assert.doesNotMatch(res.err, /refusing to/);
    assert.ok(
      res.calls.some((sql) => /INSERT INTO schema_migrations/i.test(sql)),
      'the TEST branch must be baselined without a restore point'
    );
  });
});

describe('run-migrations shared-apply audit log', () => {
  const PARTIAL_LEDGER = ['001_extensions.sql'];
  const PENDING_COUNT = ALL_MIGRATIONS.length - PARTIAL_LEDGER.length;

  // The ONE test that exercises the real append path: it lets the apply loop
  // COMPLETE against the fake client, so the tracked audit log gains a line per
  // applied file. The file is restored byte-for-byte in a finally, because a
  // failing test must never leave a false row in a file that is committed.
  it('writes one whitelisted line per applied file and restores the log afterwards', async () => {
    const snapshot = fs.readFileSync(AUDIT_LOG);
    const beforeCount = snapshot.toString('utf8').split(/\r?\n/).filter((line) => line !== '').length;
    try {
      const res = await runMain(['--restore-point=br-abc12345'], { ledger: PARTIAL_LEDGER });
      assert.equal(res.exitCode, undefined, 'the CLI exits 0');
      assert.match(res.out, new RegExp(`Recorded ${PENDING_COUNT} audit line\\(s\\)`));
      assert.match(res.out, /Reminder: commit database\/migration-applies\.jsonl/);

      const lines = fs
        .readFileSync(AUDIT_LOG, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line !== '');
      assert.equal(lines.length, beforeCount + PENDING_COUNT, 'one line per applied file, not one per run');
      for (const line of lines.slice(beforeCount)) {
        const rec = JSON.parse(line);
        assert.deepStrictEqual(Object.keys(rec).sort(), APPLY_LOG_FIELDS);
        assert.match(rec.filename, /^\d+_.*\.sql$/);
        assert.equal(rec.target, 'shared');
        assert.equal(rec.restore_point, 'br-abc12345');
        assert.equal(rec.note, null);
        assert.match(rec.git_sha, /^[0-9a-f]{40}$/, 'the git SHA must be recorded, not "unknown"');
        assert.ok(!Number.isNaN(Date.parse(rec.applied_at)));
      }
    } finally {
      fs.writeFileSync(AUDIT_LOG, snapshot);
    }
    assert.deepStrictEqual(fs.readFileSync(AUDIT_LOG), snapshot, 'the tracked audit log must be restored');
  });
});
