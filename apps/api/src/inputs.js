'use strict';

/**
 * apps/api/src/inputs.js - what each accepted input actually CHANGED.
 *
 * Boundary: a PURE module. No database access, no clock, no I/O, no engine
 * import, and no second copy of the resolution table - the multiplier is
 * injected by the caller (`engine.js` forwards the retention barrel's own
 * `resolutionMultiplier`), so the number a client is told about and the number
 * retention multiplied by cannot drift apart.
 *
 * Why this exists. Before 2026-10-24 the API accepted `use_case`, `resolution`
 * and `priority`, stored all three, and said nothing about their effect. The
 * docs called resolution and priority "inert" (OG-38, Decision 17.6, Decision 36
 * item 8), which stopped being true on 2026-10-09 when ranking began reading
 * priority (Decision 41) and on 2026-10-14 when retention began scaling the GPU
 * target by resolution (Decision 39) and assembly began reading a declared VRAM
 * floor (Decision 42). The honest position is neither "inert" nor "applied": each
 * input is READ, and whether reading it changed anything is a fact about THIS
 * pass. Two questions are therefore answered separately:
 *
 *   1. `inputsApplied()` - a deployment fact. Which inputs does the active
 *      scoring model's configuration give a reader at all? Served on
 *      GET /v1/meta/options as `inputs_applied`, and it is what the wizard uses
 *      to stop ASKING a question nothing downstream reads
 *      (`apps/web/lib/wizard/applied.ts` already implements that gate).
 *   2. `inputEffects()` - a per-pass fact, served on the recommendation response
 *      as `input_effects`. It is derived from the PERSISTED rows of that pass
 *      (the query's own `use_case` / `resolution` / `priority`, the model
 *      configuration the row pinned, and the builds' `strategy_key`s), so POST
 *      and GET answer it identically and a revisit cannot invent a claim the
 *      engine never made.
 *
 * The vocabulary is deliberately small, and each value is a statement about this
 * pass, not a promise about the product:
 *
 *   APPLIED    the input was read AND it shaped this pass: it selected a
 *              declared policy/profile, scaled the GPU spend target away from
 *              neutral, selected a declared VRAM floor, or selected a
 *              NON-DEFAULT archetype order. It does NOT
 *              claim the top build
 *              would have differed - no persisted counterfactual exists, and
 *              claiming one is the lie this module exists to avoid.
 *   NO_EFFECT  provably could not change this pass, with the proof named by
 *              `reason`: the input was not provided, the neutral multiplier was
 *              used, the model declares no reader for it, or the pass assembled
 *              no build for priority to order. `priority` 3 lands here too: its
 *              order IS the omitted-input order, so no choice was made.
 *   UNKNOWN    the facts needed to say either way were not recorded (a legacy
 *              row with no model configuration, an unrecognised value). NULL
 *              means UNKNOWN in this project; UNKNOWN is never reported as
 *              APPLIED or NO_EFFECT.
 *
 * `NO_EFFECT` and `UNKNOWN` are therefore different facts and must not collapse
 * into each other - the same three-valued discipline as `applied.ts` and
 * `lib/result/reasons.ts` on the web side.
 *
 * The reasons are a closed list for the writers in this repository, but the
 * WIRE contract types `reason` as a plain string: the effect vocabulary is the
 * promise a client may switch on, while a reason is an explanation that may grow
 * without breaking a client. A client that does not know a reason must fall back
 * to the effect's generic sentence, never print the raw code (the rule
 * `lib/result/reasons.ts` already states for `reasons[]`).
 */

/** The inputs `inputs_applied` / `input_effects` are about, in served order. */
const INPUTS = Object.freeze(['use_case', 'resolution', 'priority']);

/** The three-valued effect vocabulary (see the header). */
const EFFECTS = Object.freeze(['APPLIED', 'NO_EFFECT', 'UNKNOWN']);

/**
 * The closed reason vocabulary. Every value names the fact that produced it, so
 * a client can render a specific sentence without reading the engine's enums.
 */
