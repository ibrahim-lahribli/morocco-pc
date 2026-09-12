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
- **Layer 2 — Performance / Assessment**: schema only (`benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model`). Migration 008. No data or scoring yet.
- **Layer 3 — Market**: canonical schema (`store`, `store_offer`, `price_history`) reconciled to the live database. Migrations 009–010.
- **Layer 4 — Recommendation**: canonical schema (`recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component` + `component_role` enum) reconciled to the live database. Migration 011 applied and catalog-verified (tables currently empty).
- **Engine (pure JS, `src/recommendation/`)**: Engine 1 compatibility resolver and Engine 2 / 2A / 2B candidate selection are implemented and covered by unit tests (`npm run test:unit`). Roadmap contract: `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md`.

Environment: PostgreSQL on **Neon** (cloud); no local PostgreSQL. Current migration: `011_reconcile_layer4.sql`.

Currently next:
- **Engine 3** — build assembler (staged expansion, budget pruning, completeness rules).
- **Engine 4** — scoring engine (reads `scoring_model.configuration`).
- **Engine 5** — ranking + result persistence (transactional `recommendation_result` rows).
- **Engine 6** — explanation generation.
- Product seeding; Layer 2 benchmark/assessment data.

NOT implemented:
- End-to-end query → build → score → rank pipeline (Engines 3–6).
- Product data seeding (`database/seeds/` is empty).
- An isolated environment to verify a fresh 001→011 migration (see `DEVELOPMENT_NOTES.md`).

## ARCHITECTURE

Four data layers; pure-JS engine modules in `src/recommendation/` mirror the schema.

### Layer 1 — Catalog / Hardware (IMPLEMENTED)

- Identity: `manufacturer`, `platform`, `socket`, `memory_type`, `product_family`, `product`, `product_variant`.
- Hardware specs — one-to-one with `product` (PK = FK): `cpu_spec`, `motherboard_spec`, `ram_spec`, `ssd_spec`, `psu_spec`, `case_spec`, `cooler_spec`. `gpu_board_spec` is one-to-one with `product_variant`; `gpu_chipset` is a shared lookup.
- Compatibility — explicit tables only where relationships cannot be derived from raw specs: `platform_memory_support`, `cpu_motherboard_support`, `cooler_socket_support`, `case_motherboard_form_factor`, `case_radiator_support`.
- Data quality: `ingestion_record`, `product_candidate`, `retailer_listing_alias`, `spec_provenance`.
- GPU ↔ case and GPU ↔ PSU fit are **derived** from numeric specs, not stored as compatibility rows.

### Layer 2 — Performance / Assessment (schema IMPLEMENTED; data/scoring PLANNED)

- `benchmark_source`, `benchmark`, `benchmark_result`, `component_assessment`, `scoring_model`.
- `scoring_model` is versioned so recommendation results stay reproducible.
- Assessment types: PERFORMANCE, VALUE, QUALITY, UPGRADEABILITY, THERMALS, EFFICIENCY.

### Layer 3 — Market (IMPLEMENTED)

- `store`, `store_offer` (current/latest offer state), `price_history` (append-only).
- Multiple legitimate offers may exist for the same store/product/variant.

### Layer 4 — Recommendation Engine (schema IMPLEMENTED; engines 3–6 PLANNED)

- `recommendation_profile`, `recommendation_query`, `recommendation_result`, `build_candidate`, `build_component`.
- `component_role` enum (CPU, GPU, MOTHERBOARD, RAM, SSD_BOOT, SSD_SECONDARY, PSU, CASE, CPU_COOLER) drives build roles: at most one CPU/MOTHERBOARD/PSU/CASE/CPU_COOLER/SSD_BOOT per candidate; multiple GPU/RAM/SSD_SECONDARY allowed.
- Engine status: Engine 1 compatibility ✓, Engine 2 candidates ✓ (foundation), Engine 3 assembler, Engine 4 scoring, Engine 5 ranking/persistence, Engine 6 explanations.

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
- **`product_variant.overrides` has a controlled allowlist** and must not become a generic JSON dumping ground.
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