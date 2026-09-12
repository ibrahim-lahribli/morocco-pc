# Development Notes

## How to use this file

Before performing development work:

1. Read `PROJECT_CONTEXT.md`.
2. Read this file.
3. Follow existing successful workflows before trying alternative tools.
4. Add new lessons when a problem is solved.

---

## Known working environment

* Node.js project using `pg` (PostgreSQL client) and `dotenv`.
* Database: Neon cloud PostgreSQL.
* Connection string is read from `DATABASE_URL` in `.env`.
* `npm run test:db` executes `scripts/test-db.js`.
* Migration runner: `scripts/run-migrations.js` reads all files from `database/migrations/` in sorted filename order and applies them sequentially.
* Verification scripts exist in `scripts/` (see Testing Lessons section for details).
* No local PostgreSQL installation is required.

---

## Database workflow

The verified workflow for schema changes is:

1. Create a new migration file in `database/migrations/` with a padded sequential number (e.g. `010_new_feature.sql`).
2. Write idempotent SQL where practical (`CREATE TABLE IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`, etc.).
3. Apply the migration to the Neon development database using the project's migration runner or direct `psql`.
4. Run `scripts/run-migrations.js` to confirm the migration applies cleanly and verify tables/FKs/enums are present.
5. Run existing test suites (`npm run test:db`) to confirm no regressions.
6. Confirm no unintended tables or columns were introduced.

---

## Tool / workflow lessons

### Node script execution

All database scripts use:
```js
require('dotenv').config();
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
```

The project does not use a separate migration framework. Migrations are plain `.sql` files applied sequentially by the custom Node script.

### Inspect the live database before creating migrations

Never assume the live Neon database contains only objects represented by Git migrations. Before creating a new migration, inspect both the repository migrations and the live database catalogs (tables, columns, enums, constraints, indexes) via read-only catalog queries.

---

## Migration lessons

---

## Migration lessons

### Migration numbering conflict

Date: 2026-09-11

Problem:
Two migration files shared the same prefix number (`005_` and `006_`) after earlier additions, creating ambiguous ordering.

Attempt:
Implicit ordering relied on filename sort.

Result:
Files were renamed to resolve the conflict:
`005_compatibility_tables.sql` -> `006_compatibility_tables.sql`
`006_provenance_tables.sql` -> `007_provenance_tables.sql`

Working method:
Always use padded sequential numbering (001, 002, ...) and never reuse a number. When resolving a numbering conflict, rename all affected migrations and update internal comments.

Instruction for future sessions:
Do not create a migration with a number that already exists in `database/migrations/`. If a numbering conflict is discovered, fix it by renaming the conflicting files and updating references, not by inserting a new number in the middle of the sequence.

---

## Schema lessons

### One-to-one PK = FK pattern

Hardware specification tables use the same UUID as both PRIMARY KEY and FOREIGN KEY to `product` (or `product_variant`). This enforces one-to-one cardinality and simplifies joins.

### Partial unique indexes

Compatibility tables use partial unique indexes to allow both a family-level rule and an exact-CPU rule to coexist for the same motherboard, while preventing duplicate rules within the same specificity tier.

Example:
```sql
CREATE UNIQUE INDEX idx_cpu_mb_support_family
  ON cpu_motherboard_support (motherboard_product_id, cpu_product_family_id)
  WHERE cpu_product_id IS NULL;
```

### CHECK constraints for controlled vocabularies

`CHECK` constraints enforce:
* Enum values for status fields (e.g. `compatibility_status`, `assessment_type`).
* Positive ranges for numeric measurements (e.g. `CHECK (length_mm > 0)`).
* Cross-column logic (e.g. `threads >= cores`, `boost >= base`).

### JSONB for structured but variable data

`gpu_board_spec.required_power_connectors` uses JSONB because connector requirements vary by GPU but the schema does not need a full normalised table at Layer 1.

