# HTTP API — contract and operation

The HTTP surface over the recommendation engine. It lives in `apps/api/`, is
specified by **Decision 36**, and owns **no engine logic**: every route calls the
engine through its public barrels and reads or writes Layer 4 rows through one
repository module.

Status at 2026-10-23: **implemented and running against the TEST branch.** The
DB-free suite runs on every push/PR; the DB-backed suite is wired into the
recurring CI job and was **proven there on 2026-10-18** — `test:api:db` answered
9 passed / 0 failed on the runner (dispatch runs 39119596060 and 39120485573), so
the local-only caveat this line used to carry is gone. Both
databases now carry the schema it reads (019 + 020; shared applied 2026-10-15), while
the write-safety default still points the API at the isolated branch - see *Database
target*.

**Contract v1.9 (2026-10-25):** v1.1 (2026-10-14) surfaced the persisted pass
facts - `budget_floor`, `engine_version` and each build's `strategy_key` became
columns in migration `019_recommendation_pass_facts.sql` (Decision 46), so POST
and GET no longer differ on any persisted field. v1.2 adds product identity:
each component carries its persisted `slug`, and its `name` is
`COALESCE(product.display_name, product.name)` as of migration
`020_product_identity_and_media.sql`, so the ingestion-only `Seed ` prefix no
longer reaches a client. **v1.3 adds request dedupe** (Platform P1 Sprint 5): an
identical POST against an equivalent committed pass answers `200` with
`reused: true` and the ORIGINAL id instead of running a second engine pass, and
every reply now carries `catalog_version` - the catalog state the pass ran
against, from migration `021_recommendation_query_catalog_version.sql`
(Decision 47). See *Request dedupe* and *Response shape*. **v1.4 adds the
presets ribbon** (Platform P1 Sprint 6): `GET /v1/presets` serves the generated
landing-page presets of the CURRENT catalog version for one use case and
currency, from migration `022_recommendation_preset.sql` (Decision 48). See
*GET /v1/presets*. **v1.5 adds the read-only catalog** (Platform P2 Sprint 3, Decision 50):
`GET /v1/catalog/products` and `GET /v1/catalog/products/:slug` serve the
addressable catalogue migration 020 made possible - keyset pagination on the
unique `slug`, every price beside its Decision 35 provenance class, and a
product page carrying its spec row, its eligible offers and the French
disclaimer. See *GET /v1/catalog/products*. **v1.6 adds the price history** (S25's unblock,
Decision 51): `GET /v1/catalog/products/:slug/price-history` serves the observations behind
one product's price, oldest first, one point per observation MOMENT at that moment's
cheapest price, and a summary whose change fields stay `null` until there are two moments.
See *GET /v1/catalog/products/:slug/price-history*. **v1.7 adds input effects** (Decision 52):
`GET /v1/meta/options` names which inputs the active model READS (`inputs_applied`), and every
recommendation reply states what each input changed in THAT pass (`input_effects`). Additive only:
no path and no existing field changed. See *What each input changes*. **v1.8 adds the swap
preview** (Decision 55): `GET /v1/recommendations/:id/builds/:rank/swap-preview` is ONE new path
and changes no existing field; a FAIL verdict is a 200 result. **v1.9 adds product identity to
the catalogue list** (S24): each `GET /v1/catalog/products` row now carries `id` (the
`product.id`) and `variants` (`[{ id, sku }]`, in the engine variant order, `[]` when the
product has none), because a GPU candidate is variant-keyed and the swap preview requires
`product_variant_id` for role `GPU` - the catalogue could otherwise name a product only by
slug. Additive only: no path and no existing field changed. **v1.10 adds the committed
swap** (Decision 56): `POST /v1/recommendations/:id/builds/:rank/swap` APPENDS one derived
build (its own `build_candidate` and `build_component` rows plus one `recommendation_swap`
link) and returns the preview's three facts plus `swapped`; the pass itself is never edited.
The read path then serves the derived build at that rank, with `swapped` naming the replaced
role and `explanation: null`. `explanation` also became nullable on every build, which is
what its column always was.

**`catalog_version` and the preset ribbon are served on BOTH databases since 2026-10-19.**
Migrations 021 and 022 were applied to the shared database that day from restore point
`br-ancient-cake-axh57vpj` (shared ledger 20 -> 22), so the two degradation modes this section
used to document are gone: `catalog_version` is recorded and reuse hits, and `GET /v1/presets`
reads a real table.

**Migration 023 is applied on ALL THREE databases since 2026-10-29** (the TEST branch on 2026-10-26,
then shared from restore point `br-royal-block-axu8i4a9` and EU from `br-cool-star-b9whdnt1`), so every
ledger reads 23 and `recommendation_swap` exists everywhere. Against a database still below 023 the
swap COMMIT answers the generic `500 INTERNAL_ERROR` (`42P01`), exactly as the preset read does below
022, and the read path fails the same way: measured on the Render origin 2026-10-28, while the service
sat on a ledger-022 database, `POST /v1/recommendations` and the read back both answered `500` and the
pass still COMMITTED (a failed POST is not free: it leaves an unmarked `recommendation_query` row
behind). The PREVIEW was unaffected throughout because it writes nothing.
**The GRANT residue is CLOSED (2026-10-29), and the 21-answer self-check describes all three
databases again.** `morocco_pc_api` answers every one of the 21 expectations on shared
(`db:54ff6ea3f6e6`) and EU (`db:2d66f26d7ddc`): `GRANT INSERT ON recommendation_swap` was applied
from restore points `br-silent-cake-ax5q21at` and `br-bitter-sky-b96jh91p`, and
`scripts/smoke-api-role.js --confirm-shared` then ran the API itself as the role on both — health
`db:"ok"`, POST 201 with 1 build, 52 statements, no `42501`, and the Layer 4 counts back to their
pre-run values. Note for the next one: `scripts/apply-api-role.js` REFUSES an existing role, so a
privilege for a NEW table is an additive `GRANT`, never a re-apply — the procedure is
`docs/RECIPES/provision-the-api-role.md` "Re-granting after a new Layer 4 table".
The deployed origin still works only because it runs on WIDER credentials:
`scripts/check-deployed-role.js --target=env:DATABASE_URL` answers **FAIL** against it (1 of 1
`morocco-pc-api` session authenticated as `neondb_owner`, measured 2026-10-29) — OG-54 item 1, open
only until the service's secret is repointed.
The fallbacks still describe an OLDER database: against one below 021 every
reply serves `catalog_version: null` (not recorded - NULL means UNKNOWN here) and reuse is
always a miss, which is a correct answer; against one below 022 the preset read fails `42P01`
and answers the generic `500 INTERNAL_ERROR`, with no graceful miss.

**Schema prerequisite - SATISFIED on BOTH databases (2026-10-15).** Migrations 019
and 020 are applied on the TEST branch AND on the shared database: both ledgers read
20, shared was applied 2026-10-15 from restore point `br-damp-grass-axyri6yl`, and
`verify:replay` replays 20 files into an empty database at 0 drift (columns 370/370,
checks 79/79, fks 60/60, indexes 100/100). The read path needs both: below 019 the
component read fails `42703` on `recommendation_query.budget_floor`, and below 020 on
`product.slug` / `product.display_name`. Either way the whole response fails, and what
a client sees is the generic `500 INTERNAL_ERROR` with a request id - an undefined
column is an UNEXPECTED error, so `503` is NOT the answer (`503` on this API means only
"no active scoring model"). That is why the shared apply was the prerequisite for
`API_ALLOW_SHARED=1`; it is now met. Two things to know: a failed POST is not
free, because `createRecommendationQuery` commits the profile and query rows BEFORE the
engine runs, so it leaves an unmarked `recommendation_query` row behind and the golden
harness refuses to run while ANY unmarked row exists (delete them in FK order); and the
`morocco_pc_api` role now EXISTS on the shared database (applied 2026-10-19) AND on the EU
production database (applied 2026-10-23, audit target `db:2d66f26d7ddc`), each from its own
restore point with a 20/20 self-check, so the column-scoped GRANTs in *Production mode* are live on both. Step 5 is no longer improvised: `node
scripts/apply-api-role.js` applies the block under a restore-point guard that refuses without
one, and `node scripts/smoke-api-role.js --confirm-shared` proves the API itself runs as the
role; the owner procedure is `docs/RECIPES/provision-the-api-role.md`.

## What it is not

- **No authentication or accounts.** There is no signup, no session, no API key.
- **No frontend.** `apps/api/` serves JSON only.
- **No caching, queues, or background jobs.** A POST runs one synchronous pass.
- **No write access to the shared database by default.** See *Database target*.
- **No engine changes.** Nothing under `src/recommendation/` was modified to add
  this API (Decision 36 records that explicitly).

## Running it

```
npm run start:api        # node apps/api/src/server.js
npm run test:api         # DB-free (fastify.inject + stubs)
npm run test:api:db      # end-to-end against TEST_DATABASE_URL
```

Environment variables (see `apps/api/.env.example` for the full list):

| Variable | Purpose |
|---|---|
| `PORT`, `HOST` | Listener. Defaults `3000` / `0.0.0.0`. |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list. **Empty means CORS is disabled entirely** — no `Access-Control-Allow-Origin` header is sent. |
| `TRUST_PROXY` | Trusted proxy address/CIDR list that makes `request.ip` the client instead of the proxy, comma-separated. **Empty (the default) ignores `X-Forwarded-For` entirely**; a hop count or `true` is REFUSED at startup — see *Per-IP limits behind a proxy*. |
| `LOG_LEVEL`, `LOG_PRETTY` | pino level; `LOG_PRETTY=1` uses `pino-pretty` (a devDependency, feature-detected — production installs log JSON). |
| `ENGINE_VERSION` | The value reported as `served_by.engine_version` and, since Decision 46, PERSISTED per result row as the pass's `engine_version` — the API hands it to the engine, so a stored build names the deploy that produced it. Intended to be the git short SHA; defaults to `dev`. |
| `DATABASE_URL` | The pool target when `API_ALLOW_SHARED=1` — the deployed shape, and the only variable the pool reads in it. |
| `TEST_DATABASE_URL` | The pool target when `API_ALLOW_SHARED` is not `1` — the local/TEST shape. The guard then compares its hostname with `DATABASE_URL`'s and refuses equal hosts. UNUSED in the deployed shape, where it must be unset. |
| `API_ALLOW_SHARED` | Must be exactly `1` to target `DATABASE_URL`. |

