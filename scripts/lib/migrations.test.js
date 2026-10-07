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
  APPLY_LOG_FIELDS,
  APPLY_LOG_TARGETS,
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

describe('formatApplyLogLine', () => {
  const normal = {
    applied_at: '2026-10-07T00:00:00.000Z',
    filename: '019_example.sql',
    git_sha: 'abcdef1234567890abcdef1234567890abcdef12',
    note: null,
    restore_point: 'br-abc12345',
    target: 'shared',
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
  });

  it('keeps every field usable and every target known', () => {
    for (const line of lines) {
      const rec = JSON.parse(line);
      assert.ok(APPLY_LOG_TARGETS.includes(rec.target), `unknown target in ${line}`);
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
