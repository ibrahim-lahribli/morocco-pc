# Step 3.2 — Configurator foundation: report

- **Date:** 2026-11-07
- **Branch:** `feature/v2-design` — baseline `dcff399`, head `5af192a`
- **Environment:** Node v24.21.0, Next.js 16.4.5 (Turbopack), React 19.3.1, Playwright 1.65 (Chromium), Windows
- **Verdict:** **PASS**, with the conditions listed in the hand-off

## A. Initial state

At `dcff399` the tree held the Step 1 homepage only: seven sections, the design
tokens, the component kit, fr/ar dictionaries and the typed API client. It had
**98 unit tests** and **29 browser specs**. There was no `/configurateur` route,
no `lib/configurator`, no `components/configurator`, no `Configurator` namespace
and no query-preserving locale switch.

The working tree already carried two untracked paths
(`apps/web-v2/app/[locale]/simulateur-preview/`, `docs/superpowers/`) and
modified homepage screenshots plus `apps/web-v2/scripts/screenshots.mjs`. Both
sets were left out of every change below.

## B. Files created and modified

Created:

- `apps/web-v2/lib/configurator/` — `schema.ts` (URL contract, budget text
  parsing, form schema, budget resolution), `store.ts` (per-mount Zustand store),
  `queries.ts` (two read queries).
- `apps/web-v2/components/configurator/` — `requirements-form.tsx`,
  `build-summary-panel.tsx`, `configurator-shell.tsx`.
- `apps/web-v2/app/[locale]/configurateur/page.tsx` — the server route.
- `apps/web-v2/tests/configurator/` — `schema.test.ts`, `store.test.ts`,
  `imports.test.ts`, `queries.test.ts`, `build-summary-panel.test.tsx`,
  `requirements-form.test.tsx`.
- `apps/web-v2/e2e/configurator.spec.ts`, `apps/web-v2/e2e/support/configurator-api.ts`,
  `apps/web-v2/e2e/global-setup.ts`.

Modified:

- `apps/web-v2/messages/fr.json`, `apps/web-v2/messages/ar.json` — the
  `Configurator` namespace, plus `requirements.errorSummary`.
- `apps/web-v2/components/layout/locale-switcher.tsx` — carries the query string
  (the only shared-shell edit).
- `apps/web-v2/playwright.config.ts` — one `globalSetup` line.
- `apps/web-v2/README.md` — status, structure, API consumers, gates, and a
  Configurator section.

No file under `components/home/`, `lib/homepage/`, `app/[locale]/page.tsx`,
`app/globals.css`, `package.json`, `package-lock.json`, `apps/web` or `apps/api`
changed (proof in section I).

## C. Route and URL behaviour

`/{locale}/configurateur` is a server component that parses `searchParams`
through a pure module and hands a serialisable seed to the client shell. The URL
is the only input and is never rewritten:

| Query      | Accepted                                   | Invalid value                          |
| ---------- | ------------------------------------------ | -------------------------------------- |
| `use_case` | `GAMING`, `OFFICE`, `WORKSTATION`          | field cleared, message under the group |
| `budget`   | integer in `[3 500, 100 000]`              | kept verbatim (`12`), range message    |
| `from`     | canonical 8-4-4-4-12 hex UUID, lower-cased | link error, **no request issued**      |

Unknown parameters are ignored, a repeated parameter is `BUDGET_INVALID`, and a
valid neighbour always survives an invalid one. `Continuer` validates with the
same Zod schema, stores the answers, switches the phase to `review`, and moves
focus to `#build-summary-title`; the URL does not change and nothing is
generated. A valid-but-absent `from` reaches the API's `404` state; a malformed
one never reaches the network.

## D. API requests and response handling

Only two operations are used, both `GET`:

- `GET /v1/meta/options` — once per mount, under the shared `["meta","options"]`
  key, 5 min stale, `MAD` fallback. Used only for the displayed currency symbol.
- `GET /v1/recommendations/{id}` — only when the seed carries a valid id
  (`enabled: id !== null`), 60 s stale, no placeholder. Disabled on the empty
  route, which is why `isPending` is passed as `seed.recommendationId !== null &&
detailQuery.isPending`.

States share one panel: loading (`role="status"` + `aria-busy`), ready, empty
(no `from`), not found (`404`, no retry), and error (retry button; 5xx and
`status: 0` are retried twice by the shared query client first). Prices go
through `formatPrice(amount, tPrice("currency"))`; a null total or `price_used`
stays absent and never renders `0`.

The browser suite stubs `**/v1/**` and asserts, in all 15 specs, that the stub
saw **no write** (any non-GET is recorded and answered `405`) and **no unmatched
API path** (`404`). No `POST` is stubbed at all.

## E. French and Arabic

Both dictionaries carry the same `Configurator` tree with identical
placeholders; `tests/i18n/messages.test.ts` fails on drift and is part of the
129 unit tests. Arabic renders `dir="rtl"`, the Arabic `h1`, Arabic role labels,
`د.م.` through `Price.currency`, and the `سعر إرشادي` badge — all verified in the
browser at `/ar/configurateur?from=…`. The locale switch carries
`use_case`/`budget` across `/fr` → `/ar`, and the radio stays checked.

API-served text (`disclaimer`, `explanation`) is rendered verbatim (C8), so it
remains French on `/ar`. Arabic copy is authored with key parity only and is
**not** native-approved; `docs/homepage-arabic-review.md` stays open.

## F. Desktop and mobile validation

- **Desktop (1280):** 7/5 grid, form card on the start side, summary as a sticky
  bordered panel with a hairline header, one row per component (muted role,
  strong name, price at the end), the disclaimer as a footnote, and one rank
  button per build with `aria-pressed`.
