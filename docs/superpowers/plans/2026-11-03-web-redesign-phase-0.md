# Web Redesign — Phase 0 (Baseline and Feasibility) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Stitch design source in the repo, record a measured baseline of every `apps/web` gate, and answer — YES/NO with a file path — whether the API can feed each element the redesign screens draw.

**Architecture:** Phase 0 changes no screen and no engine. It moves the untracked design exports into `apps/web/design/stitch/`, maps each screen to a route or a state, captures v1 reference screenshots, then produces two decision documents (`FEASIBILITY.md`, `API_REQUESTS.md`) that Phase 2's gate G2 and Phase 4's screens are built against. Three small hygiene fixes (`@types/node`, two lint warnings, the unused Turbopack plugin) ride along because they are prerequisites for a trustworthy baseline.

**Tech Stack:** Node 22, Next.js 16 App Router, TypeScript strict, Tailwind v4 (`@theme` tokens), next-intl (fr/ar), Playwright, LHCI, ESLint, plain `node:` scripts.

**Spec:** `docs/web-v2/PLAN.md` (v5 — the amended redesign plan this plan implements).

**Scope note:** this is plan 1 of N. Phase 1 (tokens) onward get their own plans, written when their gate is reached. Phase 0 does not attempt a token, kit or screen change.

## Global Constraints

