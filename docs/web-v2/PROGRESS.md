# Phase 0 progress — web redesign

Branch `web-redesign` (created 2026-11-03 from `master` @ `e3fe882`). Plan: `PLAN.md`.
Implementation plan: `docs/superpowers/plans/2026-11-03-web-redesign-phase-0.md`.

Every row below was RUN on this machine unless it says BLOCKED. No `.env` value was read.

## Baseline 2026-11-03 (Task 2)

| Gate | Command (from `apps/web`) | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | PASS, no output |
| Lint | `npm run lint` | 0 | PASS with **2 warnings**: `mock/server.mjs:91` unused `VARIANTS_BY_SLUG`, `postcss.config.mjs:2` anonymous default export |
| Tokens | `npm run check:tokens` | 0 | PASS — 84 files, no hex / palette utility / physical side |
| i18n | `npm run check:i18n` | 0 | PASS — 82 files, 2 catalogues, keys + placeholders identical |
| API types | `npm run check:api-types` | 0 | PASS — contract 1.10.0, 10 paths, `schema.d.ts` byte-identical |
| Build | `npm run build` | 0 | PASS. `/sitemap.xml` + `/robots.txt` `ƒ`; guides, kit, tokens, legal `●`; `ƒ Proxy (Middleware)` |
| Suite | `npm test` | 0 | **379 passed / 2 skipped, 381 specs, 35.4 s** |
| Lighthouse | `npm run test:lighthouse` | 0 | PASS — all four `error` assertions, median of 3, both fixture URLs |

**The documented suite size is stale.** `AGENTS.md` says 378 specs / 376 passed / 2 skipped. Measured
today: **381 specs, 379 passed, 2 skipped**. Three specs were added since that line was written. Any
document asserting 378 is wrong; this file records the measurement.

The two skips are by design: `e2e/wizard-browser-api.spec.ts` (needs `E2E_BROWSER_API=1`) and
`e2e/wizard-engine.spec.ts` (the opt-in real-engine harness).

## Performance headroom (the binding constraint for Phases 2-6)

Measured medians of three runs, `lighthouserc.cjs` profile (360×800, throttled mobile):

| Fixture URL | LCP (median) | CLS | Script transfer | Performance |
|---|---|---|---|---|
| `/fr/config/<threeBuilds>` | **2 482 ms** (2 342 / 2 484 / 2 482) | 0 | **158 831 B** | 98 |
| `/fr/config-pc-gamer-9000-dh` | **2 486 ms** (2 874 / 2 483 / 2 486) | 0 | **167 107 B** | 98 |

Budgets are `error`-level: LCP ≤ 2 500 ms, CLS ≤ 0.1, script ≤ 174 080 B, performance ≥ 0.90.

Two consequences, and they are not negotiable:

1. **LCP has ~18 ms of slack on both routes.** A redesign that grows the above-the-fold tree — a
   bigger hero, an extra row of cards, a web font — will fail the gate on a slow runner. Every
   screen task in Phase 4 must re-run the Lighthouse gate, and the preset page is the one to watch
   (it already sampled 2 874 ms on one run).
2. **Script has 15 249 B of slack on the result page and only 6 973 B on the preset page.** The
   preset page is the binding route. Radix Dialog + cva + any icon set added to a route that shares
   their bundle is measured against 6 973 B, not 15 249 B — which is why `PLAN.md` requires a bundle
   measurement at gate G2 before the kit lands.

## Task ledger

| Task | Status | Commit |
|---|---|---|
| 1 Stitch source + `SCREENS.md` | **done** | b4b38a9 |
| 2 Baseline record | **done** | 7da1c0c |
| 3 `FEASIBILITY.md` + `API_REQUESTS.md` | **done** | see `git log` |
| 4 `@types/node` ^22 | **done** | see `git log` |
| 5 Two lint warnings | **done** | see `git log` |
| 6 `@tailwindcss/turbopack` decision | **done** — removed | see `git log` |
| 7 v1 reference captures | **done** — 78/78 | see `git log` |
| 8 Phase 0 exit record | **done** | this commit |

