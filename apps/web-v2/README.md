# Morocco-PC V2

The V2 frontend foundation: a standalone Next.js App Router application with a
bilingual (French / Arabic) design system. It runs independently of V1
(`apps/web`) and shares no frontend code with it.

> **Status: homepage (Step 1) and the configurator foundation (Step 3.2)
> complete, pending native review of the Arabic copy.** The homepage is seven
> sections — hero with the budget/usage finder, recommended configurations,
> discovery pathways, trust, guides, closing call to action, footer — over the
> design tokens, the component kit, i18n and the typed API client. The
> configurator at `/{locale}/configurateur` reads its two answers from
> `use_case` and `budget`, opens an existing pass from `from=<uuid>` and renders
> a summary beside the form (a fixed bar above the mobile nav below `lg`). Both
> screens perform **only GETs** (`/v1/meta/options`, `/v1/presets`,
> `/v1/recommendations/{id}`); no recommendation `POST` exists. There is no
> catalogue picker, no swap and no results route yet.

## Requirements

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` (the floor jsdom 31 declares; CI runs the latest 22.x)
- npm (the repository's package manager; a lockfile is committed)

## Install and run

```bash
cd apps/web-v2
npm install
npm run dev          # http://localhost:3220/fr
```

V2 is a separate package: its own `package.json`, lockfile, config and
`node_modules`. Installing here does not touch the engine, the API or `apps/web`.

Production:

```bash
npm run build
npm run start        # http://localhost:3220/fr
```

`/` redirects to `/fr` (French is the default locale). `/ar` renders the same
page in Arabic RTL.

## Scripts

| Script                            | What it does                                                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Next dev server on **port 3220**                                                                                                                                                                                                                |
| `npm run build`                   | Production build                                                                                                                                                                                                                                |
| `npm run start`                   | Serve the production build on port 3220                                                                                                                                                                                                         |
| `npm run typecheck`               | `tsc --noEmit` (strict)                                                                                                                                                                                                                         |
| `npm run lint`                    | ESLint 9 flat config (`eslint-config-next`)                                                                                                                                                                                                     |
| `npm run format` / `format:check` | Prettier, with Tailwind class sorting                                                                                                                                                                                                           |
| `npm test`                        | Vitest unit tests (jsdom)                                                                                                                                                                                                                       |
| `npm run test:watch`              | Vitest in watch mode                                                                                                                                                                                                                            |
| `npm run test:e2e`                | Playwright browser tests (starts the dev server)                                                                                                                                                                                                |
| `npm run gen:api-types`           | Regenerate `lib/api/schema.d.ts` from the API's committed OpenAPI contract                                                                                                                                                                      |
| `npm run check:api-types`         | Fail when the generated types no longer match that contract                                                                                                                                                                                     |
| `npm run screenshots`             | Writes `docs/screenshots/desktop-{fr,ar}.png`, `mobile-{fr,ar}.png` (viewport, nav visible) and `mobile-{fr,ar}-full.png`; needs a running server; set `SCREENSHOT_OUTPUT_DIR` to write into a subdirectory instead of overwriting the baseline |

Playwright's browser binary is not downloaded by `npm install`. Install it once:

```bash
npx playwright install chromium
```

## Environment variables

Copy `.env.example` to `.env.local`. Documented names:

| Variable                   | Scope            | Purpose                                                                                   |
| -------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`     | browser + server | Absolute origin for canonical/OG metadata (not used by Step 0)                            |
| `NEXT_PUBLIC_API_BASE_URL` | browser          | Public API v1 origin; inlined at build time; defaults to `http://localhost:3000`          |
| `API_BASE_URL`             | server only      | Server-side API origin for server components/route handlers; falls back to the public one |

The homepage and the configurator read the API and need no credentials. On load
the homepage issues `GET /v1/meta/options`, one `GET /v1/presets` per use case,
then one `GET /v1/recommendations/{id}` per rendered card; the configurator
issues `GET /v1/meta/options` once and, only for a `from=<uuid>` URL, a single
`GET /v1/recommendations/{id}`. Neither writes.
A browser call to the API only succeeds when the API's own `ALLOWED_ORIGINS`
includes this app's origin (`http://localhost:3220` locally); with no API
listening, homepage cards show their per-slot error state, the configurator
shows its error panel, and the rest of the page is unaffected.