- Branch `web-redesign`. One task = one commit. Update `docs/web-v2/PROGRESS.md` after each task.
- Never modify `apps/api/`, `database/`, `src/`.
- Never read or print a real `.env` value. Cite env var NAMES only (`NEXT_PUBLIC_API_BASE_URL`, `API_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, `MOCK_API_PORT`).
- `lib/` edits only by allowlist: named file + one-line reason in `DEVIATIONS.md`. Phase 0 needs none.
- Dependencies: do not add any in Phase 0. `@types/node` moves `^20` → `^22`; nothing else.
- Tokens only (`npm run check:tokens`), logical CSS only, all strings via `messages/` with fr + ar parity (`npm run check:i18n`).
- Report every check as PASS / FAIL / BLOCKED with the exact command. A check not run is BLOCKED, never PASS.
- Budget bounds are client-owned and must not move: `BUDGET_MIN = 500`, `BUDGET_MAX = 1_000_000` (`apps/web/lib/wizard/model.ts:49-50`).
- Arabic font stays vendored (`apps/web/app/globals.css` `@font-face`); do not convert it to `next/font`.

## Review Focus

1. **A design export that is silently missing.** The Stitch source is 22 untracked directories; a move that drops one leaves Phase 4 hunting a screen nobody can find. Pinned by Task 1's inventory assertion (22 directories, each with `code.html` + `screen.png`).
2. **A baseline that reports PASS without running.** `npm run build`, `npm test` and `npm run test:lighthouse` are the three that get skipped, and a stale `.next` or a lingering server on 3210 changes their answer. Pinned by Task 2 (explicit exit codes, server-port pre-check, raw counts).
3. **A feasibility answer with no evidence.** "Images: no" is only useful with the file that proves `image_url` never reaches the contract. Pinned by Task 3's per-row `evidence` column and the assertion that every row cites an existing path.
4. **A hygiene fix that hides a real failure.** Removing `@tailwindcss/turbopack` while dev silently depends on it, or bumping `@types/node` past what `tsc` reads, turns a latent gap into a green lie. Pinned by Tasks 4-6: each fix runs build + the full suite *before* the commit stands.
5. **Arabic checked last.** RTL regressions on the captured reference set are invisible unless both locales are captured for every route. Pinned by Task 7 (every route × `fr`/`ar` × 360/768/1280, with a count assertion).

---

### Task 1: Land the Stitch design source and map every screen

**Files:**
- Create: `apps/web/design/stitch/<screen>/code.html` + `screen.png` (22 dirs, moved)
- Create: `apps/web/design/stitch/DESIGN.md`
- Create: `apps/web/design/stitch/README.md`
- Create: `docs/web-v2/SCREENS.md`
- Modify: `apps/web/.gitignore` (only if `design/` is ignored — verify first)

**Interfaces:**
- Consumes: nothing.
- Produces: `apps/web/design/stitch/<screen>/` for every screen; `docs/web-v2/SCREENS.md` whose table rows are `screen dir | v1 route | kind (route | state) | note`. Phase 4 reads this table to decide task order; Task 7 reads it to drive captures.

- [ ] **Step 1: Verify the source inventory before moving anything**

Run:
```bash
ls apps/web-v2/stitch_morocco_pc_builder_app | grep -v '^moroccan_hardware_studio$' | wc -l
find apps/web-v2/stitch_morocco_pc_builder_app -mindepth 2 -maxdepth 2 -name code.html | wc -l
find apps/web-v2/stitch_morocco_pc_builder_app -mindepth 2 -maxdepth 2 -name screen.png | wc -l
```
Expected: `22`, `22`, `22` (plus `moroccan_hardware_studio/DESIGN.md`). A different count means the source changed — stop and report it.

- [ ] **Step 2: Move the source, keeping history out of the way**

The source is untracked, so this is a filesystem move, not a `git mv`:
```bash
mkdir -p apps/web/design/stitch
cp -R apps/web-v2/stitch_morocco_pc_builder_app/. apps/web/design/stitch/
cp apps/web-v2/'morocco-pc design handoff v2.docx' apps/web/design/stitch/
```
Do not delete `apps/web-v2/` yet (Task 8 decides).

- [ ] **Step 3: Write `apps/web/design/stitch/README.md`**

One short paragraph: what these exports are, that no code path imports them, that `code.html` is a
visual reference only (its markup is not to be copied — the kit and tokens own the implementation),
and that `DESIGN.md` is the token source of truth for Phase 1.

- [ ] **Step 4: Write `docs/web-v2/SCREENS.md`**

One table, one row per screen directory, plus a section for routes Stitch never drew. Use these
mappings (verified against `apps/web/app/[locale]/`):

| Screen dir | Route | Kind |
|---|---|---|
| `accueil_morocco_pc` | `/{locale}` | route |
| `configurateur_morocco_pc` | `/{locale}/configurer` | route |
| `configurateur_tape_1_usage` | `/{locale}/configurer?step=…` (usage step) | state |
| `configurateur_tape_3_cran` | usage/resolution step | state |
| `configurateur_tape_4_priorit` | priority step | state |
| `configurateur_1`, `configurateur_2` | budget step variants | state |
| `configurateur_transition_chargement` | submit/loading | state |
| `vos_configurations` | `/{locale}/config/{id}` | route |
| `d_tail_configuration_quilibr` | `/{locale}/config/{id}` (detail of a build) | state |
| `remplacer_la_carte_graphique_quilibr` | `/{locale}/config/{id}` swap sheet | state |
| `mes_enregistrements_morocco_pc` | `/{locale}/enregistrements` | route |
| `mes_enregistrements_tat_vide` | `/{locale}/enregistrements` empty | state |
| `composants_pc_morocco_pc` | `/{locale}/composants` | route |
| `cartes_graphiques_morocco_pc` | `/{locale}/composants?…` (category filter) | state |
| `filtre_marque_cartes_graphiques` | `/{locale}/composants` brand filter sheet | state |
| `nvidia_geforce_rtx_4060_d_tail_composant` | `/{locale}/composants/{slug}` | route |
| `comparer_morocco_pc` | `/{locale}/composants/comparer` | route |
| `guides_morocco_pc` | `/{locale}/guides` | route |
| `quel_budget_pour_un_pc_gamer_guide_morocco_pc` | `/{locale}/guides/{slug}` | route |
| `morocco_pc_1`, `morocco_pc_2` | home variants (merge into one) | state |

List the routes Stitch has **not** drawn: `/{locale}` preset pages (`/{locale}/{presetSlug}`),
`/{locale}/format`, `/{locale}/kit`, `/{locale}/tokens`, `/{locale}/contact`,
`/{locale}/confidentialite`, `/{locale}/mentions-legales`, 404. These inherit the new kit and tokens
with no Stitch reference — say so explicitly.

- [ ] **Step 5: Assert the mapping covers the source**

Run:
```bash
cd /c/projects/morocco-pc && node -e "
const fs=require('fs');
const dirs=fs.readdirSync('apps/web/design/stitch',{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
const md=fs.readFileSync('docs/web-v2/SCREENS.md','utf8');
const missing=dirs.filter(d=>!md.includes(d));
console.log('dirs:',dirs.length,'missing from SCREENS.md:',missing);
if(missing.length)process.exit(1);
"
```
Expected: `missing from SCREENS.md: []`, exit 0.

- [ ] **Step 6: Verify the gates still pass, then commit**

Run: `cd apps/web && npm run check:tokens && npm run lint`
Expected: both exit 0 (`design/` is not in the token gate's `app|components|lib` scope — this proves it).

```bash
git add apps/web/design docs/web-v2/SCREENS.md
git commit -m "web: land the Stitch design source and map every screen"
```

---

### Task 2: Record the measured baseline

**Files:**
- Create: `docs/web-v2/PROGRESS.md`
- Modify: `docs/web-v2/PLAN.md` (the baseline table's three `see PROGRESS.md` rows)

**Interfaces:**
- Consumes: Task 1 (nothing structural).
- Produces: `docs/web-v2/PROGRESS.md` with a `## Baseline 2026-11-03` section holding one row per gate: `command | exit | result | note`. Phase 6 compares its Lighthouse numbers against the values recorded here, so the numbers must be literal.

- [ ] **Step 1: Free port 3210 and confirm the build is fresh**

```bash
cd /c/projects/morocco-pc/apps/web
netstat -ano | grep -E ":3210|:3211|:3000" | head
```
Expected: nothing listening on 3210/3211 (a stale `npm run start` makes Playwright reuse a server built from older code). If something holds 3210, stop it by its PID — never by name pattern.

- [ ] **Step 2: Run the three gates that are easy to skip**

```bash
set -o pipefail
npm run build > /tmp/base-build.log 2>&1; echo "build exit=$?"; tail -25 /tmp/base-build.log
```
Expected: exit 0. Record the route table's dynamic/static markers verbatim — `/sitemap.xml` and `/robots.txt` are `ƒ` by design, the four preset OG images and the shelf are `●`.

- [ ] **Step 3: Run the full Playwright suite**

```bash
npm test > /tmp/base-test.log 2>&1; echo "test exit=$?"; grep -E "passed|failed|skipped|flaky" /tmp/base-test.log | tail -5
```
Expected: exit 0, **`379 passed`, `2 skipped`, total 381** (measured 2026-11-03; `AGENTS.md`'s 378/376/2 is stale by three specs — record the measured figure, never the documented one). The two skips are `wizard-browser-api.spec.ts` (needs `E2E_BROWSER_API=1`) and `wizard-engine.spec.ts` (the opt-in real-engine harness). Any other failure is a baseline defect: record it, do not fix it in this task.

- [ ] **Step 4: Run the Lighthouse budget**

```bash
npm run test:lighthouse > /tmp/base-lh.log 2>&1; echo "lh exit=$?"; grep -Ei "largest-contentful|cumulative-layout|resource-summary|categories:performance|assertion|median" /tmp/base-lh.log | tail -20
```
Expected: exit 0 with all four assertions passing on both fixture URLs (result page + preset page). Record the three-run LCP/CLS/script-byte figures; these are the Phase 6 comparison points.

- [ ] **Step 5: Write `docs/web-v2/PROGRESS.md`**

The five static gates from the branch start (typecheck, lint, check:tokens, check:i18n,
check:api-types — all PASS, with the two lint warnings named), plus build / test / lighthouse from
Steps 2-4 with their literals.

- [ ] **Step 6: Commit**

```bash
git add docs/web-v2/PROGRESS.md docs/web-v2/PLAN.md
git commit -m "web: record the phase 0 baseline (build, suite, lighthouse)"
```

---

### Task 3: Answer FEASIBILITY.md, YES/NO per element, with evidence

**Files:**
- Create: `docs/web-v2/FEASIBILITY.md`
- Create: `docs/web-v2/API_REQUESTS.md`

**Interfaces:**
- Consumes: `apps/web/lib/api/schema.d.ts` (contract 1.10.0), `apps/api/src/repository.js`, `database/migrations/020_product_identity_and_media.sql`.
- Produces: a table `element | answer | field path or gap | evidence file` whose every row cites a path that exists. Phase 2 (G2) and Phase 4 read it to decide what a screen may draw; `API_REQUESTS.md` collects the NOs.

- [ ] **Step 1: Write the table with these answers, each already verified during the plan review**

| Element | Answer | Field path / gap | Evidence |
|---|---|---|---|
| usage, resolution, priority values | YES | `GET /v1/meta/options` → `use_cases[]`, `resolutions[]`, `priorities[]` (`{value,label}`) | `lib/api/schema.d.ts:455+` |
| budget min/max | YES, client-owned | `BUDGET_MIN 500` / `BUDGET_MAX 1_000_000`, log-scale snap; the API serves none | `lib/wizard/model.ts:49-50` |
| tier labels | YES, from strategy | `builds[].strategy_key` ∈ `PERFORMANCE|BALANCED|VALUE`; `strategyLabel()` falls back to `OTHER` for null | `lib/result/model.ts` |
| price status | YES, 2 API states | `builds[].price_status` ∈ `indicative|verified`; the app derives the third, `demo` | `lib/result/model.ts` `priceProvenance()` |
| price verification date | **NO** | only `generated_at` exists in the payload; `fetched_at` never leaves the DB | `lib/api/schema.d.ts:930+`, `messages/fr.json` `result.provenance.verifiedDated` |
| build compatibility | YES | `builds[].compatibility_status` is **exactly** `PASS` or `UNKNOWN` — not a four-value vocabulary | `src/recommendation/persistence/validate-selected.js:150` |
| per-part compatibility | **NO** | `components[]` carries no compatibility field | `lib/api/schema.d.ts` build `components[]` |
| images (build / product / preset) | **NO** | `image_url`/`image_source` are "documentation-only"; `repository.js` never selects them; catalog payload has no image field | `database/migrations/020_*.sql`, `apps/api/src/repository.js` |
| retailer-level totals and links | **NO** | `components[]` carries `store_offer_id` only — no store name, URL or per-offer price | `lib/api/schema.d.ts` build `components[]` |
| reason lines | PARTIAL | `reasons[]` is not in contract 1.10; render the committed `explanation` string plus client-derived facts | `lib/result/reasons.ts` header |
| remaining budget | YES, client | `remainingBudget(total, budget)` already implemented and tested | `lib/result/model.ts` |
| single build by rank | **NO** | only `builds/{rank}/swap-preview` and `builds/{rank}/swap` exist; the detail page must select from `builds[]` | `lib/api/schema.d.ts` paths |

- [ ] **Step 2: Turn every NO into an `API_REQUESTS.md` row**

One row per gap: what the screen needs, which field/route would serve it, the decision it replaces
(D1 images, D3 retailers, per-part compat, verification date, single-build GET), and the reduced
behaviour to ship without it. Per the gap rule in `PLAN.md`: each NO is answered in
`DEVIATIONS.md` at G2, not deferred to a blocker.

- [ ] **Step 3: Assert every cited path exists**

```bash
cd /c/projects/morocco-pc && node -e "
const fs=require('fs');
const md=fs.readFileSync('docs/web-v2/FEASIBILITY.md','utf8');
const paths=[...md.matchAll(/[a-z0-9_.\\/-]+\\.(?:ts|js|sql|json|md)/g)].map(m=>m[0]);
const missing=[...new Set(paths)].filter(p=>!fs.existsSync(p)&&!fs.existsSync('apps/web/'+p));
console.log('cited:',new Set(paths).size,'missing:',missing);
if(missing.length)process.exit(1);
"
```
Expected: `missing: []`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs/web-v2/FEASIBILITY.md docs/web-v2/API_REQUESTS.md
git commit -m "web: answer feasibility for every redesigned element"
```

---

### Task 4: Move `@types/node` to ^22

**Files:**
- Modify: `apps/web/package.json` (`@types/node`)
- Modify: `apps/web/package-lock.json` (via npm)

**Interfaces:**
- Consumes: nothing.
- Produces: a types surface matching `engines.node >=22`. No API change.

- [ ] **Step 1: Confirm the mismatch is real, not already fixed**

```bash
cd /c/projects/morocco-pc/apps/web && node -p "require('./package.json').devDependencies['@types/node'] + ' / engines ' + require('./package.json').engines.node"
```
Expected: `^20 / engines >=22`. If it already reads `^22`, skip this task and say so.

- [ ] **Step 2: Install the runtime-matching types**

```bash
npm install --save-dev @types/node@^22 2>&1 | tail -5
npm ls @types/node --depth=0
```
Expected: `@types/node@22.x`, no peer warnings.

- [ ] **Step 3: Prove the typecheck and build still pass**

```bash
set -o pipefail
npm run typecheck; echo "typecheck exit=$?"
npm run build > /tmp/node22-build.log 2>&1; echo "build exit=$?"
```
Expected: both exit 0. A new `tsc` error here is real — fix it rather than reverting the bump only if the error is in `apps/web` code; if it comes from a dependency's own `.d.ts`, record it and revert, because Phase 0 does not fight dependencies.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json
git commit -m "web: align @types/node with the declared Node 22 runtime"
```

---

### Task 5: Clear the two lint warnings

**Files:**
- Modify: `apps/web/mock/server.mjs:91` (unused `VARIANTS_BY_SLUG` import)
- Modify: `apps/web/postcss.config.mjs:2` (anonymous default export)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run lint` with zero warnings, so Phase 1+ can use "no new warnings" as a gate.

- [ ] **Step 1: Reproduce exactly two warnings**

```bash
cd /c/projects/morocco-pc/apps/web && npm run lint 2>&1 | tail -8
```
Expected: `✖ 2 problems (0 errors, 2 warnings)`.

- [ ] **Step 2: Drop the unused import**

`mock/server.mjs:91` — `VARIANTS_BY_SLUG` is imported and never referenced (verified: the only
occurrence in the file is the import line). Remove that one line from the import list.

- [ ] **Step 3: Name the PostCSS config object**

`postcss.config.mjs` currently ends `export default { plugins: … }`. Assign it first:
`const config = { plugins: { '@tailwindcss/postcss': {} } };` then `export default config;`
The `/** @type {import('postcss').Config} */` comment moves to the `const` line.

- [ ] **Step 4: Prove lint is clean and the styles still build**

```bash
set -o pipefail
npm run lint; echo "lint exit=$?"
npm run build > /tmp/lintfix-build.log 2>&1; echo "build exit=$?"
grep -c "\.css" /tmp/lintfix-build.log
```
Expected: lint exit 0 with **no** warning lines; build exit 0. Then assert the stylesheet directly, because the build LOG prints no CSS line (measured 2026-11-03 — grep the log and you get 0 even on a healthy build): `find .next/static -name "*.css"` must return exactly one file (73 169 B at the 2026-11-03 baseline, `.next/static/chunks/<hash>.css`) and `grep -rho 'href="[^"]*.css"' .next/server/app | head -1` must show that same chunk referenced. A PostCSS config that stopped being read builds green and ships unstyled.

- [ ] **Step 5: Commit**

```bash
git add apps/web/mock/server.mjs apps/web/postcss.config.mjs
git commit -m "web: clear the two standing lint warnings"
```

---

### Task 6: Decide `@tailwindcss/turbopack` from evidence

**Files:**
- Modify: `apps/web/package.json`, `apps/web/package-lock.json` (only if the removal passes)

**Interfaces:**
- Consumes: nothing.
- Produces: a documented keep-or-remove decision in `docs/web-v2/PROGRESS.md`.

- [ ] **Step 1: Confirm nothing references it**

```bash
cd /c/projects/morocco-pc/apps/web && grep -rn "turbopack" package.json next.config.ts postcss.config.mjs 2>/dev/null; echo "grep exit=$?"
```
Expected: only the `package.json` dependency line (no `--turbopack` script flag, no config reference). If a config reference appears, keep the dependency and record why.

- [ ] **Step 2: Remove it**

```bash
npm uninstall @tailwindcss/turbopack 2>&1 | tail -3
```

- [ ] **Step 3: Prove the three paths that could depend on it**

```bash
set -o pipefail
npm run build > /tmp/turbo-build.log 2>&1; echo "build exit=$?"
(timeout 45 npm run dev > /tmp/turbo-dev.log 2>&1 &) ; sleep 25
curl -s -o /dev/null -w "dev /fr %{http_code}\n" http://localhost:3210/fr
```
Expected: build exit 0; `dev /fr 200`. Then stop that dev server by its PID and run the suite:
`npm test > /tmp/turbo-test.log 2>&1; echo "test exit=$?"` — expected exit 0 with the same
`379 passed / 2 skipped` (381 specs).

- [ ] **Step 4: Keep or revert, and record it**

Pass ⇒ commit the uninstall with the four measured results in the message body. Fail ⇒
`git checkout -- package.json package-lock.json` and record BLOCKED with the failing command's first
error line. Either way, one note in `PROGRESS.md`.

```bash
git add apps/web/package.json apps/web/package-lock.json docs/web-v2/PROGRESS.md
git commit -m "web: remove the unused Tailwind Turbopack plugin (build+dev+suite verified)"
```

---

### Task 7: Capture the v1 reference set (fr + ar, three widths)

**Files:**
- Create: `apps/web/scripts/capture-reference.mjs`
- Create: `apps/web/design/v1-reference/*.png`
- Modify: `apps/web/package.json` (a `capture:reference` script)

**Interfaces:**
- Consumes: `docs/web-v2/SCREENS.md` (the route list), the built app on 3210, the fixture mock on 3211.
- Produces: `apps/web/design/v1-reference/<route-slug>.<locale>.<width>.png` plus a printed count, so Phase 4 has a before-image for every screen it restyles.

- [ ] **Step 1: Write the capture script**

`apps/web/scripts/capture-reference.mjs`, Playwright's chromium (already a dev dependency at the
package root):

```js
// Signature: captureReference({ baseURL, outDir, routes, locales, widths })
// routes: string[]  — locale-less paths from SCREENS.md, e.g. "/", "/configurer"
// locales: ("fr"|"ar")[]; widths: number[]  — 360, 768, 1280
// For each (route, locale, width): page.setViewportSize, goto `${baseURL}/${locale}${route}`,
// wait for `networkidle`, screenshot to `<outDir>/<slug(route)>.<locale>.<width>.png`.
// Slug rule: "/" -> "home", "/configurer" -> "configurer", "/" separators -> "-", no leading dash.
// Exit 1 if any screenshot failed; print the count on success.
```

Routes to capture: `/`, `/configurer`, `/config/<fixture id>`, `/enregistrements`, `/composants`,
`/composants/comparer`, `/composants/<fixture slug>`, `/guides`, `/guides/<fixture slug>`,
`/config-pc-gamer-9000-dh`, `/contact`, `/confidentialite`, `/mentions-legales`. Fixture ids and
slugs come from `mock/fixtures.mjs` (`IDS`, `PRODUCT_IDS_BY_SLUG`) — import them, never hardcode.

- [ ] **Step 2: Run it against the built app**

```bash
cd /c/projects/morocco-pc/apps/web
(npm run start > /tmp/cap-app.log 2>&1 &) ; (npm run mock:api > /tmp/cap-mock.log 2>&1 &) ; sleep 8
node scripts/capture-reference.mjs --out design/v1-reference
```
Expected: `captured: 78` (13 routes × 2 locales × 3 widths). A 404 route in the list fails the run —
that is the point: the route list is verified, not assumed.

- [ ] **Step 3: Assert the file count, then stop both servers**

```bash
ls design/v1-reference/*.png | wc -l
```
Expected: `78`. Stop only the PIDs you started (`netstat -ano` → kill by PID), never by pattern.

- [ ] **Step 4: Commit**

```bash
git add apps/web/scripts/capture-reference.mjs apps/web/package.json apps/web/design/v1-reference
git commit -m "web: capture the v1 reference set for every route in both locales"
```

---

### Task 8: Close Phase 0

**Files:**
- Modify: `docs/web-v2/PROGRESS.md`
- Modify: `docs/web-v2/PLAN.md` (baseline table final)

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: a Phase 0 exit record naming what passes, what is BLOCKED, and what Phase 1 inherits.

- [ ] **Step 1: Re-run the full gate set on the final tree**

```bash
cd /c/projects/morocco-pc/apps/web && set -o pipefail
for s in typecheck lint check:tokens check:i18n check:api-types build; do
  npm run "$s" > "/tmp/final-$s.log" 2>&1; echo "$s exit=$?"
done
npm test > /tmp/final-test.log 2>&1; echo "test exit=$?"; grep -E "passed|skipped|failed" /tmp/final-test.log | tail -3
```
Expected: every exit 0; `379 passed / 2 skipped` (381 specs). These are the Phase 1 starting numbers.

- [ ] **Step 2: Decide the fate of `apps/web-v2/`**

It is now a duplicate of `apps/web/design/stitch/`. Record the decision in `PROGRESS.md`: leave it
untracked for one more phase, or delete it (the user's call — the v4 plan only said "keep design-v2").
Do not delete it in this task without that decision; deletion is Phase 0's only irreversible act.

- [ ] **Step 3: Write the Phase 0 exit record**

`PROGRESS.md`: one line per task with its commit SHA and verdict, then a `## Phase 1 inherits`
section: the 84-file token gate baseline, the `@theme` block location, the DESIGN.md token list, the
174 080 B script budget, and the four FEASIBILITY NOs that gate G2 must answer in `DEVIATIONS.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/web-v2/PROGRESS.md docs/web-v2/PLAN.md
git commit -m "web: close phase 0 with the exit record"
```

---

## Self-review notes

- **Spec coverage:** `PLAN.md` Phase 0 asks for a baseline (Task 2), FEASIBILITY (Task 3), the two
  lint fixes + `@types/node` + Turbopack decision (Tasks 4-6), and reference captures (Task 7). The
  v5 additions that Phase 0 owns are the doc-home consolidation (Tasks 1-3 write into `docs/web-v2/`)
  and the gap rule (Task 3 Step 2). Playwright viewports, the `viewport` export, `HEX_EXEMPT` and the
  deploy recipe are Phase 2/5/6 work and are deliberately absent here.
- **Type consistency:** the only interface crossing tasks is `SCREENS.md`'s table, consumed by
  Task 7 Step 1 (`routes` from the `route` column) and Phase 4. `captureReference`'s shape is stated
  once, in Task 7.
- **Proportion:** 8 tasks, one commit each, no screen rewrites. Anything that restyles a page belongs
  to a later plan.