## Phase 0 exit record (2026-11-03)

Final gate set on the closing tree — every row RUN, none skipped:

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS — 0 warnings** (the two baseline warnings are fixed) |
| `npm run check:tokens` | **PASS** — 84 files |
| `npm run check:i18n` | **PASS** — 82 files, 2 catalogues |
| `npm run check:api-types` | **PASS** — contract 1.10.0 |
| `npm run build` | **PASS** — CSS chunk 73 169 B, referenced by every built page |
| `npm test` | **PASS** — 379 passed / 2 skipped (381 specs, 34.3 s) |

Delivered by this phase: the 22-screen design source plus `SCREENS.md`; the measured baseline;
`FEASIBILITY.md` (12 answers) and `API_REQUESTS.md` (5 gaps); `@types/node` 22.20.5; zero lint
warnings; the unused Turbopack plugin removed with build + dev + suite proof; 78 reference PNGs
(6.6 MB, 13 routes x 2 locales x 3 widths).

### Two lessons worth carrying forward

1. **A green build does not prove the styles ship.** Next 16 emits CSS to
   `.next/static/chunks/<hash>.css` (73 169 B here) and the build LOG prints no CSS line at all —
   grepping the log returns 0 on a healthy build. Assert the artifact and the `href` reference.
   The Phase 0 plan's Task 5 signal was wrong on this and has been corrected.
2. **A stale server makes the suite lie.** One run aborted at 115 passed because a dev server this
   session had started was reused by Playwright (`reuseExistingServer`) and then killed by its own
   `timeout`. The fresh run on clean ports was green (379 passed). Confirm 3210/3211/3000 are free
   before `npm test`, and stop servers by PID only.

### `apps/web-v2/` — decision recorded, not acted on

The source directory is now duplicated by `apps/web/design/stitch/`. It stays untracked; deleting
it is the owner's call (it is the only irreversible act in this phase) and is deliberately not done.

## Phase 1 — tokens (2026-11-03)

Status: **done**. Owner decision: DESIGN.md is adopted in full, superseding the earlier partial
adoption (D-03/D-04/D-05/D-06).

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 warnings |
| `npm run check:tokens` | PASS — 84 files |
| `npm run check:i18n` | PASS — 82 files |
| `npm run check:api-types` | PASS — 1.10.0 |
| `npm run build` | PASS |
| `npm test` | **PASS — 379 passed / 2 skipped** (381 specs, 34.4 s) |
| `npm run test:lighthouse` | **PASS** — LCP medians 2 485 / 2 488 ms, CLS 0, script 158 831 / 167 107 B, performance 98 |

What shipped: **67 raw colours + 13 aliases** (the 47-colour tonal ramp, the brand accents, the three
price trios), DESIGN.md's **full type scale** (including `display-lg` and `price`), the **Arabic +10 %
leading** via token overrides, 16 px cards, 10 px controls and the design's three elevation levels. The
token spec now pins 67 colours and 29 text + 5 graphical pairs.

Cost, measured: stylesheet 73 169 -> **89 663 B**; LCP 2 482/2 486 -> **2 485/2 488 ms** (budget
2 500). Headroom is now ~12 ms, which is why every later screen task re-measures instead of assuming.

`e2e/tokens.spec.ts` was changed deliberately (count + pair list), not weakened: the pairs are now the
design's own on-X / X guarantees, a stricter set than the ones they replaced.

## Phase 1 inherits

- Token gate baseline: **84 files** scanned; tokens live in `app/globals.css` `@theme` (the one file
  allowed a hex literal, and not scanned).
