'use strict';

/**
 * Decision 56 - committing ONE swap: an APPENDED derived build.
 *
 * Boundary: the WRITE half of CD-8. It asks the SAME questions the preview asks
 * (`./swap-preview`'s `composeSwap`: query loader -> 2B -> 2C -> Stage 1 -> 2D,
 * then the pick rebuild), then writes what the reader accepted:
 *
 *   build_candidate           the derived build: total_price, score,
 *                             compatibility_status
 *   build_component           one row per role - the source build's own rows
 *                             copied, the swapped role's replaced by the
 *                             candidate and its Stage 1 carrier price
 *   recommendation_swap       the link to the result it was derived from
 *
 *   -> ONE transaction (the wrapper below owns BEGIN/COMMIT/ROLLBACK)
 *
 * WHAT IT NEVER DOES. No UPDATE and no DELETE on any table (Decision 56 item 1):
 * the pass stays a record - its rank, `strategy_key`, `engine_version`, the
 * Decision 47 dedupe key, the `recommendation_preset` pointers and the golden
 * harness's fingerprints all describe the assembly that produced it. The
 * derived build is reachable ONLY through `recommendation_swap`; it holds no
 * `recommendation_result` row, so it cannot become a rank, a preset target or a
 * dedupe match.
 *
 * ONE COMPOSITION, NOT TWO (Decision 56 item 8). Eligibility, offer selection
 * and the 2D verdicts come from `composeSwap`, the module the preview calls. A
 * commit that re-derived them would be free to judge a different pool - the
 * exact failure mode Decision 55 rejected when it chose the full pool over a
 * narrowed one.
 *
 * THE TWO VERDICTS, AND WHY BOTH EXIST. The preview answers the ROLE-SCOPED
 * verdict (the checks naming the replaced role); a build's status is the
 * aggregate over ALL its pairs. So the commit evaluates the substituted build
 * with `assembly.evaluateBuild` and PERSISTS that status - a status computed
 * from a fraction of the build's relations would report PASS over an unreported
 * FAIL elsewhere, and `build_candidate.compatibility_status` is read by every
 * later reader of the build. Both verdicts come from the same
 * `PAIRWISE_CHECKS` table.
 *
 * WHAT THE SCORE IS, AND WHY IT MUST MOVE. `score` is Engine 4's
 * `computeBuildScore` under the pass's OWN pinned model
 * (`recommendation_query.scoring_model_id`) and the derived build's own UNKNOWN
 * count. Copying the source build's score would leave a stored number that
 * describes parts that are no longer in the build.
 *
 * WHAT THE ARITHMETIC IS. `total_price = persisted total - previous + next`
 * with the priced carrier entry of each role - the SAME arithmetic
 * `presentSwapPreview` performs, so the number the reader approved and the
 * number persisted cannot disagree. The other roles keep their PERSISTED prices
 * (a swap must not silently reprice the whole build at today's offers).
 *
 * REFUSALS (all of them are RESULTS, returned rather than thrown, because the
 * route maps each to its own status):
 *   NOT_EVALUABLE    a persisted pick has no live verdict (retired product,
 *                    expired offer) - the preview's `blocked_role` says which.
 *   INELIGIBLE       the candidate is not in the pool / has no eligible offer /
 *                    is REJECTed by Engine 2D.
 *   NOT_COMMITTABLE  the engine's verdict is FAIL. Nothing is written.
 *   ROLE_ABSENT      the role is not in the persisted build (the GPU-less build
 *                    being given a GPU). The preview reports an unknown total
 *                    there by design (Decision 55 item 3); a commit must
 *                    persist a KNOWN total, and "add a part" is a different
 *                    operation from "replace one" (Decision 56 item 5).
 *
 * Determinism: no randomness beyond `crypto.randomUUID()` for the row ids
 * (Decision 19.4), one clock read (the transaction timestamp, the same one a
 * pass uses for Engine 4), no I/O beyond the injected client, and no mutation
 * of any input.
 */

const { randomUUID } = require('node:crypto');

const assembly = require('../assembly');
const scoring = require('../scoring');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { composeSwap } = require('./swap-preview');
const { SELECT_NOW_SQL } = require('./run');