### Database target (write safety)

Every POST writes Layer 4 rows, so the API is write-capable by construction.
It therefore:

1. starts against the **isolated TEST branch** (`TEST_DATABASE_URL`), and
2. **refuses to start at all** otherwise — `resolveTestDbUrl` in
   `scripts/lib/db-url.js` is reused, not re-implemented, so
   "`TEST_DATABASE_URL` must not target the shared database" has one owner.

Reaching the shared dev database requires an explicit `API_ALLOW_SHARED=1`.
Nothing in CI sets it. The guard's error messages never contain a URL, a host,
or a credential.

**Both deployed environments use the `API_ALLOW_SHARED=1` shape** (Platform P3 Sprint 3): production
points `DATABASE_URL` at the EU project, staging points it at the TEST branch, `TEST_DATABASE_URL` is
unset on both, and the two never share a database. Staging is deliberately NOT run with
`API_ALLOW_SHARED=0` — that value routes the pool through `TEST_DATABASE_URL` and demotes
`DATABASE_URL` to a baseline, the inversion `docs/RECIPES/deploy-eu-colocation.md` §1 warns about.

**A frontend-development target is a separate branch, not the TEST branch (decided 2026-10-18).**
Every distinct POST writes rows, and `npm run eval:scenarios` refuses to run while any unmarked
`recommendation_query` row exists - so frontend traffic on the TEST branch takes the golden harness
down. The decision is a dedicated Neon branch (`frontend-dev`, branched from `test` at ledger 22)
plus a gitignored `.env.frontend-dev` whose `TEST_DATABASE_URL` names it while `DATABASE_URL` stays
the main branch; the guard passes because the hosts differ, and a reset of that branch is the whole
cleanup. Start it with `set -a; . ./.env.frontend-dev; set +a; node apps/api/src/server.js`.
**Values in that file MUST be single-quoted**: the connection strings carry `&`, and an unquoted
`&` in a sourced file backgrounds the assignment and leaves the variable UNSET, which silently
points the API at the main branch instead (measured 2026-10-18).

### Docker

The build context is the **repository root**, because the API imports the engine
from `src/recommendation/` and the guard from `scripts/lib/`:

```
docker build -f apps/api/Dockerfile -t morocco-pc-api .
```

The image runs `node:22-alpine`, installs with `npm ci --omit=dev`, and runs as
the unprivileged `node` user. There is deliberately **no `apps/api/package.json`**:
the engine's own `require('pg')` / `require('dotenv')` resolve upward, so a
single root `node_modules` is what makes both the engine and the API work.

## Production mode (designed 2026-10-07; role applied to shared 2026-10-19, to EU 2026-10-23)

The beta runs against the TEST branch. The EU project (`morocco-pc-eu`) is the production
DATABASE as of 2026-10-23; the shared Neon project is the dev database. Pointing the API at
either is a production decision (`API_ALLOW_SHARED=1` + `DATABASE_URL`), and the facts below
govern it.

**APPLIED 2026-10-19.** The role, its 20-grant block and its self-check ran on the shared
database from restore point `br-ancient-cake-axh57vpj` (HEAD `3f0c166`, audit target
`db:54ff6ea3f6e6`): 8 statements, self-check 20/20. **UPDATED 2026-10-31:** the block below now carries 21 grants, not 20 - migration 023 added `recommendation_swap`, and `GRANT INSERT ON recommendation_swap` was applied from restore points `br-silent-cake-ax5q21at` (shared) and `br-bitter-sky-b96jh91p` (EU) on 2026-10-29, self-check 21/21 on each. A re-provisioned role that answers 20 is one grant short. `node scripts/smoke-api-role.js
--confirm-shared` then ran the API itself as `morocco_pc_api` - health `db:"ok"`, POST
`201` with 1 build in 52 statements, no `42501`, and all six Layer 4 tables back at 0.
The EU production database got the same treatment on 2026-10-23 (restore point
`br-late-rice-b906upai`, audit target `db:2d66f26d7ddc`, 20/20 self-check, then the same smoke
test green as the role), and a CORRECTION (2026-10-31): a deploy HAS happened since - on Render, against the SHARED database, not EU. `https://morocco-pc.onrender.com` is a Free demo origin (`deploy-free-host.md` 5.1) that spins down after 15 idle minutes and must never be read as the launch path; it runs on the owner's credentials today, because `check-deployed-role.js --target=env:DATABASE_URL` measured **FAIL** against it on 2026-10-29 (1 of 1 session as `neondb_owner`), which is OG-54 item 1. The EU project remains undeployed.
The EU app's `DATABASE_URL` secret, when it is created, must carry the ROLE's connection string
rather than the owner's - that rotation is an owner step (OG-54), not something the apply did.

### The database role

The API must not connect as the project owner. The engine's commit path issues
INSERTs into the seven Layer 4 tables and exactly ONE DELETE — verified from
`src/recommendation/orchestrator/commit.js` and
`src/recommendation/persistence/persist-rejections.js`: Decision 31's
replace-idempotence clears this query's `build_rejection` rows before
re-inserting. The production role is therefore:

```sql
CREATE ROLE morocco_pc_api LOGIN PASSWORD '<from the secret store>';
GRANT USAGE ON SCHEMA public TO morocco_pc_api;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO morocco_pc_api;
GRANT INSERT ON recommendation_profile, recommendation_query, build_candidate,
  build_component, recommendation_result, build_rejection, recommendation_swap
  TO morocco_pc_api;
GRANT DELETE ON build_rejection TO morocco_pc_api;
-- Decision 46: the pass-facts writer UPDATEs exactly three columns. Granted PER
-- COLUMN, never per table, so the table-level UPDATE answers stay 'f' (see the
-- self-check below) and the role cannot rewrite a row it merely inserted.
GRANT UPDATE (budget_floor) ON recommendation_query TO morocco_pc_api;
GRANT UPDATE (engine_version, strategy_key) ON recommendation_result TO morocco_pc_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO morocco_pc_api;
```

Catalog tables (Layers 1–3, `store_offer` included) and `scoring_model` are
read-only for this role, and there is no sequence to grant (every id is an
app-generated UUID). The write path contains exactly THREE UPDATEs — the
pass-facts writer (Decision 46, `persistence/persist-pass-facts.js`) — and they
are granted per column so the "no row-wide UPDATE" invariant stays provable
rather than merely intended. A `check_function_bodies` lock-down was considered
and dropped: the API issues no functions, so the setting guards nothing here.

Self-check (run after applying; every expected value is in the comment):

```sql
SELECT current_database();
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles
  WHERE rolname = 'morocco_pc_api';                        -- rolsuper = f
SELECT tableowner FROM pg_tables
  WHERE tablename IN ('product','store_offer','build_candidate'); -- not morocco_pc_api
SELECT has_schema_privilege('morocco_pc_api','public','CREATE');            -- f
SELECT has_table_privilege('morocco_pc_api','product','INSERT'),            -- f
       has_table_privilege('morocco_pc_api','product','UPDATE'),            -- f
       has_table_privilege('morocco_pc_api','product','DELETE'),            -- f
       has_table_privilege('morocco_pc_api','store_offer','INSERT'),        -- f
       has_table_privilege('morocco_pc_api','store_offer','DELETE'),        -- f
       has_table_privilege('morocco_pc_api','product','SELECT');            -- t
SELECT has_table_privilege('morocco_pc_api','build_candidate','INSERT'),    -- t
       has_table_privilege('morocco_pc_api','recommendation_query','INSERT'),  -- t
       has_table_privilege('morocco_pc_api','recommendation_swap','INSERT'),   -- t
       has_table_privilege('morocco_pc_api','build_component','DELETE'),    -- f
       has_table_privilege('morocco_pc_api','build_rejection','DELETE');    -- t
-- Decision 46: no ROW-WIDE update, but exactly three COLUMN-scoped ones.
SELECT has_table_privilege('morocco_pc_api','recommendation_query','UPDATE'),   -- f
       has_table_privilege('morocco_pc_api','recommendation_result','UPDATE');  -- f
SELECT has_column_privilege('morocco_pc_api','recommendation_query','budget_floor','UPDATE'),     -- t
       has_column_privilege('morocco_pc_api','recommendation_result','engine_version','UPDATE'),  -- t
       has_column_privilege('morocco_pc_api','recommendation_result','strategy_key','UPDATE');    -- t
```

**The apply and the smoke test are scripts, and the procedure is a recipe (2026-10-17).** The
rehearsal proved the block; applying it is now scripted rather than transcribed.
`node scripts/apply-api-role.js` REFUSES (exit 1, nothing written) without
`--restore-point=<id>` matching `^[A-Za-z0-9_-]{8,}$` — the predicate `run-migrations.js`
enforces — refuses an existing role instead of recreating it, takes the password from
`API_ROLE_PASSWORD` or `--password-file` and never from argv, prints the `db:<12 hex>` audit
digest beside the plan with the password redacted, and after the grants runs the self-check
above and compares all 21 answers to a fixture: a missing, unexpected or NULL answer is a
FAILURE and a red self-check ROLLS THE ROLE BACK. `node scripts/smoke-api-role.js
--confirm-shared` then runs the API itself as the role — its own shared-pool path, health on
the BODY, one real POST asserting `reused === false` and at least one committed build (zero
builds is reported INCONCLUSIVE, because the build-table INSERT grants would then never be
exercised), no `42501` on the pool, and the six Layer 4 counts asserted back to their pre-run
values with a failed cleanup failing the run. Both scripts are pinned DB-free by
`npm run test:scripts`.

**TEST-branch rehearsal plan** (proves the commit path runs under the role
before any shared apply):

1. Apply the same `CREATE ROLE` / `GRANT` script on the TEST branch
   (branch-first; the branch is disposable).
