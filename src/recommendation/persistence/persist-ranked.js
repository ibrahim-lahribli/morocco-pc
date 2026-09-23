/**
 * Engine 5b - ranked persistence writer (Decision 19, DML only).
 *
 * Persists the `selected` array from selectDiverseTop: one build_candidate row
 * plus its build_component rows plus one recommendation_result row per entry.
 * Fake-client tested: this module only calls client.query(sql, params) with
 * parameterized queries; it never issues BEGIN/COMMIT/ROLLBACK (Decision 19.1),
 * never builds SQL by concatenation, and never writes a non-NULL explanation
 * (Decision 19.5). UUIDs are generated in JS via crypto.randomUUID()
 * (Decision 19.4). Build_component price columns come from component.price.*
 * (selected_price, currency, store_id, price_checked_at); component.category,
 * component.status, and build.currency are ignored (Decision 19.6).
 */
'use strict';

const { randomUUID } = require('node:crypto');
const { validateSelected } = require('./validate-selected');

const INSERT_BUILD_CANDIDATE =
  'INSERT INTO build_candidate (id, recommendation_query_id, total_price, score, compatibility_status) VALUES ($1,$2,$3,$4,$5)';
const INSERT_BUILD_COMPONENT =
  'INSERT INTO build_component (id, build_candidate_id, product_id, product_variant_id, component_role, selected_price, currency, store_id, price_checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)';
const INSERT_RECOMMENDATION_RESULT =
  'INSERT INTO recommendation_result (id, recommendation_query_id, build_candidate_id, rank, explanation) VALUES ($1,$2,$3,$4,$5)';

/**
 * Persist ranked builds. Entries are written in input (persisted_rank) order;
 * components are written in their existing order (never re-sorted).
 *
 * @param {object} args
 * @param {object} args.client   query executor exposing query(sql, params)
 * @param {string} args.queryId  recommendation_query id (passed through)
 * @param {Array} args.selected  validated via validateSelected(selected)
 * @returns {Promise<object>} frozen { query_id, persisted_ranks,
 *          build_candidate_ids, recommendation_result_ids }
 */
async function persistRanked({ client, queryId, selected }) {
  validateSelected(selected);

  if (selected.length === 0) {
    return Object.freeze({
      query_id: queryId,
      persisted_ranks: Object.freeze([]),
      build_candidate_ids: Object.freeze([]),
      recommendation_result_ids: Object.freeze([]),
    });
  }

  const persistedRanks = [];
  const buildCandidateIds = [];
  const recommendationResultIds = [];

  for (let i = 0; i < selected.length; i += 1) {
    const entry = selected[i];
    const buildCandidateId = randomUUID();
    await client.query(INSERT_BUILD_CANDIDATE, [
      buildCandidateId,
      queryId,
      entry.total_price,
      entry.build_score,
      entry.compatibility_status,
    ]);

    const components = entry.build.components;
    for (let c = 0; c < components.length; c += 1) {
      const component = components[c];
      const componentId = randomUUID();
      await client.query(INSERT_BUILD_COMPONENT, [
        componentId,
        buildCandidateId,
        component.product_id,
        component.product_variant_id,
        component.component_role,
        component.price.selected_price,
        component.price.currency,
        component.price.store_id,
        component.price.price_checked_at,
      ]);
    }

    const resultId = randomUUID();
    await client.query(INSERT_RECOMMENDATION_RESULT, [
      resultId,
      queryId,
      buildCandidateId,
      entry.persisted_rank,
      null,
    ]);

    persistedRanks.push(entry.persisted_rank);
    buildCandidateIds.push(buildCandidateId);
    recommendationResultIds.push(resultId);
  }

  return Object.freeze({
    query_id: queryId,
    persisted_ranks: Object.freeze(persistedRanks),
    build_candidate_ids: Object.freeze(buildCandidateIds),
    recommendation_result_ids: Object.freeze(recommendationResultIds),
  });
}

module.exports = { persistRanked };
