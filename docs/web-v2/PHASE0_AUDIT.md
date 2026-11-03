# apps/web — read-only audit (Phase 0)

Generated: 2026-11-02
Scope: `apps/web/`. No file was modified, no package installed, no `.env` value read.
Env var names are cited; values are not.

---

## 1. Routes / screens

`apps/web/app/[locale]/layout.tsx` — locale shell. Sets `lang`, the NextIntl globals,
the `header-nav` client island, and the Arabic IBM Plex Sans Arabic face preload on `ar`.
States: no distinct UI state; the shell is stateless and renders every child route.

`apps/web/app/[locale]/page.tsx` — home/shell entry (`/fr`, `/ar`). README says `/`
redirects to `/fr` via proxy, so this is the non-wizard entry. Purpose: surface for the
preset ribbon and signposting. States handled by the child surfaces below (wizard results,
components, guides, saved builds, proof sheets).

`apps/web/app/[locale]/[...rest]/page.tsx` — catch-all route. Resolves a bare rest path to
a locale-prefixed URL; README frames the shell as the fallback surface it renders. States:
renders the shell around whatever matched the rest segment.

`apps/web/app/[locale]/configurer/page.tsx` — wizard entry (`/fr/configurer`, `/ar/configurer`).
README: a static route whose answers live in the query string. States: idle input form,
submitting/loading, result redirect target, and the "options could not be loaded" fallback
when no API is reachable (README).

`apps/web/app/[locale]/configurer/budget-step.tsx`, `submit-panel.tsx`, `wizard.tsx` — wizard
sub-components behind the configurer route: budget step, submit panel, and the wizard shell.

`apps/web/app/[locale]/config/[id]/page.tsx` — results page (`/fr/config/{id}`, `/ar/config/{id}`).
README: S11–S15. Permanently `noindex`. States: loading the commission, empty (no builds /
budget floor only), error (API or validation), success (ranked builds + explanation + swap).

`apps/web/app/[locale]/config/[id]/opengraph-image.tsx` — result OG card (S15). Static
Satori image per committed pass.

`apps/web/app/[locale]/[presetSlug]/page.tsx` — preset page (`/fr/{slug}`, `/ar/{slug}`).
README: S16 preset pages. States: loading the ribbon, empty preset set, error.

`apps/web/app/[locale]/[presetSlug]/opengraph-image.tsx` — preset OG card (S18).

`apps/web/app/[locale]/format/page.tsx` — formatting proof sheet. README: French-only,
`noindex` by design. Purpose: exercise `lib/i18n/format.ts`.

`apps/web/app/[locale]/kit/page.tsx` — component kit proof sheet. README: French-only,
`noindex` by design. Purpose: surface the UI kit.

`apps/web/app/[locale]/kit/kit-interactive.tsx` — interactive kit demo behind `/kit`.

`apps/web/app/[locale]/tokens/page.tsx` — token proof sheet. README: French-only,
`noindex` by design.

`apps/web/app/[locale]/composants/page.tsx` — component catalogue root
(`/fr/composants`, `/ar/composants`).

`apps/web/app/[locale]/composants/[slug]/page.tsx` — per-component catalogue page (S17).

`apps/web/app/[locale]/composants/comparer/page.tsx` — compare view under
`/fr/composants/comparer` (S23).

`apps/web/app/[locale]/guides/page.tsx` — guides index (`/fr/guides`, `/ar/guides`).

`apps/web/app/[locale]/guides/[slug]/page.tsx` — single guide (MDX).

`apps/web/app/[locale]/enregistrements/page.tsx` — saved builds surface
(`/fr/enregistrements`, `/ar/enregistrements`). README: footer-linked on every page.

`apps/web/app/[locale]/contact/page.tsx`, `confidentialite/page.tsx`,
`mentions-legales/page.tsx` — legal/contact pages (S22) per locale.

`apps/web/app/api/analytics/route.ts` — server analytics config endpoint (S22).

`apps/web/app/globals.css`, `sitemap.ts`, `robots.ts`, `favicon.ico` — shell/crawl
surface. README: `/sitemap.xml` and `/robots.txt` are dynamic on purpose (S18).

---

## 2. Components

Reusable (UI kit, `apps/web/components/ui/`):
`alert`, `badge`, `button`, `choice-card`, `choice-group`, `icons`, `progress-bar`,
`skeleton`, `slider`, `text-field`, plus `cn` (class-name join) and the barrel `index.ts`.

