/**
 * Engine 3 - Build assembly entry point (Steps 1-4 composed).
 *
 * Boundary: a thin composition of the four already-implemented Engine 3 steps
 * over the already-loaded Engine 2 sources. It owns no logic of its own: no
 * validation beyond what the steps perform, no policy, no traversal, no SQL.
 *
 *   Engine 2C / Stage 1 result ({ input, pool[, prices] })
 *   Engine 2D filtering context + filter result ({ results })
 *   validated scoring model (Decision 11 loader)
 *   Engine 2 Stage 1 price carrier
 *         |  buildGpuInputs(...)        - GPU-input LOADING (./gpu-input):
 *         |                               use_case + gpu_required_use_cases +
 *         |                               integrated_gpu_present
 *         v
 *   nine-field Engine 3 input
 *         |  validateEngine3Input(...)  - Step 1 (./input): contract + freezing
 *         |  validatePrices(...)        - Step 2 (./prices): price carrier
 *         v
 *   frozen Engine 3 input + frozen price carrier
 *         |  assembleBuilds(...)        - Step 4 (./assemble): DFS over
 *         |                               EXPANSION_ORDER + Step 3 GPU policy
 *         v
 *   frozen { builds: [complete v1 build, ...] }
 *
 * Field sourcing (no invention, one owner per field):
 *   results                 retention's output (retainTopKPerRole,
 *                           src/recommendation/retention/) - frozen { results }
 *                           shape, PASS|UNKNOWN only per Rule 2, REJECT already
 *                           excluded upstream - Engine 3's own shape/validation
 *                           unchanged per Decision 12 Rule 6.
 *   budget_amount           Engine 2A selection input (Engine 2C / Stage 1).
 *   currency                Engine 2A selection input.
 *   required_roles          Engine 2A selection input.
 *   use_case                GPU-input loading (Engine 2A selection input).
 *   gpu_required_use_cases  GPU-input loading (scoring-model configuration).
 *   integrated_gpu_present  GPU-input loading (Engine 2D context, Decision 11).
 *   candidate_caps          scoring-model configuration; validated by Step 1
 *                           only; retention/ applies top_k_per_role upstream of
 *                           this module once an orchestrator calls it - this
 *                           module's own stance is unchanged (it still receives
 *                           whatever results its caller provides).
 *   prices                  Engine 2 Stage 1 carrier, validated by Step 2.
 *
 * Explicit NON-responsibilities (deliberately absent from this module)
 *   - no database access, no connection, no SQL: the DB-backed loaders
 *     (loadCandidates, selectOfferPrices, loadFilteringContext,
 *     loadScoringModel) are the caller's to run. This module receives their
 *     outputs, so assembly/ stays database-free (same policy as Engine 2D
 *     B2-G, ../filtering/pipeline.js).
 *   - no candidate selection, no offer selection, no compatibility evaluation
 *   - no scoring, no ranking, no top-K application, no persistence
 *   - no GPU policy decision (Step 3 owns REQUIRED | OPTIONAL)
 *   - no new contracts and no new error codes: the Engine 2 error vocabulary
 *     and the Engine 3 step contracts are reused unchanged.
 *
 * Determinism: no clock reads, no randomness, no I/O; identical sources yield
 * deeply equal builds.
 */

'use strict';

const { createCandidateSelectionInput } = require('../candidates/input');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { buildGpuInputs } = require('./gpu-input');
const { validateEngine3Input } = require('./input');
const { validatePrices } = require('./prices');
const { assembleBuilds } = require('./assemble');

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Run the complete Engine 3 build-assembly pipeline for one recommendation
 * query, from the already-loaded Engine 2 sources to assembled builds.
 *
 * Synchronous and database-free by design: every database interaction happens in
 * the callers' loaders before this call. The single expression under test is
 * GPU-input loading (Steps 1 -> 2 -> 4).
 *
 * @param {object} sources
 * @param {object} sources.candidatePoolResult Engine 2C result { input, pool }
 *        (or the Engine 2 Stage 1 result { input, pool, prices }).
 * @param {object} sources.filteringContext frozen Engine 2D filtering context
 *        produced by loadFilteringContext - the Decision 11 iGPU source.
 * @param {object} sources.filterResult Engine 2D filter result { results }
 *        produced by filterCandidates.
 * @param {object} sources.scoringModel validated scoring model produced by
 *        loadScoringModel (Decision 11).
 * @param {object} sources.prices Engine 2 Stage 1 price carrier (raw
 *        null-prototype carrier or an already-validated frozen carrier; the
 *        Step 2 re-validation is idempotent).
 * @returns {object} frozen { builds } - complete v1 builds in discovery order,
 *        each component carrying its exact frozen Step 2 price carrier entry.
 * @throws {CandidateSelectionError} fail-fast on a missing/malformed source, on
 *        any Engine 3 step contract violation, and on any candidate without a
 *        price (no price is ever invented).
 */
function assembleBuildsForRecommendation(sources) {
  if (sources === undefined || sources === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      null,
      'Engine 3 assembly requires a sources object'
    );
  }
  if (!isPlainObject(sources)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      null,
      'Engine 3 assembly requires an object carrying candidatePoolResult, filteringContext, filterResult, scoringModel and prices'
    );
  }

  const { candidatePoolResult, filteringContext, filterResult, scoringModel, prices } = sources;

  // --- required sources (fail fast, before any work) -----------------------
  for (const [field, value] of [
    ['candidatePoolResult', candidatePoolResult],
    ['filteringContext', filteringContext],
    ['filterResult', filterResult],
    ['scoringModel', scoringModel],
    ['prices', prices],
  ]) {
    if (value === undefined || value === null) {
      fail(
        ERROR_CODES.MISSING_REQUIRED_FIELD,
        field,
        `Engine 3 assembly requires "${field}"`
      );
    }
  }

  // --- GPU-input LOADING (Step 3 inputs, sourced not stubbed) --------------
  // Also re-checks the scoring-model shape this boundary depends on.
  const gpuInputs = buildGpuInputs({ candidatePoolResult, filteringContext, scoringModel });

  // Budget / currency / roles come from the same validated Engine 2A input.
  const selectionInput = createCandidateSelectionInput(candidatePoolResult.input);

  if (!isPlainObject(filterResult) || !Array.isArray(filterResult.results)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'filterResult',
      '"filterResult" must be the Engine 2D filter result exposing a "results" array'
    );
  }

  // `candidate_caps` is passed through untouched: Step 1 validates the strict
  // closed two-key shape and Step 4 consumes only `max_builds_per_query`.
  const engine3Input = {
    results: filterResult.results,
    budget_amount: selectionInput.budget_amount,
    currency: selectionInput.currency,
    required_roles: selectionInput.required_roles,
    use_case: gpuInputs.use_case,
    gpu_required_use_cases: gpuInputs.gpu_required_use_cases,
    integrated_gpu_present: gpuInputs.integrated_gpu_present,
    candidate_caps: scoringModel.configuration.candidate_caps,
    prices,
  };

  // --- Steps 1, 2, 4 (unchanged modules; no logic duplicated here) ---------
  const validated = validateEngine3Input(engine3Input);
  const frozenPrices = validatePrices(validated.prices);
  return assembleBuilds({ ...validated, prices: frozenPrices });
}

module.exports = { assembleBuildsForRecommendation };