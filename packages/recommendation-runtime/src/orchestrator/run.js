'use strict';

/**
 * Decision 17 - Recommendation orchestrator (no writes).
 *
 * Boundary: composes the already-implemented, already-validated engine stages
 * into ONE recommendation pass over a caller-owned database client. It owns no
 * logic of its own: no SQL beyond the single transaction timestamp, no
 * validation beyond the argument object, no policy, no scoring arithmetic, no
 * ranking, no persistence, and NO transaction control.
 *
 *   queryId
 *     |  loadQueryInput(queryId, db)              Decision 10 / 17.1
 *     v
 *   { query_id, scoring_model_id, input }
 *     |  db.query(SELECT_NOW_SQL)                 Decision 17.2: FIRST statement
 *     |                                           after the query loader
 *     v
 *   nowMs (epoch milliseconds)
 *     |  loadScoringModel(scoring_model_id, db)   Decision 11 (pinned FK only)
 *     v
 *   scoring model (configuration: weights, candidate_caps, gpu_required_use_cases,
 *                   use_case_profiles)
 *     |  loadCandidates(input, db)                Engine 2B
 *     v
 *   { input, candidates }
 *     |  selectCandidatePool(loaded.input, loaded.candidates)   Engine 2C
 *     v
 *   { input, pool }
 *     |  selectOfferPrices(poolResult, db)        Engine 2 Stage 1
 *     v
 *   { input, pool, prices }  <-- THE Stage 1 result. From here on it is the
 *     |                          single source of input / pool / prices.
 *     |  loadFilteringContext(offerResult, db)    Engine 2D B2-B, ONCE
 *     v
 *   filtering context
 *     |  filterCandidates(context)                Engine 2D B2-D
 *     v
 *   filterResult { results: [PASS|UNKNOWN|REJECT verdict, ...] }
 *     |  loadComponentAssessments(pool product ids, db)   Engine 4 data, ONCE
 *     v
 *   assessments (map)   (feeds STEP 2 and STEP 3)
 *     |  computeCandidateScores({ candidates: offerResult.pool, ... })
 *     v
 *   candidateScores { scores }
 *     |  retainTopKPerRole({ filterResult, candidateScores, topKPerRole,
 *     |                        prices: offerResult.prices,
 *     |                        roleTargets, roleExclusions, topKByRole })
 *     |                     Decision 27 + E2 + E6 (Decision 54)
 *     v
 *   retentionResult { results }                  Decision 12/14 retention
 *     |  computeBudgetFloor({ retained, prices, budgetAmount, currency })
 *     v
 *   budgetFloor { cheapest_total, within_budget, ... }   Decision 27
 *     |  assembleBuildsForRecommendation({ ..., filterResult: retentionResult,
 *     |                                     filteringContext, ... })  Engine 3
 *     v
 *   { builds } (discovery order; never ranked here)
 *     |  computeBuildScores({ builds, assessments, ... })   Engine 4 STEP 3
 *     v
 *   frozen { query_id, scoring_model_id, builds, budget_amount, currency,
 *   build_contributions, budget_floor } - each build is the frozen
 *   Engine 3 build (components / total_price / currency /
 *   unknown_pairwise_count - Decision 23's build-local re-evaluation -
 *   unchanged and by reference) plus its own
 *   build_score. Zero builds is a valid outcome (builds: []).
 *
 * Wiring rules this module enforces (each one is load-bearing):
 *   - the transaction timestamp is the SECOND statement and the only clock; it
 *     is threaded into BOTH scoring steps. Decision 17 G4 rejected the
 *     assessment loader loaded_at (zero assessment rows -> null -> a
 *     legitimate no-evidence pool would fail the clock) and rejected any
 *     JS/injected clock in the legacy path. Decision 38 permits explicit options.asOf
 *     instead; no Date.now() exists in this module.
 *   - loadScoringModel runs immediately after that statement (Decision 17,
 *     clarification 2026-09-21, step 3): the pinned id comes from the query row
 *     and SCORING_MODEL_UNAVAILABLE must fail fast BEFORE the candidate / offer
 *     / filtering / assessment work.
 *   - loadCandidates' frozen output is consumed as
 *     selectCandidatePool(loaded.input, loaded.candidates).
 *   - Stage 1's result is the ONLY pool source from step 6 on: its pool is a
 *     strict SUBSET of the Engine 2C pool (candidates without a usable offer
 *     are dropped by selectOfferPrices) and its prices carrier covers exactly
 *     that subset. Building the filtering context or the scores from the 2C
 *     pool instead would hand Engine 3 a verdict without a carrier entry, and
 *     Engine 3 fails fast on that (prices.js lookupPrice -> INVALID_CANDIDATE).
 *   - loadFilteringContext runs ONCE and the returned context object is passed
 *     BY REFERENCE to filterCandidates AND to Engine 3 (Decision 16 pairwise
 *     gate). filterCandidatesForRecommendation is deliberately NOT used
 *     (Decision 17.3: it hides the context Engine 3 needs).
 *   - loadComponentAssessments runs ONCE for the Stage 1 pool's product ids.
 *     That set is a superset of every product that can appear in a build
 *     (verdicts come from that pool; retention only drops and reorders them),
 *     so the SAME { [product_id]: rows } map feeds STEP 2 and STEP 3. A
 *     missing product key is a legal no-evidence case, never an error.
 *   - retainTopKPerRole receives only THIS run's filterCandidates output, the
 *     STEP 2 scores, configuration.candidate_caps.top_k_per_role, and - since
 *     Decision 27 - offerResult.prices BY REFERENCE: the same frozen carrier
 *     Engine 3 receives two steps later, already in memory since step 6, so the
 *     cheapest-per-role reservation costs no query and no loader. It is passed
 *     by reference on purpose; retention validates nothing and copies nothing.
 *     Its frozen { results } replaces filterResult for Engine 3, whose input
 *     contract is unchanged (Decision 12 Rule 6 / Decision 14 Rule 6).
 *   - computeBudgetFloor runs UNCONDITIONALLY, on every pass, before assembly:
 *     a diagnostic that only appears on failure is a diagnostic nobody reads.
 *     Zero builds remains a valid outcome (Decision 17.2) and is now an
 *     EXPLAINED one. It is a pure call, not a stage, so it stays out of the
 *     Decision 17.3 call-order pin.
 *
 * Testability seam (deliberate, documented): collaborators are required as
 * namespace objects and CALLED THROUGH THE NAMESPACE
 * (filtering.filterCandidates(...), scoring.computeBuildScores(...), ...),
 * never destructured into local bindings. Unit tests therefore record call
 * order and object identity with a plain patch + restore instead of a mocking
 * framework (see run.test.js); behaviour is unchanged either way.
 *
 * Explicit NON-responsibilities: no BEGIN / COMMIT / ROLLBACK (Decision 17.5:
 * runRecommendationSnapshot in ./snapshot owns the transaction), no write of
 * any kind, no DDL/DML, no compatibility evaluation, no scoring arithmetic, no
 * ranking (Engine 5a, Decision 18), no persistence (Engine 5b, Decision 19), no assembly diversity (Decision 20), no
 * explanation (Engine 6), no db creation/close (injected and validated by the
 * loaders), no retries, no caching, no logging. It also renders nothing:
 * budget_floor is returned as data and deliberately NOT handed to Engine 6,
 * because this project has no UI or API surface to render it into yet
 * (Decision 27, Out of scope).
 *
 * Errors: the existing Engine 2 CandidateSelectionError / ERROR_CODES are
 * reused end to end; nothing is swallowed or translated. The only failures this
 * module raises itself are the argument-object contract and the timestamp
 * parsing (Decision 17.2).
 *
 * Determinism: no clock reads beyond the transaction timestamp, no randomness,
 * no I/O beyond the injected client; identical inputs and DB state yield
 * deeply equal output (Engine 3 discovery order preserved).
 */
