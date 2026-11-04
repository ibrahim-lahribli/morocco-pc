# HANDOFF — web-redesign session log (2026-11-03 → 2026-11-04)

**Phase and gate status is `docs/web-v2/PROGRESS.md` — read it first.** This file is the session log and the trap list, not the status. `CONTEXT.md` holds the operational state and the budgets.

## Where the branch stands

- Branch `web-redesign`, branched from `master` (`e3fe882`). Whether it is ahead of
  `origin/web-redesign` is deliberately not recorded here — measure it with `git status -sb`.
  The commit count is deliberately not written down: it changes with every commit. Measure it with
  `git rev-list --count master..web-redesign`.
- **Status lives in `PROGRESS.md`.** Phases 0-2 are closed (G2); **phase 3 is CLOSED at G3
  (2026-11-04)**, with the five-criterion evidence pack in `PROGRESS.md` `## T8`. `docs/web-v2/PROGRESS.md`
  is the ledger and the status; `docs/superpowers/plans/` holds plans for phases 0, 2 and 3, and phase 3's
  records T1-T8 as landed. This file keeps what a status table cannot: the diagnoses, the corrections and
  the traps.

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

1. **Phase 3 is closed at G3 (2026-11-04).** T7's local 2 640 ms red did not reproduce on the closing
   run: `npm run test:lighthouse` exited 0 with result-route LCP median **2 486 ms** and preset
   **2 491 ms**, script **170 913 / 169 641 B**, all four `error` assertions. `PROGRESS.md` `## T8` has the
   evidence pack. The **14 ms / 9 ms** LCP margin is the remaining risk, and option (a) (the hero `h1` as
   the LCP candidate) is still the only change that buys real headroom.
2. **The ladder is finished — T8 landed with this session.** The wizard budget flake family is fixed in
   `77491d7` (debounced URL write; 60/60 repeated runs). `npm test` now runs four viewport projects (S6):
   mobile-360 runs everything, mobile-390 / tablet-768 / desktop-1280 run only the `@layout` specs.
3. **Phase 4, in the planned order:** `configurer -> results -> build detail -> home -> presets ->
   composants -> guides -> enregistrements -> legal`, one screen per task with its own gate. **Home is
   fourth, not first.** Its brief is `SCREENS.md`'s `accueil_morocco_pc` row — hero, presets, trust
   strip **and guides**, with the two state variants merged — built on the existing loaders
   (`presetsForBuild`, `loadPresetCached`, `orderBuilds`, `priceProvenance`, `pageAlternates`), not a
   new data path. "From scratch" applies to the markup; the loaders encode one API read per budget, the
   skip-a-broken-preset rule and the canonical surface.
4. **The wizard's budget FLAKE FAMILY is FIXED (2026-11-04)** — it was a design bug, not a slow test.
   `onChange` committed on every keystroke, so each digit issued its own `router.replace`; under load an
   older transition could land last, reverting the URL and remounting the step with `saved` still
   undefined, which is how a typed "50" came back EMPTY after blur. `budget-step.tsx` now debounces the
   URL write by 200 ms and flushes it on blur, Enter and every rail move, so one settled answer means one
   write. Measured with `--repeat-each=20` over the three clamping tests: **8 failed + 13 flaky of 60
   before, 60/60 after**; the full suite went 391 passed / 1 failed / 1 flaky to **392 passed / 1 flaky
   (exit 0)**. The residual `:159` rail-key flake did not reproduce in 20/20 repeats — load noise, not
   the same bug, unless it returns.
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

## T7 — measured 2026-11-04 on the committed tree

| Gate | Result |
|---|---|
| `typecheck` · `check:tokens` (104) · `check:i18n` (101) · `check:api-types` · `build` | PASS |
| `npm run lint` | PASS with 2 warnings, both in the gitignored `tmp/validate-shell.mjs` |
| `CI=1 npm test` | **FAIL** — 391 / 2 skipped / 1 failed + 1 flaky, all `wizard-budget`; `--repeat-each=3` on that file exits 0 (27 passed / 3 flaky), so it is the known flake family, not the footer |
| `npm run test:lighthouse` | **FAIL (exit 1)** — result LCP median **2 640 ms**; preset medians 2 495 / 2 491 pass |

G3 was claimed on the FINAL tree (`PROGRESS.md` `## T8`); this T7 tree was red when measured — keep the distinction. The footer separator defect is FIXED (2026-11-04): it now trails its item as
an `aria-hidden` span, so a wrapped row starts with a link in both locales. `PROGRESS.md` T7 has the rest.

2026-11-04 — T7's Lighthouse question, answered on the runner (option d). Pushing `web-redesign`
produced run 41758093817 at `e6bdc09`: **web job PASS**, 13 steps, 260 s, result-route LCP median
**2481 ms** (2471 / 2481 / 2602) and preset **2414 ms**, script **172 564 B**. The immediately previous
push, run 41749830494 at `95bfa33`, had failed the SAME assertion on the SAME route at median
**2528 ms** (2251 / 2528 / 2546). So the red was neither a local artefact nor a regression from this
branch's work: both are the same route moving inside a 351 ms band, with the 2 500 ms line in the middle.
G3 criterion 3 is met on the strength of the green run; the 19 ms margin is why option (a) — the `h1` as
LCP candidate, today 28 px against a painted body-text block that wins the metric — is still the durable
fix. Read the numbers from the `web-lighthouse-report` artifact, never from a previous run's memory.

