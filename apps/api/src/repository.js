'use strict';

/**
 * apps/api/src/repository.js - every SQL statement the API issues.
 *
 * Boundary: SQL only. It contains no HTTP concepts (no status code, no error
 * mapping, no response shape), no engine import, and no business rule beyond
 * what each statement must do to be correct. Routes receive row-shaped data and
 * present it; the engine receives a query id and does the rest.
 *
 * The read-after-write design is deliberate (Decision 36 item 4): POST does NOT
 * build its response from the engine's in-memory result. It re-reads the
 * PERSISTED rows through the very same statement GET uses, so POST and GET are
 * identical on every persisted field by construction rather than by discipline
 * - and the API cannot accidentally expose a value that was never stored. The
 * engine result is used for exactly one additive thing: `budget_floor`, which
 * is a pass diagnostic and has no column to read back (migration 019, proposed
 * in Decision 36, would change that).
 *
 * Reads are parameterized only; nothing is interpolated. NUMERIC columns come
 * back from pg as strings and are converted by the presenter, not here, so the
 * row shape stays honest about what the database actually returned.
 */

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');

/**
 * The active scoring model.
 *
 * `is_active` IS the eligibility predicate here - unlike the engine's Decision
 * 11 loader, which resolves a PINNED id and treats ineligibility as an error,
 * the API has no pinned id yet and must choose one. The tie-break is explicit
 * (newest `created_at`, then `id`) so two active models never make the choice
 * depend on physical row order. No row means the caller answers 503; the API
 * never invents a model.
 */
const SELECT_ACTIVE_SCORING_MODEL_SQL = [
  'SELECT id, configuration',
  'FROM scoring_model',
  'WHERE is_active = true',
  'ORDER BY created_at DESC, id ASC',
  'LIMIT 1',
].join(' ');

/**
 * One profile per API request. `name` is the generated uuid: the unique index
 * `idx_recommendation_profile_name` (migration 011 5.3) makes a human name a
 * collision risk, and the name is not part of the API contract.
 */
const INSERT_PROFILE_SQL = [
  'INSERT INTO recommendation_profile (id, name, description, use_case, priority, default_resolution)',
  'VALUES ($1, $2, $3, $4, $5, $6)',
  'RETURNING id',
].join(' ');

/**
 * The query row the engine pins. `scoring_model_id` is resolved here, ONCE, and
 * stored - which is what makes the pass reproducible after the model list
 * changes: the row records which model produced it.
 */
const INSERT_QUERY_SQL = [
  'INSERT INTO recommendation_query',
  '  (id, recommendation_profile_id, scoring_model_id, budget_amount, currency, use_case, priority, resolution)',
  'VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
  'RETURNING id',
].join(' ');

/** The query resource itself: presence decides 404, created_at backs generated_at. */
const SELECT_QUERY_SQL = [
  'SELECT id, budget_amount, currency, use_case, created_at',
  'FROM recommendation_query',
  'WHERE id = $1',
].join(' ');

/**
 * Every persisted build of one query, flattened one row per component.
 *
 * ORDER BY is total and deterministic (rank, then the canonical enum order of
 * component_role, then the component id), so two reads of the same committed
 * data serialize to byte-identical JSON. The component joins are LEFT joins
 * because a build_candidate row is the unit of existence: a candidate with no
 * components still belongs to the response, and the presenter drops the null
 * component rows. `product_id`/`product_variant_id` are carried so the response
 * can name the component (the engine's in-memory build carries no product name;
 * product_variant has no name column at all - only `sku`).
 */
const SELECT_BUILDS_SQL = [
  'SELECT',
  '  r.rank,',
  '  r.explanation,',
  '  r.created_at AS result_created_at,',
  '  b.id AS build_candidate_id,',
  '  b.total_price,',
  '  b.score AS build_score,',
  '  b.compatibility_status,',
  '  c.id AS component_id,',
  '  c.component_role AS role,',
  '  c.product_id,',
  '  c.product_variant_id,',
  '  c.selected_price,',
  '  c.offer_class,',
  '  c.store_offer_id,',
  '  p.name AS product_name,',
  '  v.sku AS variant_sku',
  'FROM recommendation_result r',
  'JOIN build_candidate b ON b.id = r.build_candidate_id',
  'LEFT JOIN build_component c ON c.build_candidate_id = b.id',
  'LEFT JOIN product p ON p.id = c.product_id',
  'LEFT JOIN product_variant v ON v.id = c.product_variant_id',
  'WHERE r.recommendation_query_id = $1',
  'ORDER BY r.rank ASC, c.component_role ASC, c.id ASC',
].join(' ');

/**
 * The active scoring model, or null when none is active.
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @returns {Promise<{id: string, configuration: object}|null>}
 */
async function selectActiveScoringModel(db) {
  const result = await db.query(SELECT_ACTIVE_SCORING_MODEL_SQL);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return { id: row.id, configuration: row.configuration };
}

/**
 * Insert the profile+query pair in ONE transaction, so a failure leaves
 * neither row behind. Returns the ids the caller needs (the engine pins only
 * the query id; the profile id is returned for tests and diagnostics).
 *
 * @param {object} client a single dedicated connection
 * @param {object} input { scoringModelId, budgetAmount, currency, useCase,
 *        resolution, priority }
 * @returns {Promise<{profileId: string, queryId: string}>} frozen
 */
async function createRecommendationQuery(client, input) {
  const profileId = randomUUID();
  const queryId = randomUUID();
  await withTransaction(client, async (tx) => {
    await tx.query(INSERT_PROFILE_SQL, [
      profileId,
      'api-' + profileId,
      'Created by POST /v1/recommendations',
      input.useCase,
      input.priority === undefined ? null : input.priority,
      input.resolution === undefined ? null : input.resolution,
    ]);
    await tx.query(INSERT_QUERY_SQL, [
      queryId,
      profileId,
      input.scoringModelId,
      input.budgetAmount,
      input.currency,
      input.useCase,
      input.priority === undefined ? null : input.priority,
      input.resolution === undefined ? null : input.resolution,
    ]);
  });
  return Object.freeze({ profileId, queryId });
}

/**
 * Read the persisted state of one recommendation query.
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @param {string} queryId recommendation_query id
 * @returns {Promise<{found: boolean, query?: object, rows?: Array<object>}>}
 *          `found: false` means the query row itself is unknown - the ONLY 404
 *          condition. A known query with zero builds is `found: true, rows: []`.
 */
async function readRecommendationResult(db, queryId) {
  const queryResult = await db.query(SELECT_QUERY_SQL, [queryId]);
  const queryRows = queryResult && Array.isArray(queryResult.rows) ? queryResult.rows : [];
  if (queryRows.length === 0) {
    return { found: false };
  }
  const buildsResult = await db.query(SELECT_BUILDS_SQL, [queryId]);
  const rows = buildsResult && Array.isArray(buildsResult.rows) ? buildsResult.rows : [];
  return { found: true, query: queryRows[0], rows };
}

module.exports = {
  SELECT_ACTIVE_SCORING_MODEL_SQL,
  INSERT_PROFILE_SQL,
  INSERT_QUERY_SQL,
  SELECT_QUERY_SQL,
  SELECT_BUILDS_SQL,
  selectActiveScoringModel,
  createRecommendationQuery,
  readRecommendationResult,
};
