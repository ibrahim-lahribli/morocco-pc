# System Architecture & Project Separation RFC

**Repository:** `ibrahim-lahribli/morocco-pc`
**Status:** PROPOSED — revised 2026-11-24 (Revision 16). **A1-A6 APPROVED by the repository owner on 2026-11-11** (§21.1); **Option B (separate `recommendation-core` and `recommendation-runtime` packages) is the selected direction** (owner decision, recorded in §1.5). **B1-B8 remain open.** The decision record is approved. **Six implementation steps are complete: the write-target guard now lives in `packages/database-guard/` as a real package (PR #27, merged 2026-11-11 as `3e2f13e`; §9.4); `packages/recommendation-core/` carries a boundary harness that is part of `master` — a loadable `src/index.js`, the purity gate `test/purity.test.js` with its scanner `test/purity-scanner.js`, the export-surface snapshot `test/export-surface.json`, the hermetic runner `test/hermetic-run.js` with `test/hermetic-run.test.js`, and `npm run test:core` plus the hermetic step in `ci.yml` (step 4B PR 1, PR #29, merged 2026-11-15 as `56cbb692`, final head `2297aae`; §11.6, §19.1). The harness is a boundary gate, and the extraction behind it has begun: step 4B PR 2 moved the pure `candidates` modules, the Engine 1 `compatibility` tree and the pure half of `filtering` (PR #32, merged 2026-11-16 as `aa7b398`), and step 4B PR 3 moved the pure Engine 3 `assembly` stage (PR #36, merged 2026-11-18 as `57bca1c`; §25), so `master`'s core entry point publishes seven namespaces — `candidates`, `compatibility`, `filtering`, `assembly`, `ranking`, `retention` (PR #44, merged as `1a9d8cf` on 2026-11-19) and `scoring` (PR #45, merged as `0f86f53`) — behind identity re-export shims at the old `src/recommendation/**` paths, and `apps/api/src/engine.js` still imports those barrels directly (step 6 has not started; §25.2).** **The remaining package extraction is PROPOSED and partly implemented**: step 5 is **in progress** — `packages/recommendation-runtime/` carries its boundary harness, the §11.5 `loaders` namespace and 15 of the 23 runtime-target modules behind identity shims at their old paths, while the 8 `orchestrator/` files and the three mixed barrels have **not** moved (§11.2, §19.1); steps 3b and 6-12 have not started. Step 4B PR 7 — batch `step-4b-pr7`, baseline `2683713`, Engine 6 `explanation` plus `offers/as-of` (5 files byte-identical; `blob-identical: 47 / 47` across the six batches) and the §11.4 `exports` map — is a **BRANCH** (`feat/core-explanation-extraction`), not a merge: it publishes the eighth and ninth namespaces there and finishes the pure-logic extraction, while the runtime half stays in `src/recommendation/`. PR #23 — the proposal itself — **was merged on 2026-11-11** (`0bcb6e3`); merging it published the record as a document and, at that date, implemented none of it. **Revision 10 (§25, 2026-11-18) reconciles this status after the merges: PR #36 is MERGED as `57bca1c`, PR #37 as `07dfd22`, and the four published namespaces are on `master`.** **Revision 11 (§25.2, 2026-11-19) recorded step 4B PR 4 as a BRANCH, not a merge; Revision 12 (2026-11-19) records the merge — PR #41 is MERGED as `43fd8c8`, so `ranking` is the fifth namespace on `master` (§25.2, §23.1).** **Revision 13 (2026-11-19) records step 4B PR 5 — batch `step-4b-pr5`, baseline `0f439e0`, the Engine 2D `retention` stage (5 modules, byte-identical, 37 / 37 across the four batches) — as a BRANCH, not a merge: branch `feat/core-retention-extraction` publishes a sixth namespace, `retention` (§25.2, §23.1).** **Revision 14 (2026-11-19) records the merge of step 4B PR 5 — PR #44 merged as `1a9d8cf`, so `retention` is the sixth namespace on `master` — and records step 4B PR 6 — batch `step-4b-pr6`, baseline `1a9d8cf`, the 5 pure Engine 4 scoring modules (byte-identical, 42 / 42 across the five batches), which also moves `retention/retain.test.js` into the core — as a BRANCH, not a merge: branch `feat/core-scoring-extraction` publishes a seventh namespace, `scoring` (§25.2, §23.1).** **Revision 16 (2026-11-24):** step 4 is **COMPLETE** — PR #49 merged 2026-11-20 as `2569647`, so `explanation` and `offers` are the eighth and ninth namespaces on `master` and the pure-logic extraction is finished; step 5 is **IN PROGRESS** with nine merged PRs (#50 `6fd3122`, #57 `5b5eeb3`, #60 `3565a4d`, #61 `9f0a766`, #63 `1a4551f`, #64 `5399cae`, #65 `6e13eab`, #66 `146e281`, #67 `d21ec21`), which moved 15 of the 23 runtime-target modules and left the 8 `orchestrator/` files; §11.2 and §19.1 now carry the verified inventory with its arithmetic, §19.4 records the `compute.js` decision (owner-decided: Option 1, runtime-internal), the offer-ingestion gap, the `./loaders` deferral and the `test:api:db` nightly failure, and §26 carries the EU operational facts as a dated appendix kept separate from this status.
**Date:** 2026-11-11 (first revision: 2026-11-10). **Revision 3 (2026-11-11):** §21.3 records four owner-confirmed implementation decisions (D1-D4), and §9.2, §9.4, §10.1, §13.4, §15.4 and §19 carry the corrections they exposed: the guard's seven-export interface, the API pool test's ownership, the absent restore-point predicate, the four named manifests, path-only Docker/hosting updates, the Step 7 V2 deferral and the Git-ref compatibility baseline. **Revision 4 (2026-11-11):** current-state corrections only — the script-consumer count in §9.4, the duplicate §15.4 numbering, the since-merged state of PR #23, the documentation paths moved by PR #24 (§16.7), and the §23.4 contradictions register. **Revision 5 (2026-11-11):** implementation-status correction only — PR #27 (`7691b4f`, merged as `3e2f13e`) extracted the guard into `packages/database-guard/` and made the path-only Docker/hosting corrections, so the status line, §3.3, §9.3, §9.4, §13.1-13.2, §13.4, §16.7, §19.1, §19.3, §21.1 (A3) and §23 separate that one implemented step from the still-proposed core/runtime extraction. It also completes the §23.1 `packages/` inventory and corrects the stale package-status sentence in `AGENTS.md` (§23.4 C11). **Revision 6 (2026-11-13):** implementation-status correction only — step 4B PR 1 added the `recommendation-core` boundary harness (PR #29 at head `71fc3b8`, open for review when this revision was written), so the status line, §11.6, §19.1, §23.1, §23.4 (C12) and §23.5 separate a harness from the module moves, and neither `AGENTS.md` nor `packages/AGENTS.md` describes the core as an empty skeleton any more. No recommendation behaviour, contract, schema or approved decision changed. **Revision 7 (2026-11-15):** implementation-status and evidence refresh only — PR #29 was merged (`2297aae` as `56cbb692`, 2026-11-15), so the status line, §11.6, §19.1, §23.1, §23.2, §23.4 (C12), §23.5 and the closing note record the harness as merged rather than open; the §23.1 `packages/` inventory is re-measured on `master` = `56cbb692` (fourteen files: Revision 6's twelve plus `test/hermetic-run.js` and `test/hermetic-run.test.js`); the §11.6 rows describe the merged gate (any `Date()` call, not only a zero-argument `new Date()`, and the copied-tree hermetic run); and the current-master row no longer carries a historical SHA. Revision 6's entry is preserved as written at its date. The architecture, the approved decisions and the extraction sequence are unchanged. The revision's branch was then merged with `master` = `56cbb692`, so its tree carries the harness it documents; the documentation change itself is unaffected. **Revision 8 (2026-11-15):** measurement-and-inventory correction only — the stale `test:scripts` figure (`479`) is corrected to the measured **750** in `README.md`, `CONTEXT.md` and the **third** copy in `docs/ROADMAP.md` that Revision 6 did not find; `CONTEXT.md` §5 gains the two package suites it omitted (`test:database-guard` **15**, and `test:core` at **101 tests / 99 pass / 2 skipped**, not the 32 that a pre-PR-#30 tree reported); §23.1 now identifies `master` = `4ba4122` (PR #30's merge commit) as **current** and labels the `56cbb692` rows historical; §23.2 gains the Revision 8 command record; and §23.4 **C1 is CLOSED** on that re-measurement. Revision 7's entry is preserved as written at its date, and no revision's historical measurement was overwritten. No recommendation behaviour, contract, schema or approved decision changed. **Revision 9 (2026-11-18):** implementation-status correction only — the two merged or open extraction batches are recorded. Step 4B PR 2 (PR #32, merged 2026-11-15 as `aa7b398`) moved the pure `candidates` modules, the Engine 1 `compatibility` tree and the pure half of `filtering` into `packages/recommendation-core/src/`; step 4B PR 3 (PR #36, head `d4e7e5f`) moves the pure Engine 3 `assembly` stage (7 modules, byte-identical, batch `step-4b-pr3` in `extraction-manifest.json`). The status line, §11.6, §19.1 (row 4), §23.1 (a new current row measured on `master` = `de659ad`) and the closing note therefore stop claiming that the entry point is empty and that no recommendation module has moved, and instead record the four published namespaces and the identity shims at the old paths. Revision 8's and earlier rows are preserved as written at their dates. No recommendation behaviour, contract, schema or approved decision changed. **Revision 10 (2026-11-18):** post-merge reconciliation only — PR #36 (`57bca1c`) and PR #37 (`07dfd22`) are merged, so the status line, §6.1, §11.6, §19.1 row 4, §23 and the closing note record the four namespaces as merged rather than branch-only, and §25.3 carries the first inventory measured on merged `master`; no earlier revision count was rewritten, and the only edits to earlier evidence rows are the two status labels §25.4 lists. **Revision 11 (2026-11-19):** implementation-status correction only — step 4B PR 4 (batch `step-4b-pr4`, baseline `07dfd22`) moves the Engine 5a `ranking` stage (4 modules, byte-identical, 32 / 32 across the three batches) into `packages/recommendation-core/src/ranking/`, so the branch's entry point publishes a fifth namespace and `ranking` leaves the not-moved list there; §25.2 separates the four namespaces merged into `master` from the one implemented on the unmerged PR #41 branch. The revision records a BRANCH, not a merge, adds one §23.1 row measured on that branch, and rewrote no earlier count.

**Revision 12 (2026-11-19):** post-merge reconciliation only — PR #41 (step 4B PR 4, the `ranking` batch) **merged** on 2026-11-19 as `43fd8c832bdb1c4c6762470dcca72f0742a790c4`, after PR #42 (documentation, merged as `c3186bc1a8a0d5e6882ff9609443c0b6d1466180`), so all five namespaces ship on `master`; the status line, §25.2, §23.1 (one `packages/` row relabeled historical and a current row for `43fd8c8` appended), §23.2 and the closing note record the merge, and §25.3/§25.3.1 stay as the measurements they were. No earlier count or decision was rewritten, and Revision 11's branch wording is preserved as written. It also records the re-measured suite totals on the merged head — `test:unit` **982 pass**, `test:scripts` **823 pass**, `test:core` **432 tests (430 pass / 2 skipped)** — and corrects the stale current counts in `README.md`, `CONTEXT.md` and `docs/ROADMAP.md`.
**Revision 13 (2026-11-19):** implementation-status correction only — branch `feat/core-retention-extraction` carries the step 4B PR 5 retention batch (`step-4b-pr5`, baseline `0f439e0`, 5 modules byte-identical, **37 / 37** moves across the four batches, fixture `packages/recommendation-core/test/fixtures/pr5-characterization.json`), and its implementation commit `0bd7e6f` adds the sixth namespace, `retention`, to `src/index.js` and `test/export-surface.json`. Measured at `0bd7e6f`: `test:unit` **942 pass / 0 fail** (was 982 — 40 retention tests moved into the core), `test:core` **473 tests (471 pass / 2 skipped)** (was 432: +40 moved, +1 new `retention` namespace assertion), `test:scripts` **823 pass**, `verify:ownership -- --inventory=pr5` **93 tests / 190 assertions, unchanged** (4 moved, 1 stayed — `retain.test.js` still imports `../scoring/candidate-score`), `verify:extraction` **PASS**. `master` remains `43fd8c8`; the revision records a BRANCH, adds one §23.1 row measured on it, and rewrote no earlier count.
**Revision 14 (2026-11-19):** implementation-status reconciliation — step 4B PR 5 **merged** (PR #44, merged 2026-11-19 as `1a9d8cfbe2b7f3a3f7a1a17e80919575d52c326e`), so `retention` is the sixth namespace on `master`; and step 4B PR 6 (batch `step-4b-pr6`, baseline `1a9d8cf`, 5 pure scoring modules byte-identical, **42 / 42** moves across the five batches, fixture `packages/recommendation-core/test/fixtures/pr6-characterization.json`) is a BRANCH (open as PR #45, not merged): `feat/core-scoring-extraction` publishes a seventh namespace, `scoring`, and moves `retention/retain.test.js` into the core, which is why `verify:ownership -- --inventory=pr5` now reports **40 tests / 123 assertions** for its four remaining rows. Measured at the PR 6 branch head `4fc50f7`: `test:unit` **794 pass / 0 fail** (was 942 — 148 scoring and retain tests moved into the core), `test:core` **622 tests (620 pass / 2 skipped)** (was 473: +148 moved, +1 new `scoring` namespace assertion), `test:scripts` **823 pass**, `test:api` **193 pass**, `verify:ownership -- --inventory=pr6` **184 → 184 tests and 402 → 402 assertions** (6 moved, 3 stayed), `verify:extraction` **PASS 42 / 42**, hermetic run **PASS**. `master` remains `1a9d8cf`; the revision records one merge and one branch, adds one §23.1 row, and rewrote no earlier count.
**Revision 15 (2026-11-20):** implementation-status correction — step 4B PR 6 **merged** (PR #45 as `0f86f53`), so `master` = `45133d5` publishes seven namespaces; step 4B PR 7 (batch `step-4b-pr7`, baseline `2683713`, 5 byte-identical files — the four Engine 6 modules and `offers/as-of` — `blob-identical: 47 / 47` across the six batches) is a **BRANCH** (`feat/core-explanation-extraction`): it publishes `explanation` and `offers` as the eighth and ninth namespaces, declares the §11.4 `exports` map, and narrows `explanation/build-facts.js:46` and `explanation/reasons.js:107` before the capture, while `ranking/rank.js:3` and `ranking/select-diverse.js:3` keep `../assembly` because their tests pin the specifier (D3). The status line, §11.2 (rows and the counts — the core total is the measured **47** file-level moves, not the stale 33), §11.3 item 1, §11.4, §11.6, §19.1 row 4 and §25.2 record it. Measured at the branch head: `test:unit` **726 pass**, `test:core` **697 tests (695 pass / 2 skipped)**, `test:scripts` **867 pass** (858 + 9 package-boundary resolution tests), `test:api` **193 pass**, `test:database-guard` **15 pass**, `verify:ownership -- --inventory=pr7` **105 → 105 tests / 180 → 180 assertions** (4 moved, 1 stayed), `verify:extraction` **PASS 47 / 47**, hermetic **PASS**. The runtime loaders, the three mixed barrels and `apps/api/src/engine.js`'s imports are unchanged, so §19 step 4 stays **in progress until PR 7 merges**.
**Revision 16 (2026-11-24):** implementation-status and inventory reconciliation — step 4 is **COMPLETE**: PR #49 (batch `step-4b-pr7`, branch `feat/core-explanation-extraction`) **merged on 2026-11-20 as `2569647509986f975ea2b6b442d6b0de3b94d67c`**, so `explanation` and `offers` are the eighth and ninth namespaces on `master` and `blob-identical: 47 / 47` stands. Step 5 is **IN PROGRESS**, not started-and-idle: nine PRs are merged — #50 `6fd31220fe2cbb421a56e28ada302f209f219691` (2026-11-20, the W0 boundary harness), #57 `5b5eeb3b62dd551c2610ec03488e974c12ca13a9` (2026-11-22, the Engine 2 offer query and its barrel), #60 `3565a4d01060d15f24871909270c55eacaff2201` (2026-11-22, the query and scoring loaders), #61 `9f0a7660c5f01da0805b3122ef55caa02f00d41d` (2026-11-23, the golden loader identity suite), #63 `1a4551f9d5699fd47d241eb9f21acc63edf02e68` (2026-11-23, the candidate and filtering-context loaders), #64 `5399cae0d91761a9fa222091c54f7d888b562a96` (2026-11-24, the filtering composition and the two loaders barrels), #65 `6e13eaba0892d1c0cdc5c360e77cefff1a3e7f96` (2026-11-24, the `loaders` namespace), #66 `146e281f6531eda5bafaf2323177b01f219e8c74` (2026-11-24, the five persistence modules) and #67 `d21ec2156b3a733cf1023a4799c3f1770466d06f` (2026-11-24, the orchestrator transaction characterisation). §11.2 and §19.1 now carry the re-measured inventory — **23 total, 15 moved, 8 remaining** — with the arithmetic and the file lists; §11.2 also records `orchestrator/compute.js`, which the table had omitted, as **OWNER DECIDED — Option 1, runtime-internal**; §19.4 adds the offer-ingestion gap, that decision, the `./loaders` deferral and the `test:api:db` nightly failure; and §26 carries the EU operational facts in a dated appendix kept separate from this status. Every figure was re-measured read-only on `master` = `d21ec21`, and no earlier count was rewritten. No recommendation behaviour, contract, schema or approved decision changed.
**Measurement baseline (Revisions 1-3):** `master` = `a413f25` ("Merge pull request #18 from ibrahim-lahribli/freebuff/launch-v2-2.5.0-decay-off") — **historical**; it is not the current head.
**Secondary input:** `feature/v2-design` = `3bc0605` (read, never merged or rebased for this RFC)
**RFC branch:** `architecture/system-separation-rfc` at `9297034` (merged as PR #23 on 2026-11-11; the branch was deleted after merge). Revision 4 and Revision 5 corrections are on `docs/rfc-accuracy-corrections`; Revision 6 and Revision 7 corrections are on `docs/recommendation-core-harness` (PR #30, merged `4ba4122`); Revision 8 corrections are on `docs/test-counts` (PR #31, open for review); Revision 9 corrections are on `feat/core-extract-assembly` (PR #36, merged 2026-11-18 as `57bca1c`); Revision 10 corrections are on `docs/reconcile-post-pr37` (PR #38, open for review).
**Deliverable:** documentation and analysis only. No source, manifest, lockfile, workflow, migration, seed, Dockerfile or test file was modified by this revision. Revision 4 re-measured its corrected claims read-only on `master` = `e62c816`, Revision 5 on `master` = `3e2f13e`, Revision 7 on `master` = `56cbb692` after PR #29 merged, and Revision 8 on `master` = `4ba4122` after PR #30 merged; none made any database contact. Revision 10 re-measured its inventory read-only on `master` = `07dfd22` after both merges and made no database contact.

---

## 0. How to read this document

Every material assertion carries one of six labels. They are not decoration: they are the difference between what the code does today and what this RFC thinks it should do.

| Label | Meaning |
|---|---|
| **CURRENT** | Verified in the tree at `a413f25` (or on `feature/v2-design` at `3bc0605` where stated) by reading the file, running a read-only command, or reading git history. The evidence is cited. Revision 4 re-verifies only the claims it corrects, on `master` = `e62c816`; Revision 5 re-verifies the guard's implementation status on `master` = `3e2f13e`, Revision 7 re-verifies the core harness and the `packages/` inventory on `master` = `56cbb692`, and Revision 8 re-verifies every suite count on `master` = `4ba4122`. |
| **RECORDED** | Written down in a committed document at a stated date, and **not** re-measured by this RFC. The document is named, and its limits are stated. |
| **PROPOSED** | This RFC's recommendation. Not implemented. |
| **DECISION REQUIRED** | An owner-level choice that code inspection cannot settle. Split into architecture and product/operations decisions in §21. |
| **DEFERRED** | Deliberately postponed, with a named trigger that re-opens it. |
| **UNKNOWN** | Not established by current evidence. Stated as a question, never as a fact. |

Three rules exist because the first revision broke them:

1. **A purity claim is never a bundle.** "No `pg` dependency", "no connection ownership", "no I/O" and "deterministic pure computation" are four different properties (§6.2). They are never used interchangeably.
2. **A number names its environment, its date and its source** (§11A.2). A measurement on TEST is never written as a fact about every database.
3. **A recorded document is not a measurement.** `RECORDED` exists so that evidence from `docs/OPEN_POINTS.md` or a generated snapshot is not presented as if the author had connected to a database.

Contradictions between documents and the tree are **not resolved silently**. They are recorded in §23.4.

Unless stated otherwise, "measured" below means a **read-only** scan of the working tree on 2026-11-11 (Node v24.21.0), not a database connection.

---

## 1. Executive summary

### 1.1 What the platform is today

Morocco-PC is a PC-build recommendation platform for the Moroccan market. It is one Git repository containing four very different kinds of software at four different levels of packaging maturity:

1. a **Node.js recommendation engine** (`src/recommendation/`, 80 non-test modules, 18 297 lines) that has **no third-party runtime dependency** and **no connection ownership**, but that **does execute SQL** through an injected `pg`-compatible handle in 17 of its 80 production modules;
2. a **PostgreSQL schema** (`database/`, 23 migrations, 32 seed files) that is the single authority for every fact the engine can read;
3. a **thin Fastify API** (`apps/api/`) that has no `package.json`, resolves its dependencies from the repository root, and reaches the engine through exactly six stage barrels;
4. **two Next.js frontends that already have independent package manifests and lockfiles** — V1 (`apps/web`, on `master`) and V2 (`apps/web-v2`, on `feature/v2-design` only).

Two of the six candidate projects are therefore **already independently packaged**; the packaging work is concentrated in the engine, the API, ingestion and the database tooling. The boundaries between components are partly enforced by tests — `apps/api/test/unit/import-boundary.test.js` pins that only `apps/api/src/engine.js` may require the engine, and that `pg` is required only by `apps/api/src/db.js`. The boundaries between *projects* are not enforced, because there are no projects: there is one root `package.json` for the engine, the API and every script.

### 1.2 Principal findings

| ID | Finding | Evidence |
|---|---|---|
| F1 | **The engine has no third-party runtime dependency and does not own connections — but it is not I/O-free.** Zero non-test files under `src/` require `pg` or `dotenv` (23 *test* files do). 17 non-test engine modules contain `.query(`, 15 of them outside `ingestion/`: every loader, the persistence writers, the orchestrator and the swap modules dispatch SQL on a caller-supplied handle. §6.2 keeps the four properties apart. | `grep -rn "require('pg')\|require('dotenv')" src/` → 0 non-test hits; `.query(` inventory (§6.1); §6.2 |
| F2 | **The engine's module graph is a DAG, not a strongly connected graph.** Tarjan over the 80 production modules and 220 resolved intra-tree `require` edges yields **80 components, none larger than one module**. Cross-stage edges all run in one direction (`assembly → filtering → compatibility`, `retention/scoring/ranking → assembly`, `explanation → ranking → assembly`). The earlier "strongly-connected graph" claim was never backed by a graph analysis and is withdrawn. | §6.3, reproducible command in §23.2 |
| F3 | **Three barrels mix pure functions with SQL-executing exports** — `candidates/index.js`, `filtering/index.js` and `scoring/index.js` — **while `offers/index.js` and `query/index.js` are runtime-only.** `candidates/index.js` exports `loadCandidates` beside `createCandidate`; `filtering/index.js` exports `loadFilteringContext` beside `filterCandidates`; `scoring/index.js` exports `loadScoringModel`/`loadComponentAssessments` beside `computeBuildScore`. The runtime-only barrels export nothing pure: `offers/index.js` exports only the SQL-executing `selectOfferPrices`, and both `query/` modules issue SQL. Separately, the pure `offers/as-of.js` module (`parseAsOf`) is extracted to core on its own — it is not part of the `offers` barrel and must not be confused with it. A pure core therefore requires **file-precise extraction rather than blindly moving directories**. | `src/recommendation/*/index.js`, read in full; §6.4 |
| F4 | **`apps/api` cannot be installed, built or deployed on its own.** It has no `package.json`; its Dockerfile requires the repository root as build context and copies `src/` and the write-target guard beside it. | `apps/api/Dockerfile`; `render.yaml` `dockerContext: .` |
| F5 | **`apps/api` depends on code outside every application and outside the engine**: the write-target guard. Until PR #27 that guard was a file in a directory with **no `package.json`**, so the previously proposed `"db-guard": "file:../../database/tooling"` dependency could not be installed at all. PR #27 gave it a manifest in `packages/database-guard/` (§9.4), but the API still consumes it by relative path, so the API has no installable dependency edge until step 6. | `apps/api/src/db.js:26`; `packages/database-guard/package.json` |
| F6 | **Ingestion is already a separate application wearing an engine directory's clothes.** 8 non-test modules, its own barrel, its own CLI, and **zero inbound edges** from any stage (measured, §6.3). Its own header says it "is NOT an engine stage". | `src/recommendation/ingestion/index.js:1-13`; Tarjan edge scan |
| F7 | **There is one contract document pattern, but two physical copies across branches.** `contract/openapi-1.10.0.json` is read by V1's generators and gates on `master` (updated 2026-11-12: the file moved out of `apps/api/test/unit/`; it was `apps/api/test/unit/openapi-v1.10.json` when this row was measured); V2 carries its own copy of the same file on `feature/v2-design`, and each frontend's `check:api-types` compares generated types against its own copy. Identical content today; no gate would detect divergence tomorrow. | `apps/web/package.json`, `apps/web-v2/package.json`, both workflows; §15.2 |
| F8 | **V2 is a foundation, and one manual read-only staging smoke exists.** V2 has 3 route files and performs only GETs; it has no catalogue route, results route, swap, saved builds, and **no deployment configuration**. Its `docs/staging-smoke.md` records a **manual, ordinary-browser, read-only** smoke on 2026-11-07 (7 reads per locale, all HTTP 200, 0 POST) against the EU staging API. That is not a deployed V2 frontend and not an automated E2E test. | §14.4; `feature/v2-design:apps/web-v2/docs/staging-smoke.md` |
| F9 | **The programme is single-tenant and unauthenticated by decision, not by omission.** No auth library, no session, no account; the API contract documents "No authentication or accounts" as a deliberate property (R-16 ACCEPTED). | `docs/api/CONTRACT.md`; `docs/OPEN_POINTS.md` R-16 |
| F10 | **The shared operational machinery is the real coupling.** `scripts/lib/` holds the target digests, the restore-point argument validation, the model pin and the generated-doc check — every one consumed by more than one layer; the DB write guard it used to hold now lives in `packages/database-guard/` (§9.4). | `apps/api/src/db.js:26`, `scripts/*.js`, `packages/database-guard/src/index.js`, `npm run test:scripts` |

### 1.3 Principal recommendations

**Option B is the selected direction: split the pure domain into `packages/recommendation-core/` and the DB-backed workflow into `packages/recommendation-runtime/`.** The remaining recommendations follow from that choice.

| ID | Recommendation | See |
|---|---|---|
| R1 | **Keep one repository.** Independently *deployable* projects, not independently *versioned* repositories. Multi-repo stays deferred behind named triggers. | §17 |
| R2 | **Split the engine into `packages/recommendation-core/` (pure) and `packages/recommendation-runtime/` (SQL, persistence, orchestration).** Runtime depends on core; core depends on no infrastructure project. The split is file-precise: 33 files move to core, 24 to runtime, and 8 barrels are split or re-pointed (§11.2). | §7.3, §11 |
| R3 | **Do not introduce npm workspaces in the separation phase.** Keep independent per-project manifests and per-project lockfiles; a `file:` dependency needs an installable package directory, which is exactly what `packages/*` provides. | §17.5 |
| R4 | **Ingestion becomes `apps/offer-ingestion/`**, owning the CLI, adapters, identity rules and the offer gates. It imports **no** core or runtime module. | §12 |
| R5 | **The database becomes an owned project**, `database/` + lifecycle tooling, and the **write-target guard becomes an installable package**, `packages/database-guard/`, because the API must depend on it as code. | §9.4, §10 |
| R6 | **The API gets a manifest, explicit dependencies and contract ownership.** It depends on `recommendation-runtime`, `recommendation-core` (pure vocabulary only) and `database-guard`. | §13 |
| R7 | **V2 is the future frontend; V1 is frozen and retired feature by feature.** Parity is a written matrix with an exit criterion, not a feeling. | §14 |
| R8 | **Root documentation becomes navigation, not content.** Each project owns its README, architecture, operations and testing docs. | §16 |

### 1.4 What this RFC does not do

It does not move a file, rename a package, add a manifest, change a workflow, alter the API, touch either frontend, apply a migration, connect to a database, or perform any roadmap step. (The documentation cleanup landed separately as PR #24; §16.7 records what it changed.) The roadmap in §19 remains a plan, and §19.2 states the safety policy that governs it. **No step of this RFC implements the Option B split.**

### 1.5 What changed in this revision

The decision to adopt Option B invalidated several arguments in the first revision. Each change is listed here so a reviewer can compare revisions directly.

| # | First revision said | This revision says | Why |
|---|---|---|---|
| 1 | Options A/B/C undecided; Option A (one package) recommended. | Option B selected. A and C are documented as rejected with reasons (§7.2). | Owner decision. |
| 2 | Engine described as "performs no I/O of its own", "no I/O", "pure". | Four separate properties (§6.2): no third-party driver dependency (true), no connection ownership (true), no direct I/O (**false** — 15 non-ingestion modules execute SQL), pure computation (true only of named modules). | Source evidence: `.query(` in 15 non-ingestion modules. |
| 3 | "The engine is one strongly-connected graph" (F2). | The module graph has 80 singleton SCCs — it is a DAG (§6.3). | Tarjan over resolved `require` edges (§23.2). |
| 4 | The core/runtime split was rejected because `ranking/*` and `explanation/*` import an assembly barrel that "would include runtime-facing pieces". | `assembly/index.js` has 0 DB files and its own header says it never touches the database. The argument is withdrawn; the real, small defect is that two files import the *barrel* for one constant (§11.3). | `src/recommendation/assembly/index.js`; `ranking/rank.js:3`; `explanation/build-facts.js:46`. |
| 5 | Orchestrator modules grouped as "transaction management … own BEGIN/COMMIT/ROLLBACK". | Per-module transaction table: `snapshot.js` owns the read transaction, `commit.js` owns the write transaction, `run.js`/`full-run.js` own none, swap modules own theirs only in their `*Snapshot`/`*InTransaction` wrappers (§6.5). | Module headers and source. |
| 6 | "`full-run` composes snapshot → rank → diversity → explanation". | It composes snapshot → `rankBuilds` → `selectArchetypes` → `explainSelection` → commit. `selectArchetypes` replaced `selectDiverseTop` in Decision 41. | `orchestrator/full-run.js:1-11,78-95`. |
| 7 | Offer provenance/freshness/coverage gates assigned to Database in §10 and to Ingestion in §12. | One authoritative ownership matrix (§8): the three offer gates belong to **Ingestion**; schema, replay, parity, identity and coverage-of-data gates belong to **Database**. | §8. |
| 8 | DB project "not a package", yet API depended on `file:../../database/tooling`. | `packages/database-guard/` is a real installable package with a manifest; the database *project* stays a non-package directory (§9.4). | A `file:` dependency requires a `package.json`. |
| 9 | `docker build -f apps/api/Dockerfile apps/api` with local packages. | Repository-root context, explicit `COPY` set, order that makes `npm ci` resolve `file:` deps, `.dockerignore` limits (§13.4). | `apps/api` as context cannot see `packages/`. |
| 10 | "Steps 6, 7 and 9 can run in parallel once step 3 has landed." | One dependency table (§19.1); only genuinely independent steps are marked parallel. | The old claim contradicted the same document's own prerequisites. |
| 11 | "No step writes to the database"; "no step deploys". | A safety policy with tiers (§19.2): shared/EU/production writes are forbidden before the deployment step; guarded TEST/scratch writes are permitted for named test steps under stated safeguards; deployment only at step 10 with approval. | Steps 6-9 require DB-backed tests. |
| 12 | "V2 has never called a deployed API." | A manual, ordinary-browser, read-only staging smoke on 2026-11-07 called the EU API; no deployed V2 frontend exists; automated E2E still stubs `/v1/**` (§14.4). | `apps/web-v2/docs/staging-smoke.md`. |
| 13 | "114 offers, 0 verified" presented as a universal current fact. | Environment-qualified measurements (§11A.2): shared/EU 0 VERIFIED (recorded 2026-11-10); TEST has 2 VERIFIED offers and 1 eligible CPU identity in the same recording. | `docs/OPEN_POINTS.md` R-01/R-30. |
| 14 | Six implicit projects all lacking manifests. | Two of six already have independent manifests and lockfiles; the packaging work is engine, API, ingestion, database tooling (§3.1). | `git ls-files`, `feature/v2-design` tree. |
| 15 | `generate-presets.js` assigned to the API while living in `scripts/`. | Physical home proposed as `apps/api/bin/generate-presets.js`; until moved, the file is a root script with an API-shaped dependency (§3.3). | `scripts/generate-presets.js:86-97`. |
| 16 | A1-A6 recorded as `AWAITING OWNER APPROVAL`. | **A1-A6 approved by the repository owner on 2026-11-11**; the approval record, its scope and its exclusions are in §21.1. B1-B8 remain open. The approval did not merge PR #23; that PR was merged separately on 2026-11-11 (`0bcb6e3`) to publish the record. | Owner approval recorded; no extraction step was implemented at that time — the guard followed in PR #27 (§9.4), the recommendation extraction has not started. |

---

## 2. Current system overview

### 2.1 The four layers, as implemented

**CURRENT.** The schema is the contract that everything else obeys. Its four logical layers are documented in `README.md`, `CONTEXT.md` and `docs/engine/ARCHITECTURE.md`, and are physical tables in one PostgreSQL database.

| Layer | Tables (current) | Written by | Read by |
|---|---|---|---|
| 1 — Catalog / Hardware | `product`, `product_family`, `product_variant`, `<role>_spec` (7), explicit compatibility tables (`cpu_motherboard_support`, `case_motherboard_form_factor`, `case_radiator_support`, `platform_memory_support`, …) | seeds only | engine loaders, API catalog routes |
| 2 — Performance / Assessment | `benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model` | seeds + `scoring_model` activation recipe | `scoring/load-*`, API meta/presets |
| 3 — Market | `store`, `store_offer`, `price_history`, `ingestion_record`, `retailer_listing_alias`, `spec_provenance` | ingestion + seeds | `offers/select.js`, API catalog/price-history |
| 4 — Recommendation | `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component`, `build_rejection`, `recommendation_preset`, `recommendation_swap` | `orchestrator/commit.js`, `orchestrator/swap-commit.js`, `generate-presets.js` | API read path |

**CURRENT.** 44 tables, 23 migrations (`001_extensions.sql` … `023_recommendation_swap.sql`), ledger at 23 on shared, TEST and EU. Row counts are instance-specific and belong to the generated `docs/DATA_STATE.md`, never to this document (§11A.2).

### 2.2 The runtime pipeline

**CURRENT.** One pass, as wired in `orchestrator/run.js`:

```
query/loadQueryInput  →  offers/selectOfferPrices  →  candidates/loadCandidates
   →  filtering/filterCandidates          →  scoring/computeCandidateScores
   →  retention/retainTopKPerRole         →  assembly/assembleBuildsForRecommendation
   →  scoring/computeBuildScores          →  ranking/rankBuilds + selectArchetypes
   →  explanation/explainSelection        →  orchestrator/commit  (ONE write transaction)
```

`orchestrator/run.js` composes steps 1-10 inside a caller-owned `REPEATABLE READ READ ONLY` snapshot opened by `orchestrator/snapshot.js`; `orchestrator/full-run.js` composes snapshot → `rankBuilds` → `selectArchetypes` → `explainSelection` → commit. Determinism is a requirement: ties break on `product_id` ASC (then `product_variant_id`, NULL-first), never on `localeCompare` and never randomly.

### 2.3 The delivered surfaces

| Surface | Entry point | Size | Status |
|---|---|---|---|
| Engine library | `src/recommendation/*/index.js` (12 barrels; `persistence/` has none) | 80 non-test modules, 18 297 lines | CURRENT, unit-tested |
| HTTP API | `apps/api/src/server.js` | 11 registered routes, contract **v1.10.0** | CURRENT, DB-free + DB-backed suites |
| Frontend V1 | `apps/web` (Next.js 16.4.2, Tailwind v4, next-intl fr/ar) | own manifest + lockfile, 19 route files, Playwright suites | CURRENT on `master`, deployed nowhere |
| Frontend V2 | `apps/web-v2` on `feature/v2-design` (Next.js 16.4.5) | own manifest + lockfile, 3 route files | CURRENT on that branch only |
| Ingestion | `scripts/ingest-offers.js` → `src/recommendation/ingestion/` | 8 non-test modules, 1 113 lines | CURRENT, dry-run default, network-free |
| Database lifetime | `scripts/run-migrations.js`, `scripts/run-seeds.js`, `scripts/verify-migrations-replay.js` | 23 migrations, 32 seeds, ledger + audit log | CURRENT |

Suite sizes are deliberately not restated here as fact: this revision did **not** run them (§23.2). Treat any suite count in an older document as that document's dated record.

### 2.4 Deployment reality

**CURRENT — from files, not from a deployment.**

| Artifact | File | State |
|---|---|---|
| API container | `apps/api/Dockerfile` (build context = repository root) | builds `src/` + `apps/api/` + `packages/database-guard/{package.json,src}` |
| API hosting | `render.yaml` (`morocco-pc-api-eu`, Frankfurt, `runtime: docker`, `healthCheckPath: /v1/health`, `autoDeployTrigger: off`) | one recorded origin: `https://morocco-pc-api-eu.onrender.com` |
| API alternative | `fly.toml` (`morocco-pc-api`, `fra`, always-on) | present in the tree; **UNKNOWN** whether it is used — no measured evidence of a Fly origin in `CONTEXT.md` or `docs/OPEN_POINTS.md`. This is a decision in §21 (B6). |
| Web V1 hosting | `apps/web/wrangler.jsonc`, `apps/web/open-next.config.ts` | configured, **never deployed** |
| Web V2 hosting | none | **no deployment configuration exists** on `feature/v2-design` |

---

## 3. Current project and dependency inventory

### 3.1 Inventory

**CURRENT.** "Manifest" means a `package.json` in that directory with its own dependency list. Verified with `git ls-files | grep -i package.json` on `master` (root + `apps/web`, plus the three `packages/*/package.json` added by PR #27) and `git ls-tree origin/feature/v2-design apps/web-v2/` (adds `apps/web-v2/package.json` + `package-lock.json`).

| Path | Manifest | Independently installable today? | Runtime dependencies | Tests | CI | Deploy artifact |
|---|---|---|---|---|---|---|
| repository root | `package.json` (private, no `workspaces`) | yes (it is the only install) | fastify, @fastify/*, @sentry/node, @sinclair/typebox, pg, dotenv, pino-pretty (dev) | `test:unit`, `test:scripts`, `test:api` | `ci.yml` | `Dockerfile` (root context), `render.yaml`, `fly.toml` |
| `src/recommendation/` | **none** | no — resolved through the root install | **none** (zero non-relative non-test requires) | 63 test files inside the stages | via root `test:unit` | shipped inside the API image |
| `database/` | **none** | n/a — data, not code | none | via `test:scripts` + `verify:replay` | `ci.yml` recurring job | none |
| `scripts/` | **none** | no | pg, dotenv | `test:scripts` | `test:scripts` | none — the API image copies `packages/database-guard/`, not `scripts/` |
| `apps/api/` | **none** | **no** | resolves from the root `node_modules` | unit + DB-backed files | `ci.yml` | `Dockerfile`, `render.yaml` |
| `apps/web/` (V1) | **own `package.json` + own lockfile** | **yes** | next 16.4.2, react, next-intl, MDX; openapi-typescript, Playwright, LHCI (dev) | Playwright suites | `.github/workflows/web.yml` | `wrangler.jsonc` (undeployed) |
| `apps/web-v2/` (V2, branch only) | **own `package.json` + own lockfile** | **yes** | next 16.4.5, react, next-intl, @tanstack/react-query, openapi-fetch, zod, zustand, react-hook-form, radix; vitest, Playwright, prettier (dev) | Vitest + Playwright suites | `.github/workflows/web-v2.yml` | **none** |
| `docs/` | none | n/a | none | doc gates in `test:scripts` + `verify:docs` | `ci.yml` | none |
| `test/golden/` | none | n/a | none | driven by `eval:scenarios` | recurring job | none |

### 3.2 What this inventory proves

1. **Ownership is uneven, not absent.** Both frontends are genuinely independent packages: own manifest, own lockfile, own workflow, own Node floor, own `AGENTS.md`. V1 and V2 are **not** part of the packaging problem and no proposal in this RFC changes their manifests.
2. **The API is the weakest link.** It is the only deployable component without a manifest. Its own Dockerfile says so out loud (`apps/api/Dockerfile:8-14`), with the stated reason that the engine's `require('pg')`/`require('dotenv')` must resolve upward. That premise is **already false on inspection** — no non-test engine file requires either package — but the API still resolves `pg` upward, because `apps/api/src/db.js` needs it and there is no local install to put it in.
3. **The un-packaged half is exactly the half Option B restructures.** Engine + API + ingestion + database tooling are one install today; core + runtime + guard packages are what gives them addresses.
4. **Nothing in the tree owns the contract.** The document lives under `apps/api/test/unit/` — a *test* directory — while two applications outside `apps/api` treat it as their build input.

### 3.3 Two ownership labels that conflict with the file layout

| Tool | Where it actually is | What the first revision called it | Resolution proposed here |
|---|---|---|---|
| `generate-presets.js` | `scripts/generate-presets.js`, and it requires `../apps/api/src/repository`, `../apps/api/src/engine` and `../apps/api/src/meta` plus `pg`/`dotenv` (`scripts/generate-presets.js:86-97`) | "API project (logical owner)" | **PROPOSED:** physical home `apps/api/bin/generate-presets.js`, owned by the API project, because it writes Layer 4 and calls the API's own engine entry point. Until it moves, no document may describe it as already living under `apps/api`. |
| Guard (`db-url`) | `packages/database-guard/` (manifest, `src/index.js`, its own test) on `master` since PR #27; before that, `scripts/lib/db-url.js`, a directory with no `package.json` | "Database project exposes the guard" | **IMPLEMENTED 2026-11-11 (§9.4):** the guard is `packages/database-guard/`, a real package, because `apps/api/src/db.js:26` requires it as code. The proposal was to create exactly that package; PR #27 did. |

### 3.4 Repository hygiene (CURRENT)

Tracked at the root and unrelated to any project: `pr8-fix-saved-spec.patch`, `.cursorrules`, `CLAUDE.md`, and `test/golden/_scratch-v*.md` (committed scratch baselines, deliberately ungitignored per `DEVELOPMENT_NOTES.md`). These are recorded because a project structure that assigns ownership must say where an unowned file goes; §16.5 proposes homes rather than deletions.

---

## 4. Logical data layers versus application projects

### 4.1 The question

Should the four data layers become four projects, four databases, or stay one schema with several owners?

### 4.2 Evidence

**CURRENT.** One physical database holds all four layers on every environment (shared, TEST branch, EU). The layers are logical, not physical:

- Cross-layer joins are load-bearing, not incidental: `offers/select.js` joins Layer 3 offers to Layer 1 products/variants; `scoring/load-assessments.js` joins Layer 2 assessments to Layer 1 identities; `orchestrator/commit.js` writes Layer 4 rows that reference Layer 1 ids.
- The `catalog_version` digest (Decision 47) spans 21 loader-read tables across Layers 1-3 and is the invalidation key for Layer 4 presets (R-27). Splitting layers into separate databases would break that digest by construction.
- One write transaction spans Layer 4 only, but it *reads* the snapshot taken across Layers 1-3 in the same `REPEATABLE READ READ ONLY` transaction (`orchestrator/snapshot.js`). A distributed transaction across four databases is not something this system needs.
- Runtime isolation is already enforced by the injection contract: **no engine module opens a connection**; every DB touch takes a caller-supplied handle (§6.2).

### 4.3 Recommendation

**PROPOSED:** the database remains **one PostgreSQL database with four logical domains**, owned by a single database project. The layer names stay because they are load-bearing vocabulary (`README.md`, `ARCHITECTURE.md`, every decision entry).

| Logical layer | Schema owner | Data owner (writes) | May be read by |
|---|---|---|---|
| 1 — Catalog | Database | Database seeds (catalogue); Ingestion resolves identities only | core/runtime loaders, API catalog routes, ingestion matching |
| 2 — Assessment | Database | Database seeds + scoring-model recipe | runtime scoring loaders, API meta |
| 3 — Market | Database | Ingestion (offers), Database seeds | runtime offers loader, API catalog/price-history |
| 4 — Recommendation | Database | Runtime commit/swap-commit; `generate-presets` (API-owned tool) | API read path only |

**Rejected:** four databases. The `catalog_version` digest, the single read snapshot and the FK graph (`build_component.product_id` → `product.id`) all assume one database. Four databases would be a rewrite, not a separation.

**DEFERRED:** a "data platform" project outside the repository (managed schema service). Trigger: a second consumer organisation, or the first non-Neon environment that must not share code.

---

## 5. Architecture diagrams

### 5.1 Runtime today (CURRENT)

```
            browser
               │
   ┌───────────┴────────────┐
   │                        │
apps/web (V1)         apps/web-v2 (V2, branch only)
own manifest          own manifest
19 routes             3 routes, GET-only
   │  lib/api/client.ts    │  lib/api/client.ts (openapi-fetch)
   └───────────┬───────────┘
               │  HTTPS, /v1/**
               ▼
      apps/api  (Fastify, contract v1.10.0, 11 routes)
        routes/*.js  →  engine.js  →  6 barrels
            │              │
            │              ▼
            │      src/recommendation/  (relative path, no manifest)
            │        loaders + pure stages, one graph (DAG)
            └── repository.js  ──┐
                                 ▼
                          PostgreSQL (one database, 4 logical layers)
                                 ▲
                     scripts/ingest-offers.js → src/recommendation/ingestion/
                     scripts/run-migrations.js, run-seeds.js, generate-presets.js
```

**CURRENT path-level truth the diagram hides:**

- `apps/api/src/engine.js` is the *only* file that requires `src/recommendation/**`, and it requires exactly six barrels: `orchestrator`, `assembly`, `candidates`, `scoring`, `query`, `retention` (`apps/api/src/engine.js:28-33`; pinned by `apps/api/test/unit/import-boundary.test.js`).
- `apps/api/src/db.js` is the *only* file that requires `pg`, and it also requires `../../../packages/database-guard/src` (line 26).
- `apps/api/src/repository.js` is the only file with API-owned SQL.
- The engine is reached by `../../../src/recommendation/...`, a relative path that escapes the application directory.

### 5.2 Target architecture with Option B (PROPOSED)

```
                         browser
                            │  HTTPS /v1/**
              ┌─────────────┴─────────────┐
              ▼                           ▼
        apps/web (V1, frozen)      apps/web-v2 (V2, future)
              │                           │
              │  generated types ◄── contract/openapi-<version>.json (API-owned)
              └─────────────┬─────────────┘
                            ▼
                     apps/api  (Fastify, contract owner)
                     │        │
                     │        └──────────────► packages/database-guard
                     │                              (installation guard)
                     ▼
          packages/recommendation-runtime
             loaders · orchestrator · persistence · swap
                     │        │
                     │        └──► injected pg-compatible client
                     ▼                  (caller-owned pool/session)
          packages/recommendation-core
             compatibility · assembly · filtering(filter) · scoring(compute)
             retention · ranking · explanation · offers(as-of)
                     │
                     └──► nothing: no pg, no dotenv, no fs, no network,
                              no env, no clock, no randomness

   apps/offer-ingestion ──► PostgreSQL (Layer 1 identities, Layer 3 offers)
   database/ + tooling  ──► schema, seeds, ledger, replay, parity, mirrors
```

**Dependency direction (PROPOSED, normative):**

| Edge | Allowed? | Meaning |
|---|---|---|
| API → runtime | yes | the API composes passes, previews and commits through runtime entry points |
| API → core | yes, frozen vocabulary only (§9.2, §11.4) | immutable contracts the HTTP layer must not restate (`EXPANSION_ORDER`, `COMPONENT_ROLES`, `listUseCases`, `resolutionMultiplier`, error vocabulary); never a calculation |
| runtime → core | yes | runtime prepares inputs for core and translates rows into core contracts |
| core → runtime | **no** | would make the pure domain depend on SQL |
| core → API / ingestion / database tooling / `pg` | **no** | nothing infrastructure-shaped |
| ingestion → runtime or core | **no** | no domain dependency is demonstrated (§6.3: zero edges) |
| ingestion → schema + database-guard | yes | reads Layer 1/3, writes Layer 3 |
| frontends → API (HTTP) + contract file | yes | never database, never runtime |
| runtime → schema + client protocol | yes, documented | it executes SQL against the schema; §9.5 states this dependency rather than hiding it |

### 5.3 Build and deployment topology (PROPOSED)

```
                 repository root (one Docker build context)
                 ┌───────────────────────────────────────────────┐
                 │ .dockerignore: apps/web*, docs, test, .git…   │
                 └───────┬───────────────────────┬───────────────┘
                         │                       │
        apps/api (own manifest,          packages/recommendation-{core,runtime}
         own lockfile)                    + packages/database-guard
                         │                       │
                         └──────────┬────────────┘
                                    ▼
                 docker build -f apps/api/Dockerfile .      → Render host
                                    │
                 apps/web    ─ own lockfile ─► OpenNext/Workers (never deployed)
                 apps/web-v2 ─ own lockfile ─► descriptor still to be chosen (B6)
```
---

## 6. Current module ownership analysis

### 6.1 Per-stage inventory (CURRENT, measured)

Line counts are non-test source lines; test counts are `*.test.js` files inside the stage (recursively). "DB files" counts non-test files containing `.query(`.

| Stage | Files | Lines | Test files | DB files | Barrel exports (abridged) | Note |
|---|---|---|---|---|---|---|
| `assembly` | 7 | 2 415 | 7 | **0** | `assembleBuildsForRecommendation`, `assembleBuilds`, `evaluateBuild`, `evaluateBuildReplacement`, `EXPANSION_ORDER`, `priceKey`, `validatePrices`, `resolveGpuRequirement`, `buildGpuInputs` | entirely pure; header states it never touches the database |
| `candidates` | 7 | 955 | 3 | **1** (`loader.js`) | `COMPONENT_ROLES`, `ROLE_ORDER`, `createCandidateSelectionInput`, `createCandidate`, `loadCandidates`, `selectCandidatePool`, `compareCandidates`, `CandidateSelectionError` | pure contracts + one loader in one barrel |
| `compatibility` | 14 | 1 867 | 8 | **0** | 11 pair evaluators + `createCompatibilityResult`, `aggregateCompatibilityResults`, `REASON_CODES` | entirely pure |
| `explanation` | 4 | 955 | 3 | **0** | `explainSelection`, `deriveReasons`, `REASON_CODES`, `REASON_ORDER` | pure; imports `assembly` **barrel**, `ranking` **barrel**, `scoring/use-cases` |
| `filtering` | 5 | 1 784 | 6 | **1** (`context-loader.js`) | `filterCandidates`, `filterCandidatesForRecommendation`, `loadFilteringContext`, `CONTEXT_COMPAT_KEYS`, `CANDIDATE_STATUSES`, `buildIntegratedGpuPresentMap` | pure + loader + a composing pipeline in one barrel |
| `ingestion` | 8 | 1 113 | 5 | **2** (`plan.js`, `apply.js`) | 15 exports incl. `runIngestion`, `parseManualText` | **not an engine stage** (own header); zero inbound edges |
| `offers` | 3 | 439 | 2 | **1** (`select.js`) | `selectOfferPrices`, `SELECT_OFFER_PRICES_SQL` | barrel is runtime-only; `as-of.js` is pure and imported by direct path |
| `orchestrator` | 7 | 2 329 | 7 | **5** | `runRecommendation`, `runRecommendationSnapshot`, `runRecommendationFullRun`, `evaluateSwapPreview`, `commitSwap`, `readCommittedSwap` | mixed read/compose/write wrappers; see §6.5 |
| `persistence` | 5 | 1 076 | 4 | **3** | *(no barrel)* `persist-ranked`, `persist-pass-facts`, `persist-rejections`, `validate-selected`, `validate-rejections` | DML writers + pure payload validators |
| `query` | 3 | 526 | 2 | **2** | `loadQueryInput`, `SELECT_QUERY_INPUT_SQL`, `REQUIRED_ROLES`, `catalogVersion`, `CATALOG_VERSION_SQL`, `CATALOG_COVERED_TABLES` | **runtime-only directory**: both modules issue SQL |
| `ranking` | 4 | 964 | 4 | **0** | `rankBuilds`, `selectArchetypes`, `selectDiverseTop`, `PERFORMANCE_FLOOR`, `STRATEGIES`, `REASON_CODES` | pure |
| `retention` | 5 | 1 420 | 5 | **0** | `retainTopKPerRole`, `computeBudgetFloor`, `computeRoleTargets`, `excludedCpuProductIds`, `resolutionMultiplier` | pure |
| `scoring` | 8 | 2 454 | 8 | **2** (`load-*`) | `computeBuildScore(s)`, `computeCandidateScore(s)`, `computeEffectiveScore`, `computeBuildScoreContributions`, `loadScoringModel`, `loadComponentAssessments`, `listUseCases`, `validateScoringModelConfiguration` | pure + two loaders in one barrel |

**Totals: 80 non-test modules, 18 297 non-test lines.** Excluding ingestion: 72 modules, 17 184 lines.

**Revision 10 note (CURRENT, §25.3):** those totals are the `a413f25` measurement and are retained as that revision's record. Today the same population is split: 50 implementation files (12 335 lines) and 17 identity shims remain under `src/recommendation/`, while 30 moved modules (5 865 lines) plus the package entry point sit in `packages/recommendation-core/src/`. Do not read the per-stage rows above as today's paths — §25.3 carries the current per-tree figures.

### 6.2 The four properties that "pure" was hiding

The first revision used "pure", "no I/O" and "no `pg`" as if they were one claim. They are not. Each is stated separately, with its own evidence and its own consequence for the split.

| # | Property | True today? | Evidence | Where it belongs |
|---|---|---|---|---|
| P1 | **No direct third-party runtime dependency on a PostgreSQL driver** | **TRUE** | `grep -rn "require('pg')\|require(\"pg\")\|require('dotenv')" src/` → **0 non-test hits**; 23 `*.test.js` files require `pg`. No non-relative require exists in any non-test engine file. | both packages (core: zero deps; runtime: zero deps, client is injected) |
| P2 | **No ownership of the connection pool or its lifecycle** | **TRUE** | no `new Pool`, no `connect()`, no `end()`, no `client.release()` anywhere under `src/recommendation/`; `snapshot.js`/`commit.js` require a single **dedicated** connection and never create, close or release it | runtime (the requirement stays runtime's contract) |
| P3 | **No direct I/O** | **FALSE as previously written** | **17 non-test modules contain `.query(`** — 15 outside `ingestion/`: `candidates/loader.js`, `filtering/context-loader.js`, `offers/select.js`, `query/{load-query-input,catalog-version}.js`, `scoring/{load-assessments,load-scoring-model}.js`, `persistence/{persist-ranked,persist-pass-facts,persist-rejections}.js`, `orchestrator/{run,snapshot,commit,swap-preview,swap-commit}.js` | runtime — **these are the modules the split exists to separate** |
| P4 | **Pure deterministic computation** | **TRUE for a named subset, not for the tree** | the 33 modules listed as core in §11.2: no `.query(`, no clock read outside the injected `nowMs`, no randomness, no `process.env`, no `fs` | core |

Two further distinctions the first revision blurred, both of which matter for the dependency matrix (§9.5):

- **An interface dependency is still a dependency.** Runtime takes a `pg`-compatible client rather than requiring `pg`; that removes the *npm* edge, not the *protocol* edge. §9.5 records the protocol and schema dependencies explicitly.
- **The API's connection handling is not the engine's.** `apps/api/src/db.js` constructs the `Pool`; `apps/api/src/engine.js` documents the single-dedicated-connection requirement. Option B does not move pool ownership: the **API keeps owning the pool**, runtime keeps owning **query execution and transaction control**.

**The correction that matters for the split:** a module that calls `db.query(...)` is infrastructure-facing even when it has no third-party import. Three barrels export such modules **beside pure ones** and are therefore *mixed*: `candidates/index.js`, `filtering/index.js` and `scoring/index.js`. Two barrels export **nothing but** such modules and are runtime-only, **not mixed**: `offers/index.js` (`selectOfferPrices` only) and `query/index.js` (both modules issue SQL). `offers/as-of.js` (`parseAsOf`) is a separate pure module reached by direct path rather than through the `offers` barrel, and it moves to core on its own. That is why §11.2 is a file-level mapping and not a directory move.

### 6.3 Dependency graph and strongly-connected components (CURRENT, measured)

**Method (reproducible, read-only).** Walk every non-test `.js` under `src/recommendation`; resolve each relative `require` to a file (`x.js`, then `x/index.js`); run Tarjan's algorithm. Command recorded in §23.2.

**Result:**

```
production modules:                       80
resolved intra-tree require edges:        220
strongly-connected components:            80
SCCs containing more than one module:     0     ← the graph is a DAG
modules requiring anything outside src/recommendation: 0
```

**Cross-stage module-level edges (all one-directional):**

| Edge | Count | Edge | Count |
|---|---|---|---|
| `assembly → candidates` | 9 | `orchestrator → filtering` | 2 |
| `assembly → filtering` | 2 | `orchestrator → offers` | 3 |
| `explanation → assembly` | 1 | `orchestrator → persistence` | 3 |
| `explanation → candidates` | 3 | `orchestrator → query` | 2 |
| `explanation → ranking` | 1 | `orchestrator → ranking` | 1 |
| `explanation → scoring` | 1 | `orchestrator → retention` | 1 |
| `filtering → candidates` | 8 | `orchestrator → scoring` | 2 |
| `filtering → compatibility` | 1 | `persistence → candidates` | 5 |
| `offers → assembly` | 1 | `query → candidates` | 3 |
| `offers → candidates` | 4 | `ranking → assembly` | 2 |
| `orchestrator → assembly` | 3 | `ranking → candidates` | 3 |
| `orchestrator → candidates` | 7 | `retention → assembly` | 2 |
| `orchestrator → explanation` | 1 | `retention → candidates` | 7 |
| | | `retention → filtering` | 1 |
| | | `scoring → assembly` | 1 |
| | | `scoring → candidates` | 10 |

**Reading, and what the first revision got wrong:**

1. **There is no cycle, at module level or at stage level.** The edge set above has no path from a consumer back to its dependency: `assembly` borrows from `filtering`, `retention`/`scoring`/`ranking` borrow from `assembly`, `explanation` borrows from `ranking` and `assembly`, and `orchestrator` borrows from everyone. The earlier claim of "one strongly-connected graph" is **withdrawn**. A per-stage diagram with arrows into a stage is a list of who consumes whom, not a proof of strong connectivity.
2. **Orchestration dependencies are distinct from reverse dependencies.** All 35 edges out of `orchestrator` modules are composition: 25 cross-stage (`orchestrator → X`) and 10 intra-stage. There is not one `X → orchestrator` edge. *(Measured 2026-11-11: 7 `orchestrator` files, 35 outgoing edges — 25 cross-stage plus 10 intra-stage; the cross-stage column above sums to the same 25.)* The graph therefore already has the shape Option B wants: one top layer composing everything, one middle layer of infrastructure (loaders/persistence), one bottom layer of pure computation.
3. **The shared kernel is small and pure:** `candidates/{roles,errors,select,candidate,input}` (10 inbound edges from `scoring` alone), `assembly/{prices,assemble}`, `filtering/filter`. Every one is a pure module, which is why the split does not need to break a cycle — it needs to place files.
4. **Barrel imports inflate the appearance of coupling.** Three consumers import a *barrel* to obtain one constant (`ranking/rank.js:3`, `explanation/build-facts.js:46`, `explanation/reasons.js:107`); the underlying modules are still pure. §11.3 narrows those three lines, which makes every core→core edge file-precise.

### 6.4 Mixed files: what must be split (CURRENT → required change)

| Barrel | Pure exports (core) | Infrastructure exports (runtime) | Required change |
|---|---|---|---|
| `candidates/index.js` | `COMPONENT_ROLES`, `ROLE_ORDER`, `SINGULAR_ROLES`, `PRODUCT_CATEGORIES`, `ROLE_CATEGORIES`, validators, `ERROR_CODES`, `CandidateSelectionError`, `createCandidateSelectionInput`, `createCandidate`, `SELECTION_STAGES`, `IMPLEMENTED_STAGES`, `selectCandidatePool`, `compareCandidates` | `loadCandidates` | two barrels: core exports all but `loadCandidates`; runtime exports `loadCandidates` |
| `filtering/index.js` | `filterCandidates`, `CANDIDATE_STATUSES`, `buildIntegratedGpuPresentMap` | `loadFilteringContext`, `CONTEXT_COMPAT_KEYS` (defined in `context-loader.js`), `filterCandidatesForRecommendation` (composes loader + filter) | split three ways: `filter.js`+`igpu-map.js` → core; `context-loader.js`+`pipeline.js` → runtime |
| `scoring/index.js` | configuration validators, `listUseCases`, `GPU_POLICIES`, `selectAssessmentRow`, `computeEffectiveScore`, `computeCandidateScore(s)`, `computeBuildScore(s)`, `computeBuildScoreContributions` | `loadScoringModel`, `SELECT_SCORING_MODEL_SQL`, `loadComponentAssessments`, `SELECT_COMPONENT_ASSESSMENTS_SQL` | two barrels |
| `offers/index.js` | *(none — barrel is runtime-only)* | `selectOfferPrices`, `SELECT_OFFER_PRICES_SQL` | `offers/as-of.js` (`parseAsOf`, pure) moves to core; runtime keeps `select.js`; `orchestrator/run.js` re-points its import |
| `query/index.js` | *(none)* | all six exports | the whole directory moves to runtime; **no split needed** |
| `orchestrator/index.js` | *(none)* | all eight exports | whole directory → runtime; no split needed |
| `assembly/index.js` | all eleven exports | *(none)* | **not a mixed barrel** — it is pure today. The only change is the three narrow imports in §11.3. |

**Consequence for barrel design.** Within one package, a barrel may re-export everything in its subtree, because the subtree is homogeneous. Across the boundary, runtime must **not** re-export core's names as its own: `recommendation-runtime/filtering` and `recommendation-core/filtering` would otherwise both exist and disagree. Runtime's subpath exports are therefore named for what runtime owns (`./loaders/…`, `./orchestrator`, `./persistence`), never for a core stage it happens to consume.

### 6.5 Transaction and statement ownership (CURRENT — per module, not per directory)

The first revision grouped `orchestrator/{snapshot,run,full-run,commit,swap-preview,swap-commit}.js` as "transaction management". The source does not support that grouping.

| Module | Executes SQL? | Starts a transaction? | Commits / rolls back? | Responsibility |
|---|---|---|---|---|
| `orchestrator/run.js` | **yes — exactly one statement** (`SELECT CURRENT_TIMESTAMP AS now`, line ~97) | **no** | **no** | composes the read/load/compute pipeline on an injected client; header: "NO transaction control" |
| `orchestrator/snapshot.js` | yes — `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, `ROLLBACK` | **yes (read-only)** | **ROLLBACK always** (success and error); never `COMMIT` | owns the read snapshot |
| `orchestrator/full-run.js` | **no statements of its own** | **no** | **no** | orchestrates snapshot → `rankBuilds` → `selectArchetypes` → `explainSelection` → `commit.runRecommendationCommit` |
| `orchestrator/commit.js` | yes — `BEGIN`, two guard `SELECT`s, `COMMIT`/`ROLLBACK` | **yes (write, default isolation)** | **COMMIT on success, ROLLBACK on any error** | owns the write transaction; delegates DML to `persistence/*` |
| `orchestrator/swap-preview.js` | yes — loaders + `BEGIN`/`ROLLBACK` **only in `evaluateSwapPreviewSnapshot`** | **only in the `*Snapshot` wrapper** | **ROLLBACK only** | `composeSwap` issues no transaction control; the preview is read-only |
| `orchestrator/swap-commit.js` | yes — `readNowMs`, three `INSERT`s (via `db.query`), `SELECT_COMMITTED_SWAP_SQL`; `BEGIN`/`COMMIT` **only in `commitSwapInTransaction`** | **only in `commitSwapInTransaction`** | **COMMIT/ROLLBACK only there** | `commitSwap` runs on the caller's handle with no transaction control; the wrapper owns the write transaction |
| `persistence/{persist-ranked,persist-pass-facts,persist-rejections}.js` | yes — DML only | **no** | **no** | write payloads; banned tokens pinned by their own tests |
| `persistence/validate-{selected,rejections}.js` | no | no | no | pure payload validators (runtime-owned contracts) |

**Summary:** two modules own transactions for the pass (`snapshot`, `commit`), two own them for swaps (`evaluateSwapPreviewSnapshot`, `commitSwapInTransaction`), and the two composing modules (`run`, `full-run`) own none. That distinction is what the runtime package's documentation must carry, because it is the part a new consumer most often gets wrong: handing a `Pool` to `snapshot`/`commit` silently breaks the transaction (both headers say so).

---

## 7. Target project architecture

### 7.1 Shape (PROPOSED — Option B selected)

```
morocco-pc/                        ← system, not a project: navigation + registers
├── packages/
│   ├── recommendation-core/       ← NEW. Pure domain. Zero third-party deps.
│   ├── recommendation-runtime/    ← NEW. SQL loaders, orchestration, persistence.
│   └── database-guard/            ← NEW. Support package (owned with P2). §9.4.
├── apps/
│   ├── api/                       ← P4  HTTP contract owner, Fastify, repository, pool
│   ├── offer-ingestion/           ← P3  operator import, adapters, identity, offer gates
│   ├── web/                       ← P5  V1 (frozen, transitional; manifest already exists)
│   └── web-v2/                    ← P6  V2 (manifest already exists; branch only today)
├── contract/
│   └── openapi-<version>.json     ← P4-owned publication point (§15)
├── database/                      ← P2  schema authority: migrations, seeds, ledger, replay
│   └── tooling/                   ← lifecycle + schema gates (moved from scripts/)
└── docs/                          ← system docs + registers + generated mirrors
```

The tree is deliberately **not** a workspace layout (§17.5). Each project's manifest is independent; nothing is hoisted; nothing is implicit.

### 7.2 Why Option B, and why not the others

| Option | What it was | Verdict | Reason |
|---|---|---|---|
| **A — one engine package** | `packages/recommendation-engine/` with pure modules and loaders side by side, 12 barrels, `persistence/` without one | **REJECTED** | It moves the directory and leaves every mixed barrel intact: a consumer importing `filtering` still gets `loadFilteringContext` beside `filterCandidates`. The package boundary would assert purity it cannot enforce. |
| **B — core + runtime** | `packages/recommendation-core/` (pure) and `packages/recommendation-runtime/` (SQL, orchestration, persistence), runtime → core | **SELECTED** | It is the only option where the boundary expresses the actual property: the 15 SQL-executing modules land in one package and the 33 pure ones in another, and a dependency test can prove it. It also gives the eventual "core without a database" consumer an address without a second refactor. |
| **C — three or more packages** (e.g. a separate `compatibility` package, a `persistence` package) | finer-grained package set | **REJECTED for now** | The measured kernel is 4 modules used by 10+ consumers; splitting it would create a package for `ERROR_CODES` and `priceKey`. Finer splits need a measured reason (a second consumer, or a build-time benefit), not a preference. |

Option B's cost is real and stated in §11.2: **33 files move to core, 24 to runtime, 8 barrels are split or re-pointed, and 2 import lines narrow.** No behaviour changes; no SQL changes; no contract changes.

### 7.3 The six ownership areas, their packages and their applications

**Terminology.** "Six projects" is an ownership shorthand, not a package count. There are **six top-level ownership areas**, more than six installable units, and one area with no installable project package at all:

| Ownership area | Installable units inside it |
|---|---|
| P1 — Recommendation engine | `packages/recommendation-core/` and `packages/recommendation-runtime/`: **two separately packaged components of one ownership area**, answering to one accountable owner |
| P2 — Database / data platform | `database/` is a **schema + tooling area with no package manifest** (by design, §10.4), plus the shared support package `packages/database-guard/`, owned by the database/security responsibility (§9.4) |
| P3 — Offer ingestion | `apps/offer-ingestion/` (application) |
| P4 — Backend API | `apps/api/` (application) |
| P5 — Frontend V1 | `apps/web/` (application, manifest exists) |
| P6 — Frontend V2 | `apps/web-v2/` (application, manifest exists on its branch) |

Ownership boundaries are **not** renumbered or merged to preserve the number six. Core and runtime are independent packages inside one area; `database-guard` is a package that is not a project; the database area is a project that is not a package.

#### P1a — Recommendation core (`packages/recommendation-core/`)

| Aspect | Proposal |
|---|---|
| Location | `packages/recommendation-core/` (new) |
| Owns | domain algorithms and deterministic transformations: compatibility pair rules, candidate contracts and selection ordering, hard filtering, build assembly, scoring arithmetic, retention, ranking and archetype selection, explanation reasons, as-of time parsing |
| Consumes | **only** explicitly supplied inputs: plain objects, frozen maps, integers, strings, and a caller-supplied `nowMs`/`asOf` |
| Must not | execute SQL, require `pg`/`dotenv`/`fs`/`http`, read `process.env`, read the clock, use randomness, import runtime/API/ingestion, mutate inputs |
| Exposes | subpath entries per domain area (§11.4) |
| Deploy | none — a library |
| Tests | `node --test` from its own directory, fixture-driven, no DB, no network, no env (§11.6) |

#### P1b — Recommendation runtime (`packages/recommendation-runtime/`)

| Aspect | Proposal |
|---|---|
| Location | `packages/recommendation-runtime/` (new) |
| Owns | SQL-backed loaders; query execution through the injected client; row→core input translation; the read snapshot; the write transaction; persistence and swap writes; the composition entry points (`run`, `full-run`, swap preview/commit) |
| Consumes | `recommendation-core`; an injected `pg`-compatible client (or an explicitly documented adapter); the schema it queries |
| Must not | own the connection pool (the caller keeps that, §6.2), create/close/release clients, import the API or ingestion, expose core's names as its own |
| Exposes | `./loaders/*`, `./orchestrator`, `./persistence` (§11.5) |
| Deploy | none — a library, shipped inside the API image |
| Tests | DB-free unit tests over a recording fake client **plus** DB-backed suites on the TEST branch only |

#### P2 — Database / data platform (`database/`)

| Aspect | Proposal |
|---|---|
| Location | `database/` (schema, seeds, ledger, audit log) + `database/tooling/` (lifecycle and schema-state CLIs) |
| Owns | 23 migrations and their order, 32 seeds, the `schema_migrations` ledger, restore-point and audit-line rules, the replay gate, target parity, the generated schema/state mirrors, the access conventions (variables, digests, roles), schema-level data gates (§8) |
| Consumes | a database at run time; nothing at build time |
| Exposes | the schema (the only authority), the lifecycle CLIs, the generated mirrors, and — as a **separate installable package** — the guard (§9.4) |
| Must not | import engine/application/frontend code; be imported as a *project* |
| Deploy | data, not code; applied by an operator under the existing guards |

**Not a package, but not package-less either.** The *project* stays a directory with no build-time surface. The one programmatic interface consumers need — the target guard — is extracted into `packages/database-guard/` so that a `file:` dependency points at something installable. Those are two different things, and the first revision conflated them.

#### P3 — Offer ingestion (`apps/offer-ingestion/`)

| Aspect | Proposal |
|---|---|
| Location | `apps/offer-ingestion/` (today `src/recommendation/ingestion/` + `scripts/ingest-offers.js` + the three offer gates) |
| Owns | adapters, listing validation, identity matching tiers, curated rejection codes, plan/apply, ingestion records, price-history writes, provenance/freshness/coverage gates |
| Consumes | Layer 1 identities and Layer 3 tables through its own SQL; `database-guard` for target safety |
| Must not | import `recommendation-core` or `recommendation-runtime` (zero edges today; keep zero) |
| Deploy | an operator-run job, not a service (B4) |

#### P4 — Backend API (`apps/api/`)

| Aspect | Proposal |
|---|---|
| Location | `apps/api/` |
| Owns | the HTTP contract, the Fastify app, route validation, application services, the repository (API-owned SQL), the **connection pool**, rate limiting, CORS, the deployment artifact, the OpenAPI document |
| Consumes | `recommendation-runtime` (orchestration), `recommendation-core` (pure vocabulary), `database-guard`, `pg` |
| Must not | import runtime internals, ingestion, either frontend, or any `scripts/` path |
| Deploy | one Docker image, one platform service (B6) |

#### P5 / P6 — Frontend V1 and V2

| Aspect | V1 (`apps/web`) | V2 (`apps/web-v2`) |
|---|---|---|
| Manifest | **already own** `package.json` + `package-lock.json` | **already own** `package.json` + `package-lock.json` (branch) |
| Owns | wizard, results, compare, catalogue, guides, saved builds, presets, SEO/crawl, fr/ar | design system, homepage, configurator, future results/catalogue/compare, fr/ar + RTL |
| Consumes | `/v1/**` over HTTP; generated types from the contract | same |
| Must not | import engine/runtime/API internals/database; import V2 code | import engine/runtime/API internals/database; import V1 code |
| Deploy | configured for Workers/OpenNext, never deployed | **no configuration** (B6) |
| Lifecycle | **frozen**, retired per §19 | the future frontend (product decision B2) |

### 7.4 What stays outside every project

| Thing | Why it has no project | Where it lives |
|---|---|---|
| `test/golden/` baselines + scenario matrix | cross-project evidence (runtime behaviour over a database state) | root `test/`, **accountable owner recommendation-runtime** (§8.2) |
| `scripts/eval-scenarios.js`, `scripts/measure-*.js` | measurement harnesses that read the database and drive runtime | PROPOSED: `tools/measurement/`, owned by runtime |
| `.github/workflows/` | CI is repository-level | root; each job owned by the project it runs |
| `docs/OPEN_POINTS.md`, decision log, glossary | cross-project registers | root `docs/` |
| `pr8-fix-saved-spec.patch` | unowned history | PROPOSED: delete or `docs/archive/` (§16.5) |

---

## 8. Authoritative ownership matrix

This is the **only** ownership matrix in the document. Every other section refers to it; none restates it with a different answer.

### 8.1 Responsibility by project

**PROPOSED.** ● accountable · ○ contributes · – must not touch.

| Responsibility | core | runtime | database | ingestion | api | web V1 | web V2 |
|---|---|---|---|---|---|---|---|
| Compatibility rule table (Decision 26/45) | ● | ○ (passes rows) | ○ (schema) | – | – | – | – |
| Candidate contracts, ordering, tie-breaks | ● | ○ (builds inputs) | – | – | – | – | – |
| Hard filtering, assembly, scoring arithmetic | ● | ○ | – | – | – | – | – |
| Retention, ranking, archetype selection | ● | ○ | – | – | – | – | – |
| Explanation text and reason codes | ● | ○ (feeds facts) | – | – | – | – | – |
| SQL loaders and row→input translation | – | ● | ○ (schema) | – | – | – | – |
| Read snapshot + write transaction | – | ● | ○ | – | ○ (supplies the client) | – | – |
| Persistence of a pass / swap | – | ● | ○ | – | ○ (triggers) | – | – |
| Schema, migrations, constraints | – | ○ | ● | – | ○ | – | – |
| Seeds and catalogue/assessment data | – | – | ● | ○ (offers only) | – | – | – |
| Ledger, restore points, audit lines, replay, target parity | – | – | ● | ○ (write target) | – | – | – |
| Generated schema/state mirrors | – | – | ● | – | – | – | – |
| Schema-level data gates (§8.3) | ○ (rule semantics) | – | ● | – | – | – | – |
| Offer provenance / freshness / coverage gates | – | – | ○ (schema) | ● | ○ (serves the class) | ○ (labels) | ○ (labels) |
| Retailer listing parsing, identity matching, import acceptance | – | – | ○ (`product.slug`) | ● | ○ (serves slug) | – | – |
| HTTP contract, versioning, compatibility gate | – | – | – | – | ● | ○ | ○ |
| Request validation, status codes, rate limiting, CORS | – | – | – | – | ● | – | – |
| Connection pool lifecycle | – | – | – | – | ● | – | – |
| Catalogue read model (API SQL) | – | – | ○ | – | ● | ○ | ○ |
| Recommendation pass execution and archetype selection | ○ (calculation and selection functions) | ● (DB-backed execution via `runRecommendationFullRun`) | ○ (schema) | – | ○ (invokes runtime) | – | – |
| Preset generation job, CLI and operational publishing | ○ (selection functions only) | ○ (provides the execution interface) | ○ (schema, integrity) | – | ● (`generate-presets`, `apps/api/bin/`) | ○ (renders) | ○ (renders) |
| Design system / tokens / locale content | – | – | – | – | – | ● | ● (own) |
| Frontend SEO / crawl surface | – | – | – | – | ○ (catalog routes) | ● | ○ (planned) |
| API deployment | – | – | – | – | ● | – | – |
| Frontend deployment | – | – | – | – | – | ○ (configured) | ○ (B6) |

### 8.2 Golden tests: one accountable owner

The first revision assigned the golden harness "jointly to P1 + P2", which is a way of assigning it to nobody.

| Aspect | Decision |
|---|---|
| **Accountable** | **recommendation-runtime.** The harness drives the full DB-backed pipeline (loaders + orchestrator + commit) against a real TEST database; that is runtime's domain, and runtime is the only package whose tests legitimately need a database. |
| Contributors | **core** — owns the expected values of pure stages and the fixture contracts; **database** — owns target safety (guard, digest, restore point), fixture lifecycle and cleanup ordering; **api** — owns contract-visible fields the harness asserts (`price_status`, `catalog_version`, `engine_version`). |
| Evidence | `test/golden/` baselines stay at the root as cross-project evidence; the runner lives with runtime; the root `docs/TEST_MAP.md` indexes it. |

### 8.3 Gate ownership (one accountable project per gate)

| Gate / tool | Accountable | Consumes | Why |
|---|---|---|---|
| `check-offer-provenance.js` | **ingestion** | schema, `store_offer`, `ingestion_record` | it defines what "imported from a retailer" means |
| `check-offer-freshness.js` | **ingestion** | offer timestamps | freshness is an import-acceptance property |
| `check-offer-coverage.js` | **ingestion** | offers + catalogue identities | coverage of imported offers |
| `check-catalog-identity.js` | **database** | `product.display_name`/`slug` on ACTIVE rows | it asserts a schema-level identity obligation on seeded catalogue rows |
| `check-og01-coverage.js` | **database** | assessment rows vs a pinned model | assessments are seeded data |
| `check-assessment-age.js` | **database** | assessment timestamps | data-age property of a seeded layer |
| `check-deferred-rules.js` | **core** (rule semantics) | catalogue rows; runs in database CI | it encodes Decision 26 compatibility rules the core owns |
| `check-target-parity.js` | **database** | two databases | target/state verification |
| `verify:replay` / `run-migrations` / `run-seeds` / `cleanup-layer4` / `gen-schema-reference` | **database** | databases | lifetime and schema authority |
| `apply-/rehearse-/smoke-api-role.js`, `check-deployed-role.js` | **database** | DB roles, `pg_stat_activity` | role and credential verification |
| `ingest-offers.js` | **ingestion** | Layer 1/3 | the import itself |
| `generate-presets.js` | **api** | runtime (execution interface), repository, Layer 4 | the API owns the job; runtime only executes the pass it requests |
| `eval:scenarios` + baselines | **runtime** | all three (contributors above) | §8.2 |
| `measure-*.js` harnesses | **runtime** | database, runtime | read-only pipeline replication |

**Rule:** a gate may be *executed* by another project's CI job (the database job runs `check-deferred-rules`), but accountability — who fixes it, who owns its definition — stays with the project named here. No gate appears twice with two owners.

---

## 9. Dependency and interface matrix

### 9.1 Allowed dependency edges

**PROPOSED.** Rows may depend on columns only where marked.

| ↓ depends on → | core | runtime | guard | database (schema) | ingestion | api | contract | web-v1 | web-v2 |
|---|---|---|---|---|---|---|---|---|---|
| **core** | — | – | – | – | – | – | – | – | – |
| **runtime** | ● code | — | ○ target safety (tests) | ○ schema + SQL semantics | – | – | – | – | – |
| **guard** | – | – | — | – | – | – | – | – | – |
| **database tooling** | – | – | ● | ○ owns it | – | – | – | – | – |
| **ingestion** | – (hard) | – (hard) | ● | ○ schema | — | – | – | – | – |
| **api** | ● frozen vocabulary only (§9.2) | ● orchestration | ● start-up guard | ○ schema | – | — | ● owns | – | – |
| **web-v1** | – | – | – | – | – | ○ HTTP | ○ types | — | – |
| **web-v2** | – | – | – | – | – | ○ HTTP | ○ types | – | — |

### 9.2 Public interfaces (one per edge)

| Edge | Interface | What makes it an interface rather than a convention |
|---|---|---|
| core ← runtime | core's subpath exports and frozen input/output contracts (§11.4) | core's own boundary test: no `.query(`, no `pg`, no `fs`, no `process.env`. Runtime is core's primary in-repo consumer, **not its only one** (next row) |
| core ← api | **frozen vocabulary only**: `COMPONENT_ROLES`, `EXPANSION_ORDER`, `listUseCases`, `resolutionMultiplier`, the error vocabulary (`ERROR_CODES`, `CandidateSelectionError`), and immutable domain contracts the HTTP layer must not restate (`GPU_POLICIES`, `STRATEGIES`, `REASON_CODES`/`REASON_ORDER` where a response names a reason) | an API-side boundary test asserting every API→core import names a symbol on the approved list. The API may **not** import core calculation entry points (`computeBuildScore`, `assembleBuilds`, `retainTopKPerRole`, `rankBuilds`, `selectArchetypes`, `filterCandidates`, `explainSelection`) to reproduce business logic: passes, previews, commits and the catalog digest are reached through runtime. Runtime does **not** become the owner of vocabulary the API consumes; the symbols stay core's |
| runtime ← api | `./orchestrator` and `./persistence` entry points, with the single-dedicated-connection contract | `import-boundary.test.js` extended to runtime internals; the connection contract is stated in the module headers |
| guard ← api / ingestion / database tooling | its **seven** exports: `CONNECTION_TIMEOUT_MILLIS`, `normalizeHost`, `resolveTestDbUrl(env)`, `getWriteTestDbUrl(env)`, `describeTarget`, `toDirectUrl`, `normalizeTarget` | its own package manifest (`packages/database-guard/package.json`) and its own unit test (`packages/database-guard/test/db-url.test.js`, moved from `scripts/lib/db-url.test.js`). `apps/api/test/unit/db-guard.test.js` does **not** move: its filename is misleading, and it tests API pool configuration (`resolvePoolConfig`, `STATEMENT_TIMEOUT_MS`, `APPLICATION_NAME`), not the guard |
| schema ← runtime / api / ingestion | tables, columns, enums, constraints | numbered migrations are the only DDL source; `verify:replay` diffs by definition |
| api → frontends | `contract/openapi-<version>.json` | both frontends' `check:api-types`; `openapi-snapshot.test.js` byte-compares the served document |
| api ↔ frontends at runtime | `/v1/**` JSON over HTTPS | contract version + committed snapshot |
| ingestion → database | listing rows + plan/apply inside one transaction | `runIngestion(db, input)`; caller owns the transaction |
| operator → ingestion | a CSV/JSON file | `adapters/manual.js parse(text, { format })` |

### 9.3 Forbidden imports and how each is caught

**PROPOSED gate set.** Of the edges listed below, only the API→engine edge is enforced by a test today; the only other enforced boundary in the tree is the extracted guard's own zero-`require` scan (PR #27). The rest are conventions.

| Forbidden | Today | Proposed gate |
|---|---|---|
| API imports a runtime internal or a core internal | **enforced** for the engine via `import-boundary.test.js` (barrels only, `persistence/persist-ranked` the single exception) | keep, re-point at the two packages |
| `pg` required outside `apps/api/src/db.js` | **enforced** (same file) | keep |
| core requires `pg`/`dotenv`/`fs`/`http`, or any non-relative module | not enforced by test, true today (0 non-test hits) | core boundary test: every `require` is relative and resolves inside the package |
| any core file contains `.query(` | not enforced | core boundary test: token scan over `src/**/*.js` |
| core reads `process.env`, `Date.now`, `new Date`, `Math.random` | not enforced; three suites already assert it per-module (`explanation/index.test.js:34`, `explanation/reasons.test.js:530-537`) | package-wide scan, allowlist empty |
| runtime imports core's internals (deep paths) | n/a (one package today) | runtime boundary test: core imports go through core's declared subpaths |
| runtime re-exports a core name as its own | n/a | runtime entry-point test (§11.4) |
| ingestion imports core or runtime | not enforced; zero edges today | boundary test over `apps/offer-ingestion/src` |
| frontend imports engine/runtime/API/database source | not enforced | per-app boundary test |
| API imports ingestion | not enforced | as above |

### 9.4 The guard: an installable package, not a directory

**IMPLEMENTED (PR #27, merged 2026-11-11 as `3e2f13e`).** The guard is now `packages/database-guard/`: a manifest (`@morocco-pc/database-guard`, `private`, `version` `0.1.0`, `main: src/index.js`, **no dependencies**), the implementation at `src/index.js`, and its own test at `test/db-url.test.js` with its own runner (`npm run test:database-guard`, wired into `ci.yml`). The seven exports and their contracts are exactly the design below. `apps/api/src/db.js:26` and every write-capable script now require `packages/database-guard/src` by relative path, and `scripts/lib/db-url.js` plus `scripts/lib/db-url.test.js` no longer exist. `.env` loading moved to the consumers, so the zero-dependency contract held without the documented fallback. Docker and hosting files were changed **by path only** (owner decision 1, §13.4): `.dockerignore` keeps `packages/database-guard/` in the build context, `apps/api/Dockerfile` copies `packages/database-guard/package.json` and `packages/database-guard/src`, and the `fly.toml`/`render.yaml` comments cite the same path. The four-manifest `file:` image build remains the step-6 design. Nothing else moved: `packages/recommendation-core/` and `packages/recommendation-runtime/` carry a manifest (runtime also keeps its `docs/LOADERS_AND_TRANSACTIONS.md`), but **no recommendation module has been extracted** — that is steps 4 and 5 (§19.1). (Core later gained the boundary harness of §11.6, which is a gate rather than an extracted module.)

**Baseline before PR #27 (CURRENT then; `master` = `e62c816`, measured 2026-11-11).** `scripts/lib/db-url.js` (zero third-party deps) exported **exactly seven** public symbols, and the package contract is those seven and no others:

| # | Export | Contract |
|---|---|---|
| 1 | `CONNECTION_TIMEOUT_MILLIS` | constant `15000`, the scripts convention |
| 2 | `normalizeHost(urlString)` | pure: lowercased host, a `-pooler` first label stripped |
| 3 | `resolveTestDbUrl(env)` | pure: throws on unset/empty/unparseable `TEST_DATABASE_URL`, unset `DATABASE_URL`, or equal normalised hosts |
| 4 | `getWriteTestDbUrl(env)` | thin wrapper over `resolveTestDbUrl`; takes an explicit env object and loads no `.env` |
| 5 | `describeTarget(urlString)` | pure: `{ endpointId, pooled, database }` |
| 6 | `toDirectUrl(urlString)` | pure: the same string pointed at the direct (non-pooler) host, credentials preserved verbatim |
| 7 | `normalizeTarget(urlString)` | pure: credential-free `{ host, database }` identity |

At that baseline there was **no restore-point predicate export**: the restore-point rule is argument validation in `scripts/lib/apply-seed-args.js` and `scripts/apply-api-role.js`, not part of this package. The guard was required by `apps/api/src/db.js:26`, by seven DB-backed API test files plus `apps/api/test/run-db-tests.js`, and by **18 top-level scripts, every one of which required it directly** (re-measured 2026-11-11 on `master` = `e62c816`). Three further `scripts/lib/` modules also required it (`apply-seed-args.js`, `ingest-args.js`, `migrations.js`), and one `scripts/lib/` module cited it only in a comment (`og01-catalog.js:28`). `scripts/` has **no `package.json`**, so `"db-guard": "file:../../scripts/lib"` could not install — the reason the package exists.

**Design as proposed (PR #27 shipped it as described above).**

| Aspect | Design |
|---|---|
| Contents | the pre-PR-#27 `db-url.js` implementation, moved to `packages/database-guard/src/index.js`; its own test (`scripts/lib/db-url.test.js`) moves to `packages/database-guard/test/db-url.test.js`. `apps/api/test/unit/db-guard.test.js` **stays in the API**: despite its filename it validates the API's pool configuration (`resolvePoolConfig`, `STATEMENT_TIMEOUT_MS`, `APPLICATION_NAME`), and moving it would move API ownership into a package that must stay independent of `pg` |
| Manifest | `package.json`: `name`, `version` (repo-tracked, not published), `main: src/index.js`, **zero dependencies — no `dotenv`, no `pg`** |
| Authoritative implementation | this package, and only this package. No copy in the database project, the API image or a Docker layer |
| Consumers | `apps/api`, `apps/offer-ingestion` (not yet created), `database/tooling`, runtime/its tests. Until npm workspaces exist (out of scope, R3) consumers import it by **relative path** from the repository root; the `file:` dependency is step 6's change, not step 3a's |
| Versioning | consumed by commit like every other package in the repo (§17.4); adding a registry or a semver release is out of scope |
| Why not "a package inside `database/`" | a `file:` dependency must resolve to a directory with a manifest; putting one inside `database/` would make the database project installable-by-accident, which is exactly what P2's "not a package" rule forbids in spirit |
| Why not inline it in the API | the guard is a security control shared by five consumers; an inline copy would be a second authoritative implementation |

**Environment loading is not the guard's job (selected design).** The current `getWriteTestDbUrl()` calls `require('dotenv').config()`; that call is the only reason a dependency would be needed, and it moves to the caller:

| Function | Package contract |
|---|---|
| `resolveTestDbUrl(env)` | pure; takes an explicit env object (already true today) |
| `getWriteTestDbUrl(env)` | takes an explicit env object; **never** loads `.env` itself |
| `describeTarget`, `normalizeTarget`, `normalizeHost`, `toDirectUrl` | pure; explicit inputs only |

Every consumer calls `getWriteTestDbUrl(loadedEnv)` with an environment its own bootstrap loaded: `apps/api/src/db.js` already receives an explicit `env` argument, and each CLI already initialises `dotenv` at its entry point (`scripts/generate-presets.js:86` is the pattern). Safety semantics are unchanged: same host comparison, same refusal messages, same digest, same restore-point rule. `dotenv` stays a dependency of the **applications**, where it is already installed.

**Documented fallback, if implementation finds a caller that depends on the guard loading `.env`** (for example a script whose argument parsing assumes it): declare `dotenv` in the guard's manifest, **delete the zero-dependency claim from this section and from §17.5**, and keep the Docker design unchanged — the dependency then resolves from `apps/api/node_modules` like any other. The RFC does not permit both: a package cannot be zero-dependency and silently load `.env`.

### 9.5 The dependency the first revision hid: schema and client protocol

Runtime executes SQL. Saying "it has no database dependency because the client is injected" would be false in every sense except npm packages. The matrix therefore records four distinct relations:

| Relation | Runtime? | API? | Form | Consequence |
|---|---|---|---|---|
| **npm dependency on a PG driver** | **no** | **yes** (`pg`) | package manifest | only the API installs a driver; runtime declares a peer/interface expectation |
| **interface dependency on a client/query protocol** | **yes** | yes | `client.query(sql, params)` returning `{ rows }`; single dedicated connection for transactions | documented in runtime's README; a wrapper must satisfy it |
| **logical dependency on schema and SQL semantics** | **yes** | yes | table/column names, enum values, isolation levels, `SELECT … FOR UPDATE` | changes ship as migrations + loader changes in one PR (§17.3) |
| **ownership of connection/pool lifecycle** | **no** | **yes** | `new Pool(...)` in `apps/api/src/db.js` | unchanged by Option B |

**Rule:** the dependency matrix in §9.1 always shows the schema relation for runtime and API, and never describes runtime as "database-free".

---

## 10. Database architecture

### 10.1 What exists (CURRENT)

| Concern | Mechanism | Evidence |
|---|---|---|
| Schema authority | numbered migrations applied in filename order through a ledger | `database/migrations/001…023`, `scripts/run-migrations.js`, `schema_migrations` |
| Re-applicability | ledger-driven pending tail; `--baseline` adopts a pre-ledger database | `scripts/run-migrations.js --check/--baseline` |
| Shared-database safety | a real apply against `DATABASE_URL` refuses without `--restore-point=<id>`; `--baseline` needs one too; one audit line per applied file | `scripts/lib/run-migrations-cli.test.js`, `database/migration-applies.jsonl` |
| Write-test isolation | `TEST_DATABASE_URL` guard comparing normalised hosts (pooler label stripped) | `packages/database-guard/src/index.js`; its test `packages/database-guard/test/db-url.test.js`. The API's own start-up refusal is pinned separately by `apps/api/test/unit/db-guard.test.js` (pool configuration, not the guard) |
| Drift detection | replay every migration into an EMPTY scratch database, diff by definition | `scripts/verify-migrations-replay.js`, `npm run verify:replay` |
| Target parity | ledger + tables + columns + enums + row counts between two targets | `scripts/check-target-parity.js` |
| Least privilege | `morocco_pc_api` role with a column-scoped grant and a 20-answer self-check | `scripts/apply-api-role.js`, `rehearse-api-role.js`, `smoke-api-role.js` |
| Deployed-credential proof | pooled sessions tagged `application_name = 'morocco-pc-api'`, classified by `usename` | `apps/api/src/db.js`, `scripts/check-deployed-role.js` |
| Generated mirrors | `docs/SCHEMA_REFERENCE.md` + `docs/DATA_STATE.md` | `scripts/gen-schema-reference.js --check` |

### 10.2 What the database project owns (PROPOSED)

1. Migrations, seeds and their ordering rules.
2. The guards' **tests and lifecycle rules** — while the guard *code* lives in `packages/database-guard/` (§9.4).
3. Lifecycle CLIs: `run-migrations`, `run-seeds`, `verify-migrations-replay`, `check-target-parity`, `gen-schema-reference`, `cleanup-layer4`.
4. Schema-level data gates (§8.3): `check-catalog-identity`, `check-og01-coverage`, `check-assessment-age`; it **runs** `check-deferred-rules` without owning its semantics.
5. Generated schema/state documents.
6. Role provisioning and the deployed-credential proof.

**What it must not own:** the offer gates (ingestion), golden baselines (runtime, §8.2), `generate-presets.js` (API), engine measurement harnesses (runtime).

### 10.3 Access conventions to preserve

**CURRENT → PROPOSED to keep unchanged:**

- a write test never targets shared;
- a real-database write needs a restore point and leaves an audit line;
- a migration is never rewritten, only appended;
- `NULL` = UNKNOWN, never 0, in data as well as in code;
- the guard compares normalised hosts and digests, never the variable name;
- credentials are never printed, persisted to files, or read by an agent.

These are the platform's most valuable existing properties and no step of §19 may weaken them.

### 10.4 Project or module?

**PROPOSED:** a **separate owned project inside the repository** — not a package (as a *project*), not a separate repository.

- *Not a package*: there is no library surface to import; the guard is a separate package by exception (§9.4).
- *Not a separate repository*: every engine change that needs a column must land with its migration in one reviewable change; the 23-migration history and the decision log are shared evidence.
- *But a project*: it needs an owner, its own `README.md`, its own docs (lifecycle, roles, restore), its own gates and its own acceptance criteria.

---

## 11. Core/runtime extraction analysis (Option B, file-precise)

### 11.1 What the split is not

It is **not** a directory move. It is not justified, or opposed, by counting files. It is required because §6.2 P3 is true: 15 non-ingestion modules execute SQL, and three barrels (`candidates`, `filtering`, `scoring`) currently export those modules beside pure ones. Separately, `offers/index.js` and `query/index.js` are runtime-only, and the pure `offers/as-of.js` sits beside the `offers` barrel, not inside it. The purpose of this section is to estimate and explain the correct extraction, not to argue for or against it.

### 11.2 Module-level migration mapping

Every non-test module is classified by **its own imports and behaviour**, not by its directory name. `→ core` means the file moves to `packages/recommendation-core/src/<area>/`; `→ runtime` means `packages/recommendation-runtime/src/<area>/`; "same" means the file keeps its name.

| Current source path | Current responsibility | Pure or infrastructure-facing? | Target project | Required change |
|---|---|---|---|---|
| `compatibility/` (14 modules) | 11 pair evaluators, aggregation, reason codes | pure (0 SQL, 0 non-relative requires) | core | whole directory → `core/compatibility`; barrel re-export unchanged |
| `candidates/roles.js` | role/category vocabulary (9 roles) | pure | core | same |
| `candidates/errors.js` | `CandidateSelectionError`, `ERROR_CODES` | pure | core | same; **imported by 14 modules across both packages** |
| `candidates/input.js` | selection-input contract + freezing | pure | core | same |
| `candidates/candidate.js` | candidate factory | pure | core | same |
| `candidates/select.js` | pool selection, `compareCandidates` tie-breaks | pure | core | same |
| `candidates/loader.js` | product/variant SQL → candidate rows | **infrastructure** (`db.query`) | runtime | → `runtime/loaders/candidates.js`; barrel export moves out of core's `candidates` |
| `candidates/index.js` | barrel (14 pure + 1 loader export) | **mixed barrel** | core + runtime | **split** into `core/candidates/index.js` (pure) and `runtime/loaders/candidates.js` |
| `filtering/filter.js` | hard-compatibility filter over a supplied context | pure | core | same |
| `filtering/igpu-map.js` | `buildIntegratedGpuPresentMap` from a supplied context | pure | core | same |
| `filtering/context-loader.js` | specs/platform/compat SQL → frozen context | **infrastructure** (`db.query`) | runtime | → `runtime/loaders/filtering-context.js`; `CONTEXT_COMPAT_KEYS` travels with it |
| `filtering/pipeline.js` | `filterCandidatesForRecommendation` (loader + filter) | **infrastructure composition** | runtime | → `runtime/orchestrator/filtering-pipeline.js` (or a runtime loader entry point) |
| `filtering/index.js` | barrel (3 pure + 3 infrastructure exports) | **mixed barrel** | core + runtime | **split** into two barrels |
| `assembly/assemble.js` | DFS build assembly, `EXPANSION_ORDER`, `evaluateBuild*` | pure | core | same; becomes a **first-class subpath** consumers may import directly (§11.3) |
| `assembly/{input,prices,gpu-policy,gpu-input,pipeline,index}.js` | input validation, price carrier, GPU policy, GPU inputs, pipeline, barrel | pure (7 modules, 0 SQL) | core | same |
| `scoring/configuration.js` | scoring-model configuration validator | pure | core | same |
| `scoring/use-cases.js` | use-case profiles, `GPU_POLICIES` | pure | core | same |
| `scoring/effective-score.js`, `candidate-score.js`, `build-score.js` | scoring arithmetic | pure | core | same |
| `scoring/load-scoring-model.js` | pinned `scoring_model` SQL | **infrastructure** (`db.query`) | runtime | → `runtime/loaders/scoring-model.js` |
| `scoring/load-assessments.js` | `component_assessment` SQL | **infrastructure** (`db.query`) | runtime | → `runtime/loaders/assessments.js` |
| `scoring/index.js` | barrel (pure + 2 loaders + 2 SQL constants) | **mixed barrel** | core + runtime | **split** into two barrels |
| `retention/` (5 modules) | top-K retention, role targets, budget floor, iGPU pool | pure | core | whole directory |
| `ranking/rank.js` | `rankBuilds` ordering | pure (imports `../assembly` barrel for one constant) | core | **narrowing deferred by decision** (step 4B PR 7): still imports `../assembly`, because `test/ranking-rank.test.js:594` pins that exact specifier list |
| `ranking/select-diverse.js` | legacy `selectDiverseTop` walk | pure (imports `../assembly` barrel for one constant) | core | **narrowing deferred by decision** (step 4B PR 7): still imports `../assembly`, pinned by `test/ranking-select-diverse.test.js:377`; §11.3 never named this file, so the deferral closes a gap rather than delaying one of its two items |
| `ranking/select-archetypes.js` | `selectArchetypes`, `STRATEGIES`, `REASON_CODES` | pure | core | same; becomes the target of `explanation/reasons.js:107` |
| `ranking/index.js` | barrel | pure | core | same |
| `explanation/explain.js` | `explainSelection` prose | pure | core | same |
| `explanation/build-facts.js` | per-build facts for explanations | pure (imported the `../assembly` barrel for one constant) | core | **narrowed** to `../assembly/assemble` in step 4B PR 7 commit 0, then moved byte-identical |
| `explanation/reasons.js` | `deriveReasons`, `REASON_ORDER` | pure (imported the `../ranking` barrel) | core | **narrowed** to `../ranking/select-archetypes` in step 4B PR 7 commit 0, then moved byte-identical (`../scoring/use-cases` kept) |
| `explanation/index.js` | barrel | pure | core | same |
| `offers/as-of.js` | `parseAsOf` (explicit `asOf` option) | pure | core | → `core/offers/as-of.js` (step 4B PR 7, byte-identical): the mirrored directory keeps its `../candidates/errors` specifier resolving unchanged, which a flat `core/offers-as-of.js` would break; `orchestrator/run.js` still imports the identity shim until the runtime move |
| `offers/select.js` | cheapest eligible offer SQL + price carrier | **infrastructure** (`db.query`) | runtime | → `runtime/loaders/offer-selection.js` |
| `offers/index.js` | barrel (runtime-only) | **infrastructure** | runtime | whole barrel → runtime; **not** mixed |
| `query/load-query-input.js` | `recommendation_query` SQL + input building | **infrastructure** (`db.query`) | runtime | → `runtime/loaders/query-input.js` |
| `query/catalog-version.js` | 21-table digest SQL | **infrastructure** (`db.query`) | runtime | → `runtime/loaders/catalog-version.js` |
| `query/index.js` | barrel (all six runtime) | **infrastructure** | runtime | whole directory → runtime; **no split** |
| `persistence/persist-ranked.js` | `build_candidate`/`build_component` DML | **infrastructure** (DML) | runtime | → `runtime/persistence/` |
| `persistence/persist-pass-facts.js` | pass-fact UPDATEs | **infrastructure** (DML) | runtime | same |
| `persistence/persist-rejections.js` | `build_rejection` replace semantics | **infrastructure** (DML) | runtime | same |
| `persistence/validate-selected.js`, `validate-rejections.js` | payload validators (pure code, **write-shaped contract**) | pure implementation, runtime contract | runtime | stay in runtime: moving them to core would put a write payload shape in the pure domain (§11.3) |
| `orchestrator/run.js` | composes loaders + pure stages; one timestamp statement; no tx control | **infrastructure** | runtime | → `runtime/orchestrator/run.js` |
| `orchestrator/snapshot.js` | read snapshot (`BEGIN … REPEATABLE READ READ ONLY`, `ROLLBACK`) | **infrastructure** (tx owner) | runtime | → `runtime/orchestrator/snapshot.js` |
| `orchestrator/full-run.js` | composes snapshot→rank→archetypes→explain→commit | **infrastructure composition** | runtime | → `runtime/orchestrator/full-run.js` |
| `orchestrator/commit.js` | write transaction + guards | **infrastructure** (tx owner) | runtime | → `runtime/orchestrator/commit.js` |
| `orchestrator/swap-preview.js` | read-only hypothetical swap (+ `*Snapshot` wrapper) | **infrastructure** | runtime | same |
| `orchestrator/swap-commit.js` | append-only swap write (+ `*InTransaction` wrapper) | **infrastructure** | runtime | same |
| `orchestrator/compute.js` | the pure assemble-and-score seam of one pass: `computeFromLoaded` turns the rows `run.js` already loaded into scoring → retention → Engine 3 → Engine 4 build scores, producing the frozen pass output | **pure** (0 SQL, no clock, no `process.env`, no randomness; requires only `../scoring`, `../retention`, `../assembly` and `../candidates/errors`) | runtime | → `runtime/orchestrator/compute.js`; moves with W3 and is **published nowhere** — §11.5 publishes eight orchestrator entry points and `computeFromLoaded` is not one of them. Its destination is **OWNER DECIDED** (§19.4.1): **Option 1**, runtime-internal — it moves with W3 and is published nowhere |
| `orchestrator/index.js` | barrel | **infrastructure** | runtime | same |
| `ingestion/` (8 modules) | operator import; plan/apply; identity | **infrastructure** | **neither** — `apps/offer-ingestion/` | §12 |
| `*/index.test.js` and sibling `*.test.js` (63 files) | unit suites | n/a | **follow their module** | import paths updated; no assertion change |

**Counts.** Core: **47** file-level moves (14 compatibility + 5 candidates + 2 filtering + 7 assembly + 5 scoring + 5 retention + 4 ranking + 4 explanation + 1 offers/as-of — the mixed barrels are split rather than moved), which is exactly the `blob-identical: 47 / 47` total `npm run verify:extraction` reports across the six batches. Runtime: **23** modules (3 loaders for candidates/filtering/offers + 1 filtering pipeline + 8 orchestrator + 5 persistence + 3 query + 2 scoring loaders + 1 runtime-only offer barrel). Ingestion: 8. Total **78**, plus the per-directory `index.js` barrels and the 63 test files that follow their modules.

**Runtime inventory, re-measured on `master` = `d21ec21` (Revision 16).** 23 non-ingestion runtime-target modules in total, and the split is arithmetic rather than an estimate:

- `packages/recommendation-runtime/src/` holds **17** `.js` files. Two are package infrastructure (`core-entry.js`, `index.js`), so **15 have moved**: `candidates/loader.js`, `filtering/context-loader.js`, `filtering/pipeline.js`, `offers/index.js`, `offers/select.js`, `persistence/persist-ranked.js`, `persistence/persist-pass-facts.js`, `persistence/persist-rejections.js`, `persistence/validate-selected.js`, `persistence/validate-rejections.js`, `query/catalog-version.js`, `query/index.js`, `query/load-query-input.js`, `scoring/load-assessments.js`, `scoring/load-scoring-model.js`.
- `src/recommendation/orchestrator/` still holds **8** implementation files — seven modules and the barrel: `run.js`, `snapshot.js`, `full-run.js`, `commit.js`, `swap-preview.js`, `swap-commit.js`, `compute.js` and `index.js`.
- **23 = 15 + 8.** Step 5 moves the remaining eight in W3. The three mixed barrels (`candidates/index.js`, `filtering/index.js`, `scoring/index.js`) are split rather than moved and are not part of the 23. The "24 runtime modules" that this section and §19.1 row 5 used to print had no derivation and is corrected here; the earlier "21" counted a seven-row orchestrator list that omitted `compute.js`.

**Known drift in a moved header.** `packages/recommendation-core/src/explanation/index.js` still ends its header with "the composition seam (`../orchestrator/full-run.js`, item 3)", a path that resolves nowhere from the package. The move is byte-identical, so the line is preserved as written; fixing it would need an `edits[]` record in `extraction-manifest.json`, which is not worth the provenance cost. The seam is real — the orchestrator barrel re-exports through the shim — and the line is a comment, not an import.

### 11.3 The three real reconstruction costs (and the argument that is withdrawn)

**Withdrawn.** The first revision rejected the split partly because "`ranking/*` and `explanation/*` are core and import `assembly` **via the barrel**, which in Option B would include runtime-facing pieces". That is not what the source says: `src/recommendation/assembly/index.js` has **0 DB files**, and its own header states "Never reads from or writes to the database." The barrel is pure. The objection had no basis, and no analogous one remains after §11.2.

**What is actually true, and small:**

1. **Two barrel imports had to be narrowed — done; two are deferred by decision.** `ranking/rank.js:3` and `explanation/build-facts.js:46` import `../assembly` to obtain `EXPANSION_ORDER`; `scoring/build-score.js:80` already imports `../assembly/assemble` directly. Step 4B PR 7 narrowed `explanation/build-facts.js:46` → `../assembly/assemble` and `explanation/reasons.js:107` → `../ranking/select-archetypes` (`STRATEGIES` and `REASON_CODES` are defined there), both before capture so the moves stay byte-identical. `ranking/rank.js:3` and `ranking/select-diverse.js:3` keep `../assembly`: their core tests pin the exact specifier (`test/ranking-rank.test.js:594`, `test/ranking-select-diverse.test.js:377`), and §11.3 named only `rank.js`, so `select-diverse.js` is a recorded gap rather than a third item. The two remaining barrel imports are pure today; they stay reviewed rather than narrowed.
2. **`CONTEXT_COMPAT_KEYS` and the `filtering` pipeline must move together.** They are defined in `context-loader.js`/`pipeline.js`, which are runtime; core's filtering barrel must not export them.
3. **`offers/as-of.js` is reached by direct path.** `orchestrator/run.js` requires `../offers/as-of`; once `as-of` is core and `select` is runtime, that import changes package. It is a one-line change with a test that already covers it.

**Barrel rule that prevents accidental infrastructure imports:** each package's `index.js` re-exports only its own subtree; core's barrels are generated by hand from a fixed export list (no `module.exports = { ...require('./x') }` spread); and core's boundary test fails on `.query(` anywhere in its tree. Together these make "importing core accidentally imports runtime" impossible rather than merely discouraged.

### 11.4 Core public entry points (IMPLEMENTED — step 4B PR 7)

`package.json` `exports` (CommonJS, no build step; implemented in `packages/recommendation-core/package.json` by step 4B PR 7, with `test/index.test.js` asserting the approved key set, each statically resolved target, `exports['.'] === main`, and `./errors` exposing only the two error exports). A repository-level gate, `scripts/lib/core-package-exports.test.js` (part of `npm run test:scripts`), installs the package under a throwaway consumer's `node_modules` outside the repository and asks Node's resolver rather than re-reading the manifest: every approved subpath resolves to its mapped file and to the root's namespace object, `./offers` resolves to `src/offers/as-of.js` (there is deliberately no core `offers/index.js`), and six private or unapproved specifiers — `./package.json` first among them — throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. `./package.json` is not published: the branch exported it briefly and removed it as an unauthorized addition. `main` is retained because path requires — `require('..')`, the Docker image and the hermetic copy — bypass `exports`:

| Subpath | Exports |
|---|---|
| `recommendation-core` (root) | namespaced: `{ compatibility, candidates, filtering, assembly, scoring, retention, ranking, explanation, offers }` |
| `./compatibility` | 11 pair evaluators, `createCompatibilityResult`, `aggregateCompatibilityResults`, `REASON_CODES` |
| `./candidates` | `COMPONENT_ROLES`, `ROLE_ORDER`, role/category helpers, `createCandidateSelectionInput`, `createCandidate`, `selectCandidatePool`, `compareCandidates`, `ERROR_CODES`, `CandidateSelectionError` |
| `./filtering` | `filterCandidates`, `CANDIDATE_STATUSES`, `buildIntegratedGpuPresentMap` |
| `./assembly` | `validateEngine3Input`, `priceKey`, `validatePrices`, `lookupPrice`, `resolveGpuRequirement`, `assembleBuilds`, `EXPANSION_ORDER`, `buildGpuInputs`, `assembleBuildsForRecommendation`, `evaluateBuild`, `evaluateBuildReplacement` |
| `./scoring` | configuration/use-case validators, `listUseCases`, `GPU_POLICIES`, `selectAssessmentRow`, `computeEffectiveScore`, `computeCandidateScore(s)`, `computeBuildScore(s)`, `computeBuildScoreContributions` |
| `./retention` | `retainTopKPerRole`, `computeBudgetFloor`, `computeRoleTargets`, `excludedCpuProductIds`, `resolutionMultiplier` |
| `./ranking` | `rankBuilds`, `selectArchetypes`, `selectDiverseTop`, `PERFORMANCE_FLOOR`, `STRATEGIES`, `REASON_CODES`, `TOP_N_PERSISTED`, `MAX_PER_PAIR` |
| `./explanation` | `explainSelection`, `deriveReasons`, `REASON_CODES`, `REASON_ORDER` |
| `./offers` | `parseAsOf` |
| `./errors` | `CandidateSelectionError`, `ERROR_CODES` (so runtime does not import a deep path) |

**No infrastructure export exists on any of these paths** — that is an assertion the package's boundary test enforces, not a promise.

**API-consumable subset (frozen vocabulary).** Core has **two** in-repo consumers: runtime and the API. The API may import only vocabulary and immutable contracts — `COMPONENT_ROLES`, `EXPANSION_ORDER`, `listUseCases`, `resolutionMultiplier`, `ERROR_CODES`, `CandidateSelectionError`, `GPU_POLICIES`, `STRATEGIES`, `REASON_CODES`/`REASON_ORDER` — as recorded in §9.2 and enforced by an API-side test. It may not import a calculation entry point: a score, a rank, a verdict, an assembled build or a catalog digest is obtained through runtime. This is what keeps runtime from becoming the de-facto owner of domain vocabulary.

### 11.5 Runtime public entry points (PROPOSED)

| Subpath | Exports |
|---|---|
| `recommendation-runtime` (root) | namespaced: `{ loaders, orchestrator, persistence }` |
| `./loaders` | `loadQueryInput`, `catalogVersion`, `loadCandidates`, `selectOfferPrices`, `loadFilteringContext`, `filterCandidatesForRecommendation`, `loadScoringModel`, `loadComponentAssessments` |
| `./orchestrator` | `runRecommendation`, `runRecommendationSnapshot`, `runRecommendationFullRun`, `evaluateSwapPreview`, `evaluateSwapPreviewSnapshot`, `commitSwap`, `commitSwapInTransaction`, `readCommittedSwap` |
| `./persistence` | `persistRanked`, `persistPassFacts`, `persistRejections` (+ the validators for their own callers) |

**Documented contract on every orchestrator entry point:** the `client` argument must be a **single dedicated connection**; `*Snapshot` owns a read transaction ending in `ROLLBACK`; `*InTransaction`/`commit` owns a write transaction ending in `COMMIT`/`ROLLBACK`; `run`/`full-run`/`commitSwap`/`evaluateSwapPreview` own no transaction control. Runtime **never** creates, closes or releases the client.

### 11.6 Testing strategy that proves the core needs no infrastructure

| Layer | Test | What it proves |
|---|---|---|
| Static boundary | core's `test/purity.test.js`, backed by the scanner `test/purity-scanner.js` (**implemented**, step 4B PR 1; this row originally named `test/boundary.test.js`): every `require`/`import` under `src/**` is relative and **resolves** inside the package; no file imports a bare specifier (database, filesystem, HTTP, crypto), carries SQL text, calls `.query(`, reads `process.env`, or reaches a clock or randomness source — `Date.now()`, **any** `Date()` call (including through `.call`/`.apply`/`.bind`), a zero-argument `new Date()`, `Math.random()`, `crypto`. `new Date(value)` is permitted — canonicalising a caller-supplied timestamp is a pure function of its argument | the prohibited constructs are absent, per file, not per directory |
| Hermetic run | `test/hermetic-run.js` copies the package outside the repository, refuses to run when any `node_modules` is reachable from the copy (any depth, directory or symbolic link), empties `NODE_PATH`, and runs `node --test "test/*.test.js"` there; `test/hermetic-run.test.js` exercises that scan against fixtures | core resolves and runs with zero installed packages |
| Fixture-only behaviour | every core suite builds its inputs as literals/fixtures; no `pg`, no `TEST_DATABASE_URL`, no `dotenv` load | the core's behaviour is a function of its arguments |
| Determinism | the existing tie-break assertions, unchanged, now running in core | purity of output is preserved by the move |
| Contract fixtures | core owns frozen input/output fixtures; runtime's translation tests consume the same fixtures | a runtime change that breaks a core contract fails in runtime, not in core |
| Runtime, DB-free | fake client recording `(sql, params)`; the existing style (`orchestrator/run.test.js` calls through namespaces) | SQL and call order are testable without a database |
| Runtime, DB-backed | `test:api:db`-style suite on `TEST_DATABASE_URL` only, residue asserted 0 | the only place a database is required |

**The split is proven, not asserted, when:** core's suite passes with `node_modules` absent, its boundary scan is clean, and runtime's DB-free suite passes with a fake client. Those three are the acceptance criteria for §19 step 4.

**Implemented so far (step 4B PR 1, PR #29, merged 2026-11-15 as `56cbb692`; step 4B PR 2, PR #32, merged 2026-11-16 as `aa7b398`; step 4B PR 3, PR #36, merged 2026-11-18 as `57bca1c`; step 4B PR 4, PR #41, merged 2026-11-19 as `43fd8c8`, batch `step-4b-pr4` on baseline `07dfd22`; step 4B PR 5, PR #44, merged 2026-11-19 as `1a9d8cf`, batch `step-4b-pr5` on baseline `0f439e0`; step 4B PR 6, PR #45, merged as `0f86f53`, batch `step-4b-pr6` on baseline `1a9d8cf`; step 4B PR 7, branch `feat/core-explanation-extraction`, batch `step-4b-pr7` on baseline `2683713`, fixture `packages/recommendation-core/test/fixtures/pr7-characterization.json`):** the boundary gate exists — the loadable entry point `src/index.js`, `test/export-surface.json` pinning its surface, the purity scanner with its regression suites, and the hermetic runner with its fixtures — and `npm run test:core` plus the hermetic step run in `ci.yml`. **The extraction behind the gate is complete for pure logic:** PR 2 moved the pure `candidates` modules, the Engine 1 `compatibility` tree and the pure half of `filtering`; PR 3 moved the pure Engine 3 `assembly` stage (7 modules, byte-identical); PR 4 moved Engine 5a `ranking`; PR 5 moved Engine 2D `retention`; PR 6 moved the pure Engine 4 `scoring` half; and PR 7 moves Engine 6 `explanation` and `offers/as-of` (5 files, byte-identical), so `npm run verify:extraction` reports `blob-identical: 47 / 47` across the six batches and every old path in `src/recommendation/**` for the moved files is an identity re-export shim rather than the implementation. The entry point publishes nine hand-written namespaces, pinned key by key in `test/surface.test.js`: `candidates`, `compatibility`, `filtering`, `assembly`, `ranking`, `retention`, `scoring`, `explanation` and `offers`. **What has moved since (Revision 16, `master` = `d21ec21`):** step 4 closed with PR #49 (`2569647`), and step 5 has moved **15 of the 23** runtime-target modules behind identity shims — the two query loaders and their barrel, the two scoring loaders, the Engine 2 offer query and its barrel, the candidate and filtering-context loaders, the filtering composition, and the five persistence modules — while `packages/recommendation-runtime/src/index.js` publishes the §11.5 `loaders` namespace and no `persistence` or `orchestrator` one. **What has NOT moved:** the 8 `src/recommendation/orchestrator/` files (§11.2) and the three mixed barrels; `apps/api/src/engine.js` still imports the `src/recommendation/**` barrels directly, so the API has not been migrated (step 6). The two `ranking` barrel imports are the only narrowing §11.3 asked for that remains undone (D3, §11.3 item 1).

---

## 11A. Data, measurement and provenance (replaces the first revision's unqualified counts)

### 11A.1 The rule

A count in this document names **environment + date + source + kind** (live measurement, generated snapshot, or recorded observation). It never implies that one environment's number applies to another.

### 11A.2 Offer and catalogue state — environment-qualified

| Statement | Environment | Date | Source | Kind | Limits |
|---|---|---|---|---|---|
| 114 offers for 113 products, **all `SEED_UNVERIFIED`**, 0 with `product_url`/`ingestion_record_id`/seller, two fictional `example.ma` stores | the catalogue as described in the open-points register (seed baseline; shared/EU) | recorded 2026-11-06/07 | `docs/OPEN_POINTS.md` R-01 | **recorded**, environment-specific | This is the **seed** state. It is **not** a universal fact: TEST has since imported verified offers (row below). |
| `store_offer` = 114, `ingestion_record` = 0 | **the generated repository snapshot** | generation time of the committed file (offer timestamps may be older than the file) | `docs/DATA_STATE.md` row counts | **generated snapshot** | `docs/DATA_STATE.md` states every figure is instance-specific and must never be cited as a permanent claim. |
| **2 VERIFIED offers** in the catalog, **1 eligible CPU identity** right now; every other role 0 covered | **TEST** (`db:798b3aa04976`) | measured 2026-11-10 | `docs/OPEN_POINTS.md` R-30 | recorded live measurement | FAIL by the gate's own thresholds; only CPU has a covered identity |
| **0 VERIFIED offers anywhere**; CPU 22/0/0, GPU 24/0/0, other six roles 0/0/0 | **shared** (`db:54ff6ea3f6e6`) and **EU** (`db:2d66f26d7ddc`) | measured 2026-11-10 | `docs/OPEN_POINTS.md` R-30 | recorded live measurement | INCONCLUSIVE is deliberate: a seed-only catalog has no evidence to count |
| 5 VERIFIED offers after the 3-row TEST rehearsal (119 offers, 6 stores) | **TEST** | 2026-11-07 | `docs/OPEN_POINTS.md` R-01 | recorded live measurement | a rehearsal, not a real retailer import; 114 remained seed |

**Consequences for this RFC:**

- No section may say "real data: none" as a property of the platform. It is a property of the **seed/shared/EU** catalogue at a stated date.
- No section may say "0 verified" while describing TEST, and none may say "2 verified" while describing shared/EU.
- This RFC **did not connect to any database** and re-measured none of the figures above. They are `RECORDED`.
- Where evidence is absent — e.g. the current number of VERIFIED offers today, 2026-11-11 — this document says **UNKNOWN** rather than carrying a stale figure forward.

### 11A.3 What the measurements mean for the architecture

1. **Ingestion's acceptance criterion stays R-01** (one real retailer, one verified import, provenance PASS, per-role coverage) — an ownership consequence, not a count.
2. **The API's seed waiver** (`apps/api/src/engine.js`, `API_ENGINE_OPTIONS`) is a **product** decision (B1) whose *interface* consequence is already settled: the default lives in the API, not in runtime or core, and runtime must keep accepting it as a caller option.
3. **No project split is justified by a data count.** The counts explain why ingestion has an owner; they do not decide a package boundary.
---

## 12. Ingestion architecture

### 12.1 What it is today (CURRENT)

| Property | Fact | Evidence |
|---|---|---|
| Location | `src/recommendation/ingestion/` (8 non-test modules, 1 113 lines, 5 test files) | directory listing, §6.1 |
| Classification | **not an engine stage** — its own header says so | `ingestion/index.js:1-13` |
| Dependency direction | inbound: **zero** (measured, §6.3); outbound: none to other stages | Tarjan scan |
| Third-party deps | none (`crypto` + Node builtins only) | `require` scan |
| Network | **none by design** — the seam is a file | `docs/ingestion/PIPELINE_DESIGN.md` |
| DB writes | only `apply.js`, inside a caller-owned transaction | `apply.js`, `run.js` headers |
| CLI | `scripts/ingest-offers.js` (dry-run default, `--commit`, `--test-db`, `--target-env`, `--restore-point`) | script header |
| Guards | refuses `--target-env` naming `DATABASE_URL`/`TEST_DATABASE_URL`; compares targets by `db:<12 hex>` digest; requires a restore point for a write; prints `AUDIT TARGET:` before connecting | `scripts/lib/ingest-args.js` |
| Identity | Tier 0 `CATALOGUE_KEY` (operator `product_slug` + `variant_sku`) wins over SKU/MPN/name tiers; curated rejection codes; nothing force-matched | `docs/OPEN_POINTS.md` R-01 (2026-11-07 route decision) |
| Gates | `check-offer-provenance.js`, `check-offer-freshness.js`, `check-offer-coverage.js` | `scripts/` inventory; §8.3 |

Offer counts are **not** restated here. They are environment- and date-qualified in §11A.2, and this RFC re-measured none of them.

### 12.2 Why it is an application, not part of the core (PROPOSED)

1. **Different responsibility**: it turns operator-supplied text into Layer 3 rows. It performs no compatibility, scoring, ranking or assembly.
2. **Different impurity**: it writes. Keeping it beside pure code means a purity claim always needs an asterisk.
3. **Different cadence**: it changes when a retailer's export format changes, not when the scoring model changes.
4. **Different gates**: provenance/freshness/coverage are data-quality gates (§8.3), not domain tests.
5. **No domain dependency exists**: zero inbound edges, and its outbound edges reach no stage (§6.3). Nothing in the source demonstrates a need for core.

### 12.3 Target shape (PROPOSED)

```
apps/offer-ingestion/
├── README.md                  ← operator onboarding, adapter contract, safety rules
├── package.json               ← own manifest; depends on database-guard only
├── src/
│   ├── adapters/              ← manual; retailer adapters later
│   ├── listings.js            ← parse + validate
│   ├── matching.js            ← identity tiers
│   ├── promotion.js           ← class promotion rules
│   ├── plan.js                ← dry-run plan (reads)
│   ├── apply.js               ← writes, caller-owned transaction
│   └── run.js                 ← orchestration
├── bin/ingest-offers.js       ← the CLI (today scripts/ingest-offers.js)
├── gates/                     ← provenance, freshness, coverage (today scripts/check-offer-*.js)
└── test/                      ← the existing unit + CLI suites
```

**Hard rule:** `apps/offer-ingestion/**` may not require `recommendation-core`, `recommendation-runtime`, or any path under them. Enforced by its own boundary test, in the shape of `apps/api/test/unit/import-boundary.test.js`.

### 12.4 What it needs from the database, and what it must never do

| Needs | Must never |
|---|---|
| read Layer 1 identities (`product.slug`, `product_variant.sku`) | import core/runtime, or re-implement scoring/ranking |
| read/write Layer 3 (`store`, `store_offer`, `price_history`, `ingestion_record`) | write Layer 4 tables |
| `database-guard` (target digest, restore-point rule) | commit outside a caller-owned transaction |
| the provenance definitions (what makes an offer `VERIFIED`) | invent a match, a price, a provenance class or a timestamp |

### 12.5 The open problem this project owns (CURRENT → PROPOSED)

**CURRENT → RECORDED.** R-01 is the platform's most consequential open point: the seed catalogue carries no retailer provenance, and the 2026-11-06 pilot established that the binding constraint is **identity**, not collection (3 of 4 confident rows returned `UNMATCHED NAME_CONTAINS`). R-30 recorded per-role evidenced coverage as zero outside CPU on shared and EU, and 1 eligible CPU identity on TEST (§11A.2).

**PROPOSED.** Once ingestion is a project with an owner, R-01 becomes its *defining* acceptance criterion (one real retailer, one verified import, provenance PASS, coverage per role) rather than a row in a cross-project register. This RFC does not attempt the import.

---

## 13. API architecture

### 13.1 What exists (CURRENT)

| Aspect | Fact |
|---|---|
| Manifest | **none** — dependencies resolve from the root `package.json` |
| Entry | `apps/api/src/server.js` → `app.js` (Fastify construction) |
| Routes (11 registrations) | `GET /v1/health`, `GET /v1/meta/options`, `GET /v1/presets`, `GET /v1/catalog/products`, `GET /v1/catalog/products/:slug`, `GET /v1/catalog/products/:slug/price-history`, `GET /v1/docs/json`, `POST /v1/recommendations`, `GET /v1/recommendations/:id`, `GET /v1/recommendations/:id/builds/:rank/swap-preview`, `POST /v1/recommendations/:id/builds/:rank/swap` |
| Contract | v1.10.0, `contract/openapi-1.10.0.json` (published there 2026-11-12; it was `apps/api/test/unit/openapi-v1.10.json` before), served at `/v1/docs/json`, byte-compared by `openapi-snapshot.test.js` and compatibility-gated by `scripts/check-openapi-compatibility.js` |
| Engine reach | `engine.js` only, six barrels, one frozen option (`allow_unverified_seed_offers: true`) |
| SQL | `repository.js` (API-owned SQL) + `db.js` (the only `pg` importer; pool tagged `application_name = 'morocco-pc-api'`) |
| Guards | refuses to start unless the target is provably the TEST branch or `API_ALLOW_SHARED=1`; imports `packages/database-guard/src` (line 26) — since PR #27; before that it imported `scripts/lib/db-url.js` |
| Deploy | `apps/api/Dockerfile` (context = repo root), `render.yaml`, `fly.toml` |

### 13.2 Why it cannot be independent today (CURRENT → consequence)

| Blocker | Evidence | Effect |
|---|---|---|
| no manifest | `apps/api/` contains no `package.json` | no own dependency set, no own `npm ci`, no version |
| root build context | `apps/api/Dockerfile` copies `src/`, `apps/api` and `packages/database-guard/{package.json,src}` | the image is a slice of the repository, not a build of the API |
| relative engine path | `engine.js:28-33` requires `../../../src/recommendation/*` | the API's source layout encodes the engine's location |
| guard path | `db.js:26` requires `../../../packages/database-guard/src` | the guard is still reached by a relative path across project boundaries: there is no `file:` dependency and no install until step 6, so the API cannot build outside this repository layout |
| ~~contract inside a test directory~~ **CLOSED 2026-11-12** | `contract/openapi-1.10.0.json` — the publication point is a top-level `contract/` directory, and `check:contract` fails if a second `openapi-*.json` appears | the test tree no longer publishes another application's contract (per §15.4 O2 / A4) |

### 13.3 Target shape (PROPOSED)

```jsonc
// apps/api/package.json (new)
{
  "name": "morocco-pc-api",
  "private": true,
  "dependencies": {
    "fastify": "…", "@fastify/cors": "…", "@fastify/rate-limit": "…",
    "@fastify/swagger": "…", "@sinclair/typebox": "…", "@sentry/node": "…",
    "pg": "…",
    "recommendation-core":    "file:../../packages/recommendation-core",
    "recommendation-runtime": "file:../../packages/recommendation-runtime",
    "database-guard":         "file:../../packages/database-guard"
  }
}
```

`apps/api/src/engine.js` becomes the API's boundary to **both** packages: orchestration and loaders from runtime, frozen vocabulary and immutable contracts from core. Its core imports are limited to the approved list in §9.2/§11.4 and enforced by an API-side boundary test; every calculation and every compiled response still arrives through runtime. The pool stays in `db.js` (pool ownership does not move, §6.2).

**Acceptance for "independent" (restated, because the first revision's command was unbuildable):** `cd apps/api && npm ci && npm test` succeeds with no root `node_modules`, **and** `docker build -f apps/api/Dockerfile .` (repository-root context) produces an image that starts and answers `/v1/health`. The first revision wrote `docker build -f apps/api/Dockerfile apps/api`, which cannot work once `file:` dependencies point at `packages/` (§13.4).

### 13.4 Docker build design (PROPOSED — concrete, not a warning)

**Intended build context: the repository root.** This is already what `render.yaml` (`dockerContext: .`) and the Dockerfile header use; the defect is only that the first revision's documented command contradicted it.

**Repository-root `.dockerignore`** (new), which is what keeps the image from becoming "a slice of the repo":

```
.git
.github
node_modules
apps/web
apps/web-v2
test
docs
database/migrations
database/seeds
*.patch
```

`packages/*/test` and `apps/api/test` are also excluded; the migration/seed directories are excluded because the image does not apply them.

**Dockerfile shape:**

```dockerfile
# syntax: context = repository root
FROM node:22-alpine AS deps
WORKDIR /app
# Manifests only, so the install layer invalidates on dependency change.
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/
COPY packages/recommendation-core/package.json    ./packages/recommendation-core/
COPY packages/recommendation-runtime/package.json ./packages/recommendation-runtime/
COPY packages/database-guard/package.json         ./packages/database-guard/
# Resolves the three file: deps because their directories exist at ../../packages/*.
RUN cd apps/api && npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api/package.json     ./apps/api/package.json
COPY apps/api/src              ./apps/api/src
COPY packages/recommendation-core/package.json    ./packages/recommendation-core/package.json
COPY packages/recommendation-core/src             ./packages/recommendation-core/src
COPY packages/recommendation-runtime/package.json ./packages/recommendation-runtime/package.json
COPY packages/recommendation-runtime/src          ./packages/recommendation-runtime/src
COPY packages/database-guard/package.json         ./packages/database-guard/package.json
COPY packages/database-guard/src                  ./packages/database-guard/src
USER node
EXPOSE 3000
CMD ["node", "apps/api/src/server.js"]
```

| Requirement | How the design satisfies it |
|---|---|
| Exact context | repository root (`.`), always |
| Which files are copied | four manifests + lockfile in `deps`; four `src/` trees + four manifests in the final stage; nothing else |
| Local dependencies | `npm ci` resolves `file:../../packages/*` because those directories exist at `/app/packages/*`; npm links them into `apps/api/node_modules` |
| Lockfiles | `apps/api/package-lock.json` is regenerated in the same PR that adds the manifest and must record the three `file:` dependencies; the root lockfile is no longer part of the image |
| Avoiding repo content | `.dockerignore` excludes frontends, docs, tests, migrations/seeds, `.git`, `.github`, patches; the final stage copies only the paths listed |
| Why the old justification disappears | the image no longer needs the root `node_modules` for the engine's `require('pg')`, because runtime has no `pg` dependency and `pg` is installed into `apps/api/node_modules` |
| Pitfall to verify during implementation | npm may create **relative** symlinks for `file:` deps; the final stage must place `packages/` at the same relative path (`/app/packages/…`), which it does. Verify with `node -e "require.resolve('recommendation-runtime')"` inside the image. |

**Not implemented by this RFC.** No Dockerfile, `.dockerignore`, manifest or lockfile is changed by this document.

**Owner decision 1 (2026-11-11): step 3a may make path-only updates to `apps/api/Dockerfile`, `.dockerignore`, `fly.toml` and `render.yaml`.** Moving the guard changes the path the image copies, so the existing files must name `packages/database-guard/src/` instead of `scripts/lib/db-url.js`. That approval is **filesystem-path correction only**: no Docker architecture change, no hosting or infrastructure change, no new deployment configuration, no environment-variable change, and **no deployment**. The four-file `file:` build above remains the step-6 design. **Executed by PR #27 (`7691b4f`):** those four files were updated by path only, and the PR recorded that install, environment and deployment behaviour were unchanged. That PR did **not** build the image, and no workflow in the repository runs `docker build` (`.github/workflows/` has only `ci.yml` and `web.yml`), so the image-build proof remains step 9 work (§19.1), not a completed check.

---

## 14. Web V1 and V2 architecture

### 14.1 Feature inventory (CURRENT)

**V1 (`apps/web`, `master`)** — homepage, `configurer` (wizard), `config/[id]` (results + share), `composants` list, `composants/[slug]`, `composants/comparer`, `guides` + `guides/[slug]`, `enregistrements` (saved builds), `[presetSlug]`, `format`/`kit`/`tokens` proof sheets, legal pages, catch-all 404, plus `api/analytics/config/route.ts`.

**V2 (`apps/web-v2`, `feature/v2-design`)** — 3 route files: `app/[locale]/layout.tsx`, `app/[locale]/page.tsx` (7-section homepage), `app/[locale]/configurateur/page.tsx`. README states the screens perform **only GETs**.

### 14.2 Parity matrix (CURRENT)

| Capability | V1 | V2 | Gap / note |
|---|---|---|---|
| Homepage with finder | yes | yes (7 sections) | V2 rebuilt from design references, shares no code |
| Wizard / configurator | yes (multi-step, URL-driven) | partial: 2 questions, summary panel, generates nothing | V2 has no submit |
| Recommendation POST | yes | **no** | V2 performs only GETs |
| Results page | yes (`config/[id]`) | no | V2 opens an existing pass only via `?from=<uuid>` |
| Build swap (preview + commit) | yes | no | contract v1.8/v1.10 unused by V2 |
| Catalogue list + product page | yes | no | |
| Price history | yes | no | |
| Compare view | yes | no | |
| Saved builds | yes (localStorage) | no | |
| Guides (MDX, fr + ar) | yes | no (guide data exists) | V2 has no guides route |
| Preset landing pages | yes | no (consumes `GET /v1/presets` for cards) | |
| Legal pages | yes | no | |
| Locales | fr + ar, RTL | fr + ar, RTL | V2 owns its dictionaries + parity test |
| Design system | own tokens + kit | own tokens + kit + `docs/DESIGN_SYSTEM.md` | two systems, deliberately unshared |
| SEO / crawl surface | sitemap, robots, canonical + hreflang, per-preset OG | **none** | |
| Analytics | yes | no | |
| Accessibility tests | axe suite | contrast unit tests + a11y e2e | each tests what it has |
| Deployment config | `wrangler.jsonc` + `open-next.config.ts` (undeployed) | **none** | B6 |
| Type generation | from the snapshot, own generator | from **its own copy** of the snapshot, own generator | §15.2 |

### 14.3 API operations each frontend consumes (CURRENT)

| Operation | V1 | V2 |
|---|---|---|
| `GET /v1/meta/options` | yes | yes |
| `GET /v1/presets` | yes | yes |
| `POST /v1/recommendations` | yes | no |
| `GET /v1/recommendations/{id}` | yes | yes (`?from=`) |
| `GET /v1/catalog/products` | yes | no |
| `GET /v1/catalog/products/{slug}` | yes | no |
| `GET /v1/catalog/products/{slug}/price-history` | yes | no |
| `GET …/swap-preview` | yes | no |
| `POST …/swap` | yes | no |
| `GET /v1/health` | yes (client) | yes (client tests) |

### 14.4 V2 staging evidence — corrected

The first revision said "V2 has never called a deployed API". That is wrong, and the correction has to be precise in both directions: it did call a deployed API, and it was **not** a deployed V2 frontend and **not** an automated E2E test.

**Source:** `apps/web-v2/docs/staging-smoke.md` on `feature/v2-design` (branch head `3bc0605`; the record names the branch at `ef4f624` and the inlining fix `04e6f77`), dated **2026-11-07**. `git cat-file -e origin/master:apps/web-v2/docs/staging-smoke.md` → does not exist on `master`.

| # | Fact | Evidence in that record |
|---|---|---|
| 1 | **No deployed V2 frontend is demonstrated by this evidence.** | The frontend ran at `http://localhost:3220` from a dev server reading `.env.local`; V2 has no deploy descriptor. |
| 2 | **Automated E2E tests still use mocked API responses.** | §7 of the record: `npm run test:e2e` — "22 passed (mocked; proves the mocked suite only)"; §8: "The mocked Playwright suite is not evidence about the API: it stubs `/v1/**`." |
| 3 | **A manual local-browser-to-real-EU-staging-API read-only smoke was documented.** | Ordinary Chromium, no proxy/interception/stub: 7 reads per locale (`fr`, `ar`), all HTTP 200; endpoints `GET /v1/meta/options`, 3 × `GET /v1/presets`, 3 × `GET /v1/recommendations/{id}`; 0 POST; CORS exact-origin with foreign-origin and no-origin controls; console clean; RTL with `dir=rtl` and zero overflow. |
| 4 | **The database identity claim was owner-attested and not independently verified.** | §1: "Owner attestation, not independently verified"; `GET /v1/health` exposes no database identity, and the corroborating signal is `engine_version` (`d2de4fb`, not `dev`). |

**Limits of the evidence (stated in the record itself):** the 429/rate-limit path was not exercised; the results page, the finder's write path and the shared demo were not covered; the API target's database identity is not observable over HTTP.

**What may therefore be claimed:** on 2026-11-07, a local V2 **development** frontend in an ordinary browser read the EU staging API in both locales, read-only, with no relay. **What may not be claimed:** that V2 is deployed, that its E2E suite validates the API, that the serving database is independently proven, or that this is production validation.

### 14.5 Transition constraints (CURRENT)

1. **Diverged history.** `origin/master` and `origin/feature/v2-design` share a merge-base; V2's branch carries its own copies of `src/`, `database/`, `docs/`, `apps/api`, `apps/web` and the workflows.
2. **The V2 tree duplicates platform files.** Landing V2 must not import that copy back into master.
3. **No V2 deployment path exists.**
4. **Contract adjacency.** Both workflows trigger on their own copy of the contract snapshot, so a change to one copy does not run the other gate — a divergence risk, not a strength (§15.2).
5. **Node/Next floors differ** (V1: `>=22`, next 16.4.2; V2: `^22.22.2 || ^24.15.0 || >=26`, next 16.4.5).
6. **V2 README self-describes as pending native review** of the Arabic copy; that is a status, not a completed check.

### 14.6 Recommended transition (PROPOSED)

- **V2 becomes the single future frontend** (product decision B2).
- V1 is **frozen**: bug fixes only until parity.
- Parity is tracked as a table in V2's docs (this §14.2 is the starting point), with an explicit "must retain" subset decided by the owner (B3).
- V2 lands on `master` as an application-only merge (its platform copy is discarded), **in parallel with the API packaging work** (both depend on the contract path, not on each other — §19.1), then gains a deploy descriptor before any cutover.
- V1 is retired route by route once each retained capability is green on V2 *and* deployed.

### 14.7 What "retire V1" must not lose (CURRENT → for B3)

Saved builds (local-only), compare view, price history, preset landing pages, legal pages, guide content in both locales, analytics events, structured data (JSON-LD verified-price rules), the crawl surface (sitemap/robots/hreflang/OG cards), and the axe/Lighthouse budgets. Each is a concrete capability with tests in V1 today.

---

## 15. API contract and versioning

### 15.1 Current mechanism (CURRENT)

| Property | Fact |
|---|---|
| Authoritative document | generated by the API at run time (`/v1/docs/json`) from TypeBox schemas |
| Committed snapshot | `contract/openapi-1.10.0.json` |
| Pinning | `openapi-snapshot.test.js` byte-compares the served document and asserts `info.version = 1.10.0`, plus per-minor schema facts |
| Coverage | `openapi-coverage.test.js` asserts every registered route is documented |
| Consumers | V1 `gen:api-types`/`check:api-types`; V2 `gen:api-types`/`check:api-types`; both CI workflows filter on the snapshot's path |
| Compatibility discipline | every minor so far has been additive |
| Breaking-change detection | `npm run check:contract` (one versioned contract, no second copy) and `node scripts/check-openapi-compatibility.js --base=origin/master` (direction-aware compatibility diff, wired into `ci.yml` since 2026-11-12) |

### 15.2 The problem, including the cross-branch duplication

1. ~~The authoritative document is stored in a **test directory of the API application**, and its location is hard-coded in four places outside that application (two `package.json` scripts, two workflow path filters) plus a stale pair of V1 references that still name `openapi-v1.6.json` (§23.4).~~ **CLOSED 2026-11-12:** the document is `contract/openapi-1.10.0.json`, both frontend generators and the gates read that one path, the stale V1 references are corrected, and `check:contract` fails when a second `openapi-*.json` exists in the tree.
2. **Each branch carries its own copy.** `apps/web-v2/package.json` and `check:api-types` read the copy present on `feature/v2-design`; V1 reads the copy on `master`. **The two files are identical today**, and that is precisely the risk: identity today does not create a mechanism that keeps them identical. Neither frontend's gate would detect divergence, because each compares generated types against *its own* copy. Duplicated platform copies decay silently; the only durable fix is one address that both consume (§15.4).
3. A prior attempt to give it a top-level home (`contract/openapi.json`, PR #22, `90dc99b`) was removed from `master` on 2026-11-10 by a force-push back to `a413f25`; the commits survive at `backup/master-before-contract-revert`. This RFC treats that as evidence the question was raised, not as a decision.

### 15.3 Options

| Option | What it means | Advantages | Disadvantages |
|---|---|---|---|
| **O1 — keep it in place** | leave the snapshot under `apps/api/test/unit/` | zero change | two applications depend on a test path; nothing prevents per-branch copies |
| **O2 — versioned contract directory** | `contract/openapi-1.10.0.json`, owned by the API; both frontends read that one path from `master` | explicit ownership; version in the filename; one address | needs discipline while V2 is on its own branch (it must generate from the merged path after landing) |
| **O3 — published artifact** | CI publishes the document per API release | a frontend can pin a released contract | needs a release process that does not exist |
| **O4 — internal contract package** | `packages/api-contract` with JSON + generated types | one import | both frontends already generate types; adds a build step for a JSON file |
| **O5 — runtime-only contract** | generate from `/v1/docs/json` | no committed file | breaks offline builds; rejected |

### 15.4 Recommendation (PROPOSED)

1. **O2 now**: one authoritative document at `contract/openapi-<major>.<minor>.<patch>.json`, owned by the API project, byte-compared by `openapi-snapshot.test.js` (same assertion, new path). **No second copy anywhere** — both frontends' generators point at it, and `check:api-types` stays each frontend's gate.
2. **A cross-copy drift gate while V2 is branch-based**: a check that fails when a second `openapi-*.json` exists in the tree. This is the mechanism the current arrangement lacks.
3. **O3 later**: attach the file to the API release so a frontend can pin without a checkout.
4. **A compatibility gate with a Git-ref baseline** (owner decision 4, 2026-11-11): `node scripts/check-openapi-compatibility.js --base=origin/master` retrieves the baseline contract **from the explicitly supplied Git ref**, compares it with the candidate, classifies every change ADDITIVE / BREAKING and fails on an unauthorized breaking change. There is **no second, hand-maintained baseline file**, and committed-versus-served is **not** a substitute: the snapshot test keeps that separate responsibility. An approved breaking change needs a documented review and approval note; the gate does not infer one.
5. **Reject O4**: generated types belong to each frontend.

6. **Step 3b scope = API + V1 + the shared contract location.** **V2 integration is deferred to Step 7** (owner decision 3, 2026-11-11): `apps/web-v2` stays on `feature/v2-design`, no V2 history is modified or merged in step 3b, and V2's type generation, contract wiring and compatibility verification happen in its dedicated roadmap step. This is a deliberate deferral, not abandonment.

**Hard rule:** never a hand-maintained second copy of a request or response shape.

### 15.5 Versioning policy to write down (PROPOSED)

| Change | Version | Gate |
|---|---|---|
| new optional field, new route, new enum member | minor | snapshot test + compatibility diff |
| field removed, type narrowed, route removed, status code changed | major | must fail the compatibility gate until bumped and documented |
| description / example only | patch | snapshot test |
| engine behaviour change with no contract change | none | `engine_version` / `scoring_model_id` on the pass record |

**The served model is not the contract.** `SCORING_MODEL_PIN` can change what a pass returns without changing the contract; the durable record is `recommendation_query.scoring_model_id`. That separation must survive any project split.

---

## 16. Documentation ownership

### 16.1 Inventory at the measurement baseline (CURRENT at `a413f25`, top-level)

This is the pre-cleanup inventory Revisions 1-3 measured. PR #24 executed the §16.5 disposition; §16.7 records where each document lives on `master` now.

| Document | Nature | Owner today |
|---|---|---|
| `README.md` | system overview + quick start | nobody in particular |
| `AGENTS.md` | agent entry point: every layer, command and gotcha | root |
| `CONTEXT.md` | current state | root |
| `DEVELOPMENT_NOTES.md` | operational lessons / dated measurements | root |
| `docs/ARCHITECTURE.md` | engine contract | engine (→ core + runtime) |
| `docs/API.md` | HTTP contract history + notes | API |
| `docs/PIPELINE_DESIGN.md` | ingestion design | ingestion |
| `docs/ROADMAP.md`, `docs/OPEN_POINTS.md`, `docs/OPEN_GAPS.md` | programme + registers | root |
| `docs/RECOMMENDATION_ENGINE_DECISIONS.md` | decision log (append-only) | engine |
| `docs/DECISION_INDEX.md`, `SCHEMA_REFERENCE.md`, `DATA_STATE.md` | GENERATED | generators |
| `docs/GLOSSARY.md`, `TEST_MAP.md`, `docs/RECIPES/`, `docs/archive/` | lookup + recipes + history | mixed |
| `apps/web/README.md`, `apps/web-v2/README.md` + their `docs/` | frontend onboarding | V1 / V2 |

### 16.2 Diagnosed problems (CURRENT at `a413f25`)

| Problem | Evidence |
|---|---|
| **The root describes every implementation.** `AGENTS.md` carries engine gotchas, migration rules, API notes and web sprint figures side by side. | file contents |
| **Project docs live outside the projects.** The engine contract, the API contract and ingestion's design are three root files. | paths |
| **Stale cross-references exist.** ~~V1's `README.md` and `lib/api/client.ts` name `openapi-v1.6.json`, which does not exist.~~ **CLOSED 2026-11-12:** both name `contract/openapi-1.10.0.json`, the file both generators read. | §23.4 |
| **Generated and authored docs interleave** with no marker in the index saying which must never be hand-edited. | `docs/` listing |
| **No per-project operations doc.** Deployment knowledge is spread across a recipe, `render.yaml`, `fly.toml`, the Dockerfile and `CONTEXT.md`. | files |
| **The archive is well-managed** — every superseded file carries `Superseded by:`. This is the pattern to keep. | `docs/archive/` |

### 16.3 Proposed documentation architecture

**PROPOSED.** Root = *system and navigation*. Project = *its own implementation truth*.

```
README.md / AGENTS.md (index only) / CONTEXT.md
docs/
├── SYSTEM_ARCHITECTURE.md     this document's durable successor
├── OPEN_POINTS.md  ROADMAP.md  GLOSSARY.md  TEST_MAP.md      [stay root]
├── SCHEMA_REFERENCE.md  DATA_STATE.md  DECISION_INDEX.md     [generated]
├── decisions/  archive/  architecture/                       [stay]
├── api/  database/  ingestion/                               [moved from root docs]
└── engine/                    ARCHITECTURE.md + engine recipes

packages/recommendation-core/README.md      + docs/{ARCHITECTURE,MODULES,TESTING}.md
packages/recommendation-runtime/README.md   + docs/{LOADERS,TRANSACTIONS,TESTING}.md
packages/database-guard/README.md
apps/api/README.md                          + docs/{CONTRACT,OPERATIONS,TESTING}.md
apps/offer-ingestion/README.md              + docs/{ADAPTERS,IDENTITY,OPERATIONS}.md
database/README.md                          + docs/{LIFECYCLE,ROLES,RESTORE}.md
```

### 16.4 Required content per project

Every project's docs must answer: what it is, who consumes it, how to install/run it, its boundary (what it may not import), its module map and public interface, which suites need a database, the exact environment variables and guard rules, operations (build/deploy/rollback/health), security (credentials held, what must never be logged), release/versioning, owned decisions, and known limitations (linked into the register, not restated).

### 16.5 Disposition of existing documents (PROPOSED at `a413f25`; executed by PR #24, §16.7)

| Document | Disposition |
|---|---|
| `docs/ARCHITECTURE.md` | **split**: pure contract → `docs/engine/ARCHITECTURE.md`; loader/transaction contract → `packages/recommendation-runtime/docs/` |
| `docs/API.md` | **move** to `docs/api/CONTRACT.md` |
| `docs/PIPELINE_DESIGN.md` | **move** to `docs/ingestion/PIPELINE_DESIGN.md` |
| `docs/RECIPES/*` | **split** by owning project; deploy/first-launch stay root |
| `AGENTS.md` | **rewrite to an index**; per-layer gotchas move to the owning project's `AGENTS.md` |
| `DEVELOPMENT_NOTES.md` | **keep, split by owner later**; it is dated evidence |
| `CONTEXT.md`, `README.md` | **keep at root**, corrected by measurement |
| `OPEN_POINTS.md`, `OPEN_GAPS.md`, `GLOSSARY.md`, `TEST_MAP.md` | **keep at root** |
| generated mirrors | **keep generated** |
| `docs/archive/**` | **keep untouched** |
| dated handoffs | **archive** with a `Superseded by:` header |
| `pr8-fix-saved-spec.patch` | **delete or archive** |

### 16.6 Constraint on any documentation-cleanup PR

**PROPOSED:** it may move, split and re-link, but it may not change a test count, a decision count, a migration range or a measured figure without re-running the measurement.

### 16.7 Execution record: Roadmap Step 2 (2026-11-11)

**CURRENT on `master`.** PR #24 (`docs/documentation-cleanup`, merged `ffd336c`) executed the §16.5 disposition; PR #25 (`fix/stale-recipe-paths`, merged `e62c816`) then corrected the script comments and generated-index citations that still named moved documents.

| §16.5 disposition item | Result on `master` |
|---|---|
| `docs/ARCHITECTURE.md` | **split**: design contract → `docs/engine/ARCHITECTURE.md`; loader/snapshot/transaction contract → `packages/recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md` |
| `docs/API.md` | **moved** to `docs/api/CONTRACT.md` |
| `docs/PIPELINE_DESIGN.md` | **moved** to `docs/ingestion/PIPELINE_DESIGN.md` |
| `docs/RECIPES/*` | **split** under `docs/database/recipes/`, `docs/engine/recipes/` and `docs/ingestion/recipes/`; deploy, first-launch, release and status-claim recipes stay in `docs/RECIPES/` |
| `AGENTS.md` | **rewritten as an index**; per-layer `AGENTS.md` added for `apps/api/`, `apps/web/`, `database/`, `docs/engine/` and `docs/ingestion/` |
| dated handoffs | **archived** under `docs/archive/` with `Superseded by:` headers |
| `pr8-fix-saved-spec.patch` | **archived**, not deleted (`docs/archive/`) |
| `DEVELOPMENT_NOTES.md`, `CONTEXT.md`, `README.md`, registers, generated mirrors, `docs/archive/**` | kept at their previous owners |

Step 2 changed no recommendation behaviour, schema, contract, migration or deployment: it changed 31 files (documentation, recipes, per-layer agent instructions and one documentation-gate path). **At the date of Step 2**, `packages/` existed only because it held `recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md`; it had **no manifest and no code**, and the extraction remained step 3a. That changed on 2026-11-11: PR #27 added `packages/database-guard/` and the two recommendation manifests (§9.4), while **no recommendation module had moved at that date** — five namespaces have moved on `master` since (a sixth, `retention`, moves on branch `feat/core-retention-extraction`), none of them Step 2's doing (§23.1).

---

## 17. Monorepo versus multiple repositories

### 17.1 The three options

| | **Option 1 — modular monorepo** | **Option 2 — multiple repositories** | **Option 3 — hybrid** |
|---|---|---|---|
| Means | one repository, six ownership areas, per-project manifests, one CI entry with per-project jobs | one repository per project with published artifacts | platform in one repo + separate frontend repos |

### 17.2 Comparison on the axes that matter here

| Axis | Monorepo | Multi-repo | Hybrid | Evidence from this tree |
|---|---|---|---|---|
| Independent project ownership | good — per-project dirs (+ later `CODEOWNERS`) | best | good for frontends | one owner today; no `CODEOWNERS` file |
| Package versioning | per-project manifests, one lockfile each | semver per repo + registry | mixed | no engine version; no API manifest; frontends already independent |
| Dependency management | duplication only where needed | fully independent | frontends independent already | root manifest serves engine + API + scripts |
| CI execution | one workflow per project (`ci.yml`, `web.yml`, `web-v2.yml`) | independent pipelines | same | already the pattern |
| **Contract evolution** | one PR changes contract + API + both frontends' types | 3-repo dance per minor | 2-repo dance | v1.1→v1.10 consumed by V1 and V2 |
| **Coordinated schema change** | one PR: migration + loader + writer + contract + tests | version-skew window is real | same as multi-repo | Decision 46 spans migration + writer + presenter + two contract minors |
| Cross-project PRs | normal | rare and expensive | rare for the core | 23 migrations, 63 decisions, 30 open points |
| Security / permissions | coarse | per-repo | coarse for platform | only API + DB tooling hold secrets |
| Release management | git history + tags | registry + tags | mixed | `ENGINE_VERSION` is a git SHA |

### 17.3 Analysis

The coupling here is **not** code churn; it is **evidence churn**. Every material change crosses two or more candidate projects: a migration with its loader and writer, a scoring-model version with its goldens and its pin, a contract minor with two frontends' generated types, a seed with its data gate. A multi-repository split would require a coordinated release for each, with only a version number as the shared artifact.

Option B sharpens this: core and runtime will change **together** far more often than apart (a loader change usually mirrors a contract change), which is an argument for keeping them in one review, in one repository, each with its own manifest.

### 17.4 Recommendation

**PROPOSED — Option 1 (modular monorepo).** Concretely:

1. **One repository**, six ownership areas and seven installable units (core, runtime, database-guard, ingestion, API, V1, V2 — the database area stays package-less), each with its own manifest, docs, tests and CI job.
2. **Extraction to separate repositories is DEFERRED** behind all three triggers: the contract published as a versioned artifact (O3); a tagged schema release; at least two people owning different projects.
3. **The frontends are the first candidates** if a split happens.
4. **The database never leaves**: it is the schema authority for every other project.

### 17.5 npm workspaces: evaluated and NOT adopted now

**CURRENT.** There is no `workspaces` key in `package.json`.

| Question | Answer |
|---|---|
| Would workspaces fix the API's missing manifest? | **No.** They hoist convenience; they do not give a project an independent dependency set. |
| Would they help core/runtime? | **No.** Core has **zero third-party** runtime dependencies; runtime's only dependency is `recommendation-core`, a local `file:` package. Neither needs a workspace, and a workspace would not change how a `file:` dependency resolves. |
| Would they help the frontends? | **No, and it would hurt.** V1 pins next 16.4.2 and V2 16.4.5; one hoisted `node_modules` would have to resolve one version, and their Node floors differ. |
| Cost to adopt later | Low once every project has a manifest: add `workspaces` + a root lockfile. |

**DEFERRED with a trigger:** adopt when two or more projects need the *same* third-party dependency at the *same* version **and** the duplication cost is measured.

### 17.6 Risks of the monorepo choice

| Risk | Mitigation |
|---|---|
| Boundaries rot | one DB-free boundary test per project, in the PR that creates the project |
| One CI file becomes a bottleneck | one job group per project |
| Repository size | the archive is the growth vector, already marked historical |
| A project cannot be released independently | per-project manifests + contract artifact before any release cadence is promised |

---

## 18. Security and operational concerns

| Concern | CURRENT (verified) | PROPOSED | Label |
|---|---|---|---|
| **Database ownership** | one PostgreSQL database, four logical layers, 3 environments (shared, TEST branch, EU) | unchanged; database project owns schema lifetime | PROPOSED |
| **Identity / authentication** | **none anywhere**: no signup, session, API key or cookie; R-16 ACCEPTED by design | decide scope before any gated beta (B5); no auth designed here | DECISION REQUIRED |
| **Authorization** | none (nothing to authorise) | follows authentication; per-user saved builds would be the first gated resource | DEFERRED |
| **DB privileges** | `morocco_pc_api` role with column-scoped grants; the EU host measurably uses it (`check-deployed-role` PASS); the retired demo ran as `neondb_owner` (FAIL) | keep least privilege as a release gate on every environment | CURRENT |
| **Secrets** | `.env` (never committed), GitHub repository secrets, Render `sync: false` variables, `~/.morocco-pc/*.password` | unchanged; no secret in a project file, log or chat | CURRENT |
| **Write safety** | shared writes need a restore point and leave an audit line; write tests are TEST-only; the API refuses shared unless `API_ALLOW_SHARED=1` | preserve verbatim through §19 (§19.2) | CURRENT |
| **API protection** | per-IP rate limits, `TRUST_PROXY` pinned only from evidence, CORS disabled when `ALLOWED_ORIGINS` is empty | keep "empty = off, never open" | CURRENT |
| **Observability** | `request_id` on every error; DSN-gated Sentry; JSON logs; `ENGINE_VERSION` in the boot line | one correlation id across API → runtime → DB session (`application_name` already tags the pool) | CURRENT/PROPOSED |
| **Error handling** | contract-defined envelope; 500 carries no internals | unchanged | CURRENT |
| **Caching / invalidation** | no HTTP cache; `catalog_version` digest + preset shelf keyed on it (R-27) | decide serve-stale-vs-nothing as a contract change | CURRENT |
| **Preset generation** | `scripts/generate-presets.js` with target guard, restore point, FK-ordered cleanup | owned by the API project; physical home `apps/api/bin/` (§3.3) | CURRENT/PROPOSED |
| **Offer freshness** | 30-day window (Decision 7); freshness gate INCONCLUSIVE on a seed catalog; waiver default OFF, forced ON by the beta API | keep the gate; waiver is a product decision (B1) | CURRENT |
| **Data provenance** | `VERIFIED` requires ingestion record + listing id + matching host + seller + non-future `fetched_at` | ingestion project owns closing R-01; counts are environment-qualified (§11A) | CURRENT |
| **Backup / restore** | Neon restore points recorded per apply; `database/migration-applies.jsonl` is the audit trail | unchanged; document the restore drill per environment | CURRENT |
| **Deployment separation** | API = Docker/Render; V1 = Workers (configured, undeployed); V2 = nothing | one descriptor per deployable; retire `fly.toml` or `render.yaml` (B6) | DECISION REQUIRED |
| **Environment separation** | shared / TEST branch / EU; EU pinned to a scoring model; TEST is the only write target | unchanged; a staging environment is a separate programme item | CURRENT |
| **CI/CD ownership** | `ci.yml` (push/PR + nightly), `web.yml`, `web-v2.yml`; no deploy step anywhere | one job group per project; a deploy step only at §19 step 10 | CURRENT/PROPOSED |
| **Dependency updates** | no Dependabot/renovate config; versions pinned by lockfiles | per-project automated update PRs once manifests exist | PROPOSED |
| **Supply chain** | `npm ci` everywhere; no `npm audit` gate; Docker base unpinned by digest | audit gate per project + digest-pinned base | PROPOSED |
| **Testing ownership** | engine / scripts / API / V1 / V2 suites | each project owns its suite; golden infra owned by runtime (§8.2) | CURRENT/PROPOSED |
| **Release versioning** | `engine_version` = git short SHA; contract `1.10.0`; scoring model `name@version` | per-project version fields, contract version as the integration key | CURRENT/PROPOSED |

### 18.2 Authentication roadmap (explicitly not designed here)

**CURRENT:** no authentication, no account, no user table, no session store. Saved builds in V1 are browser-local. Every Layer 4 row is anonymous.

**PROPOSED sequencing** (each step needs an owner decision; none is designed here): decide whether accounts are in scope (B5); if so, the API owns identity, the database owns the user table and ownership columns, the frontend owns only the session flow; saved builds become the first per-user resource; per-IP rate limits stay for anonymous traffic.

**Not claimed:** that authorization exists, that rate limiting is per-user, or that any endpoint is protected. None is true today.

### 18.4 Guard rails that no project split may weaken

1. A write test never targets the shared database.
2. A real-database write needs a restore point and leaves an audit line.
3. A committed migration is never edited.
4. `NULL` is UNKNOWN, never 0, and UNKNOWN is never PASS or FAIL.
5. A gate verdict is PASS / FAIL / INCONCLUSIVE; INCONCLUSIVE is never reported as a pass.
6. No credential is printed, committed, or pasted into a chat.
7. The core package's suite stays DB-free, network-free and environment-free.

### 18.5 What a project split would *newly* require

| New requirement | Why |
|---|---|
| a boundary test per package | module boundaries exist today only for API→engine |
| a hermetic core run (no `node_modules`) | proves **zero third-party dependencies** rather than asserting it |
| a per-project install check in CI | proves `apps/api` is independent once it has a manifest |
| a contract compatibility gate + cross-copy drift check | §15.4 |
| a named owner per project | §8, §21 A5 |
| a documented deploy descriptor per deployable | V1's is undeployed; V2 has none |

---

## 19. Migration roadmap

### 19.1 The authoritative dependency table

Every step is independently reviewable as its own PR. "Parallel" marks work with **no dependency on the other step's output**; nothing else is parallel, and no step is labelled parallel merely because it starts early.

| Step | Scope | Depends on | Genuinely parallel with | DB contact allowed | Deploys? |
|---|---|---|---|---|---|
| **1. Architecture approval** | A1-A6 in §21 **approved 2026-11-11** (§21.1); one accountable owner role defined per responsibility (§8); human names are assigned by the owner, not in this RFC (§21.1, A5) | — | — | none | no |
| **2. Documentation cleanup** | §16.5 disposition; root becomes navigation — **executed 2026-11-11 by PR #24** (`ffd336c`), recorded in §16.7 | 1 | — | none (read-only `--offline` gates only) | no |
| **3a. Package boundary preparation** | create `packages/{recommendation-core,recommendation-runtime,database-guard}` manifests and empty `src/` skeletons; move the guard into `packages/database-guard/` and update its consumers; path-only Docker/hosting corrections permitted (owner decision 1); no recommendation module moves; boundary tests written — **executed in part 2026-11-11 by PR #27** (`7691b4f`): the three manifests, the core `src/.gitkeep`, the guard package with its own suite and CI step, the consumer path updates and the four path-only Docker/hosting corrections are done; no recommendation module moved; the core boundary test arrived later, in step 4B PR 1 (row 4) | 1, 2 | **3b** | none | no |
| **3b. Contract & shared-interface preparation** | §15.4 O2: `contract/openapi-<version>.json`; the API snapshot test and V1's generator point at it; contract-copy drift gate; Git-ref compatibility gate. **V2 is not touched here** - its integration is step 7 | 1, 2 | **3a** | none | no |
| **4. Core extraction** | the 47 pure file-level moves + split barrels + narrowed imports + hermetic suite (§11.2, §11.6). **Harness first (step 4B PR 1, PR #29, merged 2026-11-15 as `56cbb692`):** the boundary — loadable entry point, purity gate, export snapshot, hermetic run, `test:core` in CI — is implemented **before** any module moves. **Six batches have since moved behind it:** PR #32 (`aa7b398`, 2026-11-16) moved the pure `candidates`, `compatibility` and `filtering` modules, PR #36 (merged 2026-11-18 as `57bca1c`) moved `assembly`, step 4B PR 4 (PR #41, merged 2026-11-19 as `43fd8c8`, baseline `07dfd22`) moved `ranking`, step 4B PR 5 (PR #44, merged 2026-11-19 as `1a9d8cf`, baseline `0f439e0`) moved `retention`, step 4B PR 6 (PR #45, merged as `0f86f53`, baseline `1a9d8cf`) moved the 5 pure scoring modules, and step 4B PR 7 (branch `feat/core-explanation-extraction`, baseline `2683713`) moves Engine 6 `explanation` and `offers/as-of` — `npm run verify:extraction` reports `blob-identical: 47 / 47`. Seven namespaces are on `master` (`45133d5`, after PR #45 and PR #47); the PR 7 branch publishes nine, the `exports` map of §11.4 included, with identity shims at every moved file's old path. The loaders, the three mixed barrels and the runtime package have not moved, so this step is **COMPLETE**: PR #49 (batch `step-4b-pr7`) merged 2026-11-20 as `2569647` and publishes the eighth and ninth namespaces, which finishes the pure-logic extraction | 3a, 3b | — | none (`test:unit` is DB-free) | no |
| **5. Runtime extraction** | the **23** runtime modules (15 moved, 8 remaining; §11.2, §19.4); orchestrator/transaction docs; DB-free fake-client suites | 4 | **the offer-ingestion workstream** (§19.4.2) | **TEST only** for DB-backed suites (§19.2 T2) | no |
| **6. API migration** | `apps/api` manifest, `file:` deps, imports to the two packages + guard, pool unchanged, Dockerfile root-context build | 5, 3a, 3b | **7** | **TEST only** for `test:api:db` | no |
| **7. V2 lands on `master`** | application-only port; **this is where V2 is connected to the shared contract**: discard the branch's platform copy, point V2's generator at `contract/openapi-<version>.json`, regenerate its API types, verify API compatibility, and prove V1 and V2 consume the same contract while preserving existing V2 functionality. Deferred from 3b by owner decision 3 (2026-11-11) | 3b | **6** | none | no |
| **8. V2 parity** | the retained capability set (B3) implemented and tested | 7, B3 | — | none (fixture mock / read-only calls) | no |
| **9. Final operational validation & release prep** | full gate sweep, `verify:replay`, role rehearsal, image build, `check-deployed-role` warm-up plan, release notes | 6, 8 | — | **TEST only**, plus read-only gates on shared/EU | no |
| **10. Deployment** | API image + V2 descriptor; migrations/seeds to the target with restore point + audit line; `ALLOWED_ORIGINS` set | 9, **B6** | — | **production/EU writes permitted here only** | **yes — first deployment** |
| **11. V1 retirement** | delete `apps/web` + its workflow once every retained capability is live on V2 and the rollback window has passed | 10, B2, B3 | — | none | unpublish V1 only |
| **12. Optional multi-repository extraction** | only if §17.4's triggers fire | 11, or the triggers | — | n/a | n/a |

```
1 ──► 2 ──► 3a ──► 4 ──► 5 ──► 6 ──┐
        └──► 3b ──┬──────────────► 6 (contract path)
                  └──► 7 ──► 8 ──► 9 ──► 10 ──► 11 ──► 12(optional)
                                    ▲
                          6 ────────┘
```

Only `3a ∥ 3b` and `6 ∥ 7` are parallel. The first revision's "steps 6, 7 and 9 can run in parallel" was wrong on its own prerequisites: step 9 validates the output of 6 and 8.

### 19.2 Safety policy (replaces "no step writes to the database / no step deploys")

The first revision said no step writes and no step deploys, while later steps require DB-backed tests and a deployment. This is the tiered policy that replaces it.

| Tier | Applies to | Permitted | Required safeguards | Forbidden |
|---|---|---|---|---|
| **T0 — no database contact** | steps 1-4 (and any docs work) | read-only gates that never connect: `verify:docs --offline`, `gen-decision-index --check`, `git diff --check`, `test:unit` | none | any connection, any credential read |
| **T1 — DB-backed tests on TEST / disposable scratch** | steps 5, 6, 9 | suites that read and write **only** the isolated TEST branch or a scratch database created for the purpose | (a) `TEST_DATABASE_URL` set and provably not the shared host (`resolveTestDbUrl`); (b) a 1-row `SELECT` pre-flight before relying on the branch; (c) the target's `db:<12 hex>` digest printed; (d) fixtures cleaned in `finally` and residue asserted 0; (e) a branch reset when a rehearsal dirties it | any write to shared, EU or production; any credential printed or persisted |
| **T2 — read-only gates on shared/EU** | steps 5-9 diagnostics | `--check`/read-only gates: `check-offer-*`, `check-catalog-identity`, `check-og01-coverage`, `check-target-parity`, `verify:replay` (creates only a scratch DB) | guard + digest printed; no DDL/DML on the reference target | any write |
| **T3 — deployment / production writes** | **step 10 only** | deploying the API and V2; applying reviewed migrations/seeds to the target | owner approval; `--restore-point=<id>` for a real apply; audit line per file; `ALLOWED_ORIGINS` set explicitly; rollback = unpublish + restore point | anything not reviewed in the step-10 PR |

**Rules that are not negotiable:**

1. **Nothing before step 10 deploys anything.** No step implies a deployment.
2. **A guarded test is not an authorization.** Passing `TEST_DATABASE_URL` permits TEST; it never permits a shared, EU or production write.
3. **The RFC itself never authorizes any database write or deployment.** Step 10 is the earliest planned phase at which a separate, reviewed release PR may **request** explicit owner authorization. Such approval requires a verified target, a restore point, audit evidence and the existing database safeguards — and RFC approval does not grant it in advance: the A1-A6 approval recorded on 2026-11-11 authorizes no write and no deployment.
4. **Steps 11-12 never write to a database.**
5. **Rollback** stays a single `git revert` per step because no step mixes a move with a behaviour change (§20.2).

### 19.3 Step acceptance criteria (the four extraction steps, condensed)

| Step | Acceptance |
|---|---|
| 3a | **the four manifests exist**: root `package.json`, `packages/recommendation-core/package.json`, `packages/recommendation-runtime/package.json`, `packages/database-guard/package.json` (`apps/api` deliberately still has none until step 6); `packages/database-guard` passes the guard's own tests; no recommendation module has moved; `test:unit` and `test:api` are unchanged, `test:scripts` drops exactly the moved guard test, and all are green. **Status after PR #27 (`3e2f13e`, 2026-11-11):** the four manifests exist, `npm run test:database-guard` is wired into `ci.yml`, `test:scripts` no longer includes the moved guard test, and no recommendation module has moved |
| 3b | one `contract/openapi-<major>.<minor>.<patch>.json` exists and no other `openapi-*.json` remains outside it; the snapshot test, V1's generator and the CI path filters point at it; the Git-ref compatibility gate passes on an additive change and fails on a breaking one; V2 untouched |
| 4 | core's suite passes with `node_modules` absent; boundary scan clean; `test:unit` count unchanged except for moved paths; `git diff` shows no logic change in a moved file |
| 5 | runtime's DB-free suite green; a DB-backed suite on TEST passes with residue 0; every orchestrator entry point documents its transaction ownership |
| 6 | `cd apps/api && npm ci && npm test` with no root `node_modules`; `docker build -f apps/api/Dockerfile .` starts and answers `/v1/health`; `import-boundary.test.js` green against the new packages |

---

### 19.4 Recorded open and deferred items (CURRENT — Revision 16)

Five items this revision records. The first is now **decided**; the rest name what is measured, what is open and who owns the next move. None of them is a step in §19.1 and none changes an approved decision.

#### 19.4.1 `orchestrator/compute.js` — OWNER DECIDED: Option 1 (runtime-internal, published nowhere)

`compute.js` is the pure assemble-and-score seam of one pass: `computeFromLoaded` takes the rows `run.js` already loaded and drives scoring → retention → Engine 3 assembly → Engine 4 build scores into the frozen `{ query_id, scoring_model_id, builds, budget_amount, currency, build_contributions, budget_floor }`. §11.2 omitted it from its table, which is why the runtime total was quoted as "21" in one place and "24" in another; both are corrected in §11.2.

Measured properties, read from the file rather than inferred: it executes **no SQL**, reads no clock, no `process.env` and no randomness — `compute.purity.test.js` scans its source for exactly those forms — and its only requires are `../scoring`, `../retention`, `../assembly` and `../candidates/errors`, which are core namespaces and a core error class. `compute.golden.test.js` replays a full pass from a text fixture, so its behaviour is already a function of its arguments alone.

**The owner has decided: Option 1.** Both options and their costs are kept below as the record of what was weighed, so a later reviewer can see the alternative that was not taken rather than having to reconstruct it.

| Option | What it means | What it costs |
|---|---|---|
| **Option 1 — runtime-internal, moves with W3 (DECIDED)** | joins the seven other orchestrator files at `packages/recommendation-runtime/src/orchestrator/compute.js`; published nowhere, because §11.5's eight entry points do not include `computeFromLoaded` | the pure core loses a replayable seam: a consumer that wants to score a fixture needs the runtime package and its database-shaped dependency list, even though `compute.js` itself needs neither. No new test work — the golden test moves with the file |
| **Option 2 — core candidate (not taken)** | moves into `packages/recommendation-core/src/` and becomes a published computation entry point, as a new §11.4 subpath or a member of an existing namespace | core gains an assembly → scoring → retention composition where it owns only the stages; `run.js` then imports it through the core entry, which is already the required direction. §11.2's rule that `filterCandidates` stays in the orchestrator, §11.3's argument that a write payload shape must not enter core, and §11.4's "the API may not import a calculation entry point" all have to be re-read against the new name. `verify:extraction` needs a new manifest batch and a characterisation fixture |

**Decision: Option 1** — owner-decided, so W3 moves `compute.js` with its seven sibling files and publishes it nowhere. Option 2 is **not** taken and its cost is recorded rather than dismissed: the pure core gives up a seam it could otherwise replay from a fixture, and a consumer that wants to score one needs the runtime package and its database-shaped dependency list, even though `compute.js` itself needs neither. If that cost ever outweighs the churn, Option 2 stays reachable as a one-file move with its own manifest batch and characterisation fixture, and nothing in Option 1 forecloses it.

#### 19.4.2 The offer-ingestion gap — `apps/offer-ingestion/` does not exist

`apps/` holds `api`, `web` and `web-v2` only. Offer ingestion is implemented inside the engine library under `src/recommendation/ingestion/`, which §11.2 assigns to **neither** package, and it is driven today by the `scripts/` CLIs. The eight non-test modules are:

| Module | What it owns |
|---|---|
| `ingestion/plan.js` | turns parsed listings into a plan: match decisions, inserts versus updates, per-listing verdicts |
| `ingestion/matching.js` | the identity decision for one listing (name/variant matching against the catalogue) |
| `ingestion/listings.js` | the listing payload contract and its normalisation |
| `ingestion/adapters/manual.js` | the manual/operator adapter, the only source today |
| `ingestion/apply.js` | applies a plan through the guard and the audit trail |
| `ingestion/promotion.js` | offer and price promotion, including the `SEED_UNVERIFIED` → verified transition |
| `ingestion/run.js` | the end-to-end orchestration of one import |
| `ingestion/index.js` | the barrel |

Their suites (`plan.test.js`, `matching.test.js`, `listings.test.js`, `adapters/manual.test.js`, `promotion.test.js`) travel with the modules.

Acceptance criteria for `apps/offer-ingestion/`, when it is staffed:

1. the eight modules above live under `apps/offer-ingestion/` (or its `src/`), `src/recommendation/ingestion/` is gone, and every old path is either deleted or an identity shim;
2. the project has its own manifest and lockfile decision, matching whichever choice `apps/api` and `apps/web` each made, and its suite runs with no root `node_modules`;
3. every database write still routes through `packages/database-guard/src/index.js`, still requires `--restore-point` for a real apply, and still leaves its `database/migration-applies.jsonl` audit line;
4. the ingestion CLIs and `scripts/verify-schema.js`, `verify-constraints.js` and `verify-fks.js` resolve through the new location, with `npm run verify:docs --offline` and `npm run test:scripts` green;
5. the ingestion suites pass in CI from the new location and `npm run test:unit` drops exactly the moved tests — no assertion changes with the move;
6. the §8.1 ownership matrix, `AGENTS.md` §4 and §6, and `docs/ingestion/AGENTS.md` name the new project instead of `scripts/`.

**Scheduling: a parallel workstream.** It depends on none of steps 5-9 and nothing in steps 5-9 depends on it, because ingestion writes the catalogue that the recommendation runtime only reads back. It is the third genuinely parallel lane this RFC has, after `3a ∥ 3b` and `6 ∥ 7`, and §19.1 row 5 records it. Until it is staffed the modules stay where they are, and §12.5's open problem — identity, not collection — remains the constraint that matters more than the directory move.

#### 19.4.3 Deferred: the `./loaders` subpath and the `exports` map must land before Step 6

`packages/recommendation-runtime/package.json` declares `main` and no `exports` map, and `src/index.js` publishes `loaders` only through that `main`. The deferred work is a manifest change plus a gate:

1. an `exports` map declaring `.` and `./loaders`, mapping to the files §11.5 lists rather than to the module tree;
2. a resolver gate mirroring core's `scripts/lib/core-package-exports.test.js` — install the package under a throwaway consumer outside the repository and ask Node's resolver instead of re-reading the manifest;
3. the same treatment for `./orchestrator` and `./persistence` when W3 and its call sites exist, since §11.5 publishes both.

**Why before step 6 rather than during it.** Step 6 rewrites `apps/api`'s imports to the two packages. Without an `exports` map the API's import specifiers are decided by whichever deep relative path happens to work, so §11.5's approved surface is discovered rather than enforced — the failure mode §11.4's `./package.json`-throws rule was written to prevent in core. The runtime is also `private: true`, so an undeclared subpath cannot fail an install; only the resolver gate makes the absence visible.


#### 19.4.4 The nightly evidence-age report is OVERDUE, and it never fails a job

Measured from the scheduled `ci` runs, whose `recurring-gates` job runs on `schedule` and `workflow_dispatch` only:

| Run | `rows` / `due` / `overdue` / `oldest` | Band | Job |
|---|---|---|---|
| 2026-11-23 `45175976395` | `319 / 2 / 1 / 264.6 day(s)` | `RESULT: OVERDUE` | **failure — from `test:api:db`, not from this step** |
| 2026-11-24 `45405972119` | `319 / 2 / 1 / 265.6 day(s)` | `RESULT: OVERDUE` | success |

The driving row is the single `PERFORMANCE` row of the **2026-03-03** cohort (265.6 days old at the 2026-11-24 run). The second due row is `PERFORMANCE / 2026-08-20` at 95.6 days, which is DUE and not OVERDUE; the bands are 90 and 180 days, boundary exclusive.

**The step cannot fail the job, by design, three independent ways:** `continue-on-error: true`; `set +e` with `|| echo "::warning …"`; and `scripts/check-assessment-age.js`, which exits 1 only under `--strict`, a flag the workflow never passes. `scripts/lib/ci-workflow.test.js` and `scripts/lib/assessment-age-cli.test.js` pin all three, so making the report red is a change to a tested contract, not a tightening of one.

**The 2026-11-23 red nightly was a different gate.** `recurring-gates` failed because `test:api:db` reported `16 passed, 1 failed` on `not ok 10 — a generated ribbon is idempotent per key and is served by GET /v1/presets` (`AssertionError`). The age step ran afterwards under `if: always()` and printed `RESULT: OVERDUE` without affecting the job. The next nightly, 2026-11-24, was green with the same age band, so the ribbon failure was not persistent.

**Owner action: refresh the evidence or record a waiver.** Refreshing means re-researching the 2026-03-03 row, never re-dating it — a row stamped fresh with no new evidence is a fabricated freshness claim, which is R-28's own argument. A waiver is a Decision entry stating that an OVERDUE band is accepted while `per_day_decay: 0`, so the report stays informational and nobody reads OVERDUE as a regression. Neither is taken here.

#### 19.4.5 Open: the 2026-11-23 scheduled run failed `test:api:db` — under investigation

The scheduled `ci` run **45175976395** (2026-11-23, `recurring-gates`) failed in `test:api:db`, which reported `16 passed, 1 failed`:

```
not ok 10 - a generated ribbon is idempotent per key and is served by GET /v1/presets
  failureType: 'testCodeFailure'
  name: 'AssertionError'
```

- **Status:** **under investigation.**
- **Owner:** agent.
- **Scope of this PR:** recorded only. The failure is **not diagnosed here** and no cause is proposed. A red nightly on one preset case is not evidence about the extraction, and the two must not be conflated in the record.
- **Why it is not being written off as flake:** the following nightly (2026-11-24, run 45405972119) was green against the same `TEST` branch, which is consistent with an order-dependent or data-dependent case without proving it. The investigation owes an answer on whether the case is order-dependent, and a repeat `workflow_dispatch` run against `TEST`, before it is either fixed or recorded as a known flake.
- **Relationship to §19.4.4:** these are two different gates in the same job. That one is a warning-only age report that can never fail the job; this one is a failing assertion suite that did.

---

## 20. Risks and rollback strategy

### 20.1 Programme-level risks

| # | Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|---|
| K1 | **Boundaries agreed but not enforced**, so they rot | High | Medium | one DB-free boundary test per project in the creating PR | change the test only if the boundary decision changes |
| K2 | **A move breaks a nightly-only path** | Medium | High | run `test:scripts`, `verify:replay --test-db` and one harness in the move PR | revert the move commit |
| K3 | **The V2 landing imports the branch's platform copy** | Medium | High | `git diff --stat` of the port must touch only `apps/web-v2/**` + its workflow | revert the merge commit |
| K4 | **A doc rewrite changes a measured figure** | High | Medium | §16.6 + `verify:docs` + treat a changed number as a claim | revert that hunk |
| K5 | **The API package split changes runtime behaviour** (second `pg`, different guard resolution) | Medium | High | image health check + `test:api:db` from inside `apps/api`; `require.resolve` check in the image | revert manifest + Dockerfile together |
| K6 | **The contract move leaves one consumer on a stale copy** | Medium | Medium | cross-copy drift gate (§15.4 item 2) + both `check:api-types` | revert the path change |
| K7 | **Write-safety erosion** — a step touches a real database "to verify" | Low | Critical | §19.2 tiers; T3 only at step 10; guards in every step | restore point + audited revert, owner-only |
| K8 | **Owner decisions postponed**, steps silently pick a boundary | Medium | High | §21 marks what each decision blocks; a blocked step does not start | n/a |
| K9 | **Two frontends diverge further** during parity | High | Medium | freeze V1 to fixes; keep the parity matrix live | n/a |
| K10 | **The programme becomes a rewrite** | Medium | High | every step's out-of-scope line; behaviour frozen by existing tests | revert the step |
| K11 | **A core/runtime barrel regression** — a pure consumer starts pulling a runtime export through a barrel | Medium | Medium | §11.3 barrel rule + narrowed imports + core boundary scan | restore the export list; the test fails loudly |
| K12 | **`file:` dependency breaks the image** (symlink layout, lockfile drift) | Medium | High | the §13.4 acceptance check inside the image before merge | revert to the root-context single-install image |

### 20.2 Rollback principles

1. **No step mixes a move with a behaviour change.** A move PR shows no logic diff; a behaviour PR shows no path churn.
2. **Each step is reversible by one `git revert`**, except step 10, whose rollback is unpublish + restore point.
3. **The recovery ref exists before any history-changing action.** `backup/master-before-contract-revert` should be deleted only after the contract decision (step 3b) is settled.
4. **No step's rollback requires a database write.**

### 20.3 What would make this RFC wrong

- If the owner reverses the Option B decision, §7.2 and §11 become a rejected-options record and the roadmap's steps 3a-6 collapse into one engine move — **this is the single largest assumption in the document**.
- If accounts and per-user data enter the beta, §18.2 moves earlier and the database gains ownership columns.
- If real offers land first, ingestion's boundary is validated earlier and could be pulled forward.
- If V1 is declared the product and V2 an experiment, §14's transition inverts and steps 7-11 are withdrawn.

---

## 21. Decisions, separated by what they block

The first revision mixed architecture blockers with product questions, which made approval hostage to decisions the architecture does not depend on. They are now separated.

### 21.1 Architecture decisions (block RFC approval)

Each row records a **recommended resolution**. **A1-A6 were approved by the repository owner on 2026-11-11** — see the approval record immediately after the table. The `Status` column records that owner approval, which is not a self-certification by this RFC. The product and operations decisions in §21.2 remain open.

| ID | Question | Recommended decision | Status | Owner (role) | Blocks |
|---|---|---|---|---|---|
| **A1** | One repository with six ownership areas (modular monorepo), or multi-repo? | Modular monorepo; multi-repo deferred behind §17.4's triggers | **APPROVED 2026-11-11** — modular monorepo; multi-repository extraction deferred until §17.4's triggers are met | platform owner | **approved** — packages stay directories in one repo (§17.2) |
| **A2** | Approve core's and runtime's public entry points, the barrel split, and the API→core vocabulary subset | §11.4/§11.5 as written; the API is restricted to the frozen vocabulary in §9.2, and runtime is not the owner of vocabulary the API consumes | **APPROVED 2026-11-11** — §11.4/§11.5 public interfaces and dependency boundaries adopted as written | architecture owner | **approved**; step 4 may proceed |
| **A3** | Is the guard an installable `packages/database-guard` package, and who loads `.env`? | Yes; zero-dependency package, with environment loading left to the consuming API/CLI bootstrap (§9.4) | **APPROVED 2026-11-11** — zero-dependency `packages/database-guard`; `.env` loading stays with the consuming API/CLI bootstrap. **Implemented by PR #27 (merged as `3e2f13e`).** | platform owner + database owner | **approved and executed**; step 3a |
| **A4** | Where does the contract live, and is it published? | One versioned `contract/openapi-<version>.json` owned by the API; publication as a release artifact later (O3) | **APPROVED 2026-11-11** — one authoritative versioned OpenAPI contract owned by the API; publication as a release artifact **deferred** (O3) | API owner + platform owner | **approved**; step 3b (§15.2) |
| **A5** | Who is accountable for each responsibility? | §8's matrix **after** the preset-generation split: exactly one accountable owner per row | **APPROVED WITH OWNERSHIP SAFEGUARDS 2026-11-11** — §8 matrix adopted; one accountable **human** owner per responsibility, names deliberately unassigned here (see the approval record) | platform owner | **approved**; step 1 acceptance |
| **A6** | Accept and document runtime's real schema + client-protocol dependency, with the API owning the pool | Accepted and documented (§9.5); runtime declares no `pg` dependency, and the pool stays in `apps/api/src/db.js` | **APPROVED 2026-11-11** — explicit client protocol; the API keeps the pool (`apps/api/src/db.js`); runtime declares no `pg` dependency | architecture owner | **approved** |

**Approval record (A1-A6).**

| Field | Value |
|---|---|
| Decisions approved | A1, A2, A3, A4, A6 as recorded above; **A5 approved with ownership safeguards** |
| Decided by | The repository owner — the accountable human owner of this repository. No personal name, signature or account handle is recorded, because none was supplied with the approval and none may be invented. |
| Date | 2026-11-11 |
| Basis | The owner's review of the six architecture decisions against the primary objective: a maintainable, modular, production-ready architecture without changing existing business behaviour or adding unnecessary complexity |
| Scope | Architecture decisions only. **B1-B8 (§21.2) are not approved** and remain open. |
| Exclusions | Recording an approval authorizes **no implementation**: no package extraction, no behaviour or recommendation-logic change, no database connection or write, no migration or seed, no deployment — and recording it merged nothing: **PR #23 was merged separately on 2026-11-11 (`0bcb6e3`) and implements none of it**. |
| A5 safeguard | §8 requires exactly one accountable human owner per responsibility. Names stay unassigned in this RFC: assigning organizational accountability is the owner's act, never an AI agent's, and no name is invented to fill a row. |

### 21.2 Product and operations decisions (do **not** block approval)

| ID | Question | Owner (role) | Blocks (which phase / deployment) | Not an architecture blocker because |
|---|---|---|---|---|
| **B1** | Do the beta's prices stay unverified, and does the seed-offer waiver stay on? | product owner | **deployment** and the waiver-off date; not approval | The architectural half is recommended as settled (A2): the default lives in `apps/api/src/engine.js` (`API_ENGINE_OPTIONS`), an API-owned policy that runtime accepts as a caller option. Whether it *should* be on is a data-honesty/product choice with no boundary consequence. Evidence for the choice: §11A.2. |
| **B2** | Is V2 the single future frontend? | product owner | steps 7-11 (parity, retirement) | V1 and V2 already have independent manifests; the boundary does not change either way. Evidence: §14.2. |
| **B3** | Which V1 capabilities must be retained? | product owner | step 8's definition of done, step 11 | It defines scope, not boundaries. Evidence: §14.7. |
| **B4** | Does ingestion become a scheduled service or stay an operator job? | operations owner | nothing architectural; later ingestion work | It changes how ingestion runs, not what it may import. Evidence: §12. |
| **B5** | Are accounts in scope, and for what? | product owner | any gated/private surface; if yes, a later architecture change (ownership columns) | Today nothing is authenticated; the current split is unaffected. Evidence: §18.2. |
| **B6** | Which provider hosts the API and the frontend? | operations owner | **step 10 only** | Deployment choice, not code boundaries. Evidence: §2.4 (`fly.toml` vs `render.yaml` both claim the API). |
| **B7** | Same-origin gateway/BFF, or per-frontend proxy? | operations owner | V2 deployment (step 10) | A runtime/deploy decision; CORS already stays closed. |
| **B8** | Do the two frontends share a design system? | product owner | nothing now | Current state (unshared) is the recommended state. |

### 21.3 Owner-confirmed implementation decisions (2026-11-11)

Four implementation questions were confirmed by the repository owner. They **clarify how approved work is carried out**; none changes an architecture decision, a package boundary, a dependency direction, an API semantic or a recommendation behaviour.

| # | Decision | Status | Effect on this document |
|---|---|---|---|
| **D1** | Docker and hosting updates are **path-only**: `apps/api/Dockerfile`, `.dockerignore`, `fly.toml` and `render.yaml` may be edited to point at the moved database guard | **APPROVED** | Recorded in §13.4. Authorizes path corrections only - no Docker architecture, hosting, infrastructure, environment-variable or deployment change |
| **D2** | The API pool test **stays in the API** (`apps/api/test/unit/db-guard.test.js`); only the guard's own test moves, to `packages/database-guard/test/db-url.test.js`; the package stays independent of `pg` | **APPROVED** | Corrects §9.2, §9.4 and §10.1. The guard contract has seven exports (§9.4) and no restore-point predicate |
| **D3** | **V2 contract integration is deferred to step 7.** Step 3b covers the API, V1 and the shared `contract/` location only; V2 stays on `feature/v2-design` | **APPROVED** | Recorded in §15.4 and in the §19.1 rows for 3b and 7. Deliberate deferral, not abandonment |
| **D4** | The OpenAPI compatibility gate uses a **Git-ref baseline** (`--base=<ref>`), never a second committed baseline and never committed-versus-served | **APPROVED** | Recorded in §15.4 item 4. The snapshot test keeps its separate responsibility: committed contract versus served contract |

**Consequence:** A1-A6 were the only approval blockers, and they were approved on 2026-11-11. **B1-B8 remain open**: they are recorded so they are not lost, and each names the phase it blocks. In particular **B1 and B3 were never approval blockers**: neither changes a package boundary, a dependency direction, a contract, an ownership row, or the migration sequence.

---

## 22. Acceptance criteria

### 22.1 For this RFC itself

| # | Criterion | State |
|---|---|---|
| AC-1 | Every material claim is labelled CURRENT / RECORDED / PROPOSED / DECISION REQUIRED / DEFERRED / UNKNOWN | met |
| AC-2 | Every CURRENT claim cites a path, a command result or git history | met (§23.3) |
| AC-3 | The purity claim is split into four separately evidenced properties | met (§6.2) |
| AC-4 | The dependency-graph claim is backed by reproducible analysis, or withdrawn | met: SCC analysis, 80/80 singleton (§6.3, §23.2) |
| AC-5 | Transaction ownership is stated per module, not per directory | met (§6.5) |
| AC-6 | Option B is the selected direction, with the rejected options documented | met (§7.2) |
| AC-7 | A file-level migration mapping covers every module and names mixed files | met (§11.2) |
| AC-8 | Core and runtime entry points, allowed directions and forbidden imports are explicit | met (§9.1, §11.4, §11.5) |
| AC-9 | One authoritative ownership matrix; every gate has exactly one owner | met (§8) |
| AC-10 | The guard and Docker designs are implementable as written | met (§9.4, §13.4) |
| AC-11 | The roadmap has one dependency table with only genuine parallelism | met (§19.1) |
| AC-12 | Safety policy distinguishes shared/EU/production writes from guarded TEST writes, and names the deployment step | met (§19.2) |
| AC-13 | V2 staging evidence is cited, dated, and its limits stated | met (§14.4) |
| AC-14 | Every count names environment, date, source and kind | met (§11A.2) |
| AC-15 | Decisions are split into approval blockers and product/ops decisions | met (§21) |
| AC-16 | No application, database, test, workflow, manifest, Dockerfile or lockfile changed in this PR | met — see §23.5 and `git diff --stat` |
| AC-17 | The API→core interface is a named, enforced vocabulary; runtime is never described as core's only consumer | met (§9.2, §11.4, §13.3) |
| AC-18 | Every responsibility has exactly one accountable owner, including preset generation | met (§8.1, §8.3) |
| AC-19 | Recommendations are distinguished from owner approvals; no decision is marked approved by this RFC | met (§21.1) — the RFC records recommendations; A1-A6 carry the **owner's** approval of 2026-11-11, recorded with its scope and exclusions, never a self-approval |
| AC-20 | Terminology separates six ownership areas from installable packages and applications | met (§7.3) |

### 22.2 For the programme (definition of done per project, PROPOSED)

A project is "separated" when: (1) it has a `README.md` stating responsibility and prohibited imports; (2) it has a manifest if it has dependencies and can be installed from its own directory; (3) its tests run from its own directory; (4) a boundary test enforces its prohibitions; (5) its CI job can fail without failing another project's job; (6) its docs cover interface, environment, operations and limitations; (7) its accountable owner is named in §8.

---

## 23. Source references and evidence

### 23.1 Repository state inspected

| Item | Value | How |
|---|---|---|
| `master` (measured for Revisions 1-3) | `a413f25` | `git log --oneline` |
| `master` (Revision 4) | `e62c816` | `git rev-parse origin/master` |
| `master` (Revision 5 measurement) | `3e2f13e` — "Merge pull request #27 from ibrahim-lahribli/refactor/database-guard-package" — historical; not the current head | `git rev-parse origin/master` (2026-11-11) |
| `master` (Revision 7 measurement) | `56cbb692` — "Merge pull request #29 from ibrahim-lahribli/feature/recommendation-core-harness", merged 2026-11-15T03:16:00Z — **historical; not the current head** | `git rev-parse origin/master`; PR #29 `merged_at` |
| `master` (historical, Revision 8) | `4ba4122` — "Merge pull request #30 from ibrahim-lahribli/docs/recommendation-core-harness", merged 2026-11-15T03:43:14Z; the merged head was `7eb06c5` | `git rev-parse origin/master`; `git log -1 --format=%cI 4ba4122` → 2026-11-15T04:43:13+01:00; PR #30 `merged_at` |
| `master` (historical, Revision 10) | `07dfd22` — "Merge pull request #37 from ibrahim-lahribli/chore/core-package-description", merged 2026-11-18; its parents are `57bca1c` (PR #36's merge) and `098aee3` | `git rev-parse origin/master`; `git log --oneline -3` |
| `master` (current, Revision 12) | `43fd8c8` — "Merge pull request #41 from ibrahim-lahribli/feat/core-ranking-extraction", merged 2026-11-19; its parents are `c3186bc` (PR #42's merge) and `73979f8` (PR #41's branch head) | `git rev-parse origin/master`; `git log --oneline -3` |
| PR #29 head | `2297aae` ("fix(core): treat every Date call as a clock read and stop `:` opening blocks") — PR #29's final head, merged as `56cbb692`; the source branch was then deleted on `origin` | `git rev-parse 2297aae`; `git log -1 --format=%cI 56cbb692` |
| PR #27 head | `7691b4f` ("refactor: extract the database guard into packages/database-guard"), merged as `3e2f13e`; the source branch was then deleted on `origin` | `git ls-remote origin refs/pull/27/head`; `git show --stat 7691b4f` |
| `feature/v2-design` | `3bc0605` | `git log --oneline origin/feature/v2-design` |
| RFC branch | `architecture/system-separation-rfc` at `9297034`, **merged as PR #23 (`0bcb6e3`) and deleted**; Revision 4 and Revision 5 corrections are on `docs/rfc-accuracy-corrections` | `git log`, `git branch -a` |
| Manifests on `master` | root `package.json` + `apps/web/package.json` (and their lockfiles), plus `packages/recommendation-core/package.json`, `packages/recommendation-runtime/package.json` and `packages/database-guard/package.json` (added by PR #27; no package lockfiles) | `git ls-files \| grep -i package.json` |
| Manifests on `feature/v2-design` | the pre-PR-#27 set + `apps/web-v2/package.json` + `apps/web-v2/package-lock.json` | `git ls-tree origin/feature/v2-design apps/web-v2/` |
| `contract/` | does not exist on `master`; until step 3b the contract is `apps/api/test/unit/openapi-v1.10.json` | `ls -d contract` → absent |
| `packages/` (historical: `master` at `3e2f13e`, Revision 5 measurement) | **eight files**: `AGENTS.md` (package rules; added by PR #27), `database-guard/{package.json,src/index.js,test/db-url.test.js}`, `recommendation-core/{package.json,src/.gitkeep}`, `recommendation-runtime/{package.json,docs/LOADERS_AND_TRANSACTIONS.md}`. Only the guard has code; **no recommendation module has moved**; `recommendation-runtime/src/` and `database-guard/README.md` do not exist yet | `git ls-tree -r --name-only origin/master -- packages` |
| `packages/` on the PR #29 branch when Revision 6 was written (`71fc3b8`) | **twelve files**: `AGENTS.md`, `database-guard/{package.json,src/index.js,test/db-url.test.js}`, `recommendation-core/{package.json,src/index.js,test/{export-surface.json,index.test.js,purity-scanner.js,purity.test.js}}`, `recommendation-runtime/{package.json,docs/LOADERS_AND_TRANSACTIONS.md}`. The guard's suite and the core harness are the only code; the core entry point exports nothing and **no recommendation module has moved**; `recommendation-runtime/src/` still does not exist | `git ls-tree -r --name-only 71fc3b8 -- packages` |
| `packages/` on `master` (`56cbb692`, after PR #29 merged) — historical, Revision 7 | **fourteen files**: `AGENTS.md`, `database-guard/{package.json,src/index.js,test/db-url.test.js}`, `recommendation-core/{package.json,src/index.js,test/{export-surface.json,hermetic-run.js,hermetic-run.test.js,index.test.js,purity-scanner.js,purity.test.js}}`, `recommendation-runtime/{package.json,docs/LOADERS_AND_TRANSACTIONS.md}`. Revision 6's twelve plus the two hermetic files; the guard's suite and the core harness are still the only code, the core entry point exports nothing, **no recommendation module has moved**, and `recommendation-runtime/src/` still does not exist | `git ls-tree -r --name-only 56cbb692 -- packages` → fourteen paths |
| `packages/` on `master` (`4ba4122`, Revision 8) — historical | **fourteen files**, the identical path set to `56cbb692`: `AGENTS.md`, `database-guard/{package.json,src/index.js,test/db-url.test.js}`, `recommendation-core/{package.json,src/index.js,test/{export-surface.json,hermetic-run.js,hermetic-run.test.js,index.test.js,purity-scanner.js,purity.test.js}}`, `recommendation-runtime/{package.json,docs/LOADERS_AND_TRANSACTIONS.md}`. PR #30 changed only the **content** of `packages/AGENTS.md` among these paths, so the inventory is unchanged; the guard's suite and the core harness are still the only code, the core entry point exports nothing, **no recommendation module has moved**, and `recommendation-runtime/src/` still does not exist | `git ls-tree -r --name-only 4ba4122 -- packages` → fourteen paths; `git diff --name-only 56cbb692 4ba4122 -- packages` → `packages/AGENTS.md` only |
| `packages/` on `master` (`de659ad`, historical, Revision 9) | **52 files**: `AGENTS.md`; `database-guard/` (3: `package.json`, `src/index.js`, `test/db-url.test.js`); `recommendation-core/` (46: `package.json`, 24 under `src/` — `index.js` plus `candidates/` 6, `compatibility/` 14, `filtering/` 3 — and 21 under `test/`, including the PR 2 characterization fixture); `recommendation-runtime/` (2: `package.json`, `docs/LOADERS_AND_TRANSACTIONS.md`). The guard's suite, the core harness and **three moved namespaces** are code; `recommendation-runtime/src/` still does not exist. PR #36 adds `recommendation-core/src/assembly/` (7 files) on top of this when merged | `git ls-tree -r --name-only de659ad -- packages` → 52 paths |
| `packages/` on `master` (`07dfd22`, current, Revision 10) | **60 files**: `AGENTS.md`; `database-guard/` (3); `recommendation-core/` (54: `package.json`, 31 under `src/` — `index.js` plus `candidates/` 6, `compatibility/` 14, `filtering/` 3, `assembly/` 7 — and 22 under `test/`, including both characterization fixtures); `recommendation-runtime/` (2). The guard's suite, the core harness and **four moved namespaces** are code; `recommendation-runtime/src/` still does not exist | `git ls-tree -r --name-only 07dfd22 -- packages` → 60 paths; the Revision 9 row above (52 paths at `de659ad`) is the pre-#36 measurement and is retained |
| `packages/` on the PR 4 branch (`64edd94`, historical, Revision 11) | **68 files**: `AGENTS.md`; `database-guard/` (3: `package.json`, `src/index.js`, `test/db-url.test.js`); `recommendation-core/` (62: `package.json`, 35 under `src/` — `index.js` plus `candidates/` 6, `compatibility/` 14, `filtering/` 3, `assembly/` 7, `ranking/` 4 — and 26 under `test/`, including all three characterization fixtures); `recommendation-runtime/` (2: `package.json`, `docs/LOADERS_AND_TRANSACTIONS.md`). The database guard suite, the core harness and **five moved namespaces** are code; `recommendation-runtime/src/` still does not exist. Measured on the batch implementation commit, not on `master`, because the batch was not merged when this row was written; PR #41 merged as `43fd8c8` and the row below records the merged inventory | `git ls-tree -r --name-only 64edd94 -- packages` → 68 paths |
| `packages/` on `master` (`43fd8c8`, current, Revision 12) | **68 files**: `AGENTS.md`; `database-guard/` (3: `package.json`, `src/index.js`, `test/db-url.test.js`); `recommendation-core/` (62: `package.json`, 35 under `src/` — `index.js` plus `candidates/` 6, `compatibility/` 14, `filtering/` 3, `assembly/` 7, `ranking/` 4 — and 26 under `test/`, including all three characterization fixtures); `recommendation-runtime/` (2: `package.json`, `docs/LOADERS_AND_TRANSACTIONS.md`). The database guard suite, the core harness and **five moved namespaces** are code, and `ranking`'s four modules are on `master` rather than a branch; `recommendation-runtime/src/` still does not exist | `git ls-tree -r --name-only 43fd8c8 -- packages` → 68 paths |
| `packages/` on the PR 5 branch (`0bd7e6f`, historical, Revision 13) | **78 files**: `AGENTS.md`; `database-guard/` (3: `package.json`, `src/index.js`, `test/db-url.test.js`); `recommendation-core/` (72: `package.json`, 40 under `src/` — `index.js` plus `candidates/` 6, `compatibility/` 14, `filtering/` 3, `assembly/` 7, `ranking/` 4, `retention/` 5 — and 31 under `test/`, including all four characterization fixtures); `recommendation-runtime/` (2: `package.json`, `docs/LOADERS_AND_TRANSACTIONS.md`). The database guard suite, the core harness and **six moved namespaces** are code, and `retention`'s five modules are on `feat/core-retention-extraction` rather than `master`; `recommendation-runtime/src/` still does not exist. Measured on the batch implementation commit, not on `master`, because the batch was not merged when this row was written | `git ls-tree -r --name-only 0bd7e6f -- packages` → 78 paths |
| `packages/` on the PR 6 branch (`4fc50f7`, current branch, Revision 14) | **91 files**: `AGENTS.md`; `database-guard/` (3: `package.json`, `src/index.js`, `test/db-url.test.js`); `recommendation-core/` (85: `package.json`, 46 under `src/` — `index.js` plus `candidates/` 6, `compatibility/` 14, `filtering/` 3, `assembly/` 7, `ranking/` 4, `retention/` 5, `scoring/` 6 — and 38 under `test/`, including six moved test files and all five characterization fixtures); `recommendation-runtime/` (2: `package.json`, `docs/LOADERS_AND_TRANSACTIONS.md`). The database guard suite, the core harness and **seven moved namespaces** are code; `retention` is on `master` since PR #44 merged as `1a9d8cf`, and `scoring`'s five pure modules are on `feat/core-scoring-extraction` rather than `master`; `recommendation-runtime/src/` still does not exist. Measured on the batch wiring commit, not on `master`, because the batch was not merged when this row was written; PR #45 is open | `git ls-tree -r --name-only 4fc50f7 -- packages` → 91 paths |
| V2 staging record | exists on `feature/v2-design`, **not** on `master` | `git show origin/feature/v2-design:apps/web-v2/docs/staging-smoke.md`; `git cat-file -e origin/master:…` → fatal |

### 23.2 Commands run (Revisions 1-13; all read-only, no database contact)

| Command | Result used in |
|---|---|
| `git status --porcelain`, `git log --oneline`, `git branch -a` | §23.1 |
| `git ls-tree -r --name-only de659ad -- packages`; `git ls-tree -r --name-only HEAD -- packages/recommendation-core/src` | §23.1 Revision 9: **52 paths** under `packages/` on `master`, **31** under core `src/` at PR #36 head |
| `git ls-tree -r --name-only 07dfd22 -- packages \| wc -l`; per-directory `git ls-tree`; `git show 07dfd22:<path> \| wc -l` summed over non-test `.js`; content grep for `.query(` and for the core-shim `require`; `git rev-parse origin/master`; `git log --oneline -3` | §23.1, §25.3 Revision 10: `master` = `07dfd22`; **60** paths under `packages/`; `src/recommendation/` **67** non-test `.js` = 50 implementation + 17 shims (12 335 + 210 lines), 53 tests, 17 DB files; core `src/` **31** files / 5 895 lines, 0 DB files; engine total **81** files / 18 230 lines |
| `git ls-files \| grep -i package.json` / lockfiles | §3.1, §23.1 |
| `git ls-tree --name-only origin/feature/v2-design apps/web-v2/` | §3.1 (V2 manifest + lockfile) |
| `git show origin/feature/v2-design:apps/web-v2/docs/staging-smoke.md` | §14.4, F8 |
| `git cat-file -e origin/master:apps/web-v2/docs/staging-smoke.md` | §14.4 (branch-only) |
| `grep -rn "require('pg')\|require('dotenv')" src/` excluding `*.test.js` | **0 hits** → F1, §6.2 P1 |
| `grep -rln "\.query(" src/recommendation --include=*.js` excluding tests | **17 files** (15 outside `ingestion/`) → §6.2 P3 |
| `grep -rln "require('pg')" src/recommendation --include=*.js` | **23** test files → §6.2 P1 |
| recursive per-stage count of non-test `.js` files / lines / `.query(` files / test files | §6.1: **80 modules, 18 297 lines** |
| **SCC analysis**: Tarjan over resolved relative `require` edges among the 80 non-test modules | **80 modules, 220 edges, 80 SCCs, 0 SCCs > 1 module** → §6.3, F2 |
| cross-stage edge tally from the same graph | §6.3 table |
| inbound-edge count to `ingestion/` | **0** → §12.1 |
| `grep -n "require(" scripts/generate-presets.js` | `pg`, `dotenv`, `dotenv/config`, `../apps/api/src/{repository,engine,meta}` → §3.3 |
| `cat apps/api/Dockerfile`; `sed -n '18,40p' apps/api/src/db.js` | §13.1, §13.2 |
| `sed -n '1,80p' apps/api/test/unit/import-boundary.test.js` | §9.3, §13 |
| `ls -1 scripts/check-*.js` | §8.3 gate inventory |

**Not run for Revisions 1-3, and therefore not claimed there:** `npm run test:unit`, `test:scripts`, `test:api`, `test:api:db`, `verify:replay`, `eval:scenarios`, any `check-*` gate, and any database connection. Suite counts from earlier documents are **not** restated as current fact.

**Revision 4 re-measurements (2026-11-11, `master` = `e62c816`, read-only):** `git grep -l "require(.*lib/db-url" -- "scripts/*.js"` → **18** top-level scripts, all `require` it; `git grep -n "require(.*db-url" -- "scripts/lib/*.js"` → 3 modules (plus `db-url.test.js`) and one comment-only citation (`og01-catalog.js:28`); `git show --stat ffd336c` → **31** files; `git ls-tree -r --name-only origin/master -- packages` → one document, no manifest; `Test-Path` on `docs/API.md`, `docs/ARCHITECTURE.md` and `docs/PIPELINE_DESIGN.md` → all absent, while `docs/api/CONTRACT.md`, `docs/engine/ARCHITECTURE.md`, `docs/ingestion/PIPELINE_DESIGN.md` and `packages/recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md` → all present. Gates run: `node scripts/gen-decision-index.js --check` → OK; `node scripts/verify-docs.js --offline` → OK (9 checks PASS, live checks skipped); `git diff --check` → clean. `node --test "scripts/lib/*.test.js"` → **571** pass on this tree (Node 22.23.4), the measurement that resolves §23.4 C1.

**Revision 5 re-measurements (2026-11-11, `master` = `3e2f13e`, read-only):** `git show --name-only --format="" 7691b4f` → **55** files changed by PR #27; `git show --stat 7691b4f` → one new package directory with source and its own test, two manifest-only package directories, and path-only updates to consumers, Docker and hosting files; `git show origin/master:packages/database-guard/package.json` → `@morocco-pc/database-guard` `0.1.0`, `private`, `main: src/index.js`, no `dependencies`; `git ls-tree -r --name-only origin/master -- packages` → the eight files listed in §23.1; `git show origin/master:apps/api/Dockerfile` → copies `packages/database-guard/package.json` and `packages/database-guard/src`; `git grep -n "database-guard" -- apps/api/src scripts` → relative requires only (`../../../packages/database-guard/src` from the API, `../packages/database-guard/src` from scripts); `git grep -n "db-url" -- scripts/lib` → three comment-only mentions and no module; `git ls-tree -r --name-only origin/master -- .github/workflows` → `ci.yml` and `web.yml`, and neither runs `docker build`. Gates run on the documentation branch: `node scripts/gen-decision-index.js --check` → OK; `node scripts/verify-docs.js --offline` → OK; `git diff --check` → clean. **Not run:** any Docker image build — Docker is not installed in this environment, so the image-build proof is UNKNOWN, not PASS (§13.4).

**Revision 7 re-measurements (2026-11-15, `master` = `56cbb692`, read-only):** `git ls-tree -r --name-only 56cbb692 -- packages` → **fourteen** paths, exactly Revision 6's twelve plus `recommendation-core/test/hermetic-run.js` and `recommendation-core/test/hermetic-run.test.js`; `git rev-parse 2297aae` → PR #29's final head, and `git log -1 --format=%cI 56cbb692` → 2026-11-15T04:16:00+01:00, matching PR #29's `merged_at` (2026-11-15T03:16:00Z); `git show 56cbb692:packages/recommendation-core/src/index.js` → `module.exports = {}`; `git show 56cbb692:packages/recommendation-core/test/export-surface.json` → `"exports": []`; `git show 56cbb692:apps/api/src/engine.js` → the six `src/recommendation/**` barrel requires, so the API is not migrated; `git show 56cbb692:.github/workflows/ci.yml` → the `npm run test:core` and `node packages/recommendation-core/test/hermetic-run.js` steps. Gates run on this documentation branch: `node scripts/gen-decision-index.js --check` → OK; `node scripts/verify-docs.js --offline` → OK (all nine gates PASS, live checks skipped); `npm run test:core` → **101** tests, 99 pass, 0 fail, 2 skipped (the two platform file-symlink cases), measured after this branch was merged with `master` = `56cbb692` so it runs the merged harness including the hermetic fixtures; `node packages/recommendation-core/test/hermetic-run.js` → **PASS**; `git diff --check` → clean. **Not run:** any database-backed suite — no database contact.

**Revision 8 re-measurements (2026-11-15, `master` = `4ba4122`, Node 24.21.0 / npm 11.19.0, run locally on this branch after it was merged with `master`):** `git rev-parse origin/master` → `4ba4122`; `git log -1 --format=%cI 4ba4122` → 2026-11-15T04:43:13+01:00, matching PR #30's `merged_at` (2026-11-15T03:43:14Z); `git ls-tree -r --name-only 4ba4122 -- packages | wc -l` → **fourteen**, and `git diff --name-only 56cbb692 4ba4122 -- packages` → `packages/AGENTS.md` only, so PR #30 added no package path. Every count below is the `node --test` reporter's own total, not a sum of selected categories: `npm run test:unit` → **1284 tests, 1284 pass, 0 fail, 0 cancelled, 0 skipped**; `npm run test:scripts` → **750 tests, 750 pass, 0 fail, 0 cancelled, 0 skipped** (23 suites); `npm run test:database-guard` → **15 tests, 15 pass, 0 fail, 0 cancelled, 0 skipped** (4 suites); `npm run test:core` → **101 tests, 99 pass, 0 fail, 2 skipped, 0 cancelled** (15 suites — the two skips are the file-symlink cases this platform refuses with EPERM); `npm run test:api` → **193 tests, 193 pass, 0 fail, 0 cancelled, 0 skipped**; `node packages/recommendation-core/test/hermetic-run.js` → **PASS** (copied outside the repository, no reachable `node_modules`, `NODE_PATH` emptied), run separately from `test:core`. Doc gates on this tree: `node scripts/gen-decision-index.js --check` → OK; `node scripts/verify-docs.js --offline` → all gates PASS; `git diff --check` → clean. **Not run:** `npm run test:api:db` and every other database-backed suite — no database contact.

**Revision 12 re-measurements (2026-11-19, `master` = `43fd8c8`, Node 24.21.0 / npm 11.19.0, run on this branch after it was created from `origin/master`):** `git rev-parse origin/master` → `43fd8c8`, and `git log --oneline -3` → PR #41's merge, PR #41's branch head `73979f8` and PR #42's merge `c3186bc`; `git ls-tree -r --name-only 43fd8c8 -- packages | wc -l` → **68**, unchanged from the PR 4 branch row above. Every count is `node --test`'s own total: `npm run test:unit` → **982 tests, 982 pass, 0 fail, 0 skipped**; `npm run test:scripts` → **823 tests, 823 pass, 0 fail, 0 skipped** (23 suites); `npm run test:core` → **432 tests, 430 pass, 0 fail, 2 skipped** (21 suites). Doc gates on this tree: `node scripts/verify-docs.js --offline` → OK; `node scripts/gen-decision-index.js --check` → OK; `git diff --check` → clean. **Not run:** `test:api`, `test:api:db` and every other database-backed suite — no database contact.

**Revision 14 re-measurements (2026-11-19, branch `feat/core-scoring-extraction` = `4fc50f7`, Node 24.22.1, DB-free):** the branch was created from `master` = `1a9d8cf`; the characterization capture commit `8f585f5` is that commit's direct child, followed by the implementation commit `2dbe0f2` and the wiring commit `4fc50f7`. `git ls-tree -r --name-only 4fc50f7 -- packages | wc -l` → **91** (was 78 at `0bd7e6f`): `-- packages/recommendation-core/src` → **46** and `-- packages/recommendation-core/test` → **38**. By the §25.3 six rules, `src/recommendation/` holds **67 non-test `.js` = 36 implementation + 31 shims** (8 100 implementation + 361 shim lines), `packages/recommendation-core/src/` holds **46** files / **10 223** lines (`scoring/` 6 files / 1 945, of which the five moved modules are 1 860 and the hand-written barrel is 85), the legacy test tree holds **40** files, and the engine total is **82 non-test `.js` files / 18 323 lines / 17 DB-dependent** — one more file than `0bd7e6f` because `src/scoring/index.js` stayed in runtime and the core gained a hand-written barrel. Every count is `node --test`'s own total: `npm run test:unit` → **794 tests, 794 pass, 0 fail** (was 942; 148 scoring and retain tests moved into the core); `npm run test:scripts` → **823 tests, 823 pass, 0 fail**; `npm run test:core` → **622 tests, 620 pass, 0 fail, 2 skipped** (was 473: +148 moved, +1 `scoring` namespace assertion); `npm run test:api` → **193 tests, 193 pass, 0 fail**; `node packages/recommendation-core/test/hermetic-run.js` → **PASS**. Gates: `npm run verify:extraction` → **PASS, 42 / 42** moves blob-identical across the five batches with five characterization fixtures; `npm run verify:ownership -- --inventory=pr6 --base=1a9d8cfbe2b7f3a3f7a1a17e80919575d52c326e` → **184 tests / 402 assertions, unchanged** (6 moved, 3 stayed); `--inventory=pr5` → **40 tests / 123 assertions** (its formerly stayed `retain.test.js` is now a PR 6 row); `npm run check:characterization` and `:pr3`, `:pr4`, `:pr5`, `:pr6` → all behaviour-match; `npm run check:whitespace` → PASS; `node scripts/verify-docs.js --offline` → OK. **Not run:** `test:api:db` and every other database-backed suite — no database contact.
**Revision 13 re-measurements (2026-11-19, branch `feat/core-retention-extraction` = `0bd7e6f`, Node 24.21.0 / npm 11.19.0, DB-free):** the branch was created from `master` = `0f439e0`; the characterization capture commit `238ecbe` is that commit's direct child and the implementation commit `0bd7e6f` follows it. `git ls-tree -r --name-only 0bd7e6f -- packages | wc -l` → **78** (was 68 on `master`): `git ls-tree -r --name-only 0bd7e6f -- packages/recommendation-core/src | wc -l` → **40** and `-- packages/recommendation-core/test` → **31**. Blob identity proven from Git, not the working tree: for each of the five `retention` modules, `git rev-parse 0f439e0:<source>` equals `git rev-parse 0bd7e6f:<destination>`. Every count is `node --test`'s own total: `npm run test:unit` → **942 tests, 942 pass, 0 fail** (was 982; 40 retention tests moved into the core); `npm run test:scripts` → **823 tests, 823 pass, 0 fail**; `npm run test:core` → **473 tests, 471 pass, 0 fail, 2 skipped** (was 432: +40 moved, +1 `retention` namespace assertion); `npm run test:api` → **193 tests, 193 pass, 0 fail**; `npm run test:database-guard` → **15 tests, 15 pass, 0 fail**; `node packages/recommendation-core/test/hermetic-run.js` → **PASS**. Gates: `npm run verify:extraction` → **PASS, 37 / 37** moves blob-identical across the four batches with four characterization fixtures; `npm run verify:ownership -- --inventory=pr5 --base=0f439e0400c6814d0a21d4ab527c462aef0f5639` → **93 tests / 190 assertions, unchanged** (4 moved, 1 stayed); `npm run check:characterization` and `:pr3`, `:pr4`, `:pr5` → all behaviour-match; `npm run check:whitespace` → PASS; `node scripts/verify-docs.js --offline` → OK. **Not run:** `test:api:db` and every other database-backed suite — no database contact.

### 23.3 Key file references

| Claim | Reference |
|---|---|
| API reaches the engine only through six barrels | `apps/api/src/engine.js:28-33`; `apps/api/test/unit/import-boundary.test.js` |
| `pg` only in `db.js`; guard imported at `db.js:26` | `apps/api/src/db.js` |
| API has no manifest; Dockerfile is root-context | `git ls-files`; `apps/api/Dockerfile:1-14,33-40` |
| Assembly is pure (no DB) | `src/recommendation/assembly/index.js:1-58` |
| Mixed barrels | `candidates/index.js`, `filtering/index.js`, `scoring/index.js` (§6.4) |
| Runtime-only barrels (not mixed) | `offers/index.js`, `query/index.js`; the pure `offers/as-of.js` is extracted separately (§6.4) |
| Transaction ownership | `orchestrator/{run,snapshot,full-run,commit,swap-preview,swap-commit}.js` headers (§6.5) |
| `selectArchetypes` replaced `selectDiverseTop` in the full run | `orchestrator/full-run.js:1-11,78-95`; `ranking/index.js` |
| Guard exports and behaviour | `packages/database-guard/src/index.js`; the contract is asserted by `packages/database-guard/test/db-url.test.js` (seven exports, zero `require` calls) |
| Ingestion is not a stage | `src/recommendation/ingestion/index.js:1-13` |
| Contract snapshot and gates | `contract/openapi-1.10.0.json`; `openapi-snapshot.test.js`; `openapi-coverage.test.js` |
| Offer counts and coverage | `docs/OPEN_POINTS.md` R-01, R-30; `docs/DATA_STATE.md` |
| V2 staging smoke | `feature/v2-design:apps/web-v2/docs/staging-smoke.md` |

### 23.4 Contradictions recorded (not silently resolved)

| # | Document says | Tree says | Handling |
|---|---|---|---|
| C1 | `README.md` / `CONTEXT.md` report `test:scripts` "479" | **750** tests pass on this tree (`node --test "scripts/lib/*.test.js"`, 2026-11-15, Node 24.21.0: 750 pass / 0 fail / 0 cancelled / 0 skipped); the figure had a **third** current copy in `docs/ROADMAP.md`, which Revision 6 did not find | **resolved by measurement and CLOSED in Revision 8** — `README.md`, `CONTEXT.md` and `docs/ROADMAP.md` now all report **750**, and `CONTEXT.md` §5 also carries the two package suites it was missing (`test:database-guard` 15; `test:core` 101 tests, 99 pass / 2 skipped). `479` survives only where it is historical and is left as written: `docs/archive/HANDOFF_2026-11-07.md` and Decision 65's 2026-11-07 measurement in `docs/RECOMMENDATION_ENGINE_DECISIONS.md` |
| C2 | `README.md` "62 decisions" (at `a413f25`) | PR #24 removed the count from `README.md`; the log parses to 63 top-level `## Decision` headings + 5 nested = 65 global decisions, with 69 `Status:` lines (`verify:docs`), and the generated index is the lookup | **resolved by measurement** — the README states no count; `AGENTS.md` states the pinned range "Decisions 1-65" |
| C3 | `apps/web/README.md` and `lib/api/client.ts` name `openapi-v1.6.json` | no such file; `package.json` uses `v1.10` | recorded; V1 doc drift (§16.5). **CLOSED 2026-11-12:** both now name `contract/openapi-1.10.0.json` |
| C4 | `CONTEXT.md` §2 / `AGENTS.md` §5: "Engine stages are pure" | true of stage functions; mixed barrels export SQL-executing modules; 15 non-ingestion modules execute SQL | **resolved by §6.2** — the claim is about functions, not packages |
| C5 | `fly.toml` declares an always-on API service | `CONTEXT.md`/`ROADMAP.md` describe one Render origin | **UNKNOWN** which descriptor is authoritative (B6) |
| C6 | First revision: "18 production engine modules call `db.query`" | measured **17** (15 outside ingestion) | corrected in §6.2; the earlier number may have counted `ingestion/` differently |
| C7 | First revision: "24 test files require `pg`" | measured **23** | corrected in §6.2 P1 |
| C8 | First revision: "strongly connected graph" | 80/80 singleton SCCs | withdrawn (§6.3) |
| C9 | First revision: "V2 has never called a deployed API" | `staging-smoke.md` records a 2026-11-07 read-only smoke against the EU staging API | corrected (§14.4) |
| C10 | First revision: contract snapshot identical across branches "is one contract" | two physical copies, each gated against itself | corrected (§15.2) |
| C11 | `AGENTS.md` §1 (on `master` at `3e2f13e`) said "nothing from the package extraction is implemented" | the guard package exists, is consumed by the API and 18 scripts, and has its own CI step (PR #27) | **resolved in Revision 5** — `AGENTS.md` now states that the guard package boundary is implemented by PR #27 and that the recommendation extraction is not; the statement's intent is preserved, not deleted |
| C12 | `AGENTS.md` §1 and `packages/AGENTS.md` (on `master` at `3e2f13e`) described `recommendation-core` as a manifest plus an "empty source placeholder", and `recommendation-runtime` as an empty `src/` tree | `recommendation-core` carries the boundary harness (`src/index.js`, `test/{purity.test.js,purity-scanner.js,index.test.js,export-surface.json}`, `npm run test:core`) and `recommendation-runtime/src/` does not exist at all | **resolved in Revision 6** — both files now describe the harness and still state that no recommendation module has moved; the "not authorized" instruction is preserved, not deleted. **Re-verified in Revision 7** against `master` = `56cbb692`: the merged harness also carries `test/hermetic-run.js` and `test/hermetic-run.test.js`, and neither file claims a module has moved |

### 23.5 No-code-change confirmation

Revisions 1-4 changed exactly one file each: `docs/architecture/SYSTEM_ARCHITECTURE_AND_PROJECT_SEPARATION_RFC.md`. Revision 5 changes that file and one sentence of `AGENTS.md` (§23.4 C11). Revision 6 changes that file, the `packages/` paragraph and the verification row of `AGENTS.md`, and the package-status text of `packages/AGENTS.md`. Revision 7 changes the same three files (the RFC status line, §11.6, §19.1, §23.1-§23.5 and the closing note; the harness paragraphs of both agent files) — documentation only — and its branch also merges `master` = `56cbb692`; relative to `master` the diff is still only those three files. Revision 8 changes this file, `README.md`, `CONTEXT.md` and `docs/ROADMAP.md` — documentation only — and its branch also merges `master` = `4ba4122`, so it carries PR #30's Revision 7 corrections rather than reverting them; relative to `master` the diff is only those four files. It:

- does not modify any source file under `src/`, `apps/api/`, `apps/web/` or `apps/web-v2/`;
- does not add, remove or change any `package.json` or lockfile;
- does not add, remove or change any Dockerfile or `.dockerignore`;
- does not change any file under `.github/workflows/`;
- does not modify any migration, seed or the audit log;
- does not modify any test;
- does not merge, rebase or cherry-pick `feature/v2-design`;
- does not connect to a database, run a database script, or deploy anything;
- does not implement any part of the Option B split itself and begins no roadmap step; the guard package (step 3a) was implemented separately in PR #27, not by this revision.

Revision 10 changes this file, `CONTEXT.md` and `docs/development/extraction-workflow.md` — documentation only, relative to `master` = `07dfd22`. It modifies no source file, test, fixture, `package.json`, lockfile, `extraction-manifest.json` batch, workflow, migration, seed or audit line; it makes no database contact; it leaves `docs/OPEN_POINTS.md` untouched; and it begins no roadmap step. Its measurements are read-only Git commands recorded in §25.3, and the CRLF bytes of every unchanged line are preserved (§25.6).

---

## 24. Appendix — decisions and terms this RFC builds on

| Reference | Relevance here |
|---|---|
| Decision 17 (17.5) | the read snapshot and the "no transaction control in `run`" rule — §6.5 |
| Decision 19 (19.1/19.2) | the write transaction and its two guards — §6.5 |
| Decision 26 / 45 | the compatibility rule table that makes `compatibility/` the cleanest core extraction (§11.2) |
| Decision 27 | cheapest-per-role reservation — engine behaviour frozen by this RFC |
| Decision 34 / 65 | offer identity and provenance-first selection — the boundary ingestion owns (§12) |
| Decision 35 | seed-offer freshness waiver — B1 |
| Decision 36 | the API as a thin layer owning no engine logic (§13) |
| Decision 41 | `selectArchetypes` replaces `selectDiverseTop` as the pre-persistence showcase — §6.5, §14 |
| Decision 46 | pass facts (`engine_version`, `budget_floor`, `strategy_key`) — the schema/code coupling §17.3 cites |
| Decision 47 | `catalog_version` content digest — the reason one database, not four (§4.3) |
| Decision 55 / 56 | swap preview and committed swap — §6.5, §14.2 |
| Decision 62 / 63 | scoring-model pin — separate from the contract version (§15.5) |
| R-01, R-16, R-27, R-30 | real-offer coverage, no authentication, preset-shelf invalidation, per-role coverage — §11A, §12.5, B1, B5 |

---

## 25. Revision 10 — post-merge reconciliation (2026-11-18)

**Scope: documentation reconciliation only.** This section corrects the *current-status* statements after two merges, appends the fresh inventory measurements of §25.3, and keeps every earlier revision's own text as written. It changes no source, test, manifest, workflow, migration, seed, evidence or configuration file.

### 25.1 The two merges this revision follows

| PR | State | Merge commit | Evidence |
|---|---|---|---|
| #36 — step 4B PR 3, the pure Engine 3 `assembly` batch (`step-4b-pr3`) | **MERGED** 2026-11-18 | `57bca1cfe412ff6a2f3d8e3fe7423cb9d25e6317` | true merge commit; parents `de659ad` (base) and `2c19a87` (branch head); the merged tree is identical to the branch head's tree, so `git diff 2c19a87 57bca1c` is empty |
| #37 — metadata-only correction to `packages/recommendation-core/package.json` | **MERGED** 2026-11-18 | `07dfd22be7170ede689da1a1637cfab1645cb209` | merge commit; parents `57bca1c` and `098aee3`; `git diff 57bca1c 07dfd22` touches exactly one file, +1/−1, the `description` line |

`master` is `07dfd22`. Revision 9 was written while PR #36 was still open for review (head `d4e7e5f`), which is why its status line, §11.6, §19.1 row 4 and the closing note say "open for review" and "moves". Those *current-status* sentences are corrected forward in this revision. The Revision 9 log entry and the §23.1 Revision 5/7 evidence rows are left as written; the §23.1 Revision 8 and Revision 9 rows keep their measurements, dates and commit references, and only their status labels changed from **current** to **historical** — the `master` row for `4ba4122` and the `packages/` row for `de659ad` — because those commits are no longer the head (§25.4).

### 25.2 What is merged now, and what remains (CURRENT)

`packages/recommendation-core/` is part of `master`'s engine, not a branch: the §11.6 boundary harness plus the five extraction batches behind it. **Six namespaces are on `master` as of 2026-11-19.** `ranking` had merged earlier, PR #41 as `43fd8c8` (Revision 12); `retention` was implemented on the step 4B PR 5 branch (PR #44, `feat/core-retention-extraction`, batch `step-4b-pr5`, baseline `0f439e0`), which **merged on 2026-11-19 as `1a9d8cfbe2b7f3a3f7a1a17e80919575d52c326e`**, so `master` carries the Engine 2D implementation at `packages/recommendation-core/src/retention/` and identity shims at the five old paths. **Revision 14 (2026-11-19):** step 4B PR 6 (batch `step-4b-pr6`, baseline `1a9d8cf`, branch `feat/core-scoring-extraction`, capture `8f585f5`, implementation `2dbe0f2`, wiring `4fc50f7`) implements `scoring` on that branch and is **open as PR #45, not merged**, so `master` still does not carry it. The entry point `src/index.js` publishes the namespaces below, pinned key by key in `test/surface.test.js` and recorded in `test/export-surface.json`; the `Ships on` column is the distinction this section exists to make, and a row marked `master` is the only kind that describes the merged tree:

| Namespace | Batch | Modules in the core | Ships on |
|---|---|---|---|
| `candidates` | `step-4b-pr2` (PR #32, merged 2026-11-16 as `aa7b398`) | 6 | `master` |
| `compatibility` | `step-4b-pr2` | 14 | `master` |
| `filtering` | `step-4b-pr2` | 3 | `master` |
| `assembly` | `step-4b-pr3` (PR #36, merged 2026-11-18 as `57bca1c`) | 7 | `master` |
| `ranking` | `step-4b-pr4` (baseline `07dfd22`, PR #41, merged 2026-11-19 as `43fd8c8`) | 4 | `master` |
| `retention` | `step-4b-pr5` (baseline `0f439e0`, PR #44, merged 2026-11-19 as `1a9d8cf`) | 5 | `master` |
| `scoring` | `step-4b-pr6` (baseline `1a9d8cf`, branch `feat/core-scoring-extraction`, wiring commit `4fc50f7`, PR #45) | 6 core files — the 5 moved pure modules plus a hand-written pure `index.js` barrel; the mixed runtime barrel remains at `src/recommendation/scoring/index.js` | PR #45 — OPEN, not merged |

On `master`, every old path under `src/recommendation/**` for all six namespaces is an identity re-export shim rather than the implementation. In Revision 13 this paragraph described `retention` as branch-only and `master` as `43fd8c8`; that wording is kept in the Revision 13 record as what was true before 2026-11-19. On branch `feat/core-scoring-extraction` the same is true of `scoring`: `packages/recommendation-core/src/scoring/` holds the five byte-identical modules plus a hand-written 14-key barrel and `src/recommendation/scoring/*.js` are identity shims, but nothing of that batch exists on `master` yet. **What has not changed on `master`:** the loaders, `explanation` and `offers/as-of` have not moved, `packages/recommendation-runtime/` holds only its manifest and `docs/LOADERS_AND_TRANSACTIONS.md`, `apps/api/src/engine.js` still imports the six `src/recommendation/**` barrels, and §19 step 4 is **in progress, not complete** — the six namespaces above are what it has moved so far on `master`, and the branch adds a seventh. **Revision 15 (2026-11-20):** step 4B PR 6 **merged** (PR #45 as `0f86f53`), so `master` = `45133d5` publishes seven namespaces; step 4B PR 7 (batch `step-4b-pr7`, baseline `2683713`, 5 files byte-identical, `blob-identical: 47 / 47` across the six batches) is a **BRANCH** (`feat/core-explanation-extraction`) that publishes `explanation` and `offers` as the eighth and ninth namespaces and adds the §11.4 `exports` map, behind identity shims at the five old paths. The runtime loaders, the three mixed barrels and `apps/api/src/engine.js`'s barrel imports are unchanged, so §19 step 4 stays **in progress until PR 7 merges** and step 5 has not started.

**Revision 16 (2026-11-24):** the previous sentence is superseded. Step 5 **has started**: nine PRs are merged — the ledger with its full SHAs is the Revision 16 paragraph at the head of this document and §19.1 row 5 — and **15 of the 23** runtime-target modules now live in `packages/recommendation-runtime/src/` behind identity shims, with `src/index.js` publishing only `loaders`. The **8 remaining** are the `src/recommendation/orchestrator/` files (seven modules plus the barrel; §11.2), which W3 moves. `apps/api/src/engine.js` still imports the `src/recommendation/**` barrels, so step 6 has not started. The nine namespaces and §11.4's `exports` map are unchanged.

### 25.3 Inventory measurement — 2026-11-18 snapshot (base `07dfd22`, historical)

**Historical snapshot, preserved as written.** Measured against `master` = `07dfd22` with read-only Git commands, so another engineer can reproduce every figure without touching the working tree. `07dfd22` was `master` on 2026-11-18 and is **not** the current base: that was `e8d5af9`, measured in §25.3.1, and `master` is now `43fd8c8`, the PR #41 merge. Nothing in this section is a statement about today's `master`.

| Rule | Definition |
|---|---|
| Population | `git ls-tree -r --name-only <sha> -- <dir>` — tracked blobs at that commit, never the working tree, so ignored or generated files cannot enter a count |
| Implementation file | a path ending `.js` that is neither `*.test.js` nor under `test/`; documentation, JSON, fixtures and configuration are excluded |
| Line count | `git show <sha>:<path> \| wc -l` (newline count), summed over the population |
| DB-dependent | an implementation file whose committed blob contains the literal `.query(` — the §6.2 P3 rule |
| Identity shim | an implementation file whose committed blob requires `packages/recommendation-core`; counted separately and never as an implementation |
| Two trees, never merged | `src/recommendation/` and `packages/recommendation-core/src/` are counted separately, because a moved module cannot exist in both; shims are excluded from the implementation total |

| Tree | Files | Lines | DB-dependent |
|---|---|---|---|
| `src/recommendation/` — implementation + identity shims | 67 non-test `.js` = **50 implementation + 17 shims** | 12 335 implementation + 210 shim | **17** (15 outside `ingestion/`), all implementation, no shim |
| `packages/recommendation-core/src/` — `assembly` 7 / `candidates` 6 / `compatibility` 14 / `filtering` 3 / root `index.js` 1 | **31** | **5 895** (2 408 / 656 / 1 853 / 948 / 30) | **0** |
| `packages/recommendation-core/test/` | 22 paths, 19 of them `.js` and 17 of those `*.test.js`, plus `export-surface.json` and two characterization fixtures | 6 512 `.js` lines | n/a |
| Legacy tests `src/recommendation/**/*.test.js` | 53 | — | — |
| `packages/` (all four package directories) | **60** paths = `AGENTS.md` 1 + `database-guard` 3 + `recommendation-core` 54 + `recommendation-runtime` 2 | — | — |

**Engine total at `07dfd22`: 81 non-test `.js` files and 18 230 lines, 17 DB-dependent files** — the 50 legacy implementation files (12 335 lines) plus the 31 core `src/` files (5 865 lines of moved modules and 30 lines of package entry point). The legacy tree's non-test total of 67 is *not* that number: 17 of those entries are shims.

**Historical, preserved deliberately.** §6.1's table was measured on `master` = `a413f25` and reports **80 non-test modules and 18 297 non-test lines**. It stays as that revision's record. The 67-line difference is ordinary code change between `a413f25` and `07dfd22`, not an extraction effect: every moved module is byte-identical to its batch baseline under `npm run verify:extraction`, and the per-stage rows in §6.1 no longer describe today's `src/recommendation/`, which now holds 17 shims next to 50 implementation files.

### 25.3.1 Inventory measurement — PR #41 base snapshot (2026-11-19, `e8d5af9`; historical)

Re-measured read-only by the **same six rules** as §25.3, against PR #41's base: `master` = `e8d5af9` (the merge of PR #40, verified as the pull request's `baseRefOid`). Every figure below comes from the documented commands (`git ls-tree -r --name-only <sha>` for the population, `git show <sha>:<path> | wc -l` per file), and the same measurement reproduces §25.3's `07dfd22` row exactly — 67 = 50 + 17, 12 335 + 210, 31 / 5 895, 6 512, 53, 60, 81 / 18 230 / 17 — which is what makes the differences below measurements rather than assumptions.

| Tree | Files | Lines | DB-dependent |
|---|---|---|---|
| `src/recommendation/` — implementation + identity shims | 67 non-test `.js` = **50 implementation + 17 shims** | 12 335 implementation + 210 shim | **17** (15 outside `ingestion/`), all implementation, no shim |
| `packages/recommendation-core/src/` — `assembly` 7 / `candidates` 6 / `compatibility` 14 / `filtering` 3 / root `index.js` 1 | **31** | **5 895** (2 408 / 656 / 1 853 / 948 / 30) | **0** |
| `packages/recommendation-core/test/` | **23** paths, 19 of them `.js` and 17 of those `*.test.js`, plus `export-surface.json` and **three** characterization fixtures | 6 512 `.js` lines | n/a |
| Legacy tests `src/recommendation/**/*.test.js` | 53 | — | — |
| `packages/` (all four package directories) | **61** paths = `AGENTS.md` 1 + `database-guard` 3 + `recommendation-core` **55** + `recommendation-runtime` 2 | — | — |

**Engine total at `e8d5af9`: 81 non-test `.js` files and 18 230 lines, 17 DB-dependent files** — identical to `07dfd22`.

**What changed between the two bases, measured.** The implementation trees did not move: the same 50 legacy implementation files (12 335 lines), the same 31 core `src/` files (5 895 lines), the same 17 DB-dependent files (15 outside `ingestion/`), the same 53 legacy tests and the same 81 / 18 230 / 17 total. The two differences are in the **non-implementation** population and are a path change, not a module move: `packages/recommendation-core/test/` gained one path (22 → **23**) and `packages/` gained the same one (60 → **61**, `recommendation-core` 54 → **55**). It is `test/fixtures/pr4-characterization.json`, added by `5ff78a7` ("test(core): freeze the ranking surface before anything moves", merged as PR #39), with PR #38 (documentation) and PR #40 (a `.gitignore` entry) in the same range. One fixture file still changed a published count, which is why this row was re-measured rather than carried forward.

**The PR branch was not the base.** Measured with the same rules on `feat/core-ranking-extraction` = `1581581`, that branch gave `src/recommendation/` 67 non-test `.js` = **46 implementation + 21 shims** (11 375 + 253 lines), `packages/recommendation-core/src/` **35** files / **6 856** lines (`ranking` 4 / 960, root `index.js` 31), `packages/recommendation-core/test/` **26** paths (22 `.js`, 20 `*.test.js`, 7 744 `.js` lines), legacy tests **50**, `packages/` **68** paths, and 81 non-test files / 18 231 lines / 17 DB-dependent. Those figures described the branch when this section was written; PR #41 merged as `43fd8c8` on 2026-11-19, whose tree `4c005f39` is identical to the branch head `73979f8`'s tree, so they now describe `master` and the table above describes PR #41's base. Re-measured on `43fd8c8` with the same rules: 67 non-test `.js` = **46 implementation + 21 shims** (11 375 lines), core `src/` **35** / **6 856**, core `test/` **26** paths (22 `.js`, 20 `*.test.js`), `packages/` **68**, 17 DB-dependent.

**Line endings:** this section was appended to a CRLF file with 0 bare LF and 0 stray CR after writing, matching the convention §25.6 records.

### 25.3.2 Inventory measurement — PR 5 branch snapshot (2026-11-19, `0bd7e6f`; historical)

Re-measured read-only by the **same six rules** as §25.3, against the PR 5 implementation commit rather than `master`, because the batch is unmerged: `feat/core-retention-extraction` = `0bd7e6f`, whose parents lead back to the baseline `0f439e0` through the characterization capture commit `238ecbe`. The same measurement reproduces the `43fd8c8` figures below as the starting point, which is what makes the differences measurements rather than assumptions.

| Tree | Files | Lines | DB-dependent |
|---|---|---|---|
| `src/recommendation/` — implementation + identity shims | 67 non-test `.js` = **41 implementation + 26 shims** | 9 960 implementation + 306 shim | **17** (15 outside `ingestion/`), all implementation, no shim |
| `packages/recommendation-core/src/` — `assembly` 7 / `candidates` 6 / `compatibility` 14 / `filtering` 3 / `ranking` 4 / `retention` 5 / root `index.js` 1 | **40** | **8 273** (2 408 / 656 / 1 853 / 948 / 960 / 1 415 / 33) | **0** |
| `packages/recommendation-core/test/` | **31** paths, 26 of them `.js` and 24 of those `*.test.js`, plus `export-surface.json` and **four** characterization fixtures | 8 743 `.js` lines | n/a |
| Legacy tests `src/recommendation/**/*.test.js` | 46 | — | — |
| `packages/` (all four package directories) | **78** paths = `AGENTS.md` 1 + `database-guard` 3 + `recommendation-core` **72** + `recommendation-runtime` 2 | — | — |

**Engine total at `0bd7e6f`: 81 non-test `.js` files and 18 233 lines, 17 DB-dependent files** — the 41 legacy implementation files (9 960 lines) plus the 40 core `src/` files (8 273 lines).

**What changed between `43fd8c8` and this branch, measured.** The legacy implementation tree lost exactly the five retention modules: implementation **46 → 41** files (11 375 → 9 960 lines, the 1 415 moved lines) and identity shims **21 → 26** files (253 → 306 lines, the five new shims at 53 lines total). The core `src/` tree gained the same five modules (**35 → 40** files, 1 415 lines) plus **2** lines on the root `index.js` (31 → 33: the `require('./retention')` line and the namespace key), so 5 895 + 1 415 + 2 = **8 273**. Four tests moved (`50 → 46` legacy, core `test/` 26 → **31** paths with the fourth characterization fixture), and `packages/` grew 68 → **78** (the five modules, four moved tests and one fixture). The DB-dependent count is unchanged at **17**, because no moved module executes SQL. Blob identity for all five modules is recorded in §23.2.

**Branch, not `master`.** Every figure above describes `0bd7e6f` on `feat/core-retention-extraction`; `master` remains `43fd8c8` and is still described by §25.2's `master` rows and by the Revision 12 figures in §23.2.

**Line endings:** this subsection was appended with CRLF and 0 bare LF, matching §25.6.

### 25.4 Historical record — what Revision 10 corrected from Revision 9

**This table is a historical record of the Revision 9 → Revision 10 corrections, preserved as written. It is not a summary of the current revision, and none of its rows states this revision's status.** For the current state see §25.2 (which namespaces ship on `master`); §25.3 and §25.3.1 are dated measurements, not statements of today's head. The Revision 11 record is the Date paragraph and §25.2, and the Revision 12 record is the Date paragraph, §25.2, §23.1 and §23.2; the Revision 13 record is the Date paragraph, §25.2, §23.1, §23.2 and §25.3.2; the Revision 14 record is the Date paragraph, §19.1 row 4, §25.2, §23.1 and §23.2.

| Location | Revision 9 wording | Revision 10 |
|---|---|---|
| Status line (§0 header) | "revised 2026-11-18 (Revision 9)"; "step 4B PR 3 **moves** … (PR #36, **open for review** when this revision was written, head `d4e7e5f`)" | Revision 10; PR #36 **merged** 2026-11-18 as `57bca1c`, PR #37 merged as `07dfd22`; four namespaces on `master` |
| Revision log (Date paragraph) | ended at Revision 9 | Revision 10 entry appended; Revisions 3-9 untouched |
| §6.1 totals | 80 modules / 18 297 lines, presented as current | same figures, explicitly the `a413f25` measurement, with a pointer to §25.3 |
| §11.6 | "PR #36, open for review when Revision 9 was written"; "PR 3 moves" | "PR #36, merged 2026-11-18 as `57bca1c`"; "PR 3 moved" |
| §19.1 row 4 | "PR #36 (head `d4e7e5f`) moves `assembly`"; step in progress | "merged 2026-11-18 as `57bca1c`"; still **in progress** — the remaining stages have not moved |
| §23.1 `master` table | last row `master` (**current**, Revision 8) = `4ba4122` | that row relabeled **historical**, and a `master` (**current**, Revision 10) row appended: `07dfd22` |
| §23.1 `packages/` inventory | last row `packages/` on `de659ad` (**current**, Revision 9), 52 paths | that row relabeled **historical**, and a current row appended for `07dfd22`: 60 paths |
| §23.2 | commands through Revision 9 | heading covers Revisions 1-10; Revision 10 measurement row appended |
| §23.5 | no-code-change confirmation through Revision 8 | Revision 10 confirmation appended |
| Closing note | "PR #36 (head `d4e7e5f`) **moves** `assembly`" | "PR #36 (merged 2026-11-18 as `57bca1c`) **moved** `assembly`" |

### 25.5 Preservation and no-code-change confirmation

- Revisions 1-9 are **preserved**: their log entries and the §6.1 table values are kept verbatim, and every §23 evidence row keeps its figures, dates and commit references. Revision 10 is appended as a new section and never inserted into a historical one, and it supersedes nothing retroactively — it records what happened after Revision 9 was written. The only edits to prior evidence rows are the two status labels §25.4 lists — the §23.1 `master` row for `4ba4122` and the §23.1 `packages/` row for `de659ad`, changed from **current** to **historical** because those commits are no longer the head; their figures and dates are untouched.
- Historical snapshots stay distinguishable from current measurements: §6.1 carries the `a413f25` figures with an explicit note; §23.1 keeps every earlier `packages/` and `master` inventory as its own dated row; §25.3 is kept as the 2026-11-18 snapshot and §25.3.1 is the only table that states today's per-tree numbers.
- Files changed by Revision 10: this file, `CONTEXT.md` and `docs/development/extraction-workflow.md` — **documentation only**. It does not modify any source file under `src/`, `apps/api/`, `apps/web/` or `packages/`; does not add, remove or change any `package.json`, lockfile, test, fixture or `extraction-manifest.json` batch; does not change `.github/workflows/`; does not modify a migration, seed or the audit log; does not connect to a database; and begins no roadmap step, including the ranking extraction.
- Line endings: `docs/**` and `CONTEXT.md` are CRLF; the bytes of every unchanged line are preserved (§25.6).

### 25.6 Line-ending verification

All three files use CRLF line endings in the working tree. Revision 10 was appended to this RFC. The edit is applied by
reading the file as UTF-8, refusing to proceed if any bare LF is present, replacing whole `\r\n`-terminated spans, and
writing back `\r\n`-terminated lines only. Nothing was normalized, reflowed or passed through a formatting tool.

Working-tree bytes and Git blobs must be distinguished: `.gitattributes` sets `text eol=crlf` for `docs/**` and
`CONTEXT.md`, so the working tree is CRLF while Git stores the same files as LF-normalized blobs with no CR byte at all.
The counts below therefore describe the working tree, not the blobs.

The verification is a byte-level scan of the final working-tree content, run after the last edit to these files: it counts
every LF byte, the LF bytes immediately preceded by CR, the bare LF bytes, and stray CR bytes not followed by LF. All three
files have 0 bare LF and 0 stray CR. The CRLF counts are `CONTEXT.md` 179/179, `docs/development/extraction-workflow.md`
367/367 and this file 1917/1917 (CRLF lines / LF bytes).


---

## 26. Appendix — EU operational facts, 2026-11-23 snapshot

**This appendix is not architecture status.** Nothing here is a claim about what the extraction has or has not done, and nothing here changes an approved decision. It is a dated snapshot of the EU environment's **recorded** operational facts, kept out of the status line and out of §19 so a reader can always tell the two apart. Every row carries its own source and its own date; where the source predates this snapshot, the row says so instead of presenting it as today's measurement.

**No database was contacted to produce this appendix** (T0, §19.2). It records what is already written down. A fact whose source is older than 2026-11-23 is labelled with the date it was actually measured.

| Fact | Value | Source | Measured / recorded |
|---|---|---|---|
| EU target, as `CONTEXT.md` names it | `TARGET_DATABASE_URL` | `CONTEXT.md` §3 environments table | 2026-11-02, re-read 2026-11-23 |
| EU credential key, as `.env.eu` defines it | `EU_DATABASE_URL` — pooled, the only key in that gitignored file | `DEVELOPMENT_NOTES.md`; PR #62 merged 2026-11-23 as `c9707d1` (commit `cd0bd56`) | 2026-11-23 |
| EU database | `morocco-pc-eu`, `aws-eu-central-1` | `CONTEXT.md` §3 | 2026-11-02, re-read 2026-11-23 |
| EU host digest | `db:2d66f26d7ddc` | §11A.2 | measured 2026-11-10 |
| EU catalogue | 113 products, 84 families, 24 variants, 114 offers, 319 assessments, 7 `scoring_model` rows (6 ACTIVE) | `CONTEXT.md` §3 | 2026-11-02 |
| Served model | `launch-v2@2.4.0`, pinned by `SCORING_MODEL_PIN` in `render.yaml` (Decision 63, PROVISIONAL) | `CONTEXT.md` §3 | 2026-11-02 |
| API role | `morocco_pc_api`, column-scoped grants, `check-deployed-role` **PASS** | `CONTEXT.md` §3; §15.4 | 2026-11-02 |
| Deployed origin | `https://morocco-pc-api-eu.onrender.com` — Render Free, Frankfurt, created from `render.yaml` 2026-11-02; sleeps after ~15 idle minutes (R-08) | `CONTEXT.md` §3 | 2026-11-02 |
| Catalogue identity | `check-catalog-identity` **PASS**, 113 of 113 on all three environments | `CONTEXT.md` §3 | 2026-11-02 |
| Migration ledger | 23 of 23 applied on shared, TEST and EU | `CONTEXT.md` §2, §3.1 | 2026-11-02 |

**The naming point this snapshot exists to fix.** Two different names describe one target, and they are not interchangeable. `TARGET_DATABASE_URL` is how `CONTEXT.md` labels the EU environment and the generic `env:NAME` shape the gates accept; `EU_DATABASE_URL` is the key the gitignored `.env.eu` actually defines, and it is the name the EU recipes and the ingestion CLIs pass (`--target=env:EU_DATABASE_URL`). PR #62 (merged 2026-11-23 as `c9707d1`) recorded that distinction, because prose had begun to imply `.env.eu` contained `TARGET_DATABASE_URL`, which reads as a missing variable to anyone following a recipe. Neither name is a secret and neither value appears in this document.

*This RFC records the owner's approval of A1-A6 (2026-11-11) and stays PROPOSED for everything else: B1-B8 are open and independent review remains welcome. Option B is the selected direction. **The database-guard package boundary (step 3a) is implemented** — PR #27 (`7691b4f`) moved the guard to `packages/database-guard/` and merged as `3e2f13e` (§9.4) — and **the `recommendation-core` boundary harness is implemented and merged** (step 4B PR 1, PR #29: `2297aae` as `56cbb692`, 2026-11-15; §11.6), and **four extraction batches now sit behind it** — PR #32 (`aa7b398`, 2026-11-16) moved the pure `candidates`, `compatibility` and `filtering` modules and PR #36 (merged 2026-11-18 as `57bca1c`) moved `assembly` and step 4B PR 4 (merged 2026-11-19 as `43fd8c8`) moved `ranking`, so `master`'s core entry point publishes five namespaces over identity re-export shims at the old `src/recommendation/**` paths, and step 4B PR 5 (branch `feat/core-retention-extraction`, batch `step-4b-pr5`, baseline `0f439e0`, implementation commit `0bd7e6f`) moves `retention` on that branch, which would publish a sixth — **Revision 16 (2026-11-24) supersedes the counts in that sentence:** step 4 is complete (PR #49, `2569647`), so `master` publishes nine namespaces, and step 5 has moved 15 of the 23 runtime-target modules behind identity shims, leaving the 8 `orchestrator/` files; the API migration (step 6) and the remaining roadmap work (steps 3b, 7-12) remain unimplemented. PR #23 was merged on 2026-11-11 (`0bcb6e3`) as the record's publication and implemented none of the proposed extraction. No application, database, test, workflow, manifest or deployment artefact was changed by this revision.*
