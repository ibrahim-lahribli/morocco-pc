'use strict';

/**
 * apps/api/src/meta.js - the HTTP API's option vocabulary (Decision 36).
 *
 * Boundary: a PURE module. No database access, no clock, no I/O, and - since
 * the vocabulary moved to the scoring model (Decision 37) - no knowledge of
 * the engine either. It turns the use-case values its caller derived into the
 * `{ value, label }` option lists GET /v1/meta/options serves, and it is the
 * single owner of the accepted-value vocabulary the POST body is validated
 * against.
 *
 * Why this module exists as the owner (Decision 36 item 3): the frontend must
 * never promise that a value changes a result. `resolution` and `priority` are
 * accepted and persisted on the profile/query row, and both ARE read - by
 * retention (Decision 39's GPU spend multiplier, Decision 42's VRAM floor) and
 * by ranking (Decision 41's archetype order) respectively - but neither changes
 * a score, so the labels say what the value DOES and never that it improves the
 * build. Until 2026-10-23 this header claimed `loadQueryInput` did not even
 * SELECT them (Decision 17.6); that had been false since 2026-10-09. See
 * `inputs.js` for the vocabulary that answers the harder question - whether a
 * given pass read the value at all - and Decision 52 for the full semantics.
 *
 * The option list and the validator live here together so they cannot drift
 * apart: a value that POST accepts is always present in /v1/meta/options, and
 * `meta-consistency.test.js` pins exactly that.
 *
 * use_case is DERIVED, never enumerated twice, and this module no longer does
 * the deriving: the values are HANDED IN by the caller, which gets them from
 * the engine's `listUseCases` through `engine.js` (Decision 37 / OG-38). There
 * is no DISTINCT over user-submitted values and no hardcoded second list -
 * this module's whole contribution is collapsing duplicates and attaching the
 * French label, so a scoring-model change remains the only thing that can
 * change the accepted use cases. A caller that hands in NULL has no
 * vocabulary at all (UNKNOWN, never an empty list) and the ROUTE answers 503;
 * `useCaseOptions` treats a non-array as an empty list, so it must never be
 * given one (Decision 36 item 3).
 *
 * currency is a fixed allow-list (MAD), NOT a DISTINCT over `store_offer`: the
 * engine's Stage 1 matches currency by exact equality, so an ingested offer in
 * another currency would not be selectable anyway and advertising it would be a
 * lie. `recommendation_query.currency` is free TEXT in the schema; the API
 * deliberately narrows it to the currencies the catalog is priced in.
 *
 * Labels are FRENCH - the product is the Moroccan market. The label map is a
 * presentation concern only: an unknown but real use-case value falls back to
 * its own raw string rather than being hidden.
 */

/** French labels for the use-case vocabulary. Fallback is the raw value. */
const USE_CASE_LABELS = Object.freeze({
  GAMING: 'Jeux vidéo',
  WORKSTATION: 'Travail professionnel',
  OFFICE: 'Bureautique',
  STREAMING: 'Diffusion en direct',
  CONTENT_CREATION: 'Création de contenu',
  AI_ML: 'Intelligence artificielle',
});

/** The currencies the API accepts and advertises. MAD only (see header). */
const CURRENCIES = Object.freeze([
  Object.freeze({ value: 'MAD', label: 'Dirham marocain (MAD)' }),
]);

/** Display resolutions. STORED on the profile; scales the GPU retention target and gates the optional per-resolution VRAM floor. Never changes a score. */
const RESOLUTIONS = Object.freeze([
  Object.freeze({ value: '1080p', label: 'Full HD (1080p)' }),
  Object.freeze({ value: '1440p', label: 'QHD (1440p)' }),
  Object.freeze({ value: '2160p', label: '4K UHD (2160p)' }),
]);

/** Weighting priorities, 1 (price first) to 5 (performance first). Decides which strategy gets first pick and the returned archetypes' ORDER (Decision 41); never changes a score. */
const PRIORITIES = Object.freeze([
  Object.freeze({ value: 1, label: 'Prix avant tout' }),
  Object.freeze({ value: 2, label: 'Plutôt le prix' }),
  Object.freeze({ value: 3, label: 'Équilibré' }),
  Object.freeze({ value: 4, label: 'Plutôt la performance' }),
  Object.freeze({ value: 5, label: 'Performance avant tout' }),
]);

function labelFor(map, value) {
  return Object.prototype.hasOwnProperty.call(map, value) ? map[value] : value;
}

/**
 * Build the use-case option list from the vocabulary the caller derived.
 *
 * @param {string[]} useCases values from the engine's `listUseCases`
 * @returns {object[]} frozen `{ value, label }` options, in declared order
 */
function useCaseOptions(useCases) {
  const values = Array.isArray(useCases) ? useCases : [];
  const seen = new Set();
  const options = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push(Object.freeze({ value, label: labelFor(USE_CASE_LABELS, value) }));
  }
  return Object.freeze(options);
}

/**
 * The accepted use_case values, in the order the engine reported them. A JSONB
 * `use_case_profiles` value is stored in jsonb's own key order, so the
 * advertised order follows the data, not the seed file.
 */
function useCaseValues(useCases) {
  return useCaseOptions(useCases).map((option) => option.value);
}

/**
 * The complete /v1/meta/options payload.
 *
 * `inputs_applied` is the DEPLOYMENT half of Decision 52's contract: which of
 * `use_case` / `resolution` / `priority` the ACTIVE model gives a reader at all.
 * It is a plain string list (not the per-pass `input_effects` shape) because
 * that is what a form needs - an input the list does not name is not asked, and
 * `apps/web/lib/wizard/applied.ts` already implements that gate, including the
 * distinction between "the contract is silent" (null) and "the contract named
 * nothing" (an empty list).
 *
 * It is a PARAMETER, not derived here: the reader depends on the scoring
 * model's configuration, which this module never sees, and `inputs.js` is the
 * single owner of the derivation.
 *
 * @param {string[]} useCases values from the engine's `listUseCases`
 * @param {string[]} inputsApplied subset of `inputs.INPUTS` in served order
 */
function buildOptions(useCases, inputsApplied) {
  return Object.freeze({
    use_cases: useCaseOptions(useCases),
    currencies: CURRENCIES,
    resolutions: RESOLUTIONS,
    priorities: PRIORITIES,
    inputs_applied: Object.freeze(Array.isArray(inputsApplied) ? inputsApplied.slice() : []),
  });
}

function isAllowedCurrency(value) {
  return CURRENCIES.some((option) => option.value === value);
}

function isAllowedResolution(value) {
  return RESOLUTIONS.some((option) => option.value === value);
}

function isAllowedPriority(value) {
  return PRIORITIES.some((option) => option.value === value);
}

function isAllowedUseCase(value, useCases) {
  return useCaseValues(useCases).includes(value);
}

module.exports = {
  USE_CASE_LABELS,
  CURRENCIES,
  RESOLUTIONS,
  PRIORITIES,
  useCaseOptions,
  useCaseValues,
  buildOptions,
  isAllowedCurrency,
  isAllowedResolution,
  isAllowedPriority,
  isAllowedUseCase,
};
