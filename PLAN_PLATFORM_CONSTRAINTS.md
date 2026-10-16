# PLATFORM PLAN — shared constraints, safety protocol and self-review protocol (P0–P3)

**Purpose of this file:** the SINGLE owner of the rules the four plan files of this program
(`PLAN_PLATFORM_P0.md` … `PLAN_PLATFORM_P3.md`) work inside. Each plan cites this file instead of
restating the rules, so a rule change lands in exactly one place. A plan keeps only what is specific
to it — an owner gate, a contract change, a run order — and marks it there.

**Date:** 2026-10-15 · **Branch:** `agent/platforms`.

**Measurement log.** Passing test counts are VOLATILE: they move with every commit, and a plan that
embeds one is stale by the next commit. Plans therefore state `0 fail` and point at the dated entry
in `DEVELOPMENT_NOTES.md` — the measurement log — instead of restating a count. Counts of DATA (row
counts, migration counts, schema digests) stay where a dated execution record states them: those are
evidence for one run, not a status claim.

## Global Constraints

### Measurement and honesty

- **Do not raise a budget, threshold or timeout to make a measurement pass.** Re-measure instead. A
  raised budget already hid OG-26 once, and a weakened gate is a lie about the system.
- **Never weaken a gate, skip a test, or silence a red run to get green.** A red result is recorded,
  not suppressed. Capture a command's own exit status; never read it off a pager or `grep`.
- **Every performance claim carries its four facts** — the command, the date, the target host and
  the region. Latency claims come from `scripts/measure-api-pass-phases.js` or the HTTP load
  profile; a number without those four is not evidence.
- **A gate that cannot prove it cleaned up has not proved anything.** A probe that creates a role, a
  row or a fixture removes it in `finally`, asserts residue 0 LAST, and fails the run when cleanup
  fails. `process.exit(code)` ignores `process.exitCode`, so fold a cleanup verdict into the exit
  path explicitly.
- **Operator actions are recorded, not implied.** Every owner-gated step ends with the exact
  command/URL and a dated `DEVELOPMENT_NOTES.md` entry (plus `docs/briefs/requests.md` when the ask
  belongs to another owner).

### Engine

- **The engine stays pure.** No DB access outside the loaders/orchestrator, no clock reads, no
  randomness, no input mutation. `Decision 17`'s stage order is pinned by tests.
- **Determinism is a requirement.** Identical DB state + query + model version must yield identical
  builds, scores, ranks and text. A change that batches or reorders statements must prove the
  persisted rows are byte-identical before and after, not merely that the statement count dropped.

### API

- **No engine logic in `apps/api/`.** Only `apps/api/src/engine.js` may require
  `src/recommendation/**`, and only through stage barrels; `import-boundary.test.js` enforces it and
  must stay green.
- **The API never recomputes a persisted fact.** A value absent from the database is `null`, never
  derived (Decision 36 item 4).
- **Price provenance is never inflated.** `price_status` is `"verified"` only when EVERY component's
  persisted `offer_class` is `VERIFIED`; anything else is `"indicative"`, with the French
  `disclaimer`.
- **The beta option stays pinned.** `engine.js` passes `{ allow_unverified_seed_offers: true }`
  always; it is not a request field and must not become one.
- **Unknown body fields are 422**, not dropped (`additionalProperties: false`,
  `removeAdditional: false`); a numeric-string budget stays rejected (`coerceTypes: false`).
- **The committed snapshot is the contract.** The OpenAPI snapshot is compared to the served
  document; a route added without a snapshot update is a red suite. One snapshot at a time — never
  leave a superseded one in the tree.
- **DB-free tests stay DB-free.** `test:api` uses `fastify.inject` + stubs and runs in the push/PR
  job; anything needing the real engine goes to `test:api:db` (TEST branch, residue 0, fails fast
  when `TEST_DATABASE_URL` is missing or targets shared).

### Database

- **Migrations only through the ledger** — a new sequential file, never renumber or edit a committed
  migration, never replay by hand.
- **Never write to the shared Neon database outside the ledger**, and never apply a migration to
  shared without a recorded restore point (`--restore-point=<id>` matching `^[A-Za-z0-9_-]{8,}$`;
  `--baseline` is guarded too).
- **Never reset, drop or truncate shared.** It is the only dev DB and is never a write test target.
- **Write-capable tests go through `scripts/lib/db-url.js` and `TEST_DATABASE_URL` only.**
  `getWriteTestDbUrl()` returns a pg **config object**, not a string.

### Secrets, docs and gates

- **No secret ever enters the tree, a log line or a message.** Values live in GitHub secrets and the
  host's secret store; the repo holds key names in `.env.example` only. Errors are logged without a
  body, a URL or a credential.
- **The API's write-target guard stays on.** Reaching `DATABASE_URL` requires
  `API_ALLOW_SHARED=1` explicitly, and only in a production-role configuration.
- **Docs are CRLF** (`docs/**`, `database/**`, `CONTEXT.md`, `DEVELOPMENT_NOTES.md`);
  `docs/RECOMMENDATION_ENGINE_DECISIONS.md` also carries a UTF-8 BOM. Never normalize an existing
  file's endings.
- **No new runtime dependency without an explicit owner decision.** Adding one means updating
  `package.json`, the lockfile, `AGENTS.md` §3, and CI's `npm ci`.
