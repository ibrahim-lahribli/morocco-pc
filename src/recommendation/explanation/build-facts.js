/**
 * Engine 6 - shared build facts (internal module, not part of the public barrel).
 *
 * ONE owner for the four build derivations that BOTH Engine 6 entry points
 * need, so the string formatter (./explain.js) and the structured reason codes
 * (./reasons.js) can never disagree about what "dominant", "requires BIOS" or
 * "UNKNOWN" means:
 *
 *   componentsByRole(build, basePath, options)  role -> component map. Engine 3
 *                                   v1 carries at most one component per
 *                                   EXPANSION_ORDER role; a duplicate role keeps
 *                                   the FIRST. `basePath` labels the owning
 *                                   build in error paths (e.g. `build` or
 *                                   `selected[1].build`).
 *   dominantContribution(items)     the item with the highest
 *                                   weight * effective_score. Strict ">" keeps
 *                                   the FIRST maximum, i.e. Engine 4's fixed
 *                                   EXPANSION_ORDER-then-type-key order.
 *   biosRequirements(byRole)        verbatim, first-seen, de-duplicated
 *                                   min_bios_version texts carried by
 *                                   CONDITIONAL pair-evidence notes, in
 *                                   EXPANSION_ORDER-then-note order.
 *   unknownRoles(byRole)            roles whose component status is UNKNOWN,
 *                                   in EXPANSION_ORDER.
 *
 * Extracted from explain.js when E7 needed the same facts. Pure: no DB, no
 * SQL, no I/O, no clock, no randomness, no locale-dependent comparison; every
 * function reads only its arguments and never mutates them.
 *
 * ROLE SCOPE: `biosRequirements` and `unknownRoles` walk EXPANSION_ORDER, the
 * authoritative Engine 3 traversal order (never sorted, never derived). Engine 3
 * v1 emits only those eight roles, so a component carrying any OTHER role
 * contributes no BIOS version and no UNKNOWN entry - a documented boundary, and
 * the same boundary the explanation string has always had.
 *
 * STATUS STRICTNESS: `componentsByRole` enforces the PASS | UNKNOWN component
 * status by default, because the string formatter cannot describe a build
 * without it. The READ path cannot supply it at all - `build_component`
 * persists no per-component status - so ./reasons.js opts out with
 * `{ requireStatus: false }` and treats a missing status as "cannot tell"
 * (that code is then omitted) rather than malformed. Opting out never changes
 * what an UNKNOWN-status component means: false/null/absent is not UNKNOWN.
 */
'use strict';

const { EXPANSION_ORDER } = require('../assembly');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** The only two statuses a persisted build / component may carry. */
const STATUS_VALUES = Object.freeze(['PASS', 'UNKNOWN']);

/** The Engine 1 evidence status that produces a BIOS condition (Decision 22 item 4(d)). */
const CONDITIONAL_SOURCE_STATUS = 'CONDITIONAL';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/** One component per role (Engine 3 v1); iterate EXPANSION_ORDER to stay deterministic. */
function componentsByRole(build, basePath, options) {
  const requireStatus = options === undefined || options.requireStatus !== false;
  const byRole = new Map();
  for (let index = 0; index < build.components.length; index += 1) {
    const component = build.components[index];
    const cwhere = basePath + '.components[' + index + ']';
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
    if (requireStatus && !STATUS_VALUES.includes(component.status)) {
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

module.exports = {
  STATUS_VALUES,
  CONDITIONAL_SOURCE_STATUS,
  componentsByRole,
  dominantContribution,
  biosRequirements,
  unknownRoles,
};
