# HTTP API — contract and operation

The HTTP surface over the recommendation engine. It lives in `apps/api/`, is
specified by **Decision 36**, and owns **no engine logic**: every route calls the
engine through its public barrels and reads or writes Layer 4 rows through one
repository module.

Status at 2026-10-15: **implemented and running against the TEST branch.** The
DB-free suite runs on every push/PR; the DB-backed suite is wired into the
recurring CI job and has been verified locally, but **not yet by a CI run**. Both
databases now carry the schema it reads (019 + 020; shared applied 2026-10-15), while
the write-safety default still points the API at the isolated branch - see *Database
target*.

**Contract v1.2 (2026-10-15):** v1.1 (2026-10-14) surfaced the persisted pass
facts - `budget_floor`, `engine_version` and each build's `strategy_key` became
columns in migration `019_recommendation_pass_facts.sql` (Decision 46), so POST
and GET no longer differ on any persisted field. v1.2 adds product identity:
each component carries its persisted `slug`, and its `name` is
`COALESCE(product.display_name, product.name)` as of migration
`020_product_identity_and_media.sql`, so the ingestion-only `Seed ` prefix no
longer reaches a client. See *Response shape*.

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
`API_ALLOW_SHARED=1`; it is now met. Two notes that still hold: a failed POST is not
free, because `createRecommendationQuery` commits the profile and query rows BEFORE the
engine runs, so it leaves an unmarked `recommendation_query` row behind and the golden
harness refuses to run while ANY unmarked row exists (delete them in FK order); and the
`morocco_pc_api` role does not exist on the shared database yet, so the column-scoped
GRANTs in *Production mode* remain unapplied.

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
| `LOG_LEVEL`, `LOG_PRETTY` | pino level; `LOG_PRETTY=1` uses `pino-pretty` (a devDependency, feature-detected — production installs log JSON). |
| `ENGINE_VERSION` | The value reported as `served_by.engine_version` and, since Decision 46, PERSISTED per result row as the pass's `engine_version` — the API hands it to the engine, so a stored build names the deploy that produced it. Intended to be the git short SHA; defaults to `dev`. |
| `DATABASE_URL`, `TEST_DATABASE_URL` | Both required. The guard compares their hostnames to prove they differ. |
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

## Production mode (designed 2026-10-07, not yet applied)

The beta runs against the TEST branch. Pointing the API at the shared Neon
project (`API_ALLOW_SHARED=1` + `DATABASE_URL`) is a production decision, and
the facts below govern it.

### The database role

The API must not connect as the project owner. The engine's commit path issues
INSERTs into the six Layer 4 tables and exactly ONE DELETE — verified from
`src/recommendation/orchestrator/commit.js` and
`src/recommendation/persistence/persist-rejections.js`: Decision 31's
replace-idempotence clears this query's `build_rejection` rows before
re-inserting. The production role is therefore:

```sql
CREATE ROLE morocco_pc_api LOGIN PASSWORD '<from the secret store>';
GRANT USAGE ON SCHEMA public TO morocco_pc_api;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO morocco_pc_api;
GRANT INSERT ON recommendation_profile, recommendation_query, build_candidate,
  build_component, recommendation_result, build_rejection TO morocco_pc_api;
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
       has_table_privilege('morocco_pc_api','build_component','DELETE'),    -- f
       has_table_privilege('morocco_pc_api','build_rejection','DELETE');    -- t
-- Decision 46: no ROW-WIDE update, but exactly three COLUMN-scoped ones.
SELECT has_table_privilege('morocco_pc_api','recommendation_query','UPDATE'),   -- f
       has_table_privilege('morocco_pc_api','recommendation_result','UPDATE');  -- f
SELECT has_column_privilege('morocco_pc_api','recommendation_query','budget_floor','UPDATE'),     -- t
       has_column_privilege('morocco_pc_api','recommendation_result','engine_version','UPDATE'),  -- t
       has_column_privilege('morocco_pc_api','recommendation_result','strategy_key','UPDATE');    -- t
```

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

## Endpoints

All routes are under `/v1` and speak JSON.

