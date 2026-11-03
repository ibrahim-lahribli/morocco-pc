# HANDOFF — web-redesign, end of session 2026-11-03 (third sitting)

Read this first, then `CONTEXT.md`. This file is the state of the branch, not the plan.

## Where the branch stands

- Branch `web-redesign`, branched from `master` (`e3fe882`), **pushed and in sync with `origin/web-redesign`**.
  The commit count is deliberately not written down: it changes with every commit. Measure it with
  `git rev-list --count master..web-redesign`.
- Phases 0 and 1 are closed. **Phase 2 (kit) is CLOSED at gate G2.** **Phase 3 (shell) is in progress:
  G3 is NOT claimed** — the tab bar, the landmark naming and this session's review fixes are in, but
  error boundaries are not started and the Lighthouse gate is red (see below).
- `docs/web-v2/PROGRESS.md` is the ledger. `docs/superpowers/plans/` holds plan files for phases **0
  and 2 only** — there is no phase-3 plan, which is why the header/footer restyle and the `md+` half
  of PLAN.md's Phase 3 line drifted out of view until the review found them. Writing that plan is
  open work, not a formality.

## What this session did

### 1. Reviewed the shell (two axes) — `8e90286..2281a42`

Findings, all recorded in `PROGRESS.md`:

| Axis | Finding |
|---|---|
| Standards | the footer's S22 docblock had been left above the new `type TabItemRow`, so it documented the wrong declaration |
| Standards | `bottom-tab-bar.tsx` still said `TAB_BAR_OFFSET` is put on `<main>` after d761355 moved it to `<body>` |
| Standards | the bar matched sections with a bare `startsWith` while `header-nav.tsx` guards the trailing slash |
| Standards | HANDOFF's gate row cited 100 / 98 files (measured 101 / 99) and a stale suite line (388 / 390) |
| Spec | PLAN.md says "`md+` top nav", but the header's page links are visible **at 360 px beside the bar** (measured: header nav 118 px tall), duplicating three destinations |
| Spec | Phase 3 also names the header, footer and error boundaries; only the bar and the naming landed |

### 2. Landed the four mechanical fixes — commit `3329074`

`web(shell): fix the review's doc drift and pin the tab boundary` (7 files, +103/−17):

- the footer docblock leads `FOOTER_LINKS` again, and `type TabItemRow` sits under its own comment;
- the offset comment names `<body>`, and the constant's doc counts the 1 px border it reserves;
- the URL→tab rule moved to **`components/shell/tab-match.ts`** (`isTabPath`, `currentTabKey`), so the
  bar and the header nav share one boundary guard instead of two different ones;
- `e2e/shell.spec.ts` pins `/composants-x` → no lit tab. **It is a pure case on purpose:** an unknown
  slug renders Next's **bare 404, which carries no `nav` element at all** (measured this session), so a
  navigation-based assertion would have passed for the wrong reason;
- HANDOFF's stale counts and the suite line were corrected to the measured values.

### 3. Diagnosed the red gate (the important result)

`npm run test:lighthouse` **fails** on the result route. The full evidence:

| Metric | Value | Budget |
|---|---|---|
| LCP median of 3 (result route) | **2 503 ms** (2 503 / 2 493 / 2 559) | 2 500 → **FAIL** |
| LCP median (preset route) | 2 482 ms | 2 500 → pass |
| Script transfer (result / preset) | 168 700 B / 167 428 B | 174 080 → **5 380 B spare** |
| FCP · Speed Index · TBT · CLS | 916 ms · 916 ms · 18.5 ms · 0 | — |
| Document response | 23 ms, 14 151 B | — |
| Last script finishes | 231 ms | — |

**LCP phases for the failing element: TTFB 458 ms, load delay 0 ms, load time 0 ms, render delay
2 045 ms.** The element is `section > section.mt-6 > dl.mt-3 > div.text-body`, i.e. the inputs-applied
block from `components/result/inputs-applied.tsx` — a **server component**, in the first byte of HTML,
with no `use client` and no CSS on its `data-effect` attribute (that attribute is a test hook only).

What this rules out, with numbers rather than opinion:

- **Not the tab bar's bytes.** Its ~9.8 KB is client JS, and every script is done at 231 ms.
- **Not API latency.** TTFB is 20 ms observed, 458 ms only under Lighthouse's simulated throttling.
- **Not network for the element.** Load delay and load time are both zero.

What is left is the paint path: 2 045 ms of render delay under 4× CPU throttling, against a **89 663 B
built stylesheet** (source `app/globals.css` is 19 164 B / 403 lines, so the weight is generated
utilities) and a `display: swap` font. The next session's first job is to attribute that delay — the
protocol and its decision rule are in the next section, so it does not get re-derived.

## Next session — start here

1. **Name the render cost before changing anything.** Mine the reports already on disk first (free, no
   rebuild): the `.css` and `.woff2` entries in `network-requests` (start/end times), plus
   `render-blocking-resources`, `unused-css-rules` and `dom-size`. That alone distinguishes "the CSS
   arrived late and everything waited" from "the CSS arrived early and styling a large tree took two
   seconds" — opposite fixes.
   Then two scratch ablations, **one change per build**, each measured median-of-3 on the same two
   fixtures, and each reverted before the next:
   - fonts: point `--font-sans` at a system stack and drop `inter.variable` (the Arabic `@font-face`
     blocks are `/ar`-only and irrelevant to both fixtures — do not spend a build on them);
   - CSS: remove `@layer components` (`globals.css:342+`) and the Arabic overrides (`:301`, `:314`)
     coarsely first; splitting only helps if the coarse run moves the number.
   **Decision rule:** > 200 ms movement names the lever; 100–200 ms is real but insufficient alone;
   < 100 ms rules it out. Noise is ±60 ms on this box, so a single run cannot resolve a small change.
   **Guardrail:** `next start` serves `.next`, so revert the source **and rebuild** or you measure the
   old code — the trap that has cost this branch red runs twice. Never edit `lighthouserc.cjs`
   thresholds to make the gate pass.
