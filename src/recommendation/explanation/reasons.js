/**
 * Engine 6 - structured reason codes (E7).
 *
 * Pure, framework-free, DB-free: deriveReasons(...) turns one build plus the
 * facts that shaped it into an ordered list of structured codes. The existing
 * `explanation` STRING (./explain.js) is unchanged and stays the back-compat
 * surface; these codes are ADDITIVE, machine-readable, and carry the same
 * underlying facts - never a re-derived second opinion.
 *
 *   deriveReasons({ build, contributions, profile, budget, inputs, strategy,
 *                   catalogReasonCodes })
 *     -> deeply frozen Array<frozen { code, value }> in REASON_ORDER
 *
 * REQUIRED: `build`, `budget`.
 * OPTIONAL: `contributions`, `profile`, `inputs`, `strategy`,
 *           `catalogReasonCodes`. Omitting one OMITS ITS CODE - a value is
 *           never invented, and an absent input never throws. That is what lets
 *           ONE function serve both callers below.
 *
 * THE CODES (canonical order = declaration order of REASON_CODES):
 *
 *   STRATEGY               the E4 archetype strategy key, verbatim
 *   BUDGET_USED_PCT        build.total_price / budget.amount * 100 (a
 *                          percentage, unrounded; the name is the Platform
 *                          vocabulary and is kept verbatim)
 *   GPU_SHARE              the GPU component's price / build.total_price (the
 *                          GPU's share of the build total), or null when the
 *                          build carries no GPU role - the E6 iGPU path, which
 *                          is a first-class answer, not a missing value
 *   DOMINANT_ROLE          the role of the dominant Engine 4 contribution (the
 *                          same one the string calls "{ROLE} {TYPE} dominant")
 *   BIOS_UPDATE_REQUIRED   the verbatim min_bios_version texts the build's
 *                          CONDITIONAL pair evidence demands
 *   UNKNOWN_SPEC           the component roles whose status is UNKNOWN
 *   INPUT_APPLIED          { use_case, resolution, priority, gpu_policy } - the
 *                          inputs and declared policy that shaped this pass
 *   LIMITED_CATALOG        the E4 selection reason codes (fewer than three
 *                          genuinely distinct archetypes, or none at all)
 *
 * READ-PATH AVAILABILITY (why this module exists as a pure function rather
 * than as a new persisted column): the API read path rebuilds a response from
 * recommendation_result + build_candidate + build_component + the
 * recommendation_query row + the active model's configuration. Measured
 * against that surface:
 *
 *   DERIVABLE       BUDGET_USED_PCT (total_price + budget_amount)
 *                   GPU_SHARE       (build_component.selected_price)
 *                   INPUT_APPLIED   (query row + configuration; the row STORES
 *                                   use_case, resolution and priority, but the
 *                                   API's current SELECT_QUERY_SQL fetches only
 *                                   use_case - a caller wanting the other two
 *                                   adds them to its own SELECT)
 *   NOT DERIVABLE   DOMINANT_ROLE        contributions are never persisted
 *                   BIOS_UPDATE_REQUIRED compatibility_notes are never persisted
 *                   UNKNOWN_SPEC         build_component has no status column
 *                   STRATEGY             strategy_key is not persisted
 *                   LIMITED_CATALOG      E4's reason codes are never written
 *
 * So the five MUST come from the engine seam (orchestrator/full-run.js, where
 * the archetype entries, the contributions and the per-component statuses all
 * exist), and the three may be recomputed on the read path. `reasons.test.js`
 * pins this table - and pins it against the shape the read path ACTUALLY yields,
 * strings included (see NUMERIC below).
 *
 * NUMERIC COLUMNS ARRIVE AS STRINGS. `node-postgres` does not parse NUMERIC
 * (deliberately - it cannot be represented exactly in a double), so the three
 * read-path inputs `recommendation_query.budget_amount`,
 * `build_candidate.total_price` and `build_component.selected_price` are decimal
 * STRINGS in JS, not numbers. A plain-decimal string is therefore accepted and
 * coerced with `Number()`, exactly as the repo's own loaders do for the same
 * reason (`offers/select.js` `Number(row.price)`, `filtering/context-loader.js`
 * `Number(row.width_slots)`) and as the API presenter does
 * (`routes/recommendations.js` `toNumberOrNull`). Verified end-to-end against the
 * API's own read path on the TEST branch 2026-10-14: values returned by
 * `repository.js` `readRecommendationResult` derive all three codes. Any OTHER string form, NaN,
 * Infinity, boolean or object stays malformed: the coercion is one narrow,
 * well-defined shape, never a general `Number()` cast that could turn `''` into
 * 0 or `'1e3'` into a surprise.
 *
 * PRICE PRECEDENCE: when a component carries BOTH shapes, the flat
 * `selected_price` (persisted) wins over the nested `price.selected_price`
 * (engine) - so a caller can never have a stale nested value silently override
 * the stored one.
 *
 * `profile` IS THE USE-CASE PROFILE, NOT THE CONFIGURATION: pass
 * `configuration.use_case_profiles[use_case]`, not the configuration object; a
 * configuration passed by mistake has no own `gpu_policy` key and yields
 * `gpu_policy: null` rather than an error.
 *
 * DETERMINISM (Decision 22 item 6): same inputs -> same output, byte for byte.
 * No clock, no randomness, no locale-dependent comparison, no object-key
 * iteration whose order depends on insertion by an outside caller; the output
 * order is the frozen REASON_ORDER and every tie inside a shared fact is
 * broken by the same rule the string already uses.
 *
 * Explicit NON-responsibilities: no persistence (no JSONB column, no writer
 * change), no new prose, no re-derivation of scores, compatibility or budget,
 * no mutation of any argument, no DB access.
 */
