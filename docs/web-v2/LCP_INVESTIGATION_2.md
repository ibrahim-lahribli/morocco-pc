# LCP_INVESTIGATION_2.md — round 2: variance, JS composition, first-load audit, Node pin

Measurement only. Written 2026-11-05 on `web-redesign` (tree at `3d9256c`, plus this file).
Round 1 is `LCP_INVESTIGATION.md`; its URLs, settings and build are reused unchanged.

**Nothing was applied, fixed, pushed or merged. `apps/web/lighthouserc.cjs` and all app code are
untouched, `package.json` gained nothing, and no `.env` value was read.** Three ad hoc `npx` tools
were used and only for analysis — `acorn@8`, `source-map-explorer`, `node@22` — none installed into
the project. Raw Lighthouse JSON stays in `apps/web/tmp/lcp/` (`/tmp/` is gitignored); this file is
the only committed artifact.

Same routes and same settings as round 1: `formFactor: "mobile"`, 360×800 DSF 2,
`throttling {rttMs:150, throughputKbps:1638.4, cpuSlowdownMultiplier:4}`, `onlyCategories:
["performance"]`, Lighthouse **12.6.1** from the repo's own `node_modules`, `next start -p 3210`
from the build at `.next/BUILD_ID jIm3UeCl8S20wDVE-ioyc` (built 01:04; every commit since is
documentation or comments only), fixture mock on 3211.

```bash
cd apps/web
node tmp/lcp/probe.mjs --method=devtools --tag=dev10 --runs=10 --urls=<one URL per invocation>
node tmp/lcp/probe.mjs --method=simulate --tag=blk-fw  --runs=3 --block="<6 framework chunks>"  --urls=<result>
node tmp/lcp/probe.mjs --method=simulate --tag=blk-app --runs=3 --block="<6 app chunks>"       --urls=<result>
node tmp/lcp/probe.mjs --method=simulate --tag=blk-all --runs=3 --block='*.js'                 --urls=<result>
npx -y node@22 tmp/lcp/probe.mjs --method=simulate --tag=sim22  --runs=3 --urls=<result>
node          tmp/lcp/probe.mjs --method=simulate --tag=sim24b --runs=3 --urls=<result>
node tmp/lcp/devstats.mjs '<tag/url groups>'      # spread + median-window simulation
node tmp/lcp/modules.mjs .next/static/chunks/*.js # module attribution (after the acorn step)
```

One `run_terminal_command` was interrupted by a runner restart during the legal-page series; runs 1-8
of that series survived and runs 9-10 were re-run afterwards with `--start=9` rather than redoing the
finished ones. No measurement below was taken from a partially-written report.

## 1. Task 1 — `devtools` variance, 10 runs per URL

