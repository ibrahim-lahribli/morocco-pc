# Step 3.1 — Configurator Discovery, API Audit and Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one evidence-grounded architecture report that decides where a personalized PC configurator lives, what the existing API already proves, what it cannot do, and which ordered steps build it — without changing a line of product code.

**Architecture:** The audit is a *measurement* exercise: every claim in the report cites a contract operation, an engine module, a database table or a command's output. Capabilities are inventoried once, in one matrix, as `(capability → where it exists today → what is missing)`. The report then argues the journey and the roadmap from that matrix, never from a hoped-for endpoint.

**Tech Stack:** Node.js 22/24, Next.js 16 App Router, TypeScript, zustand, zod 4, react-hook-form, `@tanstack/react-query` v5, `openapi-fetch` + generated `lib/api/schema.d.ts`, next-intl (fr/ar), Tailwind v4, Vitest, Playwright. Read-only SQL/HTTP only.

**Spec:** The Step 3.1 brief supplied by the owner on 2026-11-07 (its sections are cited below as §1–§13 *of the brief*). The brief is not in the tree; each task restates the requirement it satisfies, so the plan stands alone.

## Global Constraints

- Branch: `feature/v2-design`. Application: `apps/web-v2`. V1 (`apps/web/`) and the engine are read-only.
- Baseline HEAD at plan time: `dcff3996da8a7973928170a5cfb63e4e86b2732c`. Re-measure at Task 1; never assume.
- The five Step 2.2 commits must be present: `f4167f6`, `0614e7f`, `70569c6`, `38bd27a`, `dcff399`.
- Pre-existing untracked paths preserved byte-for-byte: `apps/web-v2/app/[locale]/simulateur-preview/` and `docs/superpowers/`.
- Preserved fix: `apps/web-v2/lib/api/config.ts` inlines `process.env.NEXT_PUBLIC_API_BASE_URL` through a hoisted constant. Do not "tidy" it.
- **No `POST` / `PUT` / `PATCH` / `DELETE` against any API origin.** The only permitted network calls are `GET`. `POST /v1/recommendations` is a real engine write; the swap commit is a write. Neither is exercised.
- No commit, no push, no stash, no reset, no branch operation.
- No change to: homepage components, `lib/**`, `messages/**`, `i18n/**`, the OpenAPI snapshot `apps/api/test/unit/openapi-v1.10.json`, `lib/api/schema.d.ts`, migrations, seeds, Render/environment variables.
- Contract of record: `apps/api/test/unit/openapi-v1.10.json`, `info.version` **1.10.0**, OpenAPI 3.0.3. A capability that is not in it is not a capability the V2 frontend may use.
- Status vocabulary is load-bearing: `PASS | FAIL | UNKNOWN | CONDITIONAL`, and `NULL` means `UNKNOWN`. `UNKNOWN` is never rendered as compatible, and never as incompatible.
- Prices are indicative. `price_status` is `indicative | verified | null`; `offer_class` is `SEED_UNVERIFIED | VERIFIED`. No exchange rate is derived anywhere.
- Arabic native-speaker sign-off (`apps/web-v2/docs/homepage-arabic-review.md`) remains outstanding. Nothing in the report may claim it.
- Report path: `docs/superpowers/specs/step-3-1-configurator-architecture.md`. If it already exists, stop and report the conflict; do not overwrite.

## Review Focus

Input classes and conditions the brief implies but no single task's verification exercises — each is pinned by the task named in brackets. Most likely first:

1. **An `UNKNOWN` compatibility pair reaching the screen.** A visitor reads "compatible" where the engine only said "cannot tell" (a NULL cooler height, a NULL connector). The pair must render as its own state, never folded into pass. [Task 7]
2. **A candidate judged with no build to judge against.** The visitor asks "would this GPU work in what I have?" before a build exists; today there is no evaluation surface without a persisted recommendation. The report must say so rather than proposing a client-side rule table. [Task 7]
3. **A second component change on the same build.** One committed swap per build (Decision 56 item 6) means `409 SWAP_ALREADY_COMMITTED`; a UI that offers "change another part" without knowing this traps the visitor. [Task 7, Task 11]
4. **A swap that overruns the budget.** `budget.delta` is positive and `within_budget` is false; the UI must show the overrun, not silently re-price or clamp. [Task 8]
5. **A question nothing downstream reads.** `meta.options.inputs_applied` may omit `resolution` or `priority`; asking anyway collects an answer the engine discards. [Task 6]

