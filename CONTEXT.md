# CONTEXT — current state

`morocco-pc` recommends complete PC builds for the Moroccan market. Given a budget, a use case, an
optional resolution and a priority, the engine selects compatible components, assembles, scores,
ranks and explains whole builds, and persists the pass. This file is the current state ONLY: what
exists, where it runs, and the numbers as of **2026-11-02**. It carries no history — that lives in
`docs/RECOMMENDATION_ENGINE_DECISIONS.md` (why) and in git (when).

Open work is [`docs/OPEN_POINTS.md`](docs/OPEN_POINTS.md). Programmes and sprints are
[`docs/ROADMAP.md`](docs/ROADMAP.md).
Extraction-programme decisions are recorded in [`DECISIONS.md`](DECISIONS.md).

## 1. The four layers (PostgreSQL, 44 tables, 23 migrations)

| Layer | Tables | State |
|---|---|---|
| 1 — Catalog / Hardware | `product`, `product_family`, `product_variant`, `<role>_spec`, explicit compatibility tables | 113 products, 24 variants, 84 families |
| 2 — Performance / Assessment | `benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model` | 319 assessment rows over 112 of 113 products |
| 3 — Market | `store`, `store_offer`, `price_history` | 114 offers, 2 stores, 0 with retailer provenance |
| 4 — Recommendation | `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component`, `build_rejection`, `recommendation_swap` | 12 queries / 16 results / 16 candidates on shared — API passes from the live demo, which writes to shared (not user data; expected until the demo moves, R-14) |

`database/migrations/001`–`023` are THE schema; `docs/SCHEMA_REFERENCE.md` is its generated mirror.
Every database stands at ledger **23** (`node scripts/run-migrations.js --check` → no pending file).

## 2. The engine (pure JS, `src/recommendation/`)

No DB access, no clock, no randomness inside a stage; loaders and the orchestrator are the only
impure edges. One pass, in order:

| Step | Module | What it does |
|---|---|---|
| 1 | `query/` | `loadQueryInput`: one SELECT, budget as an exact decimal string |
| 2 | `offers/` | Stage 1 price pre-selection (30-day freshness window, Decision 7) |
| 3 | `candidates/` | pool selection (Engine 2B/2C) |
| 4 | `filtering/` | HARD/UNKNOWN/REJECT per candidate + the compatibility context (Engine 2D) |
| 5 | `scoring/` | candidate scores (Engine 4 STEP 2) |
| 6 | `retention/` | top-K per role, price bands (`roleTargets`), cheapest-per-role reservation (Decision 27) |
| 7 | `assembly/` | DFS over `EXPANSION_ORDER`, pairwise re-checks, per-pair quota, VRAM floor, build cap (Engine 3) |
| 8 | `scoring/` | `build_score` = weighted effective scores − `unknown_compat_penalty` × UNKNOWN pairs |
| 9 | `ranking/` | `rankBuilds` (score DESC → price ASC → code-unit signature), then `selectArchetypes` (≤3 pair-distinct) |
| 10 | `explanation/` | Engine 6 text + `deriveReasons` codes from one shared fact set |
| 11 | `orchestrator/commit.js` | ONE write transaction: results, builds, components, rejections, pass facts, swap links |

`orchestrator/run.js` wires steps 1–10 inside a caller-owned `REPEATABLE READ READ ONLY` snapshot;
`orchestrator/full-run.js` composes snapshot → rank → diversity → explanation → commit.
The status vocabulary `PASS | FAIL | UNKNOWN | CONDITIONAL` is load-bearing: NULL means UNKNOWN and
UNKNOWN is never treated as PASS or FAIL. Determinism is enforced: ties break on `product_id` ASC
(then `product_variant_id` NULL-first), never on a UUID draw or `localeCompare`.

## 3. Environments

| Name | What it is | Serves | Use it for |
|---|---|---|---|
| `DATABASE_URL` (shared) | the only dev database | `launch-v2@2.4.0` (newest ACTIVE row) | read-only inspection as the owner role |
| `TEST_DATABASE_URL` | a Neon branch, full snapshot | `launch-v2` 1.0.0–2.4.0 ACTIVE | every write-capable test and harness |
| `TARGET_DATABASE_URL` (EU) | `morocco-pc-eu`, `aws-eu-central-1` — 113 products, 84 families, 24 variants, 114 offers, 319 assessments, 7 `scoring_model` rows (6 ACTIVE) | `launch-v2@2.4.0`, pinned by `SCORING_MODEL_PIN` in `render.yaml` (Decision 63, PROVISIONAL) and measured ACTIVE on the branch | the release target; served by the live beta host `morocco-pc-api-eu` (free plan, sleeps when idle) |