/** Decision 18-D9: plain BEGIN, exactly like the pass's write wrapper. */
const BEGIN_SQL = 'BEGIN';

/** COMMIT on the success path only. */
const COMMIT_SQL = 'COMMIT';

/** The single end-of-transaction statement every error path issues. */
const ROLLBACK_SQL = 'ROLLBACK';

/**
 * One `build_candidate` row. `compatibility_status` carries its enum cast
 * because `text` has no implicit assignment cast to an enum (the same reason
 * `persistence/persist-ranked.js` casts).
 */
const INSERT_BUILD_CANDIDATE_SQL =
  'INSERT INTO build_candidate (id, recommendation_query_id, total_price, score, compatibility_status)'
  + ' VALUES ($1, $2, $3, $4, $5::compatibility_status)'
  + ' RETURNING id';

/**
 * One `build_component` batch, in the UNNEST form the pass uses: one element
 * per ROW, one parameter per COLUMN, so the statement text is fixed and the
 * round trips are bounded by roles rather than by rows.
 */
const INSERT_BUILD_COMPONENT_SQL =
  'INSERT INTO build_component (id, build_candidate_id, product_id, product_variant_id, component_role, selected_price, currency, store_id, price_checked_at, offer_class, store_offer_id)'
  + ' SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::component_role[], $6::numeric[], $7::text[], $8::uuid[], $9::timestamptz[], $10::text[], $11::uuid[])';

/**
 * The one row that makes the derived build reachable. `created_at` is returned
 * so the caller can put the commit's own instant on the wire without a second
 * read.
 */
const INSERT_RECOMMENDATION_SWAP_SQL =
  'INSERT INTO recommendation_swap'
  + ' (source_result_id, build_candidate_id, component_role, replaced_product_id, replaced_product_variant_id, catalog_version, engine_version)'
  + ' VALUES ($1, $2, $3::component_role, $4, $5, $6, $7)'
  + ' RETURNING created_at';

/** The one committed swap of ONE result - the idempotency guard's read. */
const SELECT_COMMITTED_SWAP_SQL =
  'SELECT id, build_candidate_id, component_role, created_at'
  + ' FROM recommendation_swap WHERE source_result_id = $1';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateClient(client) {
  if (client === null || typeof client !== 'object' || typeof client.query !== 'function') {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'client',
      'commitSwapInTransaction requires a database client exposing query()'
    );
  }
}

/**
 * Two decimals, and never a float artefact: the money columns are NUMERIC, and
 * `0.1 + 0.2` must not reach the database as 0.30000000000000004.
 */
function toMoney(value) {
  return Math.round(value * 100) / 100;
}

/** The persisted component of `role`, or null. */
function findComponent(components, role) {
  for (const component of components) {
    if (component.role === role) {
      return component;
    }
  }
  return null;
}

/**
 * Read the transaction timestamp exactly as a pass does (`./run`'s SQL): one
 * statement, no transaction control, and the same clock Engine 4 sees.
 */
async function readNowMs(db) {
  const result = await db.query(SELECT_NOW_SQL);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  const value = rows.length === 0 ? null : new Date(rows[0].now).getTime();
  if (value === null || !Number.isFinite(value)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'now',
      'the transaction timestamp must be convertible via new Date(value).getTime()'
    );
  }
  return value;
}

/** A refusal: the caller maps `reason` to its own status code. */
function refusal(reason, fields) {
  return Object.freeze(Object.assign(
    {
      committed: false,
      reason,
      role: null,
      blocked_role: null,
      eligibility: null,
      compatibility: null,
      price: null,
      build: null,
      swap: null,
    },
    fields
  ));
}

/**
 * The carrier entry of one role's persisted row, in the shape
 * `build_component` writes (Decision 35's snapshot).
 */
function persistedCarrier(component) {
  return Object.freeze({
    selected_price: component.selected_price,
    currency: component.currency,
    store_id: component.store_id === undefined ? null : component.store_id,
    price_checked_at: component.price_checked_at === undefined
      ? null
      : component.price_checked_at,
    offer_class: component.offer_class,
    store_offer_id: component.store_offer_id === undefined ? null : component.store_offer_id,
  });
}

