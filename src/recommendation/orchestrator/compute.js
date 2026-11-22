'use strict';

/**
 * Decision 17.3 - the pure assemble-and-score seam of one recommendation pass.
 *
 * Boundary: everything behind `computeFromLoaded` is PURE. It reads no clock,
 * no environment, no database and no randomness; it never issues a statement
 * and owns no transaction. `../orchestrator/run.js` keeps every loader call and
 * hands this module the rows those loaders returned, so a pass can be replayed
 * from a text fixture (see compute.golden.test.js and test/golden/fixtures/).
 *
 *   loaded
 *     |  computeCandidateScores({ candidates, assessments, configuration, nowMs })
 *     v
 *   candidateScores { scores }
 *     |  retainTopKPerRole({ filterResult, candidateScores, topKPerRole,
 *     |                      prices, roleTargets, roleExclusions, topKByRole })
 *     |                   Decision 27 + E2 + E6 (Decision 54)
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
 *   build_contributions, budget_floor } - each build is the frozen Engine 3
 *   build (components / total_price / currency / unknown_pairwise_count -
 *   Decision 23's build-local re-evaluation - unchanged and by reference) plus
 *   its own build_score.
 *
 * Collaborators are required as namespace objects and CALLED THROUGH THE
 * NAMESPACE (scoring.computeBuildScores(...), retention.retainTopKPerRole(...)),
 * never destructured, for the same documented reason run.js does it: a test can
 * record call order and object identity with a plain patch + restore.
 *
 * NOT owned here: loading anything, the transaction timestamp, `filterCandidates`
 * (Decision 17.3 keeps it in the orchestrator, immediately after the context
 * load), ranking (Engine 5a), persistence (Engine 5b) and explanation (Engine 6).
 */

const scoring = require('../scoring');
const retention = require('../retention');
const assembly = require('../assembly');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/**
 * Engine 3 builds are deeply frozen, so the score is attached by building a NEW
 * frozen object: the Engine 3 fields travel by reference, nothing is edited.
 */
function withBuildScore(build, buildScore) {
  return Object.freeze({ ...build, build_score: buildScore });
}

/**
 * Compute one pass from already-loaded inputs.
 *
 * @param {object} loaded { query, scoringModel, candidatePoolResult,
 *        filteringContext, filterResult, assessments, nowMs }
 * @param {object} loaded.query the query loader's frozen { query_id,
 *        scoring_model_id, input, resolution, priority }.
 * @param {object} loaded.scoringModel the pinned, validated Decision 11 model.
 * @param {object} loaded.candidatePoolResult Stage 1's frozen
 *        { input, pool, prices } - the ONLY pool source from here on.
 * @param {object} loaded.filteringContext the Engine 2D context, loaded ONCE and
 *        passed BY REFERENCE to both the pure filter (in run.js) and Engine 3.
 * @param {object} loaded.filterResult { results: [PASS|UNKNOWN|REJECT, ...] }.
 * @param {object} loaded.assessments the { [product_id]: rows } map, loaded
 *        ONCE for the Stage 1 pool's product ids.
 * @param {number} loaded.nowMs the single clock of the pass (Decision 17.2/38).
 * @returns {object} the frozen Decision 17.2 result (see the header).
 */
