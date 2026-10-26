'use strict';

/**
 * apps/api/src/engine.js - the API's ONLY engine entry point.
 *
 * Boundary: this file exists so the HTTP layer never reaches into an engine
 * module's internals. It requires exactly six PUBLIC BARRELS
 * (`src/recommendation/orchestrator/index.js`,
 * `src/recommendation/candidates/index.js`,
 * `src/recommendation/scoring/index.js`,
 * `src/recommendation/query/index.js`,
 * `src/recommendation/retention/index.js` and, since Decision 55,
 * `src/recommendation/assembly/index.js`) and re-exports nothing the engine
 * does not already export. `import-boundary.test.js` enforces that rule by
 * scanning every file under apps/api/src for a `require` that resolves to a
 * path inside `src/recommendation/` and is neither a stage barrel (`index.js`)
 * nor the one documented exception (persistence/, which has no barrel and is
 * imported as `persistence/persist-ranked`).
 *
 * No engine logic lives here: no scoring, no ranking, no assembly, no SQL.
 * The one decision this module owns is the beta option (Decision 35 /
 * Decision 36 item 2): the HTTP API ALWAYS runs with
 * `allow_unverified_seed_offers: true`. The whole catalog is seed data
 * (`store_offer.ingestion_record_id IS NULL` on 101/101 rows), so with the
 * option OFF every pass would eventually throw EMPTY_CANDIDATE_POOL once the
 * 30-day window lapsed - a beta API that returns nothing is not a beta. The
 * option is intentionally NOT exposed as a request field: a client must not be
 * able to turn the freshness rule back on and change what it gets.
 */

const orchestrator = require('../../../src/recommendation/orchestrator');
const assembly = require('../../../src/recommendation/assembly');
const candidates = require('../../../src/recommendation/candidates');
const scoring = require('../../../src/recommendation/scoring');
const query = require('../../../src/recommendation/query');
const retention = require('../../../src/recommendation/retention');

/** The API's fixed engine options. Frozen so a caller cannot mutate it. */
const API_ENGINE_OPTIONS = Object.freeze({ allow_unverified_seed_offers: true });

/**
 * The use-case vocabulary of the ACTIVE scoring model, or NULL when it
 * cannot be derived.
 *
 * This is the API's single source for the accepted `use_case` values, and
 * the reason it lives HERE rather than in the presenter: the vocabulary is a
 * property of the scoring model (Decision 37), so `listUseCases` reads
 * `configuration.use_case_profiles` and falls back to the legacy
 * `gpu_required_use_cases` only for a model that declares no profiles. Before
 * this function existed the HTTP layer derived the list itself from
 * `gpu_required_use_cases` - the same list that makes a GPU mandatory - so
 * OFFICE could never be offered even for a model that declares a policy for
 * it (OG-38). Putting the derivation in the API's only engine-reaching
 * module is what lets `meta.js` stay pure and own nothing but the French
 * labels.
 *
 * NULL means UNKNOWN, never an empty list: a configuration declaring neither
 * key is a state of the ACTIVE MODEL, not a request error, and both routes
 * turn it into a 503. Returning `[]` would look like a valid answer and would
 * leave a client with a form it can never submit (Decision 36 item 3). The
 * validation error is deliberately not rethrown - it is not the caller's
 * fault, and the 503 body already says the vocabulary is unavailable.
 *
 * @param {object} configuration a scoring-model configuration (validated or raw)
 * @returns {string[]|null} frozen use-case values, or null. For a JSONB-backed
 *          configuration the ORDER is jsonb's key order, not the seed file's
 *          declaration order - jsonb sorts keys, so nothing may depend on the
 *          order a seed wrote.
 */
function useCaseVocabulary(configuration) {
  try {
    return scoring.listUseCases(configuration);
  } catch (_error) {
    return null;
  }
}

/**
 * The options one pass runs with, including the deploy identity Decision 46
 * persists onto `recommendation_result.engine_version`.
 *
 * This is the API half of that handoff: the engine version is a CALLER-supplied
 * `options.engineVersion` and the engine never reads `process.env` for it, so
 * whoever knows which deploy is running has to say so. Here that is
 * `app.engineVersion` (from `ENGINE_VERSION`, defaulting to `dev`), which is the
 * same value the response reports as `served_by.engine_version` - so a persisted
 * row and the reply that produced it name one deploy, not two.
 *
 * A value that is not a non-empty string is DROPPED rather than passed through.
 * `persistPassFacts` refuses a blank or non-string engineVersion, and that
 * refusal would abort the entire pass with a 500 over a cosmetic provenance
 * field. Degrading to "not recorded" (SQL NULL) is the honest failure
 * direction: the schema is nullable precisely because this fact can be unknown,
 * and NULL means UNKNOWN - never a guessed placeholder. `buildApp` already
 * normalizes the ordinary path to a string, so this only guards direct callers.
 *
 * @param {string} [engineVersion] the deploy that is running this pass
 * @returns {object} frozen options for runRecommendationFullRun
 */