/**
 * Commit ONE swap over the injected client. Issues NO transaction control: the
 * caller owns BEGIN/COMMIT/ROLLBACK, exactly as `runRecommendation` does
 * (Decision 17.5 / 19.1). Use `commitSwapInTransaction` unless you are already
 * inside a write transaction.
 *
 * @param {object} args
 * @param {object} args.db pg-compatible client exposing db.query(sql, params)
 * @param {string} args.queryId the pass the build belongs to
 * @param {string} args.sourceResultId the `recommendation_result` row the build
 *        was read through - the swap's link, and the FK that proves the build
 *        exists (a wrong id fails loudly with 23503, never silently)
 * @param {string} args.role the EXPANSION_ORDER role being replaced
 * @param {string} args.productId the candidate product
 * @param {string|null} [args.productVariantId] its variant, mandatory for GPU
 * @param {Array} args.buildComponents the PERSISTED build's components, with
 *        prices (`role`, `product_id`, `product_variant_id`, `selected_price`,
 *        `currency`, `store_id`, `price_checked_at`, `offer_class`,
 *        `store_offer_id`)
 * @param {number} args.persistedTotalPrice the persisted build's
 *        `total_price` - the total the preview's arithmetic and this commit's
 *        must share, read from the row rather than re-summed here
 * @param {string|null} [args.catalogVersion] the live digest the verdict was
 *        judged against (nullable: a broken digest records UNKNOWN)
 * @param {string|null} [args.engineVersion] the deploy committing the swap
 * @param {object} [args.options] Decision 35 engine options, forwarded to
 *        Stage 1 unchanged
 * @returns {Promise<object>} frozen { committed, reason, role, blocked_role,
 *          eligibility, compatibility, price, build, swap }
 */
