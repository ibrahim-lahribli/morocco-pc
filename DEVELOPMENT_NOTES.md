# Development Notes

Operational knowledge base for `morocco-pc`. Purpose: capture verified workflows, failure modes, and lessons so future agents avoid repeating investigations.

- `CONTEXT.md` = what the project is and how it is designed.
- `DEVELOPMENT_NOTES.md` = what has been learned while developing it and how to avoid previous mistakes.

## ENVIRONMENT

- Node.js project. Dependencies: `pg` (PostgreSQL client), `dotenv`. Node's built-in test runner for unit tests. No local PostgreSQL required.
- Database: PostgreSQL on **Neon** (cloud). Single shared development database; not disposable.
- Connection: `DATABASE_URL` from `.env`. `.env.example` contains the key name only, never a real value.
- Scripts bootstrap with `require('dotenv').config()` and exit immediately when `DATABASE_URL` is missing.
- Migration execution: `node scripts/run-migrations.js` applies `database/migrations/*.sql` in sorted filename order, then prints tables / foreign keys / enums / a UUID check. **The runner is not re-runnable against an already-migrated database** (see failure modes).
- Test execution:
  - `npm run test:db` — connection + `public` table listing (`scripts/test-db.js`).
  - `npm run test:unit` — engine unit tests (`node --test "src/**/*.test.js"`).
  - Targeted DB scripts run directly with `node scripts/<name>.js` (see VERIFIED COMMANDS).

## VERIFIED COMMANDS

Commands verified to work in this repository/environment:

| Command | What it does | Re-run safe |
|---|---|---|
| `npm run test:db` | DB connection + table listing | yes |
| `node scripts/run-migrations.js` | applies all migrations + verification | only on a fresh DB — see failure modes |
| `node scripts/test-compatibility.js` | Layer 1 compatibility/provenance constraints (fixture-based) | yes (47/47) |
| `node scripts/verify-hardware-schema.js` | hardware schema tables/constraints | yes |
| `node scripts/test-layer3.js` | Layer 3 canonical schema functional tests | yes |
| `node scripts/test-layer4.js` | Layer 4 canonical schema functional/integration tests (single transaction + SAVEPOINTs) | yes |
| `node scripts/verify-schema.js` | columns/types for core tables | yes |
| `node scripts/verify-constraints.js` | indexes / primary keys | yes |
| `node scripts/verify-fks.js` | foreign keys | yes |
| `npm run test:unit` | recommendation engine unit tests (`src/recommendation/**`) | yes |
| `git status`, `git diff`, `git log --oneline`, `git remote -v`, `git mv` | repo inspection / rename | — |

Note: commit and push commands were NOT executed in this session (the documentation task explicitly forbade them), so they are not listed as verified.

## KNOWN WORKING TOOLS

### Applying a new migration to the shared Neon database

#### Problem

`scripts/run-migrations.js` re-executes the full sequence every time with no applied-migrations tracking, and `002_enums.sql` uses a bare `CREATE TYPE`. Re-running the full sequence against the already-migrated Neon DB aborts at `type "product_category" already exists`.

#### Failure

The full-sequence runner cannot be used twice against the live database.

#### Working solution

1. Create the new `NNN_*.sql` migration in `database/migrations/`.
2. Apply ONLY that file with a one-off temp script (`pg.Client` + `fs.readFileSync`), run it, verify with read-only catalog queries, then delete the temp script.
3. Confirm idempotency by applying the new file a second time when its safety gate allows (this is exactly how 011 was applied).

#### Rule for future agents

Never re-run the full runner on the live DB. Apply new migration files individually and delete the one-off script afterwards.

### Live-database inspection before corrective migrations

#### Problem

The live Neon DB has drifted from the migrations before (undocumented Layer 3 and Layer 4 implementations).

#### Failure

Assuming the live DB matches the migration files leads to corrective migrations that do not apply or silently alter unintended objects.

#### Working solution

Inspect the live catalogs first with read-only queries and scripts: `node scripts/test-db.js`, `verify-schema.js`, `verify-constraints.js`, `verify-fks.js`, and one-off read-only SELECTs over `information_schema` / `pg_type`.

#### Rule for future agents

Never assume the live DB contains only the objects in Git migrations. Inspect tables, columns, enums, constraints, indexes, and row counts before planning schema work.

### Git operations

#### Working solution

- Working branch: `master`. Remote `origin` = https://github.com/ibrahim-lahribli/morocco-pc.git.
- Renaming a tracked file preserves history: `git mv <old> <new>` (used this session for `PROJECT_CONTEXT.md` → `CONTEXT.md`).
- Commit history uses conventional prefixes (feat, fix, docs, test) per `git log --oneline`.
- Change review: `git status --porcelain`, `git diff`.

#### Common failures

- None recorded this session. Known working-tree noise: untracked `.kilo/kilo.jsonc` (tool config — keep out of commits).

#### Rule for future agents

