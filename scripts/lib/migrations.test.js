'use strict';

// scripts/lib/migrations.test.js — tests for the applied-migrations ledger
// helpers (gap OG-14) and for the shared-apply audit log (Checkpoint 5).
//
// Uses node:test + node:assert/strict only. The helpers are pure (inputs passed
// as parameters; no DB, no dotenv). The last block additionally READS the tracked
// database/migration-applies.jsonl to pin its shape — which is the reason its
// field set is a whitelist rather than a convention. NOT part of
// `npm run test:unit` (that glob is `src/**/*.test.js`); run with:
//   node --test scripts/lib/migrations.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  pendingMigrations,
  staleLedgerEntries,
  LEDGER_TABLE,
  isValidRestorePointId,
  shouldRefuseSharedApply,
  formatApplyLogLine,
  applyLogTarget,
  APPLY_LOG_FIELDS,
  LEGACY_APPLY_LOG_TARGETS,
  TARGET_DIGEST_RE,
  APPLY_LOG_EOL,
} = require('./migrations');

const FILES = ['001_extensions.sql', '002_enums.sql', '011_reconcile_layer4.sql'];

describe('pendingMigrations', () => {
  it('returns every file when the ledger is empty (fresh database)', () => {
    assert.deepStrictEqual(pendingMigrations(FILES, []), FILES);
  });

  it('returns nothing when every file is already applied', () => {
    assert.deepStrictEqual(pendingMigrations(FILES, FILES), []);
  });

  it('returns only the unapplied tail, in disk order', () => {
    assert.deepStrictEqual(
      pendingMigrations(FILES, ['001_extensions.sql', '002_enums.sql']),
      ['011_reconcile_layer4.sql']
    );
  });

  it('is independent of ledger ordering', () => {
    assert.deepStrictEqual(
      pendingMigrations(FILES, ['011_reconcile_layer4.sql', '001_extensions.sql']),
      ['002_enums.sql']
    );
  });

  it('ignores duplications in the ledger', () => {
    assert.deepStrictEqual(
      pendingMigrations(FILES, ['001_extensions.sql', '001_extensions.sql']),
      ['002_enums.sql', '011_reconcile_layer4.sql']
    );
  });

  it('does not mutate its inputs', () => {
    const files = FILES.slice();
    const applied = ['001_extensions.sql'];
    pendingMigrations(files, applied);
    assert.deepStrictEqual(files, FILES);
    assert.deepStrictEqual(applied, ['001_extensions.sql']);
  });

  it('throws on a non-string input', () => {
    assert.throws(() => pendingMigrations('001_extensions.sql', []), /array of strings/);
    assert.throws(() => pendingMigrations(FILES, [1]), /array of strings/);
  });
});

describe('staleLedgerEntries', () => {
  it('reports an applied filename with no matching file on disk', () => {
    assert.deepStrictEqual(
      staleLedgerEntries(FILES, ['001_extensions.sql', '999_ghost.sql']),
      ['999_ghost.sql']
    );
  });

  it('is empty when the ledger matches the tree', () => {
    assert.deepStrictEqual(staleLedgerEntries(FILES, ['002_enums.sql']), []);
  });
});

describe('LEDGER_TABLE', () => {
  it('names the tracking table', () => {
    assert.strictEqual(LEDGER_TABLE, 'schema_migrations');
  });
});

describe('isValidRestorePointId', () => {
  it('accepts a Neon-style id', () => {
    assert.strictEqual(isValidRestorePointId('br-abc12345'), true);
  });

  it('accepts underscores and mixed case', () => {
    assert.strictEqual(isValidRestorePointId('rp_20261006_01'), true);
  });

  it('rejects a short id', () => {
    assert.strictEqual(isValidRestorePointId('abc'), false);
  });

  it('rejects the pasted placeholder', () => {
    assert.strictEqual(isValidRestorePointId('<PASTE ID HERE>'), false);
  });

  it('rejects empty, spaced, and non-string values', () => {
    assert.strictEqual(isValidRestorePointId(''), false);
    assert.strictEqual(isValidRestorePointId('ab cd1234'), false);
    assert.strictEqual(isValidRestorePointId(null), false);
    assert.strictEqual(isValidRestorePointId(undefined), false);
    assert.strictEqual(isValidRestorePointId(12345678), false);
  });
});

