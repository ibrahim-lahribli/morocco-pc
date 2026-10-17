# Recipe: provision the production database role (`morocco_pc_api`)

Platform P3 Sprint 2 Step 5. This is **DDL on the only dev database**, so it is owner-gated:
prepare it, run it deliberately, record the outcome (`PLAN_PLATFORM_CONSTRAINTS.md`, "prepare
owner-gated steps, then record them"). It is **not** a migration and never goes through
`run-migrations.js` — the role is cluster-scoped, and nothing about it belongs in
`schema_migrations`.

Two scripts do the work, and each refuses the ways it could do harm:

| Script | What it is | Writes |
|---|---|---|
| `node scripts/apply-api-role.js` | the Apply — creates the role and the 20-grant block | DDL on the SHARED database |
| `node scripts/smoke-api-role.js` | the Smoke test — runs the API as the role and removes what it wrote | one Layer 4 pass, deleted again |

The role's contract — the 20 privilege answers, the GRANT block, the self-check SQL, the teardown
sweep — lives in **one** module, `scripts/lib/api-role.js`, consumed by both scripts and by the
branch rehearsal (`scripts/rehearse-api-role.js`). If you need to change a grant, change it there:
`npm run test:scripts` pins the fixture, the statements and the satisfiability of every `true`
answer.

## Prerequisites

1. `git status` first — shared checkout. Note the HEAD sha; the apply records it.
2. `.env` holds the **shared** `DATABASE_URL` (the apply has no branch mode by design: the branch
   rehearsal is a different script).
3. The database owner's credential, i.e. what `DATABASE_URL` already carries.
4. A Neon **restore point** (step 1 below) — a recorded `br-…` id, not a promise.
5. The role password, generated so it never lands in a shell history, a terminal scrollback or
   chat. Write it to a file **outside the repository**:

   ```
   node -e "require('fs').writeFileSync(process.argv[1], require('crypto').randomBytes(24).toString('base64url'))" "$HOME/.morocco-pc/api-role.password"
   ```

   `API_ROLE_PASSWORD` in the environment works too, but a file keeps the secret out of `ps` and
   out of every log. Never pass it as an argument — neither script accepts one.

## Verified on the way in (measured 2026-10-17)

`node scripts/apply-api-role.js --dry-run` prints `AUDIT TARGET: db:54ff6ea3f6e6` for the shared
endpoint `ep-crimson-dream-axfxou6r`, and `node scripts/run-migrations.js --dry-run` prints the
same digest for the same `DATABASE_URL`. The check in step 2 is therefore a comparison, not a
guess.

**The shared database is a migration BEHIND the API's code, and closing that gap is a separate
owner step.** Its ledger stands at 020, while the API reads and writes
`recommendation_query.catalog_version` (021, Decision 47) and reads `recommendation_preset` (022,
Decision 48). The role apply is unaffected — a GRANT does not care whether a column exists — but
the API cannot serve a single request against a 020 schema, and the smoke test in step 4 REFUSES
such a target up front and names the pending migrations. That refusal exists because the failure
a `42703` / `42P01` produces at the edge is a generic `500 INTERNAL_ERROR`, which reads exactly
like a privilege fault and sends the operator hunting through grants for a pending migration. The
order is therefore: apply 021+022 to shared through the migration runner with its own recorded
restore point (see `docs/RECIPES/add-a-migration.md`), then this recipe.

## Steps

1. **Record the restore point FIRST.** In the Neon console, on the project's branch, create a
   restore point (or a branch) for the shared database at this moment and copy its id — it looks
   like `br-damp-grass-axyri6yl`, the id used for the 019+020 shared apply on 2026-10-15. The
   apply REFUSES (exit 1, nothing written) unless `--restore-point=<id>` matches
   `^[A-Za-z0-9_-]{8,}$`; a placeholder such as `<PASTE ID HERE>` fails that shape on purpose. The
   id is recorded in the apply's report — it is the one field that makes a rollback possible.

2. **Preview the plan.** Connects to nothing, reads no password, needs no restore point:

   ```
   node scripts/apply-api-role.js --dry-run
   ```

   Expected: `AUDIT TARGET: db:<12 hex>` and the 8 statements with the password redacted.
   **Check the digest before you apply anything**: any mode of the migration runner prints the
   digest of whatever `DATABASE_URL` holds, before its restore-point guard, so
   `node scripts/run-migrations.js --dry-run` must print the SAME `AUDIT TARGET:` line (measured
   2026-10-17: both print `db:54ff6ea3f6e6` for the shared endpoint `ep-crimson-dream-axfxou6r`).
   Two independent code paths agreeing is the check; a different digest means `DATABASE_URL`
   points somewhere else — stop. Do NOT compare against `database/migration-applies.jsonl`: its
   four committed lines predate the digest format and carry the legacy inferred role name
   (`"target":"shared"`), which is why the run prints the digest for you instead.

3. **Apply:**

   ```
   node scripts/apply-api-role.js --restore-point=<br-id> --password-file="$HOME/.morocco-pc/api-role.password"
   ```

   Expected on green: `APPLIED: morocco_pc_api on db:<12 hex>, self-check 20/20`, and in the JSON
   report `statements_applied: 8`, `role_exists_after: true`, `rolled_back: false`, plus a
   `record_for_development_notes` line to paste in step 6.

   * A **red self-check ROLLS THE ROLE BACK** (REVOKE sweep, then `DROP ROLE`) and exits 1. Read
     the report's `self_check.missing` / `mismatches` / `unexpected` before retrying: a mismatch
     means the grant block and the fixture disagree, which is a code defect, not a flaky run.
   * An **existing role is refused**, not recreated or dropped. Decide deliberately — normally:
     run the rollback sequence from step 5, confirm the role is gone, then re-apply.
   * Exit codes: `2` usage (`--help` included), `1` refused or failed (including a failed self-check
     or a failed rollback), `0` applied with every privilege answer matched.

4. **Smoke-test the API as the role.** This is the step that proves the API's OWN code path — its
   pool guard, its routes, its repository statements and the engine's write path — rather than
   what the role merely MAY do:

   ```
   node scripts/smoke-api-role.js --confirm-shared --password-file="$HOME/.morocco-pc/api-role.password"
   ```

   `--confirm-shared` is required and nothing in CI sets it: this test POSTs a real recommendation
   to the shared database, then deletes the rows it wrote and asserts the six Layer 4 counts
   returned to their pre-run values. Expected on green: `SMOKE OK: … health db=ok, POST 201 with
   <n> builds, <n> statements, residue back to its pre-run counts`.

   Three ways it reports something other than green, and none is a pass:
   * **inconclusive** — `POST` committed **0 builds**, so the INSERT grants on the four build
     tables were never exercised. Re-run with a larger `--budget`.
   * **refused (schema)** — the target is behind the API: 021's `recommendation_query.catalog_version`
     or 022's `recommendation_preset` is absent. The run stops before writing anything and names the
     pending migration; the role is not the problem.
   * **refused (role)** — the role does not exist yet (step 3 has not run), or no password was supplied.
   * **failed** — a `42501` on the API's pool, or residue that did not return. A failed cleanup is
     a failure of the run; delete the leftovers in FK order
     (`build_rejection` → `recommendation_result` → `build_component` → `build_candidate` →
     `recommendation_query` → `recommendation_profile`) before re-running, because the golden
     harness refuses to run while ANY unmarked `recommendation_query` row exists.

5. **Rollback, if you need it.** The apply prints this sequence verbatim when it refuses an
   existing role; the same statements are `buildRemovalStatements()` in `scripts/lib/api-role.js`:

   ```sql
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM morocco_pc_api;
   REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM morocco_pc_api;
   REVOKE ALL ON SCHEMA public FROM morocco_pc_api;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM morocco_pc_api;
   DROP ROLE morocco_pc_api;
   ```

   The sweep is not optional and the reason is measured (2026-10-17): while the grants are held,
   `DROP ROLE` fails `2BP01` ("cannot be dropped because some objects depend on it") and
   `DROP OWNED BY` is refused `42501` because the owner is not a MEMBER of the role it just
   created. Revoking those four scopes empties `pg_shdepend` (44 → 0 rows) and the `DROP ROLE`
   then succeeds. Rolling the role back does not touch data: the only rows this recipe ever wrote
   are the smoke test's, and it removes them itself.

6. **Record the outcome** — an owner action is recorded, not implied:

   * `DEVELOPMENT_NOTES.md`: a dated entry with the restore point, the git sha, the digest, the
     self-check result (20/20) and the smoke test's line. The apply's
     `record_for_development_notes` field is written to be pasted here.
   * `docs/API.md` § Production mode: the section is titled "designed 2026-10-07, not yet applied"
     — change that, state the apply date and the digest, and drop the claim that the
     `morocco_pc_api` role does not exist on the shared database.
   * `CONTEXT.md`, `docs/OPEN_GAPS.md` (OG-52's P3 clause), `PLAN_PLATFORM_P3.md` Step 5 and
     `PLAN_PLATFORM_STATUS.md` — the same commit as the evidence.
   * Grep the tree for the old claim in the same commit:
     `grep -rn "role does not exist on shared\|does not exist on the shared database" --include="*.md" .`

7. **Only then** is the API's production target a measured thing rather than a hope. Running it
   against the shared database still needs its own explicit opt-in — `API_ALLOW_SHARED=1` plus a
   `DATABASE_URL` that authenticates as the role:

   ```
   API_ALLOW_SHARED=1 DATABASE_URL="postgresql://morocco_pc_api:<password>@<direct host>/neondb?sslmode=require" node apps/api/src/server.js
   ```

   Put that URL in the deployment's secret store, not on a command line: a URL in `ps` or in shell
   history leaks the role's credential, and the API's own guard messages never print one. Use the
   **direct** host (the `-pooler` variant is transaction-mode PgBouncer, which will not carry a
   session-level `SET`), and let the deploy runbook (P3 Sprint 3) own the listener, the health
   check and the process supervision — this recipe's job ends at "the role exists, is exactly as
   privileged as documented, and the API runs on it".

## What green does NOT mean

* The self-check compares **privilege answers**, not behaviour beyond the smoke test's one pass.
  A correct role still cannot make a wrong build right.
* The smoke test is **one** POST of one input. A `--use-case`/`--budget` pair that commits 0 builds
  proves nothing, which is why it reports that as inconclusive instead of green.
* Nothing here proves the API is *deployed*: it proves the role is applied and the API runs on it.
* The role is cluster-scoped, not database-scoped. An apply on a branch creates it on THAT Neon
  instance's cluster; `pg_roles` is shared across the databases of one cluster, which is why the
  rehearsal's teardown also verifies the role is absent from the shared instance.
* A password rotation is a separate owner action: `ALTER ROLE morocco_pc_api PASSWORD '<new>'`,
  with the new value written to the secret store first, then the API restarted. There is no
  scripted rotation, and the role's grants are unaffected by it.