2. Connect a rehearsal run as `morocco_pc_api` and drive the full POST path
   (`selectActiveScoringModel` → `createRecommendationQuery` →
   `engine.runFullRun` → `readRecommendationResult`) — a role-parameterized run
   of `scripts/measure-api-pass-phases.js`. Success = the whole flow completes
   with no `42501` (insufficient privilege) and residue 0.
3. Run the self-check on the branch and assert every expected value.

**REHEARSAL RAN 2026-10-17 — Steps 1–4 of P3 Sprint 2, GREEN on the TEST branch.**
`node scripts/rehearse-api-role.js` performs the three steps above in one run: it refuses to
start if the role exists, applies the `CREATE ROLE` / `GRANT` block verbatim as the database
owner, opens a SECOND connection authenticated as `morocco_pc_api`, drives the API's POST write
path on it, asserts the self-check against a hard-coded fixture, proves the negative, then
removes both the role and the rows the pass wrote. Its pure half — the 21-answer table, the
grant script and the self-check SQL — is unit-tested by
`scripts/lib/api-role.test.js` (11 DB-free tests) and its own CLI and cleanup policy by
`scripts/lib/rehearse-api-role-cli.test.js` (9), all in `npm run test:scripts`. It calls
the four POST steps on the API's own modules (`repository` + `engine`) rather than
parameterizing `measure-api-pass-phases.js`, because that harness pins a scoring model and
writes timing rows and neither is something a privilege rehearsal should vary.

Target: endpoint `ep-dry-mountain-ax6b5wu6` (DIRECT host), database `neondb`. Recorded from two
consecutive runs whose hard assertions were **identical** (25 builds, 61 statements as the role,
21/21 answers, same residue, same negative proof).

| # | Privilege answer | Expected | Actual |
|---|---|---|---|
| 1 | `has_schema_privilege('morocco_pc_api','public','CREATE')` | `f` | `f` |
| 2 | `has_table_privilege('morocco_pc_api','product','INSERT')` | `f` | `f` |
| 3 | `has_table_privilege('morocco_pc_api','product','UPDATE')` | `f` | `f` |
| 4 | `has_table_privilege('morocco_pc_api','product','DELETE')` | `f` | `f` |
| 5 | `has_table_privilege('morocco_pc_api','product','SELECT')` | `t` | `t` |
| 6 | `has_table_privilege('morocco_pc_api','store_offer','INSERT')` | `f` | `f` |
| 7 | `has_table_privilege('morocco_pc_api','store_offer','DELETE')` | `f` | `f` |
| 8 | `has_table_privilege('morocco_pc_api','recommendation_profile','INSERT')` | `t` | `t` |
| 9 | `has_table_privilege('morocco_pc_api','recommendation_query','INSERT')` | `t` | `t` |
| 10 | `has_table_privilege('morocco_pc_api','build_candidate','INSERT')` | `t` | `t` |
| 11 | `has_table_privilege('morocco_pc_api','build_component','INSERT')` | `t` | `t` |
| 12 | `has_table_privilege('morocco_pc_api','recommendation_result','INSERT')` | `t` | `t` |
| 13 | `has_table_privilege('morocco_pc_api','build_rejection','INSERT')` | `t` | `t` |
| 14 | `has_table_privilege('morocco_pc_api','build_component','DELETE')` | `f` | `f` |
| 15 | `has_table_privilege('morocco_pc_api','build_rejection','DELETE')` | `t` | `t` |
| 16 | `has_table_privilege('morocco_pc_api','recommendation_query','UPDATE')` | `f` | `f` |
| 17 | `has_table_privilege('morocco_pc_api','recommendation_result','UPDATE')` | `f` | `f` |
| 18 | `has_column_privilege('morocco_pc_api','recommendation_query','budget_floor','UPDATE')` | `t` | `t` |
| 19 | `has_column_privilege('morocco_pc_api','recommendation_result','engine_version','UPDATE')` | `t` | `t` |
| 20 | `has_column_privilege('morocco_pc_api','recommendation_result','strategy_key','UPDATE')` | `t` | `t` |

20 answered / 20 matched, none missing, none mismatched, none unexpected — the four INSERT
probes beyond the two the self-check above already carried (rows 8, 11, 12, 13) are included
because the grant script lists all six targets in one statement and only asserting two of them
would leave four unmeasured.

- **Grants applied:** 8 statements, as the owner (`rolcreatedb` `t`, `rolcreaterole` `t`). The
  role itself: `rolsuper` `f`, `rolcreatedb` `f`, `rolcreaterole` `f`, `rolcanlogin` `t`,
  `rolbypassrls` `f`; `product`, `store_offer` and `build_candidate` all remain owned by
  `neondb_owner`. The rehearsal also refuses to start if the role exists, so it can never
  mutate a role someone else created.
- **The whole POST path ran AS `morocco_pc_api`** — the second connection reports
  `current_user = session_user = morocco_pc_api`. Model select → catalog version → the
  profile+query insert → the engine's full run → read-back: 58 statements, 61 in the whole
  session, and **zero of them failed `42501`**. The pass produced **25 builds**, recorded the
  budget floor and the catalog version, and read back 8 rows. The model is the API's own
  selection (the active row): **`launch-v2@1.0.0`**.
- **The negative proof (Step 4).** `UPDATE recommendation_result SET rank = rank WHERE
  recommendation_query_id = $1::uuid` → **`42501 permission denied for table
  recommendation_result`**, while `UPDATE recommendation_query SET budget_floor = budget_floor
  WHERE id = $1::uuid` and `UPDATE recommendation_result SET engine_version = engine_version,
  strategy_key = strategy_key WHERE recommendation_query_id = $1::uuid` **both succeeded**
  (row_count 1 each). A privilege test that only walks the allowed paths cannot tell a
  correctly-scoped role from an over-granted one; this one can, in both directions.
- **Cleanup.** The pass's own rows were deleted in FK order (2 `build_rejection`, 1
  `recommendation_result`, 8 `build_component`, 1 `build_candidate`, 1 `recommendation_query`,
  1 `recommendation_profile`), and all six Layer 4 tables read back their pre-run counts
  (0/0/0/0/0/0). The role is **gone**: verified from separate connections after the run —
  `pg_roles` lists neither `morocco_pc_api` on the branch nor on the shared instance, and the
  shared database's Layer 4 tables are still 0 queries / 0 profiles, so the rehearsal wrote
  nothing anywhere but the branch.

**Removing the role later needs a REVOKE sweep, not a bare `DROP ROLE`** (measured 2026-10-17;
the full lesson is in `DEVELOPMENT_NOTES.md`). While the role holds the grants, `DROP ROLE
morocco_pc_api` fails **`2BP01`** — "cannot be dropped because some objects depend on it", one
`pg_shdepend` row per granted object, 44 of them on this catalog — and `DROP OWNED BY
morocco_pc_api` is refused **`42501`** `permission denied to drop objects`, because `DROP OWNED`
requires MEMBERSHIP in the named role and the owner is not a member of a role it just created.
The order that works: `REVOKE ALL ON ALL TABLES IN SCHEMA public` → `REVOKE ALL ON ALL
SEQUENCES IN SCHEMA public` → `REVOKE ALL ON SCHEMA public` → `ALTER DEFAULT PRIVILEGES IN
SCHEMA public REVOKE ALL ON TABLES` → `DROP ROLE` (dependency rows 44 → 0, drop OK). Note also
that a Neon role is project-wide, not branch-scoped: the branch guard protects the CONNECTION,
so "TEST branch only" is a claim about where the script connects and where the rows land, not
about the role's visibility.

### Region (facts only)

- The Neon project hosting the shared `DATABASE_URL` is in **us-east-2**
  (verified from the endpoint hostname, 2026-10-07).
- A Neon project's region **cannot be changed in place**.
- Moving regions means **creating a new project in the target region and
  loading the data into it** — never a restore over the shared dev database.

### Latency (measured 2026-10-07)

`scripts/measure-api-pass-phases.js` wraps `client.query` and the engine's
namespace seams (no engine edit) and measures ONE API-shaped pass on the TEST
branch (GAMING / 20000 MAD): **75 statements, 10 670 ms of statement time in a
12 114 ms wall, ≈142 ms per round trip**. By phase (statements / statement ms):

| Phase | stmts | ms | Phase | stmts | ms |
|---|---|---|---|---|---|
| `engine.commit` | 37 | 4 906 | `engine.select_offer_prices` | 1 | 278 |
| `engine.load_filtering_context` | 14 | 1 886 | `engine.load_assessments` | 1 | 274 |
| `engine.load_candidates` | 9 | 1 235 | `api.read_back` | 2 | 282 |
| `api.profile_query_insert` | 4 | 697 | `engine.snapshot` (tx open/close) | 2 | 278 |
| `api.model_select` | 1 | 205 | pure stages (filter, retention, assembly, rank, explain…) | 0 | ~19 |
| `engine.pass` (timestamp) | 1 | 143 | `engine.load_query` + `load_scoring_model` | 2 | 281 |

The cost is per-statement latency to the remote Neon instance multiplied by a
sequential pipeline — consistent with Decision 36's load verdict. The overlaps
in the report are only parent→child nesting (`engine.snapshot` → `engine.pass`
→ loaders); no sibling phases overlap. Any batching or parallelising of the
engine's reads is ENGINE work (Decision 17's stage order is pinned by tests)
and must not be smuggled into the API.

The harness PINS the model it measures (`--model=<name@version>`, else
`SCORING_MODEL_PIN`, else `seed-minimal-v1@1.0.0`) and fails closed on an
inactive pin, because the engine loads its model from
`recommendation_query.scoring_model_id`: without a pin, a number is not
attributable to a model at all. Two consequences to keep straight. The table
above was measured 2026-10-07, when `seed-minimal-v1` was the only model in
existence (`launch-v2` was created 2026-10-15), so those are v1 figures. And a
run pinned to `launch-v2@1.0.0` on 2026-10-15 measured 57 statements in a
9 588 ms wall, with `engine.commit` at 19 statements / 2 607 ms — against the
v1-era 75 / 12 114 / 37 / 4 906. That gap is the MODEL and the code both having
changed; it is not a speed-up, and two runs pinned differently are not
comparable. On today's TEST branch only `launch-v2@1.0.0` can be measured:
`seed-minimal-v1` is inactive there, and a pin selects among active models
instead of activating one.

