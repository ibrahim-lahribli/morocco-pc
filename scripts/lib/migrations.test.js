'use strict';

// scripts/lib/migrations.test.js — tests for the applied-migrations ledger
// helpers (gap OG-14).
//
// Uses node:test + node:assert/strict only. Pure functions (inputs passed as
// parameters; no file or DB access, no dotenv). NOT part of `npm run test:unit`
// (that glob is `src/**/*.test.js`); run with:
//   node --test scripts/lib/migrations.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pendingMigrations, staleLedgerEntries, LEDGER_TABLE, isValidRestorePointId, shouldRefuseSharedApply } = require('./migrations');

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
});
