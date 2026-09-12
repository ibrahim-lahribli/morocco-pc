# PROJECT_CONTEXT.md

## Project overview

`morocco-pc` is a PC build recommendation system designed to recommend complete PC builds based on:

* Budget
* Use case
* Resolution
* Priorities
* Component compatibility
* Product performance
* Product value
* Upgradeability
* Availability / pricing
* Other recommendation criteria added later

The system is being built in distinct layers.

---

## Layer 1 — Canonical hardware, hard compatibility, and data quality

### Identity tables

| Table | Purpose |
|---|---|
| `manufacturer` | Canonical manufacturer identity |
| `platform` | CPU platform (e.g. AM5, LGA1700) |
| `socket` | Physical CPU socket identity |
| `memory_type` | Memory technology (e.g. DDR4, DDR5) |
| `product_family` | Grouping within a manufacturer |
| `product` | Canonical product identity |
| `product_variant` | Physical / model-level variants |

### Hardware specification tables

| Table | Relationship | Key physical properties |
|---|---|---|
| `chipset` | Shared lookup | Chipset name, manufacturer |
| `cpu_spec` | One-to-one with `product` | Socket, cores, threads, clocks, TDP, memory, PCIe |
| `gpu_chipset` | Shared lookup | VRAM, memory bus, PCIe interface, base TGP |
| `gpu_board_spec` | One-to-one with `product_variant` | Length, slot width, height, board TGP, connectors, recommended PSU |
| `motherboard_spec` | One-to-one with `product` | Socket, chipset, form factor, memory, expansion slots |
| `ram_spec` | One-to-one with `product` | Memory type, module count, capacity per module, speed, voltage |
| `ssd_spec` | One-to-one with `product` | Capacity, form factor, interface, protocol, PCIe generation |
| `psu_spec` | One-to-one with `product` | Rated wattage, efficiency, form factor, length, connectors, modularity |
| `case_spec` | One-to-one with `product` | Max GPU length, max GPU thickness, max cooler height, PSU form factor, max PSU length |
| `cooler_spec` | One-to-one with `product` | Cooling type, max TDP, height, length, width |

### Compatibility tables

| Table | Purpose |
|---|---|
| `platform_memory_support` | Which memory types a platform supports |
| `cpu_motherboard_support` | Exact-CPU and family-level CPU/motherboard compatibility |
| `cooler_socket_support` | Which sockets a cooler supports |
| `case_motherboard_form_factor` | Which motherboard form factors a case supports |
| `case_radiator_support` | Radiator sizes and positions a case supports |

GPU-to-case and GPU-to-PSU compatibility are **derived** from numeric specifications and do not require permanent relationship tables at Layer 1.

### Data quality tables

| Table | Purpose |
|---|---|
| `ingestion_record` | One row per source ingestion run |
| `product_candidate` | Normalised product data awaiting canonicalisation |
| `retailer_listing_alias` | Retailer listing to canonical product mapping |
| `spec_provenance` | Audit trail for canonical spec values |

---

### Important architectural principles

1. `product` represents the canonical product identity.
2. `product_variant` represents physical / model variants where required.
3. Hardware specification tables are separated from product identity.
4. One-to-one hardware specification tables use PK = FK where appropriate.
5. `NULL` means UNKNOWN for optional technical specifications.
6. Hard compatibility must never assume that UNKNOWN means PASS.
7. CPU/motherboard compatibility can be PASS, FAIL, UNKNOWN, or CONDITIONAL.
8. CPU/motherboard support supports both family-level rules and exact-SKU overrides.
9. GPU physical compatibility with a case is derived from numeric specifications rather than a permanent compatibility table.
10. GPU/PSU compatibility is also derived from specifications.
11. Compatibility relationships that cannot safely be derived from numeric specifications are explicitly stored.
12. Provenance exists so canonical data can be traced back to its source.
13. Unverified ingestion data must not silently become trusted canonical data.

---

### GPU compatibility decision

GPU → Case:
```
gpu_board_spec.length_mm <= case_spec.max_gpu_length_mm
```

GPU thickness:
```
gpu_board_spec.width_slots <= case_spec.max_gpu_thickness_slots
```

GPU → PSU:
```
gpu_board_spec.recommended_psu_watts <= psu_spec.rated_wattage
```

GPU power connectors must also be compared against the PSU's available connectors.

These are derived compatibility checks. Therefore no separate GPU↔case or GPU↔PSU relationship tables are required at Layer 1.

---

## Layer 2 — Performance and scoring

### Tables

| Table | Purpose |
|---|---|
| `benchmark_source` | Organisation / source of benchmark data |
| `benchmark` | Test definition and conditions |
| `benchmark_result` | Observed measurements for a canonical product |
| `component_assessment` | Curated / editorial assessments |
| `scoring_model` | Versioned recommendation / scoring algorithm |

### Key concepts

