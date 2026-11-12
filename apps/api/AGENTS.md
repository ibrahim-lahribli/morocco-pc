# AGENTS.md — HTTP API

Scope: `apps/api/**`. The contract is `docs/api/CONTRACT.md` (v1.10.0); the authoritative OpenAPI
document is `contract/openapi-1.10.0.json` (byte-compared by the snapshot test since step 3b moved it
out of this app's test directory). This layer owns the HTTP surface and nothing else: `engine.js` is the
only module allowed to require `src/recommendation/**`, and a test enforces it.

## Non-negotiables

- **No engine logic here.** Selection, scoring, ranking and explanation belong to the engine; the API
  validates input, calls the engine, persists through it, and presents persisted rows.
- **POST and GET share one read path**, so they cannot disagree about a persisted field.
- **Own the contract.** One authoritative OpenAPI document at `contract/openapi-<version>.json`,
  byte-compared by the snapshot test; `npm run check:contract` fails if a copy appears elsewhere.
  Never hand-maintain a second copy of a request or response shape; generated frontend types belong to
  each frontend. Backward compatibility is a separate gate against a Git ref, not a second file.
- **Write safety.** `npm run start:api` refuses to start unless the target is provably the TEST branch,
  or `API_ALLOW_SHARED=1` is set explicitly. Never set that flag to make a local run work.
- **Production credentials.** The deployed service connects as `morocco_pc_api` (column-scoped
  `SELECT`/`INSERT`, no `UPDATE` anywhere), never the owner role. Environment values are supplied by
  the host; nothing is committed and nothing is printed.
- **Errors and limits are part of the contract.** A 503 means "no active scoring model"; the document
  declares 429/500 on every route and a test fails an undocumented one. `TRUST_PROXY` names the
  trusted proxy (default off) and the default-off case is tested.

## Commands

```bash
npm run test:api          # DB-free: fastify.inject + stubbed collaborators
npm run test:api:db       # end-to-end against the TEST branch (nightly; writes, then asserts residue 0)
npm run start:api         # the API (TEST branch, or API_ALLOW_SHARED=1)
node scripts/smoke-api-role.js --confirm-shared   # run the API as the production role (operator-gated)
node scripts/check-deployed-role.js               # read-only: does the deployed app use the role?
```

`test:api:db` fails fast when `TEST_DATABASE_URL` is missing or targets shared; it never skips.

## Gotchas

- **A 0-build smoke pass is INCONCLUSIVE, not a pass.**
- **The role self-check is the contract.** A failed privilege answer rolls the role back; a re-grant
  after a new Layer 4 table is an additive `GRANT`, because `apply-api-role.js` refuses an existing
  role.
- **Dedupe is catalog-aware.** A POST that reuses a pass does not write new rows; an end-to-end test
  that expects a fresh pass must not be a dedupe hit.
- **Latency includes database round trips.** A pass pays `statements × RTT` before the engine does any
  work; measure the band with `scripts/measure-db-roundtrip.js` rather than assuming.

Deployment procedures: `docs/RECIPES/deploy-eu-colocation.md`, `docs/RECIPES/release-in-two-stages.md`.
Role provisioning: `docs/database/recipes/provision-the-api-role.md`.
