'use strict';

/**
 * Decision 55 item 4 - the swap PREVIEW composition (read-only).
 *
 * Boundary: composes the SAME loaders and pure stages one recommendation pass
 * uses, in the same order, to answer ONE hypothetical question - "what happens
 * to this persisted build if `role` were this product?" - and owns no engine
 * logic of its own: the compatibility verdict is
 * `assembly.evaluateBuildReplacement`, the price is `assembly.lookupPrice`, the
 * eligibility rules are Stage 1's, and the pairwise graph is Engine 2D's.
 *
 *   queryId
 *     |  loadQueryInput(queryId, db)                    Decision 10 / 17.1
 *     v
 *   { query_id, input, ... }
 *     |  loadCandidates(input, db)                      Engine 2B
 *     |  selectCandidatePool(input, candidates)         Engine 2C
 *     v
 *   { input, pool }
 *     |  selectOfferPrices(poolResult, db, options)     Engine 2 Stage 1
 *     v
 *   { input, pool, prices }   <- the price carrier a preview needs
 *     |  loadFilteringContext(offerResult, db)          Engine 2D B2-B
 *     |  filterCandidates(context)                      Engine 2D B2-D
 *     v
 *   filterResult { results: [PASS|UNKNOWN|REJECT verdict, ...] }
 *     |  build `picked` from the verdicts (see below)   Decision 55
 *     |  evaluateBuildReplacement({ picked, ... })      Engine 3 export
 *     |  lookupPrice(offerResult.prices, candidate)     Engine 3 Step 2
 *     v
 *   frozen { evaluable, blocked_role, compatibility, price }
 *
 * WHY THE FULL POOL, NOT A NARROWED ONE. The tempting cheaper version - load
 * only `role` and its partners - would be a SECOND pool path, free to diverge
 * from the pass's (different cap, different variant identity, different
 * freshness waiver) while looking correct on a fixture. Decision 55 item 4 says
 * "the same filtering and offer-selection path a pass uses", so this module
 * takes it. The cost is that a preview pays roughly a pass's read half; the API
 * therefore gives the route POST's rate limit, not GET's (see
 * apps/api/src/routes/recommendations.js).
 *
 * WHY THE SCORING MODEL IS NOT LOADED. A pass loads it (Decision 11) because
 * retention, scoring and Engine 3 all read its configuration. A preview runs
 * none of those: Engine 2B/2C, Stage 1, Engine 2D and `lookupPrice` take no
 * configuration at all. Loading it here would add a statement AND a failure mode
 * - a preview of a perfectly reconstructable build would 503 once the pinned
 * model row was deleted - for a value nothing downstream reads.
 *
 * WHY `picked` IS REBUILT FROM THE LIVE VERDICTS, NEVER FROM THE ROWS. The
 * persisted `build_component` rows are identities; `evaluateBuildReplacement`
 * needs Engine 2D VERDICTS (product, variant, category, role, status,
 * relationships, unknown_pairwise_count). Fabricating a verdict from a row
 * would invent a status, and would judge the hypothetical swap against
 * relationships nobody evaluated. So the persisted build supplies WHICH product
 * is in each role, and the live filter supplies the verdict.
 *
 * A persisted pick with no live verdict - the product was retired, or it is no
 * longer a candidate for its role - makes the build NOT EVALUABLE rather than
 * silently absent. The same holds for a persisted pick whose live verdict is
 * REJECT: `evaluateBuildReplacement` refuses a rejected build member (by
 * design), and a preview cannot honestly report a build the live catalog would
 * no longer assemble. `blocked_role` names the first such role in
 * EXPANSION_ORDER, which is what the route's 404 message reports.
 *
 * Determinism: no clock reads beyond the loaders' own transaction timestamp, no
 * randomness, no I/O beyond the injected client, no mutation of any input.
 * Nothing is persisted: no INSERT, UPDATE or DELETE, and no
 * `recommendation_query` row (Decision 55 item 6 - an unmarked row would block
 * the golden harness's preflight).
 */

// --- collaborators (called through their namespace objects - see run.js) -----

const query = require('../query');
const candidates = require('../candidates');
const offers = require('../offers');
const filtering = require('../filtering');
const assembly = require('../assembly');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** The exact Decision 17.5 transaction open statement, as in ./snapshot. */
const BEGIN_SQL = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';