// --- collaborators (called through their namespace objects - see the header) --

const core = require('../core-entry');
const query = require('../query');
const candidates = require('../candidates');
const offers = require('../offers');
const filtering = require('../filtering');
const scoring = require('../scoring');
const compute = require('./compute');
const { CandidateSelectionError, ERROR_CODES } = core.candidates;
const { parseAsOf } = core.offers;

/**
 * Decision 17.2: the single DB-side time source of one recommendation pass.
 * Parameterless by design (nothing to parameterize, nothing interpolated).
 */
const SELECT_NOW_SQL = 'SELECT CURRENT_TIMESTAMP AS now';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The ONLY validation this boundary owns: the argument object itself. db,
 * queryId and every contract field stay owned by the loaders, so a bad value
 * keeps raising the loader's own code and field (INVALID_INPUT db,
 * MISSING_REQUIRED_FIELD query_id, ...) - no second error vocabulary.
 */
function validateArgs(args) {
  if (!isPlainObject(args)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      null,
      'runRecommendation requires an object carrying "db" and "queryId"'
    );
  }
}

/**
 * Convert the transaction timestamp to epoch milliseconds, fail-closed.
 * Accepts the pg TIMESTAMPTZ forms (Date or string/number); a missing row or an
 * unparseable value never falls back to the JS clock (Decision 17.2).
 */
