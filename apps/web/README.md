# apps/web — the web app (W0, in progress)

A standalone Next.js (App Router, TypeScript strict) package with its own
manifest and lockfile (OD4). It is **mobile-first and SEO-first**, French by
default with an Arabic RTL locale, and it reaches the API only through
`lib/api/client.ts` — whose types are generated from the API's own committed
OpenAPI snapshot (`apps/api/test/unit/openapi-v1.5.json`), so the tree holds one
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
| `npm run mock:api` | The fixture mock API on 3211; states via `?state=` (see `mock/server.mjs`) |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run check:api-types` | Fails when `lib/api/schema.d.ts` drifts from the OpenAPI snapshot |
| `npm run gen:api-types` | Regenerate that file from the snapshot |
| `npm run check:tokens` | Fails on a hex literal, a raw palette utility or a physical side class |
| `npm run check:i18n` | Fails on inline `Intl`, a runtime-locale method, or a hand-written amount/date |

`npm test` reuses an already-running server when one holds the port, so stop a
stale `npm run start` after a rebuild if the specs look out of date.

## Routes today

`/fr`, `/ar` (shell and the wizard's entry point), `/fr/configurer` and
`/ar/configurer` (the wizard, S7 — a static route whose answers live in the query
string), `/fr/format` and `/ar/format` (formatting proof sheet), `/fr/kit`
(component kit proof sheet) and `/fr/tokens` (token proof sheet) — the proof sheets
are `noindex` and French-only by design. Results (W2) are not built yet.