/** The single end-of-transaction statement this wrapper ever issues. */
const ROLLBACK_SQL = 'ROLLBACK';

/**
 * The three eligibility reasons a preview can answer with when there is no
 * candidate to evaluate. They are deliberately distinguishable, because the
 * caller's next action differs for each:
 *
 *   PRODUCT_NOT_CANDIDATE  the product is not in the Engine 2C pool at all -
 *                          unknown id, inactive, or the wrong category for the
 *                          role. The request names something that is not a
 *                          candidate.
 *   NO_ELIGIBLE_OFFER      it IS a candidate, but Stage 1 dropped it (no offer
 *                          in this currency, out of stock, or outside the
 *                          freshness window with no seed waiver). The product
 *                          is fine; its price is not.
 *   (a REJECT verdict's own reason)  it is a candidate with a price, but Engine
 *                          2D rejects it - the swap is incompatible, and the
 *                          `reason` is the filtering stage's own code.
 *
 * The first two are synthesized here; the third travels from the verdict
 * unchanged, which is why a caller can tell "incompatible" from "not for sale"
 * by the check name it arrived under.
 */
const ELIGIBILITY_CHECK = 'eligibility';
const NO_ELIGIBLE_OFFER = 'NO_ELIGIBLE_OFFER';
const PRODUCT_NOT_CANDIDATE = 'PRODUCT_NOT_CANDIDATE';
/** A REJECT verdict that recorded no reason code. It IS incompatible; the
 *  SPECIFIC rule is what is unknown, so the generic code is the honest one and
 *  the eligibility reason stays distinguishable from "not a candidate". */
const INCOMPATIBLE = 'INCOMPATIBLE';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The eligibility pair: one FAIL entry in the SAME `{ check, role,
 * partner_role, status, reason, evidence }` shape a real pairwise pair uses, so
 * a client has ONE vocabulary to render and no second top-level field to learn.
 *
 * `check` is NOT a `PAIRWISE_CHECKS` key - it is the pseudo-relationship
 * "this candidate cannot be built with at all" - and `partner_role` is null
 * because there is no partner: the candidate failed on its own eligibility (or
 * on its own relationships, which `reason` names). `evidence` is empty: an
 * eligibility outcome is a fact of Stage 1 / Engine 2D, not a rule table row.
 */
function eligibilityPair(role, reason, evidence) {
  return Object.freeze({
    check: ELIGIBILITY_CHECK,
    role,
    partner_role: null,
    status: 'FAIL',
    reason,
    evidence: Object.freeze(evidence === undefined ? [] : evidence),
  });
}

/** The identity key a persisted component and a live verdict share. */
function identityKey(role, productId, productVariantId) {
  return JSON.stringify([role, productId, productVariantId === undefined ? null : productVariantId]);
}

/**
 * The verdict for one (role, product, variant), or null.
 *
 * `filterCandidates` emits at most one verdict per candidate and the pool has
 * one entry per (product, variant, role), so a hit is unambiguous.
 */
function findVerdict(verdicts, role, productId, productVariantId) {
  const wanted = identityKey(role, productId, productVariantId);
  return verdicts.get(wanted) || null;
}

