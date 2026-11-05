# LCP_INVESTIGATION.md — where the ~2.48 s plateau comes from

Measurement only. Written 2026-11-05 on `web-redesign` (tree at `e166b05`, plus this file).

**Nothing was fixed, nothing was pushed, `apps/web/lighthouserc.cjs` was not touched, no dependency
was added, and no `.env` value was read.** Raw Lighthouse JSON lives in `apps/web/tmp/lcp/`
(`/tmp/` is gitignored) and is NOT committed; this file is the only artifact.

The question: the enforced budget is `largest-contentful-paint <= 2500 ms` and the measured median
sits at **2 473–2 476 ms** — is that a defect on the dynamic pages, or the shape of the shell?

Short answer: **it is the shell, not the pages.** A statically prerendered page is the SLOWEST of the
four measured routes, the `<h1>` is in the first byte of HTML on every route with nothing hiding it,
the LCP element is not the `<h1>` at all, and 82 % of the metric is "render delay" for a text node
that loads no resource of its own.

## 1. What was run, and with which settings

Environment: Windows, `next start` from a fresh `npm run build` of this tree, fixture mock on 3211,
Chrome stable (`C:\Program Files\Google\Chrome\Application\chrome.exe`), Lighthouse **12.6.1** — the
copy `@lhci/cli` drives for `npm run test:lighthouse` — and Node **v24.21.0** (CI pins Node 22; the
Lighthouse numbers are browser-side, but the version is recorded rather than glossed over).

```bash
cd apps/web
npm run build                                   # BUILD_EXIT=0
MOCK_API_PORT=3211 node mock/server.mjs                                   # :3211
API_BASE_URL=http://localhost:3211 node node_modules/next/dist/bin/next start -p 3210   # :3210
```

Settings are `lighthouserc.cjs`'s, verbatim: `formFactor: "mobile"`,
`screenEmulation {mobile:true,width:360,height:800,deviceScaleFactor:2}`, `throttling {rttMs:150,
throughputKbps:1638.4,cpuSlowdownMultiplier:4}`, `onlyCategories:["performance"]`. They are passed as
a `lighthouse:default`-derived **config**, not as CLI flags, so no flag translation can drop one.
The only difference from the repo harness is `numberOfRuns` handled by the driver (3 for the
repo-shaped runs) and the throttle method for §6.

```bash
node tmp/lcp/probe.mjs --method=simulate --runs=3 --tag=sim   --urls=<result>,<preset>,<home>,<legal>
node tmp/lcp/probe.mjs --method=devtools --runs=2 --tag=devtools --urls=<result>,<preset>
node tmp/lcp/probe.mjs --method=provided --runs=2 --tag=provided --urls=<result>,<preset>
node tmp/lcp/probe.mjs --method=simulate --runs=2 --tag=blk-js   --block='*.js'    --urls=<result>
node tmp/lcp/probe.mjs --method=simulate --runs=2 --tag=blk-font --block='*.woff2' --urls=<result>
node tmp/lcp/analyze.mjs tmp/lcp/<report>.json
node tmp/lcp/h1-scan.mjs tmp/lcp/html/<page>.html
```

URLs (the two the budgets measure, plus the isolation pair):

| # | URL | Route kind |
|---|---|---|
| result | `http://localhost:3210/fr/config/3f5a1c7e-8b2d-4e6f-9a01-5c3d7e9f1a2b` | dynamic (`ƒ`), `no-store` |
| preset | `http://localhost:3210/fr/config-pc-gamer-9000-dh` | prerendered (`●`), ISR `s-maxage=3600` |
| home | `http://localhost:3210/fr` | prerendered shell + home content |
| legal | `http://localhost:3210/fr/mentions-legales` | **static (SSG)**, no fetch at all |

## 2. FCP, LCP, and the LCP element

Simulate = the enforced settings. Three runs each; the median is the number the budget takes.