const REASONS = Object.freeze([
  // use_case
  'USE_CASE_PROFILE', // a declared use_case_profiles entry was selected
  'GPU_POLICY_ONLY', // no profile; only the legacy gpu_required_use_cases list was consulted
  // resolution
  'VRAM_FLOOR', // a declared resolution_profiles entry selected a VRAM floor
  'GPU_TARGET_SCALED', // the GPU spend target was multiplied by a non-neutral factor
  'NEUTRAL_MULTIPLIER', // the multiplier for this resolution is exactly 1.0
  'NO_GPU_TARGET', // the selected profile declares no GPU spend target (or a zero share)
  'NO_RESOLUTION_POLICY', // the model declares no per-resolution read at all
  // priority
  'STRATEGY_ORDER', // the priority selected a NON-DEFAULT archetype order
  'DEFAULT_ORDER', // the stored value IS the order an omitted input produces
  'NO_BUILDS', // nothing was returned for it to order
  // shared
  'NOT_PROVIDED', // the request omitted the optional input
  'NOT_RECORDED', // the pass did not record what the answer needs (or the model row is gone)
  'UNRECOGNISED_VALUE', // a stored value outside the accepted vocabulary
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** A finite share in [0, 1], or null. Mirrors the engine's spend_targets rule. */
function shareOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/** The declared use-case profile for `useCase`, or null. */
function profileFor(configuration, useCase) {
  if (!isPlainObject(configuration) || typeof useCase !== 'string') {
    return null;
  }
  const profiles = configuration.use_case_profiles;
  if (!isPlainObject(profiles) || !hasOwn(profiles, useCase)) {
    return null;
  }
  const profile = profiles[useCase];
  return isPlainObject(profile) ? profile : null;
}

/** The declared VRAM floor for `resolution` (integer >= 1), or null. */
function vramFloorFor(configuration, resolution) {
  if (!isPlainObject(configuration) || typeof resolution !== 'string') {
    return null;
  }
  const profiles = configuration.resolution_profiles;
  if (!isPlainObject(profiles) || !hasOwn(profiles, resolution)) {
    return null;
  }
  const profile = profiles[resolution];
  if (!isPlainObject(profile)) {
    return null;
  }
  const floor = profile.vram_floor_gb;
  return typeof floor === 'number' && Number.isInteger(floor) && floor >= 1 ? floor : null;
}

/**
 * Which inputs the model's configuration gives a READER at all.
 *
 *   use_case   always: either a declared `use_case_profiles` entry (Decision 37)
 *              or the legacy `gpu_required_use_cases` list (Decision 43) is
 *              consulted, and one of the two is what the vocabulary itself comes
 *              from.
 *   priority   always: `ranking/select-archetypes.js` consumes it on every pass
 *              (Decision 41), with the default order for an omitted value.
 *   resolution only when something can read it: a declared per-resolution VRAM
 *              floor (Decision 42) or a declared GPU spend target (Decision 39).
 *              The share must be POSITIVE: `0 x multiplier` is 0, so a profile
 *              targeting nothing on the GPU cannot read the resolution at all.
 *              A model declaring neither - including the retained legacy
 *              `seed-minimal-v1` - has NO reader, so the wizard must stop asking
 *              (CD-1).
 *
 * @param {object} sources
 * @param {object|null|undefined} sources.configuration a scoring-model configuration
 * @returns {string[]} frozen subset of INPUTS, in served order
 */
function inputsApplied(sources) {
  const configuration = isPlainObject(sources) ? sources.configuration : undefined;
  const applied = ['use_case', 'priority'];

  let resolutionIsRead = false;
  if (isPlainObject(configuration)) {
    if (isPlainObject(configuration.resolution_profiles)
        && Object.keys(configuration.resolution_profiles).length > 0) {
      resolutionIsRead = true;
    }
    if (isPlainObject(configuration.use_case_profiles)) {
      for (const useCase of Object.keys(configuration.use_case_profiles)) {
        const profile = configuration.use_case_profiles[useCase];
        // A ZERO share is not a reader: the multiplier scales the GPU target,
        // and 0 x any multiplier is 0, so resolution provably changes nothing.
        // Advertising it would have the wizard ask a question with no effect.
        if (isPlainObject(profile)
            && isPlainObject(profile.spend_targets)
            && shareOrNull(profile.spend_targets.GPU) > 0) {
          resolutionIsRead = true;
          break;
        }
      }
    }
  }
  if (resolutionIsRead) {
    // Keep the served order stable regardless of the derivation's order.
    applied.splice(1, 0, 'resolution');
  }
  return Object.freeze(INPUTS.filter((input) => applied.includes(input)));
}

/** One frozen effect record. */
function effect(input, effect, reason) {
  if (!INPUTS.includes(input) || !EFFECTS.includes(effect) || !REASONS.includes(reason)) {
    // Unreachable by construction; throwing beats serving a code a client cannot
    // explain, and the unit suite pins every member of all three vocabularies.
    throw new Error('input effect out of vocabulary: ' + input + '/' + effect + '/' + reason);
  }
  return Object.freeze({ input, effect, reason });
}

/**
 * The effect of `use_case` on this pass.
 *
 * A declared profile is the stronger fact: `gpu_policy` decides whether a GPU is
 * required (Decision 43) and `spend_targets` becomes the per-role price targets
 * (Decision 39), so the input shaped assembly and retention. Without a profile
 * the legacy list still decides the GPU requirement, which is a reader too - just
 * a narrower one. A configuration that is neither (a legacy row whose model row
 * is gone) is UNKNOWN, never `NO_EFFECT`.
 */
function useCaseEffect(configuration, useCase) {
  if (profileFor(configuration, useCase) !== null) {
    return effect('use_case', 'APPLIED', 'USE_CASE_PROFILE');
  }
  if (isPlainObject(configuration) && Array.isArray(configuration.gpu_required_use_cases)) {
    return effect('use_case', 'APPLIED', 'GPU_POLICY_ONLY');
  }
  return effect('use_case', 'UNKNOWN', 'NOT_RECORDED');
}

/**
 * The effect of `resolution` on this pass.
 *
 * Order matters: a declared VRAM floor is a hard filter on GPU depth and is the
 * strongest per-resolution fact, so it wins over the spend multiplier when a
 * model declares both. The multiplier claim is exact for the arithmetic it
 * describes: at 1.0 the GPU target is byte-identical to the target an omitted
 * resolution produces, which is why that is `NO_EFFECT` rather than a weak
 * `APPLIED`.
 */
function resolutionEffect(configuration, useCase, resolution, resolutionMultiplier) {
  if (resolution === null || resolution === undefined || resolution === '') {
    return effect('resolution', 'NO_EFFECT', 'NOT_PROVIDED');
  }
  if (!isPlainObject(configuration)) {
    return effect('resolution', 'UNKNOWN', 'NOT_RECORDED');
  }
  if (typeof resolution !== 'string') {
    return effect('resolution', 'UNKNOWN', 'UNRECOGNISED_VALUE');
  }

  if (vramFloorFor(configuration, resolution) !== null) {
    return effect('resolution', 'APPLIED', 'VRAM_FLOOR');
  }

  const profile = profileFor(configuration, useCase);
  const gpuShare = profile === null || !isPlainObject(profile.spend_targets)
    ? null
    : shareOrNull(profile.spend_targets.GPU);

  if (gpuShare === null || gpuShare === 0) {
    // No GPU spend target to scale (absent, or a declared zero share - 0 x any
    // multiplier is 0): the only possible reader left is the VRAM floor, which
    // this model does not declare for this resolution.
    return profile === null
      ? effect('resolution', 'NO_EFFECT', 'NO_RESOLUTION_POLICY')
      : effect('resolution', 'NO_EFFECT', 'NO_GPU_TARGET');
  }

  // The engine's multiplier is the ONE table: a stored value it refuses is a
  // value outside the accepted vocabulary, which is UNKNOWN (never a silent
  // 1.0, and never an `APPLIED` claim about arithmetic that did not happen).
  if (typeof resolutionMultiplier !== 'function') {
    return effect('resolution', 'UNKNOWN', 'NOT_RECORDED');
  }
  let multiplier;
  try {
    multiplier = resolutionMultiplier(resolution);
  } catch (_error) {
    return effect('resolution', 'UNKNOWN', 'UNRECOGNISED_VALUE');
  }
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
    return effect('resolution', 'UNKNOWN', 'NOT_RECORDED');
  }
  return multiplier === 1
    ? effect('resolution', 'NO_EFFECT', 'NEUTRAL_MULTIPLIER')
    : effect('resolution', 'APPLIED', 'GPU_TARGET_SCALED');
}

/**
 * The effect of `priority` on this pass.
 *
 * `ranking/select-archetypes.js` walks the strategies in the order the value
 * names and each pick claims a (CPU, GPU) pair, so priority decides BOTH the
 * order of the returned archetypes and which strategy gets first pick on a pair.
 * That is why an omitted value is `NO_EFFECT`/`NOT_PROVIDED` (the default order
 * ran, but nothing the caller chose did) while a provided one that produced no
 * build has nothing to order. A pass whose builds DID come back but whose
 * `strategy_key`s were not recorded (a pre-019 result row) is `UNKNOWN`: the
 * order it produced is not readable, which is a different fact from "no
 * builds" and must not borrow that reason.
 *
 * 3 is deliberately NOT `APPLIED`. `strategyOrder(3)` is exactly
 * `strategyOrder(null)` - the same three picks in the same order, therefore the
 * same claims and the same builds - so a user who chose "balanced" would be
 * told their choice did something it provably did not. It is the same proof as
 * 1080p's neutral multiplier, and the same vocabulary answer: `NO_EFFECT` with
 * the reason naming the proof.
 */
function priorityEffect(priority, strategyKeys) {
  if (priority === null || priority === undefined) {
    return effect('priority', 'NO_EFFECT', 'NOT_PROVIDED');
  }
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
    return effect('priority', 'UNKNOWN', 'UNRECOGNISED_VALUE');
  }
  if (!Array.isArray(strategyKeys)) {
    return effect('priority', 'UNKNOWN', 'NOT_RECORDED');
  }
  if (strategyKeys.length === 0) {
    return effect('priority', 'NO_EFFECT', 'NO_BUILDS');
  }
  // Provable regardless of what came back: `strategyOrder(3)` IS the omitted
  // case, so this pass ran the order an absent priority runs.
  if (priority === 3) {
    return effect('priority', 'NO_EFFECT', 'DEFAULT_ORDER');
  }
  // Builds exist but their strategy is not recorded, so the order they came
  // back in cannot be attributed. UNKNOWN - never NO_BUILDS (builds DID come
  // back) and never APPLIED (the order was not read).
  if (!strategyKeys.every((key) => typeof key === 'string' && key.length > 0)) {
    return effect('priority', 'UNKNOWN', 'NOT_RECORDED');
  }
  return effect('priority', 'APPLIED', 'STRATEGY_ORDER');
}