/** Does the Engine 2C (pre-price) pool hold this identity? */
function isInCandidatePool(pool, role, productId, productVariantId) {
  for (const candidate of pool) {
    if (
      candidate.component_role === role &&
      candidate.product_id === productId &&
      (candidate.product_variant_id === undefined ? null : candidate.product_variant_id) ===
        (productVariantId === undefined ? null : productVariantId)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The not-evaluable answer: a frozen envelope with `compatibility` and `price`
 * both null, so a caller must handle the blocked case before reading either.
 */
function blockedAnswer(blockedRole) {
  return Object.freeze({
    evaluable: false,
    blocked_role: blockedRole,
    compatibility: null,
    price: null,
  });
}

/**
 * The no-candidate answer: an eligibility FAIL with a null price.
 *
 * `next` and `offer_class` are BOTH null, never 0 and never a guessed class: an
 * ineligible candidate has no price, and a preview that priced one would be
 * exactly the silent substitution Decision 55 item 4 forbids.
 */
function ineligibleAnswer(role, reason, evidence) {
  return Object.freeze({
    evaluable: true,
    blocked_role: null,
    compatibility: Object.freeze({
      status: 'FAIL',
      pairs: Object.freeze([eligibilityPair(role, reason, evidence)]),
      unknown_pairwise_count: 0,
    }),
    price: Object.freeze({ next: null, offer_class: null }),
  });
}

/**
 * Validate this boundary's own argument object. The loaders keep their own
 * contracts: a bad query id still raises the query loader's own code.
 */
function validateArgs(args) {
  if (!isPlainObject(args)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      null,
      'evaluateSwapPreview requires an object carrying "db", "queryId", "role" and "buildComponents"'
    );
  }
  if (!assembly.EXPANSION_ORDER.includes(args.role)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'role',
      `"role" must be one of ${assembly.EXPANSION_ORDER.join(', ')}`
    );
  }
  if (!Array.isArray(args.buildComponents)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'buildComponents',
      '"buildComponents" must be the persisted build\'s component identities'
    );
  }
  for (const component of args.buildComponents) {
    if (!isPlainObject(component) || typeof component.role !== 'string') {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'buildComponents',
        'every persisted component must carry a "role"'
      );
    }
  }
}

/**
 * Evaluate ONE hypothetical swap against a persisted build over the injected
 * client. Issues NO transaction control: `evaluateSwapPreviewSnapshot` owns the
 * BEGIN and the ROLLBACK (Decision 17.5's division, unchanged).
 *
 * @param {object} args { db, queryId, role, productId, productVariantId?,
 *        buildComponents }
 * @param {object} args.db pg-compatible client exposing db.query(sql, params)
 * @param {string} args.queryId pinned recommendation_query.id
 * @param {string} args.role the EXPANSION_ORDER role being replaced or supplied
 * @param {string} args.productId the candidate product to substitute
 * @param {string|null} [args.productVariantId] its variant, mandatory for GPU
 * @param {Array<{role: string, product_id: string,
 *        product_variant_id: string|null}>} args.buildComponents the persisted
 *        build's component identities, in any order
 * @param {object} [args.options] Decision 35 engine options, forwarded to Stage
 *        1 unchanged; the API always sets `allow_unverified_seed_offers: true`
 * @returns {Promise<object>} frozen { evaluable, blocked_role, compatibility,
 *          price } (see the header)
 */
/**
 * The ONE composition CD-8 is built on: the loaders and pure stages a pass
 * runs, then the pick rebuild and the candidate resolution.
 *
 * A PREVIEW stops at the envelope `evaluateSwapPreview` builds below; a COMMIT
 * (`./swap-commit`, Decision 56) needs the same answers PLUS the material it
 * will write - the frozen `picked` map, the Stage 1 carrier, the filtering
 * context, the query input and the candidate's carrier entry. Splitting the
 * composition here rather than letting the commit re-run it is what stops a
 * commit from re-deriving eligibility over a different pool, or judging a swap
 * the reader never saw (Decision 56 item 8).
 *
 * Issues NO transaction control: each wrapper owns its own BEGIN, and the
 * preview's is always a ROLLBACK (Decision 17.5).
 *
 * @param {object} args the evaluateSwapPreview argument object
 * @returns {Promise<object>} frozen { evaluable, blocked_role, role, ineligible,
 *          compatibility, price, query, offerResult, filteringContext, picked,
 *          candidate }; the last five are null unless the swap is evaluable AND
 *          eligible.
 */