## Endpoints

All routes are under `/v1` and speak JSON.

| Method | Path | Limit | Purpose |
|---|---|---|---|
| GET | `/v1/health` | 120/min | Liveness + database reachability |
| GET | `/v1/meta/options` | 120/min | Accepted use cases, currencies, resolutions, priorities |
| POST | `/v1/recommendations` | 30/min | Run one full engine pass and persist it — or reuse an equivalent stored pass |
| GET | `/v1/recommendations/:id` | 120/min | Read a persisted recommendation |
| GET | `/v1/recommendations/:id/builds/:rank/swap-preview` | 30/min | Preview ONE component swap against a persisted build, read-only (contract v1.8, Decision 55) |
| POST | `/v1/recommendations/:id/builds/:rank/swap` | 30/min | Commit ONE swap: appends a derived build, never edits the pass (contract v1.10, Decision 56) |
| GET | `/v1/presets` | 120/min | Generated landing-page presets for one use case and currency (current catalog version) |
| GET | `/v1/catalog/products` | 120/min | Paginated ACTIVE catalogue, keyset-ordered by `slug` (contract v1.5; rows carry `id` + `variants` since v1.9) |
| GET | `/v1/catalog/products/:slug` | 120/min | One product: spec row, eligible offers, provenance, disclaimer |
| GET | `/v1/catalog/products/:slug/price-history` | 120/min | The recorded observations behind one product's price, oldest first (contract v1.6) |
| GET | `/v1/docs/json` | 120/min | OpenAPI 3.0 document |

Rate limits are per client IP and per route — a GET is cheap, a POST runs an
entire engine pass, so they must not share a budget. "Per client IP" is only
true when the proxy is named in `TRUST_PROXY` (see *Per-IP limits behind a
proxy* below). The request body limit is **10 KB**.

**The 429 contract (measured 2026-10-17, P2 Sprint 4).** A limit that fires
answers the normal error envelope — `{ "error": "RATE_LIMITED", "message":
"Too many requests", "request_id": "<id>" }` — and carries `Retry-After: 60`,
in seconds, the one-minute window. `x-ratelimit-limit`,
`x-ratelimit-remaining` and `x-ratelimit-reset` describe the same bucket.
`Retry-After` is the header that tells a client to wait rather than treat the
limit as a permanent failure, and `apps/api/test/unit/rate-limit.test.js`
asserts both it and the body, so neither can disappear silently.

**CORS (measured 2026-10-17, P2 Sprint 4).** `ALLOWED_ORIGINS` is a
comma-separated allow-list (whitespace trimmed). An allowed origin is echoed
EXACTLY in `Access-Control-Allow-Origin` — never `*` — and its preflight
succeeds with the requested method and headers. A disallowed origin gets no
`Access-Control-Allow-Origin` header, but the request itself is still served:
CORS is a browser policy, not authentication. An EMPTY allow-list disables CORS
entirely rather than reflecting any origin. All four behaviours are pinned by
`apps/api/test/unit/cors.test.js`.

**Exposure and price display (decided 2026-10-18).** The catalogue is **public but unlisted** for the beta: a frontend may use both catalog endpoints, but it is not linked from navigation and is `noindex` until prices are `VERIFIED`. This is a product/SEO posture, not an access control - the API has no authentication and CORS is not a gate, so anyone with the URL can read it. Indicative prices MAY be displayed, but only with the `disclaimer` the API returns and a visible beta label, and without store names or a purchase CTA while every offer is a seed fixture. One client-side detail: the **list** response carries `offer_class` per product but **no `disclaimer` field** (only the detail and recommendation responses do), so a price grid built from the list must render the disclaimer itself.

**Per-IP limits behind a proxy (measured 2026-10-17, P2 Sprint 2).** The limiter
keys on `request.ip`, and with `TRUST_PROXY` unset (the default) that is the
socket address — so every caller behind the platform proxy shares one bucket and
the 30/min POST budget is 30/min for the entire internet. `TRUST_PROXY` names
the proxy whose `X-Forwarded-For` is trusted: an address, a CIDR or a
`proxy-addr` named range (`loopback`, `linklocal`, `uniquelocal`),
comma-separated. `request.ip` then becomes the address that proxy appended, so a
prefix the client wrote itself is ignored.

**It is NOT a hop count, and `true` is refused.** `fastify@5.12` disables
numeric `trustProxy` outright — its trust function returns false for every
address — because a bare hop count cannot validate the immediate peer, so a
directly reachable process could be spoofed (`trustProxy: 1` measured:
`request.ip` stays `127.0.0.1`). `true` is worse: it trusts the whole chain, so
`X-Forwarded-For: 192.0.2.55, 203.0.113.9` resolves to the client-written
`192.0.2.55` and any caller can mint its own bucket. Both are therefore STARTUP
ERRORS, not silent no-ops - and so is a `/0` prefix, which trusts every peer
exactly as `true` does. For a same-host reverse proxy the value is
`TRUST_PROXY=127.0.0.1` (the shape the tests pin); a proxy on a private network
is its CIDR. The concrete value is a per-host fact, pinned on the deployed origin
(P2 Sprint 2 Step 4) and not yet recorded because no host is chosen. The evidence channel is the
request log rather than a new route: Fastify's pino serializer sets `remoteAddress: request.ip`,
so `fly logs` reports the proxy's address while `TRUST_PROXY` is empty and the caller's address
once the proxy is named - the step-by-step procedure is `docs/RECIPES/deploy-eu-colocation.md`
§8.4.

**The counters live in process memory**, so they do not survive a multi-instance
deploy: N instances allow N × the stated limit, and a restart resets every
bucket. A shared store is future work, not a claim this document makes. The
default-off, separate-bucket and spoofed-prefix behaviours are pinned by
`apps/api/test/unit/trust-proxy.test.js` and
`apps/api/test/unit/rate-limit.test.js`. The contract is **Decision 49**
(2026-10-17).

### POST /v1/recommendations

```json
{
  "budget_amount": 20000,
  "currency": "MAD",
  "use_case": "GAMING",
  "resolution": "1440p",
  "priority": 3
}
```

| Field | Required | Notes |
|---|---|---|
| `budget_amount` | yes | A JSON **number** > 0 (max 1,000,000). A numeric *string* is rejected — the engine's loader is strict, so the API says so at the edge. |
| `currency` | yes | Exactly 3 characters, and one of the advertised values. |
| `use_case` | yes | One of the advertised values (see *Option vocabulary*). |
| `resolution` | no | Advertised value. Recorded on the query; multiplies the **GPU** retention target only (1080p ×1.0, 1440p ×1.25, 2160p ×1.5) and gates the optional per-resolution VRAM floor. Never changes a score; `input_effects` reports what it did in this pass. |
| `priority` | no | Integer 1–5. Recorded on the query; decides which strategy is tried FIRST, so it sets the order of the returned archetypes and — because each pick claims a (CPU, GPU) pair — which archetype claims a contested one. Never changes a score, and 3 (the default order) changes nothing relative to omitting it. |

Unknown fields are **rejected**, not ignored (`additionalProperties: false` with
ajv `removeAdditional: false`), so a typo is a 422 rather than a silent default.

### Request dedupe (contract v1.3)

A POST whose **request identity** matches an existing **committed** pass, against
the same **catalog version** and the same **engine version**, is answered from
that pass instead of running a second one: `200`, `reused: true`, and the
ORIGINAL `id`. The key is
`(budget_amount, currency, use_case, resolution, priority, scoring model, catalog_version, engine_version)`
— the profile's UUID `name` is deliberately **not** part of it, because it is
minted per request and identifies nothing.

What a reuse does and does not do:

- It **writes nothing**: no second `recommendation_profile`, no second
  `recommendation_query`, no new builds.
- It **runs no engine pass**, which is the point — a pass is ~74 statements and
  the client-side budget slider snaps to 500 MAD steps, so identical requests are
  common.
- It **still reads through the same statement GET uses**, so a reused reply and a
  first reply agree on every persisted field. There is no cached copy of a body.
- It is not served for a pass from a **different deploy** (`engine_version`), so a
  redeploy cannot hand a client an answer the new engine would not produce.
- It is not served for a pass that **never committed** — one that threw before its
  write transaction. Such a row has no persisted `reason`, so serving it would mean
  inventing one; the repeat request runs its own pass instead. A failed pass is not
  an answer.
- It **DOES reuse a committed zero-build pass** — one that assembled nothing but
  finished its write transaction. That is not a failure: an under-budget request
  is a legitimate answer (Decision 17.2), so a repeat is served `200` with an
  empty `builds`, the same persisted `budget_floor`, and no new row (Sprint
  scenario 5.5). Its `reason` is null on both replies, and that is the one field
  where a reuse cannot do better: `reason` is the single response field NO column
  records, so a reused reply can only agree with the first one. Nothing is lost in
  practice, because the pass that DOES carry a non-null `reason`,
  `EMPTY_CANDIDATE_POOL`, throws in the read pass before the write transaction: its
  row has no floor and is not reusable at all, so a reason can never be lost by a
  reuse.
- It is not served when the pass recorded **no catalog version** (see
  *Known limitations*), because an unknown version is a MISS, never a match.

`catalog_version` appears in every reply, reused or not: it is the catalog state
the pass ran against, so a client that keeps an `id` (a share link, a saved
build) can tell which catalog that reference belongs to.

Status codes:

| Status | When |
|---|---|
| **201** | **This request created a pass that produced at least one build.** `reused` is `false`. |
| **200** | **A reuse** — an equivalent pass already exists, so nothing was created (`reused: true`, and `id` is the ORIGINAL id). |
| **200** | A valid pass that produced **zero builds** — an under-budget floor is a legitimate outcome, not an error. Also the status for `EMPTY_CANDIDATE_POOL`, which additionally carries `reason`. |
| **422** | Body validation, or a value outside the advertised vocabulary. |
| **413** | Body over 10 KB. |
| **429** | Rate limit exceeded. |
| **503** | No active scoring model (or the pinned one became unavailable mid-pass). |
| **500** | Anything unexpected. Generic body + `request_id`; details go to the log only. |

### GET /v1/recommendations/:id

