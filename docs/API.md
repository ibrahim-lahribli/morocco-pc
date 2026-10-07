# HTTP API — contract and operation

The HTTP surface over the recommendation engine. It lives in `apps/api/`, is
specified by **Decision 36**, and owns **no engine logic**: every route calls the
engine through its public barrels and reads or writes Layer 4 rows through one
repository module.

Status at 2026-10-07: **implemented and running against the TEST branch.** The
DB-free suite runs on every push/PR; the DB-backed suite is wired into the
recurring CI job and has been verified locally, but **not yet by a CI run**.

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
| `ENGINE_VERSION` | The value reported as `engine_version` / `served_by.engine_version`. Intended to be the git short SHA; defaults to `dev`. |
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

### POST and GET differ in exactly two fields

POST and GET present the response through the **same** function over the **same**
read: POST re-reads the rows it just committed instead of trusting the engine's
in-memory result. They therefore cannot drift on any persisted field — not by
discipline, but because there is only one code path.

Two fields have no column to read back and are **pass-only facts**:

| Field | POST | GET |
|---|---|---|
| `budget_floor` | the pass diagnostic | `null` |
| `engine_version` | the deploy that produced it | `null` |

`served_by.engine_version` is always populated and always names the deploy that
answered the request, on both verbs.

**Why:** `budget_floor` is computed inside the pass (Decision 27) and
`engine_version` has no column (OG-18). Persisting them needs a schema change —
proposed as **migration 019** (design only, no file written): an `engine_version`
column on `recommendation_result` and a query-level `budget_floor`. Until then,
neither GET nor the API ever recomputes a floor; a null means "not recorded",
never "zero".

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

`name` comes from `product.name` and `variant` from `product_variant.sku` (that
table has no name column) — read back from the persisted join, which is also why
POST and GET agree.

## Option vocabulary

`GET /v1/meta/options` returns `{ "value", "label" }` pairs with **French
labels** (the product is the Moroccan market).

| Dimension | Source |
|---|---|
| `use_cases` | **Only** the active scoring model's `configuration.gpu_required_use_cases`. Not a `DISTINCT` over submitted values, and not a second hardcoded list. |
| `currencies` | A fixed allow-list (`MAD`), not a `DISTINCT` over `store_offer`. Stage 1 matches currency by exact equality, so advertising an unpriceable currency would be a lie. |
| `resolutions`, `priorities` | Fixed lists. **Stored on the profile/query, not read by the engine.** |

The option list and the POST validator are owned by one module
(`apps/api/src/meta.js`) so they cannot drift: a value POST accepts is always
advertised, and vice versa. Both directions are pinned by
`apps/api/test/unit/meta-consistency.test.js`.

If the active scoring model cannot be read, `/v1/meta/options` answers **503** —
never an empty array, which would look like a valid form with no valid choice.

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
