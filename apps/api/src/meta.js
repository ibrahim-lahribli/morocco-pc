'use strict';

/**
 * apps/api/src/meta.js - the HTTP API's option vocabulary (Decision 36).
 *
 * Boundary: a PURE module. No database access, no clock, no I/O. It turns the
 * active scoring model's configuration into the `{ value, label }` option
 * lists GET /v1/meta/options serves, and it is the single owner of the
 * accepted-value vocabulary the POST body is validated against.
 *
 * Why this module exists as the owner (Decision 36 item 3): the frontend must
 * never imply that a value changes a result. `resolution` and `priority` are
 * accepted, persisted on the profile/query row, and deliberately NOT read by
 * the engine (Decision 17.6 - `loadQueryInput` does not even SELECT them), so
 * they are documented as "stored, not yet used in scoring". The option list and
 * the validator live here together so they cannot drift apart: a value that POST
 * accepts is always present in /v1/meta/options, and `meta-consistency.test.js`
 * pins exactly that.
 *
 * use_case is DERIVED, never enumerated twice: it comes ONLY from the active
 * scoring model's `configuration.gpu_required_use_cases`. There is no DISTINCT
 * over user-submitted values and no hardcoded second list, so a scoring-model
 * change is the only thing that can change the accepted use cases. When the
 * configuration cannot be read, the ROUTE answers 503 - this module never
 * fabricates an empty list (Decision 36 item 3).
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

/** Display resolutions. STORED on the profile, NOT yet used in scoring. */
const RESOLUTIONS = Object.freeze([
  Object.freeze({ value: '1080p', label: 'Full HD (1080p)' }),
  Object.freeze({ value: '1440p', label: 'QHD (1440p)' }),
  Object.freeze({ value: '2160p', label: '4K UHD (2160p)' }),
]);

/** Weighting priorities, 1 (price first) to 5 (performance first). NOT used in scoring. */
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
 * Build the use-case option list from a validated scoring-model configuration.
 * `gpu_required_use_cases` is the ONLY source. Absent/malformed configuration
 * yields an empty list - the caller (the meta route) must treat that as a
 * 503-worthy state rather than serving an empty array.
 */
function useCaseOptions(configuration) {
  const raw = configuration !== null && typeof configuration === 'object'
    ? configuration.gpu_required_use_cases
    : null;
  const values = Array.isArray(raw) ? raw : [];
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

/** The accepted use_case values, in configuration order. */
function useCaseValues(configuration) {
  return useCaseOptions(configuration).map((option) => option.value);
}

/** The complete /v1/meta/options payload. */
function buildOptions(configuration) {
  return Object.freeze({
    use_cases: useCaseOptions(configuration),
    currencies: CURRENCIES,
    resolutions: RESOLUTIONS,
    priorities: PRIORITIES,
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

function isAllowedUseCase(value, configuration) {
  return useCaseValues(configuration).includes(value);
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