function toNowMs(row) {
  if (!isPlainObject(row) || !Object.prototype.hasOwnProperty.call(row, 'now')) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'now',
      'runRecommendation requires the transaction timestamp ("SELECT CURRENT_TIMESTAMP AS now")'
    );
  }
  const value = row.now;
  let nowMs = null;
  if (value instanceof Date) {
    const ms = value.getTime();
    nowMs = Number.isNaN(ms) ? null : ms;
  } else if (typeof value === 'string' || typeof value === 'number') {
    const ms = new Date(value).getTime();
    nowMs = Number.isNaN(ms) ? null : ms;
  }
  if (nowMs === null) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'now',
      '"now" must be a database timestamp convertible via new Date(value).getTime()'
    );
  }
  return nowMs;
}

/**
 * Read nowMs through the injected client: exactly one statement, no transaction
 * control (Decision 17.5: the caller owns BEGIN/ROLLBACK).
 */
async function readTransactionTimestamp(db) {
  const result = await db.query(SELECT_NOW_SQL);
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  if (rows.length === 0) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'now',
      'runRecommendation requires the transaction timestamp ("SELECT CURRENT_TIMESTAMP AS now")'
    );
  }
  return toNowMs(rows[0]);
}

/**
 * Product ids for the single assessment load: the deduped, sorted product ids
 * of the Stage 1 pool, which is a superset of every product that can appear in
 * an assembled build (see the header).
 */
function assessmentProductIds(pool) {
  const ids = new Set();
  for (const candidate of pool) {
    ids.add(candidate.product_id);
  }
  return [...ids].sort();
}

