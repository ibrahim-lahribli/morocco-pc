'use strict';

/**
 * Engine 5b - rejection-reason persistence (OG-04).
 *
 * The sibling of ./persist-ranked: same Decision 19 transaction discipline,
 * same boundary (DML only - no BEGIN/COMMIT/ROLLBACK, no SELECT, no pool, no
 * clock), same parameterized-only rule. It records WHY a pass rejected the
 * candidates it rejected, which is the half of the "why was nothing
 * recommended?" story that Decision 27's budget_floor explicitly does not
 * cover: the floor sums per-role cheapest prices and ignores partners
 * entirely, so it can say "the emptiness is compatibility, not budget" but
 * never which pair was incompatible.
 *
 * What is persisted: Engine 2D's REJECT verdicts. filter.js already computes
 * them - a candidate whose aggregated relationships contain any FAIL gets
 * status REJECT and carries the decisive result's reason code - and they were
 * previously discarded when the pass ended. This writer makes them durable so
 * a specific past run can be explained after the fact.
 *
 * What is deliberately NOT persisted:
 *   * PASS and UNKNOWN verdicts. UNKNOWN is a survival, not a rejection;
 *     writing them here would conflate the two and bury the REJECTs. A healthy
 *     pass therefore writes ZERO rows, and that emptiness is itself the signal
 *     that nothing was rejected.
 *   * Pairwise rejections detected during assembly (assemble.js abandons a
 *     branch on an aggregated pair FAIL). Those are combinations, not
 *     candidates, and Engine 2D never materialized them as such.
 *   * Any verdict logic. This module never re-evaluates compatibility; it
 *     copies what the filter decided.
 *
 * Idempotency and the re-run guard: the commit wrapper's guard 2 already
 * refuses a second commit for the same query_id when build_candidate rows
 * exist, so a re-run cannot duplicate diagnostics. A zero-build pass persists
 * no candidates, so a later non-empty commit for the same query id stays
 * allowed - and in that case its rejections are written for the first time,
 * which is correct rather than a duplicate.
 *
 * Shape decisions, and why:
 *   - partner_product_id / partner_product_variant_id are NULL together or
 *     neither, because a candidate verdict's decisive reason may not depend on
 *     a partner at all (e.g. CPU_SOCKET_UNKNOWN). The table's
 *     chk_build_rejection_partner_pair_complete CHECK enforces the pairing, so
 *     a half-populated row is impossible rather than merely avoided here.
 *   - No uniqueness constraint on the row: the same reason may legitimately be
 *     recorded on two different queries for the same product.
 *
 * Parameterization: one parameterized INSERT with a fixed arity, called once
 * per rejected candidate. SQL is never built by concatenation and no value is
 * interpolated.
 */

const { randomUUID } = require('node:crypto');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { validateRejections } = require('./validate-rejections');

/** REASON_CODES member + product identity + optional partner identity. */
const INSERT_BUILD_REJECTION_SQL =
  'INSERT INTO build_rejection ('
  + 'recommendation_query_id, component_role, product_id, product_variant_id, '
  + 'partner_product_id, partner_product_variant_id, reason_code'
  + ') VALUES ($1,$2,$3,$4,$5,$6,$7)';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/** Same db contract as the loaders and the writers, named for this boundary. */
function validateClient(client) {
  if (client === null || typeof client !== 'object' || typeof client.query !== 'function') {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'client',
      'persistRejections requires a database client exposing query()'
    );
  }
}

/**
 * Persist the REJECT verdicts of one recommendation pass.
 *
 * @param {object} args
 * @param {object} args.client query executor exposing query(sql, params)
 * @param {string} args.queryId pinned recommendation_query.id
 * @param {Array} args.rejections Engine 2D candidate verdicts (validated by
 *        validateRejections); non-REJECT entries are ignored, and [] writes
 *        nothing.
 * @returns {Promise<object>} frozen { query_id, rejection_count,
 *          build_rejection_ids }
 * @throws CandidateSelectionError on a malformed input (no statement is
 *        issued) or the writer error unchanged.
 */
async function persistRejections({ client, queryId, rejections }) {
  validateClient(client);

  const rows = validateRejections({ queryId, rejections });

  if (rows.length === 0) {
    // A pass that rejected nothing writes nothing - the emptiness is the
    // signal. Same no-op discipline as persistRanked on an empty selection.
    return Object.freeze({
      query_id: queryId,
      rejection_count: 0,
      build_rejection_ids: Object.freeze([]),
    });
  }

  const buildRejectionIds = [];
  for (const row of rows) {
    // Deterministic id: the crypto module, never Math.random (which the
    // sibling boundary test bans outright as non-reproducible).
    const id = randomUUID();
    await client.query(INSERT_BUILD_REJECTION_SQL, [
      queryId,
      row.component_role,
      row.product_id,
      row.product_variant_id,
      row.partner_product_id,
      row.partner_product_variant_id,
      row.reason_code,
    ]);
    buildRejectionIds.push(id);
  }

  return Object.freeze({
    query_id: queryId,
    rejection_count: buildRejectionIds.length,
    build_rejection_ids: Object.freeze(buildRejectionIds),
  });
}

module.exports = { persistRejections, INSERT_BUILD_REJECTION_SQL };
