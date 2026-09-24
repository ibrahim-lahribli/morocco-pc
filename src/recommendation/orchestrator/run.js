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
 *   scoring model (configuration: weights, candidate_caps, gpu_required_use_cases)
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
 *     |  retainTopKPerRole({ filterResult, candidateScores, topKPerRole })
 *     v
 *   retentionResult { results }                  Decision 12/14 retention
 *     |  assembleBuildsForRecommendation({ ..., filterResult: retentionResult,
 *     |                                     filteringContext, ... })  Engine 3
 *     v
 *   { builds } (discovery order; never ranked here)
 *     |  computeBuildScores({ builds, assessments, ... })   Engine 4 STEP 3
 *     v
 *   frozen { query_id, scoring_model_id, builds } - each build is the frozen
 *   Engine 3 build (components / total_price / currency /
 *   unknown_pairwise_count, unchanged and by reference) plus its own
 *   build_score. Zero builds is a valid outcome (builds: []).
 *
 * Wiring rules this module enforces (each one is load-bearing):
 *   - the transaction timestamp is the SECOND statement and the only clock; it
 *     is threaded into BOTH scoring steps. Decision 17 G4 rejected the
 *     assessment loader loaded_at (zero assessment rows -> null -> a
 *     legitimate no-evidence pool would fail the clock) and rejected any
 *     JS/injected clock. No Date.now() exists in this module.
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
 *     STEP 2 scores and configuration.candidate_caps.top_k_per_role (closes
 *     the retention trust-boundary flag in DEVELOPMENT_NOTES.md). Its frozen
 *     { results } replaces filterResult for Engine 3, whose input contract is
 *     unchanged (Decision 12 Rule 6 / Decision 14 Rule 6).
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
 * loaders), no retries, no caching, no logging.
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

const query = require('../query');
const candidates = require('../candidates');
const offers = require('../offers');
const filtering = require('../filtering');
const scoring = require('../scoring');
const retention = require('../retention');
const assembly = require('../assembly');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

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
 * Engine 3 builds are deeply frozen, so the score is attached by building a NEW
 * frozen object: the Engine 3 fields travel by reference, nothing is edited.
 */
function withBuildScore(build, buildScore) {
  return Object.freeze({ ...build, build_score: buildScore });
}
/**
 * Run one recommendation pass for queryId over the injected db client.
 *
 * Issues NO transaction control: Decision 17.5 puts BEGIN and the
 * end-of-transaction in runRecommendationSnapshot (./snapshot). A caller that
 * hands this function a bare client gets auto-commit reads; a caller that
 * wraps it owns the transaction.
 *
 * @param {object} args { db, queryId }
 * @param {object} args.db pg-compatible client exposing db.query(sql, params);
 *        injected and validated by the loaders, never created or closed here.
 * @param {string} args.queryId pinned recommendation_query.id.
 * @returns {Promise<object>} frozen { query_id, scoring_model_id, builds } -
 *        builds in Engine 3 discovery order, each an Engine 3 build plus
 *        build_score; empty when no complete build fits the budget.
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
  const nowMs = await readTransactionTimestamp(db);

  // 3. Pinned scoring model (Decision 11; position clarified in Decision 17,
  //    2026-09-21). Fails fast with SCORING_MODEL_UNAVAILABLE before the
  //    candidate / offer / filtering / assessment work.
  const scoringModel = await scoring.loadScoringModel(queryInput.scoring_model_id, db);
  const configuration = scoringModel.configuration;

  // 4./5. Engine 2B load, then Engine 2C pool selection over that exact output.
  const loaded = await candidates.loadCandidates(queryInput.input, db);
  const poolResult = candidates.selectCandidatePool(loaded.input, loaded.candidates);

  // 6. Stage 1: cheapest eligible offer per candidate + the Engine 3 price
  //    carrier. Its pool is a SUBSET of the 2C pool (candidates without a
  //    usable offer are dropped) and is the only pool used from here on: the
  //    carrier covers exactly its members.
  const offerResult = await offers.selectOfferPrices(poolResult, db);

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

  // 10. Engine 4 STEP 2 over the Stage 1 pool (REJECT verdicts are scored too
  //     and simply ignored by retention).
  const candidateScores = scoring.computeCandidateScores({
    candidates: offerResult.pool,
    assessments,
    configuration,
    nowMs,
  });

  // 11. Retention (Decision 12/14): only THIS run's filterCandidates output, its
  //     STEP 2 scores, and the Decision 11 cap.
  const retentionResult = retention.retainTopKPerRole({
    filterResult,
    candidateScores,
    topKPerRole: configuration.candidate_caps.top_k_per_role,
  });

  // 12. Engine 3: the retention output replaces filterResult.results
  //     (assembly/pipeline.js reads filterResult.results), the SAME filtering
  //     context object travels by reference, and the carrier is Stage 1's.
  const assemblyResult = assembly.assembleBuildsForRecommendation({
    candidatePoolResult: offerResult,
    filteringContext,
    filterResult: retentionResult,
    scoringModel,
    prices: offerResult.prices,
  });

  // 13. Engine 4 STEP 3 (index-aligned with the builds in discovery order; the
  //     Decision 15 UNKNOWN count is read per build).
  const buildScores = scoring.computeBuildScores({
    builds: assemblyResult.builds,
    assessments,
    configuration,
    nowMs,
  });
  if (buildScores.scores.length !== assemblyResult.builds.length) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'buildScores',
      'build scores must stay index-aligned with the assembled builds'
    );
  }

  // 14. Frozen Decision 17.2 result: zero builds is a valid outcome.
  const builds = [];
  for (let index = 0; index < assemblyResult.builds.length; index += 1) {
    builds.push(
      withBuildScore(assemblyResult.builds[index], buildScores.scores[index].build_score)
    );
  }

  return Object.freeze({
    query_id: queryInput.query_id,
    scoring_model_id: queryInput.scoring_model_id,
    builds: Object.freeze(builds),
    budget_amount: queryInput.input.budget_amount,
    currency: queryInput.input.currency,
  });
}

module.exports = { runRecommendation, SELECT_NOW_SQL };