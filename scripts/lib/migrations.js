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

/**
 * A Neon restore-point id, e.g. `br-abc12345` or `rp_20261006_01`. The runner
 * never validates that the id EXISTS (only Neon knows that) — it validates
 * shape so a missing flag or a pasted placeholder cannot slip through:
 * `[A-Za-z0-9_-]{8,}`. Placeholders such as `<PASTE ID HERE>` fail on the
 * angle brackets and spaces alone.
 *
 * @param {unknown} value the raw `--restore-point=` value (or null/undefined)
 * @returns {boolean} true when the value is an acceptable restore-point id
 */
function isValidRestorePointId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,}$/.test(value);
}

/**
 * Decide whether a shared-target run must refuse. Pure so the refusal path is
 * unit-testable without a database.
 *
 * Refuse when ALL of these hold: the target is the shared DATABASE_URL (not
 * --test-db), the mode is not read-only (--dry-run / --check / --offline), at
 * least one migration is pending, and no valid `--restore-point=<id>` was
 * supplied.
 *
 * `--baseline` is deliberately NOT exempt, even though it executes no SQL: it
 * WRITES the ledger. A mis-typed `--baseline` on the shared database could
 * therefore record a migration as applied that was never applied, leaving the
 * database silently behind its own ledger while every later run reports "No
 * pending migrations".
 *
 * Of the three read-only flags, only the exemption itself matters here: main()
 * returns before this point for each of them, so they are always false at the
 * current call site and are kept as defensive guards.
 *
 * @param {object} opts
 * @param {boolean} opts.targetShared true when targeting DATABASE_URL
 * @param {number} opts.pendingCount number of pending migrations
 * @param {boolean} [opts.dryRun] read-only preview mode
 * @param {boolean} [opts.check] freshness-gate mode (executes nothing)
 * @param {boolean} [opts.offline] no-DB mode
 * @param {unknown} [opts.restorePoint] raw restore-point value
 * @returns {boolean} true when the run must refuse
 */
function shouldRefuseSharedApply(opts) {
  const o = opts || {};
  if (!o.targetShared) return false;
  if (o.dryRun || o.check || o.offline) return false;
  if (typeof o.pendingCount !== 'number' || o.pendingCount <= 0) return false;
  return !isValidRestorePointId(o.restorePoint);
}

module.exports = {
  LEDGER_TABLE,
  FILENAME_RE,
  pendingMigrations,
  staleLedgerEntries,
  isValidRestorePointId,
  shouldRefuseSharedApply,
};
