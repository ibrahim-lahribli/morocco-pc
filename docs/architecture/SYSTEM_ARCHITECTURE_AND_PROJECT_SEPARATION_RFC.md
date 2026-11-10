# System Architecture & Project Separation RFC

**Repository:** `ibrahim-lahribli/morocco-pc`
**Status:** PROPOSED — awaiting owner approval and independent review
**Date:** 2026-11-10
**Baseline:** `master` = `a413f25` ("Merge pull request #18 from ibrahim-lahribli/freebuff/launch-v2-2.5.0-decay-off")
**Secondary input:** `feature/v2-design` = `3bc0605` (read, never merged or rebased for this RFC)
**Deliverable:** documentation and analysis only. No source, manifest, lockfile, workflow, migration, seed or test file was modified.

---

## 0. How to read this document

Every material assertion carries one of five labels. They are not decoration: they are the difference between what the code does today and what this RFC thinks it should do.

| Label | Meaning |
|---|---|
| **CURRENT** | Verified in the tree at `a413f25` by reading the file, running the command, or reading git history. The evidence is cited. |
| **PROPOSED** | This RFC's recommendation. Not implemented. |
| **DECISION REQUIRED** | An owner-level product or organisational choice that code inspection cannot settle. Listed in §21. |
| **DEFERRED** | Deliberately postponed, with a named trigger that re-opens it. |
| **UNKNOWN** | Not established by current evidence. Stated as a question, never as a fact. |

Contradictions between documents and the tree are **not resolved silently**. They are recorded in §23.4 and named where they matter.

Measurements in this document were taken on 2026-11-10 on Node v24.21.0, in a clean worktree at `a413f25`.

---

## 1. Executive summary

### 1.1 What the platform is today

Morocco-PC is a PC-build recommendation platform for the Moroccan market. It is one Git repository containing four very different kinds of software at four different levels of packaging maturity:

1. a **dependency-free Node.js recommendation engine** (`src/recommendation/`, 80 non-test modules, ~17 200 lines excluding ingestion) that receives a `pg`-compatible client as an argument and performs no I/O of its own;
2. a **PostgreSQL schema** (`database/`, 23 migrations, 32 seed files) that is the single authority for every fact the engine can read;
3. a **thin Fastify API** (`apps/api/`) that has no `package.json`, resolves its dependencies from the repository root, and reaches the engine through exactly six stage barrels;
4. **two independently packaged Next.js frontends** — V1 (`apps/web`, 168 tracked files, deployed nowhere) and V2 (`apps/web-v2`, 203 tracked files, living only on `feature/v2-design`, with no deployment configuration at all).

The boundaries between (1), (3) and (4) are already **enforced by committed tests** — `apps/api/test/unit/import-boundary.test.js` pins that only `apps/api/src/engine.js` may require the engine, that `pg` is required only by `apps/api/src/db.js`, and that the HTTP layer imports neither. The boundaries between the *projects* are not enforced by anything, because there are no projects: there is one root `package.json`, one root `node_modules`, and one root Docker build context.

### 1.2 Principal findings

| ID | Finding | Evidence |
|---|---|---|
| F1 | **The engine is already a library; only its address is wrong.** No production engine file requires `pg`, `dotenv` or any third-party package — 24 *test* files do, and zero non-test files do. Every DB touch takes a caller-supplied client. | `grep -rn "require('pg')" src/recommendation` → 24 files, all `*.test.js`; 18 production files call `db.query` on an injected handle |
| F2 | **The engine is one strongly-connected graph, not a set of swappable packages.** Production cross-stage imports run backwards through the pipeline (`assembly` → `filtering`, `scoring` → `assembly`, `retention` → `candidates`+`filtering`+`assembly`, `explanation` → `ranking`+`scoring`, `ranking` → `assembly`). | §6.3, exact file:line citations |
| F3 | **Loaders live inside the pure stages and the barrels export both.** `filtering/index.js` exports `loadFilteringContext` beside `filterCandidates`; `query/index.js` exports `loadQueryInput` and `SELECT_QUERY_INPUT_SQL`; `scoring/index.js` exports `loadScoringModel` beside `computeBuildScore`. A "pure core" package split is therefore a file move, not a directory move. | §6.1, §6.4 |
| F4 | **`apps/api` cannot be installed, built or deployed on its own.** It has no `package.json`; its Dockerfile requires the repository root as build context and copies `src/` and `scripts/lib/db-url.js` beside it. | `apps/api/Dockerfile:1-10,33-40`; `render.yaml` `dockerContext: .` |
| F5 | **`apps/api` depends on a file outside every application and outside the engine**: the write-target guard. | `apps/api/src/db.js:26` requires `../../../scripts/lib/db-url` |
| F6 | **Ingestion is already a separate application wearing an engine directory's clothes.** It is network-free, has its own barrel, has its own CLI, and **no engine stage imports it** — verified, zero inbound edges. Its own header says it "is NOT an engine stage". | `src/recommendation/ingestion/index.js:1-13`; §6.2 |
| F7 | **There is exactly one API contract and both frontends generate from it.** One committed snapshot, `apps/api/test/unit/openapi-v1.10.json`, is read by V1's `gen:api-types`, V2's `gen:api-types`, both `check:api-types` gates, and both frontends' CI path filters. | `apps/web/package.json`, `apps/web-v2/package.json`, `.github/workflows/web.yml`, `.github/workflows/web-v2.yml` |
| F8 | **V2 is a foundation, not a replacement.** It has three route files and performs **only GETs**; it has no catalogue route, no results route, no swap, no saved builds, and no deployment configuration. V1 has 19 route files and 38 Playwright spec files. | §14 |
| F9 | **The programme is single-tenant and unauthenticated by decision, not by omission.** There is no auth library, no session, no account, and the API contract documents "No authentication or accounts" as a deliberate property (R-16 ACCEPTED). | `docs/API.md:113-121`; `docs/OPEN_POINTS.md` R-16 |
| F10 | **The shared operational machinery is the real coupling.** `scripts/lib/` (42 test files) contains the DB write guard, the target digests, the restore-point predicates, the model pin and the generated-doc check — every one of them consumed by more than one layer. | `apps/api/src/db.js:26`, `scripts/*.js`, `npm run test:scripts` = 571 tests |

### 1.3 Principal recommendations

| ID | Recommendation | See |
|---|---|---|
| R1 | **Keep one repository.** Independently *deployable* projects, not independently *versioned* repositories. Multi-repo is deferred behind named triggers. | §17 |
| R2 | **Do not introduce npm workspaces in the separation phase.** Keep the current independent-package model, and give `apps/api` its own manifest only when the engine has an address it can depend on. | §17.5 |
| R3 | **One engine package, not two.** `packages/recommendation-engine/` owns all twelve pipeline stages *including* their loaders; ingestion moves out. A pure/impure package split is explicitly rejected — it would move files without removing a single defect. | §11 |
| R4 | **Ingestion becomes `apps/offer-ingestion/`**, owning the CLI, the adapters, the identity rules, the provenance/coverage/freshness gates, and its own SQL. It may import no engine stage. | §12 |
| R5 | **The database becomes an owned project**, `database/` + its lifecycle tooling, not a package and not four databases. Migrations stay the schema authority. | §10 |
| R6 | **The API gets a manifest, one engine dependency and contract ownership.** The published contract becomes a first-class artifact of the API project that both frontends consume and neither owns. | §13, §15 |
| R7 | **V2 is the future frontend; V1 is frozen and retired feature by feature.** Parity is a written matrix with an exit criterion, not a feeling. | §14 |
| R8 | **Root documentation becomes navigation, not content.** Each project owns its README, architecture, operations and testing docs; the root owns the system overview, the open-points register, the decision log and the generated schema mirror. | §16 |

### 1.4 What this RFC does not do

It does not move a file, rename a package, add a manifest, change a workflow, alter the API, touch either frontend, apply a migration, connect to a database, or start the documentation-cleanup PR. The roadmap in §19 is a plan, and §19.0 states the gates that must precede its first implementation step.

---

## 2. Current system overview

### 2.1 The four layers, as implemented

**CURRENT.** The schema is the contract that everything else obeys. Its four logical layers are documented in `README.md`, `CONTEXT.md` and `docs/ARCHITECTURE.md`, and are physical tables in one PostgreSQL database.

| Layer | Tables (current) | Written by | Read by |
|---|---|---|---|
| 1 — Catalog / Hardware | `product`, `product_family`, `product_variant`, `<role>_spec` (7), explicit compatibility tables (`cpu_motherboard_support`, `case_motherboard_form_factor`, `case_radiator_support`, `platform_memory_support`, …) | seeds only | engine loaders, API catalog routes |
| 2 — Performance / Assessment | `benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model` | seeds + `scoring_model` activation recipe | `scoring/load-*`, API meta/presets |
| 3 — Market | `store`, `store_offer`, `price_history`, `ingestion_record`, `retailer_listing_alias`, `spec_provenance` | ingestion + seeds | `offers/select.js`, API catalog/price-history |
| 4 — Recommendation | `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component`, `build_rejection`, `recommendation_preset`, `recommendation_swap` | `orchestrator/commit.js`, `orchestrator/swap-commit.js`, `generate-presets.js` | API read path |

**CURRENT.** 44 tables, 23 migrations (`001_extensions.sql` … `023_recommendation_swap.sql`), ledger at 23 on shared, TEST and EU. 113 ACTIVE products, 319 assessment rows, 114 offers (0 with retailer provenance), 2 stores on the reserved `example.ma` domain.

### 2.2 The runtime pipeline

**CURRENT.** One pass, eleven steps, described in `CONTEXT.md` §2 and pinned by tests:

```
query/loadQueryInput  →  offers/selectOfferPrices  →  candidates/loadCandidates
   →  filtering/filterCandidates          →  scoring/computeCandidateScores
   →  retention/retainTopKPerRole         →  assembly/assembleBuildsForRecommendation
   →  scoring/computeBuildScores          →  ranking/rankBuilds + selectArchetypes
   →  explanation/explainSelection        →  orchestrator/commit  (ONE write transaction)
```

`orchestrator/run.js` wires steps 1–10 inside a caller-owned `REPEATABLE READ READ ONLY` snapshot; `orchestrator/full-run.js` composes snapshot → rank → diversity → explanation → commit. Determinism is a requirement: ties break on `product_id` ASC (then `product_variant_id`, NULL-first), never on `localeCompare` and never randomly.

### 2.3 The delivered surfaces

| Surface | Entry point | Size | Status |
|---|---|---|---|
| Engine library | `src/recommendation/*/index.js` (12 barrels; `persistence/` has none) | 80 non-test modules, 18 297 lines | CURRENT, tested (1 284 tests) |
| HTTP API | `apps/api/src/server.js` | 11 registered routes, contract **v1.10.0** | CURRENT, tested (193 DB-free + 17 DB-backed) |
| Frontend V1 | `apps/web` (Next.js 16.4.2, Tailwind v4, next-intl fr/ar) | 168 tracked files, 19 route files, 38 Playwright specs | CURRENT, deployed nowhere |
| Frontend V2 | `apps/web-v2` on `feature/v2-design` (Next.js 16.4.5, Tailwind v4, next-intl fr/ar) | 203 tracked files, 3 route files, 33 Vitest files, 11 Playwright spec files | CURRENT on that branch only |
| Ingestion | `scripts/ingest-offers.js` → `src/recommendation/ingestion/` | 8 non-test modules, 1 113 lines | CURRENT, dry-run default, network-free |
| Database lifetime | `scripts/run-migrations.js`, `scripts/run-seeds.js`, `scripts/verify-migrations-replay.js` | 23 migrations, 32 seeds, ledger + audit log | CURRENT |

### 2.4 Deployment reality

**CURRENT — measured, not inferred.**

| Artifact | File | State |
|---|---|---|
| API container | `apps/api/Dockerfile` (build context = repository root) | builds `src/` + `apps/api/` + `scripts/lib/db-url.js` |
| API hosting | `render.yaml` (`morocco-pc-api-eu`, Frankfurt, `runtime: docker`, `plan: free`, `healthCheckPath: /v1/health`, `autoDeployTrigger: off`) | one deployed origin: `https://morocco-pc-api-eu.onrender.com`, EU database, `SCORING_MODEL_PIN=launch-v2@2.4.0`, scales to zero after 15 idle minutes |
| API alternative | `fly.toml` (`morocco-pc-api`, `fra`, always-on) | present in the tree; **UNKNOWN** whether it is currently used — no measured evidence of a Fly origin in `CONTEXT.md` or `docs/OPEN_POINTS.md` |
| Web V1 hosting | `apps/web/wrangler.jsonc`, `apps/web/open-next.config.ts` (Cloudflare Workers + OpenNext, KV incremental cache) | configured, **never deployed** (`docs/ROADMAP.md` §5) |
| Web V2 hosting | none | **no deployment configuration exists** on `feature/v2-design` |

This asymmetry matters for §17: the repository already contains three different deployment mechanisms (Docker+Render, Fly, Workers+OpenNext) and only one of them is live.

---

## 3. Current project and dependency inventory

### 3.1 Inventory

**CURRENT.** "Manifest" means a `package.json` in that directory with its own dependency list.