function computeFromLoaded(loaded) {
  const queryInput = loaded.query;
  const scoringModel = loaded.scoringModel;
  const offerResult = loaded.candidatePoolResult;
  const filteringContext = loaded.filteringContext;
  const filterResult = loaded.filterResult;
  const assessments = loaded.assessments;
  const nowMs = loaded.nowMs;

  const configuration = scoringModel.configuration;

  // 10. Engine 4 STEP 2 over the Stage 1 pool (REJECT verdicts are scored too
  //     and simply ignored by retention).
  const candidateScores = scoring.computeCandidateScores({
    candidates: offerResult.pool,
    assessments,
    configuration,
    nowMs,
  });

  // 11. Retention (Decision 12/14): only THIS run's filterCandidates output, its
  //     STEP 2 scores, and the Decision 11 cap. Decision 27 adds Stage 1's own
  //     carrier BY REFERENCE - the same frozen object Engine 3 gets below - so
  //     the cheapest-per-role reservation needs no query and no new loader.
  // E2: the active model's per-use-case spend targets become per-role price
  // targets. A model that declares no `use_case_profiles`, or no profile for
  // this query's use case, yields null and retention keeps the pre-E2 rule.
  // E6 (Decision 54): the declared per-use-case `gpu_policy` is resolved ONCE,
  // here, because two stages consume it - retention (which CPUs MAY reach the
  // walk) and Engine 3 (the per-CPU GPU decision). A declared IGPU_ALLOWED
  // excludes CPUs with no verified integrated GPU; every other policy returns
  // null, so the pool is unchanged.
  const gpuPolicy = resolveGpuPolicy(configuration, queryInput);
  const excludedCpuIds = retention.excludedCpuProductIds({
    gpuPolicy,
    filteringContext,
  });
  const retentionResult = retention.retainTopKPerRole({
    filterResult,
    candidateScores,
    topKPerRole: configuration.candidate_caps.top_k_per_role,
    prices: offerResult.prices,
    roleTargets: resolveRoleTargets(configuration, queryInput),
    roleExclusions: excludedCpuIds === null ? null : { CPU: excludedCpuIds },
    // Decision 59: the OPTIONAL per-role depth override. Absent on every model
    // that does not declare it, so the uniform-K behaviour is byte-identical;
    // `?? null` (never `?? undefined`) because retention's default names an
    // explicit null and a validated map can never BE null.
    topKByRole: configuration.candidate_caps.top_k_by_role ?? null,
  });

  // 11b. Decision 27: the zero-build diagnostic. Pure, and computed
  //     UNCONDITIONALLY - never gated on the build count. A build-free budget is
  //     a valid outcome (Decision 17.2); this is what makes it an explained one
  //     rather than a silent one. It is a pure call, not a stage, so it is not
  //     part of the Decision 17.3 call-order contract.
  const budgetFloor = retention.computeBudgetFloor({
    retained: retentionResult.results,
    prices: offerResult.prices,
    budgetAmount: queryInput.input.budget_amount,
    currency: queryInput.input.currency,
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
    // E5 (Decision 42): the resolved VRAM floor (integer) or null; Engine 3
    // receives the floor as policy input and owns the GPU-depth enforcement.
    vramFloorGb: resolveVramFloorGb(configuration, queryInput),
    // E6 (Decision 43): the SAME resolved policy retention consumed above;
    // Engine 3 owns the per-CPU Step 3 decision. Re-resolving here would be a
    // second reader of the same configuration for no reason.
    gpuPolicy,
  });

  // 13. Engine 4 STEP 3 (index-aligned with the builds in discovery order; the
  //     Decision 23 build-local UNKNOWN count is read per build).
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

  // 13b. Decision 22 item 1/3 enabling step: the per-(role,type) inputs that
  //      produced each build_score, same arguments, same discovery order, ONE
  //      extra pure call. Additive only - the builds above are untouched and
  //      nothing else in this pass consumes the result (Engine 6 does).
  const buildContributions = scoring.computeBuildScoreContributions({
    builds: assemblyResult.builds,
    assessments,
    configuration,
    nowMs,
  });
  if (buildContributions.contributions.length !== assemblyResult.builds.length) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'buildContributions',
      'build score contributions must stay index-aligned with the assembled builds'
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
    // E4 (Decision 41): carried VERBATIM as a sibling (same pattern as E2's
    // resolution); only the archetype selection reads it.
    priority: queryInput.priority,
    // Decision 58: the use case's archetype weights, or null when the model
    // does not opt in. Only the archetype selection reads this one either.
    archetype_objectives: resolveArchetypeObjectives(configuration, queryInput),
    build_contributions: buildContributions.contributions,
    // Decision 27: last, so the two index-aligned fields stay adjacent.
    budget_floor: budgetFloor,
    // OG-04: this run's Engine 2D candidate verdicts, passed through by
    // reference and never re-derived. They are what persistRejections reads
    // to record WHY a candidate was rejected. Additive field: budget_floor
    // above deliberately stays last-in-spirit among the Decision 27 pair, and
    // no existing consumer reads this one yet.
    filter_verdicts: filterResult.results,
  });
}

/**
 * E6 (Decision 43): the per-use-case GPU policy for this pass, or null.
 * Reads the ACTIVE model's `use_case_profiles[queryInput.input.use_case]`
 * (Decision 37; the same shape-guard pattern as resolveVramFloorGb below) - a model
 * that declares no profile for the use case yields null and Step 3 keeps
 * the legacy gpu_required_use_cases rule byte-identically (pre-E6).
 */
