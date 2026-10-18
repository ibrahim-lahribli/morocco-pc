# PLATFORM PLAN — P2: the API surface (vocabulary, proxy truth, catalog, contract)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** finish the API surface the M3 exit criterion calls "contract v1.1 live" — a vocabulary that comes from the active model, per-IP limits that are true behind a proxy, catalog endpoints a frontend can build on, and a contract document that a test proves complete.

**Architecture:** everything here is an edge change. `apps/api/src/engine.js` is the ONLY module allowed to require `src/recommendation/**` (enforced by `import-boundary.test.js`), and no file under `src/` may be modified by this plan. New SQL lives in `apps/api/src/repository.js`, which is the API's single owner of statements; new routes are thin and get their collaborators by decoration.

**Tech Stack:** Fastify 4, `@fastify/rate-limit`, `@fastify/swagger`, `@sinclair/typebox`, `pg` raw SQL, Node 22 (the version both CI jobs pin).

**Spec:** this file; the P2 section of the M3 roadmap; `docs/API.md` (the contract, which this plan extends rather than replaces); Decision 36 in `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (items 7, 9, 10, 11 and 13 are the constraints this plan works inside); **OG-38** (the vocabulary swap) and **OG-52** (the P2 carryover) in `docs/OPEN_GAPS.md`.

**Date:** 2026-10-15 · **Branch:** `agent/platforms` · **Decision id:** only Sprint 5 needs a decision entry (the catalog read contract); take the next free number from the log's tail at write time.

**Contract version note.** The live contract is **v1.5** (`apps/api/test/unit/openapi-v1.5.json`; the v1.1-v1.4 snapshots were superseded and deleted rather than kept — P1 Sprints 5-6 and P2 Sprint 3 landed in that order). Never commit two snapshots and never leave a superseded one in the tree.

**Program rules:** the Global Constraints, the run-safely protocol and the self-review protocol this plan works inside live once, for P0–P3, in [PLAN_PLATFORM_CONSTRAINTS.md](PLAN_PLATFORM_CONSTRAINTS.md). This plan adds only what is specific to it, and its self-review verdict is recorded there.

## Review Focus

Five failure modes this plan's own tests do not fully cover, most likely first.

1. **A trusted `X-Forwarded-For` that is spoofable.** Turning `trustProxy` on without NAMING the trusted proxy lets any caller set their own IP and bypass every per-IP limit. Measured 2026-10-17: a hop count is not a safe shorthand (fastify@5.12 disables it), and `true` is exactly this failure — it trusts a client-written prefix. Owning sprint: Sprint 2.
2. **An OFFICE request that 422s only because no model declares it.** The vocabulary swap is observable ONLY with a profiles-declaring model active. ~~today neither database has one~~ **Measured 2026-10-15: the SHARED database still has only `seed-minimal-v1` (so the swap is inert there), but the TEST branch had NO `launch-v2` row at all; seed 013 was re-applied there, so the swap IS observable on the branch now. Closing this for real means activating a profiles-declaring model on the database the API serves.** Owning sprint: Sprint 1.
3. **A catalog page that shows a seed price as if it were real.** The beta waiver keeps unverified seed offers in play; exposing prices on a public page without the class and the disclaimer makes indicative data look confirmed. Owning sprint: Sprint 3.
4. **A cursor that skips or repeats rows.** Any keyset pagination over a table whose order is not unique (product names are not unique — there is no unique constraint on `product.name`) can drop or duplicate a product page. Owning sprint: Sprint 3.
5. **A 429 with no `Retry-After`**, which clients and proxies treat as a permanent failure rather than a wait. Owning sprint: Sprint 4.

---

## Sprint 1 — the use-case vocabulary comes from the model (OG-38) (~60 min)

**Summary.** `apps/api/src/meta.js` derives the accepted `use_case` vocabulary from `configuration.gpu_required_use_cases` — the same list that makes the GPU mandatory — so OFFICE is rejected 422 even when a model declares it with `gpu_policy: IGPU_ALLOWED`. Swap the source to the scoring barrel's `listUseCases(configuration)`.

**Why now.** Decision 37 built `listUseCases` for exactly this and the API never used it; per `docs/RECOMMENDATION_ENGINE_DECISIONS.md`, the decoupling is only observable once seed 013 is active.

**Files:**
- Modify: `apps/api/src/meta.js` (the vocabulary source only)
- Modify: `apps/api/src/engine.js` if the active model's `configuration` is not already available to `meta.js` (it must be — the API resolves the active model, Decision 36 item 9)
- Test: `apps/api/test/unit/meta.test.js` (create if absent) and `apps/api/test/unit/contract.test.js`
- Modify: `docs/API.md` (the option vocabulary section), `docs/briefs/requests.md` (this request is closed by it)

**Interfaces:**
- Consumes: `listUseCases(configuration)` from `src/recommendation/scoring`'s barrel — returns a frozen `string[]`: the `use_case_profiles` keys when present, otherwise `gpu_required_use_cases` (the legacy fallback), and throws `INVALID_INPUT` / field `configuration` when neither exists.
- Produces: the same `{ value, label }` pairs `GET /v1/meta/options` serves today, with French labels; the POST validator accepts exactly the values it advertises, because both come from one list.

- [x] **Step 1: write the failing tests.** With a stubbed active model carrying `use_case_profiles` for `{GAMING, OFFICE, WORKSTATION}` and `gpu_required_use_cases: ['GAMING','WORKSTATION']`, assert `GET /v1/meta/options` advertises all three and that `POST /v1/recommendations` with `use_case: "OFFICE"` is **not** a 422 at the vocabulary gate. With the legacy model (`seed-minimal-v1`), assert the vocabulary is exactly `{GAMING, WORKSTATION}` — byte-identical to today. Run: `npm run test:api`. Expected: FAIL on the OFFICE case.
- [x] **Step 2: implement the swap** — one source for the list, and the validator reading the same array so the two cannot drift.
- [x] **Step 3: prove the fallback is inert.** `npm run test:api` 0 fail, and `npm run test:api:db` 1/0 against the branch, where `seed-minimal-v1` is the only active model: the served vocabulary must be unchanged.
- [x] **Step 4: apply seed 013 to the branch to make OFFICE observable** (`database/seeds/013_scoring_model_launch_v2.sql`, branch-first through an explicit target — `run-seeds.js` ignores `--test-db` and routes nothing). Re-run `test:api:db`; the DB suite must now advertise OFFICE. Then the onboarding caveat: **`launch-v2` is ACTIVE on neither database as of 2026-10-15** (measured), so without this step the swap changes nothing observable anywhere.
- [x] **Step 5: update `docs/API.md`'s vocabulary section and `docs/briefs/requests.md`, then commit.**

**Definition of done**
- The advertised vocabulary and the POST validator both come from `listUseCases(activeModel.configuration)`; no `gpu_required_use_cases` read remains in `meta.js`.
- With `launch-v2` active, OFFICE is advertised and accepted at the gate; with `seed-minimal-v1` active, the response is unchanged.
- `test:api` 0 fail; `test:api:db` 1/0 with residue 0; `docs/API.md` matches the behaviour.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 1.1 | Profiles-declaring model (stub) | `{GAMING, OFFICE, WORKSTATION}` advertised, OFFICE accepted |
| 1.2 | Legacy model (stub + branch) | `{GAMING, WORKSTATION}`, byte-identical to pre-change |
| 1.3 | A model with neither key | `INVALID_INPUT` / `configuration` surfaces as a 503-class failure, not a silent empty list |
| 1.4 | A value not in the advertised list | still 422 with per-field `details` |
| 1.5 | `GET /v1/meta/options` under `launch-v2` on the branch | OFFICE present with its French label |

**Status 2026-10-15 — DONE, with one shape change and one measurement worth keeping.**

The derivation went into `apps/api/src/engine.js` (`useCaseVocabulary`), not into
`meta.js`: `import-boundary.test.js` pins the engine as reachable from exactly ONE
module under `apps/api/src` and pins `engine.js` to an exact barrel list, so a
direct `require` of the scoring barrel from `meta.js` is not implementable. The
observable acceptance is unchanged, and the barrellist pin went 2 -> 3 on purpose.

**Step 3 was proved at unit level, not by a branch run, and the difference is
recorded rather than glossed.** The branch suite now runs against `launch-v2`
(measured: `GET` serves GAMING / OFFICE / WORKSTATION; `POST` OFFICE@20000 -> 201
with one build; `POST` STREAMING -> 422 naming the declared vocabulary and writing
zero rows). The legacy side is pinned by the unit suite through the real routes
with a legacy model row (`ACTIVE_MODEL`), plus the pre-apply branch measurement
that the same `listUseCases` call returned `["GAMING","WORKSTATION"]` while v1 was
the only active row. Re-measuring legacy through the branch would require
deactivating `launch-v2` again, which is not worth doing.

**Unplanned finding, now recorded in `DEVELOPMENT_NOTES.md`:** seed 013 was not
merely unapplied on the branch - the branch had NO `launch-v2` row at all, while
OG-43, OG-44, OG-49 and CONTEXT 7f all describe the branch as the place where
`launch-v2` IS active. Re-applying it also restores the documented harness
workflow: the default pin `seed-minimal-v1@1.0.0` now fails closed on the branch,
so comparison harnesses there need `--model=launch-v2@1.0.0`.

---

## Sprint 2 — truthful per-IP limits behind a proxy (`trustProxy`) (~60 min)

**Summary.** Configure Fastify's `trustProxy` from the environment and PROVE it, so the rate limiter keys on the real client IP instead of collapsing every user behind the platform's proxy into one bucket. The interface became a trusted-proxy ADDRESS list rather than a hop count - Step 2 records why, measured.

**Why now.** Verified 2026-10-15: `trustProxy` appears **nowhere** in `apps/`, `src/` or `docs/API.md` — only in the plan and the gap register as an open item. On Fly.io or Render the app always sits behind a proxy, so today 30 POST/min is 30/min for the entire internet.

**Files:**
- Modify: `apps/api/src/app.js` (`buildApp` gains `trustProxy`; `parseTrustProxy` owns the env contract, and the parsed list is passed to the Fastify factory)
- No change: `apps/api/src/server.js` — `buildApp` reads `env.TRUST_PROXY` itself, exactly as it reads `ALLOWED_ORIGINS`, and `start()` already passes the whole env through. A second reader would be two owners for one setting.
- Modify: `apps/api/.env.example` (document `TRUST_PROXY`, default off)
- Test: `apps/api/test/unit/rate-limit.test.js` (the bucket consequences) and `apps/api/test/unit/trust-proxy.test.js` (the config contract; the plan named `app.test.js`, which does not exist)
- Modify: `docs/API.md` (the Operational limits paragraph)

**Interfaces:**
- Consumes: `buildApp({ pool, repository, engine, env, logger })` — gains an optional `trustProxy` (a trusted proxy address/CIDR list, or `false`); otherwise `env.TRUST_PROXY` is parsed.
- Produces: `TRUST_PROXY=<addr[,addr...]|false>` (default `false`); `request.ip` is the client IP once the proxy peer is trusted.

- [x] **Step 1: write the failing tests.** Two `inject` calls carrying different `X-Forwarded-For` values must occupy separate rate-limit buckets once the proxy is trusted, and must share one bucket when it is not. Run: `npm run test:api`. **Measured:** FAIL first (the trusted case shared a bucket because nothing was configured), then PASS after Step 2 — the suite went from **75 to 89** tests.
- [x] **Step 2: implement** — pass the trusted-proxy list to the Fastify factory, defaulting to `false` so nothing changes for a directly reachable process. **Measured 2026-10-17, and the plan was WRONG about the interface:** `fastify@5.12.5`'s `getTrustProxyFn` returns `() => false` for a NUMERIC `trustProxy` ("Hop-count-only trust is disabled because it cannot validate the immediate peer..."), so `trustProxy: 1` leaves `request.ip` at the socket address. Verified directly: `false` → `127.0.0.1` for a single and a chained header; `1` → `127.0.0.1` both times; `'127.0.0.1'` → `203.0.113.9` both times (the appended entry wins); `true` → `192.0.2.55`, i.e. a CLIENT-WRITTEN prefix mints the bucket. So `TRUST_PROXY` takes proxy-addr's address/CIDR/range list, and a hop count or `true` is REFUSED at startup with a message naming the supported form. Naming the proxy is also the only form that satisfies the DoD's spoofing half.
- [x] **Step 3: pin the value for the chosen host.** No host is chosen yet (P1 Sprint 1 is owner-gated), so what is recorded is the rule and the candidate shapes, not an invented address: `TRUST_PROXY=127.0.0.1` for a same-host reverse proxy (the shape the tests pin) and the proxy's CIDR for a private-network hop. `docs/API.md` states both, and `DEVELOPMENT_NOTES.md` (2026-10-17) records the Fastify finding so nobody rediscovers it. The concrete value is pinned by Step 4's evidence on the deployed origin.
- [ ] **Step 4: re-run the exact per-IP behaviour on the deployed host** once P1's deployment exists: two requests from the same client keep one bucket; a spoofed header does not create a new one. Record both results, and record the pinned `TRUST_PROXY` value with them.

  **Procedure: `docs/RECIPES/deploy-eu-colocation.md` §8.4**, run in the same sitting as P1 Sprint 1's deploy. The instrument is the log line Fastify already prints: `fastify@5.12.5`'s pino serializer sets `remoteAddress: req.ip`, so `fly logs` shows the TRUST-RESOLVED address - the proxy's while `TRUST_PROXY` is empty, the caller's once the proxy is named. The section reads the proxy's private address from that log, pins the socket peer and every address `fly ips list` printed in `fly.toml`, re-checks that the same field now reports the caller's public IP, then proves the buckets: 31 POSTs with a different forged `X-Forwarded-For` each all land in one bucket (429 on the 31st), and two real clients (one on mobile data) each report `x-ratelimit-remaining: 29` inside one window. A wrong or disabled pin fails the log check; the spoof battery alone cannot tell them apart, which is why both are recorded. The pre-pin checks are a committed script now: `node scripts/check-origin-readiness.js --app=<name> --origin=<url>` (exit 0 pass, 1 assertion failure, 2 usage) asserts that `fly ips list` returns an address and that `GET /v1/health` answers 2xx with `db: "ok"`, so the gate is executable and its parsing and exit codes are pinned by `test:scripts`.
- [x] **Step 5: commit.** Committed as `aab917f` (2026-10-17).

**Definition of done**
- `trustProxy` is configurable, defaults to `false`, and the default is proven to ignore `X-Forwarded-For`.
- With the proxy trusted, distinct forwarded addresses get distinct buckets and a spoofed header cannot mint one — and the unsafe shapes (a hop count, `true`) are REFUSED rather than silently accepted.
- `docs/API.md` states the limit, the unit (per IP), the in-process caveat (limits do not survive a multi-instance deploy) and that the trusted value is a per-host fact, naming the `127.0.0.1` shape a same-host proxy uses.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 2.1 | `TRUST_PROXY` unset, two different `X-Forwarded-For` | shared bucket → the 31st request is 429 |
| 2.2 | `TRUST_PROXY=127.0.0.1`, two different `X-Forwarded-For` | separate buckets → neither 429s early |
| 2.3 | `TRUST_PROXY=127.0.0.1`, a client-written prefix in the chain | the address the proxy appended is the client: the prefix cannot mint a bucket |
| 2.4 | GET limit (120/min) vs POST limit (30/min) | unchanged: the two do not share a budget |
| 2.5 | Deployed origin, two clients | separate buckets (recorded evidence, not asserted in CI) |

**Steps 1–3 MEASURED GREEN 2026-10-17.** `npm run test:api` **89 pass / 0 fail** (75 before:
3 new bucket tests in `rate-limit.test.js` and 11 config tests in `trust-proxy.test.js`). The
default is proven inert - alternating two `X-Forwarded-For` values still spends ONE 30/min
bucket - a trusted peer is proven to separate them, and a client-written prefix is proven unable
to mint one; those are the same assertions a `trustProxy: true` configuration would fail. Step 4
still needs P1's deployed host - procedure in the EU runbook `docs/RECIPES/deploy-eu-colocation.md`
§8.4 - and Step 5 landed as `aab917f`.
Recorded as **Decision 49**, which also qualifies Decision 36 item 11 (the per-IP
limit is conditional on the proxy being named).

---

## Sprint 3 — catalog endpoints (read-only) (~120 min)

**Summary.** Add the two read endpoints a storefront needs: a paginated product list and a product detail by `slug` — the column migration 020 added and backfilled for exactly this.

**Why now.** `slug` and `display_name` landed in 020 and are on BOTH databases; nothing serves them except as component names inside a recommendation.

**Files:**
- Create: `apps/api/src/routes/catalog.js`, `apps/api/src/contracts/catalog.js`
- Modify: `apps/api/src/repository.js` (the two read statements), `apps/api/src/app.js` (register), `apps/api/src/contracts/index.js`
- Create: `apps/api/test/unit/catalog.test.js` and `apps/api/test/db/catalog.db.test.js` (READ-ONLY: real rows on the branch, no write suites touched)
- Create: `apps/api/test/unit/openapi-v1.5.json` (see the version note — v1.4 is taken by P1 Sprint 6) — delete the superseded snapshot in the same commit
- Modify: `docs/API.md`, `docs/TEST_MAP.md`, `CONTEXT.md`

**Interfaces:**
- Produces: `GET /v1/catalog/products?use_case=&role=&limit=&cursor=` → `{ products: [{ slug, display_name, category, from_price, offer_class, has_offer }], next_cursor }`; `GET /v1/catalog/products/:slug` → `{ slug, display_name, category, specs: {...}, offers: [{ price, offer_class, currency }], price_status, disclaimer }`. Both read-only, rate-limited like the other GETs (120/min).
- Consumes: `product.slug` / `display_name` (migration 020), the spec tables, `store_offer.price` / `offer_class`.

- [x] **Step 1: write the failing route tests** (DB-free, stubbed repository): a list returns the advertised shape; an unknown slug is a 404 with the standard envelope; `limit=0` and `limit=1000` are 422s; a product with no offer reports `has_offer: false` and a null `from_price` rather than being filtered out silently.
- [x] **Step 2: implement the reads in `repository.js`** — keyset pagination on `(slug)` (unique since 020's `uq_product_slug`), never `OFFSET`; `from_price` is the lowest offer price for the product, and **`offer_class` travels with it**.
- [x] **Step 3: implement the routes** with TypeBox schemas for both responses.
- [x] **Step 4: apply the pricing rule in the response** — `price_status` derived exactly as the recommendation response derives it (`"verified"` only when every contributing offer is `VERIFIED`), with the French `disclaimer`; the seed data will therefore report `indicative`, which is correct and must not be special-cased.
- [x] **Step 5: pin the contract** — regenerate the snapshot, run `npm run test:api` (0 fail) and `npm run test:api:db` (a real read of a real slug on the branch, residue 0).
- [x] **Step 6: update `docs/API.md` + `docs/TEST_MAP.md` + `CONTEXT.md`, then commit.**
- [x] **Step 7 (owner): decide whether catalog pages may be public before any frontend is pointed at them** — DECIDED 2026-10-18: **public but unlisted.** The beta frontend may use the catalogue, but it is not linked from navigation and is `noindex` until prices are `VERIFIED`. That is a frontend/SEO posture, not an API gate: the API has no auth and CORS is not access control, so a genuinely gated catalogue would be new infrastructure. The same sitting decided the price-display policy - indicative prices are allowed WITH the French disclaimer and a beta label, with no store names or purchase CTA - recorded in `docs/API.md`.

**Definition of done**
- Both endpoints are served, documented, and pinned by the committed snapshot.
- Pagination is keyset-based on a unique column; a page boundary revisited returns the same rows.
- No response advertises a seed price as verified; the disclaimer is present.
- `test:api` 0 fail; `test:api:db` 1/0 with residue 0.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 3.1 | List, default limit | ≤ the advertised default, `next_cursor` present when more rows exist |
| 3.2 | Walk every page | the union equals the full set, with no duplicate and no missing slug |
| 3.3 | Detail for a real branch slug | specs + offers; `price_status: indicative`; disclaimer present |
| 3.4 | Unknown slug | 404, standard envelope, no SQL detail |
| 3.5 | A product with zero offers | present in the list with `has_offer: false` |
| 3.6 | `limit=1000` | 422 (bounded), not a slow query |

**Status 2026-10-18 — DONE, including the owner's Step 7 decision.** Steps 1-6 landed 2026-10-17. Step 7 was decided 2026-10-18: **public but unlisted** (served to the beta frontend, unlinked and `noindex` until prices are `VERIFIED`), with indicative prices allowed only behind the API's disclaimer and a beta label. Both are product/SEO postures, not API changes - no code moved, and no Decision entry was needed.

Both endpoints are served, documented and pinned by `openapi-v1.5.json` (v1.4 was
deleted in the same change, so exactly one snapshot remains). `test:api` went **89 -> 98**
(8 route tests in `apps/api/test/unit/catalog.test.js` plus one snapshot assertion), and
`test:api:db` is **9 pass / 0 fail** against the branch (5 read-only catalog tests in
`catalog.db.test.js`, beside the 4 pre-existing write tests). The page walk was measured against the live branch: **100
products** in ascending slug order, no duplicate and none missing; `role=GPU` returns
**21**; the seed catalog reports `price_status: "indicative"` on every page, which is the
correct reading and is not special-cased. Recorded as **Decision 50**.

**Two interface changes, each with its reason.** (1) `use_case` is NOT a parameter,
although this plan's sketch listed one: the active model has no per-use-case PRODUCT filter
(`role_weights` are global; only `gpu_policy` varies), so it could only be inert - and this
API refuses unknown query parameters rather than accepting a no-op. (2) The detail's
`specs` is an OPEN object rather than an enumerated one: its keys are the spec table's
columns, and enumerating them would make every spec migration a breaking API change. Both
are stated in `docs/API.md` and pinned by the snapshot test.

**What the implementation learned, worth keeping.** The spec tables have NO `id` column -
each is one-to-one with `product_id` or (for GPU) `product_variant_id` (migration 004), so
an `ORDER BY s.id` is a SQL error, not a tie-break. A GPU product has variant-level specs,
and one live GPU product has TWO variants (measured: 21 products, 22 variants), so the
detail serves the spec of the variant its cheapest offer priced - otherwise the page would
show one card's specs beside another's price. The DB suite is deliberately READ-ONLY (it
inserts nothing, so it has no residue to assert); the write suites own the residue checks,
and a whole-table comparison here would measure their parallel work.

The plan named `recommendations.db.test.js` as the DB target; the read-only catalog got its
own `apps/api/test/db/catalog.db.test.js` instead, which the runner's `*.db.test.js` glob
picks up and which keeps one behaviour in one file.
---

## Sprint 4 — CORS allow-list and the 429 contract, proven (~45 min)

**Summary.** CORS is already implemented (`ALLOWED_ORIGINS` → `parseOrigins`, and an empty value disables CORS entirely rather than reflecting any origin) and 429 is documented. What is missing is proof: a preflight test, and the `Retry-After` question answered rather than assumed.

**Files:**
- Test: `apps/api/test/unit/cors.test.js`, `apps/api/test/unit/rate-limit.test.js`
- Modify: `docs/API.md` (the CORS + 429 paragraphs), `apps/api/.env.example` (an example origin in the comment)

**Interfaces:** Consumes `parseOrigins(raw)` (already exported) and the per-route `config.rateLimit` objects. Produces: documented, tested behaviour; no new env var.

- [x] **Step 1: write the failing tests.** (a) With `ALLOWED_ORIGINS=https://example.ma`, a request with `Origin: https://example.ma` gets `Access-Control-Allow-Origin: https://example.ma` and a successful preflight; the same request with another origin gets **no** ACAO header. (b) With `ALLOWED_ORIGINS` empty, no ACAO header is sent for any origin. (c) Exceed the POST limit and assert the 429 body's shape **and whether a `Retry-After` header is present**.
- [x] **Step 2: implement whatever (c) shows is missing** — if the plugin does not send `Retry-After`, either configure it or document its absence explicitly in `docs/API.md`. Do not assert a header the server does not send.
- [x] **Step 3: document** the allow-list semantics (empty = disabled, not reflected), the limits, and the header/absence found in Step 2.
- [x] **Step 4: commit.**

