/**
 * Engine 3 - GPU-input loading: candidate pool -> GPU-requirement input shape.
 *
 * Boundary: turns the already-loaded Engine 2 sources into EXACTLY the input
 * `resolveGpuRequirement()` consumes, minus the per-path `selectedCpuProductId`
 * (which the Step 4 traversal derives from the active CPU choice and therefore
 * cannot be known here).
 *
 *   Engine 2C candidate-pool result ({ input, pool })  -> Engine 2A input
 *         |  createCandidateSelectionInput(poolResult.input) (idempotent)
 *         v
 *   validated selection input -> `use_case` (verbatim, no trim/case folding)
 *
 *   validated scoring model (Decision 11, ../scoring)
 *         |  scoringModel.configuration.gpu_required_use_cases
 *         v
 *   frozen verbatim copy -> `gpu_required_use_cases` (no vocabulary check here)
 *
 *   Engine 2D filtering context (Decision 11 resolution, 2026-09-17)
 *         |  buildIntegratedGpuPresentMap(context) - the existing, pure,
 *         |                                          DB-free Decision 11 handoff
 *         v
 *   frozen map -> `integrated_gpu_present` ({ [cpu_product_id]: true|false|null })
 *
 * Produces:  frozen { use_case, gpu_required_use_cases, integrated_gpu_present }
 *            - the exact argument contract of Step 3 (./gpu-policy), so a caller
 *            can spread it straight into `resolveGpuRequirement`.
 *
 * Established upstream pattern: like Engine 2 Stage 1 (../offers/select.js,
 * which reuses the Engine 3 price-carrier helpers from ./prices), this module
 * owns no contract of its own. It reuses the Engine 2A selection input contract
 * for `use_case`, the Decision 11 iGPU handoff for `integrated_gpu_present`, and
 * reads only the already-validated `gpu_required_use_cases` out of the loaded
 * scoring model. Nothing is re-implemented and no parallel vocabulary exists.
 *
 * Loading rules (exactly):
 *
 *   use_case                 from the Engine 2A selection input, verbatim;
 *                            matching semantics stay Step 3's (../gpu-policy).
 *   gpu_required_use_cases   shallow copy of the validated scoring-model list.
 *                            Order, duplicates, whitespace and case are
 *                            preserved byte-for-byte; an empty array stays an
 *                            empty array (never defaulted). Entry-level rules
 *                            (non-blank strings) are deliberately NOT re-checked
 *                            here - Step 1 (./input) owns them, so this module
 *                            invents no second validation boundary.
 *   integrated_gpu_present   delegated unchanged to buildIntegratedGpuPresentMap
 *                            (Decision 11: `=== true` is the only OPTIONAL
 *                            signal; false / DB NULL / missing cpu_spec all
 *                            stay GPU-REQUIRED-triggering, never `undefined`).
 *
 * Explicit NON-responsibilities (deliberately absent from this module)
 *   - no database access, no I/O, no clock reads, no framework
 *   - no SQL, no offer/price selection (Engine 2 Stage 1 owns the carrier)
 *   - no compatibility evaluation (Engine 2D owns the verdicts)
 *   - no scoring-model loading or configuration validation (the Decision 11
 *     loader ../../scoring/load-scoring-model.js owns the DB row and the full
 *     Decision 3(a) configuration; this module reads the one consumed field)
 *   - no GPU policy decision (Step 3 ./gpu-policy owns REQUIRED | OPTIONAL)
 *   - no Engine 3 input validation, no price validation, no assembly,
 *     no traversal, no orchestration, no persistence
 *   - no mutation and no freezing of caller-owned data
 *
 * Pure: deterministic, database-free, framework-free.
 */

'use strict';

const { createCandidateSelectionInput } = require('../candidates/input');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
const { buildIntegratedGpuPresentMap } = require('../filtering/igpu-map');

/** Documented nested path of the consumed scoring-model configuration field. */
const GPU_REQUIRED_USE_CASES_PATH =
  'scoring_model.configuration.gpu_required_use_cases';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read the already-validated `gpu_required_use_cases` out of a loaded scoring
 * model. The model is expected to have passed the Decision 11 loader; only the
 * shape this boundary depends on is re-checked (fail-fast, existing error
 * vocabulary, exact nested paths) - the complete Decision 3(a) configuration
 * contract is NOT re-validated here.
 *
 * @param {object} scoringModel validated scoring model (Decision 11 loader)
 * @returns {Array<string>} the caller-owned list, read only
 */
