# HANDOFF — web-redesign, end of session 2026-11-03 (second sitting)

Read this first, then `CONTEXT.md`. This file is the state of the branch, not the plan.

## Where the branch stands

- Branch `web-redesign`, branched from `master` (`e3fe882`), **nothing pushed**, no upstream. The commit
  count is deliberately not written down here: it changes with every commit, and a numeral in this file
  went 25 -> 28 -> 29 while it was being written. Measure it with
  `git rev-list --count master..web-redesign`.
- Phases 0 and 1 are closed. **Phase 2 (kit) is CLOSED at gate G2** — T1–T7 landed, T8 is the
  evidence below. Phase 3 (shell) is next.
- `docs/web-v2/PROGRESS.md` is the ledger. `docs/superpowers/plans/2026-11-03-web-redesign-phase-2.md`
  is marked closed and is now history, not a to-do list.

### Gates on the final tree (every row RUN this session)

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS, **0 warnings** |
| `npm run check:tokens` | PASS — 100 files |
| `npm run check:i18n` | PASS — 98 files, 2 catalogues, key + placeholder parity |
| `npm run check:api-types` | PASS — contract 1.10.0, `schema.d.ts` byte-identical |
| `npm run build` | PASS |
| `CI=1 npm test` | **PASS — 388 passed / 2 skipped** (390 specs, 34.9 s) |
| `npm run test:lighthouse` | **PASS** — four `error` assertions, median of 3, both fixtures |

The two skips are `e2e/wizard-browser-api.spec.ts` (needs `E2E_BROWSER_API=1`) and
`e2e/wizard-engine.spec.ts` (opt-in real-engine harness). Both by design. axe runs inside the suite
(`e2e/a11y.spec.ts` already walks `/kit`, so the eight new sections are covered by its 51 checks).

### Gate G2 numbers

| Route | LCP (median of 3) | CLS | Script | vs 174 080 B | vs G1 baseline |
|---|---|---|---|---|---|
| `/fr/config/{id}` | 2 490 ms | 0 | **158 876 B** | 15 204 B spare | +45 B |
| `/fr/config-pc-gamer-9000-dh` | 2 485 ms | 0 | **167 321 B** | **6 759 B spare** | +214 B |

Performance score 98 on both. **LCP is still the binding metric** — 10 ms and 15 ms of slack — and one
preset run sampled 2 874 ms before the median absorbed it. Any Phase 3 addition above the fold
re-measures before it lands; the preset route is the one to watch.

## The headline: the 3 KB was the barrel, and that is now measured

The previous session left this open — Phase 2 had grown the fixture bundles ~3 KB and the suspect was
the `@/components/ui` barrel re-exporting four primitives neither fixture renders. An A/B rebuild
settled it:

| Build | `/fr/config/{id}` | preset route |
|---|---|---|
| four exports IN the barrel | 190 434 B | 189 557 B |
| four exports REMOVED | 189 024 B | 188 147 B |

**Exactly 1 410 B on both routes**, in ONE shared chunk (9 733 → 8 323 B gzip). A re-export barrel is
not reliably tree-shaken by Turbopack. Removing those four exports and importing each primitive
directly recovered **2 882 / 3 191 B** as Lighthouse measures it, so the whole kit now costs **+45 B
and +214 B** instead of +3 KB. This is **D-15**, and it is a rule from here on: *new primitives are
imported from their own module, never through the barrel.*

## What shipped this session

- **Eight primitives** (T6), each imported directly: `BottomTabBar` (pure, `current` is a prop so the
  gallery can draw every state), `StickyBar`, `PartRow`, `RetailerRow` (D-10 reduced — **it has no
  `href` prop at all**, because no merchant is served and a clickable row would be a promise with no
  answer), `SnapRow` + `SnapRowItem` (focusable scroller, RTL-safe bleed), `TrustItem`,
  `BuildSummaryCard` (drawn fallback per D-01, CTA is the link per D-16), `ExplainerSheet`.
- **Five tab-bar glyphs** in `icons.tsx`; the bespoke set stays bespoke.
- **The gallery** (T7): `/fr/kit` gained eight sections in real states, plus `KitExplainer` as its one
  client island. It renders `fixed` bars inside a transform-bearing wrapper — a transform makes that
  box the containing block, which is how a pinned bar is demonstrated *in* a page.
- **`viewport` export** with `viewportFit: "cover"`, and the `Sheet`'s footer padded with
  `env(safe-area-inset-bottom)`. Review finding **P2 is closed** — the sheet no longer sits under the
  home indicator.
- **`e2e/kit-phase2.spec.ts`** (8 specs): one assertion per primitive, each aimed at the defect it
  could plausibly have, not at its rendering.