### PostgreSQL enum modification

When upgrading a column from `TEXT` to an enum type on an existing database, use a safe cast:
```sql
ALTER TABLE component_assessment
  ALTER COLUMN assessment_type TYPE assessment_type USING assessment_type::text::assessment_type;
```

### Foreign-key ordering

Tables must be created before they are referenced. Migration 008 explicitly re-adds a foreign key to `benchmark_source` to handle cases where the table was created before the constraint existed.

---

## Testing lessons

### Test scripts

| Script | Purpose |
|---|---|
| `npm run test:db` | Runs `scripts/test-db.js` — basic connection and table listing |
| `scripts/run-migrations.js` | Applies all migrations and verifies tables, FKs, enums |
| `scripts/verify-schema.js` | Lists columns and types for core identity tables |
| `scripts/verify-constraints.js` | Lists indexes and primary keys |
| `scripts/verify-fks.js` | Lists foreign key relationships |
| `scripts/test-compatibility.js` | Validates compatibility tables, constraints, partial indexes, and provenance data-quality rules |
| `scripts/verify-hardware-schema.js` | Validates hardware schema tables and constraints |

### How to run tests

```bash
npm run test:db
node scripts/run-migrations.js
node scripts/test-compatibility.js
node scripts/verify-hardware-schema.js
```

### Important failure modes

* `DATABASE_URL is not set in .env` — script exits immediately.
* `test-compatibility.js` cleans up previous test data by deleting rows with names matching `TestCompat%`. Do not use that prefix for real data.
* `test-compatibility.js` cleanup order is intentional and must delete ALL rows that FK-reference a `TestCompat%` product BEFORE deleting the `product` row. That includes the one-to-one hardware spec tables (`cpu_spec`, `motherboard_spec`, `cooler_spec`, `case_spec`, `ram_spec`, `ssd_spec`, `psu_spec`), `component_assessment`, `benchmark_result`, `store_offer`/`price_history`, and `product_variant`/`gpu_board_spec`, plus the seeded reference rows (`memory_type 'TestDDR5Compat'`, etc.). If you touch this cleanup, keep that ordering.
* Constraint violations in test scripts are expected for negative test cases and are handled with `assertRejects`.

---

## Problems encountered

### 2026-09-11 — Duplicate migration numbers

Problem:
Two migration files shared the same numeric prefix.

Attempt:
Resolved by renaming files and updating internal references.

Result:
Migration ordering is now deterministic.

Solution:
Renamed `005_compatibility_tables.sql` to `006_compatibility_tables.sql`.
Renamed `006_provenance_tables.sql` to `007_provenance_tables.sql`.

Future instruction:
Maintain padded sequential numbering. Do not reuse numbers. Rename all affected migrations if a conflict is found.

---

### 2026-09-11 — Hardware schema corrections after initial migration

Problem:
Initial hardware schema (migration 004) contained fields that were later removed or changed (inferred GPU fields, incorrect column types).

Attempt:
Added a separate corrective migration (005) that is safe for both fresh and existing databases.

Result:
`005_hardware_schema_corrections.sql` applies cleanly to the existing Neon database and to fresh databases.

Solution:
Migration 004 was updated to the corrected schema. Migration 005 uses `IF EXISTS` / `IF NOT EXISTS` and safe casts to correct existing databases without data loss.

Future instruction:
When a schema change is required after a migration has already been applied to shared environments, add a new corrective migration rather than rewriting history.

---

### 2026-09-11 — Compatibility test cleanup-order failure (pre-existing, unrelated to migration 009)

Problem:
`scripts/test-compatibility.js` failed during its fixture cleanup on re-runs:
`ERROR: update or delete on table "product" violates foreign key constraint "motherboard_spec_product_id_fkey" on table "motherboard_spec"`.

