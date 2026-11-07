# Homepage — real API staging smoke

**Date:** 2026-11-07
**Branch:** `feature/v2-design` @ `04e6f77` (closure baseline `0dff27b`)
**Staging API:** `morocco-pc-api-eu.onrender.com` (host only; no credentials)
**Result: FAIL — first failing check is CORS: the staging service sends no
`Access-Control-Allow-Origin`, so no browser read against it succeeded.**

This record replaces the earlier `BLOCKED — no staging API origin is configured` entry. The
origin, the allowed browser origin and the database attestation were supplied by the owner;
the run below is what came back. Everything here is read-only: no database write, no `POST`,
no deployment, no change to the staging service.

## 1. Inputs actually used

| Input                   | Value supplied                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging API origin      | `https://morocco-pc-api-eu.onrender.com` — https, host only, no path, no trailing slash                                                                                             |
| Browser origin for CORS | `http://localhost:3220` (the package's `dev`/`start` port)                                                                                                                          |
| Database identity       | **Owner attestation, not independently verified:** the EU Neon project on the `morocco_pc_api` role, not the shared development database, and not `https://morocco-pc.onrender.com` |

`GET /v1/health` deliberately exposes no database identity, so input 3 is recorded as an
attestation. The corroborating signal is `engine_version` (below): the shared demo answers
`dev`, this origin answers a build SHA.

## 2. API target — PASS

| Check            | Observed                                                            |
| ---------------- | ------------------------------------------------------------------- |
| `GET /v1/health` | **200** `{"status":"ok","db":"ok","engine_version":"d2de4fb"}`      |
| Response time    | **27.06 s** on the first call (Render cold start), 0.15–0.92 s warm |
| `status` / `db`  | `ok` / `ok`                                                         |
| `engine_version` | `d2de4fb` — non-`dev`                                               |
| Origin format    | valid: scheme + host, no path, no trailing slash                    |

## 3. CORS — FAIL (API-side blocker)

Origin sent: `http://localhost:3220`.

| Request                                                       | Status  | `Access-Control-Allow-Origin` |
| ------------------------------------------------------------- | ------- | ----------------------------- |
| `GET /v1/meta/options`                                        | 200     | **absent**                    |
| `GET /v1/presets?use_case=GAMING&currency=MAD`                | 200     | **absent**                    |
| `GET /v1/presets?use_case=OFFICE&currency=MAD`                | 200     | **absent**                    |
| `GET /v1/presets?use_case=WORKSTATION&currency=MAD`           | 200     | **absent**                    |
| `GET /v1/recommendations/{id}` (×3)                           | 200     | **absent**                    |
| `OPTIONS /v1/meta/options` (preflight: `GET`, `content-type`) | **404** | **absent**                    |
| Control: `GET` with `Origin: http://evil.example`             | 200     | absent                        |
| Control: `GET` with no `Origin`                               | 200     | absent                        |

No `access-control-*` header appears on any response, for any origin, and the preflight is
not answered at all. That is the empty-`ALLOWED_ORIGINS` case, not a near-miss list:
`parseOrigins()` yields `[]` and the CORS plugin is registered as `origin: false`, which
disables CORS entirely instead of reflecting origins. The browser therefore refuses to read
even a 200. This is a staging-service configuration finding, **not** a frontend defect, and
it is not worked around in the frontend.

**To close:** set `ALLOWED_ORIGINS=http://localhost:3220` on the staging service (it is
`sync: false` in `render.yaml`, so it is set in the provider's dashboard), restart it, then
re-run section 3 and the browser checks in section 5. This record becomes `PASS` only after
that header is observed and the browser path succeeds.

## 4. Frontend configuration — one real defect found and fixed

Configured in `apps/web-v2/.env.local` (gitignored via `.env.*`, never committed):

```dotenv
NEXT_PUBLIC_API_BASE_URL=https://morocco-pc-api-eu.onrender.com
API_BASE_URL=https://morocco-pc-api-eu.onrender.com
```

`npm run build` exited 0 and reported `Environments: .env.local`, but the first bundle check
found **zero** occurrences of the staging host and one `http://localhost:3000`.

**Root cause.** `resolveBrowserApiBaseUrl()` defaulted `env` to the whole `process.env`
object and read `env.NEXT_PUBLIC_API_BASE_URL` dynamically. Next rewrites only a literal
`process.env.NEXT_PUBLIC_*` member access; in the browser `process.env` is an empty shim, so
the value was `undefined` and every client silently fell back to `http://localhost:3000`.
Reproduced in the browser before fixing: all four homepage fetches went to
`http://localhost:3000/...` and failed with `net::ERR_CONNECTION_REFUSED`.

**Fix** — `apps/web-v2/lib/api/config.ts`, +19/−1, commit `04e6f77`: hoist
`const INLINED_PUBLIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL` and make it the
resolver's default. Injected-env callers and the server resolver are unchanged.

After the rebuild: staging host **1** occurrence in `.next/static`, shared-demo host **0**,
and the browser requested `https://morocco-pc-api-eu.onrender.com/v1/...`.

## 5. Browser checks

Run twice: once against the real service (CORS active), and once through a **diagnostic**
local relay that only added the missing header, so the client's data handling could be
exercised on real staged payloads. The relay lived in gitignored `.next/`, forwarded `GET`
only (it answered `405` to anything else — zero refused, so zero writes), and was deleted
afterwards. It is not a fix and does not turn this record into a pass.

| Check                                          | French                                                                    | Arabic                                          | Result                               |
| ---------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| Homepage renders, no fatal runtime error       | yes                                                                       | yes                                             | PASS                                 |
| Requests target the staging host, not the demo | `meta/options` + 3 `presets` + 3 `recommendations/{id}`                   | same                                            | PASS (target)                        |
| Presets load                                   | blocked by CORS; loads through the relay                                  | same                                            | **FAIL at staging** / PASS via relay |
| Build details load                             | 3 × 200 (8.0 KB, 8.0 KB, 7.3 KB via relay)                                | same                                            | **FAIL at staging** / PASS via relay |
| Loading and error states behave honestly       | `Les configurations n'ont pas pu être chargées` + retry, no invented data | Arabic equivalent                               | PASS                                 |
| Badge matches `builds[0].price_status`         | `Prix indicatif` for `indicative`                                         | `سعر إرشادي`                                    | PASS via relay                       |
| RTL and layout                                 | `dir=ltr`                                                                 | `dir=rtl`, `lang=ar`, horizontal overflow **0** | PASS                                 |

Endpoints observed in the failing pass: `GET /v1/meta/options` (×2),
`GET /v1/presets?use_case=GAMING|OFFICE|WORKSTATION&currency=MAD` (×2 each), all
`net::ERR_FAILED` with `No 'Access-Control-Allow-Origin' header is present`. In the relay
pass the same seven reads answered 200. **Zero `POST` requests in either pass**;
`NEXT_PUBLIC_HOMEPAGE_SUBMIT` stays off.

The first card renders as `featured` and carries spec pills; cards 2–3 are the `compact`
variant, so a shorter card text is the approved design, not missing data.

## 6. Response compatibility — PASS, no contract change

Checked against the committed OpenAPI snapshot and the generated `lib/api/schema.d.ts`:

- `meta/options`: `use_cases` GAMING/OFFICE/WORKSTATION, `currencies` MAD only,
  `resolutions` 1080p/1440p/2160p, `priorities` 1–5.
- Presets: exactly `budget_amount`, `recommendation_id`, `build_score`, `price_status`
  (17 / 18 / 17 rows). A preset carries no builds — it is a pointer, as documented.
- Detail: `catalog_version` on every read equals the ladder's
  `e9997010de60e49634396970f6b23557`; `served_by.engine_version` `d2de4fb`; top-level
  `engine_version` `generate-presets` (the generating job, as designed).
- Rendered answers: GAMING 11 946 MAD / 56.88, OFFICE 9 247 MAD / 63.47,
  WORKSTATION 11 995 MAD / 57.47, all `price_status: indicative`, all on the 12 000 DH tier.
- Components carry `role`, `product_id`, `name`, `slug`, `variant`, `price_used`,
  `offer_class`, `store_offer_id` — the fields the pills and price read.

No field was coerced, no generated type was edited.

## 7. Regression suite — all green

| Command                   | Exit | Outcome                                          |
| ------------------------- | ---- | ------------------------------------------------ |
| `npm run build`           | 0    | compiled, 6/6 pages                              |
| `npm run typecheck`       | 0    | clean                                            |
| `npm run lint`            | 0    | clean                                            |
| `npm run format:check`    | 0    | Prettier-clean                                   |
| `npm run check:api-types` | 0    | `schema.d.ts` matches `openapi-v1.10.json`       |
| `npm test`                | 0    | 98 passed                                        |
| `npm run test:e2e`        | 0    | 22 passed (mocked; proves the mocked suite only) |

## 8. Unverified until CORS is fixed

- [x] `GET /v1/meta/options` answers and `currencies` includes `MAD` — via direct request
- [x] `GET /v1/presets?use_case=&currency=` answers for all three use cases — via direct request
- [x] one `GET /v1/recommendations/{id}` per selected `recommendation_id` — via direct request
- [x] `catalog_version` agrees between ladder and detail — verified
- [x] each badge matches `builds[0].price_status`, none where `builds` is empty — via relay
- [ ] **an ordinary browser reads the staging API without a relay** — blocked by section 3
- [ ] the 429 / rate-limit path against a real origin — not exercised
- [ ] database identity beyond the owner's attestation — not observable over HTTP

The mocked Playwright suite is not evidence about the API: it stubs `/v1/**`. Nothing in this
record is a claim that the staging integration passes; the local checks pass and the browser
path is blocked by the service's CORS configuration.
