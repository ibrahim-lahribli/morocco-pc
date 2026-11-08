# Milestone 4 — Post-Implementation Quality, Stability & Production Readiness

Technical quality milestone for `apps/web-v2` on `feature/v2-design` (PR #17).
It audits and hardens the shipped Step 3.5 homepage. It is **not** product
acceptance: C11, C12 and C13 stay open (see §10).

Audited 2026-11-08. V1 (`apps/web`) and `apps/api` are untouched.

## 1. Verified starting commit

| Item                       | Value                                      |
| -------------------------- | ------------------------------------------ |
| Local `HEAD`               | `a9606614d107e9767f2dabf21fc24d31b3add52c` |
| `origin/feature/v2-design` | `a9606614d107e9767f2dabf21fc24d31b3add52c` |
| Divergence                 | `0/0`                                      |
| Working tree               | clean                                      |
| Branch                     | `feature/v2-design`                        |

The evidence-refresh commit was already published, so Milestone 4 started from
the exact published tip rather than an assumed state.

## 2. Scope of the audit

Read and reviewed in full: `app/**`, `components/**`, `lib/**`, `i18n/**`,
`messages/*.json`, `tests/**` (33 suites), `e2e/**` (81 specs), `scripts/**`,
`next.config.ts`, `proxy.ts`, `playwright.config.ts`, `.env.example`,
`package.json`. Grep sweeps covered dead markers (`TODO`/`FIXME`/`HACK`), type
escapes (`any`, `as unknown`, `@ts-ignore`, non-null assertions), logging,
`dangerouslySetInnerHTML`, `target="_blank"`, timers, listeners, environment
variable reads, heading levels and ARIA state.

Baseline before any change: typecheck/lint/format/api-types clean, 172 unit
tests, 81 e2e specs, 55/55 real-API checks, 14/14 responsive cells.

## 3. Findings and severity

| ID    | Area                            | Finding                                                                                                              | Severity | Outcome                                 |
| ----- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------- |
| M4-F1 | Reliability / performance       | No `queryFn` consumed TanStack Query's `AbortSignal`, so a read could not be cancelled at the transport layer        | Low      | Investigated, then reverted — see below |
| M4-F2 | Observability / maintainability | A `useEffect` that existed only to `console.warn` a missing preset detail shipped in the production bundle           | Low      | **Fixed**                               |
| M4-F3 | Maintainability                 | The `meta/options` read existed twice, with its own stale time, fallback currency, mapping and `queryFn` per surface | Medium   | **Fixed**                               |
| M4-F4 | Dependencies                    | 8 moderate advisories, all dev-only                                                                                  | Low      | Documented, deliberately not fixed      |
| M4-F5 | Accessibility                   | No defect found                                                                                                      | —        | No change                               |
| M4-F6 | Performance                     | No actionable defect found                                                                                           | —        | No change                               |
| M4-F7 | Security / configuration        | No vulnerability found                                                                                               | —        | No change beyond M4-F2                  |

### M4-F1 — request cancellation: implemented, measured, reverted

Forwarding the signal is normally the obvious improvement, so it was implemented
first — in all five reads — and then measured.

- `e2e/homepage-hero.spec.ts` and `e2e/configurator.spec.ts` pin **one** read per
  cache identity. With the signal forwarded, four specs failed with
  `GET /v1/presets?use_case=GAMING&currency=MAD` recorded **twice** (and the same
  for a configurator detail).
- Reverting only the signal forwarding, leaving every other change in place,
  returned those specs to `6 passed`.
- Mechanism: under React 19 StrictMode, `next dev` mounts, unmounts and remounts
  a tree. Consuming the signal lets TanStack Query v5 abort the in-flight request
  on that cycle and re-issue it; not consuming it keeps the single in-flight
  request shared by both mounts.

The abort only ever saved dev-time bandwidth, while the dedupe contract is a
product invariant worth more. The forwarding was therefore not shipped, and the
reason is recorded next to the code in `lib/homepage/use-presets.ts` and
`lib/api/meta.ts` so the next reader does not re-attempt it blind.

## 4. Changes implemented

| File                                            | Change                                                                                                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/home/recommended-build-section.tsx` | Removed the log-only `useEffect`, its `console.warn` and the now-unused `useEffect` import. The 404 branch keeps its meaning (expected empty state, no failure line, no retry) in a comment instead. |
| `lib/api/meta.ts`                               | **New.** Single owner of the vocabulary read: `META_STALE_TIME_MS`, `FALLBACK_CURRENCY`, `MetaOptions`, `useMetaOptions`.                                                                            |
| `lib/homepage/use-presets.ts`                   | The meta hook and its constants moved out; re-exported so the homepage keeps one import path and its existing module mocks stay valid. Header records the M4-F1 decision.                            |
| `lib/configurator/queries.ts`                   | `useConfiguratorCurrency()` now delegates to `useMetaOptions()`; its duplicate constants and `queryFn` are gone.                                                                                     |
| `tests/homepage/detail-404.test.tsx`            | **New.** Pins the silent 404: budget line kept, no alert, no retry, no `console.warn`. Fails against the pre-change code.                                                                            |
| `tests/api/meta-sharing.test.tsx`               | **New.** Pins one `meta/options` request when the homepage and the configurator both mount.                                                                                                          |

No homepage design, copy, layout, breakpoint, flag or API contract changed. The
default `MAD` currency and the third-party behaviour of `meta/options` are
identical; only the number of copies of that logic changed.

## 5. Tests executed

Run from `apps/web-v2` unless stated otherwise.

| Check             | Command                                                                  | Result                        |
| ----------------- | ------------------------------------------------------------------------ | ----------------------------- |
| TypeScript        | `npm run typecheck`                                                      | 0                             |
| ESLint            | `npm run lint`                                                           | 0 (no warnings)               |
| Prettier          | `npm run format:check`                                                   | 0                             |
| API contract      | `npm run check:api-types`                                                | 0, "api types are up to date" |
| Unit              | `npm test`                                                               | **174 passed**, 33 files      |
| E2E               | `npm run test:e2e`                                                       | **81 passed**, 31.6 s         |
| Production build  | `npm run build`                                                          | 0                             |
| Real API          | `VERIFY_BASE_URL=http://localhost:3220 node scripts/verify-real-api.mjs` | **55/55**, exit 0             |
| Responsive matrix | `MEASURE_SOURCE=served` + `scripts/measure-step35.mjs`                   | **14/14** cells, 0 failures   |
| Docs              | `node scripts/verify-docs.js --offline` (repo root)                      | OK                            |
| Production deps   | `npm audit --omit=dev`                                                   | 0 vulnerabilities             |

The real-API and responsive runs used a production build
(`next start -p 3220`) built with
`NEXT_PUBLIC_API_BASE_URL=https://morocco-pc-api-eu.onrender.com`, against the
live API (`/v1/health` → `{"status":"ok","db":"ok","engine_version":"d2de4fb"}`).
Screenshots went to a scratch directory, so the committed served and fixture
evidence sets were not overwritten.

## 6. Test results

- Unit: **174** (baseline 172, +2). Both additions are regression tests for the
  fixes above; `detail-404` was verified to fail before its fix.
- E2E: **81 passed**, the same suite as the milestone baseline. Nothing was
  skipped, disabled or loosened; the four specs that M4-F1 tripped are green
  because the behaviour they pin was preserved, not because they were edited.
- Served data unchanged: hero `56,9/100` / `56.9/100` and `11 946 DH` / `11 946 د.م.`;
  cards `11 946`, `9 247`, `11 995`; `overflow=0` in all 14 cells; `dir=ltr|rtl`
  per locale; hero hidden below `lg` as designed; `footerClear=true` on mobile.

## 7. Performance observations

Measured, not assumed — and no optimisation shipped, because none was
demonstrated.

- Production build: three routes, `/` and `/[locale]` and
  `/[locale]/configurateur` all dynamic (`ƒ`), `/_not-found` static, plus the
  locale proxy. Nothing is prerendered because the page reads the locale and, in
  the client islands, the API.
- Client JavaScript: **891 215 B** across chunks after the change (891 347 B
  before it, so the removed effect and the de-duplicated module also shaved
  ~130 B). The largest single chunk is **229 288 B**, then 165 557 B, 133 511 B and
  112 594 B — framework/runtime plus TanStack Query, zustand, next-intl and the
  per-icon `lucide-react` imports.
- Assets: the page loads **no image at all** (card media and the hero are
  decorative placeholders, which is exactly what C11 keeps open), so there is no
  image-weight, `sizes`, `priority` or LCP-image work available here.
- Requests: one ladder and one detail per cache identity is already pinned by
  e2e; M4-F1 protected it. No duplicate reads were introduced.
- Rerenders: no measurable problem was found, so no memoisation was added —
  adding it would have been the speculative change this milestone rules out.

Web Vitals budgets are not enforced for `apps/web-v2`; `apps/web` runs Lighthouse
in its own workflow. Adding an equivalent budget here would need its own
threshold study and is left as a recommendation, not a silent prerequisite.

## 8. Accessibility findings

No defect found, so no accessibility change was made. Verified:

- One `<h1>` (the hero) and no skipped levels: `h1 → h2` sections `→ h3` cards.
- A global `:focus-visible` outline (`2px solid var(--color-primary)`, offset 2)
  with no `outline: none` that removes focus without a replacement; buttons and
  fields use `focus-visible:ring` deliberately.
- Both finder questions are `<fieldset>` + `<legend>` groups of native radios;
  the custom budget field carries `aria-invalid`, `aria-describedby` and a single
  `role="alert"` message.
- Heading ids are unique per slot (`aria-labelledby`), skeletons announce via
  `role="status"` under `aria-busy`, and `prefers-reduced-motion` is honoured
  globally.
- The existing `e2e/homepage-a11y.spec.ts` (7 specs: accessible names, heading
  order, focus order, 44 px targets, contrast, finder announcements, no console
  error) and the configurator's heading/fieldset/target specs all pass unchanged.

## 9. Security findings

- **Environment variables:** only `NEXT_PUBLIC_SITE_URL`,
  `NEXT_PUBLIC_API_BASE_URL`, `API_BASE_URL`,
  `NEXT_PUBLIC_HOMEPAGE_SUBMIT` and `NEXT_PUBLIC_GUIDES_ENABLED`. The public ones
  are inlined by design; `API_BASE_URL` is server-only and never read by a client
  component. `.env.example` carries placeholders, no secret is in the tree, and
  `.env*` is ignored.
- **Rendering:** no `dangerouslySetInnerHTML`, no `innerHTML`, no user-supplied
  markup path. Server copy comes from the locale dictionaries.
- **Links:** there are no external links and no `target="_blank"`, so no
  `rel="noopener"` surface exists; unfinished destinations render as
  `aria-disabled` text rather than dead links.
- **Logging:** the single `console.*` call in `app|components|lib` was M4-F2 and
  is gone; no identifier, price or token is logged.
- **Auth:** the API has no authentication, and the app sends no credentials, so
  there is no token storage or exposure path.
- **Dependencies:** `npm audit --omit=dev` → **0 vulnerabilities**. The full audit
  reports 8 moderate, all dev-only (M4-F4).

### M4-F4 — why the dev advisories stay

`minimatch 7.0.0–11.0.0` (glob ReDoS) reaches the tree through
`@typescript-eslint/typescript-estree` ← `eslint-config-next` ← `typescript-eslint`.
`npm audit fix --force` resolves it by installing `eslint-config-next@15.5.29`,
which is a downgrade of a Next 16 project's lint config — a breaking change to the
toolchain for a linter-time DoS. It is not reachable from any shipped bundle.
Revisit when `eslint-config-next` moves to a fixed `typescript-eslint`.

## 10. Known limitations and deferred acceptance

Unchanged by this milestone and not closable by engineering:

| Criterion                  | Status   | Note                                                                                                                     |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| C11 — Approved imagery     | **OPEN** | Card media and the hero remain decorative placeholders; no stock or generated image was introduced.                      |
| C12 — Native Arabic review | **OPEN** | No native reviewer has signed `homepage-arabic-review.md`; the automated parity and RTL checks do not substitute for it. |
| C13 — Owner acceptance     | **OPEN** | No owner acceptance has been recorded.                                                                                   |

Other deliberate limits: the mobile hero stays hidden below `lg`; the finder
issues no `POST` (the submit flag stays off) and hands its answers to the
configurator as query parameters; guide routes stay gated off; there is no
authentication anywhere.

## 11. Remaining technical risks

1. **Requests cannot be aborted at the transport layer** (M4-F1). A read issued
   just before a navigation completes into a cache entry nobody reads. Accepted
   deliberately; retrying it requires revisiting the "one read per cache
   identity" specs at the same time.
2. **8 dev-only advisories** (M4-F4) sit in the lint toolchain until
   `eslint-config-next` picks up a fixed `typescript-eslint`.
3. **No Web Vitals budget for `apps/web-v2`.** Real-API checks assert
   correctness and no-overflow, not performance thresholds.
4. **`useConfiguratorCurrency` allocates a small object per render.** Harmless at
   this size; becoming a memoisation candidate only if a measured rerender cost
   appears.

## 12. Commits

| Purpose                            | Commit                                          |
| ---------------------------------- | ----------------------------------------------- |
| Source fix + both regression tests | `83e76f505cd4b56151c022add07d09216a45cbb1`      |
| This report                        | the commit that adds this file, directly on top |

Branch: `feature/v2-design`. Nothing was pushed as part of Milestone 4; the
branch head above the published `a960661` is local until the owner authorises a
push.

## 13. CI verification status

Not yet run for these commits: they are local only. The previous tip
(`a960661`) is green on GitHub Actions — `web-v2` run 42466363253, every step
success. A push will trigger the same seven gates (`typecheck`, `lint`,
`format:check`, `check:api-types`, `npm test`, `build`, `test:e2e`) on
`83e76f5`; all seven pass locally on this exact tree, which is the pre-push
evidence available today.
