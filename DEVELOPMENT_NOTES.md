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
