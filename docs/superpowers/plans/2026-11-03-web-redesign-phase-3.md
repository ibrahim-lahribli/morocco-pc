# Phase 3 — shell (execution plan)

**Goal:** the shell every screen renders inside — header, mobile tab bar, footer, 404 and error
boundaries — matches the design, keeps two distinguishable navigation landmarks, and leaves both
Lighthouse routes inside their budgets. **Gate: G3.**

**State: IN PROGRESS (2026-11-03). G3 is NOT claimed.** T1-T5b landed and are recorded below; **T6-T8 are
this plan's open work.** This file was written LATE — after T1-T5b had already shipped — and that gap is
its own evidence: phases 0 and 2 each opened with a plan, phase 3 went straight into code, and the
header/footer restyle plus the `md+` half of PLAN.md's Phase 3 line then went unnoticed until a review
found them.

**Entry state (measured on `d7e6f11`):** 394 specs, 391 passed / 2 skipped / 1 flaky; `check:tokens` 102
files, `check:i18n` 100; Lighthouse LCP medians 2 500 / 2 492 ms and script 168 710 / 167 428 B; no
`error.tsx`.

**State now (`3f7319a`):** 395 specs, 393 passed / 2 skipped; Lighthouse **exit 0** — LCP **2 480 /
2 484 ms**, script **172 495 / 171 223 B**.

**Budgets that bind here (thin, and thinner every task):** script ≤ 174 080 B leaves **1 585 B** on the
result route and **2 857 B** on the preset; LCP ≤ 2 500 ms leaves **20 ms**. The header and the footer
render on BOTH measured fixtures, so anything added there is judged at 1 585 B, and measured before it
is believed.

**Rules:** one task = one commit; update `docs/web-v2/PROGRESS.md` after each; tokens only; strings via
`messages/` with fr + ar parity; a design departure is a `DEVIATIONS.md` row, never a silent drift;
report PASS / FAIL / BLOCKED with the command; `next start` serves `.next`, so revert AND rebuild.

## Task ladder