`:id` is the `recommendation_query` id returned as `id` by POST.

- **404 only when the query row itself is unknown.** A malformed (non-UUID) id
  can match no row, so it is a 404 rather than a leaked PostgreSQL `22P02`.
- A **known query with zero builds is a 200 with `"builds": []`** — never a 404.
- GET **never re-runs the engine** and never recomputes a floor. The DB-backed
  suite proves this with a spy, not by inspection.

### GET /v1/recommendations/:id/builds/:rank/swap-preview

What the build would become if ONE role held another product (contract v1.8, Decision 55).
**Read-only: nothing is persisted, no build row is rewritten, and no pass is re-run.**

```
GET /v1/recommendations/:id/builds/:rank/swap-preview?role=CPU&product_id=<uuid>
GET /v1/recommendations/:id/builds/:rank/swap-preview?role=GPU&product_id=<uuid>&product_variant_id=<uuid>
```

```json
{
  "compatibility": {
    "status": "FAIL",
    "pairs": [
      { "check": "cpu_motherboard", "role": "MOTHERBOARD", "partner_role": "CPU",
        "status": "PASS", "reason": null, "evidence": [] },
      { "check": "eligibility", "role": "RAM", "partner_role": null,
        "status": "FAIL", "reason": "NO_ELIGIBLE_OFFER", "evidence": [] }
    ],
    "unknown_pairwise_count": 0
  },
  "price":  { "previous": 1999, "next": null, "delta": null,
              "offer_class": null, "price_status": null },
  "budget": { "budget_amount": 20000, "total": null, "delta": null, "within_budget": null },
  "catalog_version": "0123456789abcdef0123456789abcdef",
  "engine_version": "dev"
}
```

- **Three facts, and nothing else**: `compatibility`, `price`, `budget` (Decision 55 item 3).
  There is no re-ranked list, no new `strategy_key` and no "updated build".
- **The verdict is the ENGINE's.** `compatibility.status` is `PASS | UNKNOWN | FAIL` by
  aggregation over `pairs`, each `{ check, role, partner_role, status, reason, evidence }`, from
  `assembly.evaluateBuildReplacement` over the SAME `PAIRWISE_CHECKS` table assembly uses.
  `evidence` is OPEN: its items are rule-specific objects, so a new rule's fields are an addition
  rather than a breaking change. `check` is not an enum for the same reason - it carries the
  relationship keys plus the non-pairwise `eligibility` value.
- **UNKNOWN is reported, never collapsed.** A client MUST render it as its own state; it is never
  "compatible". `unknown_pairwise_count` counts UNKNOWN pairs only (never "not PASS").
- **A FAIL verdict is a 200 RESULT, not an error**: the caller asked what would happen, and "it
  would not fit" is the answer.
- **An ineligible candidate** answers `FAIL` with ONE synthetic pair `check: "eligibility"`
  (`partner_role: null`) and a null price. Three reasons stay distinguishable: the filtering
  verdict's own code (e.g. `CPU_SOCKET_MISMATCH`), `NO_ELIGIBLE_OFFER` (a candidate Stage 1
  dropped: no offer in this currency, out of stock, outside the freshness window) and
  `PRODUCT_NOT_CANDIDATE` (never in the pool - unknown, inactive, or the wrong category for the role).
- **Every arithmetic field is nullable, and null means UNKNOWN - never 0.** `price.previous` is the
  persisted component's `price_used`, null when the role was omitted (the GPU-less build);
  `price.next` is null for an ineligible candidate; when either is null, `price.delta`,
  `budget.total`, `budget.delta` and `budget.within_budget` are null too.
- **`offer_class` and `price_status` travel with the number**, so a client can say what kind of
  price it is showing: `price_status` is `verified` only when `next` is `VERIFIED`, `indicative`
  otherwise, and `null` when there is no number to describe.
- **`role` is one of the engine's eight**: `CPU, MOTHERBOARD, RAM, GPU, PSU, CASE, CPU_COOLER,
  SSD_BOOT`. A GPU swap MUST name `product_variant_id` (GPU candidates are variant-keyed); every
  other role must not name one. The `product_id` and that variant both come from
  `GET /v1/catalog/products`, whose rows carry `id` and `variants` since contract v1.9 - before
  that the catalogue served slugs only, and a GPU swap could not be constructed by a client at all.
- **The catalog version is the LIVE one**, not the pass's recorded one: the verdict is a function
  of the catalog as it is now, so labelling it with the pass's catalog would be a false statement.
  It is `null` when the digest is unavailable - the same honest degradation POST uses.
- **It always describes the build the GET serves.** Once a commit has happened (contract v1.10,
  Decision 56) the EFFECTIVE build at that rank IS the derived one, so a preview prices the part that
  is installed now and evaluates the current pick set - previewing the installed part back is a valid
  question with a valid answer, while a second COMMIT stays `409 SWAP_ALREADY_COMMITTED`.
- **Status codes**: 200 (including FAIL and UNKNOWN), 404 (unknown id, unknown rank, a build with no
  component rows, or `BUILD_NOT_EVALUABLE` when a persisted pick is no longer a candidate in the
  live catalog - the message names the role), 422 (malformed rank / product id / variant, or a role
  outside the eight), 429 (30/min: a preview pays roughly a pass's read half, so it is priced like
  a POST rather than like a GET), 500.
- **`Cache-Control: no-store`** on the 200: the answer outlives neither the catalog nor the
  persisted build.
- **What it does NOT do**: it does not mutate `build_component` and does not create a
  `recommendation_query` row (an unmarked row blocks the golden harness). Keeping an answer is
  the OTHER verb on the same path - see *POST .../swap* (Decision 56).

### POST /v1/recommendations/:id/builds/:rank/swap

Keep the preview's answer (contract v1.10, Decision 56). **It APPENDS a derived build and
never edits the pass**: the pass's own `recommendation_result`, `build_candidate`,
`build_component`, rank, `strategy_key`, `engine_version` and Decision 47 dedupe key stay
exactly what they were.

```
POST /v1/recommendations/:id/builds/:rank/swap
Content-Type: application/json

