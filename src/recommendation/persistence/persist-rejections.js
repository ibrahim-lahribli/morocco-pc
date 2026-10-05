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
 * Idempotency and the re-run guard — READ THIS BEFORE RELYING ON IT. The
 * commit wrapper's guard 2 refuses a second commit for the same query_id ONLY
 * when `build_candidate` rows exist (Decision 19.2; the guard SQL never
 * mentions build_rejection). That is enough for any pass which produced
 * builds, but NOT for a ZERO-BUILD pass that still rejected candidates:
 * such a pass writes build_rejection rows and no build_candidate rows, so
 * guard 2 still passes and a second commit writes the SAME rejections again.
 * Measured on the live branch 2026-10-04: two consecutive zero-build commits
 * with the same rejections took build_rejection from 1 row to 2. A later
 * NON-empty commit duplicates them too, alongside the builds. The earlier
 * claim in this header — that a re-run "cannot duplicate diagnostics" — was
 * WRONG; it is registered as **OG-33** rather than fixed here, because closing
 * it means widening a Decision 19 guard (or making the insert idempotent),
 * which is a decision, not a writer tweak.
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

/**
 * REASON_CODES member + product identity + optional partner identity.
 *
 * The id is the FIRST parameter and is passed explicitly, exactly as
 * persist-ranked does for build_candidate / recommendation_result. It must
 * NOT be left to the column DEFAULT: this writer returns the ids it inserted,
 * so an id the server chooses instead would make every value in
 * build_rejection_ids a reference to a row that does not exist (measured
 * before this was fixed: the returned UUID and the stored `id` were two
 * different values for the same row). Decision 19.4 - UUIDs are generated in
 * JS via crypto.randomUUID().
 */
const INSERT_BUILD_REJECTION_SQL =
  'INSERT INTO build_rejection ('
  + 'id, recommendation_query_id, component_role, product_id, product_variant_id, '
  + 'partner_product_id, partner_product_variant_id, reason_code'
  + ') VALUES ($1,$2,$3,$4,$5,$6,$7,$8)';

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
      id,
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
