'use strict';

/**
 * scripts/lib/target-parity.js - the PURE half of `check-target-parity.js`
 * (Platform P1 Sprint 1 Step 6).
 *
 * Why this exists at all: Sprint 1 replays the whole migration + seed stack into
 * a NEW Neon project, and every later latency measurement compares that target
 * with the old one. If the two catalogs differ - a missing migration, a seed
 * file skipped, a row lost - then "faster" may just mean "less data", and no
 * later run can tell the difference. So the comparison has to be mechanical and
 * it has to NAME the difference, not just say "different".
 *
 * Boundary: no SQL, no pg, no I/O. `readSnapshot` lives in the CLI; this module
 * only decides whether two snapshots are the same and how to print that.
 *
 * What a snapshot carries:
 *   ledger   `schema_migrations`.filename, in filename order (null if the table
 *            does not exist - a database that predates the ledger, which is a
 *            difference worth naming rather than an error)
 *   tables   every `public` BASE TABLE, name order (views excluded: a view can
 *            be recreated at any time and is not data)
 *   shape    ordered `kind|a|b` rows - every column's name/type/nullability and
 *            every enum label. This is the same derivation `gen-schema-reference`
 *            and `verify-docs --live` digest, compared as ROWS rather than as a
 *            16-hex hash: two different schemas colliding in 64 bits would be
 *            unreportable, and a hash cannot say WHICH column differs.
 *   counts   row counts for a fixed, named table list. A table missing from the
 *            list is a programming error, not a "match" (see compareSnapshots).
 */

/** Tables whose row counts must agree. The first seven are the plan's catalog
 * set (the rows the engine reads); the Layer 4 tables are included because the
 * new target must start EMPTY there, exactly like the old one. */
const PARITY_TABLES = Object.freeze([
  'product',
  'product_variant',
  'store_offer',
  'component_assessment',
  'scoring_model',
  'benchmark_result',
  'store',
  'recommendation_query',
  'recommendation_result',
  'build_candidate',
  'build_component',
  'build_rejection',
  'recommendation_preset',
]);

/** Short, credential-free label for one target. */
function describeLabel(label, snapshot) {
  return label + ' (' + (snapshot.ledger === null ? 'no ledger' : snapshot.ledger.length + ' files') + ')';
}

/**
 * 16-hex digest of a shape/ledger array. Used for DISPLAY only - comparison is
 * element-wise, so a collision can never hide a difference.
 *
 * @param {string[]} rows ordered rows
 * @returns {string} 16 lowercase hex characters
 */
function shortDigest(rows) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  for (const row of rows) hash.update(row + '\n');
  return hash.digest('hex').slice(0, 16);
}

/**
 * Format one comparison row: `MATCH` or `DIFF`, with both sides rendered.
 *
 * Long arrays are rendered as count + first difference rather than dumped: a
 * 40-table list is unreadable on a terminal, and the useful fact is the first
 * index where the two diverge.
 *
 * @param {string} check a stable check id
 * @param {string[]|null} a left value
 * @param {string[]|null} b right value
 * @returns {{check: string, status: string, detail: string}}
 */
function compareList(check, a, b) {
  if (a === null || b === null) {
    if (a === b) return { check, status: 'MATCH', detail: 'absent on both' };
    return { check, status: 'DIFF', detail: 'present on one side only' };
  }
  if (a.length !== b.length) {
    return { check, status: 'DIFF', detail: 'count ' + a.length + ' vs ' + b.length };
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return { check, status: 'DIFF', detail: 'first difference at index ' + i + ': ' + a[i] + ' vs ' + b[i] };
    }
  }
  return { check, status: 'MATCH', detail: a.length + ' entries' };
}

/**
 * Compare two snapshots read by the CLI.
 *
 * A count is `null` only when the table does not exist on that target, and two
 * absences are a MATCH: a pre-021 database legitimately has no
 * `recommendation_preset`, and comparing it with another pre-021 database must
 * not report drift. One absence against a real number IS a DIFF - that is the
 * case a replayed target must never reach.
 *
 * @param {object} a snapshot
 * @param {object} b snapshot
 * @returns {{ok: boolean, rows: Array<{check: string, status: string, detail: string}>}}
 */
function compareSnapshots(a, b) {
  const rows = [];
  rows.push(compareList('ledger-files', a.ledger, b.ledger));
  rows.push(compareList('tables', a.tables, b.tables));
  rows.push(compareList('schema-shape', a.shape, b.shape));

  for (const table of PARITY_TABLES) {
    const left = a.counts && Object.prototype.hasOwnProperty.call(a.counts, table) ? a.counts[table] : null;
    const right = b.counts && Object.prototype.hasOwnProperty.call(b.counts, table) ? b.counts[table] : null;
    if (left === null && right === null) {
      rows.push({ check: 'rows:' + table, status: 'MATCH', detail: 'absent on both' });
    } else if (left === null || right === null) {
      rows.push({
        check: 'rows:' + table,
        status: 'DIFF',
        detail: 'present on ' + (left === null ? 'B' : 'A') + ' only (' + left + ' vs ' + right + ')',
      });
    } else if (left !== right) {
      rows.push({ check: 'rows:' + table, status: 'DIFF', detail: left + ' vs ' + right });
    } else {
      rows.push({ check: 'rows:' + table, status: 'MATCH', detail: String(left) });
    }
  }

  return { ok: rows.every((row) => row.status === 'MATCH'), rows };
}

module.exports = {
  PARITY_TABLES,
  shortDigest,
  describeLabel,
  compareSnapshots,
};