{ "role": "GPU", "product_id": "<uuid>", "product_variant_id": "<uuid>" }
```

The body is the preview's query string, field for field (`product_variant_id` is required for
role `GPU` and refused for every other role), because a commit is "the preview, but keep it" - a
different payload would let the two ask different questions.

```json
{
  "compatibility": { "status": "PASS", "pairs": [ /* same shape as the preview */ ],
                     "unknown_pairwise_count": 0 },
  "price":  { "previous": 1999, "next": 3200, "delta": 1201,
              "offer_class": "SEED_UNVERIFIED", "price_status": "indicative" },
  "budget": { "budget_amount": 20000, "total": 13201, "delta": 1201, "within_budget": true },
  "swapped": { "role": "CPU", "committed_at": "2026-10-25T12:00:00.000Z",
               "engine_version": "dev" },
  "catalog_version": "0123456789abcdef0123456789abcdef",
  "engine_version": "dev"
}
```

- **201, and `swapped` is never null.** A 201 that did not name the commit it just made would be
  indistinguishable from a preview.
- **The verdict is the WHOLE build's**, not the preview's role-scoped one: it is what was
  persisted as `build_candidate.compatibility_status`, computed by `assembly.evaluateBuild` over
  the SAME `PAIRWISE_CHECKS` table. A `FAIL` verdict is REFUSED (`409`), so a stored build never
  gains a status a reader has to disbelieve. `UNKNOWN` COMMITS - a pass persists UNKNOWN builds
  too - and it is stored as UNKNOWN, never laundered into PASS.
- **The money is the preview's arithmetic**: `total = persisted total - previous + next`, and the
  OTHER roles keep their persisted prices (a swap must not silently reprice the whole build at
  today's offers). Every field is nullable in the same places as the preview, and null is never 0.
- **The derived build** gets its own `build_candidate` (total, score, status) and its own
  `build_component` rows, plus ONE `recommendation_swap` row linking it to the result it was
  derived from. It holds no `recommendation_result` row, so it cannot become a rank, a preset
  target or a dedupe match. Its `score` is recomputed under the PASS's own pinned model and the
  derived build's UNKNOWN count: copying the old score would leave a number describing parts that
  are gone.
- **One swap per build.** A second commit is `409 SWAP_ALREADY_COMMITTED`; the UNIQUE index on
  `recommendation_swap.source_result_id` is the race guard, so two concurrent commits cannot both
  win.
- **The GET that follows serves the derived build** at that rank (`swapped` names the role,
  `explanation` is null because the stored text described the replaced part). The rank does not
  move and no new rank appears.
- **Status codes**: 201, 404 (unknown id/rank, a build with no component rows, or
  `BUILD_NOT_EVALUABLE` naming the role), 409 (`SWAP_ALREADY_COMMITTED`, `SWAP_ROLE_ABSENT` when
  the build has no such role to replace, `SWAP_NOT_COMMITTABLE` for an ineligible or incompatible
  replacement - nothing is written), 422 (malformed rank / product id / variant, or a role outside
  the eight), 429 (30/min: it pays a preview's read half), 500.
- **What it never does**: no UPDATE and no DELETE anywhere. The production role has no row-wide
  UPDATE privilege precisely so a pass cannot be quietly rewritten, which is also why
  `recommendation_swap` had to be added to its INSERT grant (Decision 56 item 10).

### GET /v1/presets

The read-only landing-page ribbon (Platform P1 Sprint 6 / Decision 48):
`GET /v1/presets?use_case=<use_case>&currency=<CCC>`.

| Query parameter | Required | Notes |
|---|---|---|
| `use_case` | yes | One of the advertised values — checked against the ACTIVE model's vocabulary in the handler, so an undeclared use case is a **422 carrying the vocabulary**, never an empty list. |
| `currency` | yes | Exactly 3 characters, one of the advertised values. Unknown query parameters are refused (422), like unknown body fields. |

```json
{
  "catalog_version": "9f0c5a1b2d3e4f5061728394a5b6c7d8",
  "generated_at": "2026-10-16T09:00:00.000Z",
  "presets": [
    {
      "budget_amount": 6000,
      "recommendation_id": "b6f1c0a5-0f2f-4f2a-9c0f-2b1f5f2f6a10",
      "build_score": 61.25,
      "price_status": "verified"
    }
  ]
}
```

- A preset is a **pointer**, not a copy: `recommendation_id` is an ordinary
  recommendation id, and `GET /v1/recommendations/:id` answers it through the
  same read path as a POST reply — so the ribbon and the pass cannot disagree.
- Only rows of the **current catalog version** are served, cheapest budget
  first. `catalog_version` is the version the route itself computed; rows of a
  superseded version are invisible, so a price update can never answer with the
  builds it invalidated.
- `generated_at` is the newest generation time among the rows returned, and
  `null` for an empty list. **200 with an empty list is a valid answer**
  ("nothing generated for this catalog yet"), never a 404.
- `build_score` is the rank-1 build's persisted score, `null` when the pass
  assembled nothing — never `0`.
- `price_status` is derived per preset: `"verified"` only when the shown build
  has components and every one is `VERIFIED`; `"indicative"` when any is not
  (unknown provenance included); `null` when there is no build to make a claim
  about. Same direction as the recommendation contract, with one extra outcome.
- **503** when there is no active scoring model, the model declares no usable
  use-case vocabulary, or the catalog version could not be computed — without a
  version nothing can be selected, and an empty list would be indistinguishable
  from "nothing generated".
- Presets are generated by `node scripts/generate-presets.js --commit`
  (TEST-branch write target only), idempotent per key: a second run for the same
  catalog version runs no pass and writes nothing. `--cleanup` removes the
  preset rows with their passes — generated passes are unmarked
  `recommendation_query` rows and block `npm run eval:scenarios` until removed.
  That command also needs `--model=<name@version>`: on the TEST branch the
  default pin `seed-minimal-v1@1.0.0` is NOT ACTIVE, so the bare `--commit`
  refuses before writing anything - pass `--model=launch-v2@1.0.0` (measured
  2026-10-20: exit 1, nothing written).

### GET /v1/catalog/products

The read-only catalogue page (Platform P2 Sprint 3, contract v1.5, Decision 50):
`GET /v1/catalog/products?role=<role>&limit=<n>&cursor=<slug>`.

| Query parameter | Required | Notes |
|---|---|---|
| `role` | no | A `component_role` (`CPU`, `GPU`, `MOTHERBOARD`, `RAM`, `SSD_BOOT`, `SSD_SECONDARY`, `PSU`, `CASE`, `CPU_COOLER`), translated to its `product_category`. An unknown value is a **422 naming the accepted roles**. |
| `limit` | no | Integer 1-100; **default 20**. `limit=0` and `limit=1000` are 422s. |
| `cursor` | no | The previous page's `next_cursor` (a slug). Omit it for the first page. Unknown query parameters are refused (422). |

```json
{
  "products": [
    {
      "id": "6f0c1c9e-0b7f-4f5a-9d1e-2b8a7c6d5e4f",
      "slug": "amd-ryzen-5-5600",
      "display_name": "AMD Ryzen 5 5600",
      "category": "CPU",
      "from_price": 899,
      "offer_class": "SEED_UNVERIFIED",
      "has_offer": true,
      "variants": []
    }
  ],
  "next_cursor": "amd-ryzen-5-5600"
}
```

- Rows are the ACTIVE products that have a canonical spec table (the same set the engine
  can select from), ordered by `slug` - the unique column, so pagination is a **keyset**: the
  next page asks for `slug > cursor`. A page boundary revisited returns the same rows; no row
  is skipped or repeated, and no `OFFSET` is involved. `next_cursor: null` means the last page.
- `category` is **derived** from spec-table presence; `product` has no category column.
- `from_price` is the cheapest **eligible** offer of that product in MAD - `price > 0`,
  `availability <> 'OUT_OF_STOCK'`, and inside the 30-day freshness window unless it is a seed
  offer (the same eligibility the engine prices with). `offer_class` is that price's Decision 35
  provenance; `has_offer: false` with a `null` `from_price` means "no eligible offer yet", and
  such a product is still listed rather than silently dropped.
- There is **no `use_case` parameter**, although the sprint sketch listed one: the active model
  exposes no per-use-case product filter, so it could only be inert, and this API refuses a
  query parameter it would ignore. `PLAN_PLATFORM_P2.md` records the deviation.
- **`id` and `variants` (contract v1.9) exist so the row can be ADDRESSED**, not to enrich the
  page. A GPU candidate is a `(product, variant)` pair (Engine 2B), so a surface that knows only
  the slug cannot name the thing a route prices or swaps: the swap preview takes a `product_id`
  and, for role `GPU`, a `product_variant_id`. `variants` is ordered by `id` - the engine's own
  total order, so "the first variant" means the same row in both places - and is `[]`, never
  `null`, when the product has no variant rows. Neither field is a secret: a recommendation
  response already serves `product_id` per component, and `product_variant_id` is the SKU's own
  row key. The list is the only catalogue route that carries them; the detail page's `specs`
  block still strips identity columns, because its spec belongs to ONE variant already.

### GET /v1/catalog/products/:slug

One product page: identity, specs, every eligible offer, and the derived price status.

```json
{
  "slug": "amd-ryzen-5-5600",
  "display_name": "AMD Ryzen 5 5600",
  "category": "CPU",
  "specs": { "cores": 6, "threads": 12, "socket_id": "8b1c...", "tdp_watts": 65 },
  "offers": [{ "price": 899, "currency": "MAD", "offer_class": "SEED_UNVERIFIED" }],
  "price_status": "indicative",
  "disclaimer": "Prix indicatifs, non actualisés."
}
```

- `specs` is the canonical spec table's row as ONE flat object, with identity and audit
  columns stripped. A GPU's spec belongs to the **variant whose price is shown** (the variant
  of the cheapest eligible offer; the lowest-id variant when there is no offer), so the spec and
  the price cannot describe two different cards.
- `offers` is every eligible offer, cheapest first, each carrying its provenance class. The list
  endpoint's `from_price` is this list's first price.
- `price_status` is derived exactly as the recommendation response derives it: `"verified"` only
  when the product HAS offers and every one is `VERIFIED`; `"indicative"` when any is not (an
  unknown class included); `null` when there is no eligible offer - a build-less page has no
  price to make a claim about. Seed pricing, which is the whole catalogue today, is therefore
  `indicative`, and the disclaimer is always present.
- **404** for any slug without an ACTIVE catalogue product, malformed slugs included (there is no
  row to leak a PostgreSQL `22P02` from). **422** only for a schema violation, such as an
  over-long slug.

### GET /v1/catalog/products/:slug/price-history

The observations behind one product's price (contract v1.6, Decision 51). One point per
observation MOMENT, oldest first.

```json
{
  "slug": "rtx-4060-8gb",
  "currency": "MAD",
  "points": [
    { "observed_at": "2026-09-18T22:33:23.358Z", "price": 3200, "offer_class": "SEED_UNVERIFIED" }
  ],
  "observation_count": 1,
  "latest_price": 3200,
  "min_price": 3200,
  "max_price": 3200,
  "change_amount": null,
  "change_pct": null,
  "disclaimer": "Prix indicatifs, non actualisés."
}
```

- **One point per MOMENT, at that moment's cheapest observed price.** A product can hold
  several offers (two stores, two variants) and both can be recorded in the same sweep;
  serving them as consecutive points would draw a rise that never happened. `observation_count`
  is the number of moments served, and the array is ascending by `observed_at`, so a client
  plots it in order.
- **Every point carries its provenance class**, derived from the offer's `ingestion_record_id`
  exactly as the list and detail do. The whole catalogue is seed pricing today, so every point
  is `SEED_UNVERIFIED` - correct, and not special-cased.
- **Thin data is reported, not smoothed.** `latest_price`, `min_price` and `max_price` need one
  moment; `change_amount` and `change_pct` need two and are `null` otherwise - a change over a
  single observation is UNKNOWN, never `0`. Today the branch's entire history is one sweep
  (2026-09-18 to 2026-09-27), so the honest rendering is a sentence and a date, not a line.
- **No history is a 200** with `points: []`, `observation_count: 0` and every summary field
  `null`. **An unknown slug is a 404** with the standard envelope - never an empty history.
- **No window or paging parameter**, and the route caps at 366 moments (newest kept). The
  30-day offer-eligibility window is deliberately NOT applied to historical rows: it answers
  "may this offer be recommended now", and pruning history by it would rewrite the past.
- **Nothing else changed.** v1.6 adds this one path - no field on the existing paths gained,
  lost or changed type - and the served document is pinned byte-for-byte by
  `apps/api/test/unit/openapi-v1.10.json` (the one snapshot in the tree).

## Response shape

```json
{
  "id": "b6f1c0a5-0f2f-4f2a-9c0f-2b1f5f2f6a10",
  "budget_amount": 20000,
  "currency": "MAD",
  "use_case": "GAMING",
  "generated_at": "2026-10-07T09:00:06.000Z",
  "budget_floor": {
    "cheapest_total": 4477,
    "currency": "MAD",
    "budget_amount": 20000,
    "within_budget": true,
    "cheapest_by_role": { "CPU": 899, "MOTHERBOARD": 500, "RAM": 400,
                          "PSU": 599, "CASE": 849, "CPU_COOLER": 350,
                          "SSD_BOOT": 599 },
    "missing_roles": []
  },
  "engine_version": "a1b2c3d",
  "catalog_version": "f6df98b7588334800b687280242eb95f",
  "reused": false,
  "reason": null,
  "input_effects": [
    { "input": "use_case", "effect": "APPLIED", "reason": "USE_CASE_PROFILE" },
    { "input": "resolution", "effect": "APPLIED", "reason": "GPU_TARGET_SCALED" },
    { "input": "priority", "effect": "APPLIED", "reason": "STRATEGY_ORDER" }
  ],
  "disclaimer": "Prix indicatifs, non actualisés.",
  "served_by": { "engine_version": "a1b2c3d" },
  "builds": [
    {
      "rank": 1,
      "engine_version": "a1b2c3d",
      "strategy_key": "PERFORMANCE",
      "total_price": 12000.00,
      "build_score": 77.5,
      "compatibility_status": "PASS",
      "explanation": "…",
      "price_status": "indicative",
      "components": [
        {
          "role": "CPU",
          "product_id": "…",
          "name": "…",
          "slug": "…",
          "variant": null,
          "price_used": 1999.00,
          "offer_class": "SEED_UNVERIFIED",
          "store_offer_id": "…"
        }
      ]
    }
  ]
}
```

`budget_floor` is a **candidate** floor, not a promise of a build. `cheapest_total` sums the
cheapest eligible candidate for each role the pass requires, so it says what an assembly *could*
pay if those cheapest picks were pairwise compatible - which the Decision 16 gate may still
abandon. A query can therefore answer `within_budget: true` with `builds: []`: on the seed
catalog the golden baseline records a 4477 MAD floor against a 7677 MAD cheapest assembled
build. The two fields answer different questions (is the cheapest eligible part set inside the
budget? / does a compatible combination assemble?), `within_budget` is `null` - never `true` -
when a required role is missing, and the field is informational: the zero-build answer in that
band is a compatibility outcome, not a budget shortfall.

### POST and GET differ in no persisted field

POST and GET present the response through the **same** function over the **same**
read: POST re-reads the rows it just committed instead of trusting the engine's
in-memory result. They therefore cannot drift on any persisted field — not by
discipline, but because there is only one code path.

That sentence is now **total**. Before migration 019 it carried an exception:
`budget_floor` had no column, so POST served the engine's in-memory copy and GET
served `null` — as did `engine_version`. Decision 46 persists all of them
(`recommendation_query.budget_floor`, and `recommendation_result.engine_version`
plus `.strategy_key`), so the engine's in-memory result no longer feeds the
response at all: a later GET of a query reproduces the POST reply byte for byte,
nested JSONB floor included. Neither GET nor the API ever recomputes a floor — a
null means "not recorded", never "zero".

Two fields name a deploy, and they answer different questions:

| Field | Means | Source |
|---|---|---|
| `engine_version` | the deploy that **ran the pass** | read back from the persisted result rows |
| `served_by.engine_version` | the deploy that **answered this request** | `ENGINE_VERSION` of the process |

`served_by.engine_version` is always populated, on both verbs. `engine_version` is
`null` when nothing recorded it: a pass with **zero builds** persists no result
row, and so has no pass engine version to report — its `budget_floor` is still
recorded, because that lives on the query row. The API will not attribute a pass
to a deploy the database does not name.

**`reused` is the second exception, and it is a REQUEST fact, not a property of
the resource.** No persisted row distinguishes a pass that was served from one
that was just run, because nothing needed to: a reuse returns the same rows
either way. So `reused` is `true` only on the POST that found an equivalent pass,
and `false` on every GET and on every POST that ran its own pass — exactly like
`served_by`, which also answers a question about the request rather than about the
stored data. `catalog_version` has no such caveat: it is a column, so it is read
back like every other field.

Each build also carries its own `engine_version` and `strategy_key`: which E4
archetype (Decision 41) nominated that rank. Both are read per result row, so two
ranks in one reply can legitimately carry different strategies.

**`input_effects` is the third request-shaped field, and it is the only one that
claims something about the INPUTS.** It is derived from the same rows on both
verbs (see *What each input changes*), so it is not a request fact in the sense
`reused` is - a revisit reproduces it - but it is also never read back from a
column, because nothing stores it. Three consequences are deliberate: an older
pass whose model row is gone reads UNKNOWN rather than the current model's
answer; a `NO_EFFECT` names its proof instead of leaving the user to guess; and
an `APPLIED` says what the input shaped, never that a different build would have
been better.

### `price_status`

**Derived, never stored.** `"verified"` only when **every** component's persisted
`offer_class` is `VERIFIED`; anything else — including a missing or unrecognised
class — is `"indicative"`. The failure direction is deliberate: an unknown
provenance must never be advertised as confirmed. `disclaimer` restates this in
French because the label alone is easy to miss.

Every component carries its own `offer_class` (`SEED_UNVERIFIED` | `VERIFIED`)
and the `store_offer_id` that produced it, both snapshotted at commit time
(migration 018 / Decision 35), so a later `store_offer` update cannot relabel a
historical build.

`name` comes from `COALESCE(product.display_name, product.name)` and `slug` from
`product.slug`; `variant` comes from `product_variant.sku` (that table has no
name column). All of them are read back from the persisted join, which is also
why POST and GET agree. Migration `020_product_identity_and_media.sql` backfills
`display_name` (the `Seed `-stripped name) for every catalog row and assigns a
unique, deterministic, CHECKed `slug`, so **the `Seed ` prefix no longer reaches
clients** and `components[].name` is a name fit to show. `slug` is **nullable**,
because its column is: 020 deliberately did not add `NOT NULL`, since that would
break every product writer that supplies no slug, and NULL means UNKNOWN in this
schema. A row inserted after 020's backfill without a `display_name` legitimately
falls back to `name` - that fallback is the one case where the prefix could
reappear, and it is a data-completeness problem rather than a contract one.

## Option vocabulary

`GET /v1/meta/options` returns `{ "value", "label" }` pairs with **French
labels** (the product is the Moroccan market).

| Dimension | Source |
|---|---|
| `use_cases` | The active scoring model's use-case vocabulary: the `use_case_profiles` keys when the model declares them (`launch-v2`), otherwise the legacy `configuration.gpu_required_use_cases` (`seed-minimal-v1`). Not a `DISTINCT` over submitted values, and not a second hardcoded list. Order follows the JSONB key order of `use_case_profiles`, not the declaration order in the seed file. |
| `currencies` | A fixed allow-list (`MAD`), not a `DISTINCT` over `store_offer`. Stage 1 matches currency by exact equality, so advertising an unpriceable currency would be a lie. |
| `resolutions`, `priorities` | Fixed lists. **Stored on the profile/query and read downstream — `resolution` by retention, `priority` by ranking; neither changes a score.** |
| `inputs_applied` | NOT an option list: the subset of `use_case` / `resolution` / `priority` the ACTIVE model gives a reader at all. `resolution` is omitted when the model declares neither a GPU spend target nor a `resolution_profiles` floor, so a form can stop asking it. Advisory only — an omitted input is still accepted. |

The option list and the POST validator read ONE array, derived in one place:
`apps/api/src/engine.js` calls the scoring barrel's `listUseCases` (the API's
only permitted engine import), and `apps/api/src/meta.js` turns those values
into French-labelled options and validates POST against them. A value POST
accepts is therefore always advertised, and vice versa. Both directions are
pinned by `apps/api/test/unit/meta-consistency.test.js` (unit) and
`apps/api/test/db/recommendations.db.test.js` (the real active model on the
branch).

If the active scoring model cannot be read — or it can be read but its
configuration declares no use-case vocabulary at all, which is UNKNOWN rather
than empty — `/v1/meta/options` answers **503**, and so does a POST, because a
model with no vocabulary cannot validate one. Never an empty array, which
would look like a valid form with no valid choice.

**`resolution` and `priority` are read, but neither changes a score, and on
today's catalog neither moves the top build.** `loadQueryInput` returns both as
siblings of the engine's candidate-selection input (never inside it);
`priority` (1–5) sets the ORDER of the returned archetypes, so it can change
which build is rank 1 and each build's `strategy_key`, and `resolution` scales
the GPU spend target that target-aware retention applies and gates the optional
per-resolution VRAM floor. Neither reaches Engine 4's arithmetic, and the
measured effect here is nil: the catalog exposes only one or two distinct (CPU,
GPU) pairs - never the three an archetype set needs - so all three strategies
claim the same builds, and no active model declares `resolution_profiles`.
`recommendation_profile.default_resolution` is read by nothing. A frontend may
show these as preferences; the per-pass truth is served as `input_effects` (see *What each input changes*), and it still must not promise that changing one changes the build.

## What each input changes (contract v1.7)

The three accepted inputs are not decorations, and they are not "applied" in the
same sense. Each has exactly one reader in the pipeline, and what it changes is
narrower than a score:

| Input | What it changes | What it never changes |
|---|---|---|
| `use_case` | Selects the scoring model's `use_case_profiles[use_case]`: its `gpu_policy` decides whether a discrete GPU is required (Decision 43), and its `spend_targets` become the per-role price targets retention aims at (Decision 39). With no profile, the legacy `gpu_required_use_cases` list still decides the GPU requirement. | It does not touch Engine 4's arithmetic. Two use cases whose profiles are identical produce identical scores. |
| `resolution` | Multiplies the **GPU** spend target only (1080p ×1.0, 1440p ×1.25, 2160p ×1.5 — `retention/targets.js`), and selects a declared `resolution_profiles[resolution].vram_floor_gb` floor when the model declares one (Decision 42). | It does not change a score, and it scales no other role's target. |
| `priority` | Orders the archetype strategies (1–2 VALUE first, 3 BALANCED first, 4–5 PERFORMANCE first), so it decides which strategy is tried first and — because each pick claims a (CPU, GPU) pair — which archetype claims a contested pair. That fixes each build's `strategy_key` and its rank (Decision 41). | It does not change a score, and it is not a weight: no scoring term reads it. **3 is also the order an omitted priority produces**, so it is reported `NO_EFFECT` / `DEFAULT_ORDER` rather than credited with a change it did not make. |

### `inputs_applied` (on `GET /v1/meta/options`)

A **deployment** fact: the subset of `use_case` / `resolution` / `priority` the
ACTIVE model's configuration gives a reader at all. `use_case` and `priority`
always appear; `resolution` appears only when the model declares a GPU spend
target (a POSITIVE share) or a `resolution_profiles` entry. A model declaring neither (the legacy
`seed-minimal-v1`) therefore serves `["use_case", "priority"]`, and the web wizard
stops asking the resolution question rather than recording an answer nothing
reads. The list is **advisory**: an input it omits is still ACCEPTED by POST and
still recorded on the query row.

### `input_effects` (on both recommendation verbs)

A **per-pass** fact, derived on the read path from the rows the pass persisted:
the query's own `use_case` / `resolution` / `priority`, the configuration of the
scoring model the query recorded (`recommendation_query.scoring_model_id`, joined
LEFT so a deleted model row reads as UNKNOWN rather than borrowing the current
one), and the builds' `strategy_key`s. POST and GET therefore report the same
three records, and a revisit cannot claim an effect the original pass did not
have.

Each record is `{ input, effect, reason }`, in the order `use_case`,
`resolution`, `priority` — always all three, so an omitted optional input is
reported rather than left for a client to infer:

| `effect` | Means |
|---|---|
| `APPLIED` | The input was read **and shaped this pass**: it selected a declared profile, scaled the GPU target away from neutral, selected a declared VRAM floor, or selected a NON-DEFAULT archetype order (which strategy is tried first). It does **not** claim the top build would have differed — there is no persisted counterfactual, so the API does not assert one. |
| `NO_EFFECT` | Provably could not change this pass, and `reason` names the proof. |
| `UNKNOWN` | The facts needed to say either way were not recorded (a missing model row, an unrecognised stored value). NULL means UNKNOWN, and UNKNOWN is never reported as either of the others. |

`reason` is a closed list for the writers in this repository; a client must map it
and fall back to the effect's generic sentence, never print it raw (the same rule
as `reasons[]` below):

| `reason` | Effect | Fact |
|---|---|---|
| `USE_CASE_PROFILE` | APPLIED | A declared `use_case_profiles` entry was selected. |
| `GPU_POLICY_ONLY` | APPLIED | No profile; the legacy `gpu_required_use_cases` list was consulted. |
| `VRAM_FLOOR` | APPLIED | A declared per-resolution VRAM floor was selected. |
| `GPU_TARGET_SCALED` | APPLIED | The GPU spend target was multiplied by a non-neutral factor. |
| `NEUTRAL_MULTIPLIER` | NO_EFFECT | The resolution's multiplier is exactly 1.0. |
| `NO_GPU_TARGET` | NO_EFFECT | The selected profile declares no GPU spend target (or a zero share, which the multiplier cannot move). |
| `NO_RESOLUTION_POLICY` | NO_EFFECT | The model declares no per-resolution read. |
| `STRATEGY_ORDER` | APPLIED | The priority selected an archetype order other than the default one, so it chose which strategy is tried first. |
| `DEFAULT_ORDER` | NO_EFFECT | The priority (3) IS the order an omitted one produces. |
| `NO_BUILDS` | NO_EFFECT | Nothing was assembled for it to order. |
| `NOT_PROVIDED` | NO_EFFECT | The request omitted the optional input. |
| `NOT_RECORDED` | UNKNOWN | The pass did not record what the answer needs. |
| `UNRECOGNISED_VALUE` | UNKNOWN | A stored value outside the accepted vocabulary. |

Two facts about `priority` are worth stating because a client maps the reason:
`NO_BUILDS` means the pass returned NO build at all, while a pass whose builds came
back with no recorded `strategy_key` (a pre-019 result row) reports
`UNKNOWN` / `NOT_RECORDED` - the builds exist, the order they came back in is what
was not recorded. And a zero GPU share in a profile is `NO_GPU_TARGET`, not
`GPU_TARGET_SCALED`: `0 x multiplier` is 0, so the resolution cannot have moved it.

Pinned by `apps/api/test/unit/inputs.test.js` (the derivation and every reason),
`apps/api/test/unit/contract.test.js` (POST/GET agreement and the UNKNOWN case),
and `apps/web/e2e/inputs-applied.spec.ts` (the parser and the rendered block in
both locales).

## Errors

One envelope for every non-2xx body:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": [ { "field": "use_case", "message": "must be equal to one of the allowed values" } ]
}
```