- **A documentation change moves its gates with it.** Adding a decision entry breaks `verify-docs` by
  design: bump the heading/`Status:` counts in `scripts/verify-docs.js`, refresh the
  `database/migrations/` range in `AGENTS.md` §4 when a migration lands, and run
  `npm run gen:decisions` (`node scripts/gen-decision-index.js --check`). A migration also needs
  `npm run gen:schema` after it is applied.
- **Edit a CRLF file inside one physical line.** `str_replace` ignores whitespace across a line
  wrap, so an anchor that spans a wrap silently joins the two lines; keep anchors wholly inside one
  physical line, or edit through an exact `split(from).join(to)` script.

## How to run this safely

- **`git status` first.** This is a shared checkout; another agent may hold uncommitted work. Commit
  with an explicit pathspec rather than staging, so the index and other agents' staged files are
  untouched.
- **Branch-first for anything write-capable.** The shared database is never a test target.
  `run-seeds.js` ignores `--test-db` and routes nothing, so a seed reaches the branch through an
  explicit target; apply a migration to the branch with `--test-db`.
- **Keep the original target intact as the fallback** while a replacement is introduced (a new
  region or database), and repoint the API only after a parity check on the ledger tail, the table
  list, the row counts and the schema digest is clean.
- **Prepare owner-gated steps, then record them.** A sprint that needs a human (a GitHub dispatch,
  cloud accounts, database DDL on shared) ends with the exact command/URL and a place to record the
  outcome. Do not create cloud resources, roles or accounts on your own initiative.
- **One commit per contract change.** A contract change updates `docs/API.md`, `docs/TEST_MAP.md`
  and the committed snapshot together.
- **The golden harness refuses to run while ANY unmarked `recommendation_query` row exists** — check
  `--cleanup-orphans` before blaming a change; a leftover from another harness blocks the run.
- **Read `apps/api/src/app.js`'s header before touching it**: the route-plugin ordering (routes
  registered inside a plugin, after the `onRoute` hooks) is load-bearing for both swagger and rate
  limiting.
- **Capture every command's own exit status**, and read a failure's output rather than a filtered
  summary.

## Self-review protocol

Run this against a plan before executing it, and record the verdict per plan under "Self-review
results" below. A plan is not ready to execute until all five are ✔.

- **Spec coverage** — every item of the plan's spec has a sprint; nothing extra is planned.
- **Step scan** — every step names a file/command and an expected result; no step says "handle edge
  cases" or transcribes a function body the signature and tests already determine.
- **Type consistency** — shared names (`readRecommendationResult`, `buildApp`, `catalogVersion(db)`,
  `getWriteTestDbUrl()`, …) are spelled once each across sprints.
- **Review Focus** — every failure mode in the plan's own "Review Focus" has an owning sprint and a
  numbered test scenario.
- **Proportion** — the plan is shorter than the code it describes and contains no implementation
  bodies.

## Self-review results

### P1 — latency program

- **Spec coverage:** each of the roadmap's five P1 steps and its target has a sprint (1, 2, 3, 4,
  5–6, and the target in the whole-plan DoD). ✔
- **Step scan:** every step names a command and an expected result; no step says "handle edge cases";
  no step transcribes a function body the signature and tests already determine. ✔
- **Type consistency:** `leadClient`/`client`, `catalogVersion(db)`, `readRecommendationResult`,
  `persistRanked({ queryId, selected })` are used with one spelling each across sprints. ✔
- **Review Focus:** all five lines have a named owning sprint; 2.3, 5.3 and 6.3 carry the tests for
  items 2, 5 and 5. ✔
- **Proportion:** this plan is shorter than the code it describes and contains no implementation
  bodies. ✔

### P2 — API surface

- **Spec coverage:** the roadmap's P2 list maps to Sprints 1 (vocabulary/final snapshot test), 2
  (trustProxy), 3 (catalog endpoints), 4 (CORS + 429), 5 (remainder of the OpenAPI surface). The two
  items already done (v1.1 contract, snapshot + tests) are recorded as done in the header rather
  than re-planned. ✔
- **Step scan:** each step names a file, a command and an expected result; no step says "as needed"
  or transcribes a body. ✔
- **Type consistency:** `listUseCases(configuration)`, `buildApp({ pool, repository, engine, env,
  logger })`, `parseOrigins(raw)`, `readRecommendationResult(db, queryId)` and the `slug` field are
  spelled once each. ✔
- **Review Focus:** all five lines have an owning sprint and a numbered scenario (2.2, 1.5,
  3.3/3.5, 3.2, 4.5). ✔
- **Proportion:** no implementation bodies; every step is a decision the implementer could not make
  alone. ✔

### P3 — ops

- **Spec coverage:** the roadmap's P3 list maps to Sprint 1 (dispatch the recurring job until
  `test:api:db` is verified), Sprint 2 (rehearse the production role), Sprint 3 (staging +
  production + the migration deploy step), Sprint 4 (error tracking, uptime on `/v1/health`, log
  shipping), Sprint 5 (the `fetched_at`/provenance extension of the freshness gate). ✔
- **Step scan:** each step names a command, a file or an owner action and the result that means it
  passed; no step says "configure monitoring appropriately". ✔
- **Type consistency:** `getWriteTestDbUrl()` (config object), `ping(pool, PING_TIMEOUT_MS)`,
  `buildApp({ pool, repository, engine, env, logger })`, `--fail-days=N` and `--restore-point=<id>`
  are used with one spelling each. ✔
- **Review Focus:** all five lines have an owning sprint and a numbered scenario (4.4, 3.1, 2.3,
  1.3, 1.2). ✔
- **Proportion:** no implementation bodies; the two new scripts are specified by their interfaces
  and their tests. ✔