'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');
// ONE owner per vocabulary, imported rather than copied. E6 kept local copies
// only because the assembly stage carries a boundary pin against ../scoring;
// Engine 6 has no such pin. The scoring BARREL is deliberately NOT used here:
// it re-exports the pg-backed loaders, and Engine 6 must stay DB-free.
const { STRATEGIES, REASON_CODES: ARCHETYPE_REASON_CODES } = require('../ranking');
const { GPU_POLICIES } = require('../scoring/use-cases');
const {
  componentsByRole,
  dominantContribution,
  biosRequirements,
  unknownRoles,
} = require('./build-facts');

/** The frozen E7 code vocabulary. Declaration order IS the output order. */
const REASON_CODES = Object.freeze({
  STRATEGY: 'STRATEGY',
  BUDGET_USED_PCT: 'BUDGET_USED_PCT',
  GPU_SHARE: 'GPU_SHARE',
  DOMINANT_ROLE: 'DOMINANT_ROLE',
  BIOS_UPDATE_REQUIRED: 'BIOS_UPDATE_REQUIRED',
  UNKNOWN_SPEC: 'UNKNOWN_SPEC',
  INPUT_APPLIED: 'INPUT_APPLIED',
  LIMITED_CATALOG: 'LIMITED_CATALOG',
});

/** Derived from the vocabulary, so the two can never disagree. */
const REASON_ORDER = Object.freeze(Object.values(REASON_CODES));

/** The Engine 3 role whose component drives GPU_SHARE. */
const GPU_ROLE = 'GPU';

/** 3-letter uppercase currency code (mirrors assembly/prices.js + explain.js). */
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * The only string form a NUMERIC column may arrive as: a plain decimal literal.
 * Exponent notation, whitespace, thousands separators, `''` and `'abc'` are all
 * out of contract.
 */
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** The priority vocabulary the API validates (1..5, or null = unset). */
const PRIORITY_MIN = 1;
const PRIORITY_MAX = 5;

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A finite number, or the plain-decimal STRING a NUMERIC column yields (see the
 * header). Returns null - never a coerced surprise - for every other value, so
 * each caller applies its OWN positivity rule on top.
 */
function toFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && DECIMAL_RE.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Children-first recursive freezer (never pre-freeze a container for it). */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * The budget is threaded explicitly, in the SAME shape explain.js validates.
 * Returns the COERCED amount, so callers never do arithmetic on a NUMERIC string.
 */
function validateBudget(budget) {
  if (budget === null || typeof budget !== 'object' || Array.isArray(budget)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'budget',
      '"budget" must be the { amount, currency } query budget'
    );
  }
  if (budget.amount === undefined || budget.amount === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'budget.amount', '"budget.amount" is required');
  }
  const amount = toFiniteNumber(budget.amount);
  if (amount === null || amount <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budget.amount',
      '"budget.amount" must be a finite number (or a plain-decimal NUMERIC string) greater than 0'
    );
  }
  if (budget.currency === undefined || budget.currency === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'budget.currency', '"budget.currency" is required');
  }
  if (typeof budget.currency !== 'string' || !CURRENCY_RE.test(budget.currency)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budget.currency',
      '"budget.currency" must match /^[A-Z]{3}$/'
    );
  }
  return amount;
}

/**
 * The build itself: only what this module reads, never more. Returns the
 * COERCED total, so callers never do arithmetic on a NUMERIC string.
 */
