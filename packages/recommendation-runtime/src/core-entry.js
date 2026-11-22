/**
 * Core entry adapter - NEW TREE (packages/recommendation-runtime/).
 *
 * `require('../core-entry')` from a runtime namespace directory (`src/<dir>/`)
 * lands here. From `src/` the core package is two levels up,
 * `../../recommendation-core`, which is also the only core specifier this
 * package's boundary scanner permits: the package ROOT, never a path into
 * core/src (RFC §11.4; test/boundary-scanner.js, test/boundary.test.js).
 *
 * The runtime tree needs its own adapter because the core sits at a different
 * depth here than under `src/recommendation/`, and the moved module must keep
 * the SAME bytes in both trees (batch `step-5-w1-offers`,
 * identity_policy `byte-identical`). The old-tree counterpart is
 * `src/recommendation/core-entry.js`.
 *
 * Nothing is re-exported or wrapped: this IS the core package root, by
 * identity, resolved through its package entry point.
 */
'use strict';

module.exports = require('../../recommendation-core');
