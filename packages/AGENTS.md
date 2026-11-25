# AGENTS.md — packages

Scope: `packages/**`. Each directory here is a package with its own manifest, version and tests,
consumed by commit from inside this repository (no registry, no npm workspaces before the roadmap's
step 6). Read the owning package's own instructions first; this file states the rules that apply to
all of them.

## What lives here

| Package | Responsibility | May import |
|---|---|---|
| `recommendation-core/` (step 4B: harness, plus the pure candidates, compatibility, filtering, assembly, ranking, retention, scoring, explanation and offers/as-of modules moved) | pure recommendation logic: selection, filtering, assembly, scoring, retention, ranking, explanation | relative paths inside itself, and nothing else |
| `recommendation-runtime/` (step 5: harness, eight loaders, five persistence modules, eight orchestrator modules, and the three legacy composite seams) | SQL, loaders, persistence and orchestration over an injected `pg`-compatible handle | core's public entry points, and `database-guard` in tests |
| `database-guard/` (implemented, step 3a) | the write-target guard: normalised-host comparison, target descriptors, direct-host derivation | nothing at all |

`database-guard` is implemented (step 3a), and `recommendation-core` carries its boundary harness (step 4B
PR 1, merged as PR #29) plus the modules extracted since (the step 4B PR 2-7 batches): `test/purity.test.js` with its
scanner `test/purity-scanner.js` gates every file under `src/`, `test/index.test.js` pins the surface to
`test/export-surface.json` and asserts the approved `exports` map, `test/surface.test.js` pins each namespace key by key, and `test/hermetic-run.js`
(with `test/hermetic-run.test.js`) proves the suite runs with no `node_modules` reachable. Under `src/` are
the pure `candidates`, `compatibility`, `filtering`, `assembly`, `ranking`, `retention`, `scoring`,
`explanation` and `offers/as-of` modules only; their old paths in
`src/recommendation/**` are identity re-export shims. **A shim is not a copy**: the implementation exists
once, in the package, and a shim is six lines that re-export it.

`recommendation-runtime` now holds the whole impure half under `src/`: the boundary harness
(`test/boundary.test.js` + `test/boundary-scanner.js`, `test/surface.test.js`,
`test/transaction-ownership.test.js`, `test/export-surface.json`), the eight W1 loaders
(`query/`, `candidates/loader.js`, `offers/select.js`, `filtering/{context-loader,pipeline}.js`,
`scoring/load-*.js`), the five W2 persistence modules (`persistence/`), the eight W3 orchestrator
modules (`orchestrator/`), and the package adapter `core-entry.js`. Its entry point
`src/index.js` publishes exactly `{ loaders, orchestrator, persistence }` (RFC §11.5, decision A2), each
namespace is its own module so the root and the declared subpaths are the same objects, and
`package.json` declares the §11.5 `exports` map. `scripts/lib/runtime-package-exports.test.js` proves
the map through Node's resolver from outside the repository, including that `./package.json`, deep
`src` paths and the composite seams are unreachable. Every old path in `src/recommendation/**` is an
identity shim.

One deviation is open, not approved: `src/{candidates,filtering,scoring}/index.js` are the legacy mixed
barrels relocated into this package (unpublished, not in `exports`), because the byte-identical
orchestrator's `require('../candidates')` and the tests' patch seam both need one object at both depths.
`docs/MIXED_BARRELS.md` §5 states the RFC requirement, the alternatives and the owner decision
requested. `src/recommendation/{candidates,filtering,scoring}/index.js` therefore publish the same
composite object through identity shims; the physical split is step 6 work.

## database-guard: non-negotiables

- **Seven exports and no others:** `CONNECTION_TIMEOUT_MILLIS`, `normalizeHost`, `resolveTestDbUrl`,
  `getWriteTestDbUrl`, `describeTarget`, `toDirectUrl`, `normalizeTarget`. The package test asserts the
  list, so adding an export is a deliberate contract change.
- **Zero third-party runtime dependencies.** The package must not require `pg`, `dotenv`, `fs`, or any
  API/engine module. Its test scans the source for `require(...)` and fails on any hit.
- **The guard never loads `.env`.** `getWriteTestDbUrl(env)` takes the environment it is given and
  falls back to `process.env` only when called with no argument; the API and each CLI load `.env` in
  their own bootstrap (`apps/api/src/server.js`, a script's entry point).
- **Guard messages are fixed strings.** Never include a URL, host, credential, or connection string —
  in an error, a log line or a test failure message.
- **Consumers import by relative path** (`../packages/database-guard/src`) until the API package
  migration (step 6) adds `file:` dependencies. Do not add an npm workspace to shorten the path.
- **The API's pool test stays in the API.** `apps/api/test/unit/db-guard.test.js` validates
  `resolvePoolConfig`, `STATEMENT_TIMEOUT_MS` and `APPLICATION_NAME`; moving it here would import `pg`
  into a package that must stay independent of it.

## Commands

```bash
npm run test:database-guard                                    # this package's suite (from the repo root)
cd packages/database-guard && npm test                         # the same suite, from the package
npm run test:scripts                                           # every scripts/lib suite (does not include this one)
npm run test:core                                              # the core boundary harness (no DB, no deps)
node packages/recommendation-core/test/hermetic-run.js          # the hermetic run (no node_modules, no deps)
cd packages/recommendation-core && npm test                    # the same suite, from the package
```

`test:scripts` no longer covers the guard: its test moved out of `scripts/lib/`. If you touch
`scripts/`, run `npm run test:scripts`; if you touch this package, run `npm run test:database-guard`.

## Adding a package

A new package needs its own `package.json` (name, version, `private: true`, zero or explicitly listed
dependencies), its own tests runnable with `node --test` and no database, and a README or AGENTS file
stating its responsibility and prohibited imports. Never add a package that needs the root
`node_modules` to resolve a runtime dependency.
