# AGENTS.md — packages

Scope: `packages/**`. Each directory here is a package with its own manifest, version and tests,
consumed by commit from inside this repository (no registry, no npm workspaces before the roadmap's
step 6). Read the owning package's own instructions first; this file states the rules that apply to
all of them.

## What lives here

| Package | Responsibility | May import |
|---|---|---|
| `recommendation-core/` (step 4) | pure recommendation logic: selection, filtering, assembly, scoring, retention, ranking, explanation | relative paths inside itself, and nothing else |
| `recommendation-runtime/` (step 5) | SQL, loaders, persistence and orchestration over an injected `pg`-compatible handle | core's public entry points, and `database-guard` in tests |
| `database-guard/` (implemented, step 3a) | the write-target guard: normalised-host comparison, target descriptors, direct-host derivation | nothing at all |

At step 3a only `database-guard` has source. `recommendation-core` and `recommendation-runtime` carry
manifests and empty `src/` trees so the four-manifest acceptance criterion is satisfiable; moving
recommendation modules into them is **not** authorized by that step.

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
```

`test:scripts` no longer covers the guard: its test moved out of `scripts/lib/`. If you touch
`scripts/`, run `npm run test:scripts`; if you touch this package, run `npm run test:database-guard`.

## Adding a package

A new package needs its own `package.json` (name, version, `private: true`, zero or explicitly listed
dependencies), its own tests runnable with `node --test` and no database, and a README or AGENTS file
stating its responsibility and prohibited imports. Never add a package that needs the root
`node_modules` to resolve a runtime dependency.