describe('shouldRefuseSharedApply', () => {
  const base = { targetShared: true, pendingCount: 1, restorePoint: 'br-abc12345' };

  it('refuses a shared apply with no restore point', () => {
    assert.strictEqual(shouldRefuseSharedApply({ ...base, restorePoint: null }), true);
  });

  it('refuses a shared apply with a placeholder id', () => {
    assert.strictEqual(shouldRefuseSharedApply({ ...base, restorePoint: '<PASTE ID HERE>' }), true);
  });

  it('allows a shared apply with a valid id', () => {
    assert.strictEqual(shouldRefuseSharedApply(base), false);
  });

  it('never refuses the TEST branch', () => {
    assert.strictEqual(shouldRefuseSharedApply({ ...base, targetShared: false, restorePoint: null }), false);
  });

  it('never refuses read-only modes', () => {
    assert.strictEqual(shouldRefuseSharedApply({ ...base, restorePoint: null, dryRun: true }), false);
    assert.strictEqual(shouldRefuseSharedApply({ ...base, restorePoint: null, check: true }), false);
    assert.strictEqual(shouldRefuseSharedApply({ ...base, restorePoint: null, offline: true }), false);
  });

  // --baseline executes no SQL but WRITES the ledger, so it is not an exemption:
  // passing the flag must not suppress the refusal any more.
  it('is not exempted by --baseline', () => {
    assert.strictEqual(shouldRefuseSharedApply({ ...base, restorePoint: null, baseline: true }), true);
  });

  it('never refuses when nothing is pending', () => {
    assert.strictEqual(shouldRefuseSharedApply({ ...base, pendingCount: 0, restorePoint: null }), false);
  });

  // Fail CLOSED: an unknown, NaN or malformed count must refuse, because "I
  // could not determine what is pending" is not evidence that nothing is. A
  // valid restore point must NOT rescue it — the count is the subject of the
  // check, and a caller that cannot say what is pending must not proceed.
  it('refuses when pendingCount is unknown, NaN or malformed', () => {
    const cases = [undefined, null, NaN, '1', 1.5, -1, Infinity, {}];
    for (const pendingCount of cases) {
      assert.strictEqual(
        shouldRefuseSharedApply({ ...base, pendingCount, restorePoint: 'br-abc12345' }),
        true,
        'expected refusal for pendingCount=' + String(pendingCount)
      );
    }
  });
});

describe('applyLogTarget', () => {
  const POOLED = 'postgres://u:p@ep-steep-sun-123456-pooler.eu-central-1.aws.neon.tech/neondb';
  const DIRECT = 'postgres://u:p@ep-steep-sun-123456.eu-central-1.aws.neon.tech/neondb';

  it('is a db:<12 hex> digest, deterministic for the same target', () => {
    const target = applyLogTarget(POOLED);
    assert.match(target, TARGET_DIGEST_RE);
    assert.equal(target.length, 'db:'.length + 12);
    assert.equal(target, applyLogTarget(POOLED), 'same input, same value');
  });

  // Neon serves one endpoint as two hostnames (pooled and direct), and this
  // repo has already been bitten by treating them as different targets:
  // describeTarget prints the pooled host while apply-seed prints the direct
  // one, and that is not a mismatch.
  it('treats the pooled and the direct host as the SAME database', () => {
    assert.equal(applyLogTarget(POOLED), applyLogTarget(DIRECT));
    assert.equal(
      applyLogTarget('postgres://u:p@EP-STEEP-SUN-123456-POOLER.eu-central-1.aws.neon.tech/neondb'),
      applyLogTarget(DIRECT),
      'the comparison is case-insensitive, like db-url.js normalizeHost'
    );
  });

  it('distinguishes a different host, and a different database on one host', () => {
    const a = applyLogTarget('postgres://u:p@host-a.eu/neondb');
    const b = applyLogTarget('postgres://u:p@host-b.eu/neondb');
    const c = applyLogTarget('postgres://u:p@host-a.eu/migrations_replay_tmp');
    assert.notEqual(a, b, 'a different host is a different database');
    assert.notEqual(a, c, 'the replay scratch database is not the branch database');
    assert.notEqual(b, c);
  });

  // The security property, stated as a test: the value cannot encode a
  // credential, because credentials are not part of its input. The whitelist
  // exists so a tracked file can never carry a URL, a host or a secret.
  it('CANNOT encode a credential: user, password, port and query params do not change it', () => {
    const base = applyLogTarget(POOLED);
    assert.equal(base, applyLogTarget('postgres://other:s3cret@ep-steep-sun-123456-pooler.eu-central-1.aws.neon.tech/neondb'));
    assert.equal(base, applyLogTarget('postgres://u:p@ep-steep-sun-123456-pooler.eu-central-1.aws.neon.tech:5432/neondb'));
    assert.equal(base, applyLogTarget(POOLED + '?sslmode=verify-full&application_name=x'));
    assert.doesNotMatch(base, /neon|ep-|neondb|pooler|s3cret/i);
    assert.doesNotMatch(base, /@/);
  });

  it('refuses a value whose target cannot be identified', () => {
    assert.throws(() => applyLogTarget('not a url'), /target/i);
    assert.throws(() => applyLogTarget(null), /target/i);
    assert.throws(() => applyLogTarget('postgres://host-a.eu/'), /target/i);
  });
});