- **Mobile (360 × 800):** one column; the summary is a fixed bar above the
  existing nav with a 48 px toggle and an internally scrolling panel capped at
  `70dvh`. Measured: horizontal overflow `0`; bar bottom `560`, nav content top
  `560` (the bar covers the nav's 1 px top border, no content overlap); the last
  content card ends above the bar; submit, budget field and toggle are all
  ≥ 48 px.
- Continue moves focus to the summary heading, and the form's mount error is
  announced once (`role="alert"`) with the field error linked, not duplicated.
- The homepage regression suite still passes unchanged (5 specs), including the
  no-query locale switch.

## G. Commands and actual results

Run in one shell session at `apps/web-v2`, each exit recorded separately:

| Command                   | Result                                                              |
| ------------------------- | ------------------------------------------------------------------- |
| `npm run typecheck`       | exit 0                                                              |
| `npm run lint`            | exit 0                                                              |
| `npm run format:check`    | exit 0 — "All matched files use Prettier code style!"               |
| `npm run check:api-types` | exit 0 — "api types are up to date"                                 |
| `npm test`                | exit 0 — **129 passed (129)** in **24 files**                       |
| `npm run test:e2e`        | exit 0 — **44 passed** in 19.7 s (15 configurator + 29 existing)    |
| `npm run build`           | exit 0 — `ƒ /[locale]`, `ƒ /[locale]/configurateur`, 8 static pages |

Additional: `npx playwright test e2e/configurator.spec.ts --repeat-each=2` on a
cleared `.next` gave **30/30 passed**. Against the baseline, the suite grew from
98 to 129 unit tests and from 29 to 44 browser specs.

## H. Defects

1. **Dev-server cold-compile race (harness, fixed).** On a cleared `.next`, the
   first concurrent requests to a locale's configurator route made Next's dev
   server answer with `SyntaxError: Unexpected end of JSON input` and a
   dev-overlay error page instead of the app. It moved between `/ar` and `/fr`
   across runs and reproduced on a repeated identical URL. `e2e/global-setup.ts`
   warms both locales with two sequential, JavaScript-free GETs before workers
   start; the cold run is now green. Not a product defect, and not present in the
   production build.
2. **1 px bar/nav adjacency.** The bar's bottom and the nav's border-box top are
   both `560`/`559`; the bar covers the nav's top border. There is no content
   overlap. The spec compares against the nav's content box rather than its border
   box, and the geometry is documented rather than "fixed" with a magic offset.
3. **Test gaps (open, non-blocking).** There is no unit test for the locale
   switcher, although the Review Focus row names one (Task 3's file list never
   included it); behaviour is pinned by the browser locale-switch spec. There is
   no `ConfiguratorShell` test, so `isPending` and the `budgetText` default are
   covered only end to end.
4. **`next-env.d.ts` is rewritten by `npm run build`** (`./.next/dev/types` →
   `./.next/types`). It is a generated file; the change was reverted and is not
   part of this step.
5. **Task 4 item 14 wording.** "The last component row's bottom is above the
   bar" is not measurable at 360 px because the panel body is collapsed at that
   breakpoint; the spec measures the last content card instead.

## I. Git state, scope proof and commits

Scope proof at `5af192a` (empty output, exit 0):

```bash
git diff --stat dcff399 -- \
  apps/web-v2/components/home apps/web-v2/lib/homepage \
  "apps/web-v2/app/[locale]/page.tsx" apps/web-v2/app/globals.css \
  apps/web-v2/package.json apps/web-v2/package-lock.json apps/web apps/api
```

Commits on `feature/v2-design` since the baseline:

```
5af192a test(web-v2): add the configurator browser suite
3b695d2 feat(web-v2): add the configurator route, form and summary shell
64ad6cf feat(web-v2): add configurator queries and a build summary panel
0399cbf feat(web-v2): add configurator contracts and per-mount store
```

**Deviation:** brief §14 and the plan's Global Constraints said "do not commit or
push". The owner explicitly requested commits for Tasks 1–4, so four commits
exist on the feature branch and nothing was pushed. The README update and this
report are left uncommitted, as the plan's Task 5 requires.

Remaining working tree: `README.md` (this task) and this report, plus the
pre-existing screenshot/`scripts/screenshots.mjs` changes and the two untracked
paths. No V1 file, no lockfile, no `package.json` and no `apps/api` file changed.

## Hand-off

- **Verdict: PASS** for the configurator foundation, with the open test gaps in
  H.3 and the unsigned Arabic copy carried forward.
- **C1** locale switcher query preservation — done; implemented with
  `useSyncExternalStore` because the plan's `useState` + `useEffect` fails
  `react-hooks/set-state-in-effect`.
- **C2** `from` UUID validation — done in the local contract, no request on a
  malformed value.
- **C3** store owns `phase`/`requirements`/`recommendationId`/`activeBuildRank`;
  server data and loading/error stay in TanStack Query.
- **C4** Continue validates and shows the summary; it generates nothing.
- **C5** the form is not pre-filled from a loaded pass; the summary shows the
  pass's own use case and budget.
- **C6** the fixed bar sits above the mobile nav and the page reserves `pb-44`.
- **C7** only `**/v1/**` is stubbed; an unmatched API path or a write fails the
  spec.
- **C8** the API's `disclaimer`/`explanation` render verbatim, French on `/ar`.
- **C9** no copy claims generation, search or a future step.
- **D-3.2-1** the Continue empty-state copy (`Aucune configuration chargée` +
  its body) remains the owner's to replace.
- **D-3.2-2** `from`-only does not prefill the form; unchanged.
- **Arabic** is authored with key parity and is not native-approved.
- Step 3.3 was not started.
