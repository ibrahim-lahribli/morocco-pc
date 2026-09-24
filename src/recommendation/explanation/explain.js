/**
 * Engine 6 - explanation generation (Decision 22 items 2 + 4).
 *
 * Pure, framework-free, DB-free: the composer hands in the selectDiverseTop
 * selection, the snapshot builds, the item-1 contribution lists (the Engine 4
 * STEP 1 / STEP 3 inputs that produced each build_score) and the pinned query
 * budget; this module returns a NEW explained array. Copies only - the frozen
 * selection is never mutated. No DB, no SQL, no I/O, no clock, no randomness,
 * no locale-dependent formatting (Decision 22 items 2 + 6: same inputs -> same
 * text, byte for byte).
 *
 * Fixed template (Decision 22 item 4), verbatim:
 *
 *   Ranked {rank}: best weighted score {build_score}; {PASS|UNKNOWN} compatibility;
 *   {total_price} {currency} of {budget_amount} {currency} budget;
 *   {ROLE} {TYPE} dominant[{; requires BIOS >= X}][{; UNKNOWN: {role-list}}]
 *
 * Bindings:
 *   (a) persisted_rank / build_score / total_price / compatibility_status are the
 *       already-rounded entry values, never re-rounded or re-derived; `currency`
 *       is entry.build.currency (the same value the build already carries).
 *   (b) budget comes ONLY from the explicit `budget` argument - never from an
 *       entry, never a query. `use_case` is NOT an explanation input.
 *   (c) Dominant {ROLE} {TYPE} is the top item-1 contribution ordered by
 *       weight * effective_score descending. Ties keep the FIRST item in the
 *       contribution order, which is Engine 4's EXPANSION_ORDER-then-
 *       configuration-type-key order - deterministic, code-unit based, never
 *       localeCompare, never dependent on any other input order.
 *   (d) A CONDITIONAL pair-evidence note (Engine 1's SOURCE_STATUSES.CONDITIONAL,
 *       carried additively by Engine 2D / Engine 3 in
 *       component.compatibility_notes, Decision 22 item 8) emits
 *       `; requires BIOS >= <min_bios_version>` with the VERBATIM version text.
 *       Distinct versions are emitted once, in EXPANSION_ORDER-then-note order;
 *       notes absent / empty emit nothing. Engine 6 never re-derives
 *       support-table rows.
 *   (e) UNKNOWN is never silent: the compatibility slot prints the entry's own
 *       status token, and every component whose status is UNKNOWN appends
 *       `; UNKNOWN: <roles>` with the roles in EXPANSION_ORDER, comma+space
 *       separated. Roles only - no invented reasons.
 *
 * Explicit NON-responsibilities: no persistence of the text (Decision 22 item 5
 * owns the validator / DML change), no ranking, no selection, no re-computation
 * of scores or compatibility, no budget lookup, no input mutation.
 */
'use strict';

const { EXPANSION_ORDER } = require('../assembly');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** 3-letter uppercase currency code (mirrors assembly/prices.js). */
const CURRENCY_RE = /^[A-Z]{3}$/;

/** The only two statuses a persisted build / component may carry. */
const STATUS_VALUES = Object.freeze(['PASS', 'UNKNOWN']);

/** The Engine 1 evidence status that produces a BIOS condition clause (item 4(d)). */
const CONDITIONAL_SOURCE_STATUS = 'CONDITIONAL';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
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

/** Item 4(b): the budget is threaded explicitly; it is never read from an entry. */
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
  if (!isFiniteNumber(budget.amount) || budget.amount <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budget.amount',
      '"budget.amount" must be a finite number greater than 0'
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
}

/** Item 4(a): read the already-final entry values; never re-derive them. */
function validateEntry(entry, where) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, where, '"' + where + '" must be a selected entry');
  }
  if (!Number.isInteger(entry.persisted_rank) || entry.persisted_rank <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      where + '.persisted_rank',
      '"' + where + '.persisted_rank" must be a positive integer'
    );
  }
  if (!isFiniteNumber(entry.build_score) || entry.build_score < 0 || entry.build_score > 100) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      where + '.build_score',
      '"' + where + '.build_score" must be a finite number in [0, 100]'
    );
  }
  if (!isFiniteNumber(entry.total_price) || entry.total_price <= 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      where + '.total_price',
      '"' + where + '.total_price" must be a finite number greater than 0'
    );
  }
  if (!STATUS_VALUES.includes(entry.compatibility_status)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      where + '.compatibility_status',
      '"' + where + '.compatibility_status" must be exactly "PASS" or "UNKNOWN"'
    );
  }
  const build = entry.build;
  if (build === null || typeof build !== 'object' || Array.isArray(build)) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, where + '.build', '"' + where + '.build" must be an object');
  }
  if (typeof build.currency !== 'string' || !CURRENCY_RE.test(build.currency)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      where + '.build.currency',
      '"' + where + '.build.currency" must match /^[A-Z]{3}$/'
    );
  }
  if (!Array.isArray(build.components) || build.components.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      where + '.build.components',
      '"' + where + '.build.components" must be a non-empty array'
    );
  }
}

