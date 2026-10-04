# Recipe: add a migration

Schema change = **new sequential file**, never edit a committed one (`AGENTS.md` §8).

1. `git status` first — shared checkout.
2. Create `database/migrations/NNN_short_description.sql` (next free number; CRLF line endings).
3. Write SQL. `002_enums.sql` uses a bare `CREATE TYPE`, but the runner is now
   **ledger-driven** (OG-14, 2026-10-04): it records each applied filename in
   `schema_migrations` and applies only the pending tail, so you apply your new file with a
   plain `node scripts/run-migrations.js` (or `--test-db` on the guarded branch) — the old
   "never re-run the runner / apply files individually" rule is superseded. Preview with
   `node scripts/run-migrations.js --dry-run`; a pre-ledger database is adopted once with
   `--baseline` (writes the ledger only, runs nothing).
4. Never add a migration *just* to make a test pass. Keep enums in sync; never drop or
   destructively alter one.
5. Update `docs/SCHEMA_REFERENCE.md` with `npm run gen:schema` (needs `DATABASE_URL`).
6. If the change touches Layer 4, re-check `database/LAYER4_RECONCILIATION_PLAN.md`'s ledger.

Verify:

```bash
npm run gen:schema                              # regenerates both generated docs
npm run verify:docs                             # migrations-contiguous must stay PASS
node scripts/run-migrations.js --check          # no pending migrations (ledger gate)
npm run test:unit                               # 0 failures
```