| Path | Manifest | Runtime dependencies | Tests | CI | Docs | Deploy artifact | Independent? |
|---|---|---|---|---|---|---|---|
| repository root | `package.json` (private, no `workspaces`) | fastify, @fastify/*, @sentry/node, @sinclair/typebox, pg, dotenv, pino-pretty(dev) | `test:unit` 1 284, `test:scripts` 571, `test:api` 193 | `ci.yml` | README, AGENTS, CONTEXT, DEVELOPMENT_NOTES, docs/ | `Dockerfile` (root context), `render.yaml`, `fly.toml` | — |
| `src/recommendation/` | none | **none** (zero third-party requires in non-test files) | 63 test files inside the stages | via root `test:unit` | `docs/ARCHITECTURE.md`, per-barrel headers | shipped inside the API image | **library-shaped, address-coupled** |
| `database/` | none | none | via `test:scripts` + `verify:replay` | `ci.yml` recurring job | `docs/SCHEMA_REFERENCE.md` (generated), `docs/DATA_STATE.md` (generated), `docs/RECIPES/add-a-migration.md` | none (data, not code) | no |
| `scripts/` (44 entries, `scripts/lib/` 42 test files) | none | pg, dotenv | 571 tests | `test:scripts` | `docs/RECIPES/` (12 documents) | `scripts/lib/db-url.js` is copied into the image | no |
| `apps/api/` | **none** | resolves from the root `node_modules` | 20 unit + 7 DB files; 193 + 17 tests | `ci.yml` | `docs/API.md` (1 288 lines) | `Dockerfile`, `render.yaml` | **no** (F4, F5) |
| `apps/web/` (V1) | own `package.json` + own lockfile | next 16.4.2, react 19.3.0, next-intl, MDX; openapi-typescript, Playwright, LHCI (dev) | 38 Playwright spec files | `.github/workflows/web.yml` | `apps/web/README.md` (91), `apps/web/AGENTS.md` (9) | `wrangler.jsonc` (undeployed) | **yes, except the contract path** |
| `apps/web-v2/` (V2, branch only) | own `package.json` + own lockfile | next 16.4.5, react 19.3.1, next-intl, @tanstack/react-query, openapi-fetch, zod, zustand, react-hook-form, radix; vitest, Playwright, prettier (dev) | 33 Vitest files, 11 Playwright spec files | `.github/workflows/web-v2.yml` | `apps/web-v2/README.md` (335), `docs/DESIGN_SYSTEM.md` (192), `docs/sections/` | **none** | **yes, except the contract path** |
| `docs/` (17 top-level documents, 4 subdirectories) | none | none | doc gates in `test:scripts` + `verify:docs` | `ci.yml` | is the docs | none | no |
| `test/golden/` | none | none | driven by `eval:scenarios` | recurring job | `docs/TEST_MAP.md` | none | no |

### 3.2 What this inventory proves

1. **Ownership is uneven, not absent.** Both frontends are genuinely independent packages (own manifest, own lockfile, own workflow, own Node floor, own `AGENTS.md`). The engine, the script layer and the API are one install.
2. **The API is the weakest link.** It is the only deployable component without a manifest. Its own Dockerfile says so out loud: "There is deliberately NO nested apps/api/package.json" (`apps/api/Dockerfile:8-12`), with the reason being that the engine's `require('pg')`/`require('dotenv')` must resolve upward — a reason that stops being true the moment the engine is a package with no dependencies (F1).
3. **Two frontends are already versioned independently of the server.** V1 pins `next 16.4.2`, V2 pins `next 16.4.5`, and V2 declares an engines floor `^22.22.2 || ^24.15.0 || >=26.0.0` while CI runs Node 22 for everything. That is a real, current split-brain risk for a workspace migration (§17.5), and it is also evidence that independent packaging already works without workspaces.
4. **Nothing in the tree owns the contract.** The document lives under `apps/api/test/unit/` — a *test* directory — while two applications outside `apps/api` treat it as their build input.

### 3.3 Repository hygiene (CURRENT)

Tracked at the root and unrelated to any project: `pr8-fix-saved-spec.patch` (a 1-file patch artifact), `.cursorrules`, `CLAUDE.md`, and `test/golden/_scratch-v*.md` (16 committed scratch baselines, deliberately ungitignored per `DEVELOPMENT_NOTES.md`). These are recorded because a project structure that assigns ownership must say where an unowned file goes; §16.6 proposes homes rather than deletions.

---

## 4. Logical data layers versus application projects

### 4.1 The question

Should the four data layers become four projects, four databases, or stay one schema with several owners?

### 4.2 Evidence

**CURRENT.** One physical database holds all four layers on every environment (shared, TEST branch, EU). The layers are logical, not physical:

- Cross-layer joins are load-bearing, not incidental: `offers/select.js` joins Layer 3 offers to Layer 1 products/variants; `scoring/load-assessments.js` joins Layer 2 assessments to Layer 1 identities; `orchestrator/commit.js` writes Layer 4 rows that reference Layer 1 ids.
- The `catalog_version` digest (Decision 47) spans **21 loader-read tables across Layers 1–3** and is the invalidation key for Layer 4 presets (R-27). Splitting layers into separate databases would break that digest by construction.
- One write transaction spans Layer 4 only, but it *reads* the snapshot taken across Layers 1–3 in the same `REPEATABLE READ READ ONLY` transaction (`orchestrator/run.js`). A distributed transaction across four databases is not something this system needs.
- The engine's purity rule already prevents layer leakage at the code level: no engine module opens a connection; DB access is injected.

### 4.3 Recommendation

**PROPOSED P2 (§7.3):** the database remains **one PostgreSQL database with four logical domains**, owned by a single database project. The layer names stay because they are load-bearing vocabulary (`README.md`, `ARCHITECTURE.md`, every decision entry).

**PROPOSED ownership mapping:**

| Logical layer | Owning project | May be written by | May be read by |
|---|---|---|---|
| 1 — Catalog | Database (schema) / Ingestion + seeds (data) | seeds, ingestion (identity resolution only), catalogue seeds | engine, API catalog routes, ingestion matching |
| 2 — Assessment | Database (schema) / seeds (data) | seeds, scoring-model recipe | engine scoring, API meta |
| 3 — Market | Database (schema) / Ingestion (data) | ingestion, seeds, `generate-presets` never | engine offers, API catalog/price-history |
| 4 — Recommendation | Database (schema) / API + engine commit (data) | `orchestrator/commit.js`, `swap-commit.js`, `generate-presets.js` | API read path only |

**Rejected:** four databases. The `catalog_version` digest, the single read snapshot and the FK graph (`build_component.product_id` → `product.id`) all assume one database. Four databases would be a rewrite, not a separation, and nothing in the current defects points at it.

**DEFERRED:** a "data platform" project outside the repository (managed schema service). Trigger: a second consumer organisation, or the first non-Neon environment that must not share code.

---

## 5. Current architecture diagrams

### 5.1 Runtime (CURRENT)

```
            browser
               │
   ┌───────────┴────────────┐
   │                        │
apps/web (V1)         apps/web-v2 (V2, branch only)
Next 16.4.2           Next 16.4.5
19 routes, 38 specs   3 routes, 33 vitest + 11 e2e
   │  lib/api/client.ts    │  lib/api/client.ts (openapi-fetch)
   │  (fetch, own types)   │  (fetch, own types)
   └───────────┬───────────┘
               │  HTTPS, /v1/**  (V1 may proxy via next.config rewrites)
               ▼
      apps/api  (Fastify, contract v1.10.0, 11 routes)
        routes/*.js  →  engine.js  →  6 barrels
            │              │
            │              ▼
            │      src/recommendation/  (as a relative path today)
            │
            └── repository.js  ──┐
                                 ▼
                          PostgreSQL (one database, 4 logical layers)
                                 ▲
                                 │
                     scripts/ingest-offers.js → src/recommendation/ingestion/
                     scripts/run-migrations.js, run-seeds.js, generate-presets.js
```

**CURRENT path-level truth that the diagram hides:**

- `apps/api/src/engine.js` is the *only* file that requires `src/recommendation/**`, and it requires exactly six barrels: `assembly`, `candidates`, `orchestrator`, `query`, `retention`, `scoring` (`apps/api/test/unit/import-boundary.test.js`, assertion "engine.js requires exactly the six public barrels it needs").
- `apps/api/src/db.js` is the *only* file that requires `pg`, and it also requires `scripts/lib/db-url.js`.
- `apps/api/src/repository.js` (1 187 lines) is the only file with API-owned SQL.
- The engine is reached by `../../../src/recommendation/...`, i.e. by a **relative path that escapes the application directory**.

### 5.2 Engine internal dependency graph (CURRENT, production files only)

```
compatibility/ ──────────────────────────────► (no inbound from other stages except via barrels)
candidates/   ◄──────── retention, explanation, ranking, offers, orchestrator
filtering/    ◄──────── assembly, retention
assembly/     ◄──────── retention, scoring, ranking, explanation, offers, orchestrator
scoring/      ◄──────── explanation, orchestrator
retention/    ◄──────── orchestrator
ranking/      ◄──────── explanation, orchestrator
explanation/  ◄──────── orchestrator
offers/       ◄──────── orchestrator
query/        ◄──────── orchestrator
persistence/  ◄──────── orchestrator (persist-ranked, persist-pass-facts, persist-rejections)
ingestion/    ◄──────── nobody (zero inbound edges)
```

This is not a layered pipeline at the *code* level: it is a graph in which later stages borrow small pure utilities from earlier ones. §6.3 cites every edge.

### 5.3 Build and deployment topology (CURRENT)

```
                     repository root  (1 lockfile, 1 node_modules)
                     ┌──────────────────────────────────────────┐
                     │ package.json: fastify + pg + dotenv + …  │
                     └───────┬───────────────┬──────────────────┘
                             │               │
                  apps/api (no manifest)   src/recommendation (no manifest)
                             │               │
                             └───────┬───────┘
                                     ▼
                    docker build -f apps/api/Dockerfile .   → Render
                                     │
                    apps/web    ─ own lockfile ─► OpenNext/Workers  (never deployed)
                    apps/web-v2 ─ own lockfile ─► nothing            (branch only)
```

---

## 6. Current module ownership analysis

### 6.1 Per-stage inventory (CURRENT)

Line counts are non-test source lines; test counts are `*.test.js` files inside the directory. "DB files" counts non-test files that call `db.query`/`client.query`.

| Stage | Files | Lines | Test files | DB files | Barrel exports (abridged) | Notes |
|---|---|---|---|---|---|---|
| `assembly` | 7 | 2 415 | 7 | 0 | `assembleBuildsForRecommendation`, `assembleBuilds`, `evaluateBuild`, `evaluateBuildReplacement`, `EXPANSION_ORDER`, `priceKey`, `validatePrices`, `resolveGpuRequirement` | pure + price carrier validation |
| `candidates` | 7 | 955 | 3 | 1 (`loader.js`) | `COMPONENT_ROLES`, `ROLE_ORDER`, `createCandidate`, `loadCandidates`, `selectCandidatePool`, `compareCandidates`, `CandidateSelectionError` | pure contracts + one loader |
| `compatibility` | 14 | 1 867 | 8 | 0 | 11 pair evaluators + `createCompatibilityResult`, `aggregateCompatibilityResults`, `REASON_CODES` | entirely pure; the cleanest extraction candidate |
| `explanation` | 4 | 955 | 3 | 0 | `explainSelection`, `deriveReasons`, `REASON_CODES` | pure, depends on `assembly`, `ranking`, `scoring/use-cases` |
| `filtering` | 5 | 1 784 | 6 | 1 (`context-loader.js`) | `filterCandidates`, `filterCandidatesForRecommendation`, `loadFilteringContext`, `CONTEXT_COMPAT_KEYS`, `buildIntegratedGpuPresentMap` | **pure + loader in one barrel** |
| `ingestion` | 8 | 1 113 | 5 | 2 (`plan.js`, `apply.js`) | 15 exports incl. `runIngestion`, `parseManualText` | **not an engine stage** (own header) |
| `offers` | 3 | 439 | 2 | 1 (`select.js`) | `selectOfferPrices`, `SELECT_OFFER_PRICES_SQL` | SQL + `assembly/prices` reuse |
| `orchestrator` | 7 | 2 329 | 7 | 5 | `runRecommendation`, `runRecommendationFullRun`, `evaluateSwapPreview`, `commitSwap`, `swap-commit`, `readCommittedSwap` | owns the snapshot and the write transaction |
| `persistence` | 5 | 1 076 | 4 | 3 | *(no barrel)* `persist-ranked`, `persist-pass-facts`, `persist-rejections`, `validate-*` | write-only by pinned contract |
| `query` | 3 | 526 | 2 | 2 | `loadQueryInput`, `SELECT_QUERY_INPUT_SQL`, `catalogVersion`, `CATALOG_VERSION_SQL` | pure digest SQL + loader |
| `ranking` | 4 | 964 | 4 | 0 | `rankBuilds`, `selectArchetypes`, `selectDiverseTop`, `PERFORMANCE_FLOOR`, `STRATEGIES` | pure |
| `retention` | 5 | 1 420 | 5 | 0 | `retainTopKPerRole`, `computeBudgetFloor`, `computeRoleTargets`, `excludedCpuProductIds`, `resolutionMultiplier` | pure |
| `scoring` | 8 | 2 454 | 8 | 2 (`load-*`) | `computeBuildScore(s)`, `computeCandidateScore(s)`, `computeEffectiveScore`, `loadScoringModel`, `loadComponentAssessments`, `listUseCases`, `validateScoringModelConfiguration` | **pure + two loaders in one barrel** |

**Totals:** 80 non-test modules, 18 297 non-test lines. Excluding ingestion: 72 modules, 17 184 lines.

### 6.2 Classification by responsibility (CURRENT, by inspection — not by directory name)

| Category | Modules | Why |
|---|---|---|
| Pure domain contracts & validation | `candidates/{candidate,errors,input,roles,select}`, `assembly/{input,prices,gpu-policy,gpu-input}`, `scoring/{configuration,use-cases}`, `persistence/validate-*` | no I/O, no clock, no randomness; throw typed errors |
| Pure calculations | `compatibility/*` (14), `filtering/{filter,igpu-map}`, `scoring/{candidate-score,build-score,effective-score}`, `retention/*`, `assembly/{assemble,pipeline}`, `ranking/*`, `explanation/*`, `offers/as-of` | deterministic functions over plain objects |
| Database loaders | `candidates/loader.js`, `filtering/context-loader.js`, `offers/select.js`, `query/{load-query-input,catalog-version}.js`, `scoring/{load-assessments,load-scoring-model}.js` | take a `db` handle, issue SQL, return frozen plain objects |
| Transaction management | `orchestrator/{snapshot,run,full-run,commit,swap-preview,swap-commit}.js` | own `BEGIN`/`COMMIT`/`ROLLBACK` and the read snapshot |
| Persistence | `persistence/{persist-ranked,persist-pass-facts,persist-rejections}.js` | DML only, write-only, banned tokens pinned by tests |
| Operational workflow (impure edge) | `ingestion/*` | operator file → validated rows → Layer 3 writes; caller owns the transaction |
| Mixed | `filtering/index.js`, `query/index.js`, `scoring/index.js`, `offers/index.js` | barrels that re-export pure and DB functions together (F3) |

**Important consequence.** The purity claim in `AGENTS.md` §5 and `README.md` ("Engine stages are pure: no DB, no clock, no randomness") is **true of the stage functions and false of the stage barrels**. A consumer that imports `filtering` gets `loadFilteringContext` in the same object as `filterCandidates`. That is the single most important fact for deciding what a "recommendation core" package is (§11).

### 6.3 Cross-stage production imports (CURRENT — exact edges)

These are all non-test `require` calls that cross a stage directory boundary:

| From | To | Line | What is borrowed |
|---|---|---|---|
| `assembly/assemble.js` | `filtering/filter` | 117 | the pair evaluator table / candidate status vocabulary |
| `assembly/gpu-input.js` | `filtering/igpu-map` | 71 | `buildIntegratedGpuPresentMap` |
| `retention/retain.js` | `candidates/select` | 176 | `compareCandidates` |
| `retention/retain.js` | `candidates/roles` | 177 | `COMPONENT_ROLES` |
| `retention/retain.js` | `candidates/errors` | 178 | `CandidateSelectionError`, `ERROR_CODES` |
| `retention/retain.js` | `filtering/filter` | 179 | `CANDIDATE_STATUSES` |
| `retention/retain.js` | `assembly/prices` | 182 | `priceKey` |
| `retention/budget-floor.js` | `candidates/errors`, `candidates/roles`, `assembly/prices` | 73, 74, 77 | error type, roles, `priceKey` |
| `retention/targets.js` | `candidates/errors` | 41 | error type |
| `retention/igpu-pool.js` | `candidates/errors` | 44 | error type |
| `scoring/build-score.js` | `assembly/assemble` | 80 | `EXPANSION_ORDER` |
| `explanation/build-facts.js` | `assembly` (barrel), `candidates/errors` | 46, 47 | `EXPANSION_ORDER`, error type |
| `explanation/reasons.js` | `ranking` (barrel), `scoring/use-cases` | 107, 108 | `STRATEGIES`, reason codes, `GPU_POLICIES` |
| `explanation/explain.js` | `candidates/errors` | 48 | error type |
| `ranking/rank.js` | `assembly` (barrel), `candidates/errors` | 3, 4 | `EXPANSION_ORDER`, error type |
| `ranking/select-diverse.js` | `assembly` (barrel), `candidates/errors` | 3, 4 | `EXPANSION_ORDER`, error type |
| `ranking/select-archetypes.js` | `candidates/errors` | 3 | error type |
| `offers/select.js` | `candidates/{input,candidate,errors}`, `assembly/prices` | 55–58 | contracts + `priceKey`/`validatePrices` |
| `offers/as-of.js` | `candidates/errors` | 3 | error type |
| `orchestrator/*` | every stage + `persistence/*` | — | composition only |

**Reading:** the engine's shared kernel is `candidates/{roles,errors,select}`, `assembly/prices`, `filtering/filter` and the `EXPANSION_ORDER` constant. Every stage depends on that kernel. There is no direction in which the graph is acyclic *by package* — only by file.

### 6.4 Current ownership defects (CURRENT → consequence)

| Defect | Evidence | Consequence for project separation |
|---|---|---|
| The API's dependencies are the engine's dependencies | root `package.json`; `apps/api/Dockerfile:8-12` | the API cannot declare, pin or audit its own dependency set |
| The API imports a script | `apps/api/src/db.js:26` | the guard is a shared kernel with no owner |
| The contract lives in a test directory | `apps/api/test/unit/openapi-v1.10.json` | two applications depend on a file that a test-directory refactor could move |
| Loaders share barrels with pure functions | §6.2 | a "pure core" cannot be expressed by package boundary without barrel surgery |
| Ingestion sits inside the engine tree | `src/recommendation/ingestion/` | a reviewer reading the engine sees an operator write path in it |
| 12 scripts measure the engine, 20 manage the database, 8 gate data | `scripts/` inventory | a change to the engine forces a change in a directory owned by nobody in particular |
| Documentation is root-centric | `AGENTS.md` (613 lines) describes every layer | no project can ship a doc without editing the root agent file (see §16) |
---

## 7. Target project architecture

### 7.1 Shape

**PROPOSED.** Five code-bearing projects and one data project inside one repository, each with one business responsibility, its own manifest where it has third-party dependencies, its own docs, its own tests, its own gates and its own deployment story.

```
morocco-pc/                        ← system, not a project: navigation + registers
├── packages/
│   └── recommendation-engine/     ← P1  all 12 pipeline stages (no ingestion), 0 runtime deps
├── apps/
│   ├── api/                       ← P4  HTTP contract owner, Fastify, repository
│   ├── offer-ingestion/           ← P3  operator import, adapters, identity, provenance gates
│   ├── web/                       ← P5  V1 (frozen, transitional)
│   └── web-v2/                    ← P6  V2 (the future frontend, on its own branch today)
├── contract/
│   └── openapi-1.10.0.json        ← P4-owned publication point (see §15)
├── database/                      ← P2  schema authority: migrations, seeds, ledger, replay
│   └── tooling/                   ← lifecycle + verification CLIs (moved from scripts/)
└── docs/                          ← system-level docs + registers + generated mirrors
```

The tree is deliberately **not** a workspace layout yet (§17.5). Each project's manifest is independent; nothing is hoisted; nothing is implicit.

### 7.2 Why not microservices

**PROPOSED rationale.** The defect list in §6.4 is about *ownership and packaging*, not about scaling, availability or team autonomy:

- Deployment is one API container that sleeps after 15 idle minutes on a free plan; a service mesh would add latency to a pass that already pays ~2.7 s of round trips on CI (`measure-db-roundtrip`, `DEVELOPMENT_NOTES.md`).
- The engine's contract with the API is a function call, not a protocol. Turning it into HTTP would require serialising the whole candidate/build graph — hundreds of objects per pass — for no benefit.
- The database is the shared authority; microservices would either share it (distributed monolith, the worst of both) or shard it (breaking `catalog_version`, FKs and the single read snapshot).
- The real need is **independently maintainable projects**, which module boundaries plus per-project manifests deliver without a network hop.

**Rejected:** service decomposition of engine/API/ingestion.

### 7.3 The six projects

#### P1 — Recommendation engine

| Aspect | Proposal |
|---|---|
| Location | `packages/recommendation-engine/` |
| Owns | the 12 pipeline stages (`compatibility`, `candidates`, `filtering`, `offers`, `scoring`, `retention`, `assembly`, `ranking`, `explanation`, `query`, `persistence`, `orchestrator`), the domain contracts and error vocabulary, the compatibility rule table, the determinism rules, the engine's own unit suite |
| Consumes | a caller-supplied `pg`-compatible client and plain input objects. **Nothing else** — no `pg`, no `dotenv`, no `scripts/`, no `apps/`, no clock, no randomness |
| Exposes | the stage barrels (`<stage>/index.js`) and, as today, `persistence/persist-ranked` as the single documented non-barrel import |
| Must not import | ingestion, the API, either frontend, `scripts/`, any third-party package |
| Interface | the barrel functions + the input/output shapes they already freeze (`createCandidateSelectionInput`, `createCandidate`, `runRecommendation`, `runRecommendationFullRun`, `evaluateBuildReplacement`) |
| Deploy | none. It is a library consumed by P3/P4 and by the measurement harnesses |

Path note: "recommendation-core" is the task's working name. This RFC keeps the whole engine in one package (§11) and calls it **engine** rather than **core**, because naming it "core" implies a second "runtime" package that this RFC rejects.

#### P2 — Database / data platform

| Aspect | Proposal |
|---|---|
| Location | `database/` (schema, seeds, ledger, audit log) + `database/tooling/` (lifecycle CLIs) |
| Owns | the 23 migrations and their order, the 32 seeds, the `schema_migrations` ledger, the restore-point and audit-line rules, the replay gate, the generated schema/state mirrors, the access conventions (guards, roles, `.env` variable names) |
| Consumes | nothing at build time; a database at run time |
| Exposes | the schema itself (the only authority), the lifecycle CLIs, the generated `docs/SCHEMA_REFERENCE.md` / `docs/DATA_STATE.md` |
| Must not import | engine stages, application code, frontend code |
| Deploy | data, not code. Migrations and seeds are applied by an operator under the existing guards |

**Not a package** (no `package.json`): the database has no library surface, and packaging it would invite code to depend on "the database project" at build time — the opposite of the schema-as-authority rule.

**Is it a separate project or a module of the platform repo?** — §10.4 discusses this; the recommendation is a distinct *directory* with a distinct owner and its own gates, inside the same repository.

#### P3 — Offer ingestion

| Aspect | Proposal |
|---|---|
| Location | `apps/offer-ingestion/` (today `src/recommendation/ingestion/` + `scripts/ingest-offers.js` + 4 gate scripts) |
| Owns | adapters (manual CSV/JSON today, retailer adapters later), listing validation, identity matching tiers, the six curated rejection codes, plan/apply, ingestion records, price-history writes, provenance/freshness/coverage reporting |
| Consumes | Layer 1 identities and Layer 3 tables through its own SQL; the guard library for target safety |
| Exposes | one CLI (`ingest-offers`), one programmatic `runIngestion(db, input)` |
| Must not import | **any engine stage** — no scoring, no ranking, no compatibility, no assembly. Matching is not recommendation. |
| Deploy | an operator-run job, not a service. Later: a scheduled worker if collection becomes automated (DECISION REQUIRED, §21 D7) |

#### P4 — Backend API

| Aspect | Proposal |
|---|---|
| Location | `apps/api/` |
| Owns | the HTTP contract (paths, schemas, status codes, error envelope), the Fastify app, route validation, application services, the repository (all API-owned SQL), the API-level read model, rate limiting, CORS, the deployment artifact, the OpenAPI document and its snapshot |
| Consumes | P1 barrels (through `engine.js` only), a `pg` pool it creates, the guard library, P2's schema |
| Exposes | `/v1/**` over HTTP; `contract/openapi-<version>.json` |
| Must not import | engine internals (enforced today), ingestion, either frontend, `scripts/` beyond the guard |
| Deploy | Docker image + one platform service (§18.6) |

#### P5 — Frontend V1 (`apps/web`)

| Aspect | Proposal |
|---|---|
| Location | `apps/web/` |
| Owns | the wizard, results, comparison, catalogue, guides, saved builds, presets, SEO/crawl surface, the fr/ar locale content, its own tests and its own workflow |
| Consumes | `/v1/**` over HTTP and the generated TypeScript types from the contract |
| Must not import | engine, API internals, database, V2 code |
| Deploy | configured for Cloudflare Workers/OpenNext, never deployed |
| Lifecycle | **frozen, transitional.** No new features after V2 reaches parity; retired per §14.6 |

#### P6 — Frontend V2 (`apps/web-v2`)

| Aspect | Proposal |
|---|---|
| Location | `apps/web-v2/` (on `feature/v2-design` today; lands on `master` only through the roadmap's step 8) |
| Owns | the design system and tokens, the homepage, the configurator, the future results/catalogue/compare surfaces, fr/ar with RTL, accessibility, SEO/analytics, its own tests and workflow |
| Consumes | `/v1/**` over HTTP; the generated types from the contract; its own demo/fixture layer |
| Must not import | engine, API internals, database, V1 code |
| Deploy | **DECISION REQUIRED** — no configuration exists (§21 D9) |

### 7.4 What stays outside every project

| Thing | Why it has no project | Where it lives |
|---|---|---|
| `test/golden/` baselines and the scenario matrix | it is cross-project evidence (engine behaviour under a database state) | root `test/`, owned jointly by P1 + P2 with an explicit owner in the doc |
| `scripts/eval-scenarios.js`, `measure-*.js` | measurement harnesses that read the database and call the engine | PROPOSED: `tools/measurement/` (neither an app nor the engine) |
| `.github/workflows/` | CI is repository-level | root |
| `docs/OPEN_POINTS.md`, decision log, glossary | cross-project registers | root `docs/` |
| The `pr8-fix-saved-spec.patch` artifact | unowned history | PROPOSED: delete or `docs/archive/` (§16.6) |

---

## 8. Project responsibility matrix

**PROPOSED.** ● owns · ○ consumes · – must not touch.

| Responsibility | P1 engine | P2 database | P3 ingestion | P4 API | P5 web V1 | P6 web V2 |
|---|---|---|---|---|---|---|
| Compatibility rule table (11 relationships) | ● | ○ (schema shape) | – | – | – | – |
| Scoring model interpretation | ● | ○ (`scoring_model` rows) | – | – | – | – |
| Deterministic ranking / archetypes | ● | – | – | – | – | – |
| Explanation text and reason codes | ● | – | – | – | – | – |
| Candidate/build rejection reasons | ● | ○ (`build_rejection`) | – | – | – | – |
| Persistence of a pass | ● (`commit`) | ○ | – | ○ (triggers it) | – | – |
| Schema and migrations | – | ● | ○ | ○ | – | – |
| Seeds and catalogue data | – | ● | ○ (offers only) | – | – | – |
| Restore points / audit lines / replay | – | ● | ○ | – | – | – |
| Retailer listing parsing | – | – | ● | – | – | – |
| Product identity matching | – | ○ (`product.slug`) | ● | ○ (serves slug) | – | – |
| Offer provenance & freshness gates | – | ○ | ● | ○ (serves the class) | ○ (labels it) | ○ (labels it) |
| Preset generation | ○ (`runRecommendation` callable) | ○ | – | ● (`generate-presets`) | ○ (renders) | ○ (renders) |
| HTTP contract & versioning | – | – | – | ● | ○ | ○ |
| Request validation / status codes | – | – | – | ● | – | – |
| Rate limiting / CORS | – | – | – | ● | – | – |
| Catalogue read model | – | ○ | – | ● | ○ | ○ |
| Design system & tokens | – | – | – | – | ● | ● (own) |
| Locale content (fr/ar) | – | – | – | – | ● | ● (own) |
| Frontend SEO / crawl surface | – | – | – | ○ (catalog routes) | ● | ● (planned) |
| Deployment of the API | – | – | – | ● | – | – |
| Deployment of a frontend | – | – | – | – | ○ (configured) | ○ (DECISION REQUIRED) |
| Database lifetime operations | – | ● | – | – | – | – |

**Note on the two design systems.** V1 and V2 each own one, and V2's README states it deliberately shares no frontend code with V1. This RFC keeps that: a shared design-system package is **DEFERRED** until V2 owns the product and V1 is retired (§21 D4/D5). Sharing now would couple a frozen app to an active one.

---

## 9. Dependency and public-interface matrix

### 9.1 Allowed dependency edges

**PROPOSED.** Rows may depend on columns only where marked.

| ↓ depends on → | engine | database | ingestion | api | contract | web-v1 | web-v2 |
|---|---|---|---|---|---|---|---|
| **engine** | — | – | – | – | – | – | – |
| **database** | – | — | – | – | – | – | – |
| **ingestion** | – (hard) | ○ schema + guard | — | – | – | – | – |
| **api** | ○ barrels via `engine.js` | ○ schema + guard | – | — | ● owns it | – | – |
| **web-v1** | – | – | – | ○ HTTP only | ○ types | — | – |
| **web-v2** | – | – | – | ○ HTTP only | ○ types | – | — |

### 9.2 Public interfaces (one per edge)

| Edge | Interface | What makes it an interface rather than a convention |
|---|---|---|
| engine → api | 6 stage barrels with frozen inputs/outputs | `apps/api/test/unit/import-boundary.test.js` resolves every `require` and fails on an engine internal |
| database → api / engine / ingestion | the schema + `scripts/lib/db-url.js` guard contract | migrations are the only DDL source; the guard is unit-tested and injected into `db.js` |
| api → frontends | `contract/openapi-<version>.json` (today `apps/api/test/unit/openapi-v1.10.json`) | `check:api-types` in both frontends; `openapi-snapshot.test.js` byte-compares the served document |
| api ↔ frontends at runtime | `/v1/**` JSON over HTTPS | contract version + the committed snapshot |
| ingestion → database | listing rows + plan/apply inside one transaction | `runIngestion(db, input)` with the caller owning the transaction |
| operator → ingestion | a CSV/JSON file (manual adapter) | `adapters/manual.js` `parse(text, { format })` |

### 9.3 Forbidden edges and how each would be caught

**PROPOSED gate set.** Today only the API→engine edge is enforced by a test; the rest are conventions. Each proposed gate is cheap, DB-free, and can live in `npm run test:scripts`-style suites per project.

| Forbidden | Today | Proposed gate |
|---|---|---|
| API imports an engine internal | **enforced** (`import-boundary.test.js`) | keep |
| `pg` required outside `db.js` in the API | **enforced** (same file) | keep |
| engine requires `pg`/`dotenv`/`scripts` | not enforced by test, true by fact | zero-dependency check: scan `packages/recommendation-engine/**/*.js` for non-relative requires |
| ingestion imports an engine stage | not enforced, true by fact (0 edges) | boundary test over `apps/offer-ingestion/src` |
| frontend imports engine/API/database source | not enforced | per-app boundary test (frontends already run their own lint/typecheck) |
| API imports ingestion | not enforced | as above |
| script imports application internals | partially (harnesses legitimately call the engine) | classify `tools/` as an allowed engine consumer |

### 9.4 The one shared kernel that needs an owner

**CURRENT.** `scripts/lib/db-url.js` is required by `apps/api/src/db.js:26` and by at least six scripts (`apply-api-role.js:53`, `apply-seed.js:50`, `check-deployed-role.js:58`, `check-target-parity.js:46`, `cleanup-layer4.js:51`, and the replay harnesses). It is a *database access contract*, not a script helper.

**PROPOSED.** It moves to the database project (`database/tooling/db-url.js`), and every consumer imports it from there. Until that move, the file must not be edited without updating the API image's `COPY` line (`apps/api/Dockerfile:40`).

---

## 10. Database architecture

### 10.1 What exists (CURRENT)

| Concern | Mechanism | Evidence |
|---|---|---|
| Schema authority | numbered migrations, applied in filename order through a ledger | `database/migrations/001…023`, `scripts/run-migrations.js`, `schema_migrations` |
| Re-applicability | ledger-driven pending tail; `--baseline` adopts a pre-ledger database | `scripts/run-migrations.js --check/--baseline` |
| Shared-database safety | a real apply against `DATABASE_URL` refuses without `--restore-point=<id>`; `--baseline` needs one too; an audit line per applied file | `scripts/lib/run-migrations-cli.test.js` (24 tests), `database/migration-applies.jsonl` |
| Write-test isolation | `TEST_DATABASE_URL` guard, comparing normalised hosts (pooler stripped) | `scripts/lib/db-url.js`, `apps/api/test/unit/db-guard.test.js` |
| Drift detection | replay every migration into an EMPTY scratch database and diff by definition | `scripts/verify-migrations-replay.js`, `npm run verify:replay` |
| Target parity | ledger + tables + columns + enums + row counts between two targets | `scripts/check-target-parity.js` |
| Least privilege | `morocco_pc_api` role provisioned with a column-scoped grant and a 20-answer self-check | `scripts/apply-api-role.js`, `scripts/rehearse-api-role.js`, `scripts/smoke-api-role.js` |
| Deployed-credential proof | pooled sessions tagged `application_name = 'morocco-pc-api'` and classified by `usename` | `apps/api/src/db.js`, `scripts/check-deployed-role.js` |
| Data gates | catalogue identity, deferred rules, offer provenance, offer freshness, OG-01 coverage, offer coverage | 6 `scripts/check-*.js` |
| Generated mirrors | `docs/SCHEMA_REFERENCE.md` (982 lines) + `docs/DATA_STATE.md` (90) | `scripts/gen-schema-reference.js --check` |

### 10.2 What the database project should own (PROPOSED)

1. The migrations, the seeds and their ordering rules.
2. The **guards and their tests**: `db-url`, restore-point predicate, target digest, audit-line format.
3. The **lifecycle CLIs**: `run-migrations`, `run-seeds`, `verify-migrations-replay`, `check-target-parity`, `gen-schema-reference`, `cleanup-layer4`.
4. The **data gates** that only query data: `check-catalog-identity`, `check-deferred-rules`, `check-offer-provenance`, `check-offer-freshness`, `check-offer-coverage`, `check-og01-coverage`, `check-assessment-age`.
5. The generated schema/state documents (produced here, linked from root).

What it must **not** own: engine measurement harnesses (`measure-*`), the golden scenario matrix, `generate-presets.js` (that is an API/ops job that calls the engine), or the API role *application* procedure as an application concern — the procedure document belongs here, the credential belongs to ops.

### 10.3 Access conventions to preserve

**CURRENT → PROPOSED to keep unchanged:**

- a write test never targets shared;
- a real-database write needs a restore point and leaves an audit line;
- a migration is never rewritten, only appended;
- `NULL` = UNKNOWN, never 0, in data as well as in code;
- the guard compares normalised hosts and the digest, never the variable name;
- credentials are never printed, persisted to files, or read by an agent.

These are the platform's most valuable existing properties and no step of §19 may weaken them.

### 10.4 Project or module?

**Recommendation:** a **separate owned project inside the repository**, not a package and not a separate repository.

- *Not a package*: there is no library surface to import; a manifest would invite build-time coupling.
- *Not a separate repository*: every engine change that needs a column must land with its migration in one reviewable change; the 23-migration history and the decision log are shared evidence (e.g. Decision 46 spans a migration, a writer, an API presenter and two contract minors).
- *But a project*: it needs an owner, its own `README.md`, its own `docs/` (lifecycle, roles, restore procedure), its own gates and its own acceptance criteria.

---

## 11. Recommendation-core architecture

### 11.1 The question

Should the pure computation be extracted into its own package, with the database-backed runtime left behind?

### 11.2 Option A — one engine package, loaders included

**PROPOSED (recommended).** `packages/recommendation-engine/` contains all twelve stages exactly as they are today: pure modules and their loaders side by side, one barrel per stage, `persistence/` without a barrel.

- **Advantages**: zero file moves inside the stages; the 1 284-test suite keeps its paths; every cross-stage import in §6.3 remains a relative require; the injection contract (`db` as an argument) is preserved verbatim; the package has **zero runtime dependencies** (F1), so it needs no install step, no lockfile and no build.
- **Disadvantages**: the package boundary does not itself express purity. A reviewer can still import `loadFilteringContext` from a "pure" stage.
- **Mitigation (PROPOSED)**: keep the purity rule where it is already enforced — a per-file check in the package's own test suite: no non-relative `require`, no `Date`, no `Math.random`, no `process.env` outside an explicit allowlist (today only the loaders and orchestrator touch the clock via an injected `asOf`).

### 11.3 Option B — two packages: pure core + runtime

Split `packages/recommendation-core/` (pure only) from `packages/recommendation-runtime/` (loaders, persistence, orchestrator).

**Evaluation against the actual tree:**

| Test | Result |
|---|---|
| Can purity be expressed by moving directories? | **No.** Loaders are files inside stage directories (`candidates/loader.js`, `filtering/context-loader.js`, `scoring/load-*.js`, `query/load-query-input.js`, `offers/select.js`), so a split moves files, not folders (F3). |
| Would barrels stay coherent? | **No.** `filtering`, `query`, `scoring` and `offers` barrels export both halves; each would need splitting and every consumer re-pointed. |
| Would the graph become acyclic across packages? | **Marginal.** `offers/select.js` (runtime) imports `assembly/prices` (core) and `candidates/{input,candidate,errors}` (core); `orchestrator` (runtime) imports all. That direction is fine — but `scoring/build-score.js`, `ranking/*` and `explanation/*` are *core* and import `assembly` **via the barrel**, which in Option B would include runtime-facing pieces. The edge would have to be narrowed first. |
| Does it fix a current defect? | **No.** Nothing in `docs/OPEN_POINTS.md` (R-01…R-30) is caused by pure and impure code sharing a directory. The purity rule is already honoured at run time and already tested. |
| Cost | ~18 file moves, 4 barrel rewrites, every test path touched, both consumers (`apps/api/src/engine.js`, 12 measurement scripts) re-pointed — with no behavioural change to justify the risk. |

**Verdict: rejected for this programme.** DEFERRED with a trigger: if a second consumer ever needs the pure core without a database (e.g. an offline pricing simulator), the split is reconsidered *then*, starting from `compatibility/` (14 files, zero DB touches, zero cross-stage imports) which is genuinely extractable today.

### 11.4 What stays outside the engine package (PROPOSED)

| Stays out | Reason |
|---|---|
| ingestion (`ingestion/`, the CLI, 4 gates) | not a stage; own header says so; 0 inbound edges (§12) |
| scenario harnesses, measurement scripts, golden baselines | evidence, not engine code; they *call* the engine |
| the API's engine entry point (`apps/api/src/engine.js`) | it owns one API decision (`allow_unverified_seed_offers: true`, frozen) that is not an engine rule |
| seeds and catalogue data | data, not code |
| the decision log and architecture contract | documentation, referenced not imported |

### 11.5 Public surface the package must keep (CURRENT, frozen)

`assembly`, `candidates`, `compatibility`, `explanation`, `filtering`, `ingestion`→moved, `offers`, `orchestrator`, `query`, `ranking`, `retention`, `scoring` barrels plus `persistence/persist-ranked`. The API pins exactly six of them by test; any new barrel import must be a deliberate edit to that assertion (`import-boundary.test.js`, "engine.js requires exactly the six public barrels it needs").
---

## 12. Ingestion architecture

### 12.1 What it is today (CURRENT)

| Property | Fact | Evidence |
|---|---|---|
| Location | `src/recommendation/ingestion/` (8 non-test modules, 1 113 lines, 5 test files) | directory listing |
| Classification | **not an engine stage** — its own header says so | `ingestion/index.js:1-13` |
| Dependency direction | inbound: **zero** (no stage imports it); outbound: none to other stages | §6.3; `grep` over `src/recommendation` |
| Third-party deps | none (`crypto` + Node builtins only) | `require` scan |
| Network | **none by design** — the seam is a file | `docs/PIPELINE_DESIGN.md`, handoff §2.4 |
| DB writes | only `apply.js`, inside a caller-owned transaction | `apply.js`, `run.js` header |
| CLI | `scripts/ingest-offers.js` (`--adapter=manual --file=…`, dry-run default, `--commit`, `--test-db`, `--target-env`, `--restore-point`) | script header |
| Guards | refuses `--target-env` naming `DATABASE_URL`/`TEST_DATABASE_URL`; compares targets by `db:<12 hex>` digest; requires a restore point for a write; prints `AUDIT TARGET:` before connecting | `scripts/lib/ingest-args.js`, 26 DB-free tests |
| Identity | Tier 0 `CATALOGUE_KEY` (operator `product_slug` + `variant_sku`) wins over SKU/MPN/name tiers; 6 curated rejection codes; nothing is force-matched | handoff §2.4, `docs/OPEN_POINTS.md` R-01 |
| Gates | `check-offer-provenance.js`, `check-offer-freshness.js`, `check-offer-coverage.js`, `check-catalog-identity.js` | scripts inventory |
| Real data | **none**: 114 offers, 0 verified, 2 fictional stores, `retailer_listing_alias` 0 rows with no producer | `docs/OPEN_POINTS.md` R-01, R-30 |

### 12.2 Why it is an application, not part of the engine (PROPOSED)

1. **Different responsibility**: it turns operator-supplied text into Layer 3 rows. It performs no compatibility, scoring, ranking or assembly — the header says "It performs no compatibility / scoring / ranking work and never touches the engine's pure modules."
2. **Different impurity**: it writes; the stages do not. Keeping it beside pure code means the engine's "no I/O" claim always needs an asterisk (today the asterisk is the directory).
3. **Different cadence**: it changes when a retailer's export format changes, not when the scoring model changes — the two are the most common independent changes in the tree.
4. **Different gates**: provenance/freshness/coverage are data-quality gates, not engine tests.

### 12.3 Target shape (PROPOSED)

```
apps/offer-ingestion/
├── README.md                  ← operator onboarding, adapter contract, safety rules
├── package.json               ← zero runtime deps beyond the pg client it is given; scripts: import, dry-run, gates
├── src/
│   ├── adapters/              ← manual; retailer adapters later
│   ├── listings.js            ← parse + validate (pure)
│   ├── matching.js           ← identity tiers (pure)
│   ├── promotion.js          ← class promotion rules (pure)
│   ├── plan.js               ← dry-run plan (reads)
│   ├── apply.js              ← writes, caller-owned transaction
│   └── run.js                ← orchestration
├── bin/ingest-offers.js       ← the CLI (today scripts/ingest-offers.js)
├── gates/                     ← provenance, freshness, coverage (today scripts/check-offer-*.js)
└── test/                      ← the 5 existing unit suites + CLI suites
```

**Hard rule:** `apps/offer-ingestion/**` may not require any path under `packages/recommendation-engine/`. Enforced by its own boundary test, in the shape of `apps/api/test/unit/import-boundary.test.js`.

### 12.4 What it needs from the database and what it must never do

| Needs | Must never |
|---|---|
| read Layer 1 identities (`product.slug`, `product_variant.sku`) | import an engine stage, or re-implement scoring/ranking |
| read/write Layer 3 (`store`, `store_offer`, `price_history`, `ingestion_record`) | write Layer 4 tables |
| the target guard, the digest comparison, the restore-point rule | commit outside a caller-owned transaction |
| the provenance definitions (what makes an offer `VERIFIED`) | invent a match, a price, a provenance class or a timestamp |

### 12.5 The open problem this project will own (CURRENT → PROPOSED)

**CURRENT.** R-01 is the platform's most consequential open point: 0 of 114 offers carry retailer provenance, and the 2026-11-06/07 pilot established that the binding constraint is **identity**, not collection — 3 of 4 confident rows returned `UNMATCHED NAME_CONTAINS`. R-30 measured evidenced per-role coverage as zero outside CPU on every database.

**PROPOSED.** Once ingestion is a project with an owner, R-01 becomes its *defining* acceptance criterion (one real retailer, one verified import, provenance PASS, coverage per role) rather than a row in a cross-project register. This RFC does not attempt the import.

---

## 13. API architecture

### 13.1 What exists (CURRENT)

| Aspect | Fact |
|---|---|
| Manifest | **none** — dependencies resolve from the root `package.json` |
| Entry | `apps/api/src/server.js` → `app.js` (Fastify construction) |
| Routes (11 registrations) | `GET /v1/health`, `GET /v1/meta/options`, `GET /v1/presets`, `GET /v1/catalog/products`, `GET /v1/catalog/products/:slug`, `GET /v1/catalog/products/:slug/price-history`, `GET /v1/docs/json`, `POST /v1/recommendations`, `GET /v1/recommendations/:id`, `GET /v1/recommendations/:id/builds/:rank/swap-preview`, `POST /v1/recommendations/:id/builds/:rank/swap` |
| Contract | v1.10.0, snapshot `apps/api/test/unit/openapi-v1.10.json`, served at `/v1/docs/json` and byte-compared by `openapi-snapshot.test.js` |
| Engine reach | `engine.js` only, six barrels, one frozen option (`allow_unverified_seed_offers: true`) |
| SQL | `repository.js` (1 187 lines) + `db.js` (146, the only `pg` importer, pool tagged with `application_name`) |
| Guards | refuses to start unless the target is provably the TEST branch or `API_ALLOW_SHARED=1`; imports `scripts/lib/db-url.js` |
| Observability | `request_id` on every error; `monitoring.js` (114 lines) with DSN-gated Sentry; JSON logs with `pino-pretty` feature-detected |
| Tests | 20 DB-free unit files (193 tests), 7 DB-backed files (17 tests, nightly and TEST-only), plus 4 contract/surface tests (`openapi-coverage`, `openapi-snapshot`, `import-boundary`, `surface`) |
| Deploy | `apps/api/Dockerfile` (context = root), `render.yaml`, `fly.toml` |

### 13.2 Why it cannot be independent today (CURRENT → consequence)

| Blocker | Evidence | Effect |
|---|---|---|
| no manifest | `apps/api/` contains no `package.json` | no own dependency set, no own `npm ci`, no version |
| root build context | `Dockerfile:33-40` copies `src/`, `apps/api`, `scripts/lib/db-url.js` | the image is a slice of the repository, not a build of the API |
| relative engine path | `engine.js` requires `../../../src/recommendation/*` | the API's source layout encodes the engine's location |
| script dependency | `db.js:26` | the API's start-up guard lives in another layer |
| contract inside a test directory | `apps/api/test/unit/openapi-v1.10.json` | a test tree is the publication point for two other applications |

### 13.3 Target shape (PROPOSED)

```
apps/api/
├── package.json            ← fastify, @fastify/*, typebox, @sentry/node, pg
│                             + "recommendation-engine": "file:../../packages/recommendation-engine"
│                             + "db-guard": "file:../../database/tooling"   (or an inlined guard module)
├── Dockerfile              ← context = apps/api + the two file: dependencies
├── src/ … (unchanged layout)
├── test/unit, test/db
└── contract/               ← optional local publication point (see §15)
```

**Acceptance for "independent":** `cd apps/api && npm ci && npm test` succeeds with no root `node_modules`, and `docker build -f apps/api/Dockerfile apps/api` produces an image that starts and answers `/v1/health`. Both are new capabilities; neither exists today.

### 13.4 Ownership to add (PROPOSED)

- **The contract** (see §15) — the API owns the document, its version and its compatibility rules.
- **The deployment artifact** — `Dockerfile` + one platform descriptor; `fly.toml` and `render.yaml` must not both claim the service. DECISION REQUIRED (D9).
- **The API's error vocabulary** and status codes — already implemented, documented in `docs/API.md` §Errors.
- **The authentication roadmap** — **not implemented anywhere** (F9). See §18.2.

---

## 14. Web V1 and V2 architecture

### 14.1 Feature inventory (CURRENT)

**V1 (`apps/web`, `master`)** — 19 route files: homepage, `configurer` (wizard), `config/[id]` (results + share), `composants` list, `composants/[slug]`, `composants/comparer`, `guides` + `guides/[slug]`, `enregistrements` (saved builds), `[presetSlug]` (preset landing), `format`/`kit`/`tokens` proof sheets, legal pages (`confidentialite`, `mentions-legales`, `contact`), catch-all 404, plus `api/analytics/config/route.ts`.

**V2 (`apps/web-v2`, `feature/v2-design`)** — 3 route files: `app/[locale]/layout.tsx`, `app/[locale]/page.tsx` (7-section homepage), `app/[locale]/configurateur/page.tsx`.

### 14.2 Parity matrix (CURRENT)

| Capability | V1 | V2 | Gap / note |
|---|---|---|---|
| Homepage with finder | yes | yes (7 sections) | V2 rebuilt from design references, shares no code |
| Wizard / configurator | yes (multi-step, URL-driven) | partial: 2 questions (use_case, budget), summary panel, generates nothing | V2 has no submit |
| Recommendation POST | yes (`POST /v1/recommendations`) | **no** | V2 performs only GETs (README) |
| Results page | yes (`config/[id]`) | no | V2 opens an existing pass only via `?from=<uuid>` |
| Build swap (preview + commit) | yes (`e2e/swap.spec.ts`, 10 specs) | no | contract v1.8/v1.10 unused by V2 |
| Catalogue list + product page | yes | no | V2 has no catalogue picker |
| Price history | yes (`price-history.spec.ts`) | no | |
| Compare view | yes (`compare.spec.ts`) | no | |
| Saved builds | yes (localStorage, `/enregistrements`) | no | |
| Guides (MDX, fr + ar) | yes | no (guide data exists in `lib/homepage/guides.ts`) | V2 has no guides route |
| Preset landing pages | yes (`[presetSlug]`) | no (consumes `GET /v1/presets` for cards) | |
| Legal pages | yes | no | |
| Locales | fr (default) + ar, RTL | fr + ar, RTL | V2 owns its own dictionaries (297-line fr.json) and a key/placeholder parity test |
| Design system | own tokens + component kit | own tokens (`@theme` in `globals.css`) + kit + `docs/DESIGN_SYSTEM.md` (192 lines) | two systems, deliberately unshared |
| SEO / crawl surface | sitemap.ts, robots.ts, canonical + hreflang, per-preset OG | **none** | V2 has no crawl surface yet |
| Analytics | yes (`lib/analytics.ts`, `api/analytics/config`) | no | |
| Accessibility tests | axe suite (`e2e/a11y.spec.ts`) | contrast unit tests + a11y e2e (`homepage-a11y.spec.ts`) | V2 tests what it has |
| Test volume | 38 Playwright spec files | 33 Vitest files + 11 Playwright spec files | V2 also has `fixture-api.mjs`, `measure-step35.mjs`, `verify-real-api.mjs` |
| Deployment config | `wrangler.jsonc` + `open-next.config.ts` (undeployed) | **none** | §21 D9 |
| Type generation | `openapi-typescript` from `apps/api/test/unit/openapi-v1.10.json` | same document, own generator (`scripts/gen-api-types.mjs`) | one contract, two generators |

### 14.3 API operations each frontend consumes (CURRENT)

| Operation | V1 | V2 |
|---|---|---|
| `GET /v1/meta/options` | yes | yes |
| `GET /v1/presets` | yes | yes (one per use case) |
| `POST /v1/recommendations` | yes | no |
| `GET /v1/recommendations/{id}` | yes | yes (`?from=`) |
| `GET /v1/catalog/products` | yes | no |
| `GET /v1/catalog/products/{slug}` | yes | no |
| `GET /v1/catalog/products/{slug}/price-history` | yes | no |
| `GET /v1/recommendations/{id}/builds/{rank}/swap-preview` | yes | no |
| `POST …/swap` | yes (S24/S25) | no |
| `GET /v1/health` | yes (client) | yes (client tests) |
| `GET /v1/docs/json` | no | no |

### 14.4 Transition constraints (CURRENT)

1. **Diverged history.** `origin/master` and `origin/feature/v2-design` share merge-base `868b60d` (PR #14): 35 commits exist only on master, 101 only on V2. The V2 branch is not "master plus an app"; it carries its own copies of `src/`, `database/`, `docs/` and both workflows.
2. **The V2 tree duplicates platform files.** V2's branch contains `apps/api`, `apps/web`, `src/`, `database/` and `scripts/` (a full copy of the repository at its fork point). Landing V2 must not import that copy back into master.
3. **No V2 deployment path exists.** No `wrangler.jsonc`, no `open-next.config.ts`, no Dockerfile, no hosting descriptor.
4. **V2 has never called a deployed API.** Its README states every browser test stubs `/v1/**`; `verify-real-api.mjs` exists but its run is not recorded as evidence.
5. **Contract adjacency.** Both V2's workflow and V1's workflow trigger on `apps/api/test/unit/openapi-v1.10.json`, so a contract change already runs both frontends' drift gates — the strongest existing cross-project coupling, and the reason §15 matters.
6. **Node/Next floors differ** between the two frontends (V1: `>=22`, next 16.4.2; V2: `^22.22.2 || ^24.15.0 || >=26`, next 16.4.5).
7. **V2 README self-describes as pending native review** of the Arabic copy and "pending native review" is a stated status, not a completed check.

### 14.5 Recommended transition (PROPOSED)

- **V2 becomes the single future frontend** (DECISION REQUIRED, D4).
- V1 is **frozen**: bug fixes only, no new features, until parity.
- Parity is tracked as a table in V2's docs (this §14.2 is the starting point), with an explicit "must retain" subset decided by the owner (D5).
- V2 lands on `master` as an application-only merge (its platform copy is discarded), then gains a deploy descriptor before any cutover.
- V1 is retired route by route once each row of the retained capability set is green on V2 *and* deployed.

### 14.6 What "retire V1" must not lose (CURRENT → for D5)

Saved builds (local-only), compare view, price history, preset landing pages, legal pages, guide content in both locales, analytics events, structured data (JSON-LD verified-price rules in `lib/result/structured-data.ts`), the crawl surface (sitemap/robots/hreflang/OG cards), and the axe/Lighthouse budgets. Each is a concrete capability with tests in V1 today.

---

## 15. API contract and versioning

### 15.1 Current mechanism (CURRENT)

| Property | Fact |
|---|---|
| Authoritative document | generated by the API at run time (`/v1/docs/json`) from TypeBox schemas |
| Committed snapshot | exactly one: `apps/api/test/unit/openapi-v1.10.json` (the earlier `v1.1`…`v1.9` files were deleted as each minor landed — `docs/TEST_MAP.md`) |
| Pinning | `openapi-snapshot.test.js` byte-compares the served document (one trailing newline ignored) and asserts `info.version = 1.10.0`, plus per-minor schema facts so a new minor cannot drop the previous one |
| Coverage | `openapi-coverage.test.js` asserts every registered route is documented |
| Consumers | V1 `gen:api-types`/`check:api-types`; V2 `gen:api-types`/`check:api-types`; both CI workflows filter on the snapshot's path |
| Compatibility discipline | every minor so far has been **additive** (v1.1 … v1.10): no path removed, no field retyped (`docs/API.md` header) |
| Breaking-change detection | **none** — `check:api-types` is a *drift* gate (types match the document), not a *compatibility* gate (v1.11 does not break a v1.10 client) |

### 15.2 The problem

The single authoritative document is stored in a **test directory of the API application**, and its location is hard-coded in four places outside that application (two `package.json` scripts, two workflow path filters, two generators' headers) plus a stale pair of V1 references that still name `openapi-v1.6.json` (§23.4).

A prior attempt to give it a top-level home — `contract/openapi.json` + `contract/README.md`, merged as PR #22 (`90dc99b`) — was **removed from `master` on 2026-11-10** by a force-push back to `a413f25`; the commits survive at `backup/master-before-contract-revert`. This RFC treats that attempt as evidence that the question was raised, not as a decision: it deliberately re-derives the options rather than assuming the reverted design.

### 15.3 Options

| Option | What it means | Advantages | Disadvantages |
|---|---|---|---|
| **O1 — keep it in place** | leave the snapshot under `apps/api/test/unit/` | zero change; the pin already works | two applications depend on a test path; an API test refactor can move a public artifact |
| **O2 — versioned contract directory** | `contract/openapi-1.10.0.json`, owned by P4; the test reads it | explicit ownership; version in the filename; both frontends name a stable path | one more path for the snapshot test to compare against |
| **O3 — published artifact** | CI publishes the document as a release asset / package attachment per API release | a frontend can pin a *released* contract without a checkout | requires a release process that does not exist yet (`engine_version` is a git SHA today) |
| **O4 — internal contract package** | a `packages/api-contract` package with the JSON + generated types | one import for both frontends | two frontends already generate types themselves; a package adds a build step for a JSON file |
| **O5 — contract served only at runtime** | frontends generate from `/v1/docs/json` | no committed file | breaks offline builds and drift gates; rejected |

### 15.4 Recommendation

**PROPOSED:**

1. **O2 now**: one authoritative document at `contract/openapi-<major>.<minor>.<patch>.json`, owned by P4, byte-compared by `openapi-snapshot.test.js` (the same assertion, a new path). No second copy anywhere — both frontends' generators point at it and `check:api-types` stays their gate.
2. **O3 later, as part of P4's release process**: the file (and its generated `schema.d.ts` per frontend) is attached to the API release, so a frontend can pin a contract version without reading the repository.
3. **A compatibility gate**: a schema diff between the committed contract and the working tree's generated document, classified ADDITIVE / BREAKING, failing on BREAKING unless the version's minor is bumped and a migration note is added. This does not exist today and is the missing half of "one authoritative contract".
4. **Reject O4**: generated types belong to each frontend (they already own a generator and a drift gate); a shared types package would make two applications' typecheck fail together for a change only one of them uses.

**Hard rule preserved:** never a hand-maintained second copy of a request or response shape. The frontends' `lib/api/types.ts` files are already named aliases over the generated document, which is the correct pattern.

### 15.5 Versioning policy to write down (PROPOSED)

| Change | Version | Gate |
|---|---|---|
| new optional field, new route, new enum member | minor (`1.x.0`) | snapshot test + compatibility diff |
| field removed, type narrowed, route removed, status code changed | major (`2.0.0`) | must fail the compatibility gate until the version is bumped and the breaking change is documented |
| field description / example only | patch | snapshot test only |
| engine behaviour change with no contract change | none | `engine_version` / `scoring_model_id` on the pass record |

**The served model is not the contract.** `SCORING_MODEL_PIN` (Decision 62/63) can change what a pass returns without changing the contract; `docs/API.md` already documents that no response body names the pin and that the durable record is `recommendation_query.scoring_model_id`. That separation is correct and must survive any project split.

---

## 16. Documentation ownership

### 16.1 Current inventory (CURRENT)

| Document | Lines | Nature | Owner today |
|---|---|---|---|
| `README.md` | 69 | system overview + quick start | nobody in particular |
| `AGENTS.md` | 613 | agent entry point: every layer, every command, every gotcha | root |
| `CONTEXT.md` | 154 | current state | root |
| `DEVELOPMENT_NOTES.md` | 2 145 | operational lessons / dated measurements | root |
| `docs/ARCHITECTURE.md` | 879 | engine contract (pipeline, HARD/SOFT, scoring) | engine |
| `docs/API.md` | 1 288 | HTTP contract history + operation notes | API |
| `docs/PIPELINE_DESIGN.md` | 401 | ingestion design (F8/OG-06) | ingestion |
| `docs/ROADMAP.md` | 119 | programme + sprint ledger | root |
| `docs/OPEN_POINTS.md` | 89 (30 rows) | the only "what is still open" | root |
| `docs/OPEN_GAPS.md` | 255 | evidence trail behind the register | root |
| `docs/RECOMMENDATION_ENGINE_DECISIONS.md` | 6 349 | 63 `## Decision` headings, 69 `Status:` lines | engine (append-only) |
| `docs/DECISION_INDEX.md` | 110 | GENERATED | generator |
| `docs/SCHEMA_REFERENCE.md` | 982 | GENERATED from the live DB | generator |
| `docs/DATA_STATE.md` | 90 | GENERATED live snapshot | generator |
| `docs/GLOSSARY.md` | 53 | vocabulary lookup | root |
| `docs/TEST_MAP.md` | 104 | which test pins which contract | cross-project |
| `docs/RECIPES/` | 12 documents | task checklists | mixed |
| `docs/briefs/engine.md`, `docs/decisions/TEMPLATE.md` | — | brief + template | mixed |
| `docs/archive/` | 20+ | superseded, each with `Superseded by:` | historical |
| `apps/web/README.md` | 91 | V1 onboarding | V1 |
| `apps/web/AGENTS.md` | 9 | generated Next.js block only | V1 (generated) |
| `apps/web-v2/README.md` | 335 | V2 onboarding + API + measurement tooling | V2 |
| `apps/web-v2/AGENTS.md` | 9 | generated Next.js block only | V2 (generated) |
| `apps/web-v2/docs/DESIGN_SYSTEM.md` | 192 | tokens + component API | V2 |
| `apps/web-v2/docs/sections/*`, `finder-validation.md`, `staging-smoke.md`, milestone reports | — | step evidence | V2 |

### 16.2 Diagnosed problems (CURRENT)

| Problem | Evidence |
|---|---|
| **The root describes every implementation.** `AGENTS.md` (613 lines) carries engine gotchas, migration rules, API notes and web sprint figures side by side. | file contents; §4 of that file is a full repository map |
| **Project docs live outside the projects.** The engine's contract is `docs/ARCHITECTURE.md`; the API's contract is `docs/API.md`; ingestion's design is `docs/PIPELINE_DESIGN.md` — three root files that only their project's owner should have to keep true. | paths |
| **Stale cross-references are already present.** V1's `README.md:7` and `lib/api/client.ts:5` name `openapi-v1.6.json`, a file that does not exist; `package.json` uses `v1.10`. | §23.4 |
| **Stale figures in root docs.** `README.md` quick start and `CONTEXT.md` §5 report `test:scripts` = 479 and "62 decisions"; measured today 571 tests and 63 decision headings. `AGENTS.md` already carries 571. | measured |
| **Generated and authored docs interleave at the root** with no marker in the index that says which must never be hand-edited. | `docs/` listing |
| **No per-project operations doc.** Deployment knowledge is spread across `docs/RECIPES/deploy-eu-colocation.md`, `render.yaml` comments, `fly.toml`, the Dockerfile and `CONTEXT.md` §3. | files |
| **The archive is well-managed** — every superseded file carries `Superseded by:` and `docs/archive/README.md` indexes them. This is the pattern to keep. | `docs/archive/` |

### 16.3 Proposed documentation architecture

**PROPOSED.** Root = *system and navigation*. Project = *its own implementation truth*.

```
README.md                      system overview, the 4 layers, how to run all suites, where to read next
AGENTS.md                      index only: which project owns what + the shared guard rails (≤150 lines)
CONTEXT.md                     environment/state snapshot (root), no implementation detail
docs/
├── SYSTEM_ARCHITECTURE.md     (this document's durable successor: boundaries, not internals)
├── OPEN_POINTS.md             the only "what is still open"            [stays, root]
├── ROADMAP.md                 programme + sprint ledger               [stays, root]
├── GLOSSARY.md                load-bearing vocabulary                 [stays, root]
├── TEST_MAP.md                cross-project pin index                 [stays, root]
├── SCHEMA_REFERENCE.md        GENERATED (database project)            [stays, generated]
├── DATA_STATE.md              GENERATED (database project)            [stays, generated]
├── DECISION_INDEX.md          GENERATED                                [stays, generated]
├── decisions/                 decision log + TEMPLATE                  [stays, append-only]
├── RECIPES/                   cross-project operations                 [slims to deploy/first-launch]
├── architecture/              this RFC + future system-level RFCs      [new]
├── archive/                   superseded, with Superseded by:          [stays]
├── api/                       contract history + operations            [moved from docs/API.md]
├── database/                  lifecycle, roles, restore, replay        [new, except generated mirrors]
├── ingestion/                 PIPELINE_DESIGN.md + import runbook      [moved]
└── engine/                    ARCHITECTURE.md + engine recipes         [moved]

packages/recommendation-engine/README.md, docs/{ARCHITECTURE,MODULES,TESTING}.md
apps/api/README.md, docs/{CONTRACT,OPERATIONS,TESTING}.md
apps/offer-ingestion/README.md, docs/{ADAPTERS,IDENTITY,OPERATIONS}.md
apps/web/README.md, docs/{ROUTES,DESIGN,I18N,TESTING}.md
apps/web-v2/README.md, docs/{DESIGN_SYSTEM,ROUTES,API,TESTING}.md        [already partly there]
database/README.md, docs/{LIFECYCLE,ROLES,RESTORE}.md
```

### 16.4 Required content per project

Every project's own docs must answer, at minimum:

1. README: what it is, who consumes it, how to install and run it, its boundary (what it may not import).
2. Architecture: module map and the public interface.
3. Testing: which suite runs where, what needs a database, what is DB-free.
4. Environment: the exact variables and their guard rules.
5. Operations (where applicable): build, deploy, rollback, health, on-call signals.
6. Security: credentials it holds, what it must never log.
7. Release: how a version is cut and what a breaking change means.
8. Decision records: which decisions it owns, and where the shared log is.
9. Known limitations: links into the register rather than restatements.

### 16.5 Disposition of existing documents (PROPOSED — not executed here)

| Document | Disposition |
|---|---|
| `docs/ARCHITECTURE.md` | **move** to `docs/engine/ARCHITECTURE.md` + a link from root; remains authoritative for the engine contract |
| `docs/API.md` | **move** to `docs/api/CONTRACT.md`; split the operation notes from the version history |
| `docs/PIPELINE_DESIGN.md` | **move** to `docs/ingestion/PIPELINE_DESIGN.md` |
| `docs/RECIPES/*` | **split**: engine recipes → `docs/engine/recipes/`, DB recipes → `docs/database/recipes/`, deploy/first-launch stay root |
| `AGENTS.md` | **rewrite to an index** (target ≤150 lines); the per-layer gotchas move to the owning project's `AGENTS.md`, which already exists in both frontends |
| `DEVELOPMENT_NOTES.md` | **keep, split by owner in a later pass**; it is dated evidence, and evidence belongs to whoever measured it |
| `CONTEXT.md` | **keep at root**, corrected (`test:scripts` 571, 63 decisions) |
| `README.md` | **keep at root**, corrected; add project index |
| `docs/OPEN_POINTS.md`, `OPEN_GAPS.md` | **keep at root** — cross-project by nature |
| `docs/DECISION_INDEX.md`, `SCHEMA_REFERENCE.md`, `DATA_STATE.md` | **keep generated**, regenerated by the owning project's generator |
| `docs/GLOSSARY.md`, `TEST_MAP.md` | **keep at root** |
| `docs/archive/**` | **keep as historical evidence**, untouched |
| `docs/HANDOFF_2026-11-04.md`, `HANDOFF_2026-11-07.md` | **PROPOSED: archive** with a `Superseded by:` header once their live facts are folded into `CONTEXT.md`; they are dated snapshots, not living docs |
| `apps/web/README.md` stale `openapi-v1.6.json` | **update** in the documentation-cleanup PR (this RFC does not edit it) |
| `pr8-fix-saved-spec.patch` | **PROPOSED: delete or archive** — a root-level patch artifact with no owner |

### 16.6 What the documentation-cleanup PR is *not* allowed to change

**PROPOSED constraint on the later PR:** it may move, split, rewrite and re-link documents, but it may not change a test count, a decision count, a migration range or a measured figure without re-running the measurement — the exact failure mode `DEVELOPMENT_NOTES.md` already records three times.
---

## 17. Monorepo versus multiple repositories

### 17.1 The three options

| | **Option 1 — modular monorepo** | **Option 2 — multiple repositories** | **Option 3 — hybrid** |
|---|---|---|---|
| Means | one repository, six projects, per-project manifests, one CI entry with per-project jobs | one repository per project (engine, database, ingestion, api, web, web-v2) with published artifacts | one repository for the platform (engine, database, ingestion, api) + separate repositories for each frontend |
| What changes today | directory layout, manifests, CI job split | everything, plus a registry and a versioning scheme | V1/V2 out; the rest stays |

### 17.2 Comparison on the axes that matter here

**CURRENT facts are cited; the verdicts are PROPOSED.**

| Axis | Monorepo | Multi-repo | Hybrid | Evidence from this tree |
|---|---|---|---|---|
| Independent project ownership | good — via `CODEOWNERS` + per-project dirs | best — a repo is a hard boundary | good for frontends, unchanged for the core | all six projects are written by one owner today; there is no `CODEOWNERS` file |
| Package versioning | per-project manifests, one lockfile each | semantic version per repo, registry required | mixed | the engine has no version; the API has no manifest; the frontends have independent lockfiles |
| Dependency management | duplication only where projects need it | each repo independent | frontends independent already | root `package.json` currently serves engine + API + scripts |
| CI execution | one workflow file per project (already the pattern: `ci.yml`, `web.yml`, `web-v2.yml`) | independent pipelines, no cross-repo gate | same | `web.yml` and `web-v2.yml` already exist and are disjoint |
| Deployment | unchanged — deployable units already exist | unchanged | unchanged | one API container; `wrangler` for V1 |
| **Contract evolution** | one PR can change the document, the API and both frontends' generated types together | 3-repo dance per contract minor: API → contract registry → two frontends | 2-repo dance per minor | v1.1→v1.10 added fields consumed by V1 *and* V2; both workflows filter on the same snapshot path |
| **Coordinated schema change** | one PR: migration + loader + writer + contract + tests | engine/migration/API split across repos, version-skew window is real | same as multi-repo for the core | Decision 46 (migration 019 + writer + presenter + two contract minors) landed as one coherent change |
| Cross-project PRs | normal | rare and expensive | rare for the core | 23 migrations, 63 decisions, 30 open points, all cross-cutting |
| Developer experience | one clone, one `npm install` per project | N clones, N installs, N `AGENTS.md`s | 2 clones | `AGENTS.md` is 613 lines precisely because one clone must explain everything |
| Security / permissions | coarse (repo-level) | per-repo permissions, secret scoping | coarse for platform, fine for web | the only secret-bearing project is the API + DB tooling; the frontends need none |
| Release management | git history + per-project tags | registry + tags | mixed | `ENGINE_VERSION` is already a git short SHA; there is no release process |

### 17.3 Analysis

The coupling here is **not** code churn; it is **evidence churn**. Every material change in this repository crosses two or more candidate projects: a migration with its loader and writer, a scoring-model version with its goldens and its pin, a contract minor with two frontends' generated types, a seed with its data gate. A multi-repository split would require, for each of those, a coordinated release across repositories whose only shared artifact is a version number — and would put the decision log, the open-points register and the test map (all cross-project by nature) in exactly one repository by accident.

Against that, the genuine arguments for separate repositories are: independent release cadence for the frontends (already achieved by independent packaging), per-repo permissions (not needed: one owner, one deployable), and repository size (642 tracked files; not a problem).

The frontends are the one place where a split is *already* mostly real: own manifests, own lockfiles, own workflows, own docs, no shared code, and a one-directional dependency on the contract. They are the natural Option‑3 candidates.

### 17.4 Recommendation

**PROPOSED — Option 1 (modular monorepo) as the target, with Option 3 available later for the frontends only.**

Concretely:

1. **One repository.** Six projects with explicit directories, per-project manifests, per-project docs, per-project tests and per-project CI jobs.
2. **Extraction to separate repositories is DEFERRED** behind all three of these triggers:
   - the API contract is published as a versioned artifact (O3 in §15.3), so a frontend can build without a checkout;
   - the database has a versioned schema release (a tagged migration set), so an engine change can state which schema it requires;
   - at least two people own different projects, so per-repo permissions buy something.
3. **The frontends are the first candidates** if a split ever happens: they have the least coupling and no secrets.
4. **The database never leaves**: it is the schema authority for every other project and cannot be versioned independently of the engine that reads it without creating skew.

### 17.5 npm workspaces: evaluated and NOT adopted now

**CURRENT.** There is no `workspaces` key in `package.json`. Root `npm install` installs the engine's and the API's dependencies; `apps/web` and `apps/web-v2` install separately with their own lockfiles.

**Evaluation:**

| Question | Answer |
|---|---|
| Would workspaces fix the API's missing manifest? | **No.** Workspaces make a hoisted install convenient; they do not give the API an independent dependency set, and they would hide the very coupling this RFC is trying to make explicit. |
| Would workspaces help the engine? | **No.** It has zero runtime dependencies; there is nothing to hoist. |
| Would workspaces help the frontends? | **No, and it would hurt.** V1 pins next 16.4.2 and V2 pins 16.4.5; a single hoisted `node_modules` would have to resolve one version, and V2's engines floor (`^22.22.2 || ^24.15.0 || >=26`) differs from V1's (`>=22`). Both already install cleanly in isolation. |
| Would workspaces simplify CI? | Marginally — but it would also make one project's install failure block another's job, which the three-workflow split deliberately avoids (`web.yml` needs no secrets, `ci.yml` does). |
| What would it cost to adopt later? | Low, if each project has its own manifest: add `workspaces` at the root and a root lockfile. |

**DEFERRED with a trigger:** adopt workspaces when (a) two or more projects need the *same* third-party dependency at the *same* version, and (b) the duplication cost is measured (install time, lockfile drift) rather than assumed. Until then, per-project manifests + per-project lockfiles are the rule, and the API's manifest is the first one to add.

### 17.6 Risks of the monorepo choice

| Risk | Mitigation |
|---|---|
| Boundaries rot because nothing stops a cross-import | one boundary test per project (§9.3), each DB-free and cheap |
| One CI file becomes a bottleneck | already split into three workflows; add one job per project rather than one job for all |
| Repository size / clone time | 642 tracked files today; the archive is the growth vector, and it is already marked historical |
| A project cannot be released independently | per-project manifests + contract artifact (§15.3 O3) before any release cadence is promised |

---

## 18. Security and operational concerns

Every row states **CURRENT** behaviour first; the PROPOSED column is a recommendation, not an implementation.

| Concern | CURRENT (verified) | PROPOSED | Label |
|---|---|---|---|
| **Database ownership** | one PostgreSQL database (Neon), four logical layers, 3 environments (shared, TEST branch, EU) | unchanged; DATABASE project owns schema lifetime | PROPOSED |
| **Identity / authentication** | **none anywhere**: no signup, no session, no API key, no cookie. `docs/API.md` "What it is not" states it; R-16 is ACCEPTED by design | decide scope before any private/gated beta (D8). No auth is designed here | DECISION REQUIRED |
| **Authorization** | none (there is nothing to authorise) | follows authentication; per-user saved builds would be the first gated resource | DEFERRED |
| **DB privileges** | `morocco_pc_api` role with column-scoped grants; the EU host measurably uses it (`check-deployed-role` PASS); the retired demo ran as `neondb_owner` (FAIL) | keep least privilege as a release gate on every environment | CURRENT |
| **Secrets** | `.env` (never committed), GitHub repository secrets (`DATABASE_URL`, `TEST_DATABASE_URL`), Render `sync: false` variables, `~/.morocco-pc/*.password` files written by `apply-api-role.js` | unchanged; no secret in a project file, a log, or a chat | CURRENT |
| **Write safety** | shared-DB writes need a restore point and leave an audit line; write tests are TEST-only; the API refuses to start against shared unless `API_ALLOW_SHARED=1` | preserve verbatim through every step of §19 | CURRENT |
| **API protection** | per-IP rate limits, `TRUST_PROXY` pinned only from evidence (Decision 64), CORS disabled when `ALLOWED_ORIGINS` is empty | keep "empty = off, never open" | CURRENT |
| **Observability** | `request_id` on every error envelope; DSN-gated `@sentry/node`; JSON logs; `ENGINE_VERSION` in the boot line | PROPOSED: one correlation id across API → engine → DB session (`application_name` already tags the pool) | CURRENT/PROPOSED |
| **Error handling** | contract-defined envelope `{ error, message, request_id }`; 500 carries no internals | unchanged | CURRENT |
| **Caching / invalidation** | no HTTP cache; `catalog_version` content digest (21 tables) + preset shelf keyed on it; a content change hides the shelf until `generate-presets` runs (R-27) | decide the serve-stale-vs-nothing behaviour as an API contract change | CURRENT |
| **Catalog-version consistency** | digest computed on demand, never cached; NULL = UNKNOWN; dedupe treats NULL as a miss | unchanged | CURRENT |
| **Preset generation** | `scripts/generate-presets.js` with `--target-env`, restore point, FK-ordered cleanup, zero-build skip | owned by the API project, run as the last step of any import | CURRENT |
| **Offer freshness** | 30-day window for selection (Decision 7); freshness gate is INCONCLUSIVE on a seed catalog; waiver default OFF, forced ON by the beta API | keep the gate; the waiver is a beta decision (D3) | CURRENT |
| **Data provenance** | `VERIFIED` requires ingestion record + listing id + matching host + seller + non-future `fetched_at`; 0 of 114 offers qualify | ingestion project owns closing R-01 | CURRENT |
| **Backup / restore** | Neon restore points recorded per apply; `database/migration-applies.jsonl` is the audit trail | unchanged; document the restore drill per environment | CURRENT |
| **Deployment separation** | API = Docker/Render; V1 = Workers (configured, undeployed); V2 = nothing | one descriptor per deployable; retire `fly.toml` or `render.yaml` as a duplicate (D9) | DECISION REQUIRED |
| **Environment separation** | shared / TEST branch / EU; EU pinned to `launch-v2@2.4.0`; TEST is the only write target | unchanged; a staging environment is P3 Sprint 3 (NOT STARTED) | CURRENT |
| **CI/CD ownership** | `ci.yml` (2 jobs: push/PR + nightly), `web.yml`, `web-v2.yml`; no deploy step anywhere | one job group per project; a deploy step only after D9 | CURRENT/PROPOSED |
| **Dependency updates** | no Dependabot/renovate config; versions pinned by lockfiles (`pg ^8.23.0`, `fastify ^5.12.5`, next 16.4.2/16.4.5) | PROPOSED: per-project automated update PRs once manifests exist | PROPOSED |
| **Supply chain** | `npm ci` everywhere; no `npm audit` gate; Docker base `node:22-alpine` unpinned by digest | PROPOSED: audit gate per project + digest-pinned base image | PROPOSED |
| **Testing ownership** | engine 1 284 / scripts 571 / API 193 DB-free; 17 DB-backed; V1 38 Playwright spec files; V2 33 Vitest + 11 Playwright spec files | each project owns its suite; the root owns only the cross-project harnesses | CURRENT/PROPOSED |
| **Release versioning** | `engine_version` = git short SHA; `ENGINE_VERSION` env; contract version `1.10.0`; scoring model `name@version` | per-project version fields, contract version as the integration key | CURRENT/PROPOSED |

### 18.2 Authentication roadmap (explicitly not designed here)

**CURRENT:** there is no authentication, no account, no user table, no session store and no auth dependency. Saved builds in V1 are browser-local (localStorage). Every Layer 4 row is anonymous.

**PROPOSED sequencing** (each step needs an owner decision; none is designed in this RFC):

1. Decide whether accounts are in scope for the beta (D8). Until then nothing changes.
2. If accounts are in scope: the API owns identity, the database owns the user table and the ownership columns, and the frontend owns only the session cookie/flow.
3. Saved builds would become the first per-user resource, which is also the first authorization rule (a pass belongs to a user).
4. Rate limits stay per-IP for anonymous traffic; per-user limits are a separate bucket.

**Not claimed:** that authorization exists, that rate limiting is per-user, or that any endpoint is protected. None is true today.

### 18.4 Guard rails that no project split may weaken

1. A write test never targets the shared database.
2. A real-database write needs a restore point and leaves an audit line.
3. A committed migration is never edited.
4. `NULL` is UNKNOWN, never 0, and UNKNOWN is never PASS or FAIL.
5. A gate verdict is PASS / FAIL / INCONCLUSIVE; INCONCLUSIVE is never reported as a pass.
6. No credential is printed, committed, or pasted into a chat.
7. `npm run test:unit` stays DB-free.

### 18.5 What a project split would *newly* require

| New requirement | Why |
|---|---|
| a per-project boundary test | module boundaries exist today only for API→engine |
| a per-project install check in CI | to prove `apps/api` is independent once it has a manifest |
| a contract compatibility gate | §15.4 item 3 — drift is gated, compatibility is not |
| an owner per project in the docs | §21 as a whole; a boundary nobody owns is a suggestion |
| a documented deploy descriptor per deployable | today the V1 descriptor is undeployed and V2 has none |

---

## 19. Migration roadmap

### 19.0 Preconditions

No step below may begin until:

1. **this RFC is approved by the owner** (D1–D12 in §21 resolved or explicitly deferred);
2. an **independent reviewer** has read it (the same independence gap R-12 records for the golden assertions applies to an architecture approval);
3. `npm run test:unit`, `test:scripts`, `test:api` and `verify:docs --offline` are green on the base commit;
4. the owner has confirmed that **no step here is authorised to apply a migration, seed or role to any real database** — steps 3–5 touch files only.

Every step is independently reviewable as its own PR, and steps 6, 7 and 9 can run in parallel once step 3 has landed.

---

### Step 1 — Architecture approval

| | |
|---|---|
| **Goal** | an owner-approved boundary set and a named owner per project |
| **Scope** | this RFC; D1–D12 resolved or deferred; owners recorded |
| **Prerequisites** | independent review |
| **Projects affected** | all (decision only) |
| **Dependencies** | none |
| **Code changes** | none |
| **Documentation** | the RFC is merged with its decision outcomes; §21 becomes the record |
| **Testing / acceptance** | every DECISION REQUIRED row in §21 has an answer or a `DEFERRED` with a trigger |
| **Risks** | approving boundaries that the code cannot support — mitigated by §6's measured edges |
| **Rollback** | revert the RFC commit |
| **Out of scope** | any file move |

---

### Step 2 — Documentation cleanup

| | |
|---|---|
| **Goal** | root docs become navigation; each project owns its documentation; the stale figures are corrected by measurement |
| **Scope** | §16.5's disposition table, `AGENTS.md` rewrite to an index, per-project `README.md`/`docs/` |
| **Prerequisites** | step 1 (ownership must be named before docs are assigned) |
| **Projects affected** | all |
| **Dependencies** | none in code |
| **Code changes** | none |
| **Documentation** | the whole point; plus `verify-docs` count updates if any pinned count changes |
| **Testing / acceptance** | `verify:docs --offline`, `gen-decision-index --check`, `gen-schema-reference --check` all green; no figure in a doc that was not re-measured |
| **Risks** | moving a doc breaks a relative link — mitigated by a link check in the same PR; editing pinned counts breaks `verify-docs` by design |
| **Rollback** | revert the PR; docs are the only artifact |
| **Out of scope** | changing any code, test or workflow; changing any measured figure without re-running it |

---

### Step 3 — Recommendation-engine extraction

| | |
|---|---|
| **Goal** | `packages/recommendation-engine/` owns the twelve stages; the tree proves the package has zero third-party dependencies |
| **Scope** | move `src/recommendation/{assembly,candidates,compatibility,explanation,filtering,offers,orchestrator,persistence,query,ranking,retention,scoring}` (ingestion stays for step 5); add a manifest with no dependencies; add `README.md` + the purity/boundary test |
| **Prerequisites** | step 1; step 2 for the doc links |
| **Projects affected** | engine, API (consumer path), 12 measurement scripts, `test/golden` harnesses |
| **Dependencies** | none outward; consumes nothing |
| **Code changes** | path updates only: `apps/api/src/engine.js` (6 requires), `scripts/measure-*.js`, `scripts/eval-scenarios.js`, `scripts/verify-pool-independence.js`, `scripts/generate-presets.js` |
| **Documentation** | engine `README.md`/`ARCHITECTURE.md` links; `AGENTS.md` map row |
| **Testing / acceptance** | `test:unit` = 1 284 pass / 0 fail; `test:api` = 193; `test:scripts` = 571; a new zero-dependency assertion passes; `git diff` shows no logic change in any stage file |
| **Risks** | a stale relative path in a harness that only runs nightly (mitigated by running `test:scripts` and one harness); a `require` cycle introduced by the move (mitigated by moving the directory as a unit) |
| **Rollback** | `git revert` the single move commit; no data or deploy involved |
| **Out of scope** | splitting pure and runtime; changing any stage's behaviour; adding a version number |

---

### Step 4 — Database / data-platform ownership

| | |
|---|---|
| **Goal** | `database/` becomes an owned project with its lifecycle tooling and guards; the generated mirrors are produced there |
| **Scope** | move `db-url.js`, `run-migrations.js`, `run-seeds.js`, `verify-migrations-replay.js`, `check-target-parity.js`, `gen-schema-reference.js`, `cleanup-layer4.js` and their `scripts/lib` helpers under `database/tooling/`; add `database/README.md` and lifecycle docs |
| **Prerequisites** | step 2 (so the docs land where they are linked) |
| **Projects affected** | database, API (guard import), ingestion (guard import), CI (`ci.yml` step paths) |
| **Dependencies** | none outward |
| **Code changes** | import paths in `apps/api/src/db.js`, `scripts/apply-api-role.js`, `apply-seed.js`, `check-deployed-role.js`, `check-target-parity.js`, `cleanup-layer4.js`, plus `apps/api/Dockerfile` `COPY` |
| **Documentation** | lifecycle/roles/restore docs; the recipe files move with the tooling |
| **Testing / acceptance** | `test:scripts` = 571; `run-migrations --check` unchanged; `verify:replay --test-db` still 0 drift; the Docker image still starts and answers `/v1/health` |
| **Risks** | breaking the guard import in the image (mitigated by the health check in the same PR); editing a pinned doc count |
| **Rollback** | revert the move commit + the `COPY` line together |
| **Out of scope** | applying anything to a database; changing a migration; changing a guard's behaviour |

---

### Step 5 — Ingestion separation

| | |
|---|---|
| **Goal** | `apps/offer-ingestion/` owns import, identity, adapters and the three offer gates; the engine package contains no operator write path |
| **Scope** | move `src/recommendation/ingestion/` (8 modules + 5 test files), `scripts/ingest-offers.js`, `scripts/check-offer-{provenance,freshness,coverage}.js` and `scripts/lib/{ingest-args,offer-provenance,offer-freshness,offer-coverage}.js`; add a manifest, a README, an adapters doc and a boundary test |
| **Prerequisites** | step 3 (the engine must no longer contain it), step 4 (the guard import path) |
| **Projects affected** | ingestion, engine, database (gates move out), CI (gate step paths) |
| **Dependencies** | ingestion may read the schema and use the guard; it may import no engine stage |
| **Code changes** | paths only in the CLI and the gates; **no** identity or promotion logic change |
| **Documentation** | `docs/ingestion/PIPELINE_DESIGN.md` moves here; `docs/RECIPES/import-offers.md` moves here |
| **Testing / acceptance** | the 5 ingestion unit suites + 4 CLI/pure suites pass unchanged; a boundary test proves zero engine imports; `check-offer-provenance` still answers INCONCLUSIVE on a seed catalog and never PASS |
| **Risks** | moving a gate out of `ci.yml` changes what runs nightly (mitigated by updating `ci.yml` in the same PR and re-running `test:scripts`, which pins workflow shape via `ci-workflow.test.js`) |
| **Rollback** | revert the move; gates return to `scripts/` |
| **Out of scope** | adding a retailer adapter; running an import; changing provenance definitions |

---

### Step 6 — API independent packaging

| | |
|---|---|
| **Goal** | `cd apps/api && npm ci && npm test` works with no root `node_modules` **and** `docker build -f apps/api/Dockerfile apps/api` starts and answers `/v1/health` |
| **Scope** | add `apps/api/package.json` + lockfile; declare engine and guard as `file:` dependencies; adjust the Dockerfile context; keep `engine.js`, `repository.js`, `db.js` behaviour identical |
| **Prerequisites** | step 3 (engine package), step 4 (guard location) |
| **Projects affected** | API, engine (consumed), database (consumed) |
| **Dependencies** | engine (barrels only), guard |
| **Code changes** | dependency declarations and Docker `COPY`/context; **no** route, contract or SQL change |
| **Documentation** | API `README.md` install/run; `docs/RECIPES/deploy-eu-colocation.md` build context |
| **Testing / acceptance** | `test:api` 193 and `test:api:db` 17 pass from inside `apps/api`; the image answers `/v1/health` with `db: "ok"` against TEST; `import-boundary.test.js` still green |
| **Risks** | a `file:` dependency that Docker cannot resolve outside the repo root (mitigated by building the image before merging); two copies of `pg` (mitigated by the existing "pg only in db.js" assertion plus a module-resolution check) |
| **Rollback** | delete the manifest and restore the Dockerfile; the root install still works |
| **Out of scope** | publishing the API; changing the contract; adding an auth layer |

---

### Step 7 — Contract publication

| | |
|---|---|
| **Goal** | one authoritative, versioned contract at a path owned by the API project, consumed by both frontends, with a compatibility gate |
| **Scope** | §15.4: `contract/openapi-1.10.0.json`; snapshot test path; both generators; both CI filters; the compatibility-diff gate |
| **Prerequisites** | step 1 (D2 decided), step 6 (an owner for the artifact) |
| **Projects affected** | API, web V1, web V2, CI |
| **Dependencies** | API owns it; frontends consume it |
| **Code changes** | paths in `apps/web/package.json`, `apps/web-v2/package.json`, `apps/web/scripts/check-api-types.mjs`, `apps/web-v2/scripts/{api-types,check-api-types}.mjs`, `openapi-snapshot.test.js`; the two workflow filters |
| **Documentation** | `docs/api/CONTRACT.md` versioning policy (§15.5); V1's stale `openapi-v1.6.json` references corrected |
| **Testing / acceptance** | `openapi-snapshot.test.js` byte-compares the served document against the new path; both `check:api-types` pass; the compatibility gate reports ADDITIVE for a sample additive change and BREAKING for a sample removal |
| **Risks** | a forgotten path reference leaves a frontend generating from a missing file (mitigated by running both apps' gates, which fail loudly) |
| **Rollback** | revert to `apps/api/test/unit/openapi-v1.10.json` and the four path references |
| **Out of scope** | publishing to a registry; a major version bump; any schema change |

---

### Step 8 — V2 joins the main flow

| | |
|---|---|
| **Goal** | `apps/web-v2` exists on `master` as an application-only addition, on the current contract, with its own workflow green |
| **Scope** | port `apps/web-v2` + `.github/workflows/web-v2.yml` from `feature/v2-design`; **discard** that branch's copies of `src/`, `database/`, `apps/api`, `apps/web`, `scripts/` and the root docs; regenerate `lib/api/schema.d.ts` from the master contract |
| **Prerequisites** | step 7 (the contract path must be stable) |
| **Projects affected** | V2, CI |
| **Dependencies** | the contract; the API's `/v1` routes |
| **Code changes** | none inside V2's components; only the contract path and the generated file |
| **Documentation** | V2 README's contract path; root project index |
| **Testing / acceptance** | `typecheck`, `lint`, `format:check`, `check:api-types`, `npm test`, `build`, `test:e2e` all green on `master`; no V1 file changed |
| **Risks** | a partial port that silently imports from the branch's platform copy (mitigated by the boundary test and by `git diff --stat` proving only `apps/web-v2/**` + the workflow changed) |
| **Rollback** | revert the merge commit; V2 returns to its branch |
| **Out of scope** | merging `feature/v2-design` wholesale; rebasing it; V1 changes; any deployment |

---

### Step 9 — V1 → V2 feature parity

| | |
|---|---|
| **Goal** | every capability in the owner's retained set (§14.6 / D5) exists on V2 with tests |
| **Scope** | V2 routes for results, catalogue, compare, swap, saved builds, guides, legal, SEO/crawl, analytics — each consuming the existing contract |
| **Prerequisites** | step 8; D4 and D5 decided |
| **Projects affected** | V2, API (only if a retained capability needs a contract addition) |
| **Dependencies** | the contract; API routes that already exist (v1.10 covers swap, catalog, price history) |
| **Code changes** | V2 only, except additive contract changes |
| **Documentation** | the parity matrix becomes V2's `docs/PARITY.md`, updated per PR |
| **Testing / acceptance** | the parity matrix has no `missing` row inside the retained set; V2's suite grows to cover each capability; axe + Lighthouse budgets met |
| **Risks** | scope creep into new features (mitigated by the "retained set" decision); contract additions that V1 also consumes (mitigated by the compatibility gate) |
| **Rollback** | per-capability revert; V1 remains live throughout |
| **Out of scope** | retiring V1; new product features |

---

### Step 10 — V2 deployment and cutover

| | |
|---|---|
| **Goal** | V2 is deployed, calls a real API origin, and serves the public site |
| **Scope** | a deploy descriptor for V2 (D9), `ALLOWED_ORIGINS` on the API, a real corpus in the frontend's build, crawl surface live |
| **Prerequisites** | step 9; D9 decided; an always-on or acceptably cold API origin (R-08) |
| **Projects affected** | V2, API (CORS), ops |
| **Dependencies** | hosting provider, DNS, API origin |
| **Code changes** | deploy config + environment wiring; no application logic |
| **Documentation** | V2 operations doc; the deploy recipe |
| **Testing / acceptance** | `verify-real-api.mjs` against the deployed pair; health 200; a real pass rendered from real data; CORS allows only the real origin; `ALLOWED_ORIGINS` never wildcard |
| **Risks** | a free-plan API that sleeps 15 minutes makes first paint slow (R-08) — this is a known, measured state |
| **Rollback** | keep V1 live; unpublish V2 |
| **Out of scope** | deleting V1; changing the API's hosting plan |

---

### Step 11 — V1 retirement

| | |
|---|---|
| **Goal** | one frontend in the tree and one deployed site |
| **Scope** | delete `apps/web` + its workflow once every retained capability is green and deployed on V2; archive its design docs |
| **Prerequisites** | step 10 (a deployed V2 with traffic) |
| **Projects affected** | V1, CI, docs |
| **Dependencies** | none |
| **Code changes** | deletion only |
| **Documentation** | archive V1's plan/design docs with `Superseded by:` headers |
| **Testing / acceptance** | V2's suite covers the retained set; no root doc links into `apps/web` |
| **Risks** | losing an undocumented V1 behaviour (mitigated by the parity matrix being the deletion checklist) |
| **Rollback** | restore from git; the workflow returns |
| **Out of scope** | deleting V1 while any retained capability is missing on V2 |

---

### Step 12 — Optional multi-repository extraction

| | |
|---|---|
| **Goal** | only if the triggers in §17.4 fire: move the frontends (first) and possibly the engine to their own repositories |
| **Scope** | repository split + artifact publication + cross-repo gates |
| **Prerequisites** | published contract artifact; versioned schema release; a second owner |
| **Projects affected** | whichever moves |
| **Dependencies** | the triggers, not a date |
| **Code changes** | import/reference rewrites to published artifacts |
| **Documentation** | a new root index pointing at the repositories |
| **Testing / acceptance** | the moved project builds from its own repository with no checkout of this one |
| **Risks** | the version-skew window becomes real; the register/decision log lives in one place by accident |
| **Rollback** | re-import as a directory |
| **Out of scope** | splitting the database |

### 19.1 Ordering summary

```
1 approval ──► 2 docs ──► 3 engine ──► 5 ingestion ──┐
                  │            │                    ├──► 8 V2 lands ──► 9 parity ──► 10 deploy ──► 11 retire V1
                  └──► 4 database ──► 6 API ──► 7 contract ──┘
                                                        └──► 12 multi-repo (optional, trigger-gated)
```

Steps 3 and 4 can run in parallel after step 2. Steps 6 and 7 depend on 3+4. Step 8 depends on 7. Step 9 depends on 8. Step 10 depends on 9 and on D9. Step 11 depends on 10.
---

## 20. Risks and rollback strategy

### 20.1 Programme-level risks

| # | Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|---|
| K1 | **Boundaries are agreed but not enforced**, so they rot within two sprints | High | Medium | one DB-free boundary test per project, in the same PR that creates the project | delete the failing test only if the boundary decision itself changes (never to unblock) |
| K2 | **A move breaks a nightly-only path** (replay, `test:api:db`, a measurement harness) that push/PR CI never exercises | Medium | High | run `test:scripts`, `verify:replay --test-db` and one measurement harness in the move PR | revert the move commit; the old paths return |
| K3 | **The V2 landing imports the branch's platform copy** and silently reverts master files | Medium | High | `git diff --stat` of the port must touch only `apps/web-v2/**` + its workflow; review line by line | revert the merge commit |
| K4 | **A doc rewrite changes a measured figure** without re-measuring | High | Medium | §16.6's rule + `verify:docs` + a diff review that treats a changed number as a claim | revert that doc hunk |
| K5 | **The API package split changes runtime behaviour** (a second `pg`, a different guard) | Medium | High | the image health check + `test:api:db` from inside `apps/api` before merge | revert the manifest/Dockerfile pair together |
| K6 | **The contract move leaves one consumer generating from a stale or missing file** | Medium | Medium | both frontends' `check:api-types` run in their own workflows and fail loudly | revert the path change |
| K7 | **Write-safety erosion** — a step touches a real database "to verify" | Low | Critical | §19.0 item 4; no roadmap step is authorised to write; guards stay in every step | restore point + audited revert, owner-only |
| K8 | **Owner decisions are postponed** and steps silently pick a boundary | Medium | High | §21 marks the blocked steps; a step whose decision is deferred does not start | n/a (avoided by sequencing) |
| K9 | **Two frontends diverge further** while parity is pending | High | Medium | freeze V1 to fixes; keep the parity matrix live in V2's docs | n/a |
| K10 | **The programme becomes a rewrite** (new architecture instead of separation) | Medium | High | every step's "out of scope" line; §19.0 approval gate; the engine's behaviour is frozen by 1 284 tests | revert the step |

### 20.2 Rollback principles

1. **No step mixes a move with a behaviour change.** A move PR must show no logic diff; a behaviour PR must show no path churn. This is what makes every rollback a single `git revert`.
2. **No step writes to a database.** The only database-touching actions in the roadmap are running existing gates (read-only) and, later, an operator-run import that has its own restore point.
3. **No step deploys.** Deployment is step 10, blocked on D9, and reversible by unpublishing.
4. **The recovery ref exists before any history-changing action.** The 2026-11-10 contract revert kept `backup/master-before-contract-revert` (`90dc99b`) precisely because a force-push is not a reviewable change; that ref should be deleted only after the contract decision in step 7 is settled.

### 20.3 What would make this RFC wrong

Stated so a reviewer can attack it:

- If the owner decides accounts and per-user data are in scope for the beta, §18.2 moves from step 0 to a P0 project and the API's ownership of identity needs a decision earlier than planned.
- If the retrieval of real offers (R-01) lands before any of §19, ingestion's project boundary is validated earlier and should be pulled forward to step 3.
- If V1 is declared the product and V2 an experiment, §14's conclusion inverts and steps 8–11 are withdrawn.
- If a second consumer needs the pure computation without a database, §11.3's rejection is re-opened at `compatibility/`.

---

## 21. Owner decisions required

Each row is a question code inspection cannot settle. Recommendation, trade-offs and the cost of postponement are given; **none of these is decided by this RFC.**

### D1 — Monorepo or multiple repositories?

- **Options:** modular monorepo (one repo) · multi-repo · hybrid (frontends separate).
- **Recommended:** modular monorepo now; hybrid available later for the frontends only (§17.4).
- **Advantages:** one PR can change schema + engine + API + contract + both frontends; one decision log, one register, one test map; no registry needed.
- **Disadvantages:** coarse permissions; one clone; boundaries live in tests rather than in infrastructure.
- **Cost of postponement:** every later step has to guess; the documentation-cleanup PR cannot assign ownership; steps 2–11 stall.

### D2 — Where does the API contract live, and is it published?

- **Options:** in place under `apps/api/test/unit/` · a versioned `contract/` directory · a published release artifact · an internal package (§15.3).
- **Recommended:** a versioned `contract/` directory now (O2), a release artifact later (O3), plus a compatibility gate; a package is rejected.
- **Advantages:** one authoritative document with a stable address two frontends can name; drift and compatibility become separate gates.
- **Disadvantages:** one more path to keep referenced; the artifact publication needs a release process that does not exist.
- **Cost of postponement:** every contract minor keeps a *test* directory as its publication point; the missing compatibility gate stays missing; a future refactor can move a public artifact.

### D3 — Do the beta's prices stay unverified, and is the seed-offer waiver stay-on?

- **Options:** keep `allow_unverified_seed_offers: true` for the beta (today's frozen behaviour) · turn it off and accept the 2026-11-17 / 2026-11-26 / 2026-12-01 cliffs · replace the catalogue with verified offers (R-01).
- **Recommended:** keep it on until R-01 delivers per-role verified coverage; then turn it off with a dated announcement.
- **Advantages:** the beta keeps answering; no silent empty results.
- **Disadvantages:** prices are labelled unverified; the catalogue's honesty rests on the label.
- **Cost of postponement:** the cliff dates arrive with no decision; a future deploy flips a default nobody reviewed.

### D4 — Is V2 the single future frontend?

- **Options:** V2 becomes the frontend (V1 retired) · V1 remains, V2 becomes a design reference · both are maintained.
- **Recommended:** V2 becomes the frontend; V1 frozen and retired per §19 step 11.
- **Advantages:** one design system, one test suite, one crawl surface to maintain.
- **Disadvantages:** V2 currently has 3 route files against V1's 19; parity is real work; V2 has never called a deployed API.
- **Cost of postponement:** two apps keep diverging (V1 next 16.4.2, V2 next 16.4.5), and every contract minor is validated twice.

### D5 — Which V1 capabilities must be retained?

- **Options:** everything in §14.2 · a named subset (e.g. wizard + results + saved + catalogue) · a minimal set (wizard + results).
- **Recommended:** everything except the `noindex` proof sheets (`format`, `kit`, `tokens`).
- **Advantages:** nothing silently disappears at cutover; the parity matrix becomes a deletion checklist.
- **Disadvantages:** saved builds, compare and price history each need a V2 implementation.
- **Cost of postponement:** step 9 has no definition of done; step 11 cannot start.

### D6 — Does the database become a separately owned project?

- **Options:** a directory with an owner inside the repo (recommended) · a package · a separate repository.
- **Advantages (recommended):** schema lifetime, guards, replay and generated mirrors get one owner; migrations stay coupled to the code that reads them.
- **Disadvantages:** it is not independently releasable.
- **Cost of postponement:** the guard keeps living in `scripts/lib/` while the API imports it; nobody owns the replay gate.

### D7 — Does ingestion become a scheduled service or stay an operator job?

- **Options:** operator-run CLI (today) · a scheduled worker that fetches retailer pages · a service with a queue.
- **Recommended:** operator CLI now; a scheduled worker only after one real retailer is proven (R-01).
- **Advantages:** no scraping infrastructure, no credentials, no legal exposure added before the identity problem is solved.
- **Disadvantages:** catalogues stay stale between manual runs.
- **Cost of postponement:** none for the separation itself; ingestion can be extracted as an app regardless.

### D8 — Are accounts in scope, and for what?

- **Options:** no accounts (today) · accounts for saved builds only · accounts with paid tiers.
- **Recommended:** no accounts until the beta exits; decide before any private/gated surface.
- **Advantages:** the API stays stateless and unauthenticated; nothing to secure.
- **Disadvantages:** saved builds stay browser-local; no per-user data.
- **Cost of postponement:** an authentication design becomes a P0 project at the worst possible moment (during a cutover).

### D9 — Which provider hosts the API and the frontend?

- **Options (API):** Render (live today, free plan, sleeps) · Fly (`fly.toml` present, unused) · another.
- **Options (frontend):** Cloudflare Workers/OpenNext (V1 configured) · Vercel · another.
- **Recommended:** one API platform (the live Render EU service, on a paid plan before measuring V1 latency — R-08) and Cloudflare Workers for V2, matching V1's existing adapter; delete the unused descriptor.
- **Advantages:** three deploy mechanisms become two; the API's region stays co-located with the EU database.
- **Disadvantages:** free-plan cold starts remain a product constraint until a plan change.
- **Cost of postponement:** `fly.toml` and `render.yaml` both claim the API; V2 has no deploy path at all, so cutover cannot start.

### D10 — Who owns each project's releases?

- **Options:** one owner for everything · a named owner per project · owners per layer (engine/database vs applications).
- **Recommended:** a named owner per project as the projects are created (step 1 records them).
- **Advantages:** §18's "owner per project" becomes real; the register's owner column stops defaulting to "owner".
- **Disadvantages:** one person may hold several projects initially.
- **Cost of postponement:** boundaries stay advisory.

### D11 — Does the platform need a same-origin API gateway or BFF?

- **Options:** direct cross-origin calls with CORS (V2 today) · a relative proxy in the frontend (V1's `next.config.ts` rewrite) · a dedicated BFF.
- **Recommended:** per-frontend rewrite/proxy (V1's existing pattern) until a BFF has a demonstrated need; never a wildcard CORS.
- **Advantages:** no third deployable; CORS stays closed; the browser origin stays the site's own.
- **Disadvantages:** each frontend owns its own proxy configuration; a production rewrite is baked at build time.
- **Cost of postponement:** V2 would either need CORS opened or would be deployed without a proxy decision.

### D12 — Do the two frontends share a design system?

- **Options:** no sharing (today) · a shared `packages/design-system` · V2 absorbs V1's kit at parity time.
- **Recommended:** no sharing while V1 is frozen; revisit only if V1 is retired and another surface appears.
- **Advantages:** a frozen app is not coupled to an active one; V2's tokens are documented independently.
- **Disadvantages:** two token sets and two component kits exist for a while.
- **Cost of postponement:** none — the current state is the recommended state.

---

## 22. Acceptance criteria

### 22.1 For this RFC itself

| # | Criterion | State |
|---|---|---|
| A1 | Every material claim is labelled CURRENT / PROPOSED / DECISION REQUIRED / DEFERRED / UNKNOWN | met |
| A2 | Every CURRENT claim cites a path, a test, a workflow, a measured command or git history | met (§23) |
| A3 | Current project boundaries and their weaknesses are stated with evidence, not impression | met (§3, §6.4) |
| A4 | The target architecture names six projects, each with responsibility, interface and prohibitions | met (§7, §8, §9) |
| A5 | Monorepo vs multi-repo vs hybrid is compared on named axes and one recommendation is made | met (§17) |
| A6 | Workspaces are evaluated, not assumed | met (§17.5) |
| A7 | The contract strategy preserves exactly one authoritative document | met (§15) |
| A8 | Documentation ownership specifies root vs project and disposes of every existing document | met (§16) |
| A9 | The roadmap has 12 ordered steps with prerequisites, acceptance, risks, rollback and out-of-scope | met (§19) |
| A10 | Owner decisions are listed with options, recommendation, trade-offs and cost of postponement | met (§21) |
| A11 | V1 and V2 are never conflated; the parity matrix is explicit | met (§14) |
| A12 | No application, database, test, workflow, manifest or lockfile changed in this PR | to be verified at the PR (§23.5) |
| A13 | `git diff --check` is clean | to be verified at the PR |

### 22.2 For the programme (definition of done per project, PROPOSED)

A project is "separated" when all of the following are true:

1. its directory has a `README.md` stating its responsibility and its prohibited imports;
2. it has a manifest (if it has third-party dependencies) and can be installed from its own directory;
3. its tests run from its own directory and are referenced from the root index;
4. a boundary test enforces its prohibited imports;
5. its CI job can fail without failing another project's job;
6. its docs cover interface, environment, operations and known limitations;
7. its owner is named in the root index.

---

## 23. Source references and evidence

### 23.1 Repository state inspected

| Item | Value | How |
|---|---|---|
| `master` | `a413f25` ("Merge pull request #18 …") | `git rev-parse origin/master` |
| `feature/v2-design` | `3bc0605` | `git rev-parse origin/feature/v2-design` |
| Divergence | master 35 / V2 101 commits; merge-base `868b60d` (PR #14) | `git rev-list --left-right --count origin/master...origin/feature/v2-design` + `git merge-base` |
| Tracked files | 642 total · 168 under `apps/web` · 55 under `apps/api` · 203 under `apps/web-v2` (branch) | `git ls-tree -r --name-only` |
| Working branch for this RFC | `architecture/system-separation-rfc` off `origin/master` | `git checkout -b` |

### 23.2 Commands run (read-only, no database contact)

| Command | Result used in |
|---|---|
| `npm run test:unit` | 1 284 tests, all pass (§2.3, §19 step 3 acceptance) |
| `npm run test:scripts` | 571 tests, all pass (§1.2 F10, §23.4) |
| `npm run test:api` | 193 tests, all pass (§2.3) |
| dependency scan over `src/recommendation` and `apps/api` | §5.2, §6.3, F1–F3 |
| `grep -rn "require('pg')" src/recommendation` | 24 files, all `*.test.js` → the engine has zero third-party runtime deps |
| `grep -rl "db\.query\|client\.query" src/recommendation` | 18 non-test files → loaders/persistence/orchestrator inventory |
| line counts per stage | §6.1 (80 non-test modules, 18 297 lines) |
| `git show origin/feature/v2-design:…` for V2 manifests, routes, docs, workflow | §14, §17.5 |
| `git ls-tree` inventories of `database/`, `scripts/`, `apps/api`, `apps/web` | §3.1, §10.1 |

No database connection was opened, no migration, seed, role or gate was applied, and no credential was read or printed.

### 23.3 Key file references

| Claim | Reference |
|---|---|
| API may reach the engine only through `engine.js`, six barrels | `apps/api/test/unit/import-boundary.test.js` (assertions 1–5) |
| `pg` only in `db.js` | same file, assertion 4 |
| API imports the write guard | `apps/api/src/db.js:26` |
| API has no manifest | `git ls-tree apps/api` (no `package.json`); `apps/api/Dockerfile:8-12` |
| Docker build context is the repo root | `apps/api/Dockerfile:1-6,33-40`; `render.yaml` (`dockerContext: .`) |
| Engine barrels and their exports | `src/recommendation/*/index.js` (§6.1) |
| `persistence/` has no barrel | `docs/ARCHITECTURE.md`, `AGENTS.md` §4, `TEST_MAP.md` |
| Ingestion is not a stage | `src/recommendation/ingestion/index.js:1-13` |
| Cross-stage imports | §6.3 (file:line) |
| Contract snapshot | `apps/api/test/unit/openapi-v1.10.json`; `openapi-snapshot.test.js`; `openapi-coverage.test.js` |
| Frontends generate from the snapshot | `apps/web/package.json` (`gen:api-types`), `apps/web-v2/package.json`, `.github/workflows/web.yml`, `.github/workflows/web-v2.yml` |
| V1 route inventory | `apps/web/app/[locale]/**/page.tsx` (19 route files) |
| V2 route inventory | `apps/web-v2/app/[locale]/{layout,page,configurateur/page}.tsx` on `feature/v2-design` |
| V2 performs only GETs | `apps/web-v2/README.md` status block |
| V2 has no deploy descriptor | `git ls-tree apps/web-v2` on `feature/v2-design` (no wrangler/open-next/Dockerfile) |
| V1 deploy descriptor | `apps/web/wrangler.jsonc`, `apps/web/open-next.config.ts`, `apps/web/next.config.ts` (rewrites) |
| Data layers | `README.md`, `CONTEXT.md` §1, `docs/SCHEMA_REFERENCE.md` |
| Migration count and ledger rules | `database/migrations/001…023`, `scripts/run-migrations.js`, `database/migration-applies.jsonl` |
| Guards and their tests | `scripts/lib/db-url.js`, `run-migrations-cli.test.js`, `db-guard.test.js` |
| Role and deployed-credential proof | `scripts/{apply,rehearse,smoke}-api-role.js`, `scripts/check-deployed-role.js` |
| Ingestion contract and rejection codes | `docs/PIPELINE_DESIGN.md`, `docs/HANDOFF_2026-11-07.md` §2.4, `docs/OPEN_POINTS.md` R-01 |
| Open points | `docs/OPEN_POINTS.md` (R-01 … R-30) |
| Decisions | `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (63 `## Decision` headings, 69 `Status:` lines) |
| CI jobs | `.github/workflows/ci.yml` (2 jobs), `web.yml`, `web-v2.yml` |
| Deployment descriptors | `render.yaml`, `fly.toml`, `apps/api/Dockerfile` |
| Historical contract-extraction attempt | PR #22, merge commit `90dc99b`; removed from `master` on 2026-11-10; preserved at `backup/master-before-contract-revert` |