**Measured 2026-10-17 — DONE.** CORS was already correct and is now PROVEN:
an allow-listed origin is echoed exactly (never `*`) with a successful preflight,
a disallowed origin gets no `Access-Control-Allow-Origin` while the request is
still served, an empty list grants nothing, and a comma-separated list trims and
admits exactly its entries (`apps/api/test/unit/cors.test.js`, 4 tests; the two
older CORS tests in `surface.test.js` moved here so one behaviour has one
owner). Step 2's measurement found `Retry-After: 60` PRESENT (seconds, the
one-minute window) plus `x-ratelimit-limit/remaining/reset`, so nothing needed
configuring — it needed stating. The 429 body is the standard envelope
`{error: RATE_LIMITED, message, request_id}`; `request_id` was ADDED so a limit
that fires correlates with the log like a 500, and `rate-limit.test.js` asserts
the body AND the header. `docs/API.md` records the contract and
`apps/api/.env.example` carries an example origin. `test:api` 75/0.

**Definition of done**

- The four CORS behaviours are pinned by tests.
- The 429 contract (body + any `Retry-After`) is stated in `docs/API.md` and matches the server.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 4.1 | Allowed origin | ACAO echoes the exact origin; preflight 204/200 |
| 4.2 | Disallowed origin | no ACAO header; the request itself is still served |
| 4.3 | Empty allow-list | no ACAO header for any origin |
| 4.4 | Over the POST limit | 429 with the standard envelope and `request_id` |
| 4.5 | `Retry-After` | present-and-asserted, or absent-and-documented — never assumed |