Cross-origin clients need two of these headers and the CORS safelist does not include them, so
the API lists `Retry-After` and `X-Request-Id` in `Access-Control-Expose-Headers`: without that
a browser's `fetch` returns both as null, and a 429 countdown or a support handle silently
disappears even though the server sent them. `apps/api/test/unit/cors.test.js` pins it.

`INTERNAL_ERROR` returns a generic message plus `request_id` and **never** echoes
the underlying error, which can carry a SQL fragment or a host; the detail is
logged under that same request id. `NOT_FOUND` never reveals whether an id
merely looks wrong. A **429** carries `request_id` as well, so a limit that
fires can be correlated with the log exactly like a 500.

## Logging and the OpenAPI document

Structured JSON via pino, with a request id on every line. **Request bodies and
database URLs are never logged.** `ENGINE_VERSION` identifies the deploy.

`GET /v1/docs/json` serves the OpenAPI 3.0 document. Note the path: the
`exposeRoute` option was removed from `@fastify/swagger` v9 and the UI route
belongs to `@fastify/swagger-ui`, which is not a dependency here — so the
document is served by a two-line route of our own at `/v1/docs/json`.

**The document is a GATE, not a description.** `apps/api/test/unit/openapi-coverage.test.js`
enumerates every route Fastify actually registered, exempts only HEAD (synthesized
for every GET), the CORS preflight wildcard and `/v1/docs/json` itself, and fails
when any other route has no matching `paths` entry, no JSON response schema, or
omits its `429`/`500` response. The exemption list is asserted to match real
routes, so it cannot go stale. The snapshot pins the bytes; this gate pins
completeness. Adding a route without documenting it is now a red suite.

