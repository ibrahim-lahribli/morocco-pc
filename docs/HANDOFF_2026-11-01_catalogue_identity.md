# Handoff: catalogue identity and the served-model pin (2026-11-01)

**Type:** explanation (handoff), carrying how-to steps for the two applies that remain.
**Audience:** the next agent or operator on this repository.
**Goal:** know what changed on 2026-11-01, what is true right now, and exactly what is left.
**Scope:** PRs #11 and #12, the catalogue-identity repair (seeds 023-025 and seed 028), and the
residue those exposed. It does not re-explain the engine; `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md`
owns that.

Every number below is either measured in this pass (marked **[measured]**) or quoted from the
register/decision log with its source named. Nothing is inferred silently.

## 1. State at handoff

| Database | products **[measured]** | NULL `slug` | NULL `display_name` | seed 028 applied |
|---|---|---|---|---|
| TEST branch | 113 | **0** | **0** | yes, twice |
| shared (`DATABASE_URL`) | 113 | **13** | **13** | **no** |
| EU (`TARGET_DATABASE_URL`) | 100 | **100** | **100** | **no** |

Suites at HEAD **[measured]**: `test:unit` 1261 pass, `test:scripts` 437 pass, `test:api` 191 pass,
`test:api:db` **13 pass / 0 fail** (it was 12 passed / 1 failed before seed 028). `verify:docs --offline`
and `gen:decision-index --check` are green.

The shared database serves `launch-v2@2.4.0` -- that is OG-54's 2026-11-01 measurement, not re-derived
here. The migration ledger stood at 023 on TEST and shared as recorded 2026-10-29; EU was not
re-checked in this pass.

## 2. What was done

### 2.1 PR #12 -- the API serves the model its deployment names (Decision 62)

`SCORING_MODEL_PIN=name@version` is read once where the app is built and passed by every route to the
one selection point. A malformed value fails app construction (so a typo fails the deploy), a pin
selects among ACTIVE rows only, and an unmatched or ambiguous pin answers
`503 SCORING_MODEL_UNAVAILABLE` with no fallback. **Unset keeps the pre-existing newest-ACTIVE-row
rule**, so no deployment changes until it opts in.

Commits `fa7da0a` (implementation) and `9fc2935` (two register corrections the seed 027 replay
falsified), merged as `27b64ad`.

### 2.2 PR #11 -- Decision 57's amendment

Commit `a561112`, merged **first** as `c4d3863`. The order is load-bearing: PR #12's branch contained
that commit, so merging #12 first would have swept it into master through the back door and left #11
with nothing to merge.

### 2.3 The catalogue-identity defect (found by testing the merge's full surface)

`test:api:db` failed at `apps/api/test/db/recommendations.db.test.js:200` on
`assert.equal(typeof component.slug, 'string')` -- a **served component with `slug: null`**
(`typeof null` is `'object'`). The pin cannot touch product SQL, so the failure was attributed rather
than assumed: re-running the same suite at the pre-merge commit `e22fd6e` in a throwaway worktree
produced the identical failure on the identical line.

Cause: migration 020 introduced `display_name` and `slug` and backfilled the catalogue that existed
when it ran. Every catalogue seed written afterwards had to supply them itself, and **023, 024 and 025
did not** -- 13 products on shared and TEST, and on EU **the entire catalogue of 100**.

Why EU is worse, and why the fix is a seed rather than a targeted `UPDATE`: EU replayed its seeds
*after* 020 had backfilled an empty `product` table, so nothing ever assigned those columns. A repair
therefore has to be replay-shaped, not a one-off statement against 13 known rows.

### 2.4 Seeds 023/024/025 now derive identity at insert (`2e78ea3`)

Each product `INSERT` supplies `display_name` and `slug`, derived from the one source of truth (the
product name) with 020's own expressions via `CROSS JOIN LATERAL`, instead of a second hand-maintained
list. **[measured]** before writing: 13 projected rows, 0 `chk_product_slug_format` violations,
0 duplicates, 0 collisions against the 100 slugs already present, `NOT EXISTS` guard untouched.

### 2.5 Seed 028 backfills what already exists (`784196a`)

`database/seeds/028_backfill_product_identity.sql`: DML only, both statements guarded on `IS NULL` so
a curated slug is never overwritten and a second apply writes 0 rows. **[measured]** on TEST: 13 -> 0
for both columns, catalogue digest identical after a repeat apply, 0 format violations, 0 duplicates,
and `test:api:db` 13/13.

