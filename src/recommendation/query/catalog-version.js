/**
 * Query support - `catalog_version` (Decision 47).
 *
 * Boundary: ONE read-only statement that returns a content digest of the
 * catalog tables the pipeline loaders read, and nothing else. No write, no
 * clock, no randomness, no engine-rule knowledge: this module answers exactly
 * one question - "what does the catalog say right now?" - the way a
 * `schema-digest` answers it for the schema.
 *
 * WHY A CONTENT DIGEST AND NOT `max(updated_at)` (Decision 47 item 1, and the
 * measurement in that entry). The schema has ZERO triggers
 * (`information_schema.triggers` is empty on both databases), so `updated_at`
 * only advances when a writer names the column. Measured on the shared
 * database: `updated_at > created_at` on 0 of 104 products, 0 of 19 CPUs, 0 of
 * 280 assessments and 0 of 8 motherboards - a corrective seed that edits a spec
 * value without naming `updated_at` (seed 008's and seed 009's own style) would
 * leave a max-`updated_at` watermark EXACTLY where it was, and a cache or a
 * dedupe keyed on it would then serve an answer computed against the OLD value.
 * A content digest cannot be stale by construction: it is derived, so it
 * changes iff the content does (Decision 47 item 2).
 *
 * DETERMINISM (Decision 47 item 9). Two calls against identical catalog content
 * return the identical string, in any session, on any host, in any evaluation
 * order:
 *   - the arms are folded in the DECLARED order of `CATALOG_COVERED_TABLES`, and
 *     the outer aggregate orders by the arm TEXT, so the digest is a set-fold
 *     rather than a sequence-dependent concat;
 *   - within an arm, rows are `ORDER BY row_text`, so physical row order is
 *     irrelevant;
 *   - AUDIT STAMPS ARE SUBTRACTED BY TYPE, not by a hand-kept column list:
 *     every column whose `data_type LIKE 'timestamp%'` is removed from the row's
 *     jsonb before hashing. That is what makes the digest independent of the
 *     session `TimeZone`, because a timestamp is the only type in this schema
 *     whose text rendering depends on a session GUC (`DateStyle` and
 *     `extra_float_digits` do not apply: the schema has no `real` or
 *     `double precision` column, and `numeric` renders exactly). Verified
 *     2026-10-16 on the shared database: the digest of `store_offer` (four
 *     `timestamptz` columns) and of `gpu_chipset` is byte-identical under
 *     `TimeZone = 'UTC'` and `TimeZone = 'Asia/Tokyo'`.
 *
 * WHY IT SUBTRACTS BY TYPE INSTEAD OF LISTING COLUMNS (Decision 47 item 6).
 * The whole row minus its timestamps is hashed, so a spec column added by a
 * later migration is covered the moment it exists. A per-column projection
 * would silently stop being sensitive to a new column - a fresh silent-failure
 * mode, in a repo whose worst recorded defects are silent ones. Subtracting by
 * TYPE keeps the same property on the exclusion side: a future timestamp column
 * under any name is excluded automatically, so the GUC-invariance above cannot
 * be broken by a naming convention.
 *
 * SENSITIVITY IS THE BINDING PROPERTY (Decision 47 item 5). The digest MUST
 * change when any non-timestamp value in a covered table changes, including an
 * in-place correction that alters neither a row count nor any timestamp. A
 * false invalidation costs a recomputation; a missed one serves a wrong answer.
 *
 * ONE ROUND TRIP (Decision 47 item 8). The statement is a single `SELECT` with
 * one arm per covered table. At this catalog (~700 rows across 21 tables) it is
 * far cheaper than the ~74-statement pass it makes skippable. It is O(catalog
 * rows) per call; the re-check trigger that retires the mechanism is a catalog
 * orders of magnitude larger, or a call site that needs it on a path which
 * would otherwise never touch the database - and the replacement then is a
 * persisted counter or a trigger-maintained watermark, decided on a
 * measurement.
 *
 * WHAT IS OUT OF SCOPE, DELIBERATELY (Decision 47 item 3). Pipeline outputs
 * (`recommendation_query`, `build_candidate`, `recommendation_result`,
 * `build_component`, `build_rejection`) are NOT catalog: folding them in would
 * make the version change on every POST, i.e. version every request differently
 * by construction, and the request is identified by the dedupe key's own
 * components instead. `store` and `spec_provenance` are out of scope because no
 * read-path loader touches them: `store` is read by `ingestion/plan.js` and
 * `spec_provenance` is written by `ingestion/apply.js`, both on the write-side
 * ingestion path. Adding a loader that reads a new table makes that table
 * in-scope in the same change.
 *
 * `scoring_model` IS in scope (Decision 47 item 7), although the dedupe key also
 * carries a model pin: a pin names `name@version` (`scripts/lib/model-pin.js`),
 * so flipping `is_active` or editing `configuration` under an unchanged name and
 * version would change every recommendation while leaving the pin - and a
 * version built only from spec tables - untouched.
 *
 * NOT owned here: any write, the snapshot transaction (the caller owns it), the
 * dedupe lookup itself (`apps/api/src/repository.js`), and the decision about
 * what a digest FAILURE means for a request - that policy belongs to the
 * caller, which degrades to "not recorded" and disables reuse rather than
 * guessing (see `apps/api/src/routes/recommendations.js`).
 */

