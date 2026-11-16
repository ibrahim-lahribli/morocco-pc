'use strict';

// packages/recommendation-core/src/index.js — the pure core's public entry
// point (step 4B).
//
// Step 4B PR 1 shipped the boundary with an EMPTY surface on purpose. Step 4B
// PR 2 adds exactly the namespaces whose modules moved: the pure candidate
// contracts, the pure compatibility tree and the pure half of Engine 2D
// filtering. Everything else is still in the runtime tree.
//
// The surface is namespaced and written by hand (RFC §11.4): no
// `...require('./x')` spread, so a module that lands under src/ later cannot
// become a public export by accident. Every entry point here is pure by
// contract, and the gate that proves it is test/purity.test.js.
//
// Deliberately absent, and staying in the runtime tree for now:
//   candidates   loadCandidates
//   filtering    loadFilteringContext, CONTEXT_COMPAT_KEYS,
//                filterCandidatesForRecommendation
// Assembly, scoring, retention, ranking, explanation and offers/as-of have not
// moved yet; they arrive in later extraction PRs, each adding its namespace
// and updating test/export-surface.json in the same commit.

const candidates = require('./candidates');
const filtering = require('./filtering');
const compatibility = require('./compatibility');

module.exports = { candidates, filtering, compatibility };
