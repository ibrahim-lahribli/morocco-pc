'use strict';

// scripts/lib/pass-rows.js — the Layer 4 rows ONE recommendation pass leaves
// behind: how to count them, how to delete them, and how to prove they are gone.
//
// WHY A MODULE WITH A CLIENT PARAMETER
// The bookkeeping is the same for every writer-side probe (the role rehearsal
// `scripts/rehearse-api-role.js` and the production smoke test
// `scripts/smoke-api-role.js` both drive a real pass and must remove what it
// wrote), and its ORDER is load-bearing rather than incidental:
//
//   build_rejection -> recommendation_result -> build_component ->
//   build_candidate -> recommendation_query -> recommendation_profile
//
// Every FK back to `recommendation_query` is ON DELETE NO ACTION and the query's
// own FK points at `recommendation_profile`, so deleting the parent first raises
// a constraint violation and `build_order` rows survive. That is not theoretical:
// a probe that threw inside its own cleanup once left rows that blocked the
// golden harness preflight, which refuses to run while ANY unmarked
// `recommendation_query` row exists.
//
// I/O lives here and only here, in a parameterised form: every function takes a
// pg-compatible client, so the caller keeps ownership of the connection and this
// module opens nothing.

/** The six tables the API/engine write path touches, in DELETE order. */
const LAYER4_TABLES = Object.freeze([
  'recommendation_profile',
  'recommendation_query',
  'build_candidate',
  'build_component',
  'recommendation_result',
  'build_rejection',
]);

/** The DELETE order, children first (see the header). */
const DELETE_ORDER = Object.freeze([
  'build_rejection',
  'recommendation_result',
  'build_component',
  'build_candidate',
  'recommendation_query',
  'recommendation_profile',
]);

function fail(message) {
  throw new Error(message);
}

function assertClient(client) {
  if (!client || typeof client.query !== 'function') {
    fail('pass-rows requires a pg-compatible client exposing query()');
  }
}

/**
 * Row counts for all six Layer 4 tables in ONE round trip.
 *
 * Whole-table counts, not counts scoped to the caller's ids: a scoped-to-ids
 * zero would miss a row written outside the tracked ids (a crashed pass, an
 * abandoned probe), while a before/after comparison of the whole table cannot.
 *
 * @param {object} client pg-compatible client
 * @returns {Promise<Record<string, number>>} table name -> count
 */
async function layer4Counts(client) {
  assertClient(client);
  const sql = LAYER4_TABLES
    .map((table) => "SELECT '" + table + "' AS table_name, count(*)::int AS n FROM " + table)
    .join(' UNION ALL ');
  const result = await client.query(sql + ' ORDER BY 1');
  const counts = {};
  for (const row of result.rows) counts[row.table_name] = Number(row.n);
  return counts;
}

/**
 * Delete the rows of ONE pass, children first, strictly scoped to its ids.
 *
 * Runs as whoever owns the connection: the API role cannot delete
 * `build_candidate` by design, so a rehearsal's cleanup is the OPERATOR's work,
 * not the role's.
 *
 * @param {object} client pg-compatible client
 * @param {{queryId: string, profileId?: string|null}} ids the pass to remove
 * @returns {Promise<Record<string, number>>} per-table deleted row counts
 */
async function deletePassRows(client, ids) {
  assertClient(client);
  const source = ids || {};
  const removed = {};
  if (!source.queryId) return removed;
  const steps = [
    ['build_rejection', 'DELETE FROM build_rejection WHERE recommendation_query_id = $1::uuid'],
    ['recommendation_result', 'DELETE FROM recommendation_result WHERE recommendation_query_id = $1::uuid'],
    ['build_component', 'DELETE FROM build_component WHERE build_candidate_id IN (SELECT id FROM build_candidate WHERE recommendation_query_id = $1::uuid)'],
    ['build_candidate', 'DELETE FROM build_candidate WHERE recommendation_query_id = $1::uuid'],
    ['recommendation_query', 'DELETE FROM recommendation_query WHERE id = $1::uuid'],
  ];
  for (const [table, sql] of steps) {
    const result = await client.query(sql, [source.queryId]);
    removed[table] = result.rowCount;
  }
  if (source.profileId) {
    const result = await client.query('DELETE FROM recommendation_profile WHERE id = $1::uuid', [source.profileId]);
    removed.recommendation_profile = result.rowCount;
  }
  return removed;
}

/**
 * Which tables drifted between two `layer4Counts` snapshots. Pure.
 *
 * @param {Record<string, number>} before
 * @param {Record<string, number>} after
 * @returns {Array<{table: string, before: number, after: number}>} sorted by table
 */
function residueDrift(before, after) {
  const left = before || {};
  const right = after || {};
  return LAYER4_TABLES
    .filter((table) => Number(right[table] || 0) !== Number(left[table] || 0))
    .map((table) => ({ table, before: Number(left[table] || 0), after: Number(right[table] || 0) }));
}

module.exports = {
  DELETE_ORDER,
  LAYER4_TABLES,
  deletePassRows,
  layer4Counts,
  residueDrift,
};