`throttlingMethod: "devtools"` (a real throttle, not Lantern's projection). **FCP equals LCP in all
40 runs** — the first paint is the LCP entry, so one series serves for both.

| URL | per run (FCP/LCP, ms) | min | median | max | stdev |
|---|---|---|---|---|---|
| result | 1892 1820 1846 1798 1846 1784 1827 1789 1828 1793 | 1784 | **1823.5** | 1892 | 33.4 |
| preset | 1922 1774 1808 1773 1816 1792 1773 1805 1798 1827 | 1773 | **1801.5** | 1922 | 44.0 |
| home | 1875 1837 1843 1784 1808 1816 1818 1834 1831 1832 | 1784 | **1831.5** | 1875 | 23.9 |
| legal | 1854 1784 1777 1797 1775 1797 1800 1778 1827 1774 | 1774 | **1790.5** | 1854 | 26.0 |

### Would a median-of-3 / median-of-5 verdict be stable?

Every CONSECUTIVE window was scored against the 2 500 ms line (8 windows of 3, 6 windows of 5 per URL):

| URL | median-of-3 windows | median-of-5 windows |
|---|---|---|
| result | 1846 1820 1846 1798 1827 1789 1827 1793 → **8/8 pass** | 1846 1820 1827 1798 1827 1793 → **6/6 pass** |
| preset | 1808 1774 1808 1792 1792 1792 1798 1805 → **8/8 pass** | 1808 1792 1792 1792 1798 1798 → **6/6 pass** |
| home | 1843 1837 1808 1808 1816 1818 1831 1832 → **8/8 pass** | 1837 1816 1816 1816 1818 1831 → **6/6 pass** |
| legal | 1784 1784 1777 1797 1797 1797 1800 1778 → **8/8 pass** | 1784 1784 1797 1797 1797 1797 → **6/6 pass** |

**The `devtools` verdict is stable either way**, with a margin of 670-710 ms and a stdev under 45 ms.
Raising the aggregation from 3 to 5 runs changes no verdict on any URL — it only narrows the medians
(result 1823.5 → 1827, preset 1801.5 → 1792). A median-of-3 is sufficient for this measurement;
a median-of-5 buys nothing that the margin has not already bought.

### The gate that IS unstable is the simulated one

Round 1's `simulate` series (3 runs per URL, same build) sits 3-27 ms under the 2 500 ms line:

| URL | simulate runs | median | single-run spread |
|---|---|---|---|
| result | 2879 / 2473 / 2497 | **2497** | 406 ms |
| preset | 2476 / 2328 / 2475 | **2475** | 148 ms |
| home | 2479 / 2476 / 2327 | **2476** | 152 ms |
| legal | 2628 / 2622 / 2785 | **2628** | 163 ms (**over the line**) |

So the two methods disagree about both the number (1.79-1.83 s vs 2.47-2.63 s) and its stability
(±22 ms vs ±406 ms). §5 turns that into the recommendation.

## 2. Task 2 — framework vs app share of the JS cost

### How the chunks were identified (not by file name)

Three independent pieces of build evidence, all from the build's own artifacts:

1. **`.next/build-manifest.json` → `rootMainFiles`** names the five chunks Next ships as the root
   main set: `1x6obpmlu1_c2.js`, `2r4s4h5xul1n-.js`, `2khxl0v1q4i6n.js`, `2e268anpfvdoc.js`,
   `turbopack-2c3mg3r-05n1w.js`.
2. **The RSC client-reference manifests** (`.next/server/**/_client-reference-manifest.js`) map a
   module PATH to `{id, chunks}`. Recovered paths include
   `node_modules/next/dist/esm/client/components/layout-router.js` → chunk `0umf92h1sb77c.js`, and
   the seven app islands → chunks `3udmx6ddzfggp.js` / `1311pvtzzxdno.js` (§3).
3. **Content fingerprints** in the chunks themselves: React/Next internals in `2e268anpfvdoc.js`
   (`Minified React error`, `__REACT_DEVTOOLS`) and `2khxl0v1q4i6n.js` (`appBootstrap`, `__next_f`,
   `_next/`), and `radix` only in `3k6ie4hn8y10i.js`, which is NOT first-load.

That splits the 12 first-load requests (170 942 B transfer) into **framework 138 294 B (80.9 %)** and
**app 32 648 B (19.1 %)**:

| chunk | transfer | bucket | evidence |
|---|---|---|---|
| `2khxl0v1q4i6n.js` | 72 416 B | framework | `rootMainFiles`; Next markers; no manifest app path |
| `2e268anpfvdoc.js` | 46 789 B | framework | `rootMainFiles`; 24 046 B module carries React error strings |
| `2r4s4h5xul1n-.js` | 8 021 B | framework | `rootMainFiles` |
| `turbopack-2c3mg3r-05n1w.js` | 4 787 B | framework | `rootMainFiles`; loader markers |
| `0umf92h1sb77c.js` | 3 910 B | framework | manifest paths `next/dist/esm/client/components/*` |
| `1x6obpmlu1_c2.js` | 2 371 B | framework | `rootMainFiles` |
| `2tns52uo1-vzn.js` | 9 402 B | app | manifest path `app/[locale]/configurer/wizard.tsx` (id 86639) |
| `1311pvtzzxdno.js` | 8 393 B | app | manifest paths `swap-panel.tsx`, `save-build-button.tsx` |
| `3udmx6ddzfggp.js` | 6 497 B | app | manifest paths `header-nav`, `tab-nav`, `locale-switcher`, `analytics` |
| `1x4ktyry7ilm_.js` | 5 039 B | app | no manifest path; no framework fingerprint |
| `2_qia2ygvnwch.js` | 2 045 B | app | no manifest path; no framework fingerprint |
| `3siwkk6b6506r.js` | 1 272 B | app | manifest path `share-bar.tsx` (id 90602) |

(`0cz1d0mv5g_q7.js`, 112 594 B, is `polyfillFiles` and is in the HTML but was never fetched by
Chrome, which is why it is not among the 12.)

### The three blocked runs (simulate, 3 runs each, result URL)

| Condition | LCP per run | median | Δ vs 2 473 ms baseline | FCP |
|---|---|---|---|---|
| baseline (round 1, same build) | 2879 / 2473 / 2497 | 2 473 | — | 906 |
| **(a) framework chunks blocked** (the 6 above) | 1953 / 1953 / 1953 | **1 953** | **−520 ms (−21 %)** | 903 |
| **(b) app chunks blocked** (the 6 above) | 2473 / 2474 / 2480 | **2 474** | **−1 ms (noise)** | 905 |
| **(c) all `*.js` blocked** | 1804 / 1804 / 1804 | **1 804** | **−669 ms (−27 %)** | 904 |

(c) reproduces round 1's −669 ms exactly (round 1: 1803.5 ms over 2 runs), so the control is sound.
Today's own baseline (`sim24b`, §4) is 2 482 ms, which shifts each delta by ≤9 ms.

**Reading:** essentially the whole measured JS cost is the framework bundle. Blocking the app chunks
alone changes nothing, because on the critical path their 32 648 B sit behind 138 294 B of framework
bytes and are not what the paint is waiting for. The 149 ms between (a) and (c) is the app chunks'
`bandwidth` cost once the framework is out of the way: 32 648 B at the simulated 1 474.56 kbps is
≈ 177 ms, and the six app chunks' *script* bytes alone (28 738 B without polyfill/favicon) are
≈ 156 ms — the same order as measured. That ordering is the finding, not a second independent cause.

Caveat, stated because it matters: with the framework blocked the app chunks cannot resolve their
imports, so this measures bytes and scheduling, never app correctness. The pages still paint because
they are server-rendered.

## 3. Task 3 — first-load chunk audit for the result route

### The sanctioned tool is BLOCKED

```bash
find .next -name '*.map' -not -path '*/.next/cache/*' | wc -l   # 260
npx -y source-map-explorer .next/static/chunks/2khxl0v1q4i6n.js --json
#   .next/static/chunks/2khxl0v1q4i6n.js
#     Unable to find a source map.
```

All 260 maps belong to server routes (`page.js.map` beside `page.js`); **no client chunk ships a
map**, so source-map-explorer cannot attribute anything on the browser bundle.

### What was attributed instead, and what could not be

`tmp/lcp/modules.mjs` reads the Turbopack module table (`TURBOPACK.push([...])`, both the
`[source, id, factory, …]` and `[source, [id, factory], …]` shapes) via acorn AST byte spans, and
recovers identity from the RSC manifests. Coverage is **partial and stated as such**:

| chunk | raw bytes | modules | bytes attributed | share |
|---|---|---|---|---|
| `2e268anpfvdoc.js` | 168 355 | 85 | 167 632 | 99.6 % |
| `0umf92h1sb77c.js` | 13 822 | 15 | 13 579 | 98.2 % |
| `1311pvtzzxdno.js` | 25 673 | 2 | 10 895 | 42.4 % |
| `2tns52uo1-vzn.js` | 26 581 | 1 | 10 602 | 39.9 % |
| `1x4ktyry7ilm_.js` | 14 217 | 1 | 2 645 | 18.6 % |
| `3siwkk6b6506r.js` | 1 690 | 1 | 1 569 | 92.8 % |
| `1x6obpmlu1_c2.js` | 5 361 | 2 | 5 208 | 97.1 % |
| `2_qia2ygvnwch.js` | 3 422 | 1 | 1 406 | 41.1 % |
| `3udmx6ddzfggp.js` | 15 518 | 1 | 114 | 0.7 % |
| **`2khxl0v1q4i6n.js`** | **229 820** | 1 | 839 | **0.4 %** |
| **`2r4s4h5xul1n-.js`** | **28 739** | 1 | 64 | **0.2 %** |
| **`turbopack-2c3mg3r-05n1w.js`** | **11 255** | 0 | 0 | 0 % |

**Total attributed: 204 553 B of 544 453 B raw (37.6 %).** Five first-load chunks resisted the module
table parse — `2khxl0v1q4i6n.js` alone is 42 % of the raw bytes — so the list below is the top
modules of the ATTRIBUTED subset, never a top-15 of the whole bundle. `2khxl0v1q4i6n.js`,
`2r4s4h5xul1n-.js`, `turbopack-…`, `3udmx6ddzfggp.js` and `1x4ktyry7ilm_.js` are classified by
manifest + fingerprint only, and their per-module breakdown is unknown.

### Top first-load modules by byte span (attributed subset — 14, not 15)

| bytes | id | bucket | module |
|---|---|---|---|
| 24 046 | 64893 | framework | unmapped React internals (`Minified React error`) in `2e268anpfvdoc.js` |
| 20 050 | 20896 | other | unmapped, `2e268anpfvdoc.js` |
| 14 014 | 77709 | other | unmapped, `2e268anpfvdoc.js` |
| 10 602 | 86639 | app | `app/[locale]/configurer/wizard.tsx` (`2tns52uo1-vzn.js`) |
| 9 942 | 19587 | app | `components/result/swap-panel.tsx` (`1311pvtzzxdno.js`) |
| 9 940 | 24988 | other | unmapped, `2e268anpfvdoc.js` |
| 6 541 | 63416 | other | unmapped, `2e268anpfvdoc.js` |
| 5 398 | 96167 | other | unmapped, `2e268anpfvdoc.js` |
| 4 807 | 39756 | framework | `node_modules/next/dist/esm/client/components/layout-router.js` |
| 4 511 | 12085 | other | unmapped, `2e268anpfvdoc.js` |
| 4 489 | 45794 | other | unmapped, `2e268anpfvdoc.js` |
| 4 450 | 4611 | other | unmapped, `2e268anpfvdoc.js` |
| 4 326 | 87288 | other | unmapped, `2e268anpfvdoc.js` |
| 3 712 | 18576 | other | unmapped, `1x6obpmlu1_c2.js` |

`3k6ie4hn8y10i.js` holds a 40 249 B module (radix fingerprint) but is a LAZY chunk, not first-load,
so it is excluded here.

### Grouping

| group | transfer | share of 170 942 B | how it was established |
|---|---|---|---|
| **React/Next runtime** | **138 294 B** | **80.9 %** | `rootMainFiles` + RSC manifest `next/dist/…` paths + React/Next fingerprints |
| app client islands | 32 648 B | 19.1 % | RSC manifest island paths (`3udmx6ddzfggp`, `1311pvtzzxdno`, `3siwkk6b6506r`, `2tns52uo1`) |
| **next-intl** | **0 B identified** | 0 % | no `node_modules/next-intl` path appears in ANY RSC manifest, and no chunk carries a next-intl fingerprint — the app passes translated strings from the server as props (`analytics.tsx`, `share-bar.tsx`, `swap-panel.tsx` all say so in their headers) |
| other / unmapped | — | — | inside the framework chunks (fingerprints only) |

### The islands: could they render without client JS?

All seven live in `3udmx6ddzfggp.js` (6 497 B transfer), three also in `1311pvtzzxdno.js` (8 393 B).
Estimated transfer for a module is its raw span × the chunk's own compression ratio
(`1311` 0.327, `3siwkk` 0.753); these are ESTIMATES, and nothing was applied.

| island | id | module bytes | why it is a client island | could it render without client JS? | est. transfer saved |
|---|---|---|---|---|---|
| `swap-panel.tsx` | 19587 | 9 942 B | interactive role/replacement pickers, API preview + commit | Yes, by loading it on first open (dialog) instead of first load | ≈ 3.2 KB |
| `share-bar.tsx` | 90602 | 1 569 B | `navigator.share` + clipboard; the WhatsApp anchor already works unhydrated | Yes, hydrating on first press — the anchor needs no JS | ≈ 1.2 KB |
| `save-build-button.tsx` | 89689 | 953 B | `localStorage` state via `useSyncExternalStore` | Partly — a plain "Enregistrer" link could ship, upgrading on idle | ≈ 0.3 KB |
| `analytics.tsx` | 18992 | 114 B | `useEffect` + `window` for `bootstrapAnalytics()` | Yes, and it renders `null` — the only island with zero UI dependency | ≈ 0.1 KB |
| `header-nav.tsx` | 93749 | not recovered | `usePathname()` for `aria-current` | Yes, if the request path arrives as a prop (middleware header) | inside `3udmx6ddzfggp`'s 6 497 B |
| `tab-nav.tsx` | 38485 | not recovered | `usePathname()` for the current tab | Same as header-nav | same chunk |
| `locale-switcher.tsx` | 25883 | not recovered | `usePathname()` to build the alternate-locale href | Yes, with the path passed from the server | same chunk |

The three shell islands exist only because a server layout cannot read the request path; that is a
property of the framework, not of their markup. The quantified conclusion stays the one from §2:
even removing ALL app chunks (32 648 B) moves LCP by ≈ 0 ms while the framework is present.

## 4. Task 4 — Node version (CI pins 22; local is 24)

`npx -y node@22` resolved to **v22.23.4** (no local install needed, nothing added to the project).

| run | Node 22.23.4 (CI pin) | Node 24.21.0 (same session) | Node 24.21.0 (round 1) |
|---|---|---|---|
| 1 | 2868 | 2560 | 2879 |
| 2 | 2485 | 2482 | 2473 |
| 3 | 2480 | 2481 | 2497 |
| **median** | **2 485** | **2 482** | **2 497** |
| stdev | 222.6 | 45.3 | 227.8 |

**No measurable Node-version effect**: the medians differ by 3 ms, both series contain one ~2.5-2.9 s
outlier, and the FCP medians agree within 1 ms (905 vs 905). The outlier, not the runtime, is what
moves these numbers (up to +395 ms over the median).

## 5. Recommendation — which LCP assertion should be the error gate (NOT applied)

The current gate is `largest-contentful-paint` `["error", {maxNumericValue: 2500}]` on the `simulate`
median of 3, and this round measures why that is the wrong assertion to rely on:

- Under `simulate` the medians are 2 475-2 628 ms — the legal page is already **over** it, and the two
  budgeted routes clear it by 3-27 ms while single runs reach 2 879 ms. It is a gate sitting inside
  its own noise.
- Under `devtools` the same pages are 1 773-1 922 ms across **40 consecutive runs**, all 8 median-of-3
  and all 6 median-of-5 windows pass at 2 500 ms, margin ≈ 670-710 ms, stdev ≤ 44 ms.

**Recommendation:** keep an LCP error gate, but make `simulate` a *projection* assertion (e.g.
`maxNumericValue: 2700`, above the 2 628 ms a static page already produces and above the 2.88 s
observed outlier) and add a `devtools`-method LCP ceiling at **2 500 ms** as the gate that actually
means "this page is slow on a throttled phone". Keep `categories:performance >= 0.9` and
`resource-summary:script:size` as they are — script bytes (170 942 B against 174 080 B) are the
budget with real headroom, and they are the input the framework finding in §2 says to watch.

Rationale in one line: the metric that fails is the simulated one, the metric that is stable and
trustworthy is the real-throttle one, so the error gate should be the stable one and the simulated
number should bound regressions rather than define "fast".

## 6. Open items

1. **Five first-load chunks have no module breakdown** (37.6 % of raw bytes attributed; `2khxl0v1q4i6n.js`
   is 42 % of the bundle on its own). Closing it needs either a Turbopack-aware analyzer or a build
   that emits client source maps — `source-map-explorer` is BLOCKED on this build as shown in §3.
2. **The `devtools` gate does not exist yet.** Adding it is a `lighthouserc.cjs` change, and this
   task forbids touching that file. Recommendation only.
3. **The legal page's simulated median (2 628 ms) exceeds the current 2 500 ms line**, so the budget as
   written fails a static, fetch-free page. Pre-existing, not introduced here.
4. **Round 1's ~1.35 s render-delay residue is still UNKNOWN.** Round 2 narrows it (the JS share is
   the framework bundle, worth 520-669 ms) but does not explain the floor.
5. **Variance source is single-machine.** All runs came from one dev box with one Chrome; the runner
   restart interrupted the legal series after run 8 (runs 9-10 were re-run with `--start=9`), and the
   series stayed inside its own range (1 774-1 854 ms), which is why it is used as-is.
6. **`npm run test:lighthouse` was NOT run** in this round either: the measurements drive the same
   settings directly through the installed Lighthouse, and that difference is stated rather than
   blurred.
