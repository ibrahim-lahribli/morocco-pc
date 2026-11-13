'use strict';

// packages/recommendation-core/src/index.js — the pure core's public entry
// point (step 4 harness, RFC §11.4/§11.6).
//
// This module exports an EMPTY object on purpose. Step 4B PR 1 creates the
// boundary, not the content: no recommendation module has moved into this
// package, and no placeholder export is declared for one. The pure modules
// arrive in the following extraction PRs, and each of those adds its export
// here and updates test/export-surface.json in the SAME commit — the snapshot
// is the deliberate record of the surface, so growing it must be a reviewable
// change rather than a side effect.
//
// Purity contract, enforced by test/purity.test.js over every file under this
// directory: zero third-party dependencies, relative imports that resolve
// inside this package, and no database client, SQL text, `.query()` call,
// filesystem or HTTP access, `process.env` read, clock read or randomness.
//
// Caller-supplied time stays legal: `new Date(value)` is a pure
// canonicalisation of an argument the caller owns. Reading the clock — a
// zero-argument `new Date()` or `Date.now()` — is not, because the same input
// would then produce two different outputs.

module.exports = {};