function engineOptionsFor(engineVersion) {
  if (typeof engineVersion === 'string' && engineVersion.trim().length > 0) {
    return Object.freeze(Object.assign({}, API_ENGINE_OPTIONS, { engineVersion }));
  }
  return API_ENGINE_OPTIONS;
}

/**
 * Run one full recommendation pass for `queryId` on `client`.
 *
 * `client` MUST be a single dedicated connection: the engine's read wrapper
 * opens its own REPEATABLE READ READ ONLY transaction and the write wrapper its
 * own write transaction, and nested-transaction safety depends on both running
 * in the same session.
 *
 * @param {object} client pg-compatible single dedicated connection
 * @param {string} queryId pinned recommendation_query.id
 * @param {string} [engineVersion] the deploy running this pass; persisted as
 *        the pass's `engine_version` (see engineOptionsFor). Callers that omit
 *        it still run - the column simply reads back NULL.
 * @returns {Promise<object>} the engine's frozen combined result
 */
async function runFullRun(client, queryId, engineVersion) {
  return orchestrator.runRecommendationFullRun(client, queryId, engineOptionsFor(engineVersion));
}

/**
 * The catalog's content version (Decision 47), re-exported from the engine's
 * `query/` barrel at the API's single engine boundary.
 *
 * It is NOT wrapped, and deliberately so: the engine's `catalogVersion` throws
 * when the database cannot produce a digest, and what that failure MEANS is an
 * API policy decision, not an engine one - `useCaseVocabulary` above returns
 * NULL for the same reason, and each route decides whether a missing value is
 * fatal (the vocabulary: yes, 503) or a degradation (the catalog version: yes,
 * reuse off). A catch here would have to guess, and would also hide a genuine
 * wiring error - the route checks the function exists before calling it.
 *
 * It issues one read-only `SELECT` and writes nothing, so it is safe to call on
 * the connection the POST has already checked out.
 */
const catalogVersion = query.catalogVersion;

/**
 * The engine's GPU spend multiplier for a resolution (Decision 39), forwarded
 * from the retention barrel.
 *
 * `apps/api/src/inputs.js` needs this ONE number to state truthfully whether
 * `resolution` changed this pass: at 1.0 the GPU target is identical to the one
 * an omitted resolution produces, which is a different fact from "the target
 * moved". Re-exporting the engine's function (rather than a copy of its table)
 * is what keeps the served claim and the arithmetic that produced the build on
 * one owner - a second table here would let a client be told about a multiplier
 * retention never used. It is NOT wrapped: `inputs.js` handles a throw as
 * UNKNOWN, because a stored value outside the vocabulary is a row fact the API
 * must report rather than crash on.
 */
const resolutionMultiplier = retention.resolutionMultiplier;

/**
 * The component-role vocabulary the catalog's `role` filter accepts, in the
 * `component_role` enum's declaration order.
 *
 * It is read from the candidates barrel rather than restated in `meta.js` for
 * the reason Decision 37 gives about use cases: a role list that lived in two
 * places would let the API accept a filter value the engine has no category for
 * (or hide one it does). Frozen by the engine - do not mutate it here.
 *
 * @returns {readonly string[]} the nine component roles
 */
function catalogRoles() {
  return candidates.COMPONENT_ROLES;
}

/**
 * The `product_category` a role must come from, or null for an unknown role.
 *
 * The catalog filter is expressed in ROLES and applied in CATEGORIES because
 * the engine's vocabulary maps many-to-one (RAM -> MEMORY, SSD_BOOT and
 * SSD_SECONDARY -> STORAGE): a client asks for the thing it builds with, and
 * the database filters on the thing it derives. Null is the caller's 422 cue.
 *
 * @param {string} role a `component_role` value
 * @returns {string|null} a `product_category` value, or null
 */
function categoryForRole(role) {
  return candidates.expectedCategoryForRole(role);
}