describe('formatApplyLogLine', () => {
  // `target` is a DIGEST of the connection target's identity (`db:<12 hex>`),
  // never an inferred role. The four lines already in the tracked log carry
  // the older `shared` role and are read-only history.
  const normal = {
    applied_at: '2026-10-07T00:00:00.000Z',
    filename: '019_example.sql',
    git_sha: 'abcdef1234567890abcdef1234567890abcdef12',
    note: null,
    restore_point: 'br-abc12345',
    target: 'db:9f3a1c7b9d2e',
  };

  it('emits exactly the whitelisted fields', () => {
    assert.deepStrictEqual(Object.keys(JSON.parse(formatApplyLogLine(normal))).sort(), APPLY_LOG_FIELDS);
  });

  // The log is TRACKED, so an unexpected key must be refused rather than dropped:
  // that is what makes "no connection string or hostname is ever persisted" a
  // property of the writer instead of a promise about its callers.
  it('refuses an unknown field, so a URL, credential or host can never be persisted', () => {
    assert.throws(() => formatApplyLogLine({ ...normal, connectionString: 'postgres://u:p@host/db' }), /unknown audit-log field/);
    assert.throws(() => formatApplyLogLine({ ...normal, url: 'postgres://u:p@host/db' }), /unknown audit-log field/);
    assert.throws(() => formatApplyLogLine({ ...normal, host: 'ep-example.neon.tech' }), /unknown audit-log field/);
    assert.doesNotMatch(formatApplyLogLine(normal), /postgres|@|neon\.tech/);
  });

  it('refuses a missing or non-migration filename', () => {
    assert.throws(() => formatApplyLogLine({ ...normal, filename: 'notes.txt' }), /filename/);
    assert.throws(() => formatApplyLogLine({ ...normal, filename: undefined }), /filename/);
  });

  it('refuses an unknown target', () => {
    assert.throws(() => formatApplyLogLine({ ...normal, target: 'staging' }), /target/);
    assert.throws(() => formatApplyLogLine({ ...normal, target: undefined }), /target/);
  });

  // `$` WITHOUT the `m` flag anchors at end of INPUT in ECMAScript, so the pattern
  // itself already refuses a trailing newline (measured, not assumed — a length
  // guard would be dead code). The cases below pin that it stays that strict.
  it('refuses a digest-shaped target that is not exactly 12 hex characters', () => {
    const digest = applyLogTarget('postgres://u:p@host.example:5432/db');
    assert.throws(() => formatApplyLogLine({ ...normal, target: digest + '\n' }), /target/);
    assert.throws(() => formatApplyLogLine({ ...normal, target: digest + 'x' }), /target/);
    assert.throws(() => formatApplyLogLine({ ...normal, target: digest.slice(0, -1) }), /target/);
  });

  // The change, pinned from the WRITE side: a role name is no longer an
  // acceptable target, not even the ones this runner used to write. Accepting
  // them would let the inference back in through the formatter.
  it('refuses a role name as a target, including the ones it used to write', () => {
    for (const role of LEGACY_APPLY_LOG_TARGETS) {
      assert.throws(() => formatApplyLogLine({ ...normal, target: role }), /target/);
    }
  });

  it('refuses an unusable git sha or timestamp', () => {
    assert.throws(() => formatApplyLogLine({ ...normal, git_sha: '' }), /git_sha/);
    assert.throws(() => formatApplyLogLine({ ...normal, applied_at: 'yesterday' }), /applied_at/);
  });

  it('refuses a malformed restore point', () => {
    assert.throws(() => formatApplyLogLine({ ...normal, restore_point: '<PASTE ID HERE>' }), /restore_point/);
    assert.throws(() => formatApplyLogLine({ ...normal, restore_point: 'abc' }), /restore_point/);
  });

  // A missing restore point is only honest when something explains it, so the
  // backfill case cannot be written without saying why.
  it('requires a non-empty note whenever the restore point is null', () => {
    assert.throws(() => formatApplyLogLine({ ...normal, restore_point: null, note: null }), /note/);
    assert.throws(() => formatApplyLogLine({ ...normal, restore_point: null, note: '   ' }), /note/);
    assert.throws(() => formatApplyLogLine({ ...normal, restore_point: null }), /note/);
    assert.match(
      formatApplyLogLine({ ...normal, restore_point: null, note: 'applied before guard' }),
      /applied before guard/
    );
  });

  // The combination the `--note` flag actually produces: a note ALONGSIDE a
  // valid restore point. Only the null-restore-point branch was pinned, so a
  // writer that dropped a non-null note would have passed every test above.
  it('carries a note alongside a restore point (the --note flag path)', () => {
    const rec = JSON.parse(
      formatApplyLogLine({
        ...normal,
        note: 'P1 co-location: new EU project eu-1 (aws-eu-central-1)',
      })
    );
    assert.equal(rec.note, 'P1 co-location: new EU project eu-1 (aws-eu-central-1)');
    assert.equal(rec.restore_point, 'br-abc12345');
    assert.deepStrictEqual(Object.keys(rec).sort(), APPLY_LOG_FIELDS);
  });

  it('refuses a note that is not a string', () => {
    assert.throws(() => formatApplyLogLine({ ...normal, note: 42 }), /note/);
  });

  it('returns one line with no terminator, and the terminator is CRLF', () => {
    assert.doesNotMatch(formatApplyLogLine(normal), /[\r\n]/);
    assert.strictEqual(APPLY_LOG_EOL, '\r\n');
  });
});