async function composeSwap(args) {
  validateArgs(args);
  const db = args.db;
  const requestedRole = args.role;
  const requestedVariant = args.productVariantId === undefined ? null : args.productVariantId;

  // 1. Query loader (Decision 10 / 17.1).
  const queryInput = await query.loadQueryInput(args.queryId, db);

  // 2./3. Engine 2B load, then Engine 2C pool selection over that exact output.
  const loaded = await candidates.loadCandidates(queryInput.input, db);
  const poolResult = candidates.selectCandidatePool(loaded.input, loaded.candidates);

  // 4. Stage 1: cheapest eligible offer per candidate + the price carrier. Its
  //    pool is a strict subset of the 2C pool; the carrier covers exactly it.
  const offerResult = await offers.selectOfferPrices(poolResult, db, args.options);

  // 5./6. Engine 2D: one context, one pure filter - the same pair of calls, over
  //    the same objects, that a pass makes.
  const filteringContext = await filtering.loadFilteringContext(offerResult, db);
  const filterResult = filtering.filterCandidates(filteringContext);

  // 7. Index the live verdicts by identity.
  const verdicts = new Map();
  for (const verdict of filterResult.results) {
    verdicts.set(
      identityKey(verdict.component_role, verdict.product_id, verdict.product_variant_id),
      verdict
    );
  }

  // 8. Rebuild `picked` from the persisted identities + the live verdicts. The
  //    replaced role is deliberately EXCLUDED: substituting it is what
  //    evaluateBuildReplacement does, and including it would make the build's
  //    own (possibly now-rejected) pick the thing being compared.
  const persistedRoles = new Map();
  for (const component of args.buildComponents) {
    persistedRoles.set(component.role, component);
  }

  const picked = {};
  for (const role of assembly.EXPANSION_ORDER) {
    if (role === requestedRole) {
      continue;
    }
    const persisted = persistedRoles.get(role);
    if (persisted === undefined) {
      continue;
    }
    const verdict = findVerdict(verdicts, role, persisted.product_id, persisted.product_variant_id);
    if (verdict === null || verdict.status === 'REJECT') {
      return composeBlocked(role);
    }
    picked[role] = verdict;
  }
  const frozenPicked = Object.freeze(picked);

  // 9. Resolve the requested candidate through the SAME three gates a pass
  //    applies: 2C pool membership, Stage 1 eligibility, Engine 2D verdict.
  const candidate = findVerdict(verdicts, requestedRole, args.productId, requestedVariant);
  if (candidate === null) {
    if (isInCandidatePool(poolResult.pool, requestedRole, args.productId, requestedVariant)) {
      return composeIneligible(requestedRole, NO_ELIGIBLE_OFFER, undefined);
    }
    // A GPU's identity is (product, variant); a variant-less probe is not a
    // claim about any candidate, so it is the same answer as an unknown one.
    return composeIneligible(requestedRole, PRODUCT_NOT_CANDIDATE, undefined);
  }
  if (candidate.status === 'REJECT') {
    return composeIneligible(
      requestedRole,
      candidate.reason === null ? INCOMPATIBLE : candidate.reason,
      undefined
    );
  }

  // 10. The engine's verdict - the ONE pure export that owns it.
  const replacement = assembly.evaluateBuildReplacement({
    picked: frozenPicked,
    filteringContext,
    role: requestedRole,
    candidate,
  });

  // 11. The price of the substituted candidate, from the carrier Stage 1 built
  //     for this request. Same source as the pass, so the preview's number and
  //     a rebuild's number cannot disagree about which offer is cheapest.
  const price = assembly.lookupPrice(offerResult.prices, candidate);

  return Object.freeze({
    evaluable: true,
    blocked_role: null,
    role: requestedRole,
    ineligible: null,
    compatibility: Object.freeze({
      status: replacement.status,
      pairs: replacement.pairs,
      unknown_pairwise_count: replacement.unknown_pairwise_count,
    }),
    price: Object.freeze({
      next: price.selected_price,
      offer_class: price.offer_class,
      // The WHOLE carrier entry travels for the commit's `build_component` row
      // (Decision 35's provenance snapshot: selected_price, currency, store_id,
      // price_checked_at, offer_class, store_offer_id). A preview ignores it.
      entry: Object.freeze(Object.assign({}, price)),
    }),
    query: queryInput,
    offerResult,
    filteringContext,
    picked: frozenPicked,
    candidate,
  });
}

/** `composeSwap`'s not-evaluable shape: every later field is null. */
function composeBlocked(blockedRole) {
  return Object.freeze({
    evaluable: false,
    blocked_role: blockedRole,
    role: null,
    ineligible: null,
    compatibility: null,
    price: null,
    query: null,
    offerResult: null,
    filteringContext: null,
    picked: null,
    candidate: null,
  });
}