Stage only intended files; never stage `.env` or `node_modules`. Do not commit or push during documentation-only tasks unless instructed.

## IMPORTANT FAILURE MODES

Deduplicated historical lessons. Each entry records the problem, what failed, the working solution, and the rule for future agents.

### Migration numbering conflict (2026-09-11)

Problem: two migration files shared the same numeric prefix (a duplicate number was introduced), making filename-sort ordering ambiguous.

Failure: ordering was no longer deterministic; `005` and `006` prefixes collided.

Working solution: renamed `005_compatibility_tables.sql` → `006_compatibility_tables.sql` and `006_provenance_tables.sql` → `007_provenance_tables.sql`, and updated internal references.

Rule: always use padded sequential numbering (001, 002, …) and never reuse a number. Fix a conflict by renaming the affected files and updating references — never by inserting a new number mid-sequence.

### Hardware schema corrections after 004 (2026-09-11)

Problem: migration 004 introduced fields that were later removed or changed (inferred GPU fields, incorrect column types).

Failure: the initial hardware migration disagreed with the decided architecture.

Working solution: migration 004 was updated to the corrected schema for fresh databases, and a corrective `005_hardware_schema_corrections.sql` was added for the existing database using `IF EXISTS` / `IF NOT EXISTS` and safe casts — no data loss.

Rule: after a migration has been applied to a shared environment, add a corrective migration rather than rewriting history. Keep corrective SQL defensively idempotent for fresh and existing databases.

### test-compatibility.js cleanup ordering (2026-09-11, pre-existing)

Problem: re-runs failed with `ERROR: update or delete on table "product" violates foreign key constraint "motherboard_spec_product_id_fkey"`.

Cause: cleanup deleted `TestCompat%` products before the one-to-one spec rows, `component_assessment`, `benchmark_result`, `store_offer`/`price_history`, `product_variant`/`gpu_board_spec`, and seeded reference rows that FK-reference them; a leftover `memory_type 'TestDDR5Compat'` also blocked re-seeding.

Working solution: dependency-safe cleanup order — junction/compat rows → one-to-one spec rows → Layer 2/3 dependents → provenance/candidate/alias → `product` → reference rows (`product_family`, `chipset`, `socket`, `memory_type`, `manufacturer`). The test now passes 47/47 and is re-runnable.

Rule: when adding fixtures, add matching cleanup in dependency-safe order. Never delete `product` before its FK dependents.

### No isolated fresh-migration environment (standing limitation)

Problem: a fresh 001→011 migration test requires an empty, isolated PostgreSQL database; none exists (shared Neon only, no local `psql`, no Docker).

Failure: `run-migrations.js` full re-run on the already-migrated DB aborts at `002_enums.sql` (bare `CREATE TYPE`, not idempotent).

Working solution: none yet. Layer 3 and Layer 4 reconciliations (010/011) were applied in place after confirming the target tables had 0 rows.

Rule: report fresh-migration as NOT VERIFIED / BLOCKED until an isolated database exists (Docker Postgres, a Neon branch, or a `TEST_DATABASE_URL` pointing at a scratch DB). Do not fake a fresh-migration result against the shared Neon DB.

### Neon connection intermittency

Problem: Neon is a shared cloud service; connections can stall or be slow.

Failure: scripts without a timeout can hang; intermittent connectivity was observed during development.

Working solution: DB scripts set an explicit connection timeout — e.g. `connectionTimeoutMillis: 15000` in `scripts/test-layer3.js`. Prefer short-lived connections and read-only catalog queries for inspection.

Rule: always set explicit timeouts in DB scripts; never assume a long-lived connection.

### Layer 3 schema drift (2026-09-11)

Problem: live `store` / `store_offer` / `price_history` did not match migration 009 — a pre-existing, undocumented earlier implementation with different CHECK constraints, nullable NOT-NULL columns, extra indexes, and an old offer-level unique constraint.

Working solution: all three tables had 0 rows, so migration 010 reconciled in place (naive timestamps → `TIMESTAMPTZ`, canonical checks, removed `uq_store_offer_store_product_variant`, canonical indexes).

Rule: migration 009 is the authoritative fresh-DB Layer 3 schema; post-009 changes need new corrective migrations. Multiple offers per store/product/variant are legitimate — do not reintroduce offer-level uniqueness.

### Layer 4 schema drift (2026-09-12)

Problem: the live DB already contained the five Layer 4 tables plus a `component_role` enum — undocumented, empty, and with defects vs the agreed architecture (naive timestamps, nullable `scoring_model_id`, redundant `build_component.category`, `>= 0` price checks, missing uniqueness on ranks/roles).

Working solution: `011_reconcile_layer4.sql` (dual-mode: fresh-create vs 0-row reconcile, with a safety gate) applied and re-applied to confirm idempotency, then verified with read-only catalog queries. Full details: `database/LAYER4_RECONCILIATION_PLAN.md`.

