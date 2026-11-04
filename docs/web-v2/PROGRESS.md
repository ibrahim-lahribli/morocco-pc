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

Lighthouse re-measured after the shell (`npm run test:lighthouse`, exit 0, median of 3):

| Route | LCP | CLS | Script | vs 174 080 B | at G2 |
|---|---|---|---|---|---|
| `/fr/config/{id}` | 2 495 ms | 0 | **168 700 B** | **5 380 B** | 158 876 B |
| `/fr/config-pc-gamer-9000-dh` | 2 490 ms | 0 | 167 428 B | 6 652 B | 167 321 B |

The tab bar ships to every route, so it reaches both fixtures: ~9.8 KB on the result page and ~0.1 KB
on the preset (which already shared the chunk). **The binding route flipped to the result page**, and
LCP is 5 ms / 10 ms from its budget — the wall Phase 4 has to build against.

## Phase 3 — review fixes (2026-11-03)

Four findings from a two-axis review of `8e90286..2281a42`. Every one is mechanical: no change a
user can see, and no assertion weakened.

| Fix | Where | What was wrong |
|---|---|---|
| Footer docblock | `app/[locale]/layout.tsx` | f668862 inserted `type TabItemRow` between the S22 comment and `FOOTER_LINKS`, so the comment documented the new type and `FOOTER_LINKS` had none. Each block now leads its own declaration. |
| Offset comment | `components/ui/bottom-tab-bar.tsx` | The file still said `TAB_BAR_OFFSET` is the class the shell puts on `<main>`; d761355 moved it to `<body>`. The constant's own doc now also counts the 1 px border it reserves. |
| Section boundary | `components/shell/tab-match.ts` (new), `tab-nav.tsx` | The bar matched `rest.startsWith(path)`, so a future `/composants-x` sibling would have lit "Pièces". `header-nav.tsx` documents the guard (equal path, or the path plus a trailing slash); both navigations now share one rule, in one module. |
| Boundary spec | `e2e/shell.spec.ts` | New pure case pins `/composants-x` to no lit tab. Deliberately unit-shaped: `/fr/composants-x` renders Next's bare 404, which carries NO `nav` element (measured 2026-11-03), so a navigation-based assertion would have passed for the wrong reason. |

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 warnings |
| `npm run check:tokens` | PASS — **102 files** (the handoff recorded 100) |
| `npm run check:i18n` | PASS — **100 files** (the handoff recorded 98) |
| `npm run check:api-types` | PASS — contract 1.10.0 |
| `npm run build` | PASS |
| `npx playwright test e2e/shell.spec.ts` | PASS — **9/9** |
| `CI=1 npm test` | PASS — **392 passed / 2 skipped** (394 specs); one earlier run of the same tree reported **1 flaky on retry** (`e2e/wizard-budget.spec.ts` "a field below the minimum clamps to it on blur" — a pre-existing timing flake, unrelated to the shell and green on retry) |

**Not fixed here, recorded so the gate is not misread.** The same review re-ran
`npm run test:lighthouse` on this tree and it **exited 1**: the result route's LCP median is
**2 503 ms** against the 2 500 ms budget (runs 2 503 / 2 493 / 2 559). The Phase 3 row above records
2 495 ms — the same measurement at the margin, not a contradiction — and the tab bar's ~9.8 KB on
that route is what moved it there. That is the next action, not a documentation edit.

## Phase 3 — the `md+` header nav, settled by the design (2026-11-03)

HANDOFF left this as an owner decision: hide the header's page links below 768 px, or keep them and log
a `DEVIATIONS` row. **The design settles it, so no owner input was needed.** The Stitch
`accueil_morocco_pc` screen at 360 px carries the brand and the language control and — per D-14 —
nothing else in the header, and PLAN.md's Phase 3 line already says "`md+` top nav". Keeping the links
would have been the departure, and the visible one: measured in the browser at 360 px on the handed-off
tree, the header nav is **118 px** tall (two rows: brand + switcher, then three links) on every phone
page, duplicating three of the five tab cells.