### 23.4 Contradictions recorded (not silently resolved)

| # | Document says | Tree says | Handling |
|---|---|---|---|
| C1 | `README.md` quick start: `test:scripts` "479"; `CONTEXT.md` §5: "479" | measured **571** today; `AGENTS.md` §6 also says 571 | recorded here; corrected by the documentation-cleanup PR (§16.5) with a re-measurement, not by this RFC |
| C2 | `README.md:62`: "62 decisions" | 63 `## Decision` headings in the log; `README.md` also pins counts elsewhere | recorded; the cleanup PR re-measures |
| C3 | `apps/web/README.md:7` and `apps/web/lib/api/client.ts:5`: generated from `apps/api/test/unit/openapi-v1.6.json` | `apps/web/package.json` generates from `openapi-v1.10.json`; no `v1.6.json` exists | recorded; V1 doc drift (§16.5) |
| C4 | `CONTEXT.md` §2 and `AGENTS.md` §5: "Engine stages are pure" | true of stage functions; `filtering`/`query`/`scoring`/`offers` barrels also export DB loaders | resolved by §6.2 — the claim is about functions, not barrels; this RFC states the distinction |
| C5 | `docs/HANDOFF_2026-11-07.md` §9: "Measured suite counts are 1284 unit / 479 scripts / 193 API" | 1 284 / **571** / 193 measured today | recorded; the handoff is a dated snapshot and is PROPOSED for archive |
| C6 | `fly.toml` declares an always-on API service named `morocco-pc-api` | `CONTEXT.md`/`ROADMAP.md` describe one live origin, on Render; no Fly evidence | **UNKNOWN** — which descriptor is authoritative is D9 |
| C7 | `CONTEXT.md` §1: "44 tables" | `docs/SCHEMA_REFERENCE.md` is the generated mirror; table count is instance-derived | not contradictory; the generated document is the machine-checked one (`verify-docs --live`) |
| C8 | `apps/web/README.md` routes section lists the V1 surface | V1 now also has `enregistrements`, catalogue, compare, swap, `[presetSlug]` | recorded; V1's README is stale beyond the contract path |

