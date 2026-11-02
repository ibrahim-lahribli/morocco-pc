'use strict';

/**
 * scripts/lib/catalog-identity.js - the PURE half of
 * `scripts/check-catalog-identity.js` (OG-60; HANDOFF_2026-11-01).
 *
 * WHY THIS EXISTS
 * Migration 020 introduced `product.display_name` and `product.slug` and
 * backfilled the catalogue that existed when it ran. It deliberately left both
 * columns NULLABLE - its own header says so, so fixtures and product writers that
 * omit them stay legal - which means every catalogue seed written afterwards had
 * to supply them itself. Three did not: seeds 023, 024 and 025 inserted 13
 * products with BOTH columns NULL, and the API served `component.slug: null` to a
 * client that cannot tell that from a product with no page. On EU, where the seeds
 * replayed after 020 had backfilled an EMPTY table, the entire catalogue of 100
 * rows carried no identity at all.
 *
 * The suite that caught it, `test:api:db`, is not in the push/PR job - it runs in
 * `recurring-gates` only - so nothing on the path to a merge could have noticed.
 * This gate is the missing read: does every ACTIVE product still carry the
 * identity the API serves and ORDERS BY?
 *
 * SCOPE - every ACTIVE product, not "ACTIVE products carrying an eligible offer"
 * The narrower scope is tempting and wrong. `GET /v1/catalog/products` filters
 * `p.lifecycle_status = 'ACTIVE' AND p.slug IS NOT NULL` and keyset-paginates on
 * `slug`, while `GET /v1/catalog/products/:slug` addresses a product BY that
 * column - so a NULL slug does not deprioritise a product, it removes it from the
 * catalog and from every URL that could reach it. The same product still ships
 * inside a recommendation component, which is exactly how `slug: null` reached a
 * client. Nothing here joins `store_offer`.
 *
 * WHY NOT A `NOT NULL` CONSTRAINT
 * Migration 020 keeps `slug` nullable on purpose, and a constraint would reverse
 * that decision for every future fixture and product writer. A gate respects the
 * decision and reports instead: the repair for today's rows is seed 028, and the
 * repair for tomorrow's is the insert-time derivation seeds 023-025 now follow.
 *
 * VERDICTS - three, never two
 *   PASS          every in-scope product carries both columns.
 *   FAIL          at least one does not; each offender is named with the column(s)
 *                 it lacks, so the report states the repair rather than a verdict.
 *   INCONCLUSIVE  no ACTIVE product exists, so nothing could be checked. Exit 0 on
 *                 purpose, but it is NOT a pass and the line says so in words.
 *
 * PURITY. No `pg`, no clock read, no randomness, and no mutation of the caller's
 * rows. The caller supplies exactly what the database returned;
 * `scripts/check-catalog-identity.js` owns the SELECT and the connection.
 */

/** The two columns migration 020 introduced, in report order. */
const IDENTITY_COLUMNS = Object.freeze(['slug', 'display_name']);

/** One class per outcome; this enum is the report's vocabulary. */
const VERDICTS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
});

/**
 * Exit status per verdict. FAIL is the only failure: INCONCLUSIVE checked nothing
 * and must not turn a nightly job red for an empty database, which is a state the
 * replay harness creates deliberately.
 */
const EXIT_CODES = Object.freeze({
  PASS: 0,
  INCONCLUSIVE: 0,
  FAIL: 1,
});

/**
 * Which identity columns this row lacks, in `IDENTITY_COLUMNS` order.
 * NULL and absent are the same answer: neither can be served.
 *
 * @param {object} row a `product` row as read, e.g. `{id, name, slug, display_name}`
 * @returns {string[]} subset of `IDENTITY_COLUMNS`, possibly empty
 */
function missingIdentityColumns(row) {
  const source = row === null || row === undefined ? {} : row;
  return IDENTITY_COLUMNS.filter(
    (key) => source[key] === null || source[key] === undefined
  );
}

/** Code-unit comparison on `id`. Never `localeCompare` (AGENTS.md section 5). */
function compareOffenders(a, b) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Classify a read of the ACTIVE catalogue.
 *
 * `rows` may be the WHOLE in-scope read (the CLI passes every ACTIVE product and
 * lets this function pick the offenders) or only the offenders - either way the
 * result is the same. `scopeSize` defaults to `rows.length`; pass it explicitly
 * when the caller's read is narrower than the scope it is judging.
 *
 * @param {{scopeSize?: number, rows?: object[]}} input
 * @returns {{verdict: string, scopeSize: number, offenderCount: number,
 *   offenders: {id: string, name: *, missing: string[]}[]}}
 */
function evaluateCatalogIdentity(input) {
  const source = input === null || input === undefined ? {} : input;
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const scopeSize = typeof source.scopeSize === 'number' ? source.scopeSize : rows.length;

  const offenders = rows
    .map((row) => ({
      id: String(row.id),
      name: row.name,
      missing: missingIdentityColumns(row),
    }))
    .filter((row) => row.missing.length > 0)
    .sort(compareOffenders);

  let verdict = VERDICTS.PASS;
  if (scopeSize === 0) verdict = VERDICTS.INCONCLUSIVE;
  else if (offenders.length > 0) verdict = VERDICTS.FAIL;

  return {
    verdict,
    scopeSize,
    offenderCount: offenders.length,
    offenders,
  };
}

/**
 * The process exit status for a verdict. An unknown verdict THROWS rather than
 * defaulting to 0: a caller that invented a fourth value has a bug, and exiting
 * green on it would hide the gate entirely.
 *
 * @param {string} verdict one of `VERDICTS`
 * @returns {number} 0 or 1
 */
function verdictExitCode(verdict) {
  if (!Object.prototype.hasOwnProperty.call(EXIT_CODES, verdict)) {
    throw new Error('catalog-identity: unknown verdict ' + JSON.stringify(verdict));
  }
  return EXIT_CODES[verdict];
}

/**
 * Render a result as printable lines. Kept pure so the truncation contract is
 * testable without a database: the header always states the FULL offender count
 * while at most `maxExamples` offenders are listed, because a nightly log that
 * prints thousands of rows gets scrolled past and one that prints only the sample
 * makes the damage look small.
 *
 * @param {object} result from `evaluateCatalogIdentity`
 * @param {number} [maxExamples] how many offenders to list (default 20)
 * @returns {string[]}
 */
function formatReport(result, maxExamples = 20) {
  const limit = Number.isInteger(maxExamples) && maxExamples > 0 ? maxExamples : 20;

  if (result.verdict === VERDICTS.INCONCLUSIVE) {
    return ['RESULT: INCONCLUSIVE - no ACTIVE product exists; nothing could be checked'];
  }
  if (result.verdict === VERDICTS.PASS) {
    return ['RESULT: PASS - ' + result.scopeSize + ' ACTIVE product(s), every one carries '
      + IDENTITY_COLUMNS.join(' and ')];
  }

  const shown = Math.min(limit, result.offenderCount);
  const lines = [
    'RESULT: FAIL - ' + result.offenderCount + ' of ' + result.scopeSize
      + ' ACTIVE product(s) missing identity (showing ' + shown + '):',
  ];
  for (const offender of result.offenders.slice(0, limit)) {
    lines.push('  id=' + offender.id + ' name="' + String(offender.name) + '" missing='
      + offender.missing.join(','));
  }
  return lines;
}

module.exports = {
  EXIT_CODES,
  IDENTITY_COLUMNS,
  VERDICTS,
  evaluateCatalogIdentity,
  formatReport,
  missingIdentityColumns,
  verdictExitCode,
};