/**
 * Every input's effect on one pass, in served order.
 *
 * @param {object} sources
 * @param {object|null|undefined} sources.configuration the configuration of the
 *        model THIS pass pinned (`recommendation_query.scoring_model_id`)
 * @param {string|null|undefined} sources.useCase the query's stored use_case
 * @param {string|null|undefined} sources.resolution the query's stored resolution
 * @param {number|null|undefined} sources.priority the query's stored priority
 * @param {Array<string|null>} sources.strategyKeys the persisted builds' strategy
 *        keys, one entry per build (`null` on a pre-019 result row)
 * @param {function} [sources.resolutionMultiplier] the engine's own multiplier
 * @returns {object[]} frozen array of three frozen { input, effect, reason }
 */
function inputEffects(sources) {
  const source = isPlainObject(sources) ? sources : {};
  // Kept UNFILTERED: the array's LENGTH is "how many builds came back", which
  // is what separates NO_BUILDS from NOT_RECORDED (a build with a null key).
  const strategyKeys = Array.isArray(source.strategyKeys) ? source.strategyKeys : null;

  return Object.freeze([
    useCaseEffect(source.configuration, source.useCase),
    resolutionEffect(source.configuration, source.useCase, source.resolution, source.resolutionMultiplier),
    priorityEffect(source.priority, strategyKeys),
  ]);
}

module.exports = {
  INPUTS,
  EFFECTS,
  REASONS,
  inputsApplied,
  inputEffects,
};