describe('database/migration-applies.jsonl', () => {
  const logPath = path.join(__dirname, '..', '..', 'database', 'migration-applies.jsonl');
  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line !== '');

  it('is present, non-empty and parses as JSONL', () => {
    assert.ok(lines.length >= 1, 'the tracked audit log must carry at least the 017 backfill');
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `unparseable audit line: ${line}`);
    }
  });

  it('carries the 017 backfill, which must explain its missing restore point', () => {
    const backfill = lines
      .map((line) => JSON.parse(line))
      .find((rec) => rec.filename === '017_offer_identity_and_provenance.sql');
    assert.ok(backfill, 'migration 017 was applied to shared before the guard existed');
    assert.strictEqual(backfill.restore_point, null);
    assert.ok(backfill.note && backfill.note.length > 0, 'a null restore point needs a note');
  });

  it('has exactly the whitelisted fields on every line', () => {
    for (const line of lines) {
      assert.deepStrictEqual(Object.keys(JSON.parse(line)).sort(), APPLY_LOG_FIELDS, `unexpected fields in ${line}`);
    }
  });

  it('never records a connection string, a credential or a hostname', () => {
    assert.doesNotMatch(raw, /postgres(ql)?:\/\//i);
    assert.doesNotMatch(raw, /@/);
    // Endpoint host labels are the one host fact a digest is derived from, so
    // assert none leaked: the digest is a hash, never the label itself.
    assert.doesNotMatch(raw, /ep-[a-z0-9-]+\./i);
  });

  it('keeps every field usable and every target known', () => {
    for (const line of lines) {
      const rec = JSON.parse(line);
      // The file legitimately holds pre-digest lines, written before
      // applyLogTarget existed; every line written from now on carries a
      // digest, and the formatter refuses to write a role name at all.
      assert.ok(
        LEGACY_APPLY_LOG_TARGETS.includes(rec.target) || TARGET_DIGEST_RE.test(rec.target),
        `unrecognized target in ${line}`
      );
      assert.ok(
        rec.restore_point === null || isValidRestorePointId(rec.restore_point),
        `bad restore point in ${line}`
      );
      assert.ok(!Number.isNaN(Date.parse(rec.applied_at)), `bad applied_at in ${line}`);
      if (rec.restore_point === null) {
        assert.ok(
          typeof rec.note === 'string' && rec.note.trim() !== '',
          `a null restore point needs a note in ${line}`
        );
      }
    }
  });

  // CRLF is what the writer appends, but git normalizes text on checkout, so a
  // clone without autocrlf legitimately holds LF. What must never happen is a
  // MIX produced by an append that used the wrong terminator.
  it('does not mix line terminators', () => {
    const terminators = raw.split('\n').slice(0, -1);
    const crlf = terminators.filter((line) => line.endsWith('\r')).length;
    assert.ok(crlf === 0 || crlf === terminators.length, 'every audit line must end the same way');
  });
});
