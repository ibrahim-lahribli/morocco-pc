# HANDOFF — web-redesign, end of session 2026-11-03 (third sitting)

Read this first, then `CONTEXT.md`. This file is the state of the branch, not the plan.

## Where the branch stands

- Branch `web-redesign`, branched from `master` (`e3fe882`), pushed; **one commit ahead of
  `origin/web-redesign`** after the validation pass below (push it before handing off again).
  The commit count is deliberately not written down: it changes with every commit. Measure it with
  `git rev-list --count master..web-redesign`.
- Phases 0 and 1 are closed. **Phase 2 (kit) is CLOSED at gate G2.** **Phase 3 (shell) is nearly
  closed: G3 is NOT claimed yet** — the tab bar, the landmark naming, the review fixes, the `md+` header
  nav and the error boundary are all in and green, but the header and footer are still un-restyled (see
  below). The Lighthouse gate now PASSES with room: **1 585 B** of script and **20 ms** of LCP.
- `docs/web-v2/PROGRESS.md` is the ledger. `docs/superpowers/plans/` holds plan files for phases **0,
  2 and 3**. Phase 3's was written LATE — 2026-11-03, after T1-T5b had already landed — which is exactly
  why the header/footer restyle and the `md+` half of PLAN.md's Phase 3 line drifted out of view until a
  review found them. Its ladder records T1-T5b and carries **T6-T8 as the open work**, with the four
  decisions the restyle would otherwise discover mid-build written down first.

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

## Corrections after the validation pass (2026-11-03, same day)

Every gate was re-run on the handed-off tree (`d7e6f11`) **before anything was changed**. Most claims
survived to the digit; three did not.

| Claim in this doc | Measured | Verdict |
|---|---|---|
| typecheck / build / `check:api-types` PASS | PASS | holds |
| `check:tokens` 102 files, `check:i18n` 100 files | 102 / 100 | holds |
| `npx playwright test e2e/shell.spec.ts` 9/9 | 9/9 | holds |
| `CI=1 npm test` 392 passed / 2 skipped | **391 passed / 2 skipped + 1 flaky** (394 specs) | same total; the `wizard-budget` flake fired again |
| `npm run lint` PASS, 0 warnings | exit 0, **1 warning** | true of tracked files only — see below |
| `npm run test:lighthouse` **FAIL, LCP 2 503 ms** | **PASS (exit 0)**, result median **2 500 ms** | **not reproducible — the median landed ON the budget, not over it** |
| LCP element `section > section.mt-6 > dl.mt-3 > div.text-body` | identical selector | holds |
| script 168 700 / 167 428 B | 168 718 / 167 446 B | holds (±20 B) |
| header nav 118 px at 360 px | 118 px, 3 links | holds |
| `error.tsx` absent, G3 not claimed | absent | holds |

**So the gate is amber, not red.** Two independent median-of-3 runs exited 0: result medians 2 500 ms
(runs 2 561 / 2 500 / 2 486) with the preset at 2 492 ms (one sample 2 875 ms). 2 503 ms was a real
sample, but a median landing exactly on the threshold is neither a failure nor a pass with confidence.
G3 is blocked on **headroom**, not on a red run — which changes what the next session has to fix.

**The lint warning** is `tmp/validate-shell.mjs`, a gitignored scratch probe inside eslint's scope. The
committed tree is clean; the working tree reports one warning while `apps/web/tmp/` exists.

**The render cost is not in the CSS or the fonts, and the old step 1 is answered.** Mining the
`.lighthouseci` reports already on disk (no rebuild): observed LCP = observed FCP = **159-175 ms**,
TTFB 4-16 ms, one 48 732 B `woff2` at 11-26 ms, the 16 475 B stylesheet at 23-28 ms,
`unused-css-rules: 0`, `font-display: 0`, `render-blocking-resources` 0 on the result route,
main-thread ~95-102 ms with two tasks over 10 ms, and one 77 ms long task starting at 2 558 / 2 707 ms —
after LCP. The 2 045 ms "render delay" is the simulator's arithmetic, not a slow paint: every resource
the paint could wait on arrives inside 30 ms. The two ablations this doc proposed are therefore **not**
the lever and were **not** run.

## The error boundary, and the budget it had to fit