/**
 * ONE read-only hypothetical swap against a persisted build (Decision 55 item
 * 4), forwarded from the orchestrator barrel by identity.
 *
 * NOT wrapped, for the reason `catalogVersion` is not: composing loaders plus
 * pure stages is orchestrator work, and the HTTP layer's job is only to say
 * what the answer means. The route supplies the persisted component IDENTITIES
 * (which it read through the repository) and the candidate the client asked
 * for; the engine decides eligibility, compatibility and price.
 *
 * `options` is deliberately absent: the API's fixed `API_ENGINE_OPTIONS` (the
 * Decision 35 seed waiver) is what every pass runs with, and a preview that
 * priced a seed offer differently from the pass it previews would be the exact
 * disagreement Decision 55 item 4 forbids. The composition takes it from the
 * caller's options object, and `swapPreviewArgs` below supplies it.
 */
const evaluateSwapPreviewSnapshot = orchestrator.evaluateSwapPreviewSnapshot;

/**
 * The argument object one preview runs with: the caller's fields plus the API's
 * fixed engine options, so eligibility is judged by the same rules a pass uses.
 *
 * @param {object} request { queryId, role, productId, productVariantId,
 *        buildComponents }
 * @returns {object} the orchestrator's argument object, frozen
 */
function swapPreviewArgs(request) {
  return Object.freeze({
    queryId: request.queryId,
    role: request.role,
    productId: request.productId,
    productVariantId: request.productVariantId === undefined ? null : request.productVariantId,
    buildComponents: request.buildComponents,
    options: API_ENGINE_OPTIONS,
  });
}

/**
 * The eight swappable component roles, in assembly's traversal order.
 *
 * Read from the ASSEMBLY barrel rather than restated in the route for the
 * reason Decision 37 gives about use cases and Decision 55 item 2 states
 * outright: a role list that lived in two places would let the API accept a
 * swap the engine has no relationship table for (or hide one it does). The
 * array is frozen by the engine - do not mutate it here.
 *
 * @returns {readonly string[]} CPU, MOTHERBOARD, RAM, GPU, PSU, CASE,
 *          CPU_COOLER, SSD_BOOT
 */
function swapPreviewRoles() {
  return assembly.EXPANSION_ORDER;
}

/**
 * ONE committed swap (Decision 56), forwarded from the orchestrator barrel by
 * identity - the same reasoning as `evaluateSwapPreviewSnapshot`: the commit
 * asks the preview's composition, scores under the pass's own pinned model and
 * owns its write transaction, and none of that is HTTP work.
 */
const commitSwapInTransaction = orchestrator.commitSwapInTransaction;

/**
 * The committed swap of one result, if there is one: one read-only statement.
 *
 * Read through the engine rather than the repository because the table's only
 * reader and its only writer are the same module (`orchestrator/swap-commit`),
 * and splitting them would let the pre-check and the insert disagree about
 * what "already committed" means.
 */
const readCommittedSwap = orchestrator.readCommittedSwap;

/**
 * The argument object one COMMIT runs with: everything a preview needs, plus
 * the three facts only a write has - the result row it derives from, the
 * persisted total whose arithmetic the response must share, and the provenance
 * labels stored beside the rows.
 *
 * `options` is the API's fixed `API_ENGINE_OPTIONS` for the same reason
 * `swapPreviewArgs` sets it: a commit must judge eligibility exactly as the
 * preview the reader approved did.
 *
 * @param {object} request { queryId, sourceResultId, role, productId,
 *        productVariantId, buildComponents, persistedTotalPrice, catalogVersion,
 *        engineVersion }
 * @returns {object} the orchestrator's argument object, frozen
 */
function commitSwapArgs(request) {
  return Object.freeze({
    queryId: request.queryId,
    sourceResultId: request.sourceResultId,
    role: request.role,
    productId: request.productId,
    productVariantId: request.productVariantId === undefined ? null : request.productVariantId,
    buildComponents: request.buildComponents,
    persistedTotalPrice: request.persistedTotalPrice,
    catalogVersion: request.catalogVersion === undefined ? null : request.catalogVersion,
    engineVersion: request.engineVersion === undefined ? null : request.engineVersion,
    options: API_ENGINE_OPTIONS,
  });
}

module.exports = {
  runFullRun,
  engineOptionsFor,
  useCaseVocabulary,
  catalogVersion,
  catalogRoles,
  categoryForRole,
  resolutionMultiplier,
  evaluateSwapPreviewSnapshot,
  swapPreviewArgs,
  swapPreviewRoles,
  commitSwapInTransaction,
  commitSwapArgs,
  readCommittedSwap,
  API_ENGINE_OPTIONS,
  ERROR_CODES: candidates.ERROR_CODES,
  CandidateSelectionError: candidates.CandidateSelectionError,
};