- Token source: `apps/web/design/stitch/moroccan_hardware_studio/DESIGN.md`.
- Budgets (all `error`, median of 3, two fixture URLs): LCP ≤ 2 500 ms (measured 2 482 / 2 486),
  CLS ≤ 0.1 (measured 0), script ≤ 174 080 B (measured 158 831 / 167 107), performance ≥ 0.90 (98).
  Headroom is thin — 18 ms of LCP and 6 973 B of script on the preset page.
- Four FEASIBILITY NOs to answer in `DEVIATIONS.md` at gate G2: per-part compatibility, images,
  retailer rows, price verification date — plus the single-build GET that D4 works around.
- Suite baseline: **381 specs, 379 passed, 2 skipped**. `AGENTS.md`'s 378 is stale.


## Phase 2 - kit (started 2026-11-03)

Task ladder: `docs/superpowers/plans/2026-11-03-web-redesign-phase-2.md`.

| Task | Status | Evidence |
|---|---|---|
| T1 deps: `@radix-ui/react-dialog` + `class-variance-authority`, imported by nothing yet | **done** | install exit 0 (radix 1.3.1, cva 0.7.1); `build` PASS; suite **379 passed / 2 skipped**; `test:lighthouse` PASS. Script bytes are identical to the G1 baseline on both fixtures (table below), because nothing imports them yet. |

Measured after T1 (median of three runs per route):

| Route | LCP (median) | CLS | Script (median) | vs G1 baseline |
|---|---|---|---|---|
| /fr/config/3f5a1c7e-8b2d-4e6f-9a01-5c3d7e9f1a2b | 2486 ms | 0 | 158831 B | +0 B |
| /fr/config-pc-gamer-9000-dh | 2487 ms | 0 | 167107 B | +0 B |

An unimported dependency costs 0 B. Had either figure moved, the bundler would be charging an unused dependency to a route and every later G2 number would be untrustworthy.

| T2 `Sheet` on Radix Dialog, imported by `/kit` only, measured before any screen uses it | **done** | Radix 1.3.1 kept: `build` PASS, suite green, Lighthouse PASS with both script figures at the G1 baseline (+0 B on the preset route). Decision recorded: the primitive stays OUT of the `@/components/ui` barrel, whose header promises hookless, non-client modules, so a client-only primitive cannot live there without breaking that contract. |

| T2b focus return (defect found by the new spec) | **done** | `trigger` and `returnFocusTo` are both explicit - Radix only restores focus to a `Dialog.Trigger`, so a controlled sheet opened by a plain button dropped focus to `<body>`. Kit spec asserts the accessible name, the trap, Escape and the return; suite **380 passed / 2 skipped** (the sheet spec is the +1). |

**Trap, cost two red runs:** the Playwright suite runs the PRODUCTION build, so a component source change is invisible to it until `npm run build` runs again. Rebuild before believing a spec failure - and before believing a pass.

| T3 `StatusBadge` (two build states) | **done** | `PASS` / `UNKNOWN` only - the engine rejects every other value, so a four-state vocabulary cannot be rendered without lying. Separate component, not a new `Badge` tone: the two unions must not mix. Label is a prop, so `messages/` stays the only source of words. |

**Third trap, cost four red suites:** leaving a `next start` or a fixture mock alive makes Playwright either REUSE it (an app started without `API_BASE_URL` fails exactly the four server-side-data specs) or, under `CI=1`, refuse to start at all - which reads as a red suite and is really no suite. `netstat -ano` here surfaces only TIME_WAIT rows for those ports and prints state localised, so port checks built on it lie; find the processes through `Get-CimInstance Win32_Process` (match `next` / `mock.server.mjs`) and confirm each port answers 000 with `curl --max-time 2` before believing a run.

| T4a colour-resolution audit + badge trios | **done** | An audit of every colour class against the defined `--color-*` names found ONE real casualty of the palette rewrite: `error-soft` vanished, so `Alert tone="error"` had been rendering with NO background since Phase 1 (invisible to `check:tokens`, which bans palette classes but cannot see a token that no longer exists, and to axe, because dark text on white still passes contrast). Restored as an alias to `error-container`. `Badge` now uses the design's own `price-*` trios instead of the generic success/warning pairs. |