/** `composeSwap`'s ineligible shape: a reason and no price. */
function composeIneligible(role, reason, evidence) {
  return Object.freeze({
    evaluable: true,
    blocked_role: null,
    role,
    ineligible: Object.freeze({
      reason,
      evidence: Object.freeze(evidence === undefined ? [] : evidence),
    }),
    compatibility: null,
    price: null,
    query: null,
    offerResult: null,
    filteringContext: null,
    picked: null,
    candidate: null,
  });
}

/**
 * Evaluate ONE hypothetical swap against a persisted build over the injected
 * client. Issues NO transaction control: `evaluateSwapPreviewSnapshot` owns the
 * BEGIN and the ROLLBACK (Decision 17.5's division, unchanged).
 *
 * The returned envelope is the wire contract's input and is UNCHANGED by the
 * Decision 56 split: the commit material `composeSwap` carries stops here.
 *
 * @param {object} args { db, queryId, role, productId, productVariantId?,
 *        buildComponents }
 * @param {object} args.db pg-compatible client exposing db.query(sql, params)
 * @param {string} args.queryId pinned recommendation_query.id
 * @param {string} args.role the EXPANSION_ORDER role being replaced or supplied
 * @param {string} args.productId the candidate product to substitute
 * @param {string|null} [args.productVariantId] its variant, mandatory for GPU
 * @param {Array<{role: string, product_id: string,
 *        product_variant_id: string|null}>} args.buildComponents the persisted
 *        build's component identities, in any order
 * @param {object} [args.options] Decision 35 engine options, forwarded to Stage
 *        1 unchanged; the API always sets `allow_unverified_seed_offers: true`
 * @returns {Promise<object>} frozen { evaluable, blocked_role, compatibility,
 *          price } (see the header)
 */
async function evaluateSwapPreview(args) {
  const composed = await composeSwap(args);
  if (composed.evaluable !== true) {
    return blockedAnswer(composed.blocked_role);
  }
  if (composed.ineligible !== null) {
    return ineligibleAnswer(
      composed.role,
      composed.ineligible.reason,
      composed.ineligible.evidence
    );
  }
  return Object.freeze({
    evaluable: true,
    blocked_role: null,
    compatibility: composed.compatibility,
    price: Object.freeze({ next: composed.price.next, offer_class: composed.price.offer_class }),
  });
}

/**
 * Same client contract as the other orchestrator entry points.
 */
function validateClient(client) {
  if (client === null || typeof client !== 'object' || typeof client.query !== 'function') {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'client',
      'evaluateSwapPreviewSnapshot requires a database client exposing query()'
    );
  }
}

/**
 * Run one swap preview inside the Decision 17.5 snapshot transaction: the SAME
 * `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` a pass opens, and ALWAYS a
 * ROLLBACK - there is nothing to commit, and a failed statement leaves the
 * connection in an aborted transaction state that only ROLLBACK clears.
 *
 * `client` MUST be a single dedicated connection (BEGIN and ROLLBACK are
 * session-scoped); with a pg Pool, check one out first and release it
 * afterwards.
 *
 * @param {object} client pg-compatible SINGLE dedicated connection
 * @param {object} args the evaluateSwapPreview argument object
 * @returns {Promise<object>} the frozen preview envelope
 * @throws the preview error unchanged (after ROLLBACK), or the ROLLBACK error
 *         on an otherwise successful preview; INVALID_INPUT client when the
 *         client contract fails (no statement is issued).
 */
async function evaluateSwapPreviewSnapshot(client, args) {
  validateClient(client);

  // Outside the try: if BEGIN itself fails there is no transaction to end.
  await client.query(BEGIN_SQL);

  let failure = null;
  try {
    return await evaluateSwapPreview(Object.assign({}, args, { db: client }));
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await client.query(ROLLBACK_SQL);
    } catch (rollbackError) {
      if (failure === null) {
        throw rollbackError;
      }
      // The preview error is already propagating: never mask it.
    }
  }
}

module.exports = {
  // Decision 56: the ONE composition, shared with ./swap-commit so a commit
  // cannot re-derive eligibility over a different pool.
  composeSwap,
  evaluateSwapPreview,
  evaluateSwapPreviewSnapshot,
  BEGIN_SQL,
  ROLLBACK_SQL,
  ELIGIBILITY_CHECK,
  NO_ELIGIBLE_OFFER,
  PRODUCT_NOT_CANDIDATE,
  INCOMPATIBLE,
};