The shared database is never reset, dropped or truncated. Write-capable scripts route through
`packages/database-guard/src/index.js`; the API refuses to start against anything but the TEST branch unless
`API_ALLOW_SHARED=1`. Real-database writes need a recorded restore point and leave an audit line in
`database/migration-applies.jsonl`.

**Deployed origins:** one. `https://morocco-pc-api-eu.onrender.com` (Render Free, Frankfurt, created from
`render.yaml` on 2026-11-02, fronting the EU database as `morocco_pc_api`, answering
`engine_version: "d2de4fb"`) is the private-beta host: it serves the pinned release model and both
gates measured it — `check-origin-readiness` PREFLIGHT OK, `check-deployed-role` PASS. It also sleeps
after 15 idle minutes (its log hostname carries `hibernate`), which is what R-08 still tracks.

## 4. Scoring models and what is served

`scoring_model` holds 7 rows: `seed-minimal-v1@1.0.0` (INACTIVE) and six ACTIVE `launch-v2` versions
1.0.0 … 2.4.0 (2.0.0 resolution floors, 2.1.0 archetype objectives, 2.2.0 pair quota 2, 2.3.0 uniform
CPU depth 10, 2.4.0 CPU-only depth 10). `apps/api/src/repository.js` selects the newest ACTIVE row, so
**shared serves `launch-v2@2.4.0`** and sets no pin — that is insertion order,
so a seed apply could move it. The EU service is the exception, and it is MEASURED rather than declared:
`render.yaml` sets `SCORING_MODEL_PIN: launch-v2@2.4.0` (Decision 63), the deployed process boots with
`scoring_model: "launch-v2@2.4.0"` instead of the newest-ACTIVE fallback, and **52** committed passes record
`recommendation_query.scoring_model_id` = 2.4.0 (measured 2026-11-06). R-06 is closed on that evidence.
`launch-v2@2.4.0` is the version the gate measures green (82 PASS / 3 EXPECTED-RED / 1 UNKNOWN); it is
adopted for the private beta as an explicit PROVISIONAL OVERRIDE of Decision 57 item 3, NOT as a
satisfaction of it — A1/A3/A4 are still `hypothesis` and OG-43 is open.

## 5. Measured numbers (2026-11-02; the offer-freshness date, the EU pass count and the R-14 parity
DIFFs re-measured 2026-11-06; the baseline test counts re-measured 2026-11-15; `test:unit`, `test:scripts` and `test:core` re-measured again 2026-11-19 on `master` = `43fd8c8`, after PR #41 merged)