**Decision recorded (2026-11-03):** the design's header bell and avatar are NOT shipped - no auth (D2), no notification source. Logged as D-14 so the Phase 3 shell does not re-introduce them as disabled icons.

| M1 CC0 media pipeline (`scripts/fetch-media.mjs`) | **done** | `sharp` 0.35.5 as a devDependency (build-time only). Queries Openverse with `license=cc0` ONLY, downloads, and emits AVIF+WebP at 360/720 plus `media/credits.json` + `CREDITS.md`; provenance is recorded even though CC0 needs no attribution. Assets are NOT wired into a screen yet - that is Phase 4 (home, guides), where LCP is measured. |

**Fourth trap:** anonymous Openverse is slow and dishonestly so - a probe answered **HTTP 500 after 45 s**, and the first queries of a session succeed while later ones stall, which looks exactly like a broken script. Retry with a widening pause and fail soft per slot; a cover image is never worth a red gate.

| T5 `StepHeader` + `ChoicePills` + `BudgetPicker` | **done** | `StepHeader` is the wizard's inline progress line, list and focus-target heading as one primitive; the wizard ADOPTS it in Phase 4 rather than being refactored now (a second owner of the flow's length is the bug it exists to prevent). `BudgetPicker` offers presets only, every one snapped through `snapToStep`, so the exact rail stays the single owner of arbitrary amounts; its labels come from an injected `format`, because a primitive that formats its own numbers is how a locale bug gets in. |

## Phase 2 — T6-T8 and gate G2 (2026-11-03)

**Phase 2 is closed.** T1-T5 landed in the previous session; this one added the remaining eight
primitives, rebuilt the gallery, and measured the gate.

| Task | Status | Evidence |
|---|---|---|
| T6 eight primitives | **done** | `BottomTabBar`, `StickyBar`, `PartRow`, `RetailerRow` (D-10 reduced), `SnapRow` + `SnapRowItem`, `TrustItem`, `BuildSummaryCard` (drawn fallback, D-01), `ExplainerSheet`. All eight are imported from their own module, never the barrel (D-15). Five tab-bar glyphs were added to `icons.tsx`. `e2e/kit-phase2.spec.ts` proves the one defect each could have: current-item announcement, link-vs-button, keyboard-scrollable scroller, a status badge OUTSIDE the `aria-hidden` drawn slot, a null price printing no number, a retailer row that is not a link, decorative glyphs, and the explainer's focus return. |
| T7 gallery + viewport | **done** | `/fr/kit` gained eight sections (tab bar, sticky bar, part rows, retailer rows, snap row, trust items, build card, explainer) rendered in real states; `app/[locale]/layout.tsx` now exports `viewport` with `viewportFit: "cover"`, which is what makes `env(safe-area-inset-bottom)` non-zero — the `Sheet`'s footer no longer sits under the home indicator (review finding P2 closed). |
| T8 G2 evidence | **done** | Bundle table and Lighthouse medians below; axe unchanged (`e2e/a11y.spec.ts` already walks `/kit`, so the new sections are inside the 51 checks); `DEVIATIONS.md` carries D-15…D-19 and the five FEASIBILITY NOs are answered. |

### Gate G2 — the bundle, measured on both fixtures

| Route | LCP (median of 3) | CLS | Script | vs 174 080 B | vs G1 baseline |
|---|---|---|---|---|---|
| `/fr/config/{id}` | 2 490 ms | 0 | **158 876 B** | 15 204 B spare | +45 B |
| `/fr/config-pc-gamer-9000-dh` | 2 485 ms | 0 | **167 321 B** | 6 759 B spare | +214 B |

Performance score 98 on both. LCP is still the tight one: 10 ms and 15 ms of slack, and one preset
run sampled 2 874 ms before the median of three absorbed it — the same tail the G1 record saw.