---

### Task 1: Freeze the baseline and scaffold the report

**Files:**
- Create: `docs/superpowers/specs/step-3-1-configurator-architecture.md` (create `docs/superpowers/specs/` first)
- Modify: none

**Interfaces:**
- Consumes: nothing.
- Produces: the report file with the fifteen mandated top-level sections (§12 of the brief) plus `## 0 Audit baseline`; every later task appends to exactly one of them.

- [ ] **Step 1: Re-measure the baseline**

Run:
```bash
git rev-parse --abbrev-ref HEAD && git rev-parse HEAD && git status --short
git --no-pager log --oneline -5
```
Expected: `feature/v2-design`; HEAD `dcff3996da8a7973928170a5cfb63e4e86b2732c` (or a later commit — record whichever is true, and record the five Step 2.2 SHAs from `git log --oneline | grep -E '^(f4167f6|0614e7f|70569c6|38bd27a|dcff399)'`); `git status --short` prints exactly two lines, both `??`: `apps/web-v2/app/[locale]/simulateur-preview/` and `docs/superpowers/`.

- [ ] **Step 2: Scaffold the report**

Create the file with these headings, in this order, each as `## `:
`0 Audit baseline`, `1 Executive summary`, `2 Current V2 architecture`, `3 Backend and API capability audit`, `4 Proposed user journey`, `5 Component selection architecture`, `6 Hardware compatibility analysis`, `7 Budget and pricing strategy`, `8 Homepage integration strategy`, `9 UX and responsive layout structure`, `10 French and Arabic architecture`, `11 Security and reliability`, `12 Testing strategy`, `13 Implementation roadmap`, `14 Technical risks and unresolved decisions`, `15 Acceptance criteria for Step 3.2`.

- [ ] **Step 3: Record the baseline**

Under `## 0`, write the branch, HEAD SHA, the five Step 2.2 SHAs, the two untracked paths, and one line: "Untracked paths are pre-existing and deliberately preserved."

- [ ] **Step 4: Verify the scaffold**

