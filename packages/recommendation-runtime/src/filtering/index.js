'use strict';

/**
 * Engine 2D - filtering (runtime COMPOSITE SEAM, step 5 W3).
 *
 * WHAT THIS FILE IS. The legacy mixed barrel — three pure filtering names
 * beside the SQL context loader, the `CONTEXT_COMPAT_KEYS` vocabulary and the
 * `filterCandidatesForRecommendation` composition — relocated into this package
 * so the byte-identical orchestrator's `require('../filtering')` resolves at
 * BOTH depths. The old path, `src/recommendation/filtering/index.js`, is an
 * identity shim to THIS object. See ./candidates/index.js for the full "what
 * this file is / is not" note and docs/MIXED_BARRELS.md §5 for the recorded
 * architectural question.
 *
 * WHAT IT IS NOT. A published namespace: absent from `package.json` `exports`,
 * from `src/index.js` and from `test/export-surface.json`, so the package name
 * cannot reach it. Core owns the pure implementations by identity; this package
 * owns the SQL loader, its vocabulary and the composition. `loadFilteringContext`
 * is deliberately NOT in the published `loaders` namespace's vocabulary half —
 * §11.5 lists functions only, so `CONTEXT_COMPAT_KEYS` stays here and at the old
 * stage barrel (docs/MIXED_BARRELS.md rule 4).
 *
 * Composition is a SPREAD of the plain core filtering namespace, proven safe
 * and pinned key by key by test/namespace-barrels.test.js, so a future core
 * export cannot appear here without a failing test and a reviewed diff.
 */

const core = require('../core-entry');
const { loadFilteringContext, CONTEXT_COMPAT_KEYS } = require('./context-loader');
const { filterCandidatesForRecommendation } = require('./pipeline');

module.exports = {
  ...core.filtering,
  loadFilteringContext,
  CONTEXT_COMPAT_KEYS,
  filterCandidatesForRecommendation,
};