function validateBuild(build) {
  if (!isPlainObject(build)) {
    fail(ERROR_CODES.INVALID_INPUT, 'build', '"build" must be an Engine 3 build object');
  }
  if (!Array.isArray(build.components) || build.components.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'build.components',
      '"build.components" must be a non-empty array'
    );
  }
  // `build_candidate.total_price` is nullable in the schema (migration 011), so
  // an absent/NULL price fails fast by name rather than silently dropping
  // BUDGET_USED_PCT: a caller holding a build with no price has no budget share
  // to derive, and 2 of the 3 read-path-derivable codes need the total anyway.
  if (build.total_price === undefined || build.total_price === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'build.total_price',
      '"build.total_price" is required'
    );
  }
  const totalPrice = toFiniteNumber(build.total_price);
  if (totalPrice === null || totalPrice <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'build.total_price',
      '"build.total_price" must be a finite number (or a plain-decimal NUMERIC string) greater than 0'
    );
  }
  return totalPrice;
}

/**
 * The component's price, accepting BOTH shapes the two seams carry: the engine
 * build's nested `price.selected_price` (assembly/prices.js) and the read
 * path's flat `selected_price` (build_component.selected_price, a NUMERIC
 * string). One of them must resolve to a finite number greater than 0; the flat
 * persisted value WINS when both are present (see the header).
 */
function componentPrice(component, where) {
  const nested = component.price !== null && typeof component.price === 'object'
    ? component.price.selected_price
    : undefined;
  const flat = component.selected_price;
  const price = toFiniteNumber(flat === undefined ? nested : flat);
  if (price === null || price <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      where + '.selected_price',
      '"' + where + '.selected_price" (or its nested "price.selected_price") must be a finite number (or a plain-decimal NUMERIC string) greater than 0'
    );
  }
  return price;
}

/**
 * Engine 4 item-1 contributions for THIS build. Stricter than explain.js, which
 * only checks that the list is an array: DOMINANT_ROLE's VALUE is the role, so a
 * malformed item must fail fast rather than silently lose the comparison to NaN.
 */
function validateContributions(contributions) {
  if (!Array.isArray(contributions)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'contributions', '"contributions" must be an array');
  }
  for (let index = 0; index < contributions.length; index += 1) {
    const item = contributions[index];
    const where = 'contributions[' + index + ']';
    if (!isPlainObject(item)) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, where, '"' + where + '" must be a contribution object');
    }
    if (typeof item.role !== 'string' || item.role.length === 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        where + '.role',
        '"' + where + '.role" must be a non-empty string'
      );
    }
    if (!isFiniteNumber(item.weight)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        where + '.weight',
        '"' + where + '.weight" must be a finite number'
      );
    }
    if (!isFiniteNumber(item.effective_score)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        where + '.effective_score',
        '"' + where + '.effective_score" must be a finite number'
      );
    }
  }
}

/**
 * The declared use-case profile (Decision 37), or null when none was supplied.
 * A DECLARED gpu_policy must be an exact vocabulary string - a declared null is
 * malformed, never a synonym for "no policy" (the same rule input.js enforces).
 */
function readGpuPolicy(profile) {
  if (profile === undefined || profile === null) {
    return null;
  }
  if (!isPlainObject(profile)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'profile', '"profile" must be a use-case profile object');
  }
  if (!hasOwn(profile, 'gpu_policy')) {
    return null;
  }
  if (typeof profile.gpu_policy !== 'string' || !GPU_POLICIES.includes(profile.gpu_policy)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'profile.gpu_policy',
      '"profile.gpu_policy" must be one of ' + GPU_POLICIES.join(', ')
    );
  }
  return profile.gpu_policy;
}

/** The query inputs that shaped the pass, or null when none were supplied. */
function readInputs(inputs) {
  if (inputs === undefined || inputs === null) {
    return null;
  }
  if (!isPlainObject(inputs)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'inputs', '"inputs" must be the query input object');
  }
  if (typeof inputs.use_case !== 'string' || inputs.use_case.length === 0) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      'inputs.use_case',
      '"inputs.use_case" must be a non-empty string'
    );
  }
  const resolution = inputs.resolution === undefined ? null : inputs.resolution;
  if (resolution !== null && (typeof resolution !== 'string' || resolution.length === 0)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'inputs.resolution',
      '"inputs.resolution" must be a non-empty string or null'
    );
  }
  const priority = inputs.priority === undefined ? null : inputs.priority;
  if (
    priority !== null &&
    (typeof priority !== 'number' || !Number.isInteger(priority) ||
      priority < PRIORITY_MIN || priority > PRIORITY_MAX)
  ) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'inputs.priority',
      '"inputs.priority" must be an integer in [' + PRIORITY_MIN + ', ' + PRIORITY_MAX + '] or null'
    );
  }
  return Object.freeze({ use_case: inputs.use_case, resolution, priority });
}

