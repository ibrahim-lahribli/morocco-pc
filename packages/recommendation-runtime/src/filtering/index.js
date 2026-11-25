'use strict';

/**
 * Engine 2D - filtering (runtime barrel, step 5 W3).
 *
 * The SQL half of the stage (the B2-B context loader and the B2-G composition)
 * already lived in this package after step 5 W1; what W3 adds is the namespace
 * barrel, so the orchestrator's `require('../filtering')` resolves at both
 * depths (the old path is an identity shim to this file, exactly as the
 * candidate barrel is).
 *
 * Composition is a SPREAD of the pure core filtering namespace (the B2-D
 * filter, its verdict vocabulary, and the Decision 11 iGPU handoff map) plus
 * the three members that execute SQL or orchestrate it. The spread is proven
 * on the tree and pinned exactly by test/namespace-barrels.test.js: no getter,
 * no non-enumerable member, and an exact committed key set, so a future core
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