| Change | Where |
|---|---|
| the list is `hidden md:flex` (`display:none` below 768 px, so no layout cost) | `components/header-nav.tsx` |
| a new spec pins hidden at 360 / visible at 768 | `e2e/shell.spec.ts` (the 10th spec) |
| the two comments that described the old wrap now describe the breakpoint | `app/[locale]/layout.tsx` |

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — exit 0, **1 warning, from a gitignored scratch probe** (see the note) |
| `npm run check:tokens` | PASS — 102 files |
| `npm run check:i18n` | PASS — 100 files |
| `npm run build` | PASS |
| `npx playwright test e2e/shell.spec.ts` | PASS — **10/10** |
| `CI=1 npm test` | PASS — **393 passed / 2 skipped** (395 specs, 36.5 s) |
| `npm run test:lighthouse` | **PASS** (exit 0) — LCP medians **2 481 ms** (preset) / **2 494 ms** (result) |

**The LCP gain is NOT claimed.** Removing a header row was the obvious candidate for the 6 ms of slack
this branch has lived on, and the medians moved 2 492 -> 2 481 ms and 2 500 -> 2 494 ms: **inside the
±60 ms noise** this box produces. Measured, reported, not credited. The gate now clears its line by
6 ms, which is luck rather than headroom.

### Mining the `.lighthouseci` reports (do not re-derive)

`tmp/lh-probe.mjs` and `tmp/lh-deep.mjs` read the reports already on disk — no rebuild. On both
fixtures, from the newest runs: **observed LCP = observed FCP = 159-175 ms**, TTFB 4-16 ms, the single
48 732 B `woff2` arriving at 11-26 ms, the 16 475 B stylesheet at 23-28 ms, `unused-css-rules: 0`,
`font-display: 0`, `render-blocking-resources` 0 on the result route (1 on the preset, 304 ms
wasted), main-thread total ~95-102 ms with only **two tasks over 10 ms**, and exactly one long task
(77 ms) starting at 2 558 / 2 707 ms — after LCP.

So the 2 045 ms "render delay" is arithmetic of the simulator, not a slow paint path: every resource the
paint could wait on has arrived inside the first 30 ms, and nothing blocks the main thread for 77 ms
until after LCP. Per HANDOFF's own decision rule the two ablations it proposed (system font stack, drop
`@layer components`) are therefore **not** the lever and were not run — each costs a build plus a
median-of-3 (~6 min) to answer a question the on-disk evidence already answers.

**Note on the lint warning.** `npm run lint` exits 0 with one warning while `apps/web/tmp/` exists:
`tmp/validate-shell.mjs`, a gitignored scratch probe from the previous session, is inside eslint's
scope. On tracked files only it is 0 warnings, which is what HANDOFF recorded. The scratch probe was
left in place rather than deleted — it is the previous session's working evidence.

## Phase 3 — the error boundary, and the budget it had to fit (2026-11-03)

`app/[locale]/error.tsx` is the app's ONLY client component that cannot be handed its copy as props:
Next renders a boundary IN PLACE of the segment, so no server parent reads the catalogue for it. The
obvious fix — mount `NextIntlClientProvider` with just the `errors` namespace — was built and MEASURED
before it was kept, and it fails the gate outright:

| Variant | Result script | Result LCP | Verdict |
|---|---|---|---|
| before any boundary | 168 710 B | 2 494 ms | within budget |
| `NextIntlClientProvider` + `errors` only | **184 555 B** (+15 845) | **2 643 ms** (+149) | **fails both assertions** |
| generated plain-object copy (SHIPPED) | **172 495 B** (+3 785) | **2 480 ms** | **PASS — 1 585 B of margin** |

Preset route, same runs: 171 223 B (was 167 438, also +3 785) and LCP 2 484 ms — 2 857 B of margin.