| URL | FCP (3 runs) | LCP (3 runs) | **median LCP** | LCP element |
|---|---|---|---|---|
| result | 910 / 906 / 906 | 2879 / **2473** / 2497 | **2 473 ms** | `<div data-effect="APPLIED" class="text-body leading-relaxed">` — the `InputsApplied` body block, 294×78 px |
| preset | 906 / 907 / 906 | **2476** / 2328 / 2475 | **2 476 ms** | the intro `<p>`: "Cette configuration a été assemblée pour un budget de 9 000 DH…" |
| home | 907 / 906 / 907 | 2479 / **2476** / 2327 | **2 476 ms** | the intro `<p>`: "morocco-pc vous propose des configurations compatibles…" |
| legal | 1058 / 1060 / 1058 | **2628** / 2622 / 2785 | **2 628 ms** | the intro `<p>`: "morocco-pc est un projet en cours de développement…" |

Two facts straight away:

- **The LCP element is never the `<h1>` on any route.** It is a body-text block in all four cases,
  and in every case it is plain server-rendered text with no image, no media, no iframe.
- **Observed** (unthrottled) LCP is **104 ms**, identical to observed FCP, on the result page. The
  server render and the first paint are not what costs the 2.4 s; the cost appears only once a
  bandwidth/latency model is applied.

### 2.1 The breakdown the installed Lighthouse provides

`lcp-breakdown-insight` **does not exist in 12.6.1** — asking for it returns ABSENT. The four-phase
table does exist, inside `largest-contentful-paint-element.details.items[1]`, and for the result page
under the enforced settings it reads:

| Phase | Timing | % of LCP |
|---|---|---|
| TTFB | 453 ms | 18 % |
| Load Delay | **0 ms** | 0 % |
| Load Time | **0 ms** | 0 % |
| Element render delay | **2 020 ms** | **82 %** |

Zero load delay and zero load time are the expected result for a text node: the LCP element fetches
nothing. `lcp-phases-insight` also exists in this version, but it reports the **observed** phases
(TTFB 14.6 ms, element render delay 89 ms) — real, unthrottled, and not the simulated number the
budget asserts on.

So no phase is missing and none had to be derived from network timings; the honest reading is that
82 % of the metric is time the paint spent waiting, and §8 splits that waiting with a controlled
experiment rather than a guess.

## 3. Request timeline

Observed request times (ms after navigation start) and transfer bytes, result page. The preset and
home pages fetch the same asset set; the legal page adds a second font (below).

| Resource | Start → end | Transfer |
|---|---|---|
| Document (HTML) | 0 → 16 | 14 570 B |
| Font — `83afe278b6a6bb3c…woff2` (Inter, preloaded) | 25 → 27 | 48 732 B |
| Stylesheet — `14p3_cel317jz.css` | 25 → 29 | 16 544 B |
| Script `1x6obpmlu1_c2.js` | 29 → 31 | 2 371 B |
| Script `2r4s4h5xul1n-.js` | 30 → 34 | 8 021 B |
| Script `2khxl0v1q4i6n.js` (largest chunk) | 31 → 41 | 72 416 B |
| Script `2e268anpfvdoc.js` | 31 → 40 | 46 789 B |
| Script `turbopack-2c3mg3r-05n1w.js` | 31 → 33 | 4 787 B |
| Script `0umf92h1sb77c.js` | 31 → 34 | 3 910 B |
| Script `3udmx6ddzfggp.js` | 31 → 34 | 6 497 B |
| Script `3siwkk6b6506r.js` | 33 → 38 | 1 272 B |
| Script `1311pvtzzxdno.js` | 34 → 43 | 8 393 B |
| Script `2_qia2ygvnwch.js` | 34 → 43 | 2 045 B |
| Script `2tns52uo1-vzn.js` (late) | 135 → 138 | 9 402 B |
| Script `1x4ktyry7ilm_.js` (late) | 137 → 139 | 5 039 B |

Totals from `resource-summary` / `total-byte-weight`:

| Bucket | Requests | Transfer |
|---|---|---|
| **script** | 12 | **170 942 B** (budget 174 080 B → **3 138 B headroom, 1.8 %**) |
| font | 1 | 48 732 B |
| stylesheet | 1 | 16 544 B |
| document | 1 | 14 570 B |
| favicon | 1 | 15 417 B |
| total | 28 | **288 139 B** |

