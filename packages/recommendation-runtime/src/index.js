'use strict';

// packages/recommendation-runtime/src/index.js — the runtime's public entry
// point (step 5).
//
// Step 5 W0 shipped the boundary with an EMPTY surface on purpose, exactly as
// step 4B PR 1 did for the core: the harness exists before any module moves, so
// every later batch lands behind gates that already run.
//
// The surface is namespaced and written by hand (RFC §11.5): the loaders, the
// orchestrator entry points, and the persistence writers and validators —
// nothing else. A module that appears under src/ cannot become a public export
// by accident: there is no spread and no wildcard here.
//
// Step 5 W1 publishes `loaders`, the eight names RFC §11.5 lists, in the order
// that table lists them:
//   loadQueryInput, catalogVersion, loadCandidates, selectOfferPrices,
//   loadFilteringContext, filterCandidatesForRecommendation,
//   loadScoringModel, loadComponentAssessments
// `filterCandidatesForRecommendation` is infrastructure composition owned at
// orchestrator/ (RFC §11.2), not SQL, and is published here only because RFC
// §11.5 places it under ./loaders. The SQL constants and vocabulary the
// loaders export (`SELECT_*_SQL`, `REQUIRED_ROLES`, `CONTEXT_COMPAT_KEYS`,
// `CATALOG_*`) are deliberately NOT part of this namespace: the approved §11.5
// table lists functions only, and they remain public at their old stage
// barrels. See docs/MIXED_BARRELS.md rule 4.
//
// Step 5 W2 moved the five persistence modules — the three writers and the two
// validators — into this package's src/persistence/ behind identity shims at
// their old paths, but publishes NO `persistence` namespace: the RFC §11.5
// table is an orchestrator-facing surface, and slicing it before its consumers
// exist would fix a shape a later batch has to review against the real call
// sites.
//
// Step 5 W3 moves the eight orchestrator modules into src/orchestrator/ behind
// identity shims at their old paths and publishes `orchestrator`: the eight
// entry points of ORCHESTRATOR_ENTRY_POINTS.md, in the order that table lists
// them. `runRecommendationCommit` is deliberately NOT here — it is internal to
// orchestrator/commit.js (required directly by full-run.js) and is not one of
// the eight.
//
// Its two prerequisites are recorded as NOT yet closed by this batch:
//   * the runtime export surface itself is still to be decided/ratified;
//   * runtime characterization and provenance are verified by the manifest
//     batch recorded in extraction-manifest.json, not by this file.

const { loadQueryInput } = require('./query/load-query-input');
const { catalogVersion } = require('./query/catalog-version');
const { loadCandidates } = require('./candidates/loader');
const { selectOfferPrices } = require('./offers/select');
const { loadFilteringContext } = require('./filtering/context-loader');
const { filterCandidatesForRecommendation } = require('./filtering/pipeline');
const { loadScoringModel } = require('./scoring/load-scoring-model');
const { loadComponentAssessments } = require('./scoring/load-assessments');
const orchestrator = require('./orchestrator');

const loaders = {
  loadQueryInput,
  catalogVersion,
  loadCandidates,
  selectOfferPrices,
  loadFilteringContext,
  filterCandidatesForRecommendation,
  loadScoringModel,
  loadComponentAssessments,
};

module.exports = { loaders, orchestrator };