| Method | Path | Limit | Purpose |
|---|---|---|---|
| GET | `/v1/health` | 120/min | Liveness + database reachability |
| GET | `/v1/meta/options` | 120/min | Accepted use cases, currencies, resolutions, priorities |
| POST | `/v1/recommendations` | 30/min | Run one full engine pass and persist it |
| GET | `/v1/recommendations/:id` | 120/min | Read a persisted recommendation |
| GET | `/v1/docs/json` | 120/min | OpenAPI 3.0 document |

Rate limits are per client IP and per route — a GET is cheap, a POST runs an
entire engine pass, so they must not share a budget. The request body limit is
**10 KB**.

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
| `resolution` | no | Advertised value. **Stored, not yet used in scoring.** |
| `priority` | no | Integer 1–5. **Stored, not yet used in scoring.** |

Unknown fields are **rejected**, not ignored (`additionalProperties: false` with
ajv `removeAdditional: false`), so a typo is a 422 rather than a silent default.

Status codes:

| Status | When |
|---|---|
| **201** | A recommendation was created **and produced at least one build**. |
| **200** | A valid recommendation that produced **zero builds** — an under-budget floor is a legitimate outcome, not an error. Also the status for `EMPTY_CANDIDATE_POOL`, which additionally carries `reason`. |
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
  "reason": null,
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

Each build also carries its own `engine_version` and `strategy_key`: which E4
archetype (Decision 41) nominated that rank. Both are read per result row, so two
ranks in one reply can legitimately carry different strategies.

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
| `resolutions`, `priorities` | Fixed lists. **Stored on the profile/query, not read by the engine.** |

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

**`resolution` and `priority` do not change results.** The engine does not read
`recommendation_query.resolution`, `recommendation_query.priority`, or
`recommendation_profile.default_resolution` (Decision 17.6 — `loadQueryInput`
does not even SELECT them). A frontend must not imply otherwise.

## Errors

One envelope for every non-2xx body:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": [ { "field": "use_case", "message": "must be equal to one of the allowed values" } ]
}
```

`INTERNAL_ERROR` returns a generic message plus `request_id` and **never** echoes
the underlying error, which can carry a SQL fragment or a host; the detail is
logged under that same request id. `NOT_FOUND` never reveals whether an id
merely looks wrong.

## Logging and the OpenAPI document

Structured JSON via pino, with a request id on every line. **Request bodies and
database URLs are never logged.** `ENGINE_VERSION` identifies the deploy.

`GET /v1/docs/json` serves the OpenAPI 3.0 document. Note the path: the
`exposeRoute` option was removed from `@fastify/swagger` v9 and the UI route
belongs to `@fastify/swagger-ui`, which is not a dependency here — so the
document is served by a two-line route of our own at `/v1/docs/json`.

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

- **`test:api:db` is wired but unverified in CI** until a `workflow_dispatch` run
  passes. Everything checkable locally is green.
- **CI pins Node 22 with no matrix.** The API suites were verified locally on
  Node 22 and on the default Node 24; only 22 runs in CI.
- **No pagination on `builds`.** The engine persists at most
  `TOP_N_PERSISTED` builds, so the list is bounded by construction.
- **No 202/polling path.** A POST is synchronous; measure before adding
  asynchronous job handling.
- **`resolution`/`priority` are accepted but inert** (see *Option vocabulary*).
- **The identity surface needs migration 020 wherever the API points.** `components[].name` is `COALESCE(product.display_name, product.name)` and `components[].slug` is `product.slug`; against a database below 020 those columns do not exist, the component read fails `42703`, and the request answers the generic `500 INTERNAL_ERROR`. Both databases are at 020 since 2026-10-15 (the shared catalog's 104 products all carry distinct CHECKed slugs and no `Seed `-prefixed `display_name`), so on either target the prefix is gone from served names and every component carries a slug.
- **`strategy_key` / `engine_version` are recorded but not yet consumed.** They are persisted and served; no client reads them back yet, and their golden-harness coverage (A10) is still owed (**OG-46** — OG-45 tracks the persistence itself, which is done wherever migration 019 is applied).