/** One component per role (Engine 3 v1); iterate EXPANSION_ORDER to stay deterministic. */
function componentsByRole(build, where) {
  const byRole = new Map();
  for (let index = 0; index < build.components.length; index += 1) {
    const component = build.components[index];
    const cwhere = where + '.build.components[' + index + ']';
    if (component === null || typeof component !== 'object' || Array.isArray(component)) {
      fail(ERROR_CODES.INVALID_FIELD_VALUE, cwhere, '"' + cwhere + '" must be a component object');
    }
    if (typeof component.component_role !== 'string' || component.component_role.length === 0) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        cwhere + '.component_role',
        '"' + cwhere + '.component_role" must be a non-empty string'
      );
    }
    if (!STATUS_VALUES.includes(component.status)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        cwhere + '.status',
        '"' + cwhere + '.status" must be exactly "PASS" or "UNKNOWN"'
      );
    }
    if (!byRole.has(component.component_role)) {
      byRole.set(component.component_role, component);
    }
  }
  return byRole;
}

/** Item 4(c): strict > keeps the first maximum, i.e. the fixed contribution order. */
function dominantContribution(contributions) {
  let best = null;
  let bestProduct = 0;
  for (const item of contributions) {
    const product = item.weight * item.effective_score;
    if (best === null || product > bestProduct) {
      best = item;
      bestProduct = product;
    }
  }
  return best;
}

/** Item 4(d): verbatim min_bios_version texts, first-seen, de-duplicated. */
function biosRequirements(byRole) {
  const versions = [];
  for (const role of EXPANSION_ORDER) {
    const component = byRole.get(role);
    if (component === undefined || !Array.isArray(component.compatibility_notes)) {
      continue;
    }
    for (const note of component.compatibility_notes) {
      if (note === null || typeof note !== 'object' || Array.isArray(note)) {
        continue;
      }
      if (note.source_status !== CONDITIONAL_SOURCE_STATUS) {
        continue;
      }
      const version = note.min_bios_version;
      if (typeof version !== 'string' || version.length === 0) {
        continue;
      }
      if (!versions.includes(version)) {
        versions.push(version);
      }
    }
  }
  return versions;
}

/** Item 4(e): UNKNOWN component roles, in EXPANSION_ORDER. */
function unknownRoles(byRole) {
  const roles = [];
  for (const role of EXPANSION_ORDER) {
    const component = byRole.get(role);
    if (component !== undefined && component.status === 'UNKNOWN') {
      roles.push(role);
    }
  }
  return roles;
}

/** Compose the fixed template for ONE selected entry (never mutates it). */
function composeExplanation({ entry, contributions, budget }) {
  const build = entry.build;
  const byRole = componentsByRole(build, 'selected[' + entry.persisted_rank + ']');

  const parts = [
    'Ranked ' + entry.persisted_rank + ': best weighted score ' + entry.build_score,
    entry.compatibility_status + ' compatibility',
    entry.total_price + ' ' + build.currency + ' of ' + budget.amount + ' ' + budget.currency + ' budget',
  ];

  const dominant = dominantContribution(contributions);
  if (dominant !== null) {
    parts.push(dominant.role + ' ' + dominant.type + ' dominant');
  }
  for (const version of biosRequirements(byRole)) {
    parts.push('requires BIOS >= ' + version);
  }
  const unknown = unknownRoles(byRole);
  if (unknown.length > 0) {
    parts.push('UNKNOWN: ' + unknown.join(', '));
  }

  return { ...entry, explanation: parts.join('; ') };
}

/**
 * Fill the pre-write seam with real explanation strings (Decision 22 item 3).
 *
 * @param {object} args { selected, builds, contributions, budget }
 * @param {Array} args.selected      frozen selectDiverseTop().selected array
 * @param {Array} args.builds        the snapshot builds, index-aligned with contributions
 * @param {Array} args.contributions item-1 contribution lists, index-aligned with builds
 * @param {object} args.budget       { amount, currency } from the pinned query row
 * @returns {Array} frozen array of NEW entry copies with `explanation` filled
 * @throws {CandidateSelectionError} on any contract violation (fail fast)
 */
function explainSelection({ selected, builds, contributions, budget }) {
  if (!Array.isArray(selected)) {
    fail(ERROR_CODES.INVALID_INPUT, 'selected', '"selected" must be an array');
  }
  if (!Array.isArray(builds)) {
    fail(ERROR_CODES.INVALID_INPUT, 'builds', '"builds" must be an array');
  }
  if (!Array.isArray(contributions)) {
    fail(ERROR_CODES.INVALID_INPUT, 'contributions', '"contributions" must be an array');
  }
  if (contributions.length !== builds.length) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'contributions',
      '"contributions" must stay index-aligned with "builds"'
    );
  }
  validateBudget(budget);

  const explained = [];
  for (let index = 0; index < selected.length; index += 1) {
    const entry = selected[index];
    const where = 'selected[' + index + ']';
    validateEntry(entry, where);
    const buildIndex = builds.indexOf(entry.build);
    if (buildIndex === -1) {
      fail(
        ERROR_CODES.MISSING_REQUIRED_FIELD,
        where + '.build',
        '"' + where + '.build" is not one of the supplied "builds" (contributions are aligned with "builds")'
      );
    }
    const entryContributions = contributions[buildIndex];
    if (!Array.isArray(entryContributions)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'contributions[' + buildIndex + ']',
        '"contributions[' + buildIndex + ']" must be an array'
      );
    }
    explained.push(composeExplanation({ entry, contributions: entryContributions, budget }));
  }
  return deepFreeze(explained);
}

module.exports = { explainSelection };