The result page's HTML carries 11 `<script src>` tags — 10 of them `async`, the rest of the twelve
requests fetched by the runtime — plus one stylesheet and one font (legal adds the mono face),
and there are **no images at all** on any of the four routes (`resource-summary.image = 0`).

The legal page pulls a **second** font on demand (`797e433ab948586e…woff2`, 23 408 B) because its
eyebrow label paints `--font-mono` — which is why its FCP is 1 058 ms rather than 906 ms and its LCP
is the highest of the four.

## 4. Server HTML check — the `<h1>` is in the first byte, and nothing hides it

`curl` against the running `next start` (`curl -s -D <headers> -o <html> -w "%{http_code} %{size_download}"`):

| Route | Status | HTML bytes | `<h1>` in initial HTML | `<h1>` class |
|---|---|---|---|---|
| result | 200 | 88 732 | yes (exactly 1) | `text-heading text-ink` |
| preset | 200 | 40 738 | yes (exactly 1) | `text-heading text-ink` |
| home | 200 | 47 187 | yes (exactly 1) | `text-2xl font-semibold text-balance` |
| legal | 200 | 27 147 | yes (exactly 1) | `mt-1 text-heading text-ink` |

Ancestor chains (`node tmp/lcp/h1-scan.mjs`), identical shape on all four routes:

```
<html class="MOT0tq_variable LyTxPG_variable h-full antialiased">
  <body class="flex min-h-full flex-col md:pb-0 pb-[calc(5rem+1px+env(safe-area-inset-bottom,0px))]">
    <main id="main" class="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <section class="">            (result also has a <header class=""> above the h1)
```

**Paint-delaying classes on the `<h1>` and its ancestors: none — on every route.** No `opacity-0`,
no `invisible`, no `hidden`, no `animate-*`, no `transition*`, no `blur-*`, no delay utility.

Document-wide, the only such tokens that exist on these pages are `hidden` (the sheet/dialog plumbing),
`transition-colors` (buttons) and `transition-[width]` (the progress bar) — none of them on the `<h1>`
chain, and none of them on the LCP element either.

No client effect or "mounted" state toggles anything here: the components under `app/` and
`components/` contain no `mounted` state at all; `animate-pulse` exists only in
`components/ui/skeleton.tsx` (a placeholder that none of these four routes renders in HTML),
`opacity-0` only in `components/ui/choice-card.tsx` (the wizard, a different route), and the two
transitions are `ui/button.tsx` and `ui/progress-bar.tsx`. The `<h1>` is server text in a server
component; it paints when the document paints.

## 5. Streaming check — no boundary, no streamed-after-fetch body

- `find app -name loading.tsx` → **no results**: there is no `loading.tsx` anywhere in `apps/web/app`.
- `<Suspense>` appears once in the tree, in `app/[locale]/configurer/page.tsx` (the wizard's
  `useSearchParams` island). None of the four measured routes has a Suspense boundary.
- The saved HTML carries **zero** `<!--$?-->` boundary markers (a pending Suspense boundary) and two
  `<!--$-->` RSC payload markers, plus one `__next_f` bootstrap — the same on all four routes. A
  streamed boundary that resolved after the shell would leave a `$?` marker behind.
- `app/[locale]/config/[id]/page.tsx` awaits `loadRecommendationCached(id)` **before it returns any
  JSX**, so there is nothing for React to flush early: the head arrives quickly (local `curl`
  `time_starttransfer` 106 ms) but the body is produced after the fetch resolves.
- Response shape: the result page answers `Transfer-Encoding: chunked` with
  `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`; the preset page answers
  ISR `s-maxage=3600, stale-while-revalidate=…`.

**Answer: no, the main content is not streamed after a server fetch** — there is no boundary to
stream into. And the numbers say the fetch is not the cost anyway: server response time is **13 ms**
(`server-response-time`), and the page with **no fetch at all** (legal) is the slowest of the four.

## 6. Throttling comparison — `devtools` vs `provided`

Same URLs, same emulation, same throttling settings; only `throttlingMethod` changes.