/**
 * Run one recommendation pass for queryId over the injected db client.
 *
 * Issues NO transaction control: Decision 17.5 puts BEGIN and the
 * end-of-transaction in runRecommendationSnapshot (./snapshot). A caller that
 * hands this function a bare client gets auto-commit reads; a caller that
 * wraps it owns the transaction.
 *
 * @param {object} args { db, queryId, options? }
 * @param {object} args.db pg-compatible client exposing db.query(sql, params);
 *        injected and validated by the loaders, never created or closed here.
 * @param {string} args.queryId pinned recommendation_query.id.
 * @param {object} [args.options] Decision 35 engine options, passed through to
 *        Stage 1 unchanged; asOf is also consumed here (Decision 38). Default OFF: an omitted
 *        options object leaves every eligibility rule exactly as it was.
 * Decision 38: options.asOf is optional ISO time with an explicit timezone;
 * when supplied it pins scoring/offer freshness, otherwise the transaction clock remains.
 * @returns {Promise<object>} frozen { query_id, scoring_model_id, builds,
 *        budget_amount, currency, priority, archetype_objectives,
 *        build_contributions, budget_floor } (Decision 58 adds
 *        `archetype_objectives`: the use case's weights, or null when the model
 *        does not opt in) - builds
 *        in Engine 3 discovery order, each an Engine 3 build plus build_score,
 *        empty when no complete build fits the budget; build_contributions is
 *        the Decision 22 item-1 contribution list, index-aligned with builds;
 *        budget_floor is the Decision 27 diagnostic (cheapest_total,
 *        currency, budget_amount, within_budget, cheapest_by_role,
 *        missing_roles) and is present on every result, empty builds or not.
 * @throws {CandidateSelectionError} the existing Engine 2 vocabulary, raised by
 *        the composed stages (blank/NULL use_case, missing query row, missing
 *        scoring model, empty candidate pool, ...) or by this boundary's own
 *        argument / timestamp gates.
 */
async function runRecommendation(args) {
  validateArgs(args);
  const db = args.db;
  const queryId = args.queryId;

  // 1. Query loader (Decision 10 / 17.1). PostgreSQL errors propagate unchanged
  //    (a malformed UUID raises 22P02 and aborts the caller snapshot).
  const queryInput = await query.loadQueryInput(queryId, db);

  // 2. Transaction timestamp (Decision 17.2): the FIRST statement after the
  //    query loader, and the only clock either scoring step sees.
  const asOf = parseAsOf(args.options);
  const nowMs = asOf === null ? await readTransactionTimestamp(db) : asOf.nowMs;

  // 3. Pinned scoring model (Decision 11; position clarified in Decision 17,
  //    2026-09-21). Fails fast with SCORING_MODEL_UNAVAILABLE before the
  //    candidate / offer / filtering / assessment work.
  const scoringModel = await scoring.loadScoringModel(queryInput.scoring_model_id, db);

  // 4./5. Engine 2B load, then Engine 2C pool selection over that exact output.
  const loaded = await candidates.loadCandidates(queryInput.input, db);
  const poolResult = candidates.selectCandidatePool(loaded.input, loaded.candidates);

  // 6. Stage 1: cheapest eligible offer per candidate + the Engine 3 price
  //    carrier. Its pool is a SUBSET of the 2C pool (candidates without a
  //    usable offer are dropped) and is the only pool used from here on: the
  //    carrier covers exactly its members.
  const offerResult = await offers.selectOfferPrices(poolResult, db, args.options);

  // 7./8. Engine 2D: the context is loaded ONCE and the SAME object is handed
  //    to the pure filter and to Engine 3 (Decision 16 pairwise gate).
  const filteringContext = await filtering.loadFilteringContext(offerResult, db);
  const filterResult = filtering.filterCandidates(filteringContext);

  // 9. Engine 4 data, ONCE, covering candidate scoring and build scoring.
  const assessmentResult = await scoring.loadComponentAssessments(
    assessmentProductIds(offerResult.pool),
    db
  );
  const assessments = assessmentResult.assessments;

  // 10.-14. Decision 17.3 does not end at loadCandidates: the assemble-and-score
  //        half below is pure, so it lives in ./compute and is replayed from
  //        test/golden/fixtures/<ID>.json. Stage order is unchanged - the call
  //        site stands exactly where the first of those stages used to.
  return compute.computeFromLoaded({
    query: queryInput,
    scoringModel,
    candidatePoolResult: offerResult,
    filteringContext,
    filterResult,
    assessments,
    nowMs,
  });
}

module.exports = { runRecommendation, SELECT_NOW_SQL };