## Observability

Error capture is OPTIONAL and DSN-gated. With no `SENTRY_DSN` the API behaves
exactly as it did before the integration existed: no client, no transport, no
outbound socket, and `@sentry/node` is never imported. With a DSN set:

- **Captured:** unexpected failures only - the path that answers the generic
  `500 INTERNAL_ERROR` - tagged with the same `request_id` the client is given,
  so a report maps to a response.
- **Never captured:** `422` validation failures, `413` payloads, `429` rate
  limits, `404` misses and the mapped `503 SCORING_MODEL_UNAVAILABLE`. Those are
  responses, not incidents.
- **Never sent:** request bodies, query strings, headers and cookies. `beforeSend`
  deletes the whole `request` object before an event leaves the process,
  `sendDefaultPii` is off and tracing is off (`tracesSampleRate: 0`).

`SENTRY_ENVIRONMENT` and `SENTRY_RELEASE` are optional; `release` falls back to
`ENGINE_VERSION`, which every deploy already sets. A failing sink is logged at
`warn` and never changes the response a client receives.

**Not yet proven end to end.** The capture path is unit-tested, but no event has
been delivered to a real project: P3 Sprint 4 Step 3 needs a deployed origin and
a DSN. The uptime check must assert the health BODY (`db == "ok"`), not the
status code, because `/v1/health` answers `200` with `db: "down"` (Step 4, open).

## Testing

| Suite | Command | Needs a DB | Runs in |
|---|---|---|---|
| Unit / contract | `npm run test:api` | no | push, pull_request, workflow_dispatch |
| End-to-end | `npm run test:api:db` | `TEST_DATABASE_URL` | schedule + workflow_dispatch |

`test:api:db` runs through a launcher that **fails fast, never skips** when
`TEST_DATABASE_URL` is missing or targets the shared database, and treats **zero
executed tests as failure** — a skipped suite must not read as coverage. The
end-to-end suite asserts zero residue after every run, deleting in dependency
order (`build_rejection` → `recommendation_result` → `build_component` →
`build_candidate` → `recommendation_query` → `recommendation_profile`; the
profile id is captured before the query is deleted).

## Known limitations

- **`test:api:db` is VERIFIED in CI since 2026-10-19**, on both a dispatched run and a push:
  run 39120485573 answered `9 passed / 0 failed` on a GitHub runner, and dispatch run 39207745723
  on `master` completed with every `recurring-gates` step PASS. What remains OPEN is the opposite
  direction: the API has never been deployed, so no CI run has exercised it against a DEPLOYED origin.
- **CI pins Node 22 with no matrix.** The API suites were verified locally on
  Node 22 and on the default Node 24; only 22 runs in CI.
- **No pagination on `builds`.** The engine persists at most
  `TOP_N_PERSISTED` builds, so the list is bounded by construction.
- **No 202/polling path.** A POST is synchronous; measure before adding
  asynchronous job handling.
- **`resolution`/`priority` are read but change no score, and on today's catalog they rarely change the answer** (see *What each input changes*). `input_effects` reports the per-pass truth, so a client never has to guess; the measured emptiness is a property of the catalog (one or two distinct (CPU, GPU) pairs), not of an unread field.
- **The identity surface needs migration 020 wherever the API points.** `components[].name` is `COALESCE(product.display_name, product.name)` and `components[].slug` is `product.slug`; against a database below 020 those columns do not exist, the component read fails `42703`, and the request answers the generic `500 INTERNAL_ERROR`. Both databases are at 020 since 2026-10-15 (the shared catalog's 104 products all carry distinct CHECKed slugs and no `Seed `-prefixed `display_name`), so on either target the prefix is gone from served names and every component carries a slug.
- **`strategy_key` / `engine_version` are recorded but not yet consumed.** They are persisted and served; no client reads them back yet, and their golden-harness coverage (A10) is still owed (**OG-46** — OG-45 tracks the persistence itself, which is done wherever migration 019 is applied).
- **A zero-build pass is deploy-blind in the reuse key.** `engine_version` is recorded on `recommendation_result` rows (Decision 46), and a pass that assembled nothing has none, so the key can only require that *no* result row contradicts the answering deploy. A committed zero-build pass therefore survives a redeploy in the key. Its `budget_floor` is catalog-derived and the catalog IS in the key, so the exposure is narrow; the fix, when it matters, is to record the engine version on the query row too.
- **Two identical POSTs in flight at once can both run a pass.** The lookup is a read, not a lock, so the second request may not see the first's row yet. The suites are sequential and the sprint's DoD is about repeated (not concurrent) requests; a unique index on the key plus a retry would close it.
- **A failed catalog digest degrades to `catalog_version: null` and disables reuse.** The digest is one read over the catalog tables; if it cannot be computed the pass still runs (a cache key must not break the product), the row records NULL, and no later request can match it — the safe direction, never a stale hit. Reuse is off until the digest works again, and the failure is logged at `warn`.
- **The dedupe lookup has no index yet.** It filters seven columns on `recommendation_query` and takes `LIMIT 1`; the table holds zero rows and grows only with DISTINCT requests, so a sequential scan is correct today. Add an index when there is a measured slow lookup and a plan to justify its shape.