* `benchmark` describes the test and conditions.
* `benchmark_result` stores observed measurements for a canonical product.
* `component_assessment` stores curated / editorial assessments.
* `scoring_model` represents a versioned recommendation / scoring algorithm. It must be versioned so recommendation results can later be reproduced and compared between algorithm versions.

### Current assessment types

* PERFORMANCE
* VALUE
* QUALITY
* UPGRADEABILITY
* THERMALS
* EFFICIENCY

---

## Layer 3 — Market data

### Tables

| Table | Purpose |
|---|---|
| `store` | Retailer identity |
| `store_offer` | Current / latest offer state |
| `price_history` | Append-only historical record |

### Key concepts

* `store_offer` represents the current/latest offer state.
* `price_history` is an append-only historical record.
* Historical prices must not be destroyed merely because the current offer changes.
* `store_offer` references canonical `product` and optionally `product_variant` records.
* Prices must be positive and required market text fields must be non-empty.
* Multiple seller/listing rows may exist for the same store, product, and variant; no offer-level unique key is used.
* Canonical indexes include `idx_store_active`, the four current-offer indexes, and `(store_offer_id, observed_at DESC)` plus `observed_at` indexes for price history.

---

## Layer 4 — Recommendation engine

### Tables

| Table | Purpose |
|---|---|
| `recommendation_profile` | PLANNED — user preference templates |
| `recommendation_query` | User requirements and scoring model version used |
| `recommendation_result` | Query outcome and metadata |
| `build_candidate` | A candidate build for a query |
| `build_component` | Products / variants within a candidate build |

### Key concepts

* A recommendation query records the user's requirements and which `scoring_model` version was used.
* A query may generate multiple build candidates.
* `build_candidate` is query-scoped rather than globally shared.
* `build_component` connects products / variants to a candidate build.
* The system should retain scored candidates rather than storing only the winning build. This is important for debugging and tuning the recommendation engine.

---

## Important database design decisions

### Socket architecture

CPU socket is stored in `cpu_spec`.
Platform socket is stored in `platform`.
Motherboard socket should be derived through its chipset architecture if that is the current schema decision.
Do not reintroduce redundant socket fields without first reviewing the architecture.

### GPU architecture

Separate `gpu_chipset` (GPU architecture / chip-level identity) from `gpu_board_spec` (physical / model-specific implementation).

Physical properties such as length, thickness, height, board TGP, and connector requirements belong to the board / variant level.

### Product variants

`product_variant.overrides` must remain controlled and must not become a generic JSON dumping ground. Currently allowed override concepts are limited to legitimate variant-specific hardware differences. Cosmetic information should not be placed in `overrides`.

### Compatibility specificity

For CPU/motherboard compatibility:

1. Exact CPU SKU rule has highest priority.
2. Family-level rule is the fallback.
3. No matching rule means UNKNOWN.

Do not interpret missing compatibility data as FAIL or PASS.

### Migration history

The current migration order is:

1. `001_extensions.sql`
2. `002_enums.sql`
3. `003_core_tables.sql`
4. `004_hardware_tables.sql`
5. `005_hardware_schema_corrections.sql`
6. `006_compatibility_tables.sql`
7. `007_provenance_tables.sql`
8. `008_benchmark_tables.sql`
9. `009_market_tables.sql`
10. `010_reconcile_layer3.sql`

Do not renumber or reorder existing migrations casually.

If a schema change is required after an existing migration has already been applied, create a new migration rather than rewriting history unless explicitly instructed otherwise.

---

## Current database environment

* Cloud PostgreSQL through **Neon**.
* Local PostgreSQL is intentionally not required at this stage.
* Connection configured via `DATABASE_URL` environment variable.
* Dependencies: `pg`, `dotenv`.

Project structure:
```
database/
  migrations/
  seeds/
scripts/
.env
.env.example
package.json
```

**Never write the actual database connection string, password, API key, or other secrets into this file.**

---

## Verification philosophy

Every database migration should:

1. Be applied to the development database.
2. Be syntactically valid.
3. Preserve existing data.
4. Verify expected tables.
5. Verify foreign keys.
6. Verify important constraints.
7. Test valid inserts.
8. Test invalid inserts where constraints are important.
9. Ensure previous migrations / tests still pass.

Do not claim a migration is correct merely because the SQL executed successfully.

---

## Current status

Completed:
* Initial database setup
* Core identity schema
* Hardware schema
* Hardware schema corrections
* Compatibility schema
* Provenance / data-quality schema
* Benchmark / scoring Layer 2 foundation
* Market / Layer 3 canonical schema (migration 009) and Neon reconciliation (migration 010)

In progress / next:
* Remaining Layer 2 / Layer 3 / Layer 4 implementation
* Product seeding
* Recommendation-engine development

PLANNED (not yet implemented):
* `recommendation_profile` table and associated features
* Recommendation engine query execution and scoring pipeline