### 23.5 No-code-change confirmation

This pull request adds exactly one file, `docs/architecture/SYSTEM_ARCHITECTURE_AND_PROJECT_SEPARATION_RFC.md`. It:

- does not modify any source file under `src/`, `apps/api/`, `apps/web/` or `apps/web-v2/`;
- does not add, remove or change any `package.json` or lockfile;
- does not change any file under `.github/workflows/`;
- does not modify any migration, seed or the audit log;
- does not modify any test;
- does not merge, rebase or cherry-pick `feature/v2-design`;
- does not connect to a database, run a database script, or deploy anything;
- does not begin the documentation-cleanup PR, the Phase 1 implementation, or any step of §19.

Verification expected on the PR: `git diff --stat origin/master...HEAD` lists one file; `git diff --check` is clean; `npm run test:unit`, `test:scripts`, `test:api` and `node scripts/verify-docs.js --offline` are unaffected by a docs-only addition, with the caveat that `verify-docs` parses certain documents and this new file is deliberately not one of them (it introduces no heading or count that gate reads).

---

## 24. Appendix — decisions and terms this RFC builds on

| Reference | Relevance here |
|---|---|
| Decision 26 / 45 (E8) | the compatibility rule table that makes `compatibility/` the cleanest pure extraction candidate (§11.3) |
| Decision 27 | cheapest-per-role reservation — engine behaviour frozen by this RFC |
| Decision 34 / 65 | offer identity and provenance-first selection — the boundary ingestion owns (§12) |
| Decision 35 | seed-offer freshness waiver — D3 |
| Decision 36 | the API as a thin layer owning no engine logic (§13) |
| Decision 47 | `catalog_version` content digest — the reason one database, not four (§4.3) |
| Decision 55 / 56 | swap preview and committed swap — contract v1.8/v1.10 capabilities V2 does not yet use (§14.2) |
| Decision 62 / 63 | scoring-model pin mechanism and the provisional beta pin — separate from the contract version (§15.5) |
| Decision 64 | `TRUST_PROXY` empty on Render — §18 |
| R-12 (register) | the independence gap for approved golden assertions; the same standard is applied to this RFC's approval (§19.0) |
| R-01, R-16, R-27, R-30 (register) | real-offer coverage, no authentication, preset-shelf invalidation, per-role coverage — the open points that most constrain the target architecture |

---

*This RFC is a proposal awaiting owner approval and independent review. It has not been independently reviewed by its author's organisation, and nothing in it should be read as an approval of any boundary it recommends.*