Run: `grep -c '^## ' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: `16` (the fifteen sections plus `0`). Then `git status --short` still prints the same two `??` lines and `git diff --stat` prints nothing.

---

### Task 2: Audit the HTTP surface from the contract, not from the frontend types

**Files:**
- Read: `apps/api/test/unit/openapi-v1.10.json`, `apps/api/src/routes/{catalog,meta,presets,recommendations,health}.js`, `apps/api/src/contracts/{catalog,meta,recommendations}.js`
- Modify: `docs/superpowers/specs/step-3-1-configurator-architecture.md` §3

**Interfaces:**
- Consumes: Task 1's scaffold.
- Produces: §3.1 "Operations" table — one row per operation: method, path, params, body, success shape, failure codes, rate limit. Later tasks cite rows by path.

- [ ] **Step 1: Enumerate every operation**

Run:
```bash
node -e "const j=require('./apps/api/test/unit/openapi-v1.10.json');for(const [p,o] of Object.entries(j.paths))for(const [m,v] of Object.entries(o))console.log(m.toUpperCase(),p)"
```
Expected: exactly ten lines, in this set: `GET /v1/health`, `GET /v1/meta/options`, `GET /v1/presets`, `POST /v1/recommendations`, `GET /v1/recommendations/{id}`, `GET /v1/recommendations/{id}/builds/{rank}/swap-preview`, `POST /v1/recommendations/{id}/builds/{rank}/swap`, `GET /v1/catalog/products`, `GET /v1/catalog/products/{slug}`, `GET /v1/catalog/products/{slug}/price-history`. Any additional line means the snapshot is not the one this plan was written against: stop and report.

- [ ] **Step 2: Record request surfaces verbatim**

For each of the ten, copy from the snapshot: every `parameters[]` entry with its `in` and schema, the `requestBody` properties and required list, and the declared success response `required` array. Copy; do not paraphrase — the report's credibility is that a reader can diff it against the file.

- [ ] **Step 3: Record the rate limits from the source**

Run: `grep -rn "RATE_LIMIT = Object.freeze" apps/api/src/routes/*.js`
Expected: eight constants — reads at `max: 120, timeWindow: '1 minute'` (`health`, `meta`, `presets`, `catalog`, `docs`, recommendations `GET`), and `max: 30` for `POST /v1/recommendations`, `swap-preview`, `swap`. Write these into §3.1 and into §11.

- [ ] **Step 4: Record the catalogue's real narrowing power**

In §3.1 write one sentence, citing the query schema: `GET /v1/catalog/products` narrows by `role` (engine `component_role` vocabulary, unknown → 422), `limit` (1–100), and `cursor` (a slug keyset). There is **no** filter for brand, price range, socket, wattage, form factor, or compatibility. State that consequence plainly: a picker cannot be built on server-side filtering today.

- [ ] **Step 5: Record the catalogue/list-vs-detail identity asymmetry**

Read `CatalogProductDetailSchema` in `apps/api/src/contracts/catalog.js` and `BuildComponentSchema` in `apps/api/src/contracts/recommendations.js`. Write down, field by field:
- the list row carries `id`, `slug`, `display_name`, `category`, `from_price`, `offer_class`, `has_offer`, `variants[{id, sku}]`;
- the detail row is `slug`-keyed and carries **no** `id` and **no** `variants`;
- a swap needs `product_id` **and**, for a GPU, `product_variant_id`.
Then answer explicitly: *can a client get from a product detail page to a swap target?* Record the answer with the field list as evidence. If `BuildComponent` carries no `product_variant_id`, record that as a named gap (the build names a GPU by product only, while a GPU swap requires its variant).

- [ ] **Step 6: Verify §3.1**

Run: `grep -c '^| *\(GET\|POST\)' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: at least `10` operation rows. Then re-read §3.1 against the snapshot output from Step 2: no path, param or code in the table may be absent from that output.

---

### Task 3: Audit the engine and schema behind each capability

**Files:**
- Read: `src/recommendation/compatibility/reason-codes.js`, `src/recommendation/compatibility/index.js`, `src/recommendation/filtering/filter.js`, `src/recommendation/query/*.js`, `database/migrations/*.sql`, `docs/SCHEMA_REFERENCE.md`
- Modify: report §3.2, §6

**Interfaces:**
- Consumes: Task 2's operation rows.
- Produces: §6.1 rule inventory — one row per implemented check: rule, roles, reason code(s), status class (HARD/SOFT), module path. Task 7 consumes it.

- [ ] **Step 1: Count and list the compatibility vocabulary**

Run:
```bash
node -e "const {REASON_CODES}=require('./src/recommendation/compatibility/reason-codes.js');const k=Object.keys(REASON_CODES);console.log(k.length);console.log(k.join('\n'))"
```
Expected: `32` then 32 codes. Group them in §6.1 by pair: CPU↔board, cooler↔socket, cooler↔case height, cooler↔CPU TDP (SOFT), case↔form factor, case↔radiator, platform/motherboard↔RAM type, RAM slots/capacity, GPU↔case, GPU↔PSU wattage/connector.

- [ ] **Step 2: Record which rules are HARD and which are SOFT**

Read the header comments in `reason-codes.js` and `src/recommendation/compatibility/index.js`. For each group record: HARD (definitive reject) vs SOFT (`UNKNOWN`, never `FAIL`) vs UNKNOWN-by-default when a spec is NULL. Cite Decision 26 item B / Decision 45 where the file does.

- [ ] **Step 3: Record the spec data that feeds those rules**

Run: `grep -rhoE "CREATE TABLE (IF NOT EXISTS )?[a-z_]+_spec" database/migrations | sort -u`
Expected: eight tables — `cpu_spec`, `gpu_board_spec`, `motherboard_spec`, `ram_spec`, `ssd_spec`, `psu_spec`, `case_spec`, `cooler_spec`. In §6.2 map each table to the rules it feeds, and name the columns the rules read (from `docs/SCHEMA_REFERENCE.md`, not from memory).

- [ ] **Step 4: Record where a whole build's verdict comes from**

Confirm from `apps/api/src/contracts/recommendations.js` and `routes/recommendations.js`: `builds[].compatibility_status` is persisted per build; `swap-preview.compatibility` is `{ status, pairs[], unknown_pairwise_count }` with per-pair `check`, `role`, `partner_role`, `status`, `reason`, `evidence[]`. Write the one-sentence consequence: **pair-level compatibility is only obtainable for a hypothetical replacement against an existing build; there is no endpoint that evaluates an ad-hoc component set.**

- [ ] **Step 5: Verify §6.1**

Run: `grep -c '^| *[A-Z_]\+ *|' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: at least `32` rule rows, each carrying a code from Step 1's list. Cross-check: every code printed in Step 1 appears exactly once in the table.

---

### Task 4: One capability matrix, five gap classes

**Files:**
- Modify: report §3.3

**Interfaces:**
- Consumes: §3.1 (operations), §3.2 (engine/schema).
- Produces: §3.3 matrix — columns `Capability | Exists today (HTTP op / engine module / DB table) | Evidence | Gap class | Blocks`. Tasks 5–11 and 13 cite rows by capability name.

- [ ] **Step 1: Write the matrix with the corrected column**

The brief's §4 table has three columns and an "Existing endpoint" cell per capability. Eleven of its sixteen capabilities are not HTTP capabilities at all (CPU catalogue, socket compatibility, build scoring, budget optimisation…). Use the four-column form above instead, so a "no endpoint" cell does not read as "does not exist".

- [ ] **Step 2: Classify every row into exactly one gap class**

Allowed values, verbatim from the brief §4: `does not exist` | `exists but not exposed through the API` | `exists but incomplete` | `exists but not consumed by V2` | `evidence insufficient`. A row with no class is a defect.

- [ ] **Step 3: State the three findings the matrix must contain**

Ensure these rows exist and say what was measured:
1. **Auto configuration** — exists and is the engine's whole purpose (`POST /v1/recommendations`), consumed by V2 only behind a disabled flag.
2. **Single component modification** — exists as swap preview + commit, gated to one committed swap per build and 30 requests/min, and **not consumed by V2 at all**.
3. **Free-form/manual assembly** — `does not exist`: no endpoint accepts a partial component set, and no endpoint evaluates a candidate outside a persisted build.

- [ ] **Step 4: Verify**

Run: `grep -c 'does not exist\|not exposed through the API\|exists but incomplete\|not consumed by V2\|evidence insufficient' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: at least as many hits as matrix rows, i.e. no row lacks a class. Spot-check three rows whose evidence cell names a path or an operation.

---

### Task 5: Map what V2 already has

**Files:**
- Read: `apps/web-v2/app/[locale]/{layout,page}.tsx`, `apps/web-v2/lib/api/*`, `apps/web-v2/lib/homepage/*`, `apps/web-v2/components/{home,layout,ui}/*`, `apps/web-v2/i18n/*`, `apps/web-v2/messages/{fr,ar}.json`, `apps/web-v2/tests/**`, `apps/web-v2/e2e/**`, `apps/web-v2/docs/{DESIGN_SYSTEM.md,sections/01-homepage.md}`
- Modify: report §2

**Interfaces:**
- Consumes: nothing.
- Produces: §2 map — a table of concern → existing file(s) → what a configurator may reuse as-is / reuse with extension / must add. Tasks 6, 9, 10 consume it.

- [ ] **Step 1: Inventory by concern**

Rows: routing and locales; homepage sections; finder state; API client and config; query client; generated types; product/build models; shared UI kit; tokens and styling; form and validation; translations; unit tests; E2E harness and stubs. Every cell names a real path from the list above.

- [ ] **Step 2: Record the four reuse decisions with their evidence**

1. State: `lib/homepage/store.ts` is a zustand store with `budgetAmount` and `useCase` only, memory-only, no resolution field — a configurator must not reuse it as its own store.
2. Validation: `lib/homepage/finder-schema.ts` builds a zod schema per locale and owns `resolveBudgetAmount`, `BUDGET_MIN = 3_500`, `BUDGET_MAX = 100_000`, `BUDGET_STEP = 500`. Reuse the bounds, not the schema.
3. Types: `lib/api/schema.d.ts` is generated from the snapshot; `npm run check:api-types` is the drift gate. Nothing is hand-written into it.
4. Tests: unit tests use the injected `fetch` of `createApiClient`; E2E stubs `/v1/**` with `page.route` through `e2e/support/homepage-api.ts`. A configurator's tests inherit both patterns and neither may reach a real API by default.

- [ ] **Step 3: Verify the map and the gates**

Run, from `apps/web-v2`: `npm run check:api-types && npm run typecheck`
Expected: both exit 0 (no drift, no type error) — proving the recorded baseline is the state the plan measured. If either fails, record the failure in §0 and fix nothing: it is a finding, not a task.

- [ ] **Step 4: Verify §2**

Run: `grep -c 'apps/web-v2/\|lib/\|components/' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: non-zero, and every row of the §2 table contains at least one path.

---

### Task 6: The journey, constrained to served vocabulary

**Files:**
- Modify: report §4

**Interfaces:**
- Consumes: §3.1 (operations), §3.3 (matrix).
- Produces: §4 journey — Stage A..F, each with inputs, the field each input maps to, what is mandatory, and what cannot be asked today. Task 9 and 10 consume the stage list.

- [ ] **Step 1: Write Stage A as a field mapping, not a wish list**

For each candidate question, name the contract field or write `not askable today`:
- use case → `POST /v1/recommendations.use_case`, values from `GET /v1/meta/options.use_cases[].value`;
- budget → `budget_amount` (number, `exclusiveMinimum: 0`, `maximum: 1_000_000`; the frontend's own range is 3 500–100 000 per `finder-schema.ts`);
- currency → `currency` (3 chars, from `meta.options.currencies`);
- resolution → `resolution`, **only if** `meta.options.inputs_applied` contains `"resolution"`;
- priority → `priority` (integer 1–5), **only if** `inputs_applied` contains `"priority"`.
State the consequence: `inputs_applied` is the gate; a question absent from it must not be asked (Decision 52).

- [ ] **Step 2: Decide the mode question with evidence**

Write that four candidate modes were evaluated — guided, automatic, manual, modify-existing — and that the API supports exactly two of them today: *automatic* (full pass) and *modify-existing* (one swap per build). Guided is a frontend composition of automatic. Manual component assembly is unsupported. Recommend **one experience with three stages** (requirements → automatic proposal → single-component refinement), not three modes, and say why: there is no partial-assembly surface to hang a manual mode on.

- [ ] **Step 3: Write Stages C–F against the matrix**

For each of the eight roles (`CPU`, `GPU`, `MOTHERBOARD`, `RAM`, `SSD_BOOT`, `PSU`, `CASE`, `CPU_COOLER` — the engine's `component_role` vocabulary), record: which catalogue category serves it, which spec table describes it, and which compatibility rules involve it. Where a role has no catalogue path or no spec coverage today, say so in the row rather than omitting it.

- [ ] **Step 4: Verify**

Run: `grep -c 'not askable today\|inputs_applied' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: at least `2` — the `inputs_applied` gate is stated, and any unaskable input is labelled. Then confirm §4 names all eight roles: `grep -c 'CPU_COOLER' …` ≥ 1 and `grep -c 'SSD_BOOT' …` ≥ 1.

---

### Task 7: Compatibility, stated as a server-authority decision

**Files:**
- Modify: report §6, §11

**Interfaces:**
- Consumes: §6.1 (rules), §3.1 (rate limits).
- Produces: §6.3 policy — one paragraph a reviewer can accept or reject; Task 11 turns it into work.

- [ ] **Step 1: State the authority rule and its proof**

Write: the browser computes no compatibility verdict. Three reasons, each evidenced: 32 reason codes live in the engine; several rules read NULL-tolerant specs where `UNKNOWN` is the correct answer; and Decision 45 made four of the rule groups binding pre-merge gates. A client re-implementation would drift from all three.

- [ ] **Step 2: State the evaluation-surface gap and the request arithmetic**

Write both numbers: a pair-level verdict requires `GET .../swap-preview` (30/min), and one preview answers **one** candidate for **one** role against **one** build. A picker showing 20 GPUs with live verdicts would need 20 previews — two thirds of a minute's budget for one screen. Record the consequence: either the picker shows no per-candidate verdict (selection → one preview on commit-time only), or the backend gains a candidate-listing route that returns verdicts in one response. Name the second as a **backend ask, not implemented in 3.1**.

- [ ] **Step 3: Record the two hard gates a UI must honour**

From `routes/recommendations.js`: one committed swap per build → `409 SWAP_ALREADY_COMMITTED`; `409 SWAP_ROLE_ABSENT` and `409 SWAP_NOT_COMMITTABLE` (the engine's verdict is `FAIL`, or the candidate is not a candidate / has no eligible offer). And a GPU swap **must** name `product_variant_id`; every other role **must not** send one (422 otherwise). Write these as UI constraints with their codes.

- [ ] **Step 4: Pin the UNKNOWN rendering rule**

Write: `UNKNOWN` gets its own visual state and its own dictionary string; it is never merged into the compatible state, and a pair with `reason: null` is not silently dropped. Cite `unknown_pairwise_count` as the count a screen may show.

- [ ] **Step 5: Verify**

Run: `grep -c 'SWAP_ALREADY_COMMITTED\|unknown_pairwise_count\|30/min\|30 /min' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: at least `3`. Then check the arithmetic sentence cites the real constants (`max: 30`, `'1 minute'`).

---

### Task 8: Budget and pricing, with every money value traced

**Files:**
- Modify: report §7

**Interfaces:**
- Consumes: §3.1 (swap response, presets, recommendation detail).
- Produces: §7 table — displayed value → source field → status the value carries → what happens when it is null.

- [ ] **Step 1: Build the trace table**

Rows and their only legal sources:
`indicative total` → `builds[].total_price`; `price badge` → `builds[].price_status`; `offer provenance` → `builds[].components[].offer_class`; `swap delta` → `swap-preview.price.{previous,next,delta}`; `budget remaining` → `swap-preview.budget.{budget_amount,total,delta,within_budget}`; `floor` → `recommendation.budget_floor.cheapest_total` (informational only, never a price); `catalog from-price` → `catalog list row.from_price`.

- [ ] **Step 2: State the null and overrun rules**

For each row: a `null` renders as absence, never as `0`; `within_budget: false` is displayed as an overrun with the delta, never clamped; `price_status: null` means no badge. Cite the contract's own wording ("Prices are indicative") and the disclaimer field.

- [ ] **Step 3: State what the configurator may not compute**

Write: no exchange rate, no tax, no shipping, no "final total" assembled client-side from catalogue prices — because a build's total is the engine's `selected_price` sum, and `readBuildForSwap` deliberately carries `selected_price`, `currency`, `store_id`, `price_checked_at`, `offer_class`, `store_offer_id` so a swap "must not reprice a component it did not change" (quote the comment).

- [ ] **Step 4: Verify**

Run: `grep -c '\bnull\b' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: non-zero, and specifically a sentence containing `within_budget: false` and one containing `never as 0` or `never \`0\``.

---

### Task 9: Homepage-to-configurator handoff and state ownership

**Files:**
- Read: `apps/web-v2/lib/homepage/store.ts`, `components/home/budget-usage-finder.tsx`, `app/[locale]/page.tsx`
- Modify: report §8

**Interfaces:**
- Consumes: §4 Stage A field mapping; §2 reuse decisions.
- Produces: §8 decision — the exact URL contract and store ownership; Task 11 makes it a step in 3.3.

- [ ] **Step 1: Record what the homepage already holds**

`useHomepageStore`: `budgetAmount: number | null`, `useCase: HomeUseCase | null`, memory-only. The finder's submit currently has no destination: `NEXT_PUBLIC_HOMEPAGE_SUBMIT` is off and no results route exists.

- [ ] **Step 2: Choose the handoff and justify it against the alternative**

Recommend **URL search params** as the transfer: `/{locale}/configurateur?use_case=GAMING&budget=12000` (plus `from=<recommendationId>` when arriving from a preset card). One sentence of justification: the homepage store is memory-only, so a reload would lose a store-only handoff, and a shared URL is the only form that survives reload, sharing and the locale switch. Record that the homepage keeps its store unchanged (no duplicated finder state) and that the configurator owns its own store, seeded once from the URL.

- [ ] **Step 3: Decide "modify a recommended build"**

State: arriving with `from=<recommendationId>` initialises the configurator from `GET /v1/recommendations/{id}`, whose `builds[]` give rank, components, total, score and compatibility. No new endpoint is needed to *display* a recommended build; only to change it beyond one swap.

- [ ] **Step 4: Verify**

Run: `grep -c 'use_case=\|budget=\|from=' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: at least `3`, all on one line containing `configurateur`.

---

### Task 10: UX structure and the fr/ar architecture

**Files:**
- Read: `apps/web-v2/docs/DESIGN_SYSTEM.md`, `apps/web-v2/messages/{fr,ar}.json`, `apps/web-v2/lib/format/price.ts`, `apps/web-v2/i18n/routing.ts`
- Modify: report §9, §10

**Interfaces:**
- Consumes: §2 UI kit inventory; §4 stages.
- Produces: §9 component hierarchy (named files under `components/configurator/`) and §10 message namespace; Task 11 scopes them into steps.

- [ ] **Step 1: Write the page structure as a component tree**

Name real planned paths (`apps/web-v2/components/configurator/*.tsx`), the persistent build-summary panel, the sub-`lg` behaviour (summary collapses to a fixed bar), and the four states each surface needs: loading, empty, error, partial. No CSS, no mockups — structure only, per the brief.

- [ ] **Step 2: Write the i18n contract**

State: one new message namespace; key parity between `fr.json` and `ar.json` (both currently hold 122 leaf keys — verify with the node one-liner and record the number measured, not this one); RTL handled by the existing `dir` switch in `app/[locale]/layout.tsx`; currency through the existing `lib/format/price.ts`, never a new formatter; `UNKNOWN` and each reason code given dictionary strings rather than raw codes; engine `explanation` text is served in French and is not re-worded (the homepage's existing rule).
Verify the key parity now:
```bash
node -e "const w=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?w(v,p+k+'.'):[p+k]);const fr=w(require('./apps/web-v2/messages/fr.json')),ar=w(require('./apps/web-v2/messages/ar.json'));console.log(fr.length,ar.length)"
```
Expected: two equal numbers; record them.

- [ ] **Step 3: Keep the Arabic sign-off honest**

Write one line: technical terminology for the configurator needs native review; `docs/homepage-arabic-review.md` is still outstanding for the homepage and nothing here supersedes it.

- [ ] **Step 4: Verify**

Run: `grep -c 'components/configurator/' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: at least `3` planned component paths.

---

### Task 11: The roadmap, with the critical path named

**Files:**
- Modify: report §13, §14, §15

**Interfaces:**
- Consumes: §3.3 matrix (gap classes), §6.3 policy, §7 trace table, §8 handoff, §9/§10 structure.
- Produces: §13 step table; §14 risk list; §15 acceptance criteria for 3.2.

- [ ] **Step 1: Write one row per step, with all seven fields**

For each of 3.2 … 3.9 (renumber if the evidence demands it): objective; scope; expected files; backend dependency; acceptance criteria; testing requirement; risk. A row missing any field is a defect.

- [ ] **Step 2: Put the backend decision on the critical path**

The matrix's third finding (manual assembly does not exist) and Task 7's arithmetic decide the shape of 3.4/3.5. Write the fork explicitly: **either** 3.4 ships a layout/ordering-only picker with no per-candidate verdicts and 3.5 is a single "check this replacement" action, **or** a backend step precedes 3.4 and adds candidate listing with verdicts. State which the evidence favours and what the owner must decide.

- [ ] **Step 3: Mark what proceeds independently**

Name the steps that need no backend decision (handoff, state, summary rendering, i18n skeleton) and those that wait.

- [ ] **Step 4: Write §15 as testable acceptance criteria for 3.2**

Each criterion must be checkable without reading code: a route that exists, a component that renders a named field, a gate that passes. No criterion may depend on a capability the matrix marked `does not exist`.

- [ ] **Step 5: Verify**

Run: `grep -c '^| *3\.[2-9]' docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: at least `8` step rows, and `grep -c 'critical path' …` ≥ 1.

---

### Task 12: Owner report, verdict, and the read-only proof

**Files:**
- Modify: report §1, §14 (and append a `## Owner report` block if the brief's §13 items A–G are not already covered by the numbered sections)

**Interfaces:**
- Consumes: every prior section.
- Produces: the final deliverable the owner reads.

- [ ] **Step 1: Answer the brief's §13 A–G**

A repository state (branch, HEAD, status, files inspected, file created, preserved changes); B backend summary (exists / must be built); C product architecture; D critical findings; E roadmap with acceptance criteria; F decisions requiring the owner — only those a recommendation cannot settle; G verdict, exactly one of `READY FOR STEP 3.2`, `CONDITIONAL`, `BLOCKED`, with reasoning.

- [ ] **Step 2: Prove nothing changed**

Run:
```bash
git status --porcelain
git diff --stat
git diff --cached --stat
```
Expected: `git status --porcelain` prints exactly two lines — `?? apps/web-v2/app/[locale]/simulateur-preview/` and `?? docs/superpowers/`; both `git diff` commands print nothing. Any third line, or any tracked modification, is a constraint breach: revert that change and record it.

- [ ] **Step 3: Prove the report exists and is complete**

Run: `grep -c '^## ' docs/superpowers/specs/step-3-1-configurator-architecture.md && wc -l docs/superpowers/specs/step-3-1-configurator-architecture.md`
Expected: `16` headings (plus any sub-block), and a line count consistent with a substantive report.

- [ ] **Step 4: Hand off**

Report to the owner: the verdict, the two or three findings that change the product plan, and the owner-only decisions. Do not begin 3.2 — the brief gates it on the owner's review of this report.

---

## Self-Review

- **Spec coverage:** §1 mission → Tasks 1, 12. §2 principles → Global Constraints + Task 12 Step 2. §3 inspection → Task 1, Task 5. §4 audit table → Tasks 2, 3, 4. §5 journey A–F → Tasks 6, 7, 8. §6 homepage integration → Task 9. §7 UX + i18n → Task 10. §8 architecture → Tasks 5, 6, 7, 8, 9 (frontend), Task 4 (backend gaps), Task 6/8 (data model, in §4/§7 prose), Task 7 (security/reliability). §9 testing → Task 11 Step 1 field "testing requirement". §10 roadmap → Task 11. §11 constraints → Global Constraints, Task 12 Step 2. §12 deliverable → Task 1 + every section task. §13 report → Task 12.
- **Deliberate deviation:** the brief's §4 table shape is replaced by a four-column matrix (Task 4 Step 1). Reason: eleven of its sixteen rows are not HTTP capabilities, and an "Existing endpoint: none" cell would misreport engine and schema reality that the brief itself forbids inventing.
- **Deliberate omission:** no `git commit` step anywhere, because the brief forbids committing. The report therefore lands untracked inside `docs/superpowers/`; Task 12 Step 2 proves that is the *only* effect on the tree.
- **Type consistency:** the plan names only fields that exist in the frozen snapshot — `budget_amount`, `currency`, `use_case`, `resolution`, `priority`, `inputs_applied`, `compatibility.{status,pairs[],unknown_pairwise_count}`, `price.{previous,next,delta,offer_class,price_status}`, `budget.{budget_amount,total,delta,within_budget}`, `builds[].{rank,total_price,build_score,compatibility_status,strategy_key,explanation,price_status,components[]}`, `components[].{role,product_id,name,slug,variant,price_used,offer_class,store_offer_id}`.
- **Review Focus:** each of the five lines names the task that pins it (7, 7, 7, 8, 6).
