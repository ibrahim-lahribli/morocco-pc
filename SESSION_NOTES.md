# Session notes — this worktree

A handoff, not documentation: dated, worktree-scoped, safe to delete once nothing
here is news. The branch carries an in-progress frontend review thread; this file
summarizes what landed and (more importantly for the next session) how the local
stack is meant to be launched for the wizard to work.

## Branch and commits from this thread

Branch: `freebuff/review-web-design-guidelines-frontend-design-revie-986b2329-a036-4cb2-8014-5eac64da643d`
(A(gen) interactive local worktree of `master`.)

- `3446e81` — Land the `/composants` catalog index route (`apps/web/app/[locale]/composants/page.tsx`),
  a `catalogListing` loader in `apps/web/lib/catalog/load.ts`, three specs in
  `apps/web/e2e/catalog.spec.ts`, and the `catalog.index` copy in
  `apps/web/messages/{fr,ar}.json`. The bare `/fr` prefix now answers with a
  listing instead of the catch-all 404.
- `ceb911a` — Two web-design-guidelines fixes on that page, both live-proven:
  `break-words` on the row links (an unbroken 60-char vendor SKU forced 634 px of
  horizontal scroll on a 312 px viewport) and `py-2`→`py-3` so the row hit area
  reaches the 44 px tap floor; the spec file gained assertions at 360 px pinning both.

All other files in the first two commits were reviewed against the Vercel Web
Interface Guidelines and passed: semantics/focus/hover/RTL/Arabic (`dir=rtl`,
IBM Plex Sans Arabic, `dir="auto"` product names) all verified in the live pages.
The suite measured 10/10 catalog specs on a fresh build, plus green
`typecheck`/`lint`/`check:tokens`/`check:i18n` under `apps/web`.

## Running the full stack locally (the part the next session will need)

The wizard needs a real API — the usage/budget/resolution/priority options come
from `GET /v1/meta/options`, and a submit runs the engine. As of the last session
the API has NOT been deployed anywhere; locally it is started manually:

```bash
# 1. engine API on :3000 (root of the repo)
npm ci                                  # first time only
ALLOWED_ORIGINS=http://localhost:3210 npm run start:api
# refuses to start unless TEST_DATABASE_URL differs from DATABASE_URL (root .env)
# curl http://localhost:3000/v1/health?probe=preflight -> {"status":"ok","db":"ok"}

# 2. web app on :3210
cd apps/web
API_BASE_URL=http://localhost:3000 npm run start   # next start -p 3210

# optional fixture mock on :3211 (zero-dependency, no DB needed)
MOCK_API_PORT=3211 npm run mock:api
```

### The trap that cost this session an hour

The web app has TWO API base URLs, and they are set differently on purpose:

- **Browser-side fetches** (the wizard's options/submit) use
  `NEXT_PUBLIC_API_BASE_URL` — inlined at BUILD time, default `http://localhost:3000`.
- **Server-side fetches** (the results page `GET /v1/recommendations/:id`,
  presets, catalog) read `API_BASE_URL` at request time — NOT `NEXT_PUBLIC_*`.

The symptom when `API_BASE_URL` points at the fixture mock (`:3211`): the wizard
POSTs to the REAL API, the engine commits a real pass, the browser navigates to
`/fr/config/<real-id>`… and the results page answers a styled "Page introuvable"
404, because the mock does not know real pass ids. The API log shows a 200/201
POST and no GET at all. Fix: start the web server with
`API_BASE_URL=http://localhost:3000` when the real API is up.

Useful probes while debugging: `GET /v1/meta/options` (catalog vocabulary),
`OPTIONS /v1/meta/options -H "Origin: http://localhost:3210"` (CORS preflight),
`GET /v1/recommendations/<id>` on BOTH 3000 and 3211 to see which service 404s.

### Writes are safe, but test-branch only

Every wizard submit writes to the isolated Neon TEST branch (`TEST_DATABASE_URL`
from the root `.env`), never the shared dev DB — that is the intended surface for
this kind of testing. PORTS in use at the end of the last session: 3210 web,
3211 mock, 3000 API.

## Known limitations / next ideas (deliberately not done)

- `text-wrap: balance` on headings is absent house-wide (guidelines
  typography group) — a follow-up polish, not this page's defect.
- The catalog index would want `content-visibility: auto` if/when the listing
  grows past ~50 products; today's render is small.
- Footer inline links are 17 px by design (shared footer lists) — the 44 px rule
  is scoped to `main` in the catalog spec for a reason; do not "fix" the footer.
- `apps/*.pid` files and `screenshots/` are untracked scratch of the running dev
  servers, never commit them, and note the pid files record the shell wrapper
  pids, not always the actual node listener (find listeners with
  `netstat -ano | grep :<port>`).

## Sources of truth

Everything above was verified live on 2026-10-29 (health OK, wizard options
rendering from the real API, a GAMING/20000 MAD/1080p/Équilibré pass rendering as
"Configuration N° 1 — Équilibré — 19 694 DH"). For repository conventions, read
the root `AGENTS.md` first; for engine behaviour, the docs under `docs/`.
