/**
 * Engine 5b - ranked persistence writer (Decision 19, DML only).
 *
 * Persists the `selected` array from the pre-persistence showcase
 * (`selectArchetypes().selected` since Decision 41; the array shape is
 * unchanged from the `selectDiverseTop` walk it replaced): one build_candidate row
 * plus its build_component rows plus one recommendation_result row per entry.
 * Fake-client tested: this module only calls client.query(sql, params) with
 * parameterized queries; it never issues BEGIN/COMMIT/ROLLBACK (Decision 19.1),
 * never builds SQL by concatenation, and writes entry.explanation as $5
 * (Decision 22 item 5). UUIDs are generated in JS via crypto.randomUUID()
 * (Decision 19.4). Build_component price columns come from component.price.*
 * (selected_price, currency, store_id, price_checked_at, offer_id,
 * offer_class); component.category, component.status, and build.currency are
 * ignored (Decision 19.6). Decision 35: offer_class and store_offer_id are the
 * provenance SNAPSHOT written inside this same transaction, so a later
 * store_offer UPDATE cannot relabel an already-persisted build.
 *
 * P1 Sprint 2 - batching: each of the three writers is ONE multi-row statement
 * per call, for any number of builds. The row source is
 * `SELECT * FROM UNNEST($1::ts[], $2::ts[], ...)`, which zips the parameter
 * arrays positionally: one element per ROW, one parameter per COLUMN. That
 * keeps the statements' TEXT fixed (no string building, no placeholder
 * arithmetic) while removing the per-row round trip, which was the commit
 * phase's largest cost. Two consequences worth stating:
 *   - every parameter is now an ARRAY, and all of a statement's arrays must be
 *     the same length or Postgres pads the short ones with NULL (UNNEST does
 *     not raise) - the parameter list is therefore built in lockstep below, one
 *     push per row per column, never conditionally;
 *   - the enum columns carry their enum's cast ($5::compatibility_status[],
 *     $5::component_role[]) because `text` has no implicit assignment cast to
 *     an enum in an INSERT ... SELECT. The other casts are required for the
 *     same reason in reverse: without them UNNEST receives an unknown-type
 *     array.
 * Row order, column values, NULLs and the returned id lists are all unchanged,
 * so a later reader cannot tell the batched writer from the per-row one.
 */
'use strict';

const { randomUUID } = require('node:crypto');
const { validateSelected } = require('./validate-selected');

// One statement, one parameter per column, one array element per row. The
// column list and the cast order below are the SAME order - `SELECT *` from
// UNNEST yields the arrays in the order they are passed.
const INSERT_BUILD_CANDIDATE =
  'INSERT INTO build_candidate (id, recommendation_query_id, total_price, score, compatibility_status)'
  + ' SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::numeric[], $4::numeric[], $5::compatibility_status[])';
const INSERT_BUILD_COMPONENT =
  'INSERT INTO build_component (id, build_candidate_id, product_id, product_variant_id, component_role, selected_price, currency, store_id, price_checked_at, offer_class, store_offer_id)'
  + ' SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::component_role[], $6::numeric[], $7::text[], $8::uuid[], $9::timestamptz[], $10::text[], $11::uuid[])';
const INSERT_RECOMMENDATION_RESULT =
  'INSERT INTO recommendation_result (id, recommendation_query_id, build_candidate_id, rank, explanation)'
  + ' SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::uuid[], $4::integer[], $5::text[])';

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

  // build_candidate: one statement's parameters.
  const candidateIds = [];
  const candidateQueryIds = [];
  const candidateTotalPrices = [];
  const candidateScores = [];
  const candidateStatuses = [];

  // build_component: its own arrays, pushed in the same nested loop so the
  // component order and the candidate id each row belongs to cannot drift.
  const componentIds = [];
  const componentBuildCandidateIds = [];
  const componentProductIds = [];
  const componentProductVariantIds = [];
  const componentRoles = [];
  const componentSelectedPrices = [];
  const componentCurrencies = [];
  const componentStoreIds = [];
  const componentPriceCheckedAts = [];
  const componentOfferClasses = [];
  const componentStoreOfferIds = [];

  // recommendation_result: one statement's parameters.
  const resultIds = [];
  const resultQueryIds = [];
  const resultBuildCandidateIds = [];
  const resultRanks = [];
  const resultExplanations = [];

  for (let i = 0; i < selected.length; i += 1) {
    const entry = selected[i];
    const buildCandidateId = randomUUID();
    candidateIds.push(buildCandidateId);
    candidateQueryIds.push(queryId);
    candidateTotalPrices.push(entry.total_price);
    candidateScores.push(entry.build_score);
    candidateStatuses.push(entry.compatibility_status);

    const components = entry.build.components;
    for (let c = 0; c < components.length; c += 1) {
      const component = components[c];
      componentIds.push(randomUUID());
      componentBuildCandidateIds.push(buildCandidateId);
      componentProductIds.push(component.product_id);
      componentProductVariantIds.push(component.product_variant_id);
      componentRoles.push(component.component_role);
      componentSelectedPrices.push(component.price.selected_price);
      componentCurrencies.push(component.price.currency);
      componentStoreIds.push(component.price.store_id);
      componentPriceCheckedAts.push(component.price.price_checked_at);
      componentOfferClasses.push(component.price.offer_class);
      componentStoreOfferIds.push(component.price.offer_id);
    }

    const resultId = randomUUID();
    resultIds.push(resultId);
    resultQueryIds.push(queryId);
    resultBuildCandidateIds.push(buildCandidateId);
    resultRanks.push(entry.persisted_rank);
    resultExplanations.push(entry.explanation);

    persistedRanks.push(entry.persisted_rank);
    buildCandidateIds.push(buildCandidateId);
    recommendationResultIds.push(resultId);
  }

  // Ordering dependency preserved exactly as before: candidates first, then
  // their components, then the results that reference the candidates.
  await client.query(INSERT_BUILD_CANDIDATE, [
    candidateIds,
    candidateQueryIds,
    candidateTotalPrices,
    candidateScores,
    candidateStatuses,
  ]);

  await client.query(INSERT_BUILD_COMPONENT, [
    componentIds,
    componentBuildCandidateIds,
    componentProductIds,
    componentProductVariantIds,
    componentRoles,
    componentSelectedPrices,
    componentCurrencies,
    componentStoreIds,
    componentPriceCheckedAts,
    componentOfferClasses,
    componentStoreOfferIds,
  ]);

  await client.query(INSERT_RECOMMENDATION_RESULT, [
    resultIds,
    resultQueryIds,
    resultBuildCandidateIds,
    resultRanks,
    resultExplanations,
  ]);

  return Object.freeze({
    query_id: queryId,
    persisted_ranks: Object.freeze(persistedRanks),
    build_candidate_ids: Object.freeze(buildCandidateIds),
    recommendation_result_ids: Object.freeze(recommendationResultIds),
  });
}

module.exports = { persistRanked };
