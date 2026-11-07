# Homepage — real API staging smoke

**Date:** 2026-11-07
**Branch:** `feature/v2-design` @ `6357ad9` (closure baseline `0dff27b`)
**Result: BLOCKED — no staging API origin is configured.**

The independent homepage review ran against stubbed `/v1/**` responses, so nothing on the
homepage has been exercised against a real API. This record exists so that gap is a
recorded gate rather than an assumed pass.

## Missing inputs

1. **A staging API origin.** No environment variable, workflow or document in this
   repository names one. `apps/web-v2` holds only `.env.example`, whose
   `NEXT_PUBLIC_API_BASE_URL` and `API_BASE_URL` both default to `http://localhost:3000`.
   There is no `.env.local` and no deployed web-v2 environment.
2. **That origin's `ALLOWED_ORIGINS` entry for the browser origin under test**
   (`http://localhost:3220` for a local run, or the deployed frontend origin). The API
   answers only origins listed there, so an unlisted `Origin` produces a CORS failure that
   reads like a frontend defect.
3. **A statement that the chosen origin is not the shared-database demo.** The only API
   origins this repository names are the Free demo `https://morocco-pc.onrender.com`
   (Render, shared database, spins down after 15 idle minutes, still on the owner
   credential — R-05) and the EU host. Verifying against the demo would confirm the shared
   catalogue under another name, which is the substitution the closure brief forbids.

## Checks that remain unverified

- [ ] `GET /v1/meta/options` answers on the real API and `currencies` includes `MAD`
- [ ] `GET /v1/presets?use_case=&currency=` answers for `GAMING`, `OFFICE`, `WORKSTATION`
- [ ] one `GET /v1/recommendations/{id}` per returned `recommendation_id`
- [ ] the `catalog_version` of each preset ladder is the key its detail read uses
- [ ] each badge matches that card's `builds[0].price_status`, and none where `builds: []`
- [ ] CORS, environment configuration and frontend-to-API connectivity
- [ ] no recommendation `POST` on load or on finder interaction

## What is verified today, and what it does not cover

The Playwright suite stubs `/v1/**` and asserts the badge source, the empty and error
states, the finder narrowing and `never writes on load`. That is real coverage of the
homepage's own logic and **not** evidence about the API: no request above has ever left the
browser against a served origin.

## How this gate closes

Name the origin and its allowed browser origin, then rebuild — `NEXT_PUBLIC_API_BASE_URL`
is inlined at build time, so setting it only for `start` proves nothing — and confirm it in
the built assets before recording any result. Read the response
`Access-Control-Allow-Origin` before judging a data check, so a CORS rejection is never
reported as unreadable details.