- **Three defects the review pass then found in the above**, all fixed: the tab-cell spec asserted a
  24 px floor while its own comment claimed the 56 px cell (now 44 px, the accessibility minimum); the
  build card's CTA was a raw `<a>` bypassing `next/link` (now `LinkButton`); and the gallery intro still
  said "les onze sections" on a page that renders twenty (the count is gone rather than corrected, so it
  cannot drift again).
- **D-15 … D-18** and the five FEASIBILITY NOs answered in `DEVIATIONS.md`.

## First job of Phase 3

**Two landmarks share one accessible name.** The tab bar and the shell's header nav are both
"Navigation principale" (`shell.navLabel`); the new spec measured 11 links where 5 were expected. The
spec now scopes to its section — but the collision is real, and axe will not catch it (`landmark-unique`
is best-practice, and `e2e/a11y.spec.ts` runs WCAG tags only). Decide which nav keeps the name before
the shell lands.

## Open, unfinished, or unverified

- **Per-commit gate replay was NOT run.** Two commits this session (code, then docs); only HEAD was
  verified, so an intermediate commit is green only by construction. `f339d37` remains the one commit
  known red in history.
- **`/ar`'s h1 renders 24 px** — a Tailwind `text-2xl`, not a token step. The type scale is still not
  exclusive and `check:tokens` cannot see size utilities.
- **The gallery is French-only** (`generateStaticParams` returns `fr`), `noindex`, and uses French
  literals rather than `messages/`. Pre-existing precedent that contradicts AGENT rule 5; still not a
  deviation row.
- **Media assets are committed but unused.** `guide-motherboard` is 127 KB, 4× the others — re-encode
  before it lands above the fold (Phase 4, where LCP is measured).
- **`apps/web-v2/` is untracked** — a duplicate of `design/stitch/`. Deleting it is the owner's call.
- **Script margin is now 6 759 B on the preset route.** That is the number every Phase 3 shell
  addition to a shared chunk is judged against.

## Traps (each has already cost a red run or a wrong number)

- **`grep -cU $'\r'` lies about line endings here.** It reported 40 CR lines in a file Node reads as
  **0 CR / 41 LF**. Read endings with `node`: `s.split('\n').filter(l => l.endsWith('\r')).length`.
  `DEVIATIONS.md`, `PROGRESS.md` and `HANDOFF.md` are **LF-only**; `globals.css`, `layout.tsx` and the
  kit page are CRLF. Never normalise either.
- **`code_search` returns 0 matches for `from "@/components/ui"`** in this repo even with `cwd` set —
  the file plainly contains it. Use `grep -rln` for this tree.
- **Turbopack emits no `app-build-manifest.json`.** To attribute bytes, probe the built HTML:
  `next start`, fetch the route, read every `<script src>`, gzip it. That is how the barrel was proved,
  and it is reproducible (`tmp/bundle-probe.mjs` was the scratch version; it is gitignored).
- **`resource-summary:script:size` is an LHCI *synthetic* assertion, not an audit.** It has no
  `audits[...]` entry; take `audits["resource-summary"].details.items` (where `resourceType ===
  "script"`) or read `assertion-results.json`.
- **Playwright reuses whatever answers 3210.** A `next start` started WITHOUT `API_BASE_URL` gets
  tested, and exactly the four server-side-data specs fail while the rest pass. Under `CI=1`
  Playwright instead **refuses to start** — which reads as a red suite and is really no suite.
- **The suite runs the PRODUCTION build.** A component change is invisible until `npm run build` runs
  again — rebuild before believing a spec failure *or* a pass.
- **`netstat -ano` lies here** (localised state column, listening row often absent). Find processes
  through `Get-CimInstance Win32_Process`, filter on `next` / `mock.server.mjs`, and confirm each port
  answers `000` with `curl --max-time 2`.
- **A name-based landmark lookup unions landmarks.** `getByRole("navigation", { name })` matched both
  the shell nav and the gallery's tab bar. Scope with a section locator, then assert the name.
- **`str_replace` mis-resolves paths in this repo**, and `bash` mangles `node -e` with backticks
  inside double quotes. Use `write_file` for scripts, or exact `split/join` with assertions.

## Commands that matter

```
cd apps/web
npm run typecheck && npm run lint && npm run check:tokens && npm run check:i18n && npm run check:api-types
npm run build && CI=1 npm test          # CI=1 so Playwright starts its own servers
npx playwright test e2e/kit-phase2.spec.ts   # the eight new primitives only
npm run test:lighthouse                 # 4 assertions, median of 3, 2 fixtures
npm run media:fetch -- --only=<key>      # CC0 covers, --force to refetch
```

Verify the ports are free (`curl` → `000`) before any suite run; kill strays by PID from
`Get-CimInstance`, never by pattern.