async function commitSwap(args) {
  if (!isPlainObject(args)) {
    fail(ERROR_CODES.INVALID_INPUT, null, 'commitSwap requires an argument object');
  }
  const db = args.db;
  if (db === null || typeof db !== 'object' || typeof db.query !== 'function') {
    fail(ERROR_CODES.INVALID_INPUT, 'db', 'commitSwap requires a database client exposing query()');
  }
  if (typeof args.sourceResultId !== 'string' || args.sourceResultId.length === 0) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'sourceResultId',
      'commitSwap requires the recommendation_result id the build was read through'
    );
  }

  // 1. The preview's own composition - eligibility, prices and verdicts included.
  const composed = await composeSwap({
    db,
    queryId: args.queryId,
    role: args.role,
    productId: args.productId,
    productVariantId: args.productVariantId,
    buildComponents: args.buildComponents,
    options: args.options,
  });

  if (composed.evaluable !== true) {
    return refusal('NOT_EVALUABLE', { role: args.role, blocked_role: composed.blocked_role });
  }
  if (composed.ineligible !== null) {
    return refusal('INELIGIBLE', {
      role: composed.role,
      eligibility: composed.ineligible,
    });
  }

  // 2. The role must be THERE. A swap replaces a part; adding one is a
  //    different operation with a different total (Decision 56 item 5).
  const replaced = findComponent(args.buildComponents, args.role);
  if (replaced === null) {
    return refusal('ROLE_ABSENT', {
      role: args.role,
      compatibility: composed.compatibility,
      price: composed.price,
    });
  }

  // 3. The WHOLE substituted build, over the same pairwise table the walk uses.
  const picked = Object.freeze(Object.assign({}, composed.picked, {
    [args.role]: composed.candidate,
  }));
  const verdict = assembly.evaluateBuild({
    picked,
    filteringContext: composed.filteringContext,
  });
  if (verdict.status === 'FAIL') {
    return refusal('NOT_COMMITTABLE', {
      role: args.role,
      compatibility: verdict,
      price: Object.freeze({
        next: composed.price.next,
        offer_class: composed.price.offer_class,
      }),
    });
  }

  // 4. The derived build's components, in assembly order: the source rows
  //    verbatim, with the swapped role's carrier entry.
  const components = [];
  for (const role of assembly.EXPANSION_ORDER) {
    // The swapped role is NOT in `picked` (composeSwap excludes it), so it is
    // the one role the map cannot confirm - its presence was proved above.
    if (role !== args.role && picked[role] === undefined) {
      continue;
    }
    const price = role === args.role ? composed.price.entry : persistedCarrier(
      findComponent(args.buildComponents, role)
    );
    components.push(Object.freeze({
      component_role: role,
      product_id: picked[role].product_id,
      product_variant_id: picked[role].product_variant_id === undefined
        ? null
        : picked[role].product_variant_id,
      price,
    }));
  }

  const previous = Number(replaced.selected_price);
  if (!Number.isFinite(previous) || !Number.isFinite(Number(composed.price.next))) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'buildComponents.selected_price',
      'the replaced component and its replacement must both carry a finite price'
    );
  }
  // A NUMBER, not a coercion: `Number(null)` is 0, and a build with no total
  // recorded (`total_price` is nullable) must never become a 0 total here.
  const persistedTotal = args.persistedTotalPrice;
  if (typeof persistedTotal !== 'number' || !Number.isFinite(persistedTotal)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'persistedTotalPrice',
      'the persisted build total must be a finite number (null means the row has no total, and a swap cannot price it)'
    );
  }
  const totalPrice = toMoney(persistedTotal - previous + Number(composed.price.next));
  if (!(totalPrice > 0)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'total_price',
      'the derived build total must be positive (build_candidate checks the same rule)'
    );
  }

  // 5. Engine 4, under the pass's OWN pinned model: a score that did not move
  //    with the parts would be a lie.
  const scoringModel = await scoring.loadScoringModel(composed.query.scoring_model_id, db);
  const assessmentResult = await scoring.loadComponentAssessments(
    uniqueProductIds(components),
    db
  );
  const nowMs = await readNowMs(db);
  const score = scoring.computeBuildScore({
    build: Object.freeze({
      components: Object.freeze(components.map((component) => Object.freeze({
        component_role: component.component_role,
        product_id: component.product_id,
        product_variant_id: component.product_variant_id,
      }))),
      total_price: totalPrice,
      currency: composed.query.input.currency,
      unknown_pairwise_count: verdict.unknown_pairwise_count,
    }),
    assessments: assessmentResult.assessments,
    configuration: scoringModel.configuration,
    nowMs,
    unknownPairwiseCount: verdict.unknown_pairwise_count,
  });

  // 6. The three INSERTs, in ONE statement each, in this transaction.
  const buildCandidateId = randomUUID();
  await db.query(INSERT_BUILD_CANDIDATE_SQL, [
    buildCandidateId,
    args.queryId,
    totalPrice,
    toMoney(score),
    verdict.status,
  ]);

  const componentIds = [];
  const componentBuildIds = [];
  const componentProductIds = [];
  const componentVariantIds = [];
  const componentRoles = [];
  const componentPrices = [];
  const componentCurrencies = [];
  const componentStoreIds = [];
  const componentCheckedAts = [];
  const componentOfferClasses = [];
  const componentOfferIds = [];
  for (const component of components) {
    componentIds.push(randomUUID());
    componentBuildIds.push(buildCandidateId);
    componentProductIds.push(component.product_id);
    componentVariantIds.push(component.product_variant_id);
    componentRoles.push(component.component_role);
    componentPrices.push(component.price.selected_price);
    componentCurrencies.push(component.price.currency);
    componentStoreIds.push(component.price.store_id);
    componentCheckedAts.push(component.price.price_checked_at);
    componentOfferClasses.push(component.price.offer_class);
    componentOfferIds.push(component.price.store_offer_id);
  }
  await db.query(INSERT_BUILD_COMPONENT_SQL, [
    componentIds,
    componentBuildIds,
    componentProductIds,
    componentVariantIds,
    componentRoles,
    componentPrices,
    componentCurrencies,
    componentStoreIds,
    componentCheckedAts,
    componentOfferClasses,
    componentOfferIds,
  ]);

  const swapResult = await db.query(INSERT_RECOMMENDATION_SWAP_SQL, [
    args.sourceResultId,
    buildCandidateId,
    args.role,
    replaced.product_id,
    replaced.product_variant_id === undefined ? null : replaced.product_variant_id,
    args.catalogVersion === undefined ? null : args.catalogVersion,
    args.engineVersion === undefined ? null : args.engineVersion,
  ]);
  const swapRows = swapResult && Array.isArray(swapResult.rows) ? swapResult.rows : [];
  if (swapRows.length === 0) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'recommendation_swap',
      'the swap INSERT returned no row'
    );
  }

  return Object.freeze({
    committed: true,
    reason: null,
    role: args.role,
    blocked_role: null,
    eligibility: null,
    // The verdict that was PERSISTED: the whole build's, not the role's.
    compatibility: verdict,
    price: Object.freeze({
      next: composed.price.next,
      offer_class: composed.price.offer_class,
    }),
    build: Object.freeze({
      build_candidate_id: buildCandidateId,
      total_price: totalPrice,
      score: toMoney(score),
      compatibility_status: verdict.status,
      components: Object.freeze(components),
    }),
    swap: Object.freeze({
      role: args.role,
      product_id: args.productId,
      product_variant_id: args.productVariantId === undefined ? null : args.productVariantId,
      created_at: swapRows[0].created_at,
      engine_version: args.engineVersion === undefined ? null : args.engineVersion,
    }),
  });
}