### 2.6 Two measurements that decide OG-54's remaining items

- `morocco_pc_api` authenticates against shared and answers the contract's own self-check **21/21**
  with no mismatches **[measured]** -- the credential is live, so a rotation needs no re-provisioning.
- `node scripts/check-deployed-role.js --target=env:DATABASE_URL` still returns **FAIL**: 2 of 2
  tagged sessions authenticated as `neondb_owner` (2026-11-01T23:12Z) **[measured]**. The deployed app
  has not been rotated; warm the origin with `GET /v1/health` first or the answer becomes
  INCONCLUSIVE, which is never a pass.

## 3. Not done, deliberately

- **Seed 028 is unapplied on shared and EU.** Both are real-database writes and this project's
  precedent (seed 027, 2026-11-01) is a recorded Neon restore point first. There is no Neon API
  credential in either env file, so the operator must supply the ids.
- **No environment sets `SCORING_MODEL_PIN`**, so the deployed origin still serves whichever row is
  newest and ACTIVE.
- **No invariant gate**, so a future catalogue seed can silently omit identity again.
- **No register row** for the identity defect, and three stale doc claims remain (4.5).
- **No real-database test for the pin**; its refusals are proven only against stubs.

## 4. Remaining work, in order

### 4.1 Apply seed 028 to shared (13 rows)

Needs a restore point id from the Neon console for the shared project. Then:

```bash
node scripts/run-seeds.js --dry-run     # 2 statements
node scripts/run-seeds.js               # shared: DATABASE_URL. Re-run to prove idempotency.
```

Expect `null_slug=0`, `null_display_name=0` afterwards, and an unchanged catalogue digest on the
second run. Do not split the file by `;`; send it whole (a semicolon inside a comment breaks a naive
split).

### 4.2 Apply seed 028 to EU (100 rows)

Its own restore point, on the EU Neon project, and its own target: `TARGET_DATABASE_URL` from
`.env.eu`. This one is not a formality -- it gives the release target its canonical product key
(Decision 47) for the first time.

### 4.3 Parity check

```bash
node scripts/check-target-parity.js --a=env:DATABASE_URL --b=env:TARGET_DATABASE_URL
```

Expect the catalogue *counts* to still differ (shared 113 vs EU 100 -- EU has not had seeds
023-025), so read this for shape and for the identity assertions, not for a MATCH verdict.

### 4.4 The invariant -- what actually stops this recurring

`verify:docs` checks structure (counts, ranges, register shape, schema digest); it cannot see prose
that contradicts the data, and it cannot see a NULL slug. The defect reached the deployed API because
`test:api:db` is **not** in the push/PR job -- it runs only in `recurring-gates`.

Proposal: a read-only `scripts/check-catalog-identity.js` asserting
`count(*) FROM product WHERE slug IS NULL OR display_name IS NULL` is 0 for ACTIVE products carrying
an eligible offer. It prints `PASS` / `FAIL` (exit 1, naming the offenders) / `INCONCLUSIVE` when the
catalogue is empty, with a pure half under `scripts/lib/` and a case in `test:scripts`, wired into
`recurring-gates`.

**Why not `ALTER COLUMN slug SET NOT NULL`:** migration 020 deliberately kept the column nullable so
fixtures and product writers that omit it stay legal, and it says so in its own header. A gate
respects that decision; a constraint would reverse it.

### 4.5 Register row and three doc corrections

- Open a register row for the identity gap (class IMPORTANT, owner engine/data), citing EU's 100/100
  as the systemic evidence, and close it when 4.1 and 4.2 land.
- `CONTEXT.md:67` still says "the shared dev database serves `seed-minimal-v1@1.0.0` alone" -- false
  since seed 027.
- `docs/TEST_MAP.md:93` describes "the full **100-row** page walk"; both databases hold 113.
- `AGENTS.md:371` says "ledger, **100 products**" for the TEST branch; it holds 113.

### 4.6 OG-54 items 1 and 2, in this exact order

1. **Deploy first.** Master now carries Decision 62 (`27b64ad`), but the running image predates it,
   so setting the pin today is inert.
