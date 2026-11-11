# System Architecture & Project Separation RFC

**Repository:** `ibrahim-lahribli/morocco-pc`
**Status:** PROPOSED — revised 2026-11-11 (Revision 4). **A1-A6 APPROVED by the repository owner on 2026-11-11** (§21.1); **Option B (separate `recommendation-core` and `recommendation-runtime` packages) is the selected direction** (owner decision, recorded in §1.5). **B1-B8 remain open.** The decision record is approved; **nothing from the package extraction is implemented**. PR #23 — the proposal itself — **was merged on 2026-11-11** (`0bcb6e3`); merging it published the record as a document and implemented none of it.
**Date:** 2026-11-11 (first revision: 2026-11-10). **Revision 3 (2026-11-11):** §21.3 records four owner-confirmed implementation decisions (D1-D4), and §9.2, §9.4, §10.1, §13.4, §15.4 and §19 carry the corrections they exposed: the guard's seven-export interface, the API pool test's ownership, the absent restore-point predicate, the four named manifests, path-only Docker/hosting updates, the Step 7 V2 deferral and the Git-ref compatibility baseline. **Revision 4 (2026-11-11):** current-state corrections only — the script-consumer count in §9.4, the duplicate §15.4 numbering, the since-merged state of PR #23, the documentation paths moved by PR #24 (§16.7), and the §23.4 contradictions register. No recommendation behaviour, contract, schema or approved decision changed.
**Measurement baseline (Revisions 1-3):** `master` = `a413f25` ("Merge pull request #18 from ibrahim-lahribli/freebuff/launch-v2-2.5.0-decay-off") — **historical**; it is not the current head.
**Secondary input:** `feature/v2-design` = `3bc0605` (read, never merged or rebased for this RFC)
**RFC branch:** `architecture/system-separation-rfc` at `9297034` (merged as PR #23 on 2026-11-11; the branch was deleted after merge). Revision 4 corrections are on `docs/rfc-accuracy-corrections`.
**Deliverable:** documentation and analysis only. No source, manifest, lockfile, workflow, migration, seed, Dockerfile or test file was modified by this revision. Revision 4 re-measured its corrected claims read-only on `master` = `e62c816`; it made no database contact.

---

## 0. How to read this document

Every material assertion carries one of six labels. They are not decoration: they are the difference between what the code does today and what this RFC thinks it should do.

| Label | Meaning |
|---|---|
| **CURRENT** | Verified in the tree at `a413f25` (or on `feature/v2-design` at `3bc0605` where stated) by reading the file, running a read-only command, or reading git history. The evidence is cited. Revision 4 re-verifies only the claims it corrects, on `master` = `e62c816`. |
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
| F4 | **`apps/api` cannot be installed, built or deployed on its own.** It has no `package.json`; its Dockerfile requires the repository root as build context and copies `src/` and `scripts/lib/db-url.js` beside it. | `apps/api/Dockerfile:1-12,33-40`; `render.yaml` `dockerContext: .` |
| F5 | **`apps/api` depends on a file outside every application and outside the engine**: the write-target guard. That file lives in a directory with **no `package.json`**, so the previously proposed `"db-guard": "file:../../database/tooling"` dependency could not be installed at all. | `apps/api/src/db.js:26`; `git ls-files \| grep package.json` → root + `apps/web` only (master) |
| F6 | **Ingestion is already a separate application wearing an engine directory's clothes.** 8 non-test modules, its own barrel, its own CLI, and **zero inbound edges** from any stage (measured, §6.3). Its own header says it "is NOT an engine stage". | `src/recommendation/ingestion/index.js:1-13`; Tarjan edge scan |
| F7 | **There is one contract document pattern, but two physical copies across branches.** `apps/api/test/unit/openapi-v1.10.json` is read by V1's generators and gates on `master`; V2 carries its own copy of the same file on `feature/v2-design`, and each frontend's `check:api-types` compares generated types against its own copy. Identical content today; no gate would detect divergence tomorrow. | `apps/web/package.json`, `apps/web-v2/package.json`, both workflows; §15.2 |
| F8 | **V2 is a foundation, and one manual read-only staging smoke exists.** V2 has 3 route files and performs only GETs; it has no catalogue route, results route, swap, saved builds, and **no deployment configuration**. Its `docs/staging-smoke.md` records a **manual, ordinary-browser, read-only** smoke on 2026-11-07 (7 reads per locale, all HTTP 200, 0 POST) against the EU staging API. That is not a deployed V2 frontend and not an automated E2E test. | §14.4; `feature/v2-design:apps/web-v2/docs/staging-smoke.md` |
| F9 | **The programme is single-tenant and unauthenticated by decision, not by omission.** No auth library, no session, no account; the API contract documents "No authentication or accounts" as a deliberate property (R-16 ACCEPTED). | `docs/api/CONTRACT.md`; `docs/OPEN_POINTS.md` R-16 |
| F10 | **The shared operational machinery is the real coupling.** `scripts/lib/` holds the DB write guard, the target digests, the restore-point argument validation, the model pin and the generated-doc check — every one consumed by more than one layer. | `apps/api/src/db.js:26`, `scripts/*.js`, `npm run test:scripts` |

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
| 16 | A1-A6 recorded as `AWAITING OWNER APPROVAL`. | **A1-A6 approved by the repository owner on 2026-11-11**; the approval record, its scope and its exclusions are in §21.1. B1-B8 remain open. The approval did not merge PR #23; that PR was merged separately on 2026-11-11 (`0bcb6e3`) to publish the record. | Owner approval recorded; not implemented. |

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
| API container | `apps/api/Dockerfile` (build context = repository root) | builds `src/` + `apps/api/` + `scripts/lib/db-url.js` |
| API hosting | `render.yaml` (`morocco-pc-api-eu`, Frankfurt, `runtime: docker`, `healthCheckPath: /v1/health`, `autoDeployTrigger: off`) | one recorded origin: `https://morocco-pc-api-eu.onrender.com` |
| API alternative | `fly.toml` (`morocco-pc-api`, `fra`, always-on) | present in the tree; **UNKNOWN** whether it is used — no measured evidence of a Fly origin in `CONTEXT.md` or `docs/OPEN_POINTS.md`. This is a decision in §21 (B6). |
| Web V1 hosting | `apps/web/wrangler.jsonc`, `apps/web/open-next.config.ts` | configured, **never deployed** |
| Web V2 hosting | none | **no deployment configuration exists** on `feature/v2-design` |

---

## 3. Current project and dependency inventory

### 3.1 Inventory

**CURRENT.** "Manifest" means a `package.json` in that directory with its own dependency list. Verified with `git ls-files | grep -i package.json` on `master` (root + `apps/web`) and `git ls-tree origin/feature/v2-design apps/web-v2/` (adds `apps/web-v2/package.json` + `package-lock.json`).

| Path | Manifest | Independently installable today? | Runtime dependencies | Tests | CI | Deploy artifact |
|---|---|---|---|---|---|---|
| repository root | `package.json` (private, no `workspaces`) | yes (it is the only install) | fastify, @fastify/*, @sentry/node, @sinclair/typebox, pg, dotenv, pino-pretty (dev) | `test:unit`, `test:scripts`, `test:api` | `ci.yml` | `Dockerfile` (root context), `render.yaml`, `fly.toml` |
| `src/recommendation/` | **none** | no — resolved through the root install | **none** (zero non-relative non-test requires) | 63 test files inside the stages | via root `test:unit` | shipped inside the API image |
| `database/` | **none** | n/a — data, not code | none | via `test:scripts` + `verify:replay` | `ci.yml` recurring job | none |
| `scripts/` | **none** | no | pg, dotenv | `test:scripts` | `test:scripts` | `scripts/lib/db-url.js` is copied into the image |
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
| `scripts/lib/db-url.js` | `scripts/lib/`, a directory with no `package.json` | "Database project exposes the guard" | **PROPOSED:** `packages/database-guard/`, a real package (§9.4), because `apps/api/src/db.js:26` requires it as code. |

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
- `apps/api/src/db.js` is the *only* file that requires `pg`, and it also requires `scripts/lib/db-url.js` (line 26).
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

**PROPOSED gate set.** Today only the API→engine edge is enforced by a test; the rest are conventions.

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

**CURRENT (master, measured 2026-11-11).** `scripts/lib/db-url.js` (zero third-party deps) exports **exactly seven** public symbols, and the package contract is those seven and no others:

| # | Export | Contract |
|---|---|---|
| 1 | `CONNECTION_TIMEOUT_MILLIS` | constant `15000`, the scripts convention |
| 2 | `normalizeHost(urlString)` | pure: lowercased host, a `-pooler` first label stripped |
| 3 | `resolveTestDbUrl(env)` | pure: throws on unset/empty/unparseable `TEST_DATABASE_URL`, unset `DATABASE_URL`, or equal normalised hosts |
| 4 | `getWriteTestDbUrl(env)` | thin wrapper over `resolveTestDbUrl`; takes an explicit env object and loads no `.env` |
| 5 | `describeTarget(urlString)` | pure: `{ endpointId, pooled, database }` |
| 6 | `toDirectUrl(urlString)` | pure: the same string pointed at the direct (non-pooler) host, credentials preserved verbatim |
| 7 | `normalizeTarget(urlString)` | pure: credential-free `{ host, database }` identity |

There is **no restore-point predicate export**: the restore-point rule is argument validation in `scripts/lib/apply-seed-args.js` and `scripts/apply-api-role.js`, not part of this package. The guard is required by `apps/api/src/db.js:26`, by seven DB-backed API test files plus `apps/api/test/run-db-tests.js`, and by **18 top-level scripts, every one of which `require`s it directly** (re-measured 2026-11-11 on `master` = `e62c816`). Three further `scripts/lib/` modules also `require` it (`apply-seed-args.js`, `ingest-args.js`, `migrations.js`), and one `scripts/lib/` module cites it only in a comment (`og01-catalog.js:28`). `scripts/` has **no `package.json`**, so `"db-guard": "file:../../scripts/lib"` could not install.

**PROPOSED:** create `packages/database-guard/`:

| Aspect | Design |
|---|---|
| Contents | the current `db-url.js` implementation, moved to `packages/database-guard/src/index.js`; its own test (`scripts/lib/db-url.test.js`) moves to `packages/database-guard/test/db-url.test.js`. `apps/api/test/unit/db-guard.test.js` **stays in the API**: despite its filename it validates the API's pool configuration (`resolvePoolConfig`, `STATEMENT_TIMEOUT_MS`, `APPLICATION_NAME`), and moving it would move API ownership into a package that must stay independent of `pg` |
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
| `ranking/rank.js` | `rankBuilds` ordering | pure (imports `../assembly` barrel for one constant) | core | narrow import to `../assembly/assemble` |
| `ranking/select-diverse.js` | legacy `selectDiverseTop` walk | pure | core | same (kept; still exported) |
| `ranking/select-archetypes.js` | `selectArchetypes`, `STRATEGIES`, `REASON_CODES` | pure | core | same; becomes the target of `explanation/reasons.js:107` |
| `ranking/index.js` | barrel | pure | core | same |
| `explanation/explain.js` | `explainSelection` prose | pure | core | same |
| `explanation/build-facts.js` | per-build facts for explanations | pure (imports `../assembly` barrel for one constant) | core | narrow import to `../assembly/assemble` |
| `explanation/reasons.js` | `deriveReasons`, `REASON_ORDER` | pure (imports `../ranking` barrel) | core | narrow import to `../ranking/select-archetypes` |
| `explanation/index.js` | barrel | pure | core | same |
| `offers/as-of.js` | `parseAsOf` (explicit `asOf` option) | pure | core | → `core/pricing/as-of.js` (or `core/offers-as-of.js`); `orchestrator/run.js` re-points |
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
| `orchestrator/index.js` | barrel | **infrastructure** | runtime | same |
| `ingestion/` (8 modules) | operator import; plan/apply; identity | **infrastructure** | **neither** — `apps/offer-ingestion/` | §12 |
| `*/index.test.js` and sibling `*.test.js` (63 files) | unit suites | n/a | **follow their module** | import paths updated; no assertion change |

**Counts.** Core: **33** modules (14 compatibility + 5 candidates + 2 filtering + 7 assembly + 5 scoring + 5 retention + 4 ranking + 4 explanation + 1 offers/as-of — with the splits counted at file level). Runtime: **24** modules (2 candidates/filtering/offers loaders + 1 filtering pipeline + 3 candidates + 5 orchestrator + 5 persistence + 3 query + 2 scoring loaders). Ingestion: 8. Total 65, plus 15 `index.js` barrels and the 63 test files that follow them.

### 11.3 The three real reconstruction costs (and the argument that is withdrawn)

**Withdrawn.** The first revision rejected the split partly because "`ranking/*` and `explanation/*` are core and import `assembly` **via the barrel**, which in Option B would include runtime-facing pieces". That is not what the source says: `src/recommendation/assembly/index.js` has **0 DB files**, and its own header states "Never reads from or writes to the database." The barrel is pure. The objection had no basis, and no analogous one remains after §11.2.

**What is actually true, and small:**

1. **Two barrel imports must be narrowed.** `ranking/rank.js:3` and `explanation/build-facts.js:46` import `../assembly` to obtain `EXPANSION_ORDER`; `scoring/build-score.js:80` already imports `../assembly/assemble` directly. Narrowing the two lines makes the dependency file-precise and removes any chance that a future assembly barrel grows an infrastructure export that a pure consumer silently inherits. `explanation/reasons.js:107` imports `../ranking`; narrow it to `../ranking/select-archetypes` (`STRATEGIES` and `REASON_CODES` are defined there).
2. **`CONTEXT_COMPAT_KEYS` and the `filtering` pipeline must move together.** They are defined in `context-loader.js`/`pipeline.js`, which are runtime; core's filtering barrel must not export them.
3. **`offers/as-of.js` is reached by direct path.** `orchestrator/run.js` requires `../offers/as-of`; once `as-of` is core and `select` is runtime, that import changes package. It is a one-line change with a test that already covers it.

**Barrel rule that prevents accidental infrastructure imports:** each package's `index.js` re-exports only its own subtree; core's barrels are generated by hand from a fixed export list (no `module.exports = { ...require('./x') }` spread); and core's boundary test fails on `.query(` anywhere in its tree. Together these make "importing core accidentally imports runtime" impossible rather than merely discouraged.

### 11.4 Core public entry points (PROPOSED)

`package.json` `exports` (CommonJS, no build step):

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
| Static boundary | core's `test/boundary.test.js`: every `require` under `src/**` is relative and resolves inside the package; no file contains `.query(`, `require('pg')`, `require('dotenv')`, `require('fs')`, `require('http')`, `process.env`, `Date.now`, `new Date`, `Math.random` | the prohibited constructs are absent, per file, not per directory |
| Hermetic run | `node --test` executed from `packages/recommendation-core` with **no `node_modules` present** and an emptied `NODE_PATH` | core resolves and runs with zero installed packages |
| Fixture-only behaviour | every core suite builds its inputs as literals/fixtures; no `pg`, no `TEST_DATABASE_URL`, no `dotenv` load | the core's behaviour is a function of its arguments |
| Determinism | the existing tie-break assertions, unchanged, now running in core | purity of output is preserved by the move |
| Contract fixtures | core owns frozen input/output fixtures; runtime's translation tests consume the same fixtures | a runtime change that breaks a core contract fails in runtime, not in core |
| Runtime, DB-free | fake client recording `(sql, params)`; the existing style (`orchestrator/run.test.js` calls through namespaces) | SQL and call order are testable without a database |
| Runtime, DB-backed | `test:api:db`-style suite on `TEST_DATABASE_URL` only, residue asserted 0 | the only place a database is required |

**The split is proven, not asserted, when:** core's suite passes with `node_modules` absent, its boundary scan is clean, and runtime's DB-free suite passes with a fake client. Those three are the acceptance criteria for §19 step 4.

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
| Contract | v1.10.0, snapshot `apps/api/test/unit/openapi-v1.10.json`, served at `/v1/docs/json`, byte-compared by `openapi-snapshot.test.js` |
| Engine reach | `engine.js` only, six barrels, one frozen option (`allow_unverified_seed_offers: true`) |
| SQL | `repository.js` (API-owned SQL) + `db.js` (the only `pg` importer; pool tagged `application_name = 'morocco-pc-api'`) |
| Guards | refuses to start unless the target is provably the TEST branch or `API_ALLOW_SHARED=1`; imports `scripts/lib/db-url.js` (line 26) |
| Deploy | `apps/api/Dockerfile` (context = repo root), `render.yaml`, `fly.toml` |

### 13.2 Why it cannot be independent today (CURRENT → consequence)

| Blocker | Evidence | Effect |
|---|---|---|
| no manifest | `apps/api/` contains no `package.json` | no own dependency set, no own `npm ci`, no version |
| root build context | `Dockerfile:33-40` copies `src/`, `apps/api`, `scripts/lib/db-url.js` | the image is a slice of the repository, not a build of the API |
| relative engine path | `engine.js:28-33` requires `../../../src/recommendation/*` | the API's source layout encodes the engine's location |
| script dependency | `db.js:26` requires `../../../scripts/lib/db-url` | the start-up guard lives in a directory with no manifest |
| contract inside a test directory | `apps/api/test/unit/openapi-v1.10.json` | a test tree is the publication point for two other applications |

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

**Not implemented in this PR.** No Dockerfile, `.dockerignore`, manifest or lockfile is changed here.

**Owner decision 1 (2026-11-11): step 3a may make path-only updates to `apps/api/Dockerfile`, `.dockerignore`, `fly.toml` and `render.yaml`.** Moving the guard changes the path the image copies, so the existing files must name `packages/database-guard/src/` instead of `scripts/lib/db-url.js`. That approval is **filesystem-path correction only**: no Docker architecture change, no hosting or infrastructure change, no new deployment configuration, no environment-variable change, and **no deployment**. The four-file `file:` build above remains the step-6 design.

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
| Committed snapshot | `apps/api/test/unit/openapi-v1.10.json` |
| Pinning | `openapi-snapshot.test.js` byte-compares the served document and asserts `info.version = 1.10.0`, plus per-minor schema facts |
| Coverage | `openapi-coverage.test.js` asserts every registered route is documented |
| Consumers | V1 `gen:api-types`/`check:api-types`; V2 `gen:api-types`/`check:api-types`; both CI workflows filter on the snapshot's path |
| Compatibility discipline | every minor so far has been additive |
| Breaking-change detection | **none** — `check:api-types` is a *drift* gate, not a *compatibility* gate |

### 15.2 The problem, including the cross-branch duplication

1. The authoritative document is stored in a **test directory of the API application**, and its location is hard-coded in four places outside that application (two `package.json` scripts, two workflow path filters) plus a stale pair of V1 references that still name `openapi-v1.6.json` (§23.4).
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
| **Stale cross-references exist.** V1's `README.md` and `lib/api/client.ts` name `openapi-v1.6.json`, which does not exist. | §23.4 |
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

Step 2 changed no recommendation behaviour, schema, contract, migration or deployment: it changed 31 files (documentation, recipes, per-layer agent instructions and one documentation-gate path). `packages/` now exists only because it holds `recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md`; it has **no manifest and no code**, and the extraction remains step 3a (§23.1).

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
| **3a. Package boundary preparation** | create `packages/{recommendation-core,recommendation-runtime,database-guard}` manifests and empty `src/` skeletons; move the guard into `packages/database-guard/` and update its consumers; path-only Docker/hosting corrections permitted (owner decision 1); no recommendation module moves; boundary tests written | 1, 2 | **3b** | none | no |
| **3b. Contract & shared-interface preparation** | §15.4 O2: `contract/openapi-<version>.json`; the API snapshot test and V1's generator point at it; contract-copy drift gate; Git-ref compatibility gate. **V2 is not touched here** - its integration is step 7 | 1, 2 | **3a** | none | no |
| **4. Core extraction** | the 33 core modules + split barrels + narrowed imports + hermetic suite (§11.2, §11.6) | 3a, 3b | — | none (`test:unit` is DB-free) | no |
| **5. Runtime extraction** | the 24 runtime modules; orchestrator/transaction docs; DB-free fake-client suites | 4 | — | **TEST only** for DB-backed suites (§19.2 T2) | no |
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
| 3a | **the four manifests exist**: root `package.json`, `packages/recommendation-core/package.json`, `packages/recommendation-runtime/package.json`, `packages/database-guard/package.json` (`apps/api` deliberately still has none until step 6); `packages/database-guard` passes the guard's own tests; no recommendation module has moved; `test:unit` and `test:api` are unchanged, `test:scripts` drops exactly the moved guard test, and all are green |
| 3b | one `contract/openapi-<major>.<minor>.<patch>.json` exists and no other `openapi-*.json` remains outside it; the snapshot test, V1's generator and the CI path filters point at it; the Git-ref compatibility gate passes on an additive change and fails on a breaking one; V2 untouched |
| 4 | core's suite passes with `node_modules` absent; boundary scan clean; `test:unit` count unchanged except for moved paths; `git diff` shows no logic change in a moved file |
| 5 | runtime's DB-free suite green; a DB-backed suite on TEST passes with residue 0; every orchestrator entry point documents its transaction ownership |
| 6 | `cd apps/api && npm ci && npm test` with no root `node_modules`; `docker build -f apps/api/Dockerfile .` starts and answers `/v1/health`; `import-boundary.test.js` green against the new packages |

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
| **A3** | Is the guard an installable `packages/database-guard` package, and who loads `.env`? | Yes; zero-dependency package, with environment loading left to the consuming API/CLI bootstrap (§9.4) | **APPROVED 2026-11-11** — zero-dependency `packages/database-guard`; `.env` loading stays with the consuming API/CLI bootstrap | platform owner + database owner | **approved**; step 3a |
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
| `master` (current, Revision 4) | `e62c816` | `git rev-parse origin/master` |
| `feature/v2-design` | `3bc0605` | `git log --oneline origin/feature/v2-design` |
| RFC branch | `architecture/system-separation-rfc` at `9297034`, **merged as PR #23 (`0bcb6e3`) and deleted**; Revision 4 corrections are on `docs/rfc-accuracy-corrections` | `git log`, `git branch -a` |
| Manifests on `master` | root `package.json` + `apps/web/package.json` (and their lockfiles) | `git ls-files \| grep -i package.json` |
| Manifests on `feature/v2-design` | the above + `apps/web-v2/package.json` + `apps/web-v2/package-lock.json` | `git ls-tree origin/feature/v2-design apps/web-v2/` |
| `contract/` | does not exist on `master`; until step 3b the contract is `apps/api/test/unit/openapi-v1.10.json` | `ls -d contract` → absent |
| `packages/` | exists on `master` only as `packages/recommendation-runtime/docs/LOADERS_AND_TRANSACTIONS.md`; **no manifest, no code** | `git ls-tree -r --name-only origin/master -- packages` |
| V2 staging record | exists on `feature/v2-design`, **not** on `master` | `git show origin/feature/v2-design:apps/web-v2/docs/staging-smoke.md`; `git cat-file -e origin/master:…` → fatal |

### 23.2 Commands run (Revisions 1-3 and Revision 4; all read-only, no database contact)

| Command | Result used in |
|---|---|
| `git status --porcelain`, `git log --oneline`, `git branch -a` | §23.1 |
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
| Guard exports and behaviour | `scripts/lib/db-url.js` |
| Ingestion is not a stage | `src/recommendation/ingestion/index.js:1-13` |
| Contract snapshot and gates | `apps/api/test/unit/openapi-v1.10.json`; `openapi-snapshot.test.js`; `openapi-coverage.test.js` |
| Offer counts and coverage | `docs/OPEN_POINTS.md` R-01, R-30; `docs/DATA_STATE.md` |
| V2 staging smoke | `feature/v2-design:apps/web-v2/docs/staging-smoke.md` |

### 23.4 Contradictions recorded (not silently resolved)

| # | Document says | Tree says | Handling |
|---|---|---|---|
| C1 | `README.md` / `CONTEXT.md` report `test:scripts` "479" | **571** tests pass on this tree (`node --test "scripts/lib/*.test.js"`, 2026-11-11, Node 22.23.4); no other current document states a figure after PR #24 rewrote `AGENTS.md` | **resolved by measurement** — `479` is stale; the two documents are left for their own count correction, not silently rewritten here |
| C2 | `README.md` "62 decisions" (at `a413f25`) | PR #24 removed the count from `README.md`; the log parses to 63 top-level `## Decision` headings + 5 nested = 65 global decisions, with 69 `Status:` lines (`verify:docs`), and the generated index is the lookup | **resolved by measurement** — the README states no count; `AGENTS.md` states the pinned range "Decisions 1-65" |
| C3 | `apps/web/README.md` and `lib/api/client.ts` name `openapi-v1.6.json` | no such file; `package.json` uses `v1.10` | recorded; V1 doc drift (§16.5) |
| C4 | `CONTEXT.md` §2 / `AGENTS.md` §5: "Engine stages are pure" | true of stage functions; mixed barrels export SQL-executing modules; 15 non-ingestion modules execute SQL | **resolved by §6.2** — the claim is about functions, not packages |
| C5 | `fly.toml` declares an always-on API service | `CONTEXT.md`/`ROADMAP.md` describe one Render origin | **UNKNOWN** which descriptor is authoritative (B6) |
| C6 | First revision: "18 production engine modules call `db.query`" | measured **17** (15 outside ingestion) | corrected in §6.2; the earlier number may have counted `ingestion/` differently |
| C7 | First revision: "24 test files require `pg`" | measured **23** | corrected in §6.2 P1 |
| C8 | First revision: "strongly connected graph" | 80/80 singleton SCCs | withdrawn (§6.3) |
| C9 | First revision: "V2 has never called a deployed API" | `staging-smoke.md` records a 2026-11-07 read-only smoke against the EU staging API | corrected (§14.4) |
| C10 | First revision: contract snapshot identical across branches "is one contract" | two physical copies, each gated against itself | corrected (§15.2) |

### 23.5 No-code-change confirmation

Every revision of this document, Revision 4 included, changes exactly one file: `docs/architecture/SYSTEM_ARCHITECTURE_AND_PROJECT_SEPARATION_RFC.md`. It:

- does not modify any source file under `src/`, `apps/api/`, `apps/web/` or `apps/web-v2/`;
- does not add, remove or change any `package.json` or lockfile;
- does not add, remove or change any Dockerfile or `.dockerignore`;
- does not change any file under `.github/workflows/`;
- does not modify any migration, seed or the audit log;
- does not modify any test;
- does not merge, rebase or cherry-pick `feature/v2-design`;
- does not connect to a database, run a database script, or deploy anything;
- does not implement any part of the Option B split, and begins no roadmap step.

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

*This RFC records the owner's approval of A1-A6 (2026-11-11) and stays PROPOSED for everything else: B1-B8 are open and independent review remains welcome. Option B is the selected direction; nothing in the document is implemented, and PR #23 was merged on 2026-11-11 (`0bcb6e3`) as the record's publication, which implements none of it. No application, database, test, workflow, manifest or deployment artefact was changed by this revision.*