/** Deduped, sorted product ids - the assessment loader's input contract. */
function uniqueProductIds(components) {
  const ids = new Set();
  for (const component of components) {
    ids.add(component.product_id);
  }
  return [...ids].sort();
}

/**
 * Read the committed swap of one result, if there is one. Read-only, one
 * statement, no transaction control.
 *
 * The route calls this BEFORE composing anything: Decision 56 item 6 allows ONE
 * committed swap per build, and answering "already committed" without paying a
 * pass's read half is both cheaper and the honest order of questions. The
 * UNIQUE index on the column is the race guard; this read is the pre-check.
 *
 * @param {object} db pool or client exposing query(sql, params)
 * @param {string} sourceResultId the recommendation_result id
 * @returns {Promise<{found: false} | {found: true, swap: object}>}
 */
async function readCommittedSwap(db, sourceResultId) {
  const result = await db.query(SELECT_COMMITTED_SWAP_SQL, [sourceResultId]);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  if (rows.length === 0) {
    return Object.freeze({ found: false });
  }
  return Object.freeze({
    found: true,
    swap: Object.freeze({
      id: rows[0].id,
      build_candidate_id: rows[0].build_candidate_id,
      component_role: rows[0].component_role,
      created_at: rows[0].created_at,
    }),
  });
}

/**
 * Run one swap commit inside its own write transaction.
 *
 * `client` MUST be a single dedicated connection (BEGIN and COMMIT are
 * session-scoped); with a pg Pool, check one out first and release it
 * afterwards.
 *
 * Error policy mirrors `./commit`: the failure that started the rollback always
 * wins, a failing ROLLBACK never masks it, a failing BEGIN propagates without
 * attempting one, and COMMIT ends the happy path.
 *
 * @param {object} client pg-compatible SINGLE dedicated connection
 * @param {object} args the commitSwap argument object
 * @returns {Promise<object>} the frozen commitSwap result
 */
async function commitSwapInTransaction(client, args) {
  validateClient(client);
  await client.query(BEGIN_SQL);
  let result;
  try {
    result = await commitSwap(Object.assign({}, args, { db: client }));
  } catch (error) {
    try {
      await client.query(ROLLBACK_SQL);
    } catch (rollbackError) {
      void rollbackError;
    }
    throw error;
  }
  try {
    await client.query(COMMIT_SQL);
  } catch (error) {
    try {
      await client.query(ROLLBACK_SQL);
    } catch (rollbackError) {
      void rollbackError;
    }
    throw error;
  }
  return result;
}

module.exports = {
  commitSwap,
  commitSwapInTransaction,
  readCommittedSwap,
  BEGIN_SQL,
  COMMIT_SQL,
  ROLLBACK_SQL,
  INSERT_BUILD_CANDIDATE_SQL,
  INSERT_BUILD_COMPONENT_SQL,
  INSERT_RECOMMENDATION_SWAP_SQL,
  SELECT_COMMITTED_SWAP_SQL,
};
