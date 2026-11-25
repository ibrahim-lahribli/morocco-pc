'use strict';

// packages/recommendation-runtime/src/persistence/index.js — the
// `./persistence` subpath (RFC §11.5, approved as written by decision A2), and
// the object the package root publishes as `persistence`.
//
// W2 moved the five persistence modules into this package behind identity
// shims and published NONE of them, on the recorded ground that §11.5's table is
// orchestrator-facing and slicing it before its consumers existed would fix a
// shape a later batch had to review against the real call sites. W3 is that
// batch: the commit orchestrator consumes all three writers, so the namespace
// lands here with its consumers in the same PR.
//
// §11.5 approves three writers "plus the validators for their own callers":
//
//   persistRanked      (persistence/persist-ranked.js)
//   persistPassFacts   (persistence/persist-pass-facts.js)
//   persistRejections  (persistence/persist-rejections.js)
//   validateSelected   (persistence/validate-selected.js)   — called by persistRanked
//   validateRejections (persistence/validate-rejections.js) — called by persistRejections
//
// The two validators are published because the approved row authorises them and
// because a caller that wants to fail fast BEFORE opening the write transaction
// needs exactly those shapes. Nothing else is: `validatePassFacts` is the
// pass-facts writer's own internal check and is not a module of its own, the
// SQL constants (`INSERT_BUILD_REJECTION_SQL`, `DELETE_BUILD_REJECTION_SQL`,
// `UPDATE_*_SQL`, `REJECT_STATUS`) stay module-public only, and
// `runRecommendationCommit` remains internal to orchestrator/commit.js.
//
// This file exists so the root namespace and the `./persistence` subpath are the
// SAME object. DB-free: loading it issues no statement.

const { persistRanked } = require('./persist-ranked');
const { persistPassFacts } = require('./persist-pass-facts');
const { persistRejections } = require('./persist-rejections');
const { validateSelected } = require('./validate-selected');
const { validateRejections } = require('./validate-rejections');

module.exports = {
  persistRanked,
  persistPassFacts,
  persistRejections,
  validateSelected,
  validateRejections,
};
