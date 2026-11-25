'use strict';

/**
 * Engine 2 - candidate contracts and pool selection (runtime barrel, step 5 W3).
 *
 * The implementation moved to this package in step 5 W3 because the orchestrator
 * batch needs the candidate namespace to resolve at BOTH depths: the old tree
 * (`src/recommendation/orchestrator/`) and
 * `packages/recommendation-runtime/src/orchestrator/` each `require('../candidates')`,
 * and no single relative specifier names one barrel from both. Like
 * `core-entry`, this barrel is the depth-independent answer: the same
 * `require('../candidates')` resolves here in the runtime tree and to the
 * identity shim at `src/recommendation/candidates/index.js` in the old tree.
 *
 * Composition is a SPREAD of the pure core namespace plus the one runtime
 * member. That is safe here because the core namespace is a plain object
 * literal (no getters, no non-enumerable members - proved by
 * test/namespace-barrels.test.js), and because the surface is pinned exactly:
 * a new core export would make `loadCandidates`'s namespace grow, so
 * test/namespace-barrels.test.js fails until the committed list is updated in
 * the same commit. Growth stays reviewable.
 *
 * `loadCandidates` is the SQL-executing member and is deliberately NOT part of
 * the core (packages/recommendation-core/src/index.js names it as absent).
 */

const core = require('../core-entry');
const { loadCandidates } = require('./loader');

module.exports = {
  ...core.candidates,
  loadCandidates,
};