| URL | simulate (enforced) | devtools (real throttle) | provided (no throttle) |
|---|---|---|---|
| result — FCP | 906 | 1893 / 1828 | 223 / 116 |
| result — LCP | 2 473 | **1893 / 1828** | **223 / 116** |
| preset — FCP | 906 | 1780 / 1787 | 108 / 76 |
| preset — LCP | 2 476 | **1780 / 1787** | **108 / 76** |

Two things worth keeping:

1. **FCP == LCP in both `devtools` and `provided`.** The first paint IS the LCP entry; there is no
   late LCP swap (no font reflow, no late image, no hydration repaint) on these pages.
2. `simulate` does not measure the same thing `devtools` does. Its TTFB alone is 453 ms because
   Lantern's `requestLatencyMs` is **562.5 ms** — the configured `rttMs: 150` times 3.75 — so every
   round trip in the simulated chain costs more than a third of a second before any transfer is
   counted. The 2.48 s is a *projection under the enforced budgets' own model*, not a number a real
   phone on that profile produced (that is the 1.89 s / 1.78 s column).

## 7. Isolation — is the plateau site-wide?

| Route | Kind | Median LCP (simulate) |
|---|---|---|
| `/fr/mentions-legales` | **static, prerendered, no fetch** | **2 628 ms** |
| `/fr` | prerendered shell + content | 2 476 ms |
| `/fr/config-pc-gamer-9000-dh` | ISR (`●`) | 2 476 ms |
| `/fr/config/<id>` | **dynamic (`ƒ`), `no-store`** | 2 473 ms |

**The plateau is site-wide, and it is not specific to the dynamic pages.** The fully static legal
page — no API call, no `no-store`, no `d([id])` — is the *slowest* of the four, because it also pulls
the mono face. Whatever the 2.48 s is, it is inside the shared shell (one stylesheet, the
font(s), ~170 KB of script, 285–303 KB total) and not in the result page's rendering strategy.

## 8. Controlled attribution (beyond the repo settings, and labelled as such)

Two extra runs of the SAME settings with one resource class blocked, to split the 2 020 ms render
delay instead of speculating about it. `blockedUrlPatterns` is a Lighthouse setting; no app code,
config or asset was changed.

| Run | FCP | LCP | Δ LCP vs 2 473 ms |
|---|---|---|---|
| baseline (result) | 906 | 2 473 | — |
| `--block='*.js'` (all twelve chunks) | 904 / 903 | **1 804 / 1 803** | **−669 ms (−27 %)** |
| `--block='*.woff2'` (the Inter face) | 1513 / 1511 | 2 706 / 2 858 | **+233 … +385 ms (worse)** |

- **The JS bundle is a real, measured contributor**: removing all of it moves LCP by 669 ms and
  leaves FCP untouched. It is not the whole plateau — the page still lands at 1.80 s with no script.
- **The font is not blocking text.** Blocking it makes both FCP and LCP *worse*, which rules out a
  font-block-text (FOIT) story. Build evidence agrees: of 19 `@font-face` rules, 17 carry
  `font-display:swap`; the two without are next/font's metric-adjusted fallbacks (`Inter Fallback`,
  `Geist Mono Fallback`, both `src:local(Arial)`), which never block a network fetch.
- A 404-shell probe was attempted as a "minimal content" control and is **unusable**: Lighthouse
  returned `ERRORED_DOCUMENT_REQUEST` ("Status code: 404"), so no FCP/LCP was recorded. It is not
  used as evidence anywhere above.

## 9. Findings

