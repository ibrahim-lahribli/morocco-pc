'use strict';

// packages/recommendation-runtime/src/loaders/index.js — the `./loaders`
// subpath (RFC §11.5, approved as written by decision A2), and the object the
// package root publishes as `loaders`.
//
// The surface is written by hand and in the order the approved table lists it:
//   loadQueryInput, catalogVersion, loadCandidates, selectOfferPrices,
//   loadFilteringContext, filterCandidatesForRecommendation,
//   loadScoringModel, loadComponentAssessments
// A module that appears under src/ cannot become a loader by accident: there is
// no spread and no wildcard here.
//
// `filterCandidatesForRecommendation` is infrastructure composition owned at
// orchestrator/ (RFC §11.2), not SQL; it is published here because §11.5 places
// it under `./loaders`. See docs/MIXED_BARRELS.md.
//
// The SQL constants and vocabulary the loader modules also export
// (`SELECT_*_SQL`, `REQUIRED_ROLES`, `CONTEXT_COMPAT_KEYS`, `CATALOG_*`) are
// deliberately absent: the §11.5 table lists functions only, and they stay
// public at their old stage barrels. See docs/MIXED_BARRELS.md rule 4.
//
// This file exists so the root namespace and the `./loaders` subpath are the
// SAME object: `require('@morocco-pc/recommendation-runtime').loaders ===
// require('@morocco-pc/recommendation-runtime/loaders')`. A copy would pass the
// member assertions and still split the identity a consumer relies on.
//
// DB-free: loading this module issues no query.

const { loadQueryInput } = require('../query/load-query-input');
const { catalogVersion } = require('../query/catalog-version');
const { loadCandidates } = require('../candidates/loader');
const { selectOfferPrices } = require('../offers/select');
const { loadFilteringContext } = require('../filtering/context-loader');
const { filterCandidatesForRecommendation } = require('../filtering/pipeline');
const { loadScoringModel } = require('../scoring/load-scoring-model');
const { loadComponentAssessments } = require('../scoring/load-assessments');

module.exports = {
  loadQueryInput,
  catalogVersion,
  loadCandidates,
  selectOfferPrices,
  loadFilteringContext,
  filterCandidatesForRecommendation,
  loadScoringModel,
  loadComponentAssessments,
};