| # | Task | Verification | Commit / Why here |
|---|---|---|---|
| T1 | Landmark naming: the header keeps `shell.navLabel` ("Navigation principale"), the bar gets `shell.tabNav` ("Navigation de l'application") | `e2e/shell.spec.ts` asserts the names differ — axe cannot (`landmark-unique` is best-practice; the suite runs WCAG tags) | `f668862` |
| T2 | The mobile tab bar: `components/shell/tab-nav.tsx`, one client island (`usePathname` → current cell), five SHORT labels, `md:hidden` | spec: 5 cells, longest-match current, a URL matching no tab lights none | `f668862` |
| T3 | The bar's height reserved on `<body>`, not `<main>` | spec scrolls to the bottom and asserts the footer clears the bar | `d761355` — the first attempt protected the last card but left the footer behind the bar (measured: footer bottom 800 px vs bar top 719 px) |
| T4 | Review fixes: footer docblock back on `FOOTER_LINKS`; the offset comment names `<body>`; the URL→tab rule extracted to `components/shell/tab-match.ts` and shared with the header; the `/composants-x` boundary pinned as a PURE case | 9/9 then 10/10 on `e2e/shell.spec.ts` | `3329074` — a navigation-based boundary assertion would pass for the wrong reason (unknown slugs render Next's bare 404, which carries no `nav`) |
| T5 | `md+` header page links (`hidden md:flex`): the design's 360 px header is the brand and the language control only | spec pins hidden at 360 / visible at 768 | `2c93396` — the wrapped second row cost a 118 px header on every phone page, duplicating three tab cells |
| T5b | `error.tsx` + `lib/i18n/error-copy.generated.ts` + `check:i18n` rule 7 | probe route both locales, then Lighthouse | `3f7319a` — the provider path measured +15 845 B and was rejected (D-21) |
| **T6** | **Header restyle to `accueil_morocco_pc`** | screenshots fr + ar at 360/768 against `design/stitch/accueil_morocco_pc/screen.png`; typecheck/tokens/build/suite; **Lighthouse on both fixtures, median of 3** | **DONE 2026-11-03** — 64 px row, drawn mark, pill switcher; **+6 B** of script; Lighthouse exit 0; departures **D-22…D-25** |
| **T7** | **Footer restyle** | the same gate set, against the reference blocks listed below | **open** |
| **T8** | **G3 evidence pack** | the table below, plus `PROGRESS.md` + `HANDOFF.md` | **open** — G3 is presented, never inferred from a green suite |

## Decisions fixed before starting T6-T8

Four forks are visible in the design and the code, and each one changes the budget or the ownership
rules. They are decided here so the restyle does not discover them mid-build.

1. **The header's logo tile is a remote placeholder, not an asset.** The export's markup is
   `<img src="https://lh3.googleusercontent.com/aida/...">` — a Stitch mock asset on a third-party host.
   Shipping it would add a cross-origin request to every page, break offline/preview parity, and conflict
   with D-08's posture (drawn content, no remote media). Options: a token-drawn mark, a local SVG added to
   `components/ui/icons.tsx` (**measure it**), or the wordmark alone with a `DEVIATIONS.md` row.
2. **The header's page subtitle ("Accueil") is a SECOND owner of the page's name.** This repo keeps one
   owner per fact — that is why the wizard adopts `StepHeader` instead of keeping a second progress line.
   Either the shell derives the subtitle from the path (a `TAB_ITEMS`-style map plus the existing
   `shell.navItems` labels) or it is dropped with a row. It must never read the page's `h1`.
3. **The design's header is `fixed`; ours is static.** The export has `fixed top-0 pt-safe h-16` with
   `main` padded `pt-16`; we render a static header and `main` has no top offset. Adopting `fixed`
   changes the scroll and paint path on both measured routes and has to agree with the tab bar's own
   reservation and the skip link's landing position. If it is adopted, it lands as its OWN measured
   change (one change, one build), not inside a larger restyle.
4. **The saved-shelf badge is NOT covered by D-14.** D-14 removed the notification bell and the account
   avatar; the design's third control is a bookmark with a `0` badge wired to the saved-builds count in
   `localStorage` — a real data source that exists today (`lib/saved/builds.ts`). Shipping it means a
   second client island in the header, so its JS is counted against 1 585 B on every route, and its zero
   state must be hydration-safe. Decide explicitly; do not let the restyle silently drop it or silently
   add it.

**The footer DOES have a reference**, contrary to an earlier reading of the set: `<footer>` appears in
**4 of the 22** screens — `accueil_morocco_pc`, `morocco_pc_1`, `configurateur_2`, `comparer_morocco_pc`.
T7 reads those blocks rather than inventing a rule-based footer (the "no reference" judgement applies to
`/kit`, `/tokens`, `/format`, the legal pages and the 404).

## Exit criteria for G3

1. Header and footer match the reference at 360 and 768 in **both** locales, or every departure is a
   `DEVIATIONS.md` row.
2. `typecheck`, `lint`, `check:tokens`, `check:i18n`, `check:api-types`, `build` and the full suite green.
3. Lighthouse on **both** fixtures, median of 3, all four `error` assertions — exit 0 — with the new
   numbers written into `PROGRESS.md`. Thresholds are never edited to fit.
4. The two navigation landmarks still have distinct names; the bar's reservation still clears the footer;
   the skip link still reaches `#main` (which a `fixed` header can cover — assert it).
5. `PROGRESS.md` and `HANDOFF.md` carry the result. **G3 is claimed only then.**

## Traps inherited, and the ones this phase added

- Ports 3210/3211 and `apps/web/.next` are machine-exclusive: a stale server makes Playwright reuse the
  wrong build, and under `CI=1` it refuses to start at all — which reads as a red suite and is really no
  suite. Find the owner through `Get-NetTCPConnection` (without a state filter: the IPv6 wildcard row is
  missed otherwise) and kill that PID, never a name pattern.
- **A folder whose name starts with `_` is private to Next's router** — the error-boundary probe answered
  404 and looked exactly like a broken boundary.
- The working tree is CRLF while blobs are LF; detect per file and never "normalise" one you did not mean
  to rewrite.
- `next start` serves `.next`: revert the source **and rebuild**, or you measure the previous code. This
  trap has cost this branch red runs twice.
