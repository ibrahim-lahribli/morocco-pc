# apps/web — the web app (W0, in progress)

A standalone Next.js (App Router, TypeScript strict) package with its own
manifest and lockfile (OD4). It is **mobile-first and SEO-first**, French by
default with an Arabic RTL locale, and it reaches the API only through
`lib/api/client.ts` — whose types are generated from the API's own committed
OpenAPI snapshot (`apps/api/test/unit/openapi-v1.6.json`), so the tree holds one
contract rather than two.

**Where the truth lives**

- plan and phases: [docs/plans/agent3-web-plan.md](../../docs/plans/agent3-web-plan.md)
- sprint board (S1–S26, each with a definition of done):
  [docs/plans/agent3-web-sprints.md](../../docs/plans/agent3-web-sprints.md)
- design tokens and their measured contrast:
  [docs/design/TOKEN_MAP.md](../../docs/design/TOKEN_MAP.md)
- the component kit: [docs/design/COMPONENTS.md](../../docs/design/COMPONENTS.md)
- i18n, formatting and the font strategy: [docs/design/I18N.md](../../docs/design/I18N.md)

The design source is the Stitch board recorded in the plan §3; nothing under this
package imports an export.

## Commands

Run them from `apps/web`. Node 22 or newer.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3210 (`/` redirects to `/fr`) |
| `npm run build` | Production build; `npm test` needs it to have run |
| `npm run start` | Serve the production build on 3210 |
| `npm test` | Playwright at 360×800 — starts `next start` (3210) and the mock API (3211) |
| `npm run test:lighthouse` | Lighthouse budgets on a fixture result page (enforced since S19: `error`, median of three) — needs `npm run build`, starts both servers itself, writes `.lighthouseci/` |
| `npm run mock:api` | The fixture mock API on 3211; states via `?state=` (see `mock/server.mjs`) |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run check:api-types` | Fails when `lib/api/schema.d.ts` drifts from the OpenAPI snapshot |
| `npm run gen:api-types` | Regenerate that file from the snapshot |
| `npm run check:tokens` | Fails on a hex literal, a raw palette utility or a physical side class |
| `npm run check:i18n` | Fails on inline `Intl`, a runtime-locale method, or a hand-written amount/date |

`npm test` reuses an already-running server when one holds the port, so stop a
stale `npm run start` after a rebuild if the specs look out of date.
`npm run test:lighthouse` does the opposite on purpose: it REFUSES to run when
anything already answers on 3210, because measuring a `next dev` server would
budget a build that never ships.

### Local development against a deployed API

`npm run dev` with no API configured falls back to `http://localhost:3000`, so a
machine with nothing serving that port renders the wizard's "options could not be
loaded" state. To drive the real engine instead, put this pair in
`.env.development.local` — `next dev` loads that file and nothing else does, so
the build and the suite keep their fixture path:

```
NEXT_PUBLIC_API_BASE_URL=/api
API_BASE_URL=https://morocco-pc.onrender.com
```

A RELATIVE public base makes this server the API's front door: the browser calls
`/api/v1/...` on the app's own origin and `next.config.ts` forwards each request
to `API_BASE_URL` server-to-server. That is what makes a deploy usable from
`localhost`: its `ALLOWED_ORIGINS` does not list this origin, so a direct browser
call is refused — with a relative base there is no cross-origin request left for
CORS to refuse. An absolute base registers no rewrite. `next dev` re-reads the
target on every start; a production build bakes the rewrite (and its resolved
destination) into the build manifest, so moving the target there is a rebuild.

One trap, measured: point a LOCAL API at its IP, not its name — `API_BASE_URL`
`http://127.0.0.1:3000`, never `http://localhost:3000`. Next skips an external
rewrite whose host matches the app's own, and the dev server is on `localhost`,
so the localhost target answers 404 instead of proxying.

`npm test` drives the wizard against the FIXTURE mock. The same submit against the REAL engine is one
opt-in spec, `e2e/wizard-engine.spec.ts`: start the API on 3000 against the TEST branch
(`ALLOWED_ORIGINS=http://localhost:3210 npm run start:api` at the repo root), then run it ALONE with
`E2E_ENGINE_API=1 E2E_APP_API_BASE_URL=http://localhost:3000 npx playwright test
e2e/wizard-engine.spec.ts`. It asserts the committed pass and deletes its own rows; never set those
two variables for the whole suite — every fixture-driven spec would then talk to a live database.

## Routes today

`/fr`, `/ar` (shell and the wizard's entry point), `/fr/configurer` and
`/ar/configurer` (the wizard, S7 — a static route whose answers live in the query
string), `/fr/config/[id]` and `/ar/config/[id]` (the results page and its share
surface, S11–S15, `noindex` permanently), `/fr/format` and `/ar/format`
(formatting proof sheet), `/fr/kit` (component kit proof sheet) and `/fr/tokens`
(token proof sheet). The proof sheets are `noindex` and French-only by design.