`app/[locale]/error.tsx` is in. It is the app's only client component that cannot be handed copy as
props — Next renders a boundary IN PLACE of the segment — so the obvious fix was
`NextIntlClientProvider`. It was built and measured, and it FAILS the gate:

| Variant | Result script | Result LCP | Verdict |
|---|---|---|---|
| before any boundary | 168 710 B | 2 494 ms | within budget |
| `NextIntlClientProvider` + `errors` only | **184 555 B** (+15 845) | **2 643 ms** | **fails both assertions** |
| generated plain-object copy (shipped) | **172 495 B** (+3 785) | **2 480 ms** | **PASS, 1 585 B to spare** |

So the copy is mirrored at build time: `scripts/gen-error-copy.mjs` derives
`lib/i18n/error-copy.generated.ts` from the `errors` namespace, and `check:i18n` grew **rule 7**, which
fails while that file is stale. The catalogues stay the single source of truth; the client pays for seven
strings and no ICU runtime. **Do not re-try the provider** — the numbers above are the answer.

**Proof it renders** (probe route, both locales, then deleted): HTTP 500, the French and Arabic h1, the
error-tone `Alert`, one retry button, one home link, Next's real `digest`, and the shell still around it
(4 `nav` landmarks). Trap worth keeping: **a folder starting with `_` is private to Next's router**, so the
first probe answered 404 and looked exactly like a broken boundary.

## Next session — start here

1. **The header and footer are still un-restyled, and that is now the ONLY thing G3 waits on.** Their
   *structure* matches the design (no duplicate page links at 360 px); the visual treatment does not: the
   design's header has a logo tile with a page subtitle, and DESIGN.md's container and type scale are
   applied to neither. Do this before Phase 4's screens, or both move under them.
2. **Work the phase-3 ladder** — `docs/superpowers/plans/2026-11-03-web-redesign-phase-3.md`, T6-T8:
   header restyle, footer restyle, G3 evidence. Then claim G3 on the green median-of-3 Lighthouse this
   tree already produces (exit 0, 1 585 B and 20 ms of margin). Its *Decisions fixed before starting*
   section names the four forks to answer BEFORE the restyle lands: the logo tile (a remote placeholder
   `img`), the page subtitle (a second owner of the page's name), a FIXED header (ours is static), and
   the saved-shelf badge that D-14 does not cover.
3. **Phase 4, in the planned order:** `configurer -> results -> build detail -> home -> presets ->
   composants -> guides -> enregistrements -> legal`, one screen per task with its own gate. **Home is
   fourth, not first.** Its brief is `SCREENS.md`'s `accueil_morocco_pc` row — hero, presets, trust
   strip **and guides**, with the two state variants merged — built on the existing loaders
   (`presetsForBuild`, `loadPresetCached`, `orderBuilds`, `priceProvenance`, `pageAlternates`), not a
   new data path. "From scratch" applies to the markup; the loaders encode one API read per budget, the
   skip-a-broken-preset rule and the canonical surface.
4. **The wizard's budget field is a flake FAMILY, not one test:** `wizard-budget.spec.ts` 76, 94 and 220
   plus `wizard.spec.ts` 108 all reported flaky in one run on 2026-11-03 (each passed on retry).
   Reproduce with `--repeat-each=20`, fix the race in the component, do not add retries.
5. **The tab-bar copy is a recorded deviation** (D-20): the design says "Composants" and "Enregistrements",
   the bar ships "Pièces" and "Gardés" for 360 px. Re-check it on a real phone.
6. **`global-error.tsx` still does not exist.** The segment boundary catches page errors; an error in the
   ROOT layout would fall through to Next's default. It cannot use the generated copy's provider-free path
   (it replaces `<html>`), so it is its own small decision, not a copy of `error.tsx`.

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
| `CI=1 npm test` | PASS — but 391 passed / 2 skipped / **1 flaky** on re-measurement (394 specs); 393 passed / 2 skipped after the header fix (395 specs, 36.5 s) |
| `npm run test:lighthouse` | **PASS (exit 0)** on re-measurement — result median 2 500 -> **2 494 ms**, preset 2 492 -> 2 481 ms. The line is *touched*, not cleared: see the corrections |

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