Rule: migration 011 is the canonical Layer 4 schema — do not create Layer 4 tables from scratch. `scripts/test-layer4.js` exercises the canonical schema (single transaction, SAVEPOINTs, rollback).

### run-migrations.js non-idempotency (tool limitation)

Problem: the runner re-executes every file with no applied-migrations tracking; `002_enums.sql` uses a bare `CREATE TYPE`.

Failure: a second full run against the live DB aborts; new migrations (010, 011) had to bypass the runner.

Working solution: apply new migration files individually through a one-off temp script, then delete it (011 was additionally re-applied to confirm idempotency).

Rule: treat the runner as safe only for the first run on a fresh database; otherwise apply files individually.

### Timestamp double-conversion pitfall (migration 011)

Problem: `ALTER COLUMN ... TYPE TIMESTAMPTZ USING col AT TIME ZONE 'UTC'` is only safe for `timestamp without time zone`. If the column is already `TIMESTAMPTZ`, `AT TIME ZONE 'UTC'` produces a naive timestamp that PostgreSQL re-interprets in the session timezone — shifting values on non-UTC sessions.

Working solution: 011 loops over `information_schema.columns` and converts ONLY columns still typed `timestamp without time zone`, so it is safe against both starting states.

Rule: guard timezone-conversion SQL by the starting column type; never assume a single starting state in corrective migrations.

## DATABASE LESSONS

- The shared Neon database is **not a disposable test database** — never reset, drop, or restore it.
- Never use destructive reset operations (DROP / TRUNCATE / restore) for testing.
- Use a transaction for fixture-based functional tests and roll back fixtures — see `scripts/test-layer4.js` (single transaction + SAVEPOINTs + explicit reverse-dependency cleanup + final ROLLBACK). Fixture tests that do not use transactions (`test-compatibility.js`, `verify-hardware-schema.js`) must delete their fixtures explicitly in dependency-safe order.
- Roll back or delete test fixtures so tests stay re-runnable.
- Use connection timeouts in scripts (Neon intermittency).
- Distinguish schema drift from migration history: the live DB has drifted before (Layers 3 and 4) while the migrations became authoritative for fresh databases.
- Inspect live metadata (tables, columns, enums, constraints, indexes, row counts) before creating corrective migrations.
- `NULL` means UNKNOWN; UNKNOWN never means PASS. Do not write migrations that blur this distinction.
- Never claim a fresh migration was verified unless it ran on an isolated empty database.

## TESTING LESSONS

- `npm run test:db` — connection + table listing. No fixtures. Safe to rerun.
- `node scripts/test-compatibility.js` — Layer 1 compatibility tables, partial unique indexes, provenance/data-quality rules. Uses and cleans `TestCompat%` fixtures. Safe to rerun (47/47). Do **not** use the `TestCompat%` prefix for real data.
- `node scripts/verify-hardware-schema.js` — hardware spec tables and CHECK constraints. Uses and cleans `Test Product%` / `TEST-%` fixtures. Safe to rerun.
- `node scripts/test-layer3.js` — Layer 3 canonical schema (columns, CHECKs, indexes, enums). Requires the three Layer 3 tables to be empty; transactional cleanup. Safe to rerun.
- `node scripts/test-layer4.js` — Layer 4 canonical schema (migration 011): 9-FK layout, CHECKs, uniqueness (ranks, component roles), `component_role` enum; fixture-based with final rollback. Safe to rerun.
- `npm run test:unit` — pure unit tests for `src/recommendation/**` (Engine 1–2B); no database required.
- Environmental limitations: fresh 001→011 migration cannot be verified (no isolated DB); DB-backed scripts need network access to Neon and a configured `DATABASE_URL`.
- Fixture cleanup requirement: everything created must be removed/rolled back in reverse-dependency order; row counts return to baseline.

## GIT LESSONS

- Branch convention: work on `master` (the only branch in the repository).
- Change checking: `git status --porcelain`, `git diff`, `git log --oneline`.
- Renames preserve history: `git mv <old> <new>` (verified this session: `PROJECT_CONTEXT.md` → `CONTEXT.md`).
- Commit history uses conventional prefixes (feat, fix, docs, test) — keep that style.
- Commit/push: history shows commits on `master` pushed to `origin`, but the exact commit/push commands were NOT re-verified in this session (the task forbade committing). Re-verify a commit/push workflow before relying on it.
- Common failures: none recorded this session. Working-tree noise: untracked `.kilo/kilo.jsonc` (tool config — keep out of commits).
- `.env`, `node_modules`, logs are gitignored; never force-add or expose them.

## DOCUMENTATION UPDATE RULE

At the end of every significant development session, update `DEVELOPMENT_NOTES.md` when you discover:

- a new failure
- a new working solution
- an environment limitation
- a database-specific issue
- a migration lesson
- a testing lesson
- a Git/tooling lesson

Do not record trivial events. Never store secrets. Never claim something was tested if it was not actually executed.