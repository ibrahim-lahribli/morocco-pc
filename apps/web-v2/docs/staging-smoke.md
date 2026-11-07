# Homepage — real API staging smoke

**Date:** 2026-11-07 (re-run)
**Branch:** `feature/v2-design` @ `ef4f624` (inlining fix `04e6f77`)
**Staging API:** `morocco-pc-api-eu.onrender.com` (host only; no credentials)
**Result: PASS — the homepage reads the real EU staging API from an ordinary browser, in
both locales, with every check below measured on 2026-11-07 after the service's
`ALLOWED_ORIGINS` was updated.**

This record has three states, kept in order so nothing looks retroactive: `BLOCKED` (no
origin named), `FAIL — CORS` (origin supplied, service sent no `Access-Control-Allow-Origin`),
then this `PASS` after the owner added `http://localhost:3220` and restarted the service. The
run below was read-only: no database write, no `POST`, no deployment, no Render change.

## 1. Inputs actually used

| Input                   | Value                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging API origin      | `https://morocco-pc-api-eu.onrender.com` — https, host only, no path, no trailing slash                                                                                             |
| Browser origin for CORS | `http://localhost:3220` (the package's `dev`/`start` port)                                                                                                                          |
| Database identity       | **Owner attestation, not independently verified:** the EU Neon project on the `morocco_pc_api` role, not the shared development database, and not `https://morocco-pc.onrender.com` |

`GET /v1/health` deliberately exposes no database identity, so input 3 stays an attestation.
The corroborating signal is `engine_version`: the shared demo answers `dev`, this origin
answers a build SHA.

## 2. API target — PASS

| Check            | Observed                                                          |
| ---------------- | ----------------------------------------------------------------- |
| `GET /v1/health` | **200** `{"status":"ok","db":"ok","engine_version":"d2de4fb"}`    |
| Response time    | 0.53 s warm (27.06 s on the first cold call earlier the same day) |
| `status` / `db`  | `ok` / `ok`                                                       |
| `engine_version` | `d2de4fb` — non-`dev`, unchanged by the CORS deploy               |

## 3. CORS — PASS (was the blocker)

Origin sent: `http://localhost:3220`.

| Request                                                       | Status  | `Access-Control-Allow-Origin`                                                                         |
| ------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `GET /v1/meta/options`                                        | 200     | `http://localhost:3220` — **exact**, plus `expose-headers: Retry-After, X-Request-Id`, `vary: Origin` |
| `OPTIONS /v1/meta/options` (preflight: `GET`, `content-type`) | **204** | `http://localhost:3220`, `allow-methods: GET,HEAD,POST`, `allow-headers: content-type`                |
| Control: `GET` with `Origin: http://evil.example`             | 200     | **absent** (only `expose-headers`, which authorizes nothing)                                          |
| Control: `GET` with no `Origin`                               | 200     | **absent**                                                                                            |

The header value is byte-for-byte `http://localhost:3220` — no wildcard, no trailing slash, no
other origin reflected. A foreign origin still gets a body but no authorization header, so
the browser would refuse to read it; the list is enforcing, not merely present.

**History.** Before this update the same four requests returned 200 with **no**
`Access-Control-Allow-Origin`, the preflight returned **404**, and both controls were
identical to the matching origin — the empty-`ALLOWED_ORIGINS` case, where the CORS plugin is
registered as `origin: false` and disables CORS entirely. That is the FAIL this record
previously carried, and it was closed on the service side, not in the frontend.

## 4. Frontend configuration — one real defect found and fixed

Configured in `apps/web-v2/.env.local` (gitignored via `.env.*`, never committed):

```dotenv
NEXT_PUBLIC_API_BASE_URL=https://morocco-pc-api-eu.onrender.com
API_BASE_URL=https://morocco-pc-api-eu.onrender.com
```

**Root cause of the defect.** `resolveBrowserApiBaseUrl()` defaulted `env` to the whole
`process.env` object and read `env.NEXT_PUBLIC_API_BASE_URL` dynamically. Next rewrites only a
literal `process.env.NEXT_PUBLIC_*` member access; in the browser `process.env` is an empty
shim, so the value was `undefined` and every client silently fell back to
`http://localhost:3000`. Reproduced in the browser before fixing: all four homepage fetches
went to `http://localhost:3000/...` and failed with `net::ERR_CONNECTION_REFUSED`.

**Fix** — `apps/web-v2/lib/api/config.ts`, +19/−1, commit `04e6f77`: hoist
`const INLINED_PUBLIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL` and make it the
resolver's default. Injected-env callers and the server resolver are unchanged.

After the rebuild: staging host **1** occurrence in `.next/static`, shared-demo host **0**.

## 5. Browser checks — PASS, no relay

Ordinary Chromium against `http://localhost:3220`, dev server reading `.env.local`. No proxy,
no interception, no stubbed `/v1/**`. The diagnostic relay used in the earlier FAIL run is
gone and was not involved.

| Check                                    | French                                            | Arabic                               | Result |
| ---------------------------------------- | ------------------------------------------------- | ------------------------------------ | ------ |
| Homepage renders, no fatal runtime error | yes                                               | yes                                  | PASS   |
| Requests target the staging host         | 7 reads, all **200**                              | 7 reads, all **200**                 | PASS   |
| Presets load                             | `meta/options` + 3 × `presets`, 433–641 ms        | same                                 | PASS   |
| Build details load                       | 3 × `recommendations/{id}`, 903–1027 ms           | same                                 | PASS   |
| Badge matches `builds[0].price_status`   | `Prix indicatif` for `indicative`                 | `سعر إرشادي`                         | PASS   |
| Real data, not fixtures                  | 11 946 / 56.88, 9 247 / 63.47, 11 995 / 57.47 MAD | same values                          | PASS   |
| Console errors                           | none (React DevTools info + HMR only)             | none                                 | PASS   |
| RTL and layout                           | `dir=ltr`                                         | `dir=rtl`, `lang=ar`, overflow **0** | PASS   |
| Writes                                   | 0 `POST`                                          | 0 `POST`                             | PASS   |

Endpoint reads per locale: `GET /v1/meta/options`, `GET /v1/presets?use_case=GAMING|OFFICE|WORKSTATION&currency=MAD`,
then `GET /v1/recommendations/366d0fae…` (Gaming), `…/20417fa9…` (Office),
`…/3b157941…` (Workstation) — the ids the 12 000 DH selection rule picks.
`NEXT_PUBLIC_HOMEPAGE_SUBMIT` stays off, so the finder issues no request.

The first card renders as `featured` with four spec pills; cards 2–3 are the approved
`compact` variant, so their shorter text is design, not missing data.

## 6. Response compatibility — PASS, no contract change

Checked against the committed OpenAPI snapshot and the generated `lib/api/schema.d.ts`:

- `meta/options`: `use_cases` GAMING/OFFICE/WORKSTATION, `currencies` MAD only,
  `resolutions` 1080p/1440p/2160p, `priorities` 1–5.
- Presets: exactly `budget_amount`, `recommendation_id`, `build_score`, `price_status`
  (17 / 18 / 17 rows). A preset carries no builds — it is a pointer, as documented.
- Detail: `catalog_version` equals the ladder's `e9997010de60e49634396970f6b23557` on every
  read; `served_by.engine_version` `d2de4fb`; top-level `engine_version` `generate-presets`
  (the generating job, as designed).
- Components carry `role`, `product_id`, `name`, `slug`, `variant`, `price_used`,
  `offer_class`, `store_offer_id` — the fields the pills and the price read.

No field was coerced, no generated type was edited.

## 7. Regression suite — all green

| Command                   | Exit | Outcome                                          |
| ------------------------- | ---- | ------------------------------------------------ |
| `npm run typecheck`       | 0    | clean                                            |
| `npm run lint`            | 0    | clean                                            |
| `npm run format:check`    | 0    | Prettier-clean                                   |
| `npm run check:api-types` | 0    | `schema.d.ts` matches `openapi-v1.10.json`       |
| `npm test`                | 0    | 98 passed, 18 files                              |
| `npm run test:e2e`        | 0    | 22 passed (mocked; proves the mocked suite only) |

## 8. Coverage and what it still does not claim

- [x] `GET /v1/meta/options` answers and `currencies` includes `MAD`
- [x] `GET /v1/presets?use_case=&currency=` answers for all three use cases
- [x] one `GET /v1/recommendations/{id}` per selected `recommendation_id`
- [x] `catalog_version` agrees between ladder and detail
- [x] each badge matches `builds[0].price_status`, none where `builds` is empty
- [x] an ordinary browser reads the staging API, in French and Arabic, with no relay
- [x] no `POST` on load or on finder interaction
- [ ] the 429 / rate-limit path against a real origin — not exercised
- [ ] database identity beyond the owner's attestation — not observable over HTTP

The mocked Playwright suite is not evidence about the API: it stubs `/v1/**`. This PASS covers
the homepage's read path against the EU staging origin; it says nothing about the results
page, the finder's write path, or the shared demo.
