/**
 * Core entry adapter - OLD TREE (src/recommendation/).
 *
 * `require('../core-entry')` from a module in `src/recommendation/<dir>/` lands
 * here. This file names the core package root in the one specifier that is
 * correct at this depth: from `src/recommendation/` the package is two levels
 * up, `../../packages/recommendation-core`.
 *
 * Why the adapter exists (step 5 W1, batch `step-5-w1-offers`): no single
 * relative specifier names the core package from both
 * `src/recommendation/<dir>/` and
 * `packages/recommendation-runtime/src/<dir>/`. The depth differs, so the
 * spelling must differ, and a move written with either spelling would not be
 * byte-identical. One adapter per tree keeps the MOVED module to a single
 * `require('../core-entry')` that resolves the same package at both depths.
 * The runtime's counterpart is
 * `packages/recommendation-runtime/src/core-entry.js`.
 *
 * Nothing is re-exported or wrapped: this IS the core package root, by
 * identity, resolved through its package entry point (RFC §11.4).
 */
'use strict';

module.exports = require('../../packages/recommendation-core');