2. **Then set both variables in ONE restart** on the origin: `SCORING_MODEL_PIN=launch-v2@2.4.0`, and
   `DATABASE_URL` = the role's URL, built locally without echoing it:

   ```bash
   node -e "require('dotenv').config();const fs=require('fs'),os=require('os');const {roleConnectionString}=require('./scripts/lib/api-role');const pw=fs.readFileSync(os.homedir()+'/.morocco-pc/api-role.password','utf8').trim();const u=new URL(roleConnectionString(process.env.DATABASE_URL,'morocco_pc_api',pw));process.stdout.write('user='+u.username+' host='+u.host+'\n');"
   ```

   Doing the credential without the deploy turns a working app into a 503; doing the pin without the
   deploy does nothing at all.
3. **Warm and prove:** `GET /v1/health?probe=preflight`, then
   `node scripts/check-deployed-role.js --target=env:DATABASE_URL`. PASS only when every tagged
   session is `morocco_pc_api`; INCONCLUSIVE is not a pass.

### 4.7 Two gaps the review found in PR #12

- **No real-database pin test.** Nothing sets `SCORING_MODEL_PIN` against a live `scoring_model`
  table, so "a pinned deployment serves THAT row" and "an INACTIVE pin 503s" are proven only with
  stubs. One case in `apps/api/test/db/` closes it.
- **The pin grammar exists twice** (`apps/api/src/scoring-model-pin.js` and
  `scripts/lib/model-pin.js`). Decision 62 rejects importing `scripts/` into the served process, which
  is defensible, but nothing asserts the two parsers agree -- a parity test over one shared table
  would remove the only silent drift risk in the design.

### 4.8 Next engine item: OG-58

Retention is score-driven and blind to platform cost, so high-scoring AM5/LGA1700 parts displace the
cheap AM4 CPUs that make a 12000 MAD 1440p build assemble. It is the last open engine row with a
*reproduced* failure mode, and OG-55 records that A1 has no margin -- every row sits at exactly 3
pairs. The code change is local; the evaluation is not (new Decision, full 20-scenario rebaseline,
`verify:pi1`, re-approval of pin-scoped A10 orders).

## 5. Traps the next person will hit

1. **`test:api:db` is not in the PR job.** It runs only in `recurring-gates` (nightly/dispatch), which
   is exactly why the NULL slug shipped looking green.
2. **Seeds have no branch awareness.** `run-seeds.js` writes to whatever `DATABASE_URL` names, and
   `--test-db` routes nothing. Target the TEST branch deliberately (guard + `SET search_path = public`).
3. **Seeds 024 and 025 embed `BEGIN;`/`COMMIT;`**, so they cannot be wrapped in an outer transaction
   for a rollback rehearsal -- the inner COMMIT ends the outer one.
4. **A malformed pin fails the deploy, not the request.** That is the design; do not "fix" a failed
   start by making the parse lenient.
5. **CRLF and the BOM.** `docs/RECOMMENDATION_ENGINE_DECISIONS.md` is CRLF with a UTF-8 BOM; seed 025
   is LF while 023/024 are CRLF. `str_replace` joins wrapped lines, so anchor inside one physical line
   or edit through an exact `split(...).join(...)` script.
6. **`/tmp` is not shared on this box.** Native `curl -o /tmp/x` and node's `require('/tmp/x')` land in
   different places; pipe or stay in node.
7. **The golden harness refuses to run while any unmarked `recommendation_query` row exists**, so any
   probe cleans up in FK order and asserts residue 0.

## 6. Where to look

| What | Where |
|---|---|
| The setting and its refusals | `apps/api/src/scoring-model-pin.js`, `apps/api/src/repository.js` (`selectActiveScoringModel`, `SELECT_PINNED_SCORING_MODEL_SQL`) |
| The one read point | `apps/api/src/app.js` (`app.decorate('scoringModelPin', ...)`) |
| Decision 62 | `docs/RECOMMENDATION_ENGINE_DECISIONS.md`, last entry |
| The identity derivation | `database/migrations/020_product_identity_and_media.sql` (the generator and why NULLABLE) |
| The seed fix | `database/seeds/023…`, `024…`, `025…` (product `INSERT`), `028_backfill_product_identity.sql` |
| The failing assertion | `apps/api/test/db/recommendations.db.test.js:200` |
| The role contract | `scripts/lib/api-role.js`, `docs/RECIPES/provision-the-api-role.md` |
| The rotation procedure | `docs/RECIPES/deploy-eu-colocation.md` section 8.5 |
| Seed conventions | `docs/RECIPES/add-a-seed.md` |