'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/**
 * The catalog tables a read-path loader SELECTs (Decision 47 item 3), in the
 * DECLARED order the arms are folded in.
 *
 * Derived 2026-10-16 by a `FROM`/`JOIN` sweep over all of `src/recommendation/`:
 * the eight spec tables, the six presence/compatibility tables, and the seven
 * shared ones. Every name was checked against `information_schema.columns` -
 * a table that did not exist would abort the digest with 42P01, so this list is
 * a contract, not a convenience.
 */
const CATALOG_COVERED_TABLES = Object.freeze([
  // Layers 1-3 shared by every role.
  'product',
  'product_variant',
  'store_offer',
  'component_assessment',
  'scoring_model',
  'platform',
  'gpu_chipset',
  // Layer 1 spec tables, one per role.
  'cpu_spec',
  'gpu_board_spec',
  'motherboard_spec',
  'ram_spec',
  'ssd_spec',
  'psu_spec',
  'cooler_spec',
  'case_spec',
  // Presence / compatibility tables.
  'cpu_motherboard_support',
  'cooler_socket_support',
  'motherboard_memory_support',
  'platform_memory_support',
  'case_radiator_support',
  'case_motherboard_form_factor',
]);

/** The digest's own shape: 32 lowercase hex characters (an md5). */
const CATALOG_VERSION_RE = /^[0-9a-f]{32}$/;

/**
 * Quote a table name as a SQL string literal. The names are constants declared
 * above, never caller input - this is bounds-checking, not sanitizing, and it is
 * the reason no name can reach the statement unquoted even if one is edited into
 * something surprising later.
 */
function quoteLiteral(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/**
 * One arm: the table's name, its row count, and the md5 of its rows rendered
 * as jsonb with every timestamp column subtracted.
 *
 * `to_jsonb(row_value)` normalizes key order per jsonb's own canonical
 * ordering, so the rendering is independent of the column order in
 * `information_schema`. The `- text[]` removal is set-based, so the unordered
 * `array_agg` inside it cannot affect the result.
 *
 * `COALESCE(..., ARRAY[]::text[])` matters: a table with NO timestamp column
 * would produce no row in the grouped catalogue subquery, and subtracting NULL
 * would null the whole row text (silently emptying that arm). Every covered
 * table has at least `created_at` today, but the digest must not depend on that.
 */
function fingerprintArm(table) {
  const name = quoteLiteral(table);
  return [
    'SELECT',
    '  ' + name + ' AS tbl,',
    '  count(*)::text AS row_count,',
    "  coalesce(md5(string_agg(row_text, '' ORDER BY row_text)), '') AS fingerprint",
    'FROM (',
    '  SELECT (to_jsonb(row_value) - COALESCE((',
    '    SELECT array_agg(column_name) FROM information_schema.columns',
    "     WHERE table_schema = 'public' AND table_name = " + name,
    "       AND data_type LIKE 'timestamp%'",
    '  ), ARRAY[]::text[]))::text AS row_text',
    '  FROM ' + table + ' row_value',
    ') rows',
  ].join(' ');
}

/**
 * The single statement. Built once at module load from the declared list, so a
 * caller cannot vary the covered set per request.
 *
 * The outer aggregate orders by the arm text rather than by `tbl`: each arm
 * begins with its own quoted table name, so the arms are distinct, and ordering
 * by the folded value makes the digest a set-fold over the arms - the SQL
 * engine's evaluation order cannot leak into the result.
 */
function buildCatalogVersionSql(tables) {
  return [
    "SELECT md5(string_agg(arm, '|' ORDER BY arm)) AS catalog_version",
    'FROM (',
    "  SELECT tbl || ':' || row_count || ':' || fingerprint AS arm FROM (",
    tables.map(fingerprintArm).map((arm) => '    ' + arm).join('\n    UNION ALL\n'),
    '  ) per_table',
    ') arms',
  ].join('\n');
}

const CATALOG_VERSION_SQL = buildCatalogVersionSql(CATALOG_COVERED_TABLES);

/** Same db contract as Engine 2B / 2D / Stage 1 / Decision 10 / Decision 11. */
function validateDatabaseClient(db) {
  if (db === null || typeof db !== 'object' || typeof db.query !== 'function') {
    throw new CandidateSelectionError(
      ERROR_CODES.INVALID_INPUT,
      'catalogVersion requires a database client exposing query()',
      'db'
    );
  }
}

/**
 * Compute the catalog's content version.
 *
 * Read-only, deterministic, and free of any session-GUC dependence. PostgreSQL
 * errors propagate unchanged (never swallowed, never converted): what a failure
 * MEANS is the caller's policy, not this module's.
 *
 * @param {object} db pg-compatible client exposing db.query(sql[, params])
 * @returns {Promise<string>} 32 lowercase hex characters
 * @throws {CandidateSelectionError} INVALID_INPUT on a missing client or a
 *         result that is not a 32-hex digest - fail fast rather than hand a
 *         caller a junk key it would persist and later compare for equality.
 */
async function catalogVersion(db) {
  validateDatabaseClient(db);

  const result = await db.query(CATALOG_VERSION_SQL);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  const digest = rows.length > 0 ? rows[0].catalog_version : undefined;

  if (typeof digest !== 'string' || !CATALOG_VERSION_RE.test(digest)) {
    throw new CandidateSelectionError(
      ERROR_CODES.INVALID_INPUT,
      'catalogVersion produced no digest: the statement must return one 32-character hex value',
      'catalog_version'
    );
  }

  return digest;
}

module.exports = {
  catalogVersion,
  CATALOG_VERSION_SQL,
  CATALOG_COVERED_TABLES,
  CATALOG_VERSION_RE,
  buildCatalogVersionSql,
  fingerprintArm,
};
