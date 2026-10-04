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

const { pendingMigrations, staleLedgerEntries, LEDGER_TABLE } = require('./migrations');

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
