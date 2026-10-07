# Recipe: add a migration

Schema change = **new sequential file**, never edit a committed one (`AGENTS.md` §8).

1. `git status` first — shared checkout.
2. Create `database/migrations/NNN_short_description.sql` (next free number; CRLF line endings).
3. Write SQL. `002_enums.sql` uses a bare `CREATE TYPE`, but the runner is now
   **ledger-driven** (OG-14, 2026-10-04): it records each applied filename in
   `schema_migrations` and applies only the pending tail — the old "never re-run the runner /
   apply files individually" rule is superseded. Preview with
   `node scripts/run-migrations.js --dry-run`; a pre-ledger database is adopted once with
   `--baseline` (writes the ledger only, runs nothing).
4. Apply it. On the guarded branch: `node scripts/run-migrations.js --test-db`. On the SHARED
   database the runner **REFUSES (exit 1, ledger untouched) unless you pass
   `--restore-point=<id>`** — a Neon restore point id matching `^[A-Za-z0-9_-]{8,}$`. A
   placeholder such as `<PASTE ID HERE>` fails that shape on purpose. Without a valid id the
   runner prints the pending files and exits non-zero. The id is recorded (with the git SHA and
   a timestamp) in `database/migration-applies.jsonl`, one line per applied file.
   *Why a log file and not migration `019` adding `applied_by`/`notes` to `schema_migrations`:*
   `verify-migrations-replay.js` replays the raw files into an empty database and NEVER creates
   `schema_migrations` (the runner does), so a `019 ALTER TABLE schema_migrations` would abort
   the fresh replay with `relation "schema_migrations" does not exist`; the table is also part of
   `docs/SCHEMA_REFERENCE.md` and of the live schema digest, so its shape is a
   regenerated-docs dependency too.
5. Never add a migration *just* to make a test pass. Keep enums in sync; never drop or
   destructively alter one.
6. Update `docs/SCHEMA_REFERENCE.md` with `npm run gen:schema` (needs `DATABASE_URL`).
7. If the change touches Layer 4, re-check `database/LAYER4_RECONCILIATION_PLAN.md`'s ledger.

## The shared-apply audit log

`database/migration-applies.jsonl` is **tracked** and **append-only**: one CRLF-terminated JSON
object per applied file, so the file's history records what last changed the shared schema and from
which restore point.

The fields are a **whitelist** enforced by `formatApplyLogLine` (`scripts/lib/migrations.js`), not a
convention: `applied_at`, `filename`, `git_sha`, `note`, `restore_point`, `target`. An unknown key
is refused rather than dropped, so a connection string, user or hostname cannot be persisted into a
tracked file. `restore_point` is `null` only for the 017 backfill — applied before the guard
existed — and a null restore point **requires** a non-empty `note` saying why.

The apply prints `Reminder: commit database/migration-applies.jsonl ...`; commit that line with the
apply rather than later.

**Honest limitation:** the log records only what `run-migrations.js` did. It cannot prove that
nothing else wrote to the shared database, so it is an audit trail, not a guarantee — SQL applied by
hand is invisible here. TEST-target runs are never logged (the branch ledger is disposable).

Verify:

```bash
npm run gen:schema                              # regenerates both generated docs
npm run verify:docs                             # migrations-contiguous must stay PASS
node scripts/run-migrations.js --check          # no pending migrations (ledger gate)
npm run test:unit                               # 0 failures
```
