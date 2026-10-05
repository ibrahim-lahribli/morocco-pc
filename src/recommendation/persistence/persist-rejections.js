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
 * Idempotency — replace semantics (Decision 31, OG-33): every call REPLACES
 * the query's rejection set. It issues one scoped
 * `DELETE FROM build_rejection WHERE recommendation_query_id = $1` first, then
 * one INSERT per REJECT verdict, all inside the commit wrapper's transaction.
 * Committing the same pass twice therefore converges to the same rows instead
 * of duplicating them, and a later pass whose verdicts differ REPLACES the old
 * set rather than leaving stale diagnostics behind.
 *
 * Why the writer owns this and not the guard: the commit wrapper's guard 2
 * (Decision 19.2) keys on `build_candidate` ONLY, so a ZERO-BUILD pass that
 * still rejected candidates writes build_rejection rows and no build_candidate
 * rows - guard 2 passes and a second commit for the same query_id is reachable
 * (measured on the live branch 2026-10-04: consecutive zero-build commits took
 * the row count 1 -> 2). Decision 31 chose replace-at-the-writer because
 * widening guard 2 would refuse the legitimate zero-build -> later non-empty
 * sequence that commit.js deliberately keeps open (Decision 19.3), and a
 * unique-index ON CONFLICT alternative needs a migration AND cannot fire while
 * partner ids are NULL (OG-32): Postgres treats NULLs as distinct in a unique
 * index, so the key would never collide on the exact rows that duplicate.
 *
 * Scope and safety: the DELETE is parameterized on THIS query's id only (no
 * other query's rows are ever touched), it runs after validation (a malformed
 * input still issues zero statements), and it shares the wrapper's transaction,
 * serialized by guard 1's row lock - a failure between DELETE and COMMIT rolls
 * both back together.
 *
 * Shape decisions, and why:
 *   - partner_product_id / partner_product_variant_id follow the Decision 32
 *     / migration 015 rule: (NULL, NULL) means the decisive reason depended on
 *     no partner (e.g. CPU_SOCKET_UNKNOWN); (id, NULL) is a PRODUCT-KEYED
 *     partner (a CASE, PSU or MOTHERBOARD carries no variant - the normal case
 *     for GPU_TOO_THICK); (id, variant) is a VARIANT-KEYED partner. Only an
 *     orphan variant (NULL, id) is refused. The table's
 *     chk_build_rejection_partner_variant_requires_product CHECK enforces the
 *     pairing, so a half-populated row is impossible rather than merely
 *     avoided here.
 *   - Still no uniqueness constraint on the row (unchanged from Decision 29):
 *     idempotency is the DELETE-then-INSERT shape above, not a key. That keeps
 *     the schema untouched (no migration) and sidesteps the NULL-distinct
 *     problem an ON CONFLICT key would inherit from the (id, NULL)
 *     product-keyed rows (OG-32).
 *
 * Parameterization: one parameterized DELETE (scoped to this query) plus one
 * parameterized INSERT with a fixed arity, called once per rejected candidate.
 * SQL is never built by concatenation and no value is interpolated.
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

/**
 * Decision 31 replace step: clear THIS query's rejection rows before
 * re-inserting the current pass's set. Parameterized on the query id alone -
 * it can never touch another query's diagnostics, and it must run inside the
 * wrapper's transaction (this module issues no transaction control of its own).
 */
const DELETE_BUILD_REJECTION_SQL =
  'DELETE FROM build_rejection WHERE recommendation_query_id = $1';

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
 *        validateRejections); non-REJECT entries are ignored. Must be an array
 *        ([] means "this pass rejected nothing" and clears any stale rows).
 * @returns {Promise<object>} frozen { query_id, rejection_count,
 *          build_rejection_ids }. rejection_count is the size of THIS pass's
 *          set - after a re-commit it equals the stored row count for the
 *          query, never a multiple of it (Decision 31).
 * @throws CandidateSelectionError on a malformed input (no statement is
 *        issued - validation precedes the DELETE) or the writer error
 *        unchanged (the wrapper's ROLLBACK undoes the DELETE too).
 */
async function persistRejections({ client, queryId, rejections }) {
  validateClient(client);

  const rows = validateRejections({ queryId, rejections });

  // Decision 31 (OG-33): replace, don't append. Validation already passed, so
  // a malformed input never reaches this statement. Scoped to this query id;
  // idempotent by construction - re-committing the same pass converges to the
  // same rows instead of duplicating them, and a changed pass leaves no stale
  // diagnostics behind.
  await client.query(DELETE_BUILD_REJECTION_SQL, [queryId]);

  if (rows.length === 0) {
    // A pass that rejected nothing writes no rows - but the DELETE above has
    // already made the table agree with that verdict (it clears anything an
    // earlier commit for this query recorded). The emptiness is the signal.
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

module.exports = { persistRejections, INSERT_BUILD_REJECTION_SQL, DELETE_BUILD_REJECTION_SQL };