---

## Sprint 5 — the contract-completeness gate (~60 min)

**Summary.** Make the OpenAPI document a *checked* artifact rather than a snapshot: every served route must appear in the document, and every response must declare a schema, so an undocumented route or an untyped error cannot ship.

**Files:**
- Test: `apps/api/test/unit/openapi-coverage.test.js`
- Modify: `docs/API.md` (a line stating the document is a gate, not a description), `docs/TEST_MAP.md`
- Optional (owner decision): the Decision entry for the catalog read contract if Sprint 3 does not record one

**Interfaces:** Consumes `app.swagger()` (the document) and Fastify's route table. Produces: a test that fails when a route exists without a documented path or without a response schema.

- [x] **Step 1: write the failing test.** Enumerate every registered route (method + path, excluding GET `/v1/docs/json` itself by an explicit allow-list), and for each assert a matching `paths` entry with at least one response schema. Add a synthetic route in the test to prove the gate fires.
- [x] **Step 2: fill whatever the gate exposes** — most likely missing error-response schemas for 422/429/500.
- [x] **Step 3: run the suite** (`npm run test:api` 0 fail), regenerate the snapshot if a schema was added, and commit.

**Measured 2026-10-17 — DONE.** The gate found the real gap the plan predicted:
no route declared `429` or `500`. Both are now on all five documented routes
(`ErrorResponseSchema` each), and the snapshot was regenerated — same version
`1.4.0`, since only error documentation was added. The gate exempts exactly
HEAD (synthesized per GET), the CORS preflight wildcard `OPTIONS *`, and
`/v1/docs/json`, each with a stated reason, and asserts every exemption matches
a real route so a stale one cannot excuse anything. Synthetic cases prove the
gate FIRES on an undocumented route, an untyped response and a missing 429/500;
the real case compares the registered route table with `app.swagger()`.
`test:api` 75/0.

