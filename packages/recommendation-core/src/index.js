'use strict';

// packages/recommendation-core/src/index.js — the pure core's public entry
// point (step 4B).
//
// Step 4B PR 1 shipped the boundary with an EMPTY surface on purpose. Step 4B
// PR 2 added exactly the namespaces whose modules moved: the pure candidate
// contracts, the pure compatibility tree and the pure half of Engine 2D
// filtering. Step 4B PR 3 adds Engine 3's assembly stage, step 4B PR 4 adds
// Engine 5a's ranking stage, step 4B PR 5 adds the Engine 2D retention stage,
// and step 4B PR 6 adds Engine 4 scoring - the pure half of the scoring
// directory, which is why the retention test can now follow its one scoring
// import into this package.
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
//   scoring      loadScoringModel, SELECT_SCORING_MODEL_SQL,
//                loadComponentAssessments, SELECT_COMPONENT_ASSESSMENTS_SQL
// Explanation and offers/as-of have not moved yet; they arrive in later
// extraction PRs, each adding its namespace and updating
// test/export-surface.json in the same commit.

const candidates = require('./candidates');
const filtering = require('./filtering');
const compatibility = require('./compatibility');
const assembly = require('./assembly');
const ranking = require('./ranking');
const retention = require('./retention');
const scoring = require('./scoring');

module.exports = { assembly, candidates, filtering, compatibility, ranking, retention, scoring };
