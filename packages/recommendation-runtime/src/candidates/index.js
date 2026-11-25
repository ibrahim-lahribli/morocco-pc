'use strict';

/**
 * Engine 2 - candidate contracts and pool selection (runtime COMPOSITE SEAM,
 * step 5 W3).
 *
 * WHAT THIS FILE IS. It is the legacy mixed barrel — the object that publishes
 * 16 pure candidate names beside the one SQL loader — relocated into this
 * package so the byte-identical orchestrator's `require('../candidates')`
 * resolves at BOTH depths: `src/recommendation/orchestrator/` and
 * `packages/recommendation-runtime/src/orchestrator/`. No single relative
 * specifier names one barrel from both trees, and `core-entry` is the same
 * device one level up. The old path,
 * `src/recommendation/candidates/index.js`, is an identity shim to THIS object.
 *
 * WHY IT MOVED RATHER THAN SPLIT. RFC §11.2 splits the mixed barrels by
 * PUBLICATION: `recommendation-core` publishes the pure half, this package
 * publishes the SQL half. The physical split of the legacy barrel is step 6
 * work (docs/MIXED_BARRELS.md), because the API and the documented patch seam
 * still name the old path. W3's constraint set is unusual: the eight
 * orchestrator files must stay byte-identical, the old paths must stay
 * loadable, and the behavioural suites patch `require('../candidates')` and
 * expect the implementation to call through the SAME object (see
 * `src/recommendation/orchestrator/run.test.js`'s `spyOn` seam). A locally
 * built merged namespace would satisfy RFC §11.3 rule 2's letter and silently
 * detach that seam. This file is the result: one object, two owners' exports,
 * no publication.
 *
 * WHAT IT IS NOT. It is NOT a published namespace. It is absent from
 * `package.json` `exports`, from `src/index.js` and from
 * `test/export-surface.json`; `require('@morocco-pc/recommendation-runtime/candidates')`
 * throws ERR_PACKAGE_PATH_NOT_EXPORTED (scripts/lib/runtime-package-exports.test.js),
 * and test/surface.test.js proves no published runtime namespace carries a core
 * name. Core owns the pure implementations here BY IDENTITY — every one of the
 * 16 is the core's own function object, not a copy — and this package owns
 * `loadCandidates`. The aggregation is the same one the legacy barrel always
 * performed; it collapses no ownership, because publication is what the RFC
 * splits, and publication happens elsewhere.
 *
 * The open question this file embodies (is a relocated composite acceptable
 * until step 6?) is recorded with its alternatives in docs/MIXED_BARRELS.md §5
 * and is NOT self-approved.
 *
 * Composition is a SPREAD of the plain core namespace. Safe because that
 * namespace is a plain object literal (no getters, no non-enumerable members —
 * proved by test/namespace-barrels.test.js) and because the surface is pinned
 * exactly: a new core export makes this namespace grow, so that test fails
 * until the committed list is updated in the same commit.
 */

const core = require('../core-entry');
const { loadCandidates } = require('./loader');

module.exports = {
  ...core.candidates,
  loadCandidates,
};
