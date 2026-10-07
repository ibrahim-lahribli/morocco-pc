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
 * The audit log written by a successful shared apply lives in the TRACKED,
 * append-only `database/migration-applies.jsonl`, so its field set is a
 * whitelist rather than a convention: a caller must not be able to persist a
 * connection string, a hostname or any other secret into a tracked file.
 */
const APPLY_LOG_FIELDS = ['applied_at', 'filename', 'git_sha', 'note', 'restore_point', 'target'];

/**
 * Permitted `target` values. `test` is accepted for symmetry; a TEST-branch
 * apply is deliberately NOT logged (the branch ledger is disposable).
 */
const APPLY_LOG_TARGETS = ['shared', 'test'];

/** Audit-log line terminator — CRLF, matching the rest of the tree. */
const APPLY_LOG_EOL = '\r\n';

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
 * a KNOWN, non-negative (number-typed) `pendingCount`, and no valid
 * `--restore-point=<id>` was supplied.
 *
 * The pending count is judged FAIL-CLOSED: an unknown, undefined, NaN,
 * non-number or otherwise malformed count REFUSES, because "I could not
 * determine what is pending" is not evidence that nothing is. A known `0`
 * still never refuses (there is nothing to apply).
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
  if (!Number.isInteger(o.pendingCount) || o.pendingCount < 0) return true;
  return o.pendingCount > 0 && !isValidRestorePointId(o.restorePoint);
}

/**
 * Render ONE audit-log line: the restore point, git SHA and timestamp for a
 * single applied file. Pure, and whitelisted in both directions — unknown keys
 * are REFUSED rather than dropped, so a caller cannot smuggle a connection
 * string into a tracked file, and an entry that would be incomplete is refused
 * instead of written.
 *
 * Returned WITHOUT a trailing terminator; the caller joins lines with
 * APPLY_LOG_EOL.
 *
 * @param {object} entry applied_at, filename, git_sha, note, restore_point, target
 * @returns {string} JSON with exactly APPLY_LOG_FIELDS keys
 * @throws {TypeError} when a field is unknown, missing or unusable
 */
function formatApplyLogLine(entry) {
  const e = entry || {};
  const unknown = Object.keys(e).filter((key) => !APPLY_LOG_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`unknown audit-log field(s): ${unknown.join(', ')}`);
  }
  if (typeof e.filename !== 'string' || !FILENAME_RE.test(e.filename)) {
    throw new TypeError('audit-log entry needs a migration filename (NNN_name.sql)');
  }
  if (!APPLY_LOG_TARGETS.includes(e.target)) {
    throw new TypeError(`audit-log target must be one of ${APPLY_LOG_TARGETS.join(', ')}`);
  }
  if (typeof e.git_sha !== 'string' || e.git_sha === '') {
    throw new TypeError('audit-log entry needs a git_sha ("unknown" when unavailable)');
  }
  if (typeof e.applied_at !== 'string' || Number.isNaN(Date.parse(e.applied_at))) {
    throw new TypeError('audit-log entry needs a parseable applied_at');
  }
  if (e.restore_point !== null && e.restore_point !== undefined && !isValidRestorePointId(e.restore_point)) {
    throw new TypeError('audit-log restore_point must be null or a valid restore-point id');
  }
  const restorePoint = e.restore_point === undefined ? null : e.restore_point;
  if (restorePoint === null && (typeof e.note !== 'string' || e.note.trim() === '')) {
    throw new TypeError('a null restore_point requires a non-empty note explaining it');
  }
  if (e.note !== null && e.note !== undefined && typeof e.note !== 'string') {
    throw new TypeError('audit-log note must be a string or null');
  }
  return JSON.stringify({
    applied_at: e.applied_at,
    filename: e.filename,
    git_sha: e.git_sha,
    note: e.note === undefined ? null : e.note,
    restore_point: restorePoint,
    target: e.target,
  });
}

module.exports = {
  LEDGER_TABLE,
  FILENAME_RE,
  APPLY_LOG_FIELDS,
  APPLY_LOG_TARGETS,
  APPLY_LOG_EOL,
  pendingMigrations,
  staleLedgerEntries,
  isValidRestorePointId,
  shouldRefuseSharedApply,
  formatApplyLogLine,
};