/** The E4 archetype strategy key, or null when none was supplied. */
function readStrategy(strategy) {
  if (strategy === undefined || strategy === null) {
    return null;
  }
  if (typeof strategy !== 'string' || !STRATEGIES.includes(strategy)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'strategy',
      '"strategy" must be one of ' + STRATEGIES.join(', ')
    );
  }
  return strategy;
}

/** The E4 selection reason codes, or an empty list when none were supplied. */
function readCatalogReasonCodes(catalogReasonCodes) {
  if (catalogReasonCodes === undefined || catalogReasonCodes === null) {
    return [];
  }
  if (!Array.isArray(catalogReasonCodes)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'catalogReasonCodes',
      '"catalogReasonCodes" must be an array'
    );
  }
  const known = Object.values(ARCHETYPE_REASON_CODES);
  const copy = [];
  for (let index = 0; index < catalogReasonCodes.length; index += 1) {
    const code = catalogReasonCodes[index];
    if (typeof code !== 'string' || !known.includes(code)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'catalogReasonCodes[' + index + ']',
        '"catalogReasonCodes[' + index + ']" must be one of ' + known.join(', ')
      );
    }
    if (!copy.includes(code)) {
      copy.push(code);
    }
  }
  return copy;
}

/**
 * One build's structured reasons.
 *
 * @param {object} args { build, contributions, profile, budget, inputs,
 *        strategy, catalogReasonCodes } - see the header for which are optional.
 * @returns {Array} deeply frozen array of frozen { code, value } in REASON_ORDER
 * @throws {CandidateSelectionError} fail fast on a malformed supplied input
 */
function deriveReasons(args) {
  if (!isPlainObject(args)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      null,
      'deriveReasons requires a single { build, contributions, profile, budget, inputs, strategy, catalogReasonCodes } object'
    );
  }
  const { build, contributions, profile, budget, inputs, strategy, catalogReasonCodes } = args;

  // Both validators return the COERCED values (a NUMERIC column arrives as a
  // decimal string from node-postgres), so every bit of arithmetic below is on
  // numbers - never on a string that would silently concatenate or NaN.
  const totalPrice = validateBuild(build);
  const budgetAmount = validateBudget(budget);
  if (contributions !== undefined && contributions !== null) {
    validateContributions(contributions);
  }
  const gpuPolicy = readGpuPolicy(profile);
  const appliedInputs = readInputs(inputs);
  const strategyKey = readStrategy(strategy);
  const limitedCatalog = readCatalogReasonCodes(catalogReasonCodes);

  // Components are read WITHOUT the status requirement: the read path has no
  // per-component status to give (build_component persists none), and a missing
  // status must degrade to "that code is omitted", never to a throw.
  const byRole = componentsByRole(build, 'build', { requireStatus: false });
  const gpu = byRole.get(GPU_ROLE);

  const reasons = [];
  const push = (code, value) => {
    reasons.push(Object.freeze({ code, value }));
  };

  if (strategyKey !== null) {
    push(REASON_CODES.STRATEGY, strategyKey);
  }

  push(REASON_CODES.BUDGET_USED_PCT, (totalPrice / budgetAmount) * 100);

  // The iGPU path (no GPU role at all) is a null share, not a missing code.
  const gpuPrice = gpu === undefined ? null : componentPrice(gpu, 'build.' + GPU_ROLE);
  push(REASON_CODES.GPU_SHARE, gpuPrice === null ? null : gpuPrice / totalPrice);

  if (Array.isArray(contributions) && contributions.length > 0) {
    const dominant = dominantContribution(contributions);
    if (dominant !== null) {
      push(REASON_CODES.DOMINANT_ROLE, dominant.role);
    }
  }

  const bios = biosRequirements(byRole);
  if (bios.length > 0) {
    push(REASON_CODES.BIOS_UPDATE_REQUIRED, Object.freeze(bios));
  }

  const unknown = unknownRoles(byRole);
  if (unknown.length > 0) {
    push(REASON_CODES.UNKNOWN_SPEC, Object.freeze(unknown));
  }

  if (appliedInputs !== null) {
    push(
      REASON_CODES.INPUT_APPLIED,
      Object.freeze({
        use_case: appliedInputs.use_case,
        resolution: appliedInputs.resolution,
        priority: appliedInputs.priority,
        gpu_policy: gpuPolicy,
      })
    );
  }

  if (limitedCatalog.length > 0) {
    push(REASON_CODES.LIMITED_CATALOG, Object.freeze(limitedCatalog));
  }

  return deepFreeze(reasons);
}

module.exports = { deriveReasons, REASON_CODES, REASON_ORDER };
