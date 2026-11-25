'use strict';

// packages/recommendation-runtime/src/index.js — the runtime's public entry
// point (step 5).
//
// Step 5 W0 shipped the boundary with an EMPTY surface on purpose, exactly as
// step 4B PR 1 did for the core: the harness exists before any module moves, so
// every later batch lands behind gates that already run.
//
// The surface is namespaced and written by hand (RFC §11.5, approved as written
// by decision A2): `loaders`, `orchestrator`, `persistence` — nothing else. A
// module that appears under src/ cannot become a public export by accident:
// there is no spread and no wildcard here.
//
// Each namespace is its own module, so the root object and the declared
// `./loaders`, `./orchestrator` and `./persistence` subpaths are the SAME
// objects rather than copies:
//   require('@morocco-pc/recommendation-runtime').loaders
//     === require('@morocco-pc/recommendation-runtime/loaders')
// The `exports` map in package.json is what makes the subpaths a contract
// rather than a path that happens to resolve; scripts/lib/
// runtime-package-exports.test.js asks Node's resolver from outside the
// repository, and test/index.test.js pins the manifest.
//
// W1 moved the eight loaders and published `loaders`.
// W2 moved the five persistence modules behind identity shims and published
//   nothing; test/persistence-surface.test.js proves the modules, not the
//   namespace.
// W3 moved the eight orchestrator modules behind identity shims, published
//   `orchestrator` (the eight entry points of ORCHESTRATOR_ENTRY_POINTS.md, in
//   that table's order), and — because W3 supplied the namespace's real
//   consumers — reconciled the root with §11.5 by publishing `persistence`.
//   `runRecommendationCommit` is deliberately NOT published: it is internal to
//   orchestrator/commit.js (required directly by full-run.js) and is not one of
//   the eight.
//
// What this file does NOT decide: the RFC §11.5 row for persistence is
// orchestrator-facing, so the same three writers may still be described as
// internal step-6 material. The surface is pinned by test/export-surface.json
// and each namespace by its own surface suite; growing it is a reviewable diff.
//
// One prerequisite remains open and is recorded, not hidden: the runtime export
// surface itself is still to be ratified by the owner (see
// docs/MIXED_BARRELS.md §5). Runtime characterization and provenance are
// verified by the manifest batch in extraction-manifest.json, not by this file.

const loaders = require('./loaders');
const orchestrator = require('./orchestrator');
const persistence = require('./persistence');

module.exports = { loaders, orchestrator, persistence };