**Definition of done**

- The coverage test fails when a route is added without documentation (proven by the synthetic route).
- Every served route is documented with at least one response schema.
- The snapshot matches.

**Test scenarios**
| # | Scenario | Expected |
|---|---|---|
| 5.1 | Served routes vs document | one-to-one, no orphans |
| 5.2 | A route registered without a schema | the gate FAILS |
| 5.3 | Error responses | 422/429/500 declared, or their absence is explicitly justified |
| 5.4 | `/v1/docs/json` | still served and still excluded from its own coverage requirement |

---

## Definition of done (whole plan)

1. The use-case vocabulary comes from the active model; OFFICE is reachable with a profiles-declaring model and the legacy behaviour is byte-identical.
2. `trustProxy` is configurable, defaults off, and the trusted proxy address for the deployed host is pinned with evidence.
3. `GET /v1/catalog/products` and `/v1/catalog/products/:slug` serve documented, keyset-paginated, provenance-labelled data.
4. CORS and 429 behaviour are pinned by tests and stated in `docs/API.md`; no header is claimed that the server does not send.
5. The contract is one version with one committed snapshot, and a test proves every served route is documented.
6. No regression: `test:api` 0 fail, `test:api:db` 1/0 with residue 0, `test:unit` 0 fail, `verify:docs --offline` OK, `gen-decision-index --check` clean, and `import-boundary.test.js` green.