function resolveGpuPolicy(configuration, queryInput) {
  const profiles = configuration === null || typeof configuration !== 'object'
    ? undefined
    : configuration.use_case_profiles;
  if (profiles === null || typeof profiles !== 'object' || Array.isArray(profiles)) {
    return null;
  }
  const profile = profiles[queryInput.input.use_case];
  if (profile === null || typeof profile !== 'object') {
    return null;
  }
  const policy = profile.gpu_policy;
  return policy === 'REQUIRED' || policy === 'IGPU_ALLOWED' ? policy : null;
}

/**
 * E2: per-role price targets for this pass, or null.
 *
 * Reads the ACTIVE model's `use_case_profiles[queryInput.input.use_case]`
 * (Decision 37). `use_case_profiles` is an OPTIONAL configuration key and a
 * model may declare only some use cases, so a missing key - or a use case the
 * model does not declare - yields null and retention keeps the pre-E2 rule
 * byte-for-byte. The profile shape itself is already validated by
 * validateScoringModelConfiguration at load time; this only routes it.
 */
function resolveRoleTargets(configuration, queryInput) {
  const profiles = configuration === null || typeof configuration !== 'object'
    ? undefined
    : configuration.use_case_profiles;
  if (profiles === null || typeof profiles !== 'object' || Array.isArray(profiles)) {
    return null;
  }
  const profile = profiles[queryInput.input.use_case];
  if (profile === null || typeof profile !== 'object'
      || profile.spend_targets === null || typeof profile.spend_targets !== 'object') {
    return null;
  }
  return retention.computeRoleTargets({
    spendTargets: profile.spend_targets,
    budgetAmount: queryInput.input.budget_amount,
    resolution: queryInput.resolution,
  });
}

/**
 * Decision 58: the per-use-case archetype weights for this pass, or null.
 *
 * Reads the ACTIVE model's `use_case_profiles[queryInput.input.use_case]
 * .archetype_objectives` ONLY when the model opts in with
 * `apply_archetype_objectives: true`. The flag is what keeps a version bump
 * meaningful: a model that declares the objectives but not the flag keeps the
 * pre-Decision-58 `priority`-only order, so an older pinned version cannot
 * silently start meaning something else. The profile shape is already
 * validated by validateScoringModelConfiguration at load time; this only
 * routes it.
 */
function resolveArchetypeObjectives(configuration, queryInput) {
  if (configuration === null || typeof configuration !== 'object') {
    return null;
  }
  if (configuration.apply_archetype_objectives !== true) {
    return null;
  }
  const profiles = configuration.use_case_profiles;
  if (profiles === null || typeof profiles !== 'object' || Array.isArray(profiles)) {
    return null;
  }
  const profile = profiles[queryInput.input.use_case];
  if (profile === null || typeof profile !== 'object') {
    return null;
  }
  const objectives = profile.archetype_objectives;
  if (objectives === null || typeof objectives !== 'object' || Array.isArray(objectives)) {
    return null;
  }
  return objectives;
}

/**
 * E5 (Decision 42): the resolution VRAM floor for this pass, or null.
 *
 * Reads the ACTIVE model's `resolution_profiles[queryInput.resolution]`
 * (Decision 42; the Decision 37 optional-key family). `resolution_profiles` is
 * OPTIONAL and a model may declare only some resolutions, so a missing key -
 * or a resolution the model does not declare - yields null and the GPU-depth
 * floor check stays off (pre-E5 behaviour, byte-identical). The profile shape
 * is already validated by validateScoringModelConfiguration at load time; this
 * only routes it. An absent/NULL query resolution yields null (no floor).
 */
function resolveVramFloorGb(configuration, queryInput) {
  const profiles = configuration === null || typeof configuration !== 'object'
    ? undefined
    : configuration.resolution_profiles;
  if (profiles === null || typeof profiles !== 'object' || Array.isArray(profiles)) {
    return null;
  }
  const profile = profiles[queryInput.resolution];
  if (profile === null || typeof profile !== 'object') {
    return null;
  }
  const floor = profile.vram_floor_gb;
  return typeof floor === 'number' && Number.isInteger(floor) && floor >= 1 ? floor : null;
}

module.exports = {
  computeFromLoaded,
  // Exported so the golden test can pin the four derivations the result does
  // not carry separately (E6 policy, E2 targets, E5 floor, Decision 58
  // objectives) against the values the live run actually used.
  resolveGpuPolicy,
  resolveRoleTargets,
  resolveArchetypeObjectives,
  resolveVramFloorGb,
};
