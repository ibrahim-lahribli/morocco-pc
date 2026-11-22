'use strict';

// packages/recommendation-runtime/src/index.js — the runtime's public entry
// point (step 5).
//
// Step 5 W0 ships the boundary with an EMPTY surface on purpose, exactly as
// step 4B PR 1 did for the core: the harness exists before any module moves, so
// every later batch lands behind gates that already run.
//
// The surface is namespaced and written by hand (RFC §11.5): the loaders, the
// orchestrator entry points, and the persistence writers and validators —
// nothing else. A module that appears under src/ cannot become a public export
// by accident.
//
// Deliberately empty right now, and still empty after step 5 W1 moved the first
// module in: a module lands under src/ (offers/select.js, behind an identity
// shim at its old path) before its namespace is published, because the surface
// grows one namespace per batch rather than one file per move. The namespaces
// arrive one batch at a time, each adding itself to test/export-surface.json in
// the same commit:
//   loaders       W1 — candidates, scoring, offers and query loaders, the
//                 filtering-context loader, and the filtering composition
//                 `filterCandidatesForRecommendation`. That last name is
//                 infrastructure composition owned at orchestrator/ (RFC §11.2),
//                 not SQL, and is published here only because RFC §11.5 places
//                 it under ./loaders.
//   persistence   W2 — the three writers and the two validators
//   orchestrator  W3 — run, snapshot, full-run, commit, swap-preview, swap-commit

module.exports = {};
