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
- **Layer 2 — Performance / Assessment**: schema (`benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model`). Migration 008. Minimal seed data present (25 assessments + `scoring_model seed-minimal-v1/1.0.0` + minimal benchmark provenance: 1 `benchmark_source` (`Seed Synthetic Lab`), 1 `benchmark` (`Seed Synthetic Suite`), 2 `benchmark_result` rows); Engine 4 scoring implemented (Decision 13 STEP 1-3 + Decision 15). Real-market benchmark data remains unseeded.
- **Layer 3 — Market**: canonical schema (`store`, `store_offer`, `price_history`) reconciled to the live database. Migrations 009–010.
- **Layer 4 — Recommendation**: canonical schema (`recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component` + `component_role` enum) reconciled to the live database. Migration 011 applied and catalog-verified (tables currently empty).
- **Engine (pure JS, `src/recommendation/`)** — implemented and covered by unit tests (`npm run test:unit`; 669 tests as of 2026-09-21):
  - **Engine 1** — compatibility resolver (`compatibility/`).
  - **Engine 2** — 2A contracts, 2B DB loader, 2C pool selector (`candidates/`); **2D hard-compatibility filtering** (`filtering/`); **Stage 1 offer pre-selection** (`offers/`).
  - **Query input loader** (`query/`, Decisions 10 + 17.1, implemented and tested 2026-09-21, wired via `orchestrator/run.js`) — `loadQueryInput`: one exact-ID parameterized `SELECT` over `recommendation_query` (columns `id, budget_amount, currency, use_case, scoring_model_id` only; `resolution`/`priority`/`recommendation_profile_id` NOT selected, NOT used); maps through `createCandidateSelectionInput` with the Rule 1 `REQUIRED_ROLES` constant in canonical `component_role` order; fail-closed NULL/blank `use_case` via the Engine 2A contract (no default, no normalization, no profile fallback); missing row → `INVALID_INPUT`; strict plain-decimal NUMERIC-string budget conversion (`/^[0-9]+(\.[0-9]+)?$/` only, every other string → `INVALID_FIELD_VALUE:budget_amount`); `scoring_model_id` preserved verbatim for the Decision 11 loader; injected `db` validated, never created/closed; NO BEGIN, no SET TRANSACTION, no NOW() (caller owns the snapshot); frozen `{ query_id, scoring_model_id, input }`, row never mutated.
  - **Engine 3** — build assembly Steps 1–4 + GPU-input loading + assembly entry point + public barrel (`assembly/`): `validateEngine3Input` (ten-field contract since Decision 16, including `filtering_context`), price carrier (`priceKey` / `validatePrices` / `lookupPrice`), `resolveGpuRequirement`, `assembleBuilds` + `EXPANSION_ORDER` (with Decision 16 pairwise branch validation: Engine 2D's pair evaluators re-check each tentative pick against already-picked partners; a pair FAIL abandons the branch), `buildGpuInputs` (GPU-input loading: `gpu_required_use_cases` from the scoring model, iGPU presence via `buildIntegratedGpuPresentMap`, `use_case` from the Engine 2A input), `assembleBuildsForRecommendation` (Steps 1 → 2 → 4 composed over already-loaded Engine 2 sources, DB-free). Cross-engine query → build → score orchestration is wired via `orchestrator/run.js` (Decision 17, no writes); ranking (Engine 5a) and persistence (Engine 5b) remain future.
  - **Retention stage** (`retention/`, Decision 12, implemented and tested 2026-09-20) — `retainTopKPerRole`: Rule 2 (PASS/UNKNOWN eligible, REJECT excluded pre-score) → Rule 3/5 (candidate score DESC, then the reused `compareCandidates` tie-break) → Rule 4 (`min(K, eligible_count)` hard cap). Implemented and tested, wired into the orchestrator (`orchestrator/run.js` step 11 → step 12: `retainTopKPerRole` output replaces `filterResult` for `assembleBuildsForRecommendation`); outside the orchestrator Engine 3 still receives whatever `filterResult` its caller provides.
  - **Scoring-model loader** (Decision 11, `scoring/`): `loadScoringModel`, `validateScoringModelConfiguration`; 2D→3 iGPU handoff `buildIntegratedGpuPresentMap` (`filtering/igpu-map.js`).
  - Decisions 12–16 pointers: Decision 12 — Ranking / top-K ownership and pipeline position (implemented + tested, wired via `orchestrator/run.js` per Decisions 12, 14, 17); Decision 13 — Candidate-ranking score formula; Decision 14 — `top_k_per_role` retention semantics; Decision 15 — UNKNOWN pairwise-count producer (Decision 13's B1); Decision 16 — Pairwise branch validation inside Engine 3's DFS. Decisions 17–20 pointers: Decision 17 — Query loader and orchestrator contract (query/ + orchestrator/, no writes, snapshot transaction); Decision 18 — Ranking (Engine 5a, pure); Decision 19 — Persistence (Engine 5b, one transaction per query); Decision 20 — Assembly diversity (OPEN).
  - Roadmap contract: `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md`; decision record: `docs/RECOMMENDATION_ENGINE_DECISIONS.md`.

Environment: PostgreSQL on **Neon** (cloud); no local PostgreSQL. Current migration: `011_reconcile_layer4.sql`.

Currently next:
- (1) Decisions 17–19 RESOLVED (2026-09-21) — orchestrator contract, ranking, persistence (recorded; query/ loader implemented and wired via `orchestrator/run.js`, Decision 17 no-writes pass).
- (2) DONE 2026-09-21 — Query data-loading layer (Decision 10 / 17.1) — `loadQueryInput` in `src/recommendation/query/` (Rule 1 constant, fail-closed `use_case`, strict NUMERIC-string budget); 669 unit tests pass.
- (3) DONE 2026-09-21 — Orchestrator, no writes — query/ → 2C → Stage 1 → 2D → retention → 3 → 4 wired in `orchestrator/run.js` inside one REPEATABLE READ READ ONLY snapshot transaction (`runRecommendationSnapshot` owns BEGIN/end; ROLLBACK on ANY thrown error).
- (3b) Decision 20 — assembly diversity (open, measured on the seed via the dry-run orchestrator).
- (4) Engine 5a ranking (pure), then Engine 5b persistence (transactional `recommendation_result` rows).
- (5) Engine 6 — explanation generation.
- (6) Product/store-offer seeding; Layer 2 benchmark/assessment data (backlog).

NOT implemented:
- End-to-end query → build → score pipeline: wired via `orchestrator/run.js` (Decision 17, no writes); ranking (Engine 5a) then persistence (Engine 5b), and Engine 6, are absent.
- Product data seeding beyond the minimal seed — `database/seeds/001_minimal_builds.sql` exists and is applied to the live DB (15 products, 16 offers, 25 assessments; verified end-to-end through Engine 4 on 2026-09-19), and the 20 test-fixture products (`Test Product%` / `TEST-SKU-%` / `TestCompat%`) were deleted the same day (0 remain); broader real-market catalog coverage remains unseeded.
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

### Layer 4 — Recommendation Engine (schema IMPLEMENTED; Engine 3 assembly Steps 1–4 + scoring-model loader IMPLEMENTED; Engine 4 scoring arithmetic (Decision 13 STEP 1-3 + Decision 15) IMPLEMENTED; Engine 5 ranking/persistence PLANNED; Engine 6 explanations PLANNED)

- `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component`.
- `component_role` enum (CPU, GPU, MOTHERBOARD, RAM, SSD_BOOT, SSD_SECONDARY, PSU, CASE, CPU_COOLER) drives build roles: at most one CPU/MOTHERBOARD/PSU/CASE/CPU_COOLER/SSD_BOOT per candidate; multiple GPU/RAM/SSD_SECONDARY allowed.
- Engine status: Engine 1 compatibility ✓; Engine 2 candidates ✓ (2A contracts, 2B DB loader, 2C pool selector) with 2D filtering ✓ and Stage 1 offer pre-selection ✓; Engine 3 assembly Steps 1–4 + GPU-input loading + assembly entry point ✓ (cross-engine orchestration pending); Decision 11 scoring-model loader ✓; Engine 4 scoring arithmetic (Decision 13 STEP 1-3 + Decision 15) ✓; Engine 5 ranking/persistence; Engine 6 explanations.

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