| Hypothesis | Evidence | Verdict |
|---|---|---|
| The `<h1>` is hidden or animation-delayed (`opacity-0` / `hidden` / `animate-*` / mount state) | `<h1>` present once in the initial HTML on all four routes; zero paint-delaying classes on the `<h1>` or any ancestor; no `mounted` state in the tree; the only `animate-pulse` is an unused `Skeleton` | **ruled out** |
| The `<h1>` is the LCP element, so heading styling is what the budget measures | LCP element is a body-text `<div>`/`<p>` on all four routes, never the `<h1>` | **ruled out** |
| The LCP element is an image/media that loads late | `resource-summary.image = 0`; LCP element loads nothing (`load delay 0`, `load time 0`) | **ruled out** |
| The main content is streamed after a server fetch, so first paint waits for the API | No `loading.tsx`; no Suspense boundary on the measured routes; zero `<!--$?-->` markers; the loader is awaited before any JSX; and the static, fetch-free legal page is the **slowest** of the four | **ruled out** |
| Server/TTFB latency is the plateau | `server-response-time` 13 ms; simulated TTFB is 453 ms (18 %) and is Lantern's model of the user's latency, not server work | **ruled out as a server-side cause** (it is a real 18 % of the simulated number, but nothing to fix in the app) |
| The plateau is specific to the dynamic result/preset pages | Static legal 2 628 ms ≥ dynamic 2 473 / ISR 2 476 ms | **ruled out** (site-wide) |
| The plateau is the shared shell: ~285–303 KB total, 170 942 B of it script on the result route, behind one stylesheet and one font | All four routes pay 2473–2628 ms for the same shell: script 169 670–170 942 B, stylesheet 16 544 B, font 48 732 B (legal 2 fonts / 72 140 B), total 285 362–302 500 B; `image = 0` on all four | **confirmed** |
| The 12 script chunks are part of the render delay | Blocking `*.js`: LCP 2 473 → 1 804 ms (−669 ms, −27 %) with FCP unchanged | **confirmed** (≈669 ms of the 2 020 ms render delay) |
| Web-font blocking (FOIT) delays text paint | Blocking `*.woff2` makes FCP and LCP **worse**; every real face is `font-display:swap` | **ruled out** |
| The remaining ~1.35 s (the 1 804 ms floor with JS removed) | Not attributed in this pass — it is inside the simulated latency/serialisation chain for the document, stylesheet and font | **UNKNOWN** |

**No cause beyond the two confirmed ones was found in this pass, and none is guessed at.** The
unattributed residue is the simulated cost of the shell's request chain (document → render-blocking
stylesheet → preloaded font, at 562.5 ms of modelled latency per round trip) plus the 285–303 KB transfer
itself; naming which of those dominates needs a second pass with Lantern's simulation detail, which
this pass did not collect.

### One proposed fix per confirmed cause — NOT applied

| Confirmed cause | Proposed fix (not applied) | Expected effect |
|---|---|---|
| The script bundle contributes ≈669 ms of the LCP render delay | Reduce what the shell ships first-load — e.g. keep the client islands (`SaveBuildButton`, `SwapPanel`, `HeaderNav`) out of the initial chunk graph and let the cards' server text paint without them | Up to ~669 ms of the simulate-mode LCP, bounded by the 3 138 B of script headroom the budget leaves. **Must be measured**: the budget allows 1.8 % more script, so any change that ships bytes back is a red gate, not a wash |
| The plateau is the shared shell, not any single page | No per-page fix exists; treat the budget as a shell-level number and the §6 devtools figure (1.78–1.89 s) as the realistic one | Reporting only — this row proposes a review of what the 2 500 ms budget is meant to constrain, not a code change |

## 10. Open items

1. **Headroom is inside the noise.** Median 2 473 ms (result) and 2 476 ms (preset) against a 2 500 ms
   budget is 24–27 ms of slack, and single runs in this session ranged 2 328–2 879 ms on the result
   page alone. The gate can go red with no code change. Owner decision, not an agent one.
2. **Script headroom is 3 138 B (1.8 %)** of the 174 080 B budget on the result route (170 942 B
   measured). Any further client-side addition is already at the edge.
3. **The unattributed ~1.35 s of render delay** is UNKNOWN, as stated in §9. Closing it needs a
   second pass (Lantern simulation detail / trace-level dependency data), not more of this one.
4. **The 404-shell control probe is unusable** (`ERRORED_DOCUMENT_REQUEST`), so "a page with almost no
   content" was never measured. §7's static legal page is the strongest content-free-ish control this
   pass has.
5. **`lighthouserc.cjs` is untouched** and `npm run test:lighthouse` was NOT run in this task — the
   numbers above come from the same settings driven directly through the installed Lighthouse, and
   that difference is stated rather than blurred.
6. Measured on **Node v24.21.0** while CI pins Node 22; Lighthouse is browser-side, but a rerun under
   the CI version would make the comparison exact.