function readGpuRequiredUseCases(scoringModel) {
  if (scoringModel === undefined || scoringModel === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'scoringModel',
      'GPU-input loading requires the validated "scoringModel"'
    );
  }
  if (!isPlainObject(scoringModel)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'scoringModel',
      '"scoringModel" must be the validated scoring-model object'
    );
  }

  const configuration = scoringModel.configuration;
  if (configuration === undefined || configuration === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'scoring_model.configuration',
      'GPU-input loading requires "scoring_model.configuration"'
    );
  }
  if (!isPlainObject(configuration)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'scoring_model.configuration',
      '"scoring_model.configuration" must be a configuration object'
    );
  }

  const list = configuration.gpu_required_use_cases;
  if (list === undefined || list === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      GPU_REQUIRED_USE_CASES_PATH,
      `GPU-input loading requires "${GPU_REQUIRED_USE_CASES_PATH}"`
    );
  }
  if (!Array.isArray(list)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      GPU_REQUIRED_USE_CASES_PATH,
      `"${GPU_REQUIRED_USE_CASES_PATH}" must be an array`
    );
  }
  return list;
}

/**
 * Build the Step 3 GPU inputs from the already-loaded Engine 2 sources.
 *
 * Pure and deterministic: the same sources always yield a deeply equal frozen
 * result, in the documented key order `use_case`, `gpu_required_use_cases`,
 * `integrated_gpu_present`. Caller-owned objects are only read: never mutated,
 * never frozen.
 *
 * @param {object} sources
 * @param {object} sources.candidatePoolResult Engine 2C result { input, pool }
 *        (or any upstream result still carrying the validated Engine 2A
 *        `input`, e.g. the Engine 2 Stage 1 result { input, pool, prices });
 *        only `input` is read - `pool` belongs to the 2D / Stage 1 stages.
 * @param {object} sources.filteringContext frozen Engine 2D filtering context
 *        { candidates, specs, ... } - the Decision 11 iGPU source.
 * @param {object} sources.scoringModel validated scoring model carrying
 *        `configuration.gpu_required_use_cases` (Decision 10 Rule 3 /
 *        Decision 11 Rule 8).
 * @returns {object} frozen { use_case, gpu_required_use_cases,
 *        integrated_gpu_present }
 * @throws {CandidateSelectionError} fail-fast on a missing/malformed source
 *        (INVALID_INPUT / MISSING_REQUIRED_FIELD / INVALID_FIELD_VALUE); an
 *        iGPU handoff error propagates unchanged from
 *        buildIntegratedGpuPresentMap.
 */
function buildGpuInputs(sources) {
  if (sources === undefined || sources === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      null,
      'GPU-input loading requires a sources object'
    );
  }
  if (!isPlainObject(sources)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      null,
      'GPU-input loading requires an object carrying candidatePoolResult, filteringContext and scoringModel'
    );
  }

  const { candidatePoolResult, filteringContext } = sources;

  // --- use_case (Engine 2A selection input, re-validated idempotently) ------
  if (candidatePoolResult === undefined || candidatePoolResult === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'candidatePoolResult',
      'GPU-input loading requires "candidatePoolResult"'
    );
  }
  if (!isPlainObject(candidatePoolResult)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'candidatePoolResult',
      '"candidatePoolResult" must be an Engine 2C candidate-pool result object'
    );
  }
  if (candidatePoolResult.input === undefined || candidatePoolResult.input === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'candidatePoolResult.input',
      'GPU-input loading requires the validated Engine 2A "candidatePoolResult.input"'
    );
  }
  const selectionInput = createCandidateSelectionInput(candidatePoolResult.input);

  // --- gpu_required_use_cases (validated scoring model, read verbatim) ------
  const gpuRequiredUseCases = readGpuRequiredUseCases(sources.scoringModel);

  // --- integrated_gpu_present (Decision 11 handoff, delegated unchanged) ----
  if (filteringContext === undefined || filteringContext === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'filteringContext',
      'GPU-input loading requires the Engine 2D "filteringContext"'
    );
  }
  const integratedGpuPresent = buildIntegratedGpuPresentMap(filteringContext);

  // Fresh copies only for what this module owns; the iGPU map is already a
  // frozen, freshly built structure returned by the Decision 11 handoff.
  return Object.freeze({
    use_case: selectionInput.use_case,
    gpu_required_use_cases: Object.freeze([...gpuRequiredUseCases]),
    integrated_gpu_present: integratedGpuPresent,
  });
}

module.exports = { buildGpuInputs };