So the copy is mirrored at build time, the pattern this repo already uses for
`docs/DECISION_INDEX.md` and `docs/SCHEMA_REFERENCE.md`:

| Piece | What it does |
|---|---|
| `scripts/gen-error-copy.mjs` | derives `lib/i18n/error-copy.generated.ts` from the `errors` namespace; `--check` is a staleness gate |
| `lib/i18n/error-copy.generated.ts` | the plain object the boundary reads — seven strings per locale, no ICU runtime |
| `check:i18n` **rule 7** | FAILS while the generated file is stale, so the catalogues stay the single source of truth |
| `app/[locale]/error.tsx` | the boundary: `Alert` at `error` tone, retry (`reset()`), home (`LinkButton`), the digest when Next supplies one |

**Proof it renders** — a throwaway `app/[locale]/boundary-probe` route that threw, built, visited at
360 px in BOTH locales, then deleted and rebuilt (the build log carries no `boundary-probe` line):

| Locale | Result |
|---|---|
| `/fr` | 500 · h1 "Cette page n'a pas pu s'afficher" · error-tone `Alert` · 1 retry button · 1 home link · digest "Référence de l'erreur : 521710552" |
| `/ar` | 500 · h1 "تعذّر عرض هذه الصفحة" · the same controls · digest "مرجع الخطأ: 521710552" |

The shell survives around the boundary (4 `nav` landmarks), which is the point of a segment boundary
rather than a global one.

**Trap, cost one wrong conclusion:** a folder whose name starts with `_` is PRIVATE to Next's router, so
the first probe answered **404** — and Next's built-in "This page couldn't load" page read exactly like a
broken boundary until the 404 status gave it away.

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (exit 0) |
| `npm run check:tokens` | PASS — **104 files** |
| `npm run check:i18n` | PASS — **101 files**, 2 catalogues, and rule 7 fresh |
| `npm run check:api-types` | PASS — contract 1.10.0 |
| `npm run build` | PASS |
| `CI=1 npm test` | PASS — **393 passed / 2 skipped** (395 specs, 37.6 s), no flakes this run |
| `npm run test:lighthouse` | **PASS** (exit 0) — LCP 2 480 / 2 484 ms, CLS 0, performance 0.98, script 172 495 / 171 223 B |

**A flake that widened:** an earlier run on the same tree reported **4 flaky**, and all four were the
wizard's budget field (`wizard-budget.spec.ts` 76, 94, 220 and `wizard.spec.ts` 108). HANDOFF knew about
one of them; this is a family in one component, not a lone test.

## The plan file Phase 3 was missing (2026-11-03)

Phases 0 and 2 each opened with a written plan in `docs/superpowers/plans/`; phase 3 went straight into
code. That gap is not cosmetic — it is why the header/footer restyle and the `md+` half of PLAN.md's
Phase 3 line went unnoticed until a review found them. `2026-11-03-web-redesign-phase-3.md` now exists, in
the same compact ladder register as phase 2: T1-T5b are recorded as landed **with their commits**, T6-T8
are the open work, and four decisions are written down BEFORE the restyle so they are not discovered
mid-build:

| Fork | Why it is a decision, not a detail |
|---|---|
| the logo tile | the export's mark is a **remote placeholder** `<img>` on `lh3.googleusercontent.com` — not an asset, and a third-party request on every page |
| the page subtitle ("Accueil") | it would be a **second owner of the page's name**, the thing this repo keeps single-owner (cf. `StepHeader`) |
| a **fixed** header | the design's is `fixed top-0 pt-safe`; ours is static, and `fixed` changes the scroll/paint path on both measured routes |
| the saved-shelf badge | **D-14 removed the bell and the avatar only** — the bookmark-with-count is a third control, and shipping it means a client island on every route, counted against 1 585 B |

It also corrects one assumption, and then corrects the correction: the footer **has** a reference, but
only **2** of the 22 Stitch screens draw a page footer (`accueil_morocco_pc`, `morocco_pc_1`). The other
two `<footer>` hits (`comparer_morocco_pc`, `configurateur_2`) are **sticky action bars** — the compare
screen's "Ouvrir Équilibré / Performance" row and the configurator's "متابعة" button. A tag count is not a
landmark count: corrected 2026-11-03 by reading the blocks, before writing any T7 markup.

## T6 — the header restyle (2026-11-03)

The design's header, drawn with tokens that already existed: no new dependency, no new token, and **no new
JavaScript** — the mark is rendered in the server layout, so it arrives as HTML.

| Measured | Before T6 | After T6 |
|---|---|---|
| header height (360 px, fr and ar) | 71 px (118 px before T5) | **64 px** (`h-16`, the export's `h-16`) |
| brand block · switcher | — | 131 px · 132 px (fr) / 134 px (ar) |
| header page links at 360 / 768 | 0 / 3 | 0 / 3 (unchanged) |
| horizontal overflow at 360 | 0 | **0** |
| script, result route | 172 495 B | **172 501 B (+6)** |
| script, preset route | 171 223 B | **171 229 B (+6)** |
| CSS transfer | 16 475 B | 16 528 B (+53) |
| LCP medians (result / preset) | 2 480 / 2 484 ms | **2 490 / 2 489 ms** |
| `npm run test:lighthouse` | exit 0 | **exit 0** |

**+6 B of script for a whole header restyle** is the number to remember: the mark, the pill and the row
geometry are all CSS/HTML, so the client island's payload did not move. The LCP medians shifted +10/+5 ms,
which is inside this box's ±60 ms noise; the margin is now ~10 ms.

| Gate | Result |
|---|---|
| `npm run typecheck` · `lint` · `check:tokens` · `check:i18n` | PASS (i18n 101 files, 2 catalogues) |
| `npm run build` | PASS |
| `CI=1 npm test` | PASS — **392 passed / 2 skipped**, 1 flaky (395 specs) |
| `npm run test:lighthouse` | **PASS** (exit 0) |

**A fifth sighting of the budget-flake family, on a tree with none of the other agent's edits:** the flaky
was `e2e/wizard-budget.spec.ts:260` ("/ar/configurer speaks Arabic about the same clamp"), which passed on
retry. Recorded because it is independent evidence for the fix in flight.

Four departures are recorded rather than absorbed: **D-22** (the mark is drawn, not the export's remote
`<img>`), **D-23** (no page subtitle — a second owner of the page's name), **D-24** (the header is not
`fixed`; that lands as its own measured change) and **D-25** (no saved-shelf badge — it would duplicate a
tab cell and needs a client island). What IS adopted: the 64 px row, the soft shadow instead of a
`border-b`, the top safe-area padding (matching the tab bar's bottom one) and the pill switcher.

## T7 — the footer restyle (2026-11-04)

The footer is now the export's centred column: wordmark, the two link rows, then the price line, with no
hairline and no `border-t`, geometry `mt-10 pt-6 pb-4` taken from `morocco_pc_1`, and the legal row drawing
its `·` as a `before:` pseudo-element so each list item stays exactly one link.

| Measured (local `next start`, 3 Lighthouse runs per route) | pre-T7 (`16528` B CSS) | T7 (`16638` B CSS) |
|---|---|---|
| script transfer, result route | 172 501 B | **172 501 B** (unchanged) |
| result-route LCP samples @ 00:31 / 00:45 | 2 493 / 2 490 / 2 487 · 2 492 / 2 488 / 2 488 | — |
| result-route LCP samples @ 00:43 / 01:14 | — | **2 662 / 2 634 / 2 624 · 2 655 / 2 640 / 2 635** |
| preset-route median | 2 481 · 2 486 | 2 495 (2 475 / 2 495 / 2 873) · 2 491 (2 491 / 2 877 / 2 475) |

**The T7 tree is RED on the binding gate.** `npm run test:lighthouse` exits 1: result-route LCP median
**2 640 ms** against the 2 500 ms budget, and a third A/B in one session ties it to the footer — the
pre-T7 layout rebuilt and measured exits 0 (2 490 / 2 486 / 2 480), the T7 layout rebuilt and measured
exits 1 (2 641 / 2 640 / 2 632). What the footer does NOT do is cost the browser 150 ms. The LCP phase
tables are identical in both builds — TTFB 454 ms, load delay 0, load time 0, **render delay
2 022-2 423 ms** — and the OBSERVED LCP stays inside a 20 ms band (169-191 ms T7, 171-186 ms pre-T7)
while the SIMULATED figure moves 2 480 -> 2 640. FCP (906-919), Speed Index and TBT (18-43) do not move
either, so the gate is amplifying a trace difference the browser does not show: the candidate is a text
block carrying ~2 s of render delay under 4x CPU throttling. The preset fixture shows the same knife
edge — 2 490 / 2 711 / 2 877 in ONE run set on ONE build.

The remaining work is a DECISION, not a shave: make the hero `h1` the LCP candidate so it paints before
that block, cut above-the-fold work, or re-baseline the budget with owner approval (thresholds are never
edited to fit). **G3 is not claimed.**

| Gate | Result |
|---|---|
| `typecheck` · `lint` · `check:tokens` (104) · `check:i18n` (101) · `check:api-types` | PASS — `lint` reports 2 warnings, both in the gitignored `tmp/validate-shell.mjs` |
| `build` | PASS |
| `CI=1 npm test` | **FAIL** — 391 passed / 2 skipped / 1 failed + 1 flaky, all `wizard-budget` (the known family: `--repeat-each=3` on that file gives 27 passed / 3 flaky / exit 0) |
| `npm run test:lighthouse` | **FAIL (exit 1)** — 2 640 ms |

Visual check at 360 and 768 in both locales on the built app: footer centred, RTL mirrored, four `nav`
landmarks with distinct names, `scrollWidth - clientWidth = 0`, every `li` holding exactly one link.
One defect WAS visible at 360 px in **both** locales: the legal row wraps and, because the separator was
drawn on the `li`, the wrapped line started with a dangling `·` ("· Formats (démo)"). **FIXED 2026-11-04**
— the separator is now a trailing `aria-hidden` span, so a wrapped line starts with the link, and
`legal.spec.ts` still finds exactly one link per item.

Departure: **D-26** (no `© 2026` clock line in the shell; the catalogue sentence states the same unit).
Two corrections this task produced: the footer count is **2** of 22, not 4 (`comparer_morocco_pc` and
`configurateur_2` are `fixed bottom-0` action bars), and the screenshot reference is the **tracked**
`apps/web/design/stitch/accueil_morocco_pc/screen.png` (`b4b38a9`) — `apps/web-v2/` is only the staging
duplicate Phase 0 deliberately left in place (see this file's `apps/web-v2/` note), never a missing asset.

## T7 follow-up — the budget on the runner (2026-11-04)

Option (d) of the attribution: push and let the runner judge. `web-redesign` was pushed, and the two
runs either side of this branch's tip were read from their own artifacts. **The gate flips on CI too,
in both directions:**

| run | commit | result-route LCP (3 samples) | median | preset median | verdict |
|---|---|---|---|---|---|
| 41749830494 | `95bfa33` (tip before this branch's work) | 2251 / 2528 / 2546 | **2528** | 2371 | FAIL |
| 41758093817 | `e6bdc09` (this branch's tip) | 2471 / 2481 / 2602 | **2481** | 2414 | **PASS** |

Same route, a 351 ms spread across samples (2251–2602), and the failing run carried one 1626 ms TBT
sample (perf 72) — runner noise, not a page property. The LCP candidate in every sample is body text:
`div[data-effect="APPLIED"].text-body` on the result route and `p.mt-2.max-w-prose` on the preset.
The `h1` (`text-heading`, 28 px) is smaller than both, which is the mechanism behind option (a): making
the title the largest painted element moves the candidate earlier instead of moving the number.

**G3 criterion 3 is therefore MET with evidence** — a green median-of-3 run on both fixtures, numbers
above, script 172 564 B against the 174 080 B budget (13 steps, 260 s). The margin is recorded, not
celebrated: 19 ms above the line here, and the same route failed by 28 ms two hours earlier. A future
red of this shape is variance until proven otherwise — but it is still a red, and option (a) remains the
only change that buys real headroom.


## Task 1 — D7 Arabic currency label (2026-11-04)

`CURRENCY_LABEL.ar` is `د.م.` (fr stays `DH`), one line in the allowlisted `lib/i18n/format.ts`
(D-27). The Arabic catalogues follow: `wizard.budgetSuffix`, `share.ogDescription`, and every
sentence-final stop that followed a money placeholder — `د.م.` already ends in a full stop, so the
old trailing `.` printed `د.م..` on the result page and in the wizard hints.

Specs: `i18n` and `rtl` assert the exact Arabic strings; the `wizard-budget` Arabic rail's three
key assertions use `AR_DH_*` rather than the French constants. The preset OG card no longer
hardcodes `formatMoney(…, "fr")`: it reads the route locale, so `/ar/…/opengraph-image` draws
`د.م.` (the card's default face draws it — measured 2026-11-04, no OG font added). Supporting card copy stays
French on both cards by D-28; Phase 6 owns the OG restyle.

| command | result |
|---|---|
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS (exit 0, 0 warnings) |
| `npm run check:tokens` | PASS — 104 files |
| `npm run check:i18n` | PASS — 101 files, 2 catalogues |
| `npm run build` | PASS (exit 0) |
| `npx playwright test e2e/{i18n,rtl,wizard-budget,structured-data,seo,saved,share}.spec.ts` | **PASS** — 82 passed |

JSON-LD is untouched: `priceCurrency: "MAD"` in both locales, pinned by `structured-data` and `seo`.
Evidence: `apps/web/design/checks/d7-arabic-price-360.png` and the two `d7-og-*-ar.png` cards.

Observed while validating: one parallel run failed the Arabic rail's `ArrowUp` assertion with the
PREVIOUS value (`7 000`), and the same test passes standalone 3/3 and in the final parallel run.
The sequence races its URL writes when successive presses land faster than a commit (the
`budget-step.tsx` `choose` path), which D7 does not touch. It is a pre-existing flake, carried
as a separate finding — no assertion was relaxed for it.

## Task 3 — S2 direct primitive imports in the error boundary (2026-11-04)

`app/[locale]/error.tsx` imported `Alert`, `Button` and `LinkButton` from the
`@/components/ui` barrel. It now names each file (`alert`, `button`). Measured with `npm run test:lighthouse` — script
transfer bytes, median of 3 — on both fixture URLs, before and after, each from a fresh
`next build`:

| fixture | before (`fc937c3`) | after | delta |
|---|---|---|---|
| `/fr/config/3f5a…` | 172 652 B | 170 913 B | **−1 739 B** |
| `/fr/config-pc-gamer-9000-dh` | 171 380 B | 169 641 B | **−1 739 B** |

KEPT: script falls on both routes by the same 1 739 B, so the boundary's chunk was
carrying kit primitives it never renders. The

Correction (2026-11-04, review of `5c48d57`): the first version of this record — and the
commit message — called `error.tsx` "the tree's only client island" importing the barrel.
That is false: ten other client components import it (the wizard steps, the kit
islands, the share bar, the swap panel, the saved-builds view). The measured 1 739 B is
real and the change stands; only the uniqueness claim was wrong, and it is corrected here
rather than rewritten in history.
after-run also passes all four enforced assertions (LCP medians 2 497 / 2 483 ms, CLS 0,
performance 0.97 / 0.98); the before-run missed only LCP (2 561 / 2 515 ms), the T7 sample
band, and is recorded here as the reason the before pass is not claimed as green.

## Task 4 — S4 error-boundary spec: BLOCKED (2026-11-04)

The brief's preferred trigger — a fixture id whose result read answers 500 — cannot reach
`app/[locale]/error.tsx`. `lib/result/load.ts` narrows only 404/400 into `missing`; every
other failure (5xx, timeout, refused connection, non-JSON 2xx) becomes an `unavailable`
OUTCOME, and the page renders that in-page. Measured 2026-11-04 against the existing 503
fixture id (`00000000-0000-4000-8000-000000005030`): `/fr/config/…` and `/ar/config/…` both
answer 200 carrying `data-tone="error" role="alert"`, the page's own `Réessayer` /
`أعد المحاولة`, and never the boundary's title. A 500 takes the same branch, so that fixture
would test the result page's error state, not the boundary.

A second no-app-code trigger was tried and does not work either: aborting every `?_rsc=`
navigation request and clicking a header link made Next fall back to a document navigation
and render the target page (18 RSC requests aborted, boundary title count 0, final URL the
destination).

No spec was committed, no fixture was added and no app code was changed, per the
brief's "do not add a probe route or test-only code". Options, for an owner decision:

1. **Cover what users actually get** — spec the in-page 503/500 result state (alert role,
   retry, back link) with a 500 fixture id. No boundary coverage, and it is the state the
   product deliberately chose.
2. **Crash a component with data** — a 200 fixture the loader accepts but a component
   throws on (a build with no `components`), so the render throws and the boundary renders
   in both locales. Data-only, but it pins an incidental crash path.
3. **Let 5xx own the boundary** — rethrow 5xx in `loadRecommendation` so `error.tsx`
   renders; the preferred fixture then works. A product change to the error model, and it
   trades the page's id-preserving retry for the boundary's generic one.
4. **Unit-test the boundary** — needs vitest, which PLAN.md A2 says must arrive with
   `test:unit` and its `web.yml` step; it would not be Playwright.

## Task 6 — S6 viewport projects (2026-11-04)

`playwright.config.ts` now runs four projects. `mobile-360` keeps NO `grep` and runs the whole
suite; `mobile-390` (390x844), `tablet-768` (768x1024) and `desktop-1280` (1280x800) each run only
the specs tagged `@layout` — shell, wizard, wizard-steps, wizard-budget, result, saved, compare and
rtl (80 top-level tags, 95 test cases per project once describes expand). The policy — which specs
run where, and when to tag — is `apps/web/AGENTS.md`.

Measured with `CI=1 npm test` on 2026-11-04:

| project | specs | passed | skipped | test time (sum) |
|---|---|---|---|---|
| mobile-360 | 395 | 393 | 2 | 149.2 s |
| mobile-390 | 95 | 95 | 0 | 31.6 s |
| tablet-768 | 95 | 95 | 0 | 34.6 s |
| desktop-1280 | 95 | 95 | 0 | 37.7 s |

Totals: 680 runs, **678 expected / 0 unexpected / 2 skipped**, wall clock **49 s** against **39 s**
for `--project=mobile-360` alone — **+10 s**, inside the 60 s budget, so no tag set was trimmed.
The two skipped are the opt-in harnesses (`wizard-browser-api`, `wizard-engine`), unchanged.

Four failures appeared on the first multi-project run, all in `shell.spec.ts`: two tests inherited
the project width while asserting the 360 px shell (bar visible, header links hidden). Both now pin
360 with `setViewportSize` before their 360 half, exactly as the neighbouring 768 px tests already
did — the assertions themselves are unchanged, and the shell file is 40/40 across the four projects.
