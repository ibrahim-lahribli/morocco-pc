'use strict';

// Boundary rules for the layered tree: apps/web, apps/api, the engine, the
// extracted packages and scripts/.
//
// Only the DIRECTION of a dependency is policed here. Whether an importer
// reaches core through the package entry, a declared exports subpath or a deep
// file path is deliberately not a rule (DECISIONS.md E1, revised).
//
// Known violations that predate this file live in
// .dependency-cruiser-known-violations.json and are skipped with
// `--ignore-known`; a NEW violation still fails `npm run lint:boundaries`.

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      // apps/web is its own package (own manifest, own node_modules), so a
      // dependency that leaves it cannot be resolved by the cruiser here. The
      // rule therefore matches the path AS WRITTEN as well as a resolved path,
      // so `../../apps/api/src/db` is caught even while unresolved.
      name: 'web-no-api-modules',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '(^|/|\\.\\./)apps/api/' },
    },
    {
      // The API reaches the engine through exactly one door: engine.js.
      name: 'api-engine-single-door',
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: '^apps/api/src/engine\\.js$' },
      to: { path: '^src/recommendation/' },
    },
    {
      // The engine and the pure core never read the schema themselves.
      name: 'engine-no-migrations',
      severity: 'error',
      from: { path: '^(src/recommendation|packages/recommendation-core)/' },
      to: { path: '^database/' },
    },
    {
      name: 'core-no-third-party',
      severity: 'error',
      from: { path: '^packages/recommendation-core/src/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-peer', 'npm-optional', 'npm-unknown', 'npm-no-pkg'],
      },
    },
    {
      // One-way: nothing under apps, scripts, src or the database guard is
      // reachable from the pure core.
      name: 'core-no-outward',
      severity: 'error',
      from: { path: '^packages/recommendation-core/src/' },
      to: { path: '^(apps|scripts|src|packages/database-guard)/' },
    },
    {
      // An ingestion module may share ingestion/ internals, never another stage.
      name: 'ingestion-no-engine-stages',
      severity: 'error',
      from: { path: '^src/recommendation/ingestion/' },
      to: { path: '^src/recommendation/(?!ingestion/)' },
    },
    {
      name: 'runtime-no-pg',
      severity: 'error',
      from: { path: '^packages/recommendation-runtime/src/' },
      to: { path: '(^|/)node_modules/(pg|dotenv)(/|$)|^(pg|dotenv)$' },
    },
    {
      // Warning only: scripts/ legitimately drive the API today.
      name: 'scripts-no-app-internals',
      severity: 'warn',
      from: { path: '^scripts/' },
      to: { path: '^apps/(api/src|web/(lib|components|app))/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules|\\.next|test-results|coverage|dist|tmp' },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
};