### The barrel was the 3 KB, and it was measured not guessed

The previous handoff left an open question: Phase 2 had grown the fixture bundles ~3 KB and the
suspect was the `@/components/ui` barrel re-exporting four primitives neither fixture renders.
An A/B rebuild settled it (2026-11-03):

| Build | `/fr/config/{id}` | preset route |
|---|---|---|
| four exports IN the barrel | 190 434 B | 189 557 B |
| four exports REMOVED | 189 024 B | 188 147 B |

**Exactly 1 410 B on both**, in one shared chunk (9 733 → 8 323 B gzip) — a re-export barrel is not
tree-shaken reliably by Turbopack. Removing them from the barrel and importing each primitive
directly recovered **2 882 / 3 191 B** as Lighthouse measures it, which is why the kit now costs
+45 B and +214 B instead of +3 KB. Recorded as **D-15**; the route is now a rule, not a one-off.

### Suite

**390 specs, 388 passed, 2 skipped** (34.9 s) — the two skips are the opt-in harnesses, unchanged.
The eight new specs are `e2e/kit-phase2.spec.ts`.

### One finding the new spec produced

The tab bar and the shell's header nav are BOTH named "Navigation principale" (`shell.navLabel`),
so a landmark lookup unions them — 11 links instead of 5. The spec scopes to the section instead,
because the defect is real: two landmarks sharing one accessible name. Phase 3 owns which name each
keeps; it is listed in `HANDOFF.md`.

## Phase 3 — shell (started 2026-11-03)

| Task | Status | Evidence |
|---|---|---|
| Landmark naming | **done** | Two landmarks shared "Navigation principale". Owner decision: the header keeps it (`shell.navLabel`), the mobile tab bar is "Navigation de l’application" / "التنقل في التطبيق" (`shell.tabNav`). Two landmarks with one accessible name cannot be told apart in a landmark list, and axe cannot catch it (`landmark-unique` is best-practice; the suite runs WCAG tags only) — so `e2e/shell.spec.ts` asserts the names differ. |
| Mobile tab bar | **done** | `components/shell/tab-nav.tsx` is the one client island (`usePathname` → which cell is current; longest path match, and a URL that matches no tab lights none rather than defaulting to home). Wired in the locale layout with five SHORT labels (`shell.tabItems.*`, fr + ar) — "Enregistrements" cannot fit a fifth of 360 px, so the bar says "Gardés" and the long name stays in the header, the footer and the page's h1. `md:hidden`, and `<body>` reserves the bar's height (released at `md`). |
| Covered-content guard | **done** | The new spec failed on its FIRST run and the failure was real: the bar is `h-20` + a 1 px top border = 81 px, while the reserved padding was exactly 80 px, so the last pixel of content could sit behind the border. `TAB_BAR_OFFSET` and `STICKY_BAR_OFFSET` now add the border, and the spec measures the reserved padding against the bar's measured box. |
| Footer clearance | **done** | The reservation was put on `<main>` first, which protects the last card but NOT the footer that follows it: measured in the browser at the bottom of `/fr` and `/fr/guides`, footer bottom **800 px** against bar top **719 px**, so the legal links sat behind the bar on every page. It lives on `<body>` now, and `e2e/shell.spec.ts` scrolls to the bottom and asserts the footer clears the bar — the assertion that fails if the reservation is ever moved back. |
| Error boundaries | **NOT STARTED** | `error.tsx` must be a client component and this app has no client-side message path (`next-intl`'s provider is not mounted — which is why `HeaderNav` and `TabNav` take labels as props). Mounting the provider (ships the catalogues to the browser) versus importing a static catalogue inside the boundary is a decision for the owner; the 404 (`not-found.tsx`) already exists. **G3 is not claimed.** |

Suite after the shell wiring: **394 specs, 391 passed, 2 skipped** (35.9 s).
