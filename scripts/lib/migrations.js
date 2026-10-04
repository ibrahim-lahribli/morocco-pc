'use strict';

// scripts/lib/migrations.js — pure helpers for the applied-migrations ledger
// (gap OG-14, `docs/OPEN_GAPS.md`).
//
// Why this exists: `scripts/run-migrations.js` used to replay every
// `database/migrations/*.sql` file on every run. That is not re-runnable
// because `002_enums.sql` uses a bare `CREATE TYPE`, so a second run aborts at
// `type "product_category" already exists`. There was no applied-migrations
// tracking of any kind (no `schema_migrations` table, verified absent
// 2026-09-28 and again 2026-10-02). The workaround was "apply new files
// individually via a throwaway script", which compounds with every future
// migration.
//
// This module owns only the PURE part: given the sorted list of migration
// filenames on disk and the set already recorded in the ledger, which files
// still need to run? No I/O, no clock, no database — the caller supplies both
// inputs, so the decision is unit-testable without a DB (same shape as
// `scripts/lib/db-url.js` and `scripts/lib/gap-register.js`).
//
// Ledger table shape (created by the runner, not by a numbered migration, so a
// fresh 001->NNN replay stays clean):
//
//   schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())
//
// Deliberately NOT here: filename parsing / numeric ordering beyond the
// caller's already-sorted input, and any notion of a "baseline". Both are the
// runner's policy, not this module's.

/** The ledger table created and read by `scripts/run-migrations.js`. */
const LEDGER_TABLE = 'schema_migrations';

/** A migration filename, e.g. `001_extensions.sql`. */
const FILENAME_RE = /^\d+_.*\.sql$/;

/**
 * Return the migration files that still need to be applied, preserving the
 * caller's order.
 *
 * @param {string[]} allFiles sorted `database/migrations/*.sql` filenames
 * @param {string[]} appliedFiles filenames already recorded in the ledger
 * @returns {string[]} the pending subset, in `allFiles` order
 * @throws {TypeError} when an argument is not an array of strings
 */
function pendingMigrations(allFiles, appliedFiles) {
  if (!Array.isArray(allFiles) || allFiles.some((f) => typeof f !== 'string')) {
    throw new TypeError('allFiles must be an array of strings');
  }
  if (!Array.isArray(appliedFiles) || appliedFiles.some((f) => typeof f !== 'string')) {
    throw new TypeError('appliedFiles must be an array of strings');
  }
  const applied = new Set(appliedFiles);
  return allFiles.filter((f) => !applied.has(f));
}

/**
 * Report ledger entries that no longer correspond to a file on disk. A stale
 * ledger row is not fatal (renaming a committed migration is forbidden anyway),
 * but it is a real drift signal worth surfacing rather than hiding.
 *
 * @param {string[]} allFiles sorted migration filenames on disk
 * @param {string[]} appliedFiles filenames recorded in the ledger
 * @returns {string[]} applied filenames with no matching file, in ledger order
 */
function staleLedgerEntries(allFiles, appliedFiles) {
  if (!Array.isArray(allFiles) || allFiles.some((f) => typeof f !== 'string')) {
    throw new TypeError('allFiles must be an array of strings');
  }
  if (!Array.isArray(appliedFiles) || appliedFiles.some((f) => typeof f !== 'string')) {
    throw new TypeError('appliedFiles must be an array of strings');
  }
  const present = new Set(allFiles);
  return appliedFiles.filter((f) => !present.has(f));
}

module.exports = {
  LEDGER_TABLE,
  FILENAME_RE,
  pendingMigrations,
  staleLedgerEntries,
};