Cause:
The test's cleanup deleted `product` rows (name LIKE `TestCompat%`) BEFORE deleting the one-to-one hardware spec rows the test itself creates (`cpu_spec`, `motherboard_spec`, `cooler_spec`, `case_spec`) that FK-reference those products. A first run left the spec rows behind, so every subsequent run violated the FK. After fixing the hardware spec order, the next blocker was leftover `component_assessment` rows (Layer 2 / migration 008) referencing `TestCompatMotherboard`; then `memory_type 'TestDDR5Compat'` was a duplicate-key blocker because the test seeds it but never cleaned it.

Dependency / order problem:
`product` must be the LAST row deleted among everything that references it, and every seeded reference row (spec tables, `component_assessment`, `benchmark_result`, `store_offer`/`price_history`, `product_variant`/`gpu_board_spec`, `memory_type`, `product_family`, `chipset`, `socket`, `manufacturer`) must be removed first.

Correct cleanup approach:
1. Delete junction/compat rows for `TestCompat%` products.
2. Delete one-to-one hardware spec rows (`cpu_spec`, `motherboard_spec`, `cooler_spec`, `case_spec`, `ram_spec`, `ssd_spec`, `psu_spec`) for `TestCompat%` products.
3. Delete Layer 2/3 product-FK dependents (`component_assessment`, `benchmark_result`, `store_offer`/`price_history`, `product_variant`/`gpu_board_spec`) for `TestCompat%` products.
4. Delete provenance/candidate/alias/ingestion rows.
5. Delete `product`, then `product_family`, `chipset`, `socket`, `memory_type`, `manufacturer`.

Result:
Fix applied to `test-compatibility.js` only. No schema/constraint change. Test now passes 47/47 and is re-runnable. The failure was NOT related to migration 009 (009 adds `store`/`store_offer`/`price_history`, which the test never touches).

Instruction for future sessions:
When adding rows to `test-compatibility.js` fixtures, also add the matching cleanup in dependency-safe order so the test remains re-runnable. Never clean up by deleting `product` before its FK dependents.

---

### 2026-09-11 — No isolated fresh-migration test environment (current environment limitation)

Problem:
A fresh 001→009 migration test requires an empty, isolated PostgreSQL database. None is available:
* `DATABASE_URL` in `.env` points to the single shared Neon development database.
* No local PostgreSQL (`psql` not installed) and no Docker are available.
* `scripts/run-migrations.js` re-running the FULL sequence against the already-migrated Neon DB fails at `002_enums.sql` with `type "product_category" already exists` (migration 002 uses plain `CREATE TYPE`, not `IF NOT EXISTS`).

Result:
A genuine fresh 001→009 migration is NOT VERIFIED. Migration 009 does apply cleanly to the existing database and the Layer 3 tables/constraints/indexes are present, but this is not a fresh-DB test.

Instruction for future sessions:
Report fresh-migration as NOT AVAILABLE until an isolated database (e.g., Docker Compose Postgres, a Neon branch, or a `TEST_DATABASE_URL` pointing to a scratch DB) is configured. Do not fake a fresh-migration result against the shared Neon DB.

---

### 2026-09-11 — Live Neon DB Layer 3 schema drifts from migration 009

Problem:
The live Neon database's `store` / `store_offer` / `price_history` objects do not exactly match `database/migrations/009_market_tables.sql`. This is pre-existing drift (not introduced by this session; no schema was changed):
* Price CHECK constraints are named `chk_store_offer_price_nonneg` / `chk_price_history_price_nonneg` (>=0) in the DB vs `chk_store_offer_price_positive` / `chk_price_history_price_positive` (>0) in migration 009.
* The `_not_empty` CHECK constraints from migration 009 (`chk_store_name_not_empty`, `chk_store_offer_currency_not_empty`, `chk_store_offer_availability_not_empty`, `chk_price_history_currency_not_empty`, `chk_price_history_availability_not_empty`) are absent in the DB.
* `store_offer.last_checked_at`, `store_offer.availability`, and `price_history.availability` are NULLABLE in the DB but `NOT NULL` in migration 009.
* The DB has extra indexes not present in migration 009: `idx_store_active`, `idx_price_history_store_offer_id`, `idx_price_history_store_offer_observed` (DESC), and unique `uq_store_offer_store_product_variant`.