2. **Owner decision: hide the header's page links below 768 px**, or keep them and log a `DEVIATIONS`
   row. PLAN.md already says "`md+` top nav", so hiding needs no deviation. Do this before any Phase 4
   screen, or the shell moves under the screens.
3. **`error.tsx` is still absent**, and it needs a client message path: mount the next-intl provider
   (ships both catalogues into a shared chunk — measure against the 5 380 B margin *first*) or import a
   static catalogue inside the boundary. This is a decision, not a tidy-up.
4. **Write `docs/superpowers/plans/2026-11-03-web-redesign-phase-3.md`**, then claim G3 only on a green
   median-of-3 Lighthouse with the fix from step 1 — not before.
5. **Phase 4, in the planned order:** `configurer → results → build detail → home → presets →
   composants → guides → enregistrements → legal`, one screen per task with its own gate. **Home is
   fourth, not first.** Its brief is `SCREENS.md`'s `accueil_morocco_pc` row — hero, presets, trust
   strip **and guides**, with the two state variants merged — built on the existing loaders
   (`presetsForBuild`, `loadPresetCached`, `orderBuilds`, `priceProvenance`, `pageAlternates`), not a
   new data path. "From scratch" applies to the markup; the loaders encode one API read per budget, the
   skip-a-broken-preset rule and the canonical surface.
6. **Flake to chase when convenient:** `e2e/wizard-budget.spec.ts:76` ("a field below the minimum
   clamps to it on blur") flaked once in two identical runs and passed on retry. Reproduce with
   `--repeat-each=20`, fix the race, do not add a retry.

## Gates measured on the handed-off tree (`3329074` + this doc)

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS — 0 warnings |
| `npm run check:tokens` | PASS — **102 files** |
| `npm run check:i18n` | PASS — **100 files**, 2 catalogues, key + placeholder parity |
| `npm run check:api-types` | PASS — contract 1.10.0, `schema.d.ts` byte-identical |
| `npm run build` | PASS |
| `npx playwright test e2e/shell.spec.ts` | PASS — **9/9** |
| `CI=1 npm test` | PASS — **392 passed / 2 skipped** (394 specs, 35.7 s) |
| `npm run test:lighthouse` | **FAIL — LCP 2 503 ms on the result route; see above** |

The two skips are `e2e/wizard-browser-api.spec.ts` (needs `E2E_BROWSER_API=1`) and
`e2e/wizard-engine.spec.ts` (the opt-in real-engine harness). Both by design.

## Traps (new this session — the older ones still hold)

- **`Get-NetTCPConnection -State Listen` misses this box's IPv6 wildcard row**, so a kill loop built on
  it silently finds nothing and the port stays busy (Playwright then refuses under `CI=1`, which reads
  as a red suite and is really no suite). Read `OwningProcess` **without** the state filter and kill
  those PIDs.
- **`git checkout web-redesign` fails while another worktree holds it** (`C:/projects/morocco-pc`).
  Work detached at the branch tip, commit, then `git push origin HEAD:web-redesign`. Fast-forwarding
  the branch from another worktree is safe only when that worktree has no *tracked* change colliding
  with the commit — untracked paths (like its `apps/web-v2/`) do not block it.
- **`--no-baseline` is an `eval-scenarios.js` flag, not a Lighthouse one.** `scripts/lighthouse-ci.mjs`
  takes no arguments: it owns both servers, refuses busy ports, requires a production build, and reads
  its URLs from `lighthouserc.cjs`.
- **An unknown path renders Next's bare 404 with no shell at all.** Never write a URL-based assertion
  about the tab bar (or the footer) on a path that might 404 — it passes because there is nothing to
  fail. Pin the rule as a pure case instead (that is why `tab-match.ts` exists).
- **The working tree is CRLF while the blobs are LF** (`core.autocrlf=true`). Detect endings per file
  (`s.includes("\r\n")`) instead of assuming either, and never "normalise" a file you did not mean to
  rewrite — the diff instantly becomes whole-file.
- **A pure Playwright test can import app source** (`e2e/shell.spec.ts` imports
  `../components/shell/tab-match`). That works because the module is dependency-free; the day it
  imports `next/*` the spec breaks at import time.

## Commands that matter

```
cd apps/web
npm run typecheck && npm run lint && npm run check:tokens && npm run check:i18n && npm run check:api-types
npm run build                            # required before BOTH the suite and Lighthouse
CI=1 npm test                            # Playwright starts its own servers; needs free ports
npx playwright test e2e/shell.spec.ts    # the shell, alone
npm run test:lighthouse                  # 4 error assertions, median of 3, 2 fixtures
```

Lighthouse and Playwright both refuse to start when 3210/3211 are occupied: check the ports
(`curl -s -o /dev/null -w "%{http_code}"` → `000`) and kill strays **by the PID that owns the port**,
never by name pattern.