Page/organization components:
- `apps/web/components/header-nav.tsx` — shell nav + locale switcher island.
- `apps/web/components/locale-switcher.tsx` — locale switcher control.
- `apps/web/components/analytics.tsx` — analytics loader island.
- `apps/web/components/legal-page.tsx` — legal-page rendering helper.
- `apps/web/components/guides/mdx-components.tsx` — MDX component map (guides).
- `apps/web/components/catalog/compare-table.tsx` — compare view table.
- `apps/web/components/price-history.tsx` — price-history chart component.
- `apps/web/components/result/build-card.tsx`, `build-explanation.tsx`,
  `component-row.tsx`, `inputs-applied.tsx`, `share-bar.tsx`, `swap-panel.tsx` — results page.
- `apps/web/components/saved/save-build-button.tsx`, `saved-builds.tsx` — saved builds.

Duplicated patterns noted:
- Two OG-image renderers (`apps/web/app/[locale]/config/[id]/opengraph-image.tsx` and
  `apps/web/app/[locale]/[presetSlug]/opengraph-image.tsx`) use the same Satori approach
  and are the only files exempt from the hex rule in `check-tokens.mjs` — same reason
  (Satori knows neither CSS nor Tailwind).
- Shared result surface is spread across `components/result/` + page-level
  `lib/result/*.ts`; sizing and swap control are explicit modules (`lib/result/swap.ts`,
  `lib/result/inputs.ts`) rather than duplicated in pages.
- `components/ui/*` is the single reusable kit; the rest is page-scoped by folder.

---

## 3. API usage

Single HTTP surface: `apps/web/lib/api/client.ts`. README + client header both say the web
app reaches the API only through this module and that types come from the committed OpenAPI
snapshot via `lib/api/schema.d.ts`.

Browser vs server:
- Browser calls use `apiBaseUrl()` — built from `NEXT_PUBLIC_API_BASE_URL` (inlined at build
  time, defaults to `http://localhost:3000`).
- Server SSR/ISR reads use `serverApiBaseUrl()` — from `API_BASE_URL`, falling back to
  `NEXT_PUBLIC_API_BASE_URL`, then the default. `isApiConfigured()` distinguishes "a base was
  named" from "we fell back to localhost".

Error handling: one `request()` path parses non-2xx + non-JSON + network failures into
`ApiError` with `status`, `code`, `details[]`, `requestId`, `retryAfterSeconds`. The client
deliberately has no retry, cache, timeout default, or runtime validation — README says retry
and 429 countdown are S10 responsibilities.

Base URL env var names (env NAMES only): `NEXT_PUBLIC_API_BASE_URL`, `API_BASE_URL`,
`MOCK_API_PORT` (fixture mock on 3211). README also documents `ALLOWED_ORIGINS` for a live
engine run.

Endpoints/types actually used (from `lib/api/schema.d.ts` + client exports):
- `GET /v1/health` → `HealthResponse` (`getHealth`).
- `GET /v1/meta/options` → `MetaOptionsResponse` (`getMetaOptions`).
- `POST /v1/recommendations` → `RecommendationResponse`, with input type
  `RecommendationInput`; wrapper returns `{ status: 200|201, body }` (`createRecommendation`).
- `GET /v1/recommendations/{id}` → `RecommendationResponse` (`getRecommendation`,
  `getRecommendationForServer` no-store, `getRecommendationForStatic` revalidated).
- `GET /v1/presets` → `PresetsResponse` / `PresetsQuery` (`getPresets`,
  `getPresetsForServer` revalidated).
- `GET /v1/catalog/products` → `CatalogListResponse` / `CatalogListQuery` (`listCatalogProducts`,
  `listCatalogProductsForServer` revalidated + cursor).
- `GET /v1/catalog/products/{slug}` → `CatalogProductResponse` (`getCatalogProduct`,
  `getCatalogProductForServer` revalidated).
- `GET /v1/catalog/products/{slug}/price-history` — present in `schema.d.ts`; client.ts does
  not expose a named export for it in the read I did — worth confirming against code, but the
  path is in the committed schema.
- `GET /v1/recommendations/{id}/builds/{rank}/swap-preview` → `SwapPreviewResponse`
  (`getSwapPreview`, browser, no-store).
- `POST /v1/recommendations/{id}/builds/{rank}/swap` → `SwapCommitResponse` (`commitSwap`,
  browser, no-store).

Schema is pinned to contract `1.10.0` per `check-api-types.mjs` and the server message.

---

## 4. Styling / tokens

