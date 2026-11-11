# AGENTS.md — database (schema, seeds, ledger, roles)

Scope: `database/migrations/`, `database/seeds/`, `database/migration-applies.jsonl`, and the
database-facing scripts in `scripts/`. The schema is authoritative here, not in prose; the generated
mirror is `docs/SCHEMA_REFERENCE.md` (never hand-edit it).

## Non-negotiables

- **Never reset, drop, truncate or restore the shared Neon database.** It is the only dev database.
- **Never rewrite or renumber a committed migration.** A change is a new sequential
  `NNN_short_description.sql`. The range is `001` … `023`; `node scripts/run-migrations.js --check`
  lists what is pending.
- **Apply only through the ledger** (`scripts/run-migrations.js`): it applies the pending tail, one
  transaction per file, and records each filename in `schema_migrations`. Never replay files by hand.
- **A real apply against the shared `DATABASE_URL` needs a recorded restore point.** The runner
  refuses (exit 1, ledger untouched) unless `--restore-point=<id>` matches `^[A-Za-z0-9_-]{8,}$`.
  `--test-db` and the read-only modes (`--dry-run` / `--check` / `--offline`) never need one.
  `--baseline` writes the ledger without running SQL, so it is guarded too.
- **Commit the audit line with the apply.** A shared apply appends one line per file to the tracked,
  append-only `database/migration-applies.jsonl`; `target` is a `db:<12 hex>` digest of the normalized
  host and database.
- **Seeds are DML-only and idempotent.** A schema change is a migration, never a seed.
- **Never change a migration to make a test pass**, and never drop or destructively alter an enum.

## Seed rules (learned the hard way)

- **Never split a seed file on `;`.** A `;` inside a header comment splits mid-comment, chunks start
  with `--`, and a `/^UPDATE/` filter silently drops them all: the apply reports success and writes
  nothing. Run the whole file with `client.query(rawText)`.
- **A seed carrying its own `BEGIN`/`COMMIT` cannot be rollback-rehearsed** by wrapping it in an outer
  transaction — the inner `COMMIT` ends the outer one and your `ROLLBACK` is a no-op. Rehearse on a
  throwaway branch, or strip the transaction markers first.
- **`run-seeds.js` always targets the shared `DATABASE_URL`.** It ignores `--test-db` and has no
  `getWriteTestDbUrl()` routing. To apply branch-first, connect through the branch client, run
  `SET search_path = public` (the branch client defaults to `pg_temp`), then send the whole file.
- **`--dry-run` only counts statements and characters; it never executes**, so it cannot catch a
  broken `INSERT`.
- **A `COALESCE`-based idempotency guard silently disables a corrective UPDATE.** For corrections use
  `WHERE col IS DISTINCT FROM <desired>` with an unconditional `SET`; reserve COALESCE for filling
  NULLs.
- **A corrective seed's green exit does not prove every row was updated.** A `VALUES` row matching no
  product updates 0 rows with no error — read the values back.
- **Deleting fixtures: dependents first.** Spec rows before `product`, `product` before
  `product_family`; for a pass: `build_rejection` → `recommendation_result` → `build_component` →
  `build_candidate` → `recommendation_query`.
- **A `|` inside any `docs/OPEN_GAPS.md` table cell breaks that row silently** (`gap-register-shape`
  fails with `ROW_CELL_COUNT`). Keep pipes out of cells 1-6.

## Commands

```bash
node scripts/run-migrations.js --check                 # pending files
node scripts/run-migrations.js --test-db               # apply pending to the TEST branch
node scripts/run-seeds.js --dry-run                    # count statements (no execution)
node scripts/verify-replay.js --test-db                # replay 001..023 into an empty DB, diff by definition
node scripts/check-target-parity.js --a=env:DATABASE_URL --b=env:TARGET_DATABASE_URL
node scripts/check-deferred-rules.js                    # Decision 26 item B data gate
node scripts/check-catalog-identity.js                  # every ACTIVE product has display_name + slug
npm run gen:schema                                      # regenerate the schema reference
```

Write-capable checks route through `scripts/lib/db-url.js` and `TEST_DATABASE_URL`; `getWriteTestDbUrl()`
returns a connection **config object** (`{ connectionString, connectionTimeoutMillis }`), not a URL.

## Recipes

`recipes/add-a-migration.md`, `recipes/add-a-seed.md`, `recipes/provision-the-api-role.md`.
Deployment and first-launch procedures stay at `docs/RECIPES/`.