Both API variables are optional, and an empty value means the same as an unset
one. With neither set, the browser and the server both default to
`http://localhost:3000` (the API's own `PORT` default), so a local run needs no
API configuration at all — only a listening API. A blank `API_BASE_URL=` does
not shadow a valid `NEXT_PUBLIC_API_BASE_URL`, and `isApiConfigured()` is false
only when neither variable names an origin.

Nothing else in the app calls the API, and no live-API run has been recorded
yet: every browser test stubs `/v1/**` through `e2e/support/homepage-api.ts` or
`e2e/support/configurator-api.ts`.

## Structure

```
app/[locale]/          locale-rooted layout, homepage, configurateur, 404
components/ui/         shared kit: Button, Badge, Card, TextField (barrel index.ts)
components/layout/     header, primary/mobile nav, logo, locale switcher, footer
components/home/       seven homepage sections; islands: finder, cards, pathways, closing CTA
components/configurator/ requirements form, summary panel, client shell
i18n/                  routing, request config, locale-aware navigation
messages/              fr.json, ar.json
lib/                   utils, price formatter, demo budget presets
lib/homepage/          finder schema, store, guides, build view-model, flags, use-presets
lib/configurator/      URL contract, form schema, per-mount store, queries
lib/api/               generated schema, client, config, errors, query defaults, derived types
components/providers/  ApiProvider (TanStack Query, client component)
scripts/               OpenAPI type generation and drift check, screenshot capture
tests/                 Vitest unit tests (including tests/api/ and tests/configurator/)
e2e/                   Playwright specs (shell, finder, cards, configurator, Arabic/RTL) + support/
docs/                  DESIGN_SYSTEM.md, homepage-arabic-review.md, evidence screenshots
```

The supplied Stitch references stay untouched in
`stitch_morocco_pc_builder_app/`.

## Configurator

`/{locale}/configurateur` asks two questions — use case and budget — and renders a
build summary beside them. The homepage finder's CTA hands its two answers to this route
(`use_case`, `budget`) and posts nothing. The URL is the only input:

| Query      | Accepted                          | Invalid value                    |
| ---------- | --------------------------------- | -------------------------------- |
| `use_case` | `GAMING`, `OFFICE`, `WORKSTATION` | cleared, message under the group |
| `budget`   | integer in `[3 500, 100 000]`     | kept verbatim, range message     |
| `from`     | canonical 8-4-4-4-12 hex UUID     | link error, no request issued    |

Invalid values are shown, never clamped, and valid neighbours survive. The page
does not rewrite the URL. `Continuer` validates, stores the answers and moves
focus to the summary heading; it generates nothing. A `from` link loads that
pass (loading, ready, not-found and error-with-retry states); a build's missing
price stays absent rather than becoming `0`. Arabic is authored with key parity
and is not native-approved.

## Design system

Tokens are defined once in `app/globals.css` under Tailwind v4's `@theme`, from
the supplied `DESIGN.md`:

- deep indigo primary `#3730A3`, darkest indigo `#1F108E`, soft indigo surfaces
- pale blue canvas `#F8F9FF`, white cards, fine `#E2E8F0` borders
- saffron accent `#F59E0B` and its soft/ink pair
- verified (emerald), indicative (amber) and estimated (slate) price states
- a 12-step type scale, 10/12/16 px control-field-card radii, three elevations

Components use semantic token utilities only, and CSS logical properties
(`ms/me`, `ps/pe`, `start/end`, `text-start`) so RTL mirrors without a second
stylesheet. `docs/DESIGN_SYSTEM.md` documents every token and component API.

Do not add a colour literal or a physical direction utility to a component —
`tests/homepage/rtl-utilities.test.ts` fails on one. If a
new token is genuinely needed, add it to `@theme` and document it.

## Internationalisation

`next-intl` with `fr` (default) and `ar`, and a locale prefix on every URL.
`app/[locale]/layout.tsx` sets `<html lang dir>` from the route, so direction is
correct in the first byte of HTML. Arabic swaps to IBM Plex Sans Arabic via
`html[lang="ar"]`; the face is not preloaded on French pages.

No user-facing string belongs in a component: labels arrive as props or through
`useTranslations` / `getTranslations`. `tests/i18n/messages.test.ts` fails when
the dictionaries drift in keys or interpolation placeholders.

## API client

The foundation is installed; the homepage cards and the configurator are its
consumers:

- `@tanstack/react-query` — client cache and retry policy
- `openapi-typescript` — generates `lib/api/schema.d.ts` from the API contract
- `openapi-fetch` — typed fetch client

### Contract and drift gate

Types are generated from the API's own committed snapshot,
`apps/api/test/unit/openapi-v1.10.json` — V2 keeps no second contract. Never
hand-write an API shape; add a named alias in `lib/api/types.ts` instead.

```bash
npm run gen:api-types     # rewrite lib/api/schema.d.ts
npm run check:api-types   # exit 1 when it is stale or missing
```

The generated file is ignored by ESLint and Prettier, and must never be edited.
`check:api-types` belongs in the same gate run as `typecheck` whenever the API
contract changes.

### Browser and server clients

```ts
import { getBrowserApiClient } from "@/lib/api/client";
import { unwrapApiResult } from "@/lib/api/errors";

const result = await getBrowserApiClient().GET("/v1/health");
const health = unwrapApiResult(result); // typed; throws ApiError on failure
```

`createApiClient({ baseUrl, fetch })` builds an isolated client (the `fetch`
injection is how tests run without a network). Server components and route
handlers should create their own with the server origin:

```ts
import { createApiClient } from "@/lib/api/client";
import { resolveServerApiBaseUrl } from "@/lib/api/config";

const api = createApiClient({ baseUrl: resolveServerApiBaseUrl() });
```

`resolveBrowserApiBaseUrl()` reads only `NEXT_PUBLIC_API_BASE_URL`;
`resolveServerApiBaseUrl()` prefers `API_BASE_URL`, then the public value, then
`http://localhost:3000`. `isApiConfigured()` distinguishes an explicitly
configured API from that local fallback — useful when a screen must render a
fixture instead of assuming a server is listening.

### Query defaults

`createQueryClient()` (mounted once by `ApiProvider` in the locale layout):

- 30 s `staleTime`, 5 min `gcTime`
- HTTP 5xx and 408 responses are retried **twice** (`MAX_QUERY_RETRIES = 2`), as is an
  `ApiError` with `status: 0`
- a fetch `TypeError` (offline, DNS, CORS) is retried **once**; any other
  unexpected error is not retried at all
- 4xx responses are never retried, 429 included: its `Retry-After` stays a UI
  countdown rather than being retried silently
- mutations never auto-retry: `POST /v1/recommendations` runs and persists an
  engine pass, so the screen owns the retry decision

`ApiError` normalizes the API's `{ error, message, request_id }` envelope and
exposes `status`, `code`, `requestId`, `retryAfterSeconds` and the raw body.
`openapi-fetch` throws on transport failures only; every HTTP failure arrives as
`{ data, error, response }` and becomes `ApiError` through `unwrapApiResult`.

There is no runtime response validation: TypeScript types are erased, so the
contract is trusted as the API's tested surface. Backend logic stays in the
Fastify API; V2 owns presentation only.

## Quality gates

- TypeScript strict, including `noUncheckedIndexedAccess`
- ESLint (`next/core-web-vitals`, `next/typescript`)
- Prettier + Tailwind class sorting
- Vitest: dictionaries, price formatting, validation schema, Zustand store, kit accessibility, API config/error/retry/client/provider, and the configurator's URL contract, store, queries and form
- `npm run check:api-types`: generated API types match `apps/api`'s contract
- Playwright (62 specs): shell sections and breakpoints, finder answers/CTA/navigation, the cards'
  badges and empty/error states, pathways and the closing CTA, the Arabic/RTL pass (direction,
  typeface, mirroring, seven widths in both locales, 360 px nav clearance), the configurator (deep
  links, form, loading/404/error/retry, ranked builds, locale switch, 360 px bars, no writes) and
  the homepage → configurator journey (three handoffs, reload, back, both locale switches, the
  `from` plus invalid-budget combination)

## Scope guard

`apps/web` (V1) is unchanged. No V1 component or frontend utility is imported.
No changes from PR #15 were inspected or reused — the V2 tree was built from the
supplied design references and the existing API contract only.