Tailwind 4 via `@tailwindcss/postcss` (v4.3.3) in `postcss.config.mjs`; Tailwind is the
PostCSS plugin, not a v3 `tailwind.config.js`. Tokens live in `apps/web/app/globals.css`
inside `@theme { --color-*, --font-*, --text-*, --radius-*, --shadow-*, --spacing-* }`.
Three layers: brand (palette as designed), semantic (surface meaning), component (decisions
made once).

Defaults: `globals.css` sets `--font-sans` (Inter), `--font-arabic` (IBM Plex Sans Arabic),
`--font-mono`, a 7-step type scale, control/card/pill radii, two card shadows, and a single
focus treatment. Arabic pages switch `body` to `--font-arabic` via `html[lang="ar"] body`.

`npm run check:tokens` (`apps/web/scripts/check-tokens.mjs`) fails on three greppable patterns
across `app/`, `components/`, `lib/` (not `app/globals.css`):
1. hex literal,
2. raw palette utility (`bg-stone-200`, `text-white`, etc.),
3. physical side / physical text alignment (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`,
   `border-l-`, `rounded-l-`, `text-left`, `text-right`).

Result I ran: `PASS tokens - 84 file(s), no hex literals, no palette utilities, no physical sides`.

---

## 5. i18n / RTL

Locales: `fr` (default) and `ar`, both with `localePrefix: "always"` (`/fr/...`, `/ar/...`).
No cookie (`localeCookie: false`); routing in `apps/web/i18n/routing.ts`.

Message files: `apps/web/messages/fr.json` and `apps/web/messages/ar.json`. Locale helpers in
`apps/web/lib/i18n/format.ts` (amounts use narrow no-break space grouping; currency label is
"DH" for both locales today; dates via `Intl.DateTimeFormat`) and
`apps/web/lib/i18n/paths.ts` (locale-path helper; README says `createNavigation` is not used
because no client component needs translated copy yet).

`npm run check:i18n` (`apps/web/scripts/check-i18n.mjs`) enforces:
1. no inline `new Intl.NumberFormat/DateTimeFormat/RelativeTimeFormat` outside `lib/i18n/`,
2. no `.toLocaleString/DateString/TimeString()`,
3. no hardcoded money literal,
4. no hardcoded short-month date literal,
5. `messages/fr.json` and `messages/ar.json` parity — same keys and same ICU placeholders
   (fr is the reference),
6. a caller-filled template message is read with `t.raw()`, not `t()`.

Result I ran: `PASS i18n - 82 file(s), every number and date goes through lib/i18n/format.ts,
every caller-filled template is read with t.raw; 2 catalogues (ar.json, fr.json) with identical
keys and placeholders`.

RTL: Arabic layout is driven by `<html lang="ar">` and logical CSS throughout. Reading the
physical-direction classes the token gate forbids — `ml/mr/pl/pr/left/right/border-l/border-r/
rounded-l/rounded-r/text-left/text-right` — across `app/`, `components/`, `lib/` (excluding
`node_modules` and `e2e`):
- 0 matches in the three scanned trees. That is consistent with `check-tokens` passing.

Note: `e2e/wizard-budget.spec.ts` line 181 contains the word "left-edge" in a test string
describing the Arabic rail — that is prose in a spec, not a class, and is outside the scanned
trees. Not counted.

---

## 6. Tests

Playwright suite lives in `apps/web/e2e/`. README + `package.json` say `npm test` runs
Playwright at 360×800, starting `next start` on 3210 and the fixture mock API on 3211.
Spec inventory and what they cover (from filenames + README):

- `wizard.spec.ts`, `wizard-steps.spec.ts`, `wizard-submit.spec.ts`, `wizard-submit-model.spec.ts`,
  `wizard-model.spec.ts`, `wizard-budget.spec.ts`, `wizard-browser-api.spec.ts`,
  `wizard-engine.spec.ts` — wizard flow, steps, submit model, budget/rail, browser-API path,
  and one opt-in real-engine path against the TEST branch.
- `result.spec.ts`, `result-model.spec.ts`, `explanation.spec.ts`, `reason-lines.spec.ts`,
  `inputs-applied.spec.ts`, `swap.spec.ts`, `share.spec.ts` — results page, its model,
  explanation/reason lines, input effects, live swap (Decisions 55/56), share surface.
- `preset.spec.ts`, `preset-model.spec.ts` — preset ribbon/pages.
- `catalog.spec.ts`, `price-badge.spec.ts`, `price-history.spec.ts`, `compare.spec.ts` —
  catalog, price badge, price-history, compare table.
- `shell.spec.ts`, `zero-states.spec.ts`, `states.spec.ts` — shell, empty/zero states, UI states.
- `kit.spec.ts`, `tokens.spec.ts`, `guides.spec.ts`, `i18n.spec.ts` — kit, token sheet,
  guides, i18n surface.
- `structured-data.spec.ts`, `seo.spec.ts`, `sitemap-budget.spec.ts` — JSON-LD/SEO and
  crawl-surface budgets.
- `legal.spec.ts`, `analytics.spec.ts` — S22 legal + analytics.
- `saved.spec.ts`, `saved-model.spec.ts` — saved builds surface.
- `api-contract.spec.ts` — contract drift smoke.
- `a11y.spec.ts` — axe audit.
- `rtl.spec.ts` — Arabic/RTL pass.

README: suite is large (378 specs mentioned in AGENTS.md for the latest web commit); 2 specs
are skipped by default in CI (`wizard-browser-api.spec.ts` needs `E2E_BROWSER_API=1`,
`wizard-engine.spec.ts` is the opt-in real-engine harness).

Deterministic note: `apps/web/mock/server.mjs` is the fixture mock; `apps/web/lib/presets/fixtures.ts`
and related fixtures back the mock. README warns that `npm test` reuses an already-running
server on 3210, and `npm run test:lighthouse` refuses to run when 3210 is occupied.

I did not run the Playwright suite here (it needs a built app + mock, and the task is read-only
audit + baseline checks). Baselines below cover the static gates.

---

## 7. Baseline (run from `apps/web`)

All five gates ran from `apps/web`. Each is reported as run, not assumed.

- `npm run typecheck` — **PASS**. `tsc --noEmit` exited 0 with no emitted output.
- `npm run lint` — **PASS** (warnings only). ESLint exited 0; 2 warnings:
  - `mock/server.mjs:91:3` — `'VARIANTS_BY_SLUG' is defined but never used`
    (`@typescript-eslint/no-unused-vars`).
  - `postcss.config.mjs:2:1` — assign object to a variable before exporting as module default
    (`import/no-anonymous-default-export`).
- `npm run check:tokens` — **PASS**. 84 files scanned, no hex literal, no palette utility,
  no physical side.
- `npm run check:i18n` — **PASS**. 82 files scanned; 2 catalogues (ar.json, fr.json) with
  identical keys and placeholders.
- `npm run check:api-types` — **PASS**. Contract `1.10.0`, 10 paths, `lib/api/schema.d.ts`
  byte-identical to the generator output.

No gate failed; no gate was skipped or blocked on this machine. `npm run build` and
`npm run test` were not run — they are not in the requested baseline set, and the task is
read-only plus the listed static gates.

---

## 8. Deployment

Config surface:
- `apps/web/next.config.ts` — App Router config: `outputFileTracingRoot` pinned to this
  package (standalone package, OD4), `pageExtensions` including `mdx`, and a conditional
  `rewrites()` that proxies `NEXT_PUBLIC_API_BASE_URL/v1/:path*` → `API_BASE_URL/v1/:path*`
  only when a relative public base is named. Wrapped by `createNextIntlPlugin("./i18n/request.ts")`
  and `@next/mdx`.
- `apps/web/open-next.config.ts` — Cloudflare adapter config from `@opennextjs/cloudflare`:
  incremental cache backed by KV (`kvIncrementalCache`) rather than R2 (R2 needs a payment
  method on file for this account; KV needs neither).
- `apps/web/wrangler.jsonc` — Workers deployment descriptor: `main: .open-next/worker.js`,
  `name: morocco-pc-web`, `compatibility_date: 2024-12-30`, flags
  `nodejs_compat` + `global_fetch_strictly_public`, `ASSETS` binding from `.open-next/assets`,
  `NEXT_INC_CACHE_KV` KV namespace binding (`d47960335cfc4793b9df62db7950259c`), and a
  `WORKER_SELF_REFERENCE` service binding to `morocco-pc-web`.

Env var names (env NAMES only):
- `NEXT_PUBLIC_API_BASE_URL` — public API origin, inlined at build time; default
  `http://localhost:3000`.
- `API_BASE_URL` — server-side API origin, read at request time, not public; default falls back
  to `NEXT_PUBLIC_API_BASE_URL`.
- `NEXT_PUBLIC_SITE_URL` — public origin for sitemap/robots/canonical/hreflang; scheme+host only.
- `ANALYTICS_PROVIDER`, `ANALYTICS_DOMAIN`, `ANALYTICS_WEBSITE_ID`, `ANALYTICS_SCRIPT_URL` —
  analytics (S22); unset is off.
- `MOCK_API_PORT` — fixture mock port (default 3211) for `npm test`/`npm run mock:api`.
- For Cloudflare deploy: `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER`, `APP_ORIGIN` are the reserved
  auth variables injected on deploy (per SITE docs); the web app currently has no auth enabled.

Deploy path: this is an OpenNext worker. The documented flow is `sites_prepare_next` then
`sites_deploy` with the returned manifest; `wrangler.jsonc` is the local Wrangler descriptor.
Local dev against a deployed API uses the relative-`NEXT_PUBLIC_API_BASE_URL` + `API_BASE_URL`
pair in `.env.development.local` (README); a build bakes the resolved rewrite into
`.next/routes-manifest.json`.

---

## 9. Dependency findings

1. `@tailwindcss/turbopack` is present at `4.3.3` in both `package.json` devDependencies and
   `package-lock.json`, but nothing in the scanned source references it as the active build path.
   The dev script is `next dev -p 3210`; there is no Turbopack flag in `package.json` scripts and
   no `next.config.ts` exporting a Turbopack-only config. It looks like an unused/optional dev
   dependency for this package as configured — likely a leftover from the Tailwind 4 upgrade path
   rather than something the current `next dev` invokes.

2. `@types/node` is `^20` (locked `20.19.43`) while `engines.node` is `>=22` and `typescript`
   is `5.9.3`. That is a real mismatch in the sense that the type set is a Node 20 surface while
   the package declares a 22+ runtime; `@types/node@20` is older than the declared runtime and
   older than the typescript major it coexists with. Whether that causes a concrete type miss on
   22 APIs is a type-check question, not an install question — `typecheck` passed here, so the
   gap is latent, not currently breaking.

3. `gen:api-types` resolves its spec path explicitly and absolutely. From
   `apps/web/package.json`: `openapi-typescript ../api/test/unit/openapi-v1.10.json -o lib/api/schema.d.ts`.
   From `apps/web/scripts/check-api-types.mjs`: the snapshot is resolved to
   `path.resolve(WEB_ROOT, "..", "api", "test", "unit", "openapi-v1.10.json")`, i.e.
   `apps/api/test/unit/openapi-v1.10.json` — the API's own gated snapshot file, not a copy in
   `apps/web`. The check also resolves `openapi-typescript`'s own bin from
   `require.resolve("openapi-typescript/package.json")` so the gate uses the same generator the
   script would, and it normalizes CRLF→LF before comparing. So the path is
   `apps/api/test/unit/openapi-v1.10.json`, contract `1.10.0`, generated into `lib/api/schema.d.ts`.

---

## 10. Keep / rewrite / delete table

Folders under `apps/web/`:

| Folder | Verdict | One-line justification |
|---|---|---|
| `app/` | KEEP (infra) | Route tree, layout, proof sheets, OG images, sitemap/robots. |
| `components/ui/` | KEEP (infra) | Reusable design-kit primitives. |
| `components/result/` | KEEP (infra) | Results-page subcomponents; owned by the result surface. |
| `components/saved/` | KEEP (infra) | Saved-builds components. |
| `components/catalog/` | KEEP (infra) | Catalog compare table. |
| `components/guides/` | KEEP (infra) | MDX component map for guides. |
| `components/header-nav.tsx`, `locale-switcher.tsx`, `analytics.tsx`, `legal-page.tsx`, `price-history.tsx` | KEEP (infra) | Shell/org components referenced by routes. |
| `lib/api/` | KEEP (infra) | Single HTTP client + generated schema — the only API surface. |
| `lib/result/`, `lib/wizard/`, `lib/presets/`, `lib/catalog/`, `lib/seo/`, `lib/i18n/` | KEEP (infra) | Server/client logic backing routes and gates. |
| `i18n/` | KEEP (infra) | Routing + request setup for next-intl. |
| `messages/` | KEEP (infra) | `fr.json` + `ar.json` catalogues. |
| `scripts/` | KEEP (infra) | `check-*` gates + lighthouse CI. |
| `mock/` | KEEP (infra) | Fixture mock API for the suite. |
| `public/` | KEEP (infra) | Static assets (fonts, favicon). |
| `content/` | KEEP (infra) | Guides/content source for MDX. |
| `design-v2/` | DELETE | Empty aside from `home-page-design/` — no code path reads it; looks like a stale scratch/design artifact. |
| `test-results/`, `.lighthouseci/`, `.next/`, `tmp/`, `node_modules/` | KEEP (infra) | Build/test artifacts / deps; not application source. |

Verification artifacts and scratch dirs (`test-results`, `.lighthouseci`, `.next`, `tmp`)
are infrastructure, not application code, so they are KEEP-as-is and not candidates for rewrite.