Result:
The intended Layer 3 target (migration 009) and the live DB are out of sync.

Instruction for future sessions:
Migration 009 was finalized as the authoritative fresh-database Layer 3 schema. Migration 010 was then created and applied after a safety gate confirmed zero rows in all three Layer 3 tables. It explicitly converted UTC timestamp-without-time-zone values to `TIMESTAMPTZ`, enforced required fields and canonical checks, removed the old offer-level uniqueness, and reconciled indexes.

The old unique constraint/index `uq_store_offer_store_product_variant` was removed because legitimate multiple seller/listing records may share the same store, product, and optional variant. The canonical history index is `idx_price_history_store_offer_observed` on `(store_offer_id, observed_at DESC)` plus `idx_price_history_observed_at`; the redundant standalone history foreign-key index is not retained. `idx_store_active` and the four current-offer indexes remain canonical.

Neon initially contained an undocumented earlier/independent Layer 3 implementation. It contained no Layer 3 rows, so reconciliation was applied without data migration complexity. Do not rewrite migrations 001-009; future post-009 changes require a new corrective migration.

A true fresh 001→010 migration remains unavailable because no isolated PostgreSQL environment is configured. Neon was reconciled in place, but a fresh migration must not be claimed as verified until a scratch database, Neon branch, Docker PostgreSQL, or equivalent isolated environment is available.

---

### 2026-09-12 — Live Neon DB Layer 4 tables already exist (undocumented drift)

Problem:
A read-only architecture review of the live Neon database (catalog queries only — no schema changes were made) discovered that the five planned Layer 4 tables already exist in the live database:

* `recommendation_profile`
* `recommendation_query`
* `recommendation_result`
* `build_candidate`
* `build_component`

Details:
* None of these tables is represented in migrations 001–010.
* An undocumented enum `component_role` also exists, with values CPU, GPU, MOTHERBOARD, RAM, SSD_BOOT, SSD_SECONDARY, PSU, CASE, CPU_COOLER.
* All five tables currently contain 0 rows.
* This is a live-database drift/reconciliation situation, similar to the previous Layer 3 incident (see the 2026-09-11 entry above).
* The existing live tables have several defects versus the agreed Layer 4 architecture (naive timestamps, nullable scoring-model reference, redundant `build_component.category` column, >= 0 price checks, missing uniqueness on ranks and component roles, missing indexes). The full comparison and reconciliation decisions are documented in `database/LAYER4_RECONCILIATION_PLAN.md`.
* Migration 011 has NOT yet been created and has NOT been applied. No database changes were made during this review. The authoritative Layer 4 design is still being finalized in that plan file.

Instruction for future sessions:
Do not create Layer 4 tables or a Layer 4 `CREATE TABLE` migration from scratch — the live tables already exist and are empty. Migration 011 must be a reconciliation migration (same pattern as migration 010) that codifies the live objects as the authoritative fresh-database Layer 4 schema and applies the corrections listed in `database/LAYER4_RECONCILIATION_PLAN.md`. Fresh 001→011 migration testing remains NOT AVAILABLE until an isolated scratch database exists.

---

## Rules for updating this file

At the end of every development session:

1. Review whether any new problem was encountered.
2. Review whether a new successful workflow was discovered.
3. Review whether an existing instruction turned out to be wrong.
4. Add or update the relevant entry.
5. Do not add noise or trivial events.
6. Do not duplicate architectural documentation unnecessarily.
7. Never store secrets.
8. Never claim something was tested if it was not tested.

If a previous instruction becomes obsolete, update it rather than creating contradictory instructions.
