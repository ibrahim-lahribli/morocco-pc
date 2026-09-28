# CONTEXT.md

Canonical project context for `morocco-pc`, optimized for AI coding agents. Operational lessons live separately in `DEVELOPMENT_NOTES.md`; this file changes only when the architecture or status actually changes.

## AI QUICK START

1. Read `CONTEXT.md`.
2. Read `DEVELOPMENT_NOTES.md`.
3. Check `git status`.
4. Inspect the relevant migration/test files before changing anything.
5. Never expose `.env`.
6. Never reset/drop the shared Neon database.
7. Never rewrite committed migrations.
8. Use a new migration for schema changes.
9. Run targeted tests first.
10. Report PASS/FAIL/BLOCKED honestly.

## PROJECT

`morocco-pc` is a PC build recommendation platform built for the Moroccan market. It recommends complete PC builds based on budget, use case, resolution, priorities, component compatibility, product performance/value, upgradeability, and availability/pricing. Requirements are captured as recommendation profiles and queries; the engine assembles candidate builds and returns ranked, traceable results.

## CURRENT STATUS

Implemented:
- **Layer 1 — Catalog / Hardware**: complete schema — identity, hardware specs, explicit compatibility, provenance. Migrations 003–007.
- **Layer 2 — Performance / Assessment**: schema (`benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model`). Migration 008. Minimal seed data present (25 assessments + `scoring_model seed-minimal-v1/1.0.0` + minimal benchmark provenance: 1 `benchmark_source` (`Seed TechPowerUp`), 1 `benchmark` (`Seed Cinebench R23 Multi`), 2 `benchmark_result` rows); Engine 4 scoring implemented (Decision 13 STEP 1-3 + Decision 15; the UNKNOWN-pairwise count is a build-local re-evaluation per Decision 23 O2). Real-market benchmark data remains unseeded.
- **Layer 3 — Market**: canonical schema (`store`, `store_offer`, `price_history`) reconciled to the live database. Migrations 009–010.
- **Layer 4 — Recommendation**: canonical schema (`recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component` + `component_role` enum) reconciled to the live database. Migration 011 applied and catalog-verified. All five Layer 4 tables are empty in the shared dev database (no full run has been persisted there); the write path is implemented and proven on the isolated `TEST_DATABASE_URL` branch (Decisions 19 + 21).
- **Engine (pure JS, `src/recommendation/`)** — implemented and covered by unit tests (`npm run test:unit`; 829 tests as of 2026-09-28):
  - **Engine 1** — compatibility resolver (`compatibility/`) — the eight pairwise relationships plus the architecture §5.2 HIGH-TGP GPU↔PSU connector escalation (Decision 26 item A, 2026-09-28: `GPU_PSU_CONNECTOR_NULL_HIGH_TGP` when a required, known connector's PSU availability is NULL and `gpu_board_spec.board_tgp_watts >= 200`, decided before the unknown-name branch). The architecture §5.3 cooler-TDP/height and §6 RAM slot/capacity HARD checks are NOT implemented — explicit unenforced deferrals (Decision 26 item B), 0 live violations as of 2026-09-28.
  - **Engine 2** — 2A contracts, 2B DB loader, 2C pool selector (`candidates/`); **2D hard-compatibility filtering** (`filtering/`); **Stage 1 offer pre-selection** (`offers/`).
  - **Query input loader** (`query/`, Decisions 10 + 17.1, implemented and tested 2026-09-21, wired via `orchestrator/run.js`) — `loadQueryInput`: one exact-ID parameterized `SELECT` over `recommendation_query` (columns `id, budget_amount, currency, use_case, scoring_model_id` only; `resolution`/`priority`/`recommendation_profile_id` NOT selected, NOT used); maps through `createCandidateSelectionInput` with the Rule 1 `REQUIRED_ROLES` constant in canonical `component_role` order; fail-closed NULL/blank `use_case` via the Engine 2A contract (no default, no normalization, no profile fallback); missing row → `INVALID_INPUT`; strict plain-decimal NUMERIC-string budget conversion (`/^[0-9]+(\.[0-9]+)?$/` only, every other string → `INVALID_FIELD_VALUE:budget_amount`); `scoring_model_id` preserved verbatim for the Decision 11 loader; injected `db` validated, never created/closed; NO BEGIN, no SET TRANSACTION, no NOW() (caller owns the snapshot); frozen `{ query_id, scoring_model_id, input }`, row never mutated.
  - **Engine 3** — build assembly Steps 1–4 + GPU-input loading + assembly entry point + public barrel (`assembly/`): `validateEngine3Input` (ten-field contract since Decision 16, including `filtering_context`), price carrier (`priceKey` / `validatePrices` / `lookupPrice`), `resolveGpuRequirement`, `assembleBuilds` + `EXPANSION_ORDER` (with Decision 16 pairwise branch validation: Engine 2D's pair evaluators re-check each tentative pick against already-picked partners; a pair FAIL abandons the branch), `buildGpuInputs` (GPU-input loading: `gpu_required_use_cases` from the scoring model, iGPU presence via `buildIntegratedGpuPresentMap`, `use_case` from the Engine 2A input), `assembleBuildsForRecommendation` (Steps 1 → 2 → 4 composed over already-loaded Engine 2 sources, DB-free). Decision 23 O2 (implemented 2026-09-27): the build's `unknown_pairwise_count` is a build-local re-evaluation over the picked components (`countBuildLocalUnknownPairs`, each pair once, absent partner → 0), superseding the Decision 15 verdict sum. Cross-engine query → build → score orchestration is wired via `orchestrator/run.js` (Decision 17, no writes); the full pipeline — snapshot → rankBuilds → selectDiverseTop → runRecommendationCommit — including persistence (Engine 5b, Decision 19) is composed in `orchestrator/full-run.js` (`runRecommendationFullRun`, Decision 21, RESOLVED 2026-09-23).
  - **Retention stage** (`retention/`, Decision 12, implemented and tested 2026-09-20) — `retainTopKPerRole`: Rule 2 (PASS/UNKNOWN eligible, REJECT excluded pre-score) → Rule 3/5 (candidate score DESC, then the reused `compareCandidates` tie-break) → Rule 4 (`min(K, eligible_count)` hard cap). Implemented and tested, wired into the orchestrator (`orchestrator/run.js` step 11 → step 12: `retainTopKPerRole` output replaces `filterResult` for `assembleBuildsForRecommendation`); outside the orchestrator Engine 3 still receives whatever `filterResult` its caller provides.
  - **Scoring-model loader** (Decision 11, `scoring/`): `loadScoringModel`, `validateScoringModelConfiguration`; 2D→3 iGPU handoff `buildIntegratedGpuPresentMap` (`filtering/igpu-map.js`).
  - **Engine 4 — scoring arithmetic** (`scoring/`, Decision 13 STEP 1-3 + Decision 15; UNKNOWN-pair count producer revised by Decision 23 O2) — `selectAssessmentRow` / `computeEffectiveScore` (STEP 1: `max(0, neutral_baseline - no_evidence_penalty)` when no assessment row applies, else `neutral_baseline + mult * (decayed - neutral_baseline)` with `confidence_multipliers[confidence]` and the `staleness` decay), `computeCandidateScore(s)` (STEP 2: `sum_type[role_weights[role][type] * effective] / sum_type[role_weights[role][type]]`; `type_weights` takes no part), `computeBuildScore(s)` + `computeBuildScoreContributions` (STEP 3: weighted `build_score_raw` with the denominator renormalized when an optional role is absent, then `clamp(raw - unknown_compat_penalty * unknown_pairwise_count, 0, 100)`), and `loadComponentAssessments` (DB loader for the frozen assessment map); `configuration.js` validates the pinned Decision 3(a) configuration.
  - **Engine 5a — ranking** (`ranking/`, Decision 18, implemented and tested 2026-09-22; wired into the full run via `orchestrator/full-run.js` per Decision 21) — `rankBuilds({ builds })`: pure, DB-free ranking of the orchestrator's frozen `builds` array → deeply frozen `{ ranked, top_n }`; sort build_score DESC → total_price ASC → signature ASC with `round2` (half-up on the shortest decimal representation) applied BEFORE comparing (rounded values carried on the entries); signature = `ROLE:product_id:variant_or_empty` over `EXPANSION_ORDER` (omitted GPU keeps its empty `GPU::` slot) compared strictly by code unit, never `localeCompare`; G1 `compatibility_status` (UNKNOWN iff `unknown_pairwise_count > 0` or any component UNKNOWN, else PASS); contiguous ranks 1..n; duplicate signatures fail fast; `explanation: null` at ranking time (Engine 6 fills it at the `orchestrator/full-run.js` pre-commit seam); `TOP_N_PERSISTED = 10` code constant; zero builds → frozen empties (valid, not an error); inputs never mutated, entries reference the original build objects.
  - **Engine 5b — persistence** (`persistence/` + `orchestrator/commit.js`, Decisions 19 + 20, implemented 2026-09-23) — pure validation of the `selectDiverseTop` `selected` array (`validate-selected.js`), then DML-only persistence (`persist-ranked.js`) inside the ONE write transaction owned by `runRecommendationCommit`; the commit re-run guard (SELECT over `build_candidate`) refuses a second full run for the same `query_id`.
  - **Engine 6 — explanation generation** (`explanation/`, Decision 22, implemented 2026-09-24) — `explainSelection({ selected, builds, contributions, budget })`: pure, DB-free deterministic template text (rank / build_score / status / price-vs-budget / dominant role-type, plus mandatory BIOS-condition and UNKNOWN clauses), wired in `orchestrator/full-run.js` between `selectDiverseTop` and `runRecommendationCommit`; `persistence/persist-ranked.js` binds the real string into `recommendation_result.explanation` and `persistence/validate-selected.js` requires it non-empty.
  - Decisions 12–16 pointers: Decision 12 — Ranking / top-K ownership and pipeline position (implemented + tested, wired via `orchestrator/run.js` per Decisions 12, 14, 17); Decision 13 — Candidate-ranking score formula; Decision 14 — `top_k_per_role` retention semantics; Decision 15 — UNKNOWN pairwise-count producer (Decision 13's B1); Decision 16 — Pairwise branch validation inside Engine 3's DFS. Decisions 17–26 pointers: Decision 17 — Query loader and orchestrator contract (query/ + orchestrator/, no writes, snapshot transaction; RESOLVED 2026-09-21); Decision 18 — Ranking (Engine 5a, pure, implemented + tested 2026-09-22; RESOLVED, wired into the full run per Decision 21); Decision 19 — Persistence (Engine 5b, one transaction per query; RESOLVED 2026-09-21, implemented — `orchestrator/commit.js`); Decision 20 — Post-ranking (CPU, GPU) pair diversity selection (RESOLVED 2026-09-22, implemented; reconciled with real measured numbers 2026-09-23); Decision 21 — Full-run composition contract (RESOLVED 2026-09-23, implemented — `orchestrator/full-run.js` `runRecommendationFullRun`, exported from the orchestrator barrel); Decision 22 — Explanation generation (Engine 6) contract (RESOLVED 2026-09-24, implemented — `explanation/` + the `orchestrator/full-run.js` pre-commit seam, persisted by `persistence/persist-ranked.js`); Decision 23 — Score degeneracy (RESOLVED 2026-09-27: O2 build-local `unknown_pairwise_count` implemented; O1 seed `003_gpu_psu_connector_data.sql` applied 2026-09-28, acceptance criteria 1-2 measured MET, criterion 3 / PI-1 still unbuilt); Decision 24 — Re-evaluation of Decision 20's O4 (CPU, GPU) pair-diversity selection on the 100-product catalog (RESOLVED 2026-09-28, docs-only — O4 and `MAX_PER_PAIR = 3` retained unchanged, its objective documented as unmet at the shipped configured cap); Decision 25 — Assembly cap starvation of the O4 objective (RESOLVED 2026-09-28, docs-only — `max_builds_per_query = 25` halts the depth-first walk before CPU/GPU vary, so the configured-cap pool holds exactly one (CPU, GPU) pair and no `MAX_PER_PAIR` value can restore diversity; OFFICE is pair-space-bounded below 10 at any cap); Decision 26 — S5.2 HIGH-TGP GPU↔PSU connector escalation IMPLEMENTED (`GPU_PSU_CONNECTOR_NULL_HIGH_TGP` at `board_tgp_watts >= 200`, `board_tgp_watts` carried by `context-loader.js` + `filter.js`), while the four S5.3/S6 HARD cooler/RAM rules are explicitly DEFERRED and marked unenforced (RESOLVED 2026-09-28, hybrid).
  - Roadmap contract: `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md`; decision record: `docs/RECOMMENDATION_ENGINE_DECISIONS.md`.

Environment: PostgreSQL on **Neon** (cloud); no local PostgreSQL. Current migration: `011_reconcile_layer4.sql`.

Currently next:
- (1) Decisions 17–19 RESOLVED (2026-09-21) — orchestrator contract, ranking, persistence (recorded; query/ loader implemented and wired via `orchestrator/run.js`, Decision 17 no-writes pass).
- (2) DONE 2026-09-21 — Query data-loading layer (Decision 10 / 17.1) — `loadQueryInput` in `src/recommendation/query/` (Rule 1 constant, fail-closed `use_case`, strict NUMERIC-string budget); 669 unit tests pass.
- (3) DONE 2026-09-21 — Orchestrator, no writes — query/ → 2C → Stage 1 → 2D → retention → 3 → 4 wired in `orchestrator/run.js` inside one REPEATABLE READ READ ONLY snapshot transaction (`runRecommendationSnapshot` owns BEGIN/end; ROLLBACK on ANY thrown error).
- (3b) Decision 20 — Post-ranking (CPU, GPU) pair diversity selection (RESOLVED 2026-09-22, implemented; reconciled with real measured numbers 2026-09-23). Re-evaluated 2026-09-28 in Decisions 24–25: O4 retained unchanged, but its diversity objective does not hold at the shipped configured cap.
- (4) DONE 2026-09-22 — Engine 5a ranking (pure) — `src/recommendation/ranking/` (`rankBuilds`, `TOP_N_PERSISTED`); 739 unit tests pass at the time. Engine 5b persistence (transactional `recommendation_result` rows) is implemented (Decision 19) — no longer blocked (Decision 20 RESOLVED 2026-09-22, reconciled with real measured numbers 2026-09-23).
- (4b) DONE 2026-09-23 — Decision 21 full-run composition (RESOLVED) — `runRecommendationFullRun(client, queryId)` in `orchestrator/full-run.js`, exported from the orchestrator barrel alongside `runRecommendation` and `runRecommendationSnapshot`: snapshot (read) → `rankBuilds` → `selectDiverseTop` → `runRecommendationCommit` (write). Proven end-to-end on a real query against test-scratch: candidates scored, ranked, diversity-capped, and persisted (`build_candidate` / `recommendation_result` / `build_component` rows), with the re-run guard verified; 788/788 unit tests pass.
- (5) DONE 2026-09-24 — Engine 6 explanation generation (Decision 22) — `src/recommendation/explanation/` (`explainSelection`), wired in `orchestrator/full-run.js`; real explanation text is persisted (Decision 22 item 5).
- (6) DONE 2026-09-25 — Product/store-offer seeding: `001_minimal_builds.sql` + `002_catalog_expansion.sql` applied to the live DB (100 `Seed %` products, 101 offers); DONE 2026-09-28 — data-only `003_gpu_psu_connector_data.sql` applied, populating GPU `required_power_connectors` and PSU connector counts. Layer 2 benchmark/assessment data for the expanded catalog remains the top backlog item (all 85 new products are unassessed).

NOT implemented:
- Product data seeding — `database/seeds/001_minimal_builds.sql` (15 products) and `database/seeds/002_catalog_expansion.sql` (85 new: 16 CPU / 20 GPU / 5 motherboard / 5 RAM / 15 boot SSD / 9 PSU / 8 case / 7 CPU cooler) are both applied to the live DB, alongside data-only `database/seeds/003_gpu_psu_connector_data.sql` (Decision 23 O1, applied 2026-09-28): 100 `Seed %` products, 22 variants, 101 offers, 76 families, 25 assessments — verified 2026-09-28 against the live database (transactional apply + rollback validation, all row counts asserted; re-applying the seed is a no-op). NOTE: the 85 new products have NO `component_assessment` rows, so by Decision 13 STEP 1 they all score the no-evidence branch (40) and cannot outrank 001's assessed products — real Layer 2 assessment data for the expanded catalog is the top pending item (see `002_catalog_expansion.sql` header decision D2, amended 2026-09-28, for the exact per-role assessment types/freshness rules required, and for the measured `top_k_per_role = 5` truncation that keeps most of the new catalog out of builds entirely). Data gaps recorded in the same header (D1–D8) that remain open after seed 003: unverified assessment-era prices (the companion research prices differ materially), case radiator matrices (6 of 10 cases have zero `case_radiator_support` rows — a HARD FAIL for every liquid cooler), and real seller/product URLs. Seed 003 closed the GPU-connector gap (all 22 GPU variants now carry `required_power_connectors`) and supplied PSU connector counts for the previously unverified rows, but leaves 7 GPU variants with NULL dimensions (`width_slots`/`height_mm`, documented unresolved mechanical identities) and 3 PSU rows (`Seed Antec G850`, `Seed Connect PSU 850`, `Seed HYBROK PSU 650`) with the EPS / PCIe-8pin / 12VHPWR / SATA fields deliberately NULL (unverified vendor specs). The 20 test-fixture products (`Test Product%` / `TEST-SKU-%` / `TestCompat%`) were deleted 2026-09-19 (0 remain).
- The four architecture HARD rules of `ARCHITECTURE.md` §5.3/§6 are UNENFORCED, explicitly deferred by Decision 26 item B (2026-09-28): cooler `max_tdp_watts` vs CPU TDP, air-cooler `height_mm` vs `case_spec.max_cpu_cooler_height_mm`, RAM `module_count` vs `motherboard_spec.dimm_slots`, total RAM capacity vs `max_memory_capacity_gb`. No non-test module reads those columns; 0 live violations on the shared catalog as of 2026-09-28. Re-run the violation queries before merging any cooler/RAM/case/motherboard seed.

- A `TEST_DATABASE_URL` guard exists for isolated write tests (`scripts/lib/db-url.js`; see `DEVELOPMENT_NOTES.md`), but a fresh 001→011 migration remains NOT VERIFIED.

## ARCHITECTURE

Four data layers; pure-JS engine modules in `src/recommendation/` mirror the schema.

### Layer 1 — Catalog / Hardware (IMPLEMENTED)

- Identity: `manufacturer`, `platform`, `socket`, `memory_type`, `product_family`, `product`, `product_variant`.
- Hardware specs — one-to-one with `product` (PK = FK): `cpu_spec`, `motherboard_spec`, `ram_spec`, `ssd_spec`, `psu_spec`, `case_spec`, `cooler_spec`. `gpu_board_spec` is one-to-one with `product_variant`; `gpu_chipset` is a shared lookup.
- Compatibility — explicit tables only where relationships cannot be derived from raw specs: `platform_memory_support`, `cpu_motherboard_support`, `cooler_socket_support`, `case_motherboard_form_factor`, `case_radiator_support`.
- Data quality: `ingestion_record`, `product_candidate`, `retailer_listing_alias`, `spec_provenance`.
- GPU ↔ case and GPU ↔ PSU fit are **derived** from numeric specs, not stored as compatibility rows.

### Layer 2 — Performance / Assessment (schema IMPLEMENTED; minimal seed data present; real-market data PENDING)

- `benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model`.
- `scoring_model` is versioned so recommendation results stay reproducible.
- Assessment types: PERFORMANCE, VALUE, QUALITY, UPGRADEABILITY, THERMALS, EFFICIENCY.

### Layer 3 — Market (IMPLEMENTED)

- `store`, `store_offer` (current/latest offer state), `price_history` (append-only).
- Multiple legitimate offers may exist for the same store/product/variant.

### Layer 4 — Recommendation Engine (schema IMPLEMENTED; Engine 3 assembly Steps 1–4 + scoring-model loader IMPLEMENTED; Engine 4 scoring arithmetic (Decision 13 STEP 1-3 + Decision 15) IMPLEMENTED; Engine 5 ranking/persistence IMPLEMENTED — Decisions 18 (ranking), 20 (pair diversity), 19 (persistence), 21 (full-run composition); Engine 6 explanations IMPLEMENTED — Decision 22)

- `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component`.
- `component_role` enum (CPU, GPU, MOTHERBOARD, RAM, SSD_BOOT, SSD_SECONDARY, PSU, CASE, CPU_COOLER) drives build roles: at most one CPU/MOTHERBOARD/PSU/CASE/CPU_COOLER/SSD_BOOT per candidate; multiple GPU/RAM/SSD_SECONDARY allowed.
- Engine status: Engine 1 compatibility ✓; Engine 2 candidates ✓ (2A contracts, 2B DB loader, 2C pool selector) with 2D filtering ✓ and Stage 1 offer pre-selection ✓; Engine 3 assembly Steps 1–4 + GPU-input loading + assembly entry point ✓ (cross-engine orchestration ✓ — no-writes pass via `orchestrator/run.js`, full run via `orchestrator/full-run.js` per Decision 21); Decision 11 scoring-model loader ✓; Engine 4 scoring arithmetic (Decision 13 STEP 1-3 + Decision 15) ✓; Engine 5 ranking/persistence ✓ (ranking Decision 18, pair-diversity selection Decision 20, persistence Decision 19, full-run composition Decision 21); Engine 6 explanations ✓ (Decision 22 — `explanation/`, persisted via `orchestrator/full-run.js`).

## DATABASE

- **PostgreSQL** hosted on **Neon** (cloud). The shared Neon database is the only dev database and is **not disposable**.
- **Migrations**: `database/migrations/`; naming convention `NNN_short_description.sql` (zero-padded, sequential), currently `001`…`011`.
- **UUID strategy**: `gen_random_uuid()` via the `pgcrypto` extension (migration 001); PKs default to it (`id UUID PRIMARY KEY DEFAULT gen_random_uuid()`).
- **Enum strategy**: `CREATE TYPE` in `002_enums.sql` (bare, not idempotent); later enums (e.g. `component_role`) are guarded inside reconciliation migrations. Never drop or destructively alter an enum.
- **`NULL` means UNKNOWN** for optional technical specifications; never treat UNKNOWN as PASS.
- One-to-one spec tables use **PK = FK** (the primary key doubles as the foreign key to `product` / `product_variant`).
- Compatibility tables represent relationships that **cannot safely be derived** from raw specifications.
- **GPU physical fit** (case clearance, PSU wattage/connectors) is **derived from numeric specifications** rather than cached compatibility rows.
- Connection: `DATABASE_URL` from `.env`. No credentials or connection strings belong in this file.

## MIGRATION RULES

1. Never rewrite an already committed migration.
2. Schema changes require a new sequential migration.
3. Test migrations against an isolated database whenever possible.
4. Never reset/drop the shared Neon database to perform a fresh migration test.
5. Verify the live database before making corrective migrations.
6. Existing production/live schema must never be silently changed.
7. Never create a migration merely to make a test pass.

## IMPORTANT DESIGN DECISIONS

- **CPU ↔ motherboard compatibility** uses family-level rules plus optional exact-SKU overrides (exact SKU highest priority, family fallback, no rule = UNKNOWN).
- **UNKNOWN must remain distinct from FAIL** — missing data is never permissive (PASS/FAIL/UNKNOWN/CONDITIONAL are all first-class).
- **Cooler ↔ socket compatibility is explicit** (`cooler_socket_support`), not derived.
- **Case ↔ motherboard form-factor compatibility is explicit** (not derived from dimensions).
- **Case ↔ radiator compatibility is explicit** (`case_radiator_support`, includes size and position).
- **GPU ↔ case compatibility is calculated** from dimensions (`gpu_board_spec` vs `case_spec` max GPU length/thickness).
- **GPU ↔ PSU compatibility is calculated** from wattage and connectors (`recommended_psu_watts` vs `rated_wattage`; connector comparison).
- **Variant-specific GPU physical properties belong to `gpu_board_spec`** (length, slot width, height, board TGP, connectors), not to the chipset or `product` row.
- **`product_variant` has no `overrides` column** in migrations 001–011 or the live schema (verified 2026-09-21 via `003_core_tables.sql:60-68` + `verify-schema.js`); the prior allowlist note was doc-drift. Do not reference it as existing.
- **Layer 3 supports multiple legitimate offers** for the same store/product/variant (no offer-level unique key).
- **`price_history` is append-only**; historical prices are never destroyed when the current offer changes.
- **Recommendation results must remain traceable to the scoring model used** (`recommendation_query.scoring_model_id` is NOT NULL).
- Layer 4 timestamps are `TIMESTAMPTZ` (UTC), consistent with the Layer 3 reconciliation.

## CURRENT DATABASE TABLES

Grouped by layer; column-level detail lives in the migration SQL files (authoritative).

- **Layer 1**: `manufacturer`, `platform`, `socket`, `memory_type`, `product_family`, `product`, `product_variant`, `chipset`, `cpu_spec`, `gpu_chipset`, `gpu_board_spec`, `motherboard_spec`, `ram_spec`, `ssd_spec`, `psu_spec`, `case_spec`, `cooler_spec`, `platform_memory_support`, `cpu_motherboard_support`, `cooler_socket_support`, `case_motherboard_form_factor`, `case_radiator_support`, `ingestion_record`, `product_candidate`, `retailer_listing_alias`, `spec_provenance`.
- **Layer 2**: `benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model`.
- **Layer 3**: `store`, `store_offer`, `price_history`.
- **Layer 4**: `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component`.

## DEVELOPMENT WORKFLOW

1. Read `CONTEXT.md`.
2. Read the relevant section of `DEVELOPMENT_NOTES.md`.
3. Inspect existing migrations.
4. Inspect relevant tests.
5. Plan changes.
6. Implement the smallest safe change.
7. Run targeted tests.
8. Run broader tests when appropriate.
9. Review `git diff` / `git status`.
10. Report exactly what changed and what was verified.

## AI AGENT RULES

- Do not assume a database schema from memory — inspect the actual migration before modifying related code.
- Prefer existing patterns over inventing new ones.
- Do not duplicate tables or concepts.
- Do not introduce new JSONB fields without explicit justification.
- Do not create compatibility tables when compatibility can reliably be derived from specifications.
- Do not alter Layer 1 architecture while implementing later layers unless explicitly required.
- Keep migrations deterministic and idempotent where practical.
- Never claim a test passed if it was not actually executed.
- Clearly distinguish PASS, FAIL, and BLOCKED.
- If a test cannot run because of environment limitations, report the limitation instead of working around it destructively.