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
// Deliberately empty right now. Step 4 (recommendation-core) is still in
// progress, and no runtime module may move before it is accepted. The
// namespaces arrive one batch at a time, each adding itself to
// test/export-surface.json in the same commit:
//   loaders       W1 — candidates, filtering, scoring, offers and query loaders
//   persistence   W2 — the three writers and the two validators
//   orchestrator  W3 — run, snapshot, full-run, commit, swap-preview, swap-commit

module.exports = {};