- `npm run test:unit` **982 pass / 0 fail / 0 cancelled** (982 total); `npm run test:scripts` **823 pass / 0 / 0** (823 total);
  `npm run test:api` **193 / 0 / 0**; `npm run test:database-guard` **15 / 0 / 0**; `npm run test:core`
  **432 tests: 430 pass / 0 fail / 2 skipped / 0 cancelled** (the two skipped cases need file symlinks,
  which this platform refuses); `node packages/recommendation-core/test/hermetic-run.js` **PASS**. `test:unit`, `test:scripts` and `test:core` were re-measured 2026-11-19 on `master` = `43fd8c8`
  (Node 24.21.0, npm 11.19.0); `test:api` and `test:database-guard` keep their 2026-11-15 figures. Two
  extractions have moved tests since that baseline: step 4B PR 2 moved 234 tests from `test:unit` to `test:core`
  and added 18 (26 static / 30
  effective-minimum assertions: the core surface 3, the characterization replay 12 and the ownership-split
  filtering barrel 3 — which is why the two counts moved and no test disappeared). Step 4B PR 4 then
  moved the 70 Engine 5a ranking tests from `test:unit` to `test:core` and added one `ranking` namespace
  assertion, so on merged `master` (`43fd8c8`) `test:unit` reads **982** and `test:core` **432**.
  `npm run test:api:db` **17 / 0** (nightly only — it writes to the TEST branch, and was not re-measured
  here). `test:scripts` therefore read **822** at `e8d5af9`, not the
  750 recorded on 2026-11-15: five `*.test.js` files were added under `scripts/lib/` between `4ba4122`
  and `e8d5af9` and none removed, so the suite grew rather than a count being reclassified. It reads **823**
  on merged `master` (`43fd8c8`): PR #41 added the one remaining test (`a batch tag the inventory has never
  seen cannot leak into PR 2` in `scripts/lib/test-ownership-audit-cli.test.js`).
- **Step 4B PR 3 — merged** (PR #36 merged 2026-11-18 as `57bca1c`). The figures below are the **historical
  2026-11-17 measurement** taken on the batch's implementation snapshot `89b0bb2`, which was `master` =
  `de659ad` plus the assembly batch on its branch; they were **not** re-measured after the merge. The
  implementation snapshot remains `89b0bb2`: two subsequent commits, `11ca631` and `2c19a87`, changed
  documentation only (`CONTEXT.md` and `docs/development/extraction-workflow.md`), not implementation or the
  measured counts. PR #37 (`07dfd22`) then changed the `packages/recommendation-core` package description
  without changing implementation:
  `npm run test:unit` is unchanged at **1052 pass / 0 fail** — the seven `assembly/*.test.js` files stayed
  in the runtime tree and kept their counts — and `npm run test:core` is **361 tests: 359 pass / 0 fail /
  2 skipped / 0 cancelled**. The net +1 is the key-by-key `assembly` namespace test added to
  `test/surface.test.js`; no test moved between the two commands.
- **Step 4B PR 4 — merged** (PR #41 merged 2026-11-19 as `43fd8c8`). The Engine 5a
  ranking batch (`step-4b-pr4`, baseline `07dfd22`, 4 modules byte-identical, 32 / 32 across the three
  batches) moved the ranking barrel and its three stage modules and published a fifth namespace. Measured at
  the implementation commit `64edd94`: `npm run test:unit` **982 pass / 0 fail** (was 1052 — 70 ranking tests
  moved out of `src/`), `npm run test:core` **432 tests: 430 pass / 0 fail / 2 skipped** (was 361: +70 moved,
  +1 new `ranking` namespace assertion), `npm run verify:ownership -- --inventory=pr4` **92 tests / 265
  assertions, unchanged** (3 moved, 1 stayed), `npm run check:whitespace` PASS (one blank line at EOF excused
  only because the move is proved byte-identical). The branch-scoped ownership (92 tests / 265 assertions) and
  whitespace figures above were not re-run after the merge, which moved no byte of the batch (the merged tree
  `4c005f39` is identical to the branch head `73979f8`'s tree); the test-suite counts (`test:unit` 982,
  `test:core` 432) were re-measured on merged `master` (`43fd8c8`) and are documented above.
- **Step 4B PR 5 — merged** (PR #44 merged 2026-11-19 as `1a9d8cf`). The Engine 2D retention batch
  (`step-4b-pr5`, baseline `0f439e0`, 5 modules byte-identical, 37 / 37 across the four batches at the time)
  moved the retention barrel and its four stage modules and published a sixth namespace. The figures below
  are the **historical measurement at the implementation commit `0bd7e6f`**: `npm run test:unit` **942 pass /
  0 fail** (was 982 — 40 retention tests moved out of `src/`), `npm run test:core` **473 tests: 471 pass / 0
  fail / 2 skipped** (was 432: +40 moved, +1 new `retention` namespace assertion), `npm run
  verify:ownership -- --inventory=pr5` **93 tests / 190 assertions** (4 moved, 1 stayed — `retain.test.js`
  then imported `../scoring/candidate-score`, which had not moved), `npm run verify:extraction` **PASS 37 /
  37**, `npm run check:whitespace` PASS. PR 6 moved that last retained test into the core, so the PR 5
  inventory now reports its four moved files only: **40 tests / 123 assertions**.
- **Step 4B PR 6 — branch `feat/core-scoring-extraction` (not merged when this was measured).** The Engine 4
  pure scoring half (`step-4b-pr6`, baseline `1a9d8cf`, 5 modules byte-identical — `configuration`,
  `use-cases`, `effective-score`, `candidate-score`, `build-score` — 42 / 42 across the five batches) moves
  those modules and their five test suites into the core, publishes a seventh namespace `scoring` (14 pure
  keys; `loadScoringModel`, `loadComponentAssessments` and their SQL constants stay runtime), and closes the
  deferred PR 5 ownership gap by moving `retention/retain.test.js` into the core as
  `packages/recommendation-core/test/retention-retain.test.js`. `src/recommendation/scoring/index.js` is
  unchanged and resolves through the five identity shims. Measured at the branch head: `npm run test:unit`
  **794 pass / 0 fail** (was 942 — 148 scoring and retain tests moved out of `src/`), `npm run test:core`
  **622 tests: 620 pass / 0 fail / 2 skipped** (was 473: +148 moved, +1 new `scoring` namespace assertion),
  `npm run test:scripts` **823 pass / 0 fail**, `npm run verify:ownership -- --inventory=pr6` **184 → 184
  tests and 402 → 402 assertions** (6 moved, 3 stayed: `scoring/index.test.js` and the two loader tests),
  `npm run verify:extraction` **PASS 42 / 42**, `node packages/recommendation-core/test/hermetic-run.js`
  PASS, `npm run check:whitespace` PASS.
- **Current extraction state:** `packages/recommendation-core/` publishes **nine** namespaces —
  `candidates`, `compatibility`, `filtering`, `assembly`, `ranking` and `retention` (PR #44, `1a9d8cf`),
  `scoring` (PR #45, `0f86f53`), and `explanation` + `offers` (PR #49 merged as `2569647`, PR #50 merged
  as `6fd3122`; the CI gates below were cut at `45133d5`, the PR #47 merge). `test/surface.test.js` and
  `test/export-surface.json` pin them key by key, behind identity re-export shims at the old
  `src/recommendation/**` paths. `package.json` declares the RFC §11.4 `exports` map as **exactly 11
  static subpaths**: `.` → `src/index.js`, the nine namespaces → `src/<ns>/index.js`, `./errors` →
  `src/candidates/errors.js`, and `./offers` → `src/offers/as-of.js` (there is no `offers/index.js`), with
  no `./package.json` export. **Superseded for the runtime side by the entry below; the sentence was true
  on 2026-11-20 and is kept as the dated measurement it was.**
- **Step 5 — runtime extractions complete, PR #72 unmerged (branch `feat/step-5-w3-orchestrator`, base
  `f1658d9`).** All 23 runtime-target modules now live in `packages/recommendation-runtime/src/`: the
  eight W1 loaders (`query/`, `candidates/loader.js`, `offers/select.js`,
  `filtering/{context-loader,pipeline}.js`, `scoring/load-*.js`), the five W2 persistence modules
  (`persistence/`: `persist-ranked`, `persist-pass-facts`, `persist-rejections`, `validate-selected`,
  `validate-rejections`), and the eight W3 orchestrator modules (`orchestrator/`: `run`, `snapshot`,
  `full-run`, `commit`, `swap-preview`, `swap-commit`, `compute`, `index`). Every old path in
  `src/recommendation/**` is an identity re-export shim, and `npm run verify:extraction` reports
  **70 / 70 blob-identical moves across 12 batches** (W3's batch `step-5-w3-orchestrator` on baseline
  `598e442` is 8 / 8). The entry point publishes the RFC §11.5 namespaces
  `{ loaders, orchestrator, persistence }` (the third added by W3, when its consumers existed), and
  `package.json` declares the §11.5 `exports` map — `.`, `./loaders`, `./orchestrator`, `./persistence`,
  no `./package.json`, no deep `src` path — proved through Node's resolver from a throwaway consumer by
  `scripts/lib/runtime-package-exports.test.js`. Three composite seam files
  (`src/{candidates,filtering,scoring}/index.js`, unpublished) are the legacy mixed barrels relocated so
  the byte-identical orchestrator's `require('../candidates')` resolves at both depths; that relocation
  is **one open architectural question**, stated with its alternatives in
  `packages/recommendation-runtime/docs/MIXED_BARRELS.md` §5 and awaiting the owner. The published
  surface is the one decision A2 approved as written on 2026-11-11 (§11.4/§11.5), so this branch
  implements an approved contract and what remains is the Step 5 **acceptance review** of that
  implementation, not a ratification of the interface. Measured on the branch head `caa236f`
  (2026-11-25): `test:unit` **774**, `test:scripts` **970**, `test:core` **697** (695 pass / 2 skipped
  on Windows), `test:runtime` **205**, `test:api` **193**, `test:database-guard` **15**. Still open: the
  Step 5 acceptance review, including the DB-backed suite on the isolated TEST branch required by
  RFC §19.3 (UNKNOWN — not run for this branch), `apps/api/src/engine.js`
  still importing `src/recommendation/**` (step 6), and the step-6 split of the three composites.
- **CI boundary gates (2026-11-20).** One contract, `scripts/lib/core-approved-interface.js`, is enforced
  by both sides: `scripts/lib/core-package-surface.test.js` compares the declared `exports` map as a
  whole (a missing, additional or wrongly mapped subpath fails; `./package.json` is rejected by name even
  when its file exists), checks every namespace's RFC exports, and **realpaths** every target so it must
  stay inside the package — a symlink escape fails and a nonexistent target fails closed.
  `.github/workflows/api-image.yml` bind-mounts that same module read-only and calls
  `runContainerGate`, which self-tests **six** tampered maps inside the container (including an
  unauthorized subpath pointing at an existing valid file) before requiring `engine.js`.
  `scripts/lib/ci-workflow.test.js` pins this wiring and forbids a literal namespace list; the
  assessment-age step stays nightly-only with `continue-on-error: true`, `set +e`, `::warning`, and never
  passes `--strict`. The explanation batch's provenance steps (`check:characterization:pr7` and
  `verify:ownership -- --inventory=pr7 --base=2683713`) run by name in `unit-and-docs`.
- **Runtime harness CI (2026-11-20).** `npm run test:runtime` runs `assert-discovery.js` (exit 1 when a
  required suite is absent, so a glob that matches nothing cannot pass vacuously) and then
  `node --test "packages/recommendation-runtime/test/*.test.js"`; it is a named `unit-and-docs` step, and
  the package declares no dependencies and touches no database.
- **Integrated measurement (2026-11-20).** On the rebased tree (`master` `6fd3122`, the PR #49 +
  PR #50 merge, plus this branch at `36641c1`), measured from the **Node 22 `ci` log** (run 44833739534,
  head `36641c1`): `test:scripts` **894 / 0 / 0**, `test:unit` **726 / 0 / 0**,
  `test:core` **697 tests: 697 pass / 0 fail / 0 skipped / 0 cancelled**, `test:api` **193 / 0 / 0**,
  `test:database-guard` **15 / 0 / 0**, `test:runtime` **85 / 0 / 0**, hermetic run **697 / 0 / 0**,
  `verify:extraction` PASS **47 / 47**, every `check:characterization` pr2–pr7 OK, and every
  `verify:ownership` inventory PASS. `test:scripts` grew from **867** pass / 27 suites on `master`
  `6fd3122` to **894** pass / 30 suites here (the new `core-package-surface.test.js` contract plus the
  added CI-wiring assertions), and `test:runtime` grew from 61 at PR #50's `89e761d` to 85 at its merged
  head. The core's 697-test
  total is the same on Node 24 (Windows) and Node 22 (Ubuntu); the split is not. On Ubuntu CI all 697
  pass; on this Windows checkout the two symlink/junction cases are SKIPPED (695 pass / 2 skipped),
  because the platform refuses the file symlinks they need. CI is the authoritative figure for a merge
  decision; a local Windows run must never be reported as 697 passed.
- **C7 — runtime package in the API image (2026-11-20).** `apps/api/Dockerfile` copies
  `packages/recommendation-runtime/package.json` and `src/` after `npm ci`, `.dockerignore` keeps
  `test`/`docs` out, and `api-image` triggers on `packages/recommendation-runtime/**` on push and PR.
  The image gate asserts presence (`package.json`, `src/index.js`, no `test/` or `docs/`) and
  loadability by path, and deliberately does NOT pin the W0 empty surface. Root `npm ci` is not
  linkage: the root manifest has no `workspaces` and no dependency on the package, so a bare
  `require('@morocco-pc/recommendation-runtime')` stays `MODULE_NOT_FOUND` and only
  `/app/packages/recommendation-runtime` resolves. Negative proof: **UNVERIFIED** —
  `api-image.yml` has no negative-build step and the image run's log contains no `c7-neg` evidence, so
  the absent-COPY failure mode (the presence gate exits 1 and `require` raises `MODULE_NOT_FOUND`) is a
  design argument, not a measurement.
- Doc gates: `gen-decision-index --check` **0**, `verify-docs --offline` **0**,
  `gen-schema-reference --check` **0**.
- `check-catalog-identity.js` **PASS on all three**: shared 113 of 113, TEST 113 of 113 and EU 113 of
  113 after the 2026-11-02 upgrade (EU was 100 of 100 before it). Restore points:
  `shared-backup-pre-028-20261102-1300`, `eu-backup-pre-028-20261102-1312`, and for the whole EU
  upgrade `eu-backup-pre-upgrade-20261102-1427` (`br-divine-king-b97uxsr5`).
- EU after seeds 023–028: **113 products, 84 families, 24 variants, 114 offers, 319 assessments, 22
  cooler socket rows, 7 `scoring_model` rows (6 ACTIVE), identity gaps 0**, ledger at 23. Parity with
  shared is MATCH on ledger-files, `tables` 44, `schema-shape` 470 (digest `4110c1517a14a0ef` on both
  sides), model pins, product, variant, offer, assessment, model, benchmark and store counts;
  the only differences are the six Layer-4 row DIFFs R-14 tracks, shared vs EU: query 12 vs 52,
  result 16 vs 142, candidate 16 vs 142, component 126 vs 1093, rejection 24 vs 104, preset 0 vs 52
  (the EU side is the deliberate preset shelf, the shared side the demo residue).
- `check-offer-provenance.js` **INCONCLUSIVE** everywhere: 114 seed offers, 0 verified, 2 stores on
  the reserved `example.ma` domain. `check-offer-freshness.js` reports the first SEED expiry at
  **2026-12-01** (24.3 days from 2026-11-06).
- Real passes through `orchestrator.runRecommendation`, `launch-v2@2.4.0`: GAMING 21 500 @1440p →
  25 builds over 13 distinct (CPU, GPU) pairs, rank-1 score 60.83 at 19 976; OFFICE at 12 000, 20 000
  and 30 000 all return the identical 9 076 build (score 59.60) — `build_score` carries no budget term.
- `node scripts/check-deployed-role.js` — the EU host answers **PASS** (every
  `morocco-pc-api` tagged session authenticated as `morocco_pc_api`). The demo origin answered
  **FAIL** (`neondb_owner`) until it was suspended on 2026-11-06 with deletion pending, so R-05 stays
  open until the service is deleted and the owner password rotated.
- One full pass on the EU origin: **201 in 3209 ms**, 3 builds, `catalog_version
  e9997010de60e49634396970f6b23557`; swap-preview 200 (compatibility PASS, 999 → 1499, total 20 195,
  `within_budget: false`); everything deleted back to **0/0/0/0/0/0**. The 3209 ms is on `plan: free`
  (0.1 CPU), which `render.yaml` says is not the plan to measure V1 on.

## 6. The HTTP surface (`apps/api/`)

Thin Fastify layer, contract **v1.10.0**, ten `/v1` paths, no engine logic — `engine.js` is the only
module allowed to require `src/recommendation/**`, and a test enforces it. It serves health, meta,
presets, the read-only catalog (keyset paginated, provenance-labelled prices), the recommendation
POST/GET pair, the swap preview and the append-only swap commit. POST and GET share one read path, so
they cannot disagree about a persisted field. Rate limits are per-IP and `TRUST_PROXY` names the
trusted proxy (default off). Writes are deduped by a catalog-aware key. See `docs/api/CONTRACT.md`.

The `apps/web` Next.js app is a separate package consuming the pinned OpenAPI snapshot; it owns no
engine logic and is out of scope for this file.

## 7. Commands

| Command | Purpose |
|---|---|
| `npm run test:unit` / `test:scripts` / `test:api` | DB-free suites (engine / scripts / HTTP) |
| `npm run test:api:db` | end-to-end HTTP against the TEST branch |
| `npm run start:api` | start the API (TEST branch, or `API_ALLOW_SHARED=1`) |
| `npm run eval:scenarios -- --model=<name@version>` | the 20-scenario golden matrix |
| `npm run gen:decisions` / `gen:schema` | regenerate the two generated docs |
| `npm run verify:docs` (`--live` adds the DB checks) | doc-claim gates |
| `npm run verify:replay -- --test-db` | replay every migration into an empty database and diff |
| `node scripts/run-migrations.js --check` | pending migrations |
| `check-offer-provenance.js` / `check-offer-freshness.js --fail-days=14` / `check-catalog-identity.js` | data gates |

Operational detail, gotchas and dated measurements live in `DEVELOPMENT_NOTES.md`.

## 8. Where the answers are

| Question | File |
|---|---|
| What is still open, with class/status/owner | `docs/OPEN_POINTS.md` |
| Why a rule exists | `docs/RECOMMENDATION_ENGINE_DECISIONS.md` |
| How the pipeline fits together | `docs/engine/ARCHITECTURE.md` |
| What the HTTP surface promises | `docs/api/CONTRACT.md` |
| Programme and sprint history | `docs/ROADMAP.md` |
| How to run one operation | `docs/RECIPES/` |
| Column-level schema truth | `database/migrations/` then `docs/SCHEMA_REFERENCE.md` |
