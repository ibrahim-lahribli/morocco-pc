# Step 3.1 — Personalized PC Configurator: Product Discovery, Technical Audit & Architecture

> **Status: complete.** All twelve tasks of `docs/superpowers/plans/2026-11-07-step-3-1-configurator-architecture.md`
> are executed, and every section below is written. Nothing here is a placeholder: the baseline (§0), the V2
> map (§2), the HTTP audit (§3.1), the engine/schema audit (§3.2), the matrix and gap register (§3.3–§3.4),
> the measured G-04 closure proposal (§3.5), the journey (§4), selection architecture (§5), the 32-rule
> inventory and compatibility policy (§6), the money trace (§7), the handoff (§8), the UX tree and fr/ar
> contract (§9–§10), security and reliability (§11), the test strategy (§12), the roadmap (§13), the risks and
> owner decisions (§14), and 3.2's acceptance criteria (§15), with the owner report A–G in §1.1.
>
> **Measured:** 2026-11-07, branch `feature/v2-design`, contract `apps/api/test/unit/openapi-v1.10.json`
> (`info.version` **1.10.0**, OpenAPI 3.0.3). Every claim below cites an operation, a module path, a
> table or a command output. Nothing is inferred from a future endpoint.

## 0 Audit baseline

| Fact | Value |
| --- | --- |
| Branch | `feature/v2-design` |
| HEAD | `dcff3996da8a7973928170a5cfb63e4e86b2732c` |
| Step 2.2 commits | `f4167f6`, `0614e7f`, `70569c6`, `38bd27a`, `dcff399` |
| Working tree | `?? apps/web-v2/app/[locale]/simulateur-preview/`, `?? docs/superpowers/` |
| Tracked modifications | none (`git diff --stat` empty) |

The two untracked paths are pre-existing and deliberately preserved. Also preserved: the browser API
configuration fix in `apps/web-v2/lib/api/config.ts` (the hoisted `INLINED_PUBLIC_API_BASE_URL`
constant, without which a configured origin never reaches the bundle).

Commands used for this baseline, so the state is reproducible:

```bash
git rev-parse --abbrev-ref HEAD && git rev-parse HEAD && git status --short
git --no-pager log --oneline -5
git diff --stat
```

No `POST`, `PUT`, `PATCH` or `DELETE` was issued to any API origin during this audit. No write test,
seed, migration, or Render change was made.

## 1 Executive summary

**The API already does more than V2 uses, and less than a configurator needs.** Ten operations exist in the
frozen contract (§3.1); V2 consumes three of them — `meta/options`, `presets`, `recommendations/{id}` — and
nothing else (§2.4). Under them sits a real engine: it assembles and scores builds, and it judges one
replacement pair by pair across 32 rule codes, 16 of which can reject (§6.1).

Four measurements shape the product:

1. **Automatic configuration exists; manual assembly does not.** One operation turns requirements into ranked
   builds; no operation accepts a partial component set (**G-01**). "Build it yourself" has no surface.
2. **A candidate verdict costs one request per candidate.** A preview answers one candidate for one role
   against one build, at 30/min. A 20-card grid with live verdicts needs two thirds of a minute's budget;
   one full catalogue page (`limit=100`) needs 333 % of it (§6.3.3). Either the grid shows no verdicts, or the
   backend gains a candidate-listing route (**G-02**) — a product decision (§13.2), not a detail.
3. **One replacement per build.** A second commit is `409 SWAP_ALREADY_COMMITTED` (**G-03**). An interface
   that offers "change another part" without knowing this traps the visitor exactly when something worked.
4. **A build cannot name the GPU variant it holds.** The column is persisted and already read, then dropped
   before the response (**G-04**, §3.5) — so "change this GPU" has no identity to send. It is a two-line API
   fix behind a contract bump that also touches V1, which is why it is a proposal here and not a change.

**Recommendation: one experience with three stages** — requirements, automatic proposal, one-component
refinement — not three modes (§4.2). Manual selection has no API to hang a mode on, and a mode switch would
only duplicate the requirements stage. The picker browses without verdicts; the verdict appears once, on the
chosen candidate.

**3.2 can start now.** Its scope — route, URL handoff, state, summary skeleton — uses two `GET`s that already
exist, and every acceptance criterion in §15 is backend-free.

### 1.1 Owner report (brief §13, A–G)

**A. Repository state.** Branch `feature/v2-design`; HEAD `dcff3996da8a7973928170a5cfb63e4e86b2732c`; the five
Step 2.2 commits present (`f4167f6`, `0614e7f`, `70569c6`, `38bd27a`, `dcff399`). The working tree shows exactly
two pre-existing untracked paths — `apps/web-v2/app/[locale]/simulateur-preview/` and `docs/superpowers/` — and
no tracked modification. This audit made no commit, no push and no API write: the only `GET`s were `git`, the
filesystem and the contract snapshot. Files inspected: the contract snapshot, five route modules, three
contract modules, the compatibility and persistence code, migrations `004`/`011`, and V2's `app`, `lib`,
`components`, `i18n`, `messages`, `tests` and `e2e` trees. Created: this report. Preserved untouched: the
preview page and the `lib/api/config.ts` origin fix.

**B. Backend summary.** *Exists:* the ten operations of §3.1 — health, meta options, presets, the full pass,
a pass read, swap preview, swap commit, catalogue list, catalogue detail, price history. *Must be built for a
complete configurator:* candidate listing with verdicts (**G-02**), any partial-set evaluation (**G-01**),
catalogue filters beyond `role` (**G-06**), a builds index (**G-08**), auth and server-side persistence
(**G-10**), retailer identity on a price (**G-07**), and the two additive identity fields (**G-04**, **G-05**).

**C. Product architecture.** One route at `app/[locale]/configurateur/`, a configurator-owned store seeded
once from the URL, generated contract types, and one `Configurator` message namespace. Verdicts are always the
server's; money always traces to one field (§7.1); the handoff is `?use_case=&budget=&from=` (§8.2).

**D. Critical findings.** (i) Manual assembly does not exist, so the product is a proposal-and-refine tool, not
a part picker. (ii) Per-candidate verdicts are unaffordable at the contract's rate limits — the grid cannot show
them without new backend work. (iii) One commit per build is the hard ceiling on the refinement stage. (iv) The
GPU identity gap (G-04) silently blocks the most-wanted replacement; it is cheap to fix and currently
unscheduled. (v) `UNKNOWN` is a third state with no design tokens yet, and collapsing it into "compatible" is
the one failure mode that could cause a bad purchase.

**E. Roadmap with acceptance criteria.** Steps 3.2–3.9 in §13.1, seven fields each; critical path
`3.2 → 3.3 → 3.4 → 3.5`; the picker fork at 3.4 (§13.2); 3.2's eleven testable criteria in §15, none of which
depends on a capability the matrix marked `does not exist`.

**F. Decisions requiring the owner.** D-1 live verdicts in the grid (A or B) — before 3.4. D-2 whether and when
the G-04/G-05 contract minor lands — before the GPU path in 3.5. D-3 whether `ar` may ship before native review
— before 3.7. D-4 whether 3.2 includes the `from=` modify flow (recommended: yes, zero backend cost) — at 3.2
kickoff. D-5 whether a zero-build pass offers "raise the budget" — at 3.3. D-6 whether G-02 is ever built — by
3.9. All six are in §14.2.

**G. Verdict: READY FOR STEP 3.2.** Not because nothing is open, but because nothing open gates 3.2. Its two
calls already exist, its criteria are checkable without code, and the audit's open items bite later: D-1 before
3.4, D-2 before the GPU path in 3.5, D-3 before any Arabic release. One condition would flip this to
CONDITIONAL: if the owner requires live per-candidate verdicts inside 3.2's demo, then option B must precede
3.4 and the roadmap renumbers (§13.2).

## 2 Current V2 architecture

Measured against the tree at `dcff399`, with the two foundation gates green (see §2.4). Paths
without a package prefix are relative to `apps/web-v2/`.

### 2.1 Concern map

| Concern | Where it lives today | What a configurator may do |
| --- | --- | --- |
| Routing and locales | `apps/web-v2/app/[locale]/layout.tsx` (the only layout — there is no `app/layout.tsx`), `app/[locale]/page.tsx`, `i18n/routing.ts` (`fr` default, `localePrefix: "always"`, `localeCookie: false`), `proxy.ts` (Next 16's middleware, matcher skips `api`, `_next` and dotted files) | **add** a sibling route segment under `app/[locale]/`; reuse the layout untouched |
| Homepage sections | `app/[locale]/page.tsx` composes seven sections; two client islands (`BudgetUsageFinder` in the hero, `RecommendedBuildSection` below) | **reuse as-is** — the homepage is not modified by this plan or the next |
| Finder state | `lib/homepage/store.ts` — zustand, `budgetAmount: number \| null`, `useCase: HomeUseCase \| null`, memory-only, deliberately no resolution field | **must not** be extended into the configurator's state (§2.2) |
| API client and config | `lib/api/client.ts` — `openapi-fetch`, injected `fetch` for tests, no retries/timeouts/auth, module-level browser singleton; `lib/api/config.ts` — browser vs server origins | **reuse as-is** |
| Query policy | `lib/api/query-client.ts` — 30 s `staleTime`, 5 min `gcTime`, retry 5xx/408 twice and a fetch `TypeError` once, **mutations never retry** | **reuse as-is**; a configurator mutation inherits `retry: false` |
| Generated contract types | `lib/api/schema.d.ts`, generated from `apps/api/test/unit/openapi-v1.10.json` by `npm run gen:api-types`, drift-gated by `npm run check:api-types` | **reuse as-is**; never hand-edit |
| API data models | `lib/api/types.ts`; `lib/homepage/builds.ts` (`HOME_USE_CASES`, `HOMEPAGE_BUDGET_CEILING`, `selectPresetAtOrBelow`, `toBuildCardView`) | **reuse** the preset/card mapping; **add** configurator view models beside it |
| Shared UI kit | `components/ui/{button,badge,card,text-field}.tsx` + barrel; plain functions, no hooks, server-renderable | **reuse as-is** |
| Tokens and styling | `app/globals.css` (`@theme`); `apps/web-v2/docs/DESIGN_SYSTEM.md` — `primary #3730A3`, `accent #F59E0B`, semantic `verified`/`indicative`/`estimated`, 48 px mobile targets, `rounded-card` 16 px | **reuse as-is**; new components consume tokens, never hex |
| Prices | `lib/format/price.ts` — `formatPrice(value, currency)`, `groupNumber`; renders `8 594 DH` (fr) and `8 594 د.م.` (ar) | **reuse as-is**; no second formatter |
| Forms and validation | `lib/homepage/finder-schema.ts` — zod 4, one schema built per locale, `resolveBudgetAmount`, `BUDGET_MIN = 3_500`, `BUDGET_MAX = 100_000`, `BUDGET_STEP = 500`; `react-hook-form` + `@hookform/resolvers` already installed | **reuse the bounds and the per-locale pattern**; the configurator owns its own schema |
| Translations | `messages/{fr,ar}.json` — 122 leaf keys each, namespaces `Metadata`, `Price`, `Shell`, `NotFound`, `Homepage`; served through `i18n/request.ts` | **reuse with extension**: a new namespace, with the existing key-parity rule |
| Unit tests | `tests/**` — 18 Vitest files (api 5, components 5, homepage 5, i18n 1, lib 2), jsdom via `vitest.config.ts` + `vitest.setup.ts` | **reuse as-is** |
| E2E harness | `e2e/*.spec.ts` — 5 homepage specs; `e2e/support/homepage-api.ts` stubs every `/v1/**` call through `page.route` and records `posts[]`; `e2e/support/homepage-ready.ts`; `playwright.config.ts` | **reuse with extension**: a configurator stub module that also answers the swap routes |

### 2.2 Four reuse decisions, with their evidence

1. **State is not shared.** `lib/homepage/store.ts` holds exactly two fields and no resolution
   (`useHomepageStore`); it is memory-only and the homepage's answers are its own. A configurator
   store that extended it would make every homepage change a configurator change. The handoff is a
   URL, the configurator owns its store — decided in Task 9.
2. **Validation is shared as bounds, not as a schema.** `createFinderSchema(messages)` is built per
   locale so French and Arabic forms validate identically in their own language, and
   `resolveBudgetAmount` is the single place that decides preset-vs-typed. Reuse `BUDGET_MIN`,
   `BUDGET_MAX`, `BUDGET_STEP` and that pattern; the configurator's questions are different.
3. **Types are generated, never authored.** `check:api-types` compares `lib/api/schema.d.ts` with the
   frozen contract; a configurator screen may only use fields that survive that gate (see §3.1).
4. **Tests never reach a real API by default.** Unit tests inject `fetch` into `createApiClient`;
   E2E stubs `/v1/**` and records POSTs instead of fulfilling them. The configurator inherits both,
   and its swap tests must stub the two POST/GET pairs explicitly.

### 2.3 Where the configurator lives

| Concern | Proposed path |
| --- | --- |
| Route (server shell) | `apps/web-v2/app/[locale]/configurateur/page.tsx` |
| Route pieces (client islands) | `apps/web-v2/components/configurator/*.tsx` |
| State | `apps/web-v2/lib/configurator/store.ts` |
| Queries | `apps/web-v2/lib/configurator/queries.ts` |
| Form schema | `apps/web-v2/lib/configurator/schema.ts` |
| Messages | `messages/{fr,ar}.json` under a new `Configurator` namespace |
| Tests | `apps/web-v2/tests/configurator/*`, `apps/web-v2/e2e/configurator*.spec.ts` |

The route is a sibling of the homepage under the existing locale layout, so `lang`/`dir` are set in
the first byte of HTML (`app/[locale]/layout.tsx`) and no new provider tree is introduced.

### 2.4 What V2 does **not** have

No authentication (the API has none either — `lib/api/client.ts` sends no auth header), no
server-side persistence (`lib/homepage/store.ts` is memory-only), no catalogue consumption (the
homepage reads only `meta/options`, `presets` and `recommendations/{id}`), no results route, and no
saved builds. `apps/web-v2/README.md` states this outright: "No catalog, results or saved-builds page
exists."

Baseline gates re-run for this section: `npm run check:api-types` → "api types are up to date",
exit 0; `npm run typecheck` → exit 0.

## 3 Backend and API capability audit

### 3.1 Operations in the contract (10, complete)

Every operation below is present in `apps/api/test/unit/openapi-v1.10.json`. The `Failures` column
lists only declared response codes; the `Limit` column is read from the route source
(`grep -rn "RATE_LIMIT = Object.freeze" apps/api/src/routes/*.js`), all `1 minute` windows. The API serves one route the snapshot omits — `GET /v1/docs/json` (`apps/api/src/routes/docs.js:20`), its own documentation plumbing — so the count of ten is a fact about the contract, not about the router.

| Method | Path | Parameters / body | 2xx required fields | Failures | Limit |
| --- | --- | --- | --- | --- | --- |
| GET | `/v1/health` | none | `status`, `db`, `engine_version` | 429, 500 | 120/min |
| GET | `/v1/meta/options` | none | `use_cases`, `currencies`, `resolutions`, `priorities`, `inputs_applied` | 429, 500, 503 | 120/min |
| GET | `/v1/presets` | query `use_case` (required), `currency` (required); unknown query params refused | `catalog_version`, `generated_at`, `presets[]` (`budget_amount`, `recommendation_id`, `build_score`, `price_status`) | 422, 429, 500, 503 | 120/min |
| POST | `/v1/recommendations` | body `budget_amount` (number, `>0`, `<=1000000`), `currency` (3 chars), `use_case`, `resolution` (optional), `priority` (int 1–5, optional) | full pass: `id`, `budget_amount`, `currency`, `use_case`, `generated_at`, `budget_floor`, `engine_version`, `catalog_version`, `reused`, `reason`, `disclaimer`, `input_effects`, `served_by`, `builds[]` | 422, 429, 500, 503 | 30/min |
| GET | `/v1/recommendations/{id}` | path `id` (uuid) | identical `required` array to the pass: `id`, `budget_amount`, `currency`, `use_case`, `generated_at`, `budget_floor`, `engine_version`, `catalog_version`, `reused`, `reason`, `disclaimer`, `input_effects`, `served_by`, `builds` | 404, 429, 500 | 120/min |
| GET | `/v1/recommendations/{id}/builds/{rank}/swap-preview` | query `role` (required), `product_id` (required), `product_variant_id` (GPU only) | `compatibility` (`status`, `pairs[]`, `unknown_pairwise_count`), `price`, `budget`, `catalog_version`, `engine_version` | 404 (incl. `BUILD_NOT_EVALUABLE`), 422, 429, 500 | 30/min |
| POST | `/v1/recommendations/{id}/builds/{rank}/swap` | body `role`, `product_id`, `product_variant_id` (GPU only) | `compatibility`, `price`, `budget`, `swapped`, `catalog_version`, `engine_version` | 404, 409 (`SWAP_ALREADY_COMMITTED`, `SWAP_ROLE_ABSENT`, `SWAP_NOT_COMMITTABLE`), 422, 429, 500 | 30/min |
| GET | `/v1/catalog/products` | query `role`, `limit` (1–100), `cursor` (slug keyset) | `products[]` (`id`, `slug`, `display_name`, `category`, `from_price`, `offer_class`, `has_offer`, `variants[]`), `next_cursor` | 422, 429, 500 | 120/min |
| GET | `/v1/catalog/products/{slug}` | path `slug` | `slug`, `display_name`, `category`, `specs{}`, `offers[]`, `price_status`, `disclaimer` | 404, 422, 429, 500 | 120/min |
| GET | `/v1/catalog/products/{slug}/price-history` | path `slug` | `slug`, `currency`, `points[]`, `observation_count`, `latest_price`, `min_price`, `max_price`, `change_amount`, `change_pct`, `disclaimer` | 404, 422, 429, 500 | 120/min |

#### 3.1.1 The catalogue narrows by role only

`GET /v1/catalog/products` accepts `role`, `limit` and `cursor`, nothing else
(`CatalogProductsQuerySchema`, `apps/api/src/contracts/catalog.js`). `role` is checked against the
engine's own vocabulary (`app.engine.catalogRoles()`), so an unknown role is a 422 that names the
accepted values (`apps/api/src/routes/catalog.js:348-365`). There is **no** filter for brand, price
range, socket, wattage, form factor, capacity, or compatibility.

Consequence for a configurator: server-side narrowing does not exist. A picker can only page through
a role's whole catalogue and narrow in the browser, or the API gains filter parameters.

#### 3.1.2 Identity asymmetry between list, detail and swap (measured)

| Surface | Carries `product.id` | Carries variant ids | Carries `slug` |
| --- | --- | --- | --- |
| `GET /v1/catalog/products` row | yes (`id`) | yes (`variants[{id, sku}]`) | yes |
| `GET /v1/catalog/products/{slug}` | **no** | **no** | yes |
| `builds[].components[]` (a persisted build) | yes (`product_id`) | **no** — `variant` is `string \| null` | yes |

`BuildComponentSchema` (`apps/api/src/contracts/recommendations.js`) has exactly these properties:
`role`, `product_id`, `name`, `slug`, `variant`, `price_used`, `offer_class`, `store_offer_id`, all
required. `product_variant_id` is **not** among them.

And the swap route requires the opposite pair: `role` + `product_id`, plus `product_variant_id` **for
GPU and for no other role** (422 otherwise).

**Answer to the audit question: a client cannot get from a product detail page to a swap target.**
The detail response has no `id` and no variant ids; the build response has a product id but no
variant id. Only the list row carries both. So any "change this component" flow must re-read
`GET /v1/catalog/products?role=<role>` and match by `slug` to recover the id pair — and for a GPU
with several variants, the build offers only a display string to match against. Recorded as **G-04**
and **G-05**.

#### 3.1.3 Swap semantics are narrow, and the narrowness is enforced

- One **hypothetical** evaluation: `GET .../swap-preview?role=&product_id=[&product_variant_id=]`
  returns `compatibility.status`, per-pair verdicts, a price delta and a budget delta. `200` includes
  `FAIL` and `UNKNOWN` — a refusal is a result, not an error.
- One **commit** per build: `POST .../swap` appends a derived build and returns `201`. A second
  attempt is `409 SWAP_ALREADY_COMMITTED` (Decision 56 item 6, guarded by a UNIQUE index), alongside
  `SWAP_ROLE_ABSENT` and `SWAP_NOT_COMMITTABLE`.
- The commit "copies these five values into the derived `build_component` row, and a swap must not
  reprice (or relabel) a component it did not change" (`apps/api/src/repository.js`,
  `readBuildForSwap`) — the price of an untouched component is the original `selected_price`.
- A build that no longer reconstructs from the live catalogue is `404 BUILD_NOT_EVALUABLE`, naming the
  blocked role.

#### 3.1.4 What a pass costs

`POST /v1/recommendations` runs one full engine pass and persists it (documented as ~74 statements;
`apps/web-v2/docs/sections/01-homepage-api-mapping.md` §5). A repeat with the same
`(budget_amount, currency, use_case, resolution, priority, scoring model, catalog_version,
engine_version)` is answered `200` with `reused: true` and writes nothing. The configurator therefore
has three request classes with different costs: free reads (120/min), one pass per distinct
requirement set (30/min, a write), and one preview per candidate (30/min, read-only).

### 3.2 The engine and schema behind the contract

#### 3.2.1 Statuses are a closed set

`src/recommendation/compatibility/statuses.js`:

- `FINAL_STATUSES = { PASS, FAIL, UNKNOWN }` — "the ONLY statuses a resolver result may carry".
- `CONDITIONAL` exists **only** as a source status (a `support_status` row) and is deliberately not a
  final status: an unverifiable conditional resolves to `UNKNOWN` with the condition preserved in
  `evidence` (Decision 3b).

`src/recommendation/compatibility/aggregate.js` is worst-of: any `FAIL` → `FAIL`; else any `UNKNOWN` →
`UNKNOWN`; else `PASS`. The reason is the first worst result's reason and is `null` when everything
passed. `penalty` is always `null` here — the numeric UNKNOWN penalty belongs to Engine 4.

Consequence: `NULL` spec data must surface as `UNKNOWN`, never as a pass and never as a rejection, and
a UI that shows two states (compatible / not) is structurally wrong.

#### 3.2.2 Rule vocabulary

32 reason codes in `src/recommendation/compatibility/reason-codes.js`; enumerated with their status
class and provenance in §6.1.

#### 3.2.3 Spec tables

Eight `<role>_spec` tables, all created by `database/migrations/004_hardware_tables.sql`
(`013_cooler_radiator_size.sql` later adds `cooler_spec.radiator_size_mm`). Column-level truth is the
generated `docs/SCHEMA_REFERENCE.md`; §6.2 maps each table to the rules it feeds.

#### 3.2.4 Where a verdict comes from

| Surface | Verdict granularity | Persisted? |
| --- | --- | --- |
| `builds[].compatibility_status` | one status per build, plus `explanation` | yes, with the pass |
| `builds[].price_status` | `indicative` \| `verified` — **no `null` variant** in the schema | yes |
| `swap-preview.compatibility` | `status` + `pairs[]` (`check`, `role`, `partner_role`, `status`, `reason`, `evidence[]`) + `unknown_pairwise_count` | no — computed per request against the live catalogue |
| `swap` (201) | the whole build's verdict for the derived build | yes, with the appended build |

So pair-level reasoning exists **only** for a hypothetical replacement against an existing build.
There is no endpoint that evaluates an ad-hoc component set, and none that lists candidates with
verdicts; recorded as **G-01** and **G-02**.

### 3.3 Capability matrix

One row per capability, one gap class each. Four columns replace the brief's three, because most rows
are not HTTP capabilities and an "existing endpoint: —" cell would report engine and schema
capability as absent. Gap classes are the brief's five, verbatim.

| # | Capability | Where it exists today | Evidence | Gap class |
| --- | --- | --- | --- | --- |
| 1 | Component categories | HTTP: `role` → `category` mapping | `apps/api/src/routes/catalog.js:348-365` | exists but not consumed by V2 |
| 2 | CPU catalogue | HTTP: `GET /v1/catalog/products?role=CPU` | `CatalogProductsQuerySchema` | exists but not consumed by V2 |
| 3 | GPU catalogue | HTTP: same, plus `variants[]` | `CatalogProductSchema` (v1.9) | exists but not consumed by V2 |
| 4 | Motherboard catalogue | HTTP: same | catalog route | exists but not consumed by V2 |
| 5 | RAM catalogue | HTTP: same | catalog route | exists but not consumed by V2 |
| 6 | Storage catalogue | HTTP: same (`SSD_BOOT` role) | catalog route | exists but not consumed by V2 |
| 7 | PSU catalogue | HTTP: same | catalog route | exists but not consumed by V2 |
| 8 | Case catalogue | HTTP: same | catalog route | exists but not consumed by V2 |
| 9 | Cooling catalogue | HTTP: same (`CPU_COOLER` role) | catalog route | exists but not consumed by V2 |
| 10 | CPU ↔ motherboard compatibility | Engine: `cpu-motherboard.js`; exposed only through swap preview / a persisted build | `src/recommendation/compatibility/cpu-motherboard.js` | exists but not exposed through the API |
| 11 | RAM compatibility (type, slots, capacity) | Engine: `memory.js`, `memory-slots.js`, `memory-capacity.js`; same exposure | those modules | exists but not exposed through the API |
| 12 | PSU requirements (wattage, connectors) | Engine: `gpu.js`; same exposure | `src/recommendation/compatibility/gpu.js` | exists but not exposed through the API |
| 13 | Product pricing | HTTP: list `from_price`, detail `offers[]`, `price-history` | catalog contracts (v1.5/v1.6) | exists but not consumed by V2 |
| 14 | Store identity behind a price | DB: `store`, `store_offer`; **not** in any response — `CatalogOfferSchema` is `{price, currency, offer_class}` | `apps/api/src/contracts/catalog.js` | exists but not exposed through the API |
| 15 | Build scoring | HTTP: `builds[].build_score` on any pass and any derived build | `BuildSchema` | exists but not consumed by V2 |
| 16 | Budget optimisation | Engine: retention/assembly + `budget_floor`; HTTP: `budget` block on swap | `budget_floor` contract; `swap-preview.budget` | exists but incomplete |
| 17 | Personalized recommendations | HTTP: `POST /v1/recommendations`, `GET /v1/recommendations/{id}` | openapi paths | exists but not consumed by V2 |
| 18 | Free-form / manual assembly | nowhere | no endpoint takes a partial component set (10-operation list, §3.1) | does not exist |
| 19 | Candidate-level compatibility for a picker | HTTP: one preview per (build, role, candidate) at 30/min | `SwapPreviewQuerySchema`; `PREVIEW_RATE_LIMIT` | exists but incomplete |
| 20 | In-progress build persistence | nowhere in V2 (memory-only store, no auth) | `apps/web-v2/lib/homepage/store.ts` | does not exist |
| 21 | Stock / availability status | DB: `store_offer` exists; no availability field appears in any served response | catalog contracts | evidence insufficient |

### 3.4 Gap register

Ids are stable so later sections and the roadmap can cite them.

| Id | Gap | Evidence | Class |
| --- | --- | --- | --- |
| G-01 | No free-form assembly: nothing accepts a partial component set, so "start from nothing and pick parts" cannot be expressed | §3.1 (10 operations), §3.2.4 | does not exist |
| G-02 | No candidate listing with verdicts: one preview answers one candidate for one role, at 30/min | `PREVIEW_RATE_LIMIT`; §3.1.3 | exists but incomplete |
| G-03 | One committed swap per build (409 on the second) | `apps/api/src/routes/recommendations.js` swap handler; Decision 56 item 6 | product constraint |
| G-04 | A build's GPU is named by `variant` (string) and `product_id`, never by `product_variant_id` — yet a GPU swap requires the variant id | `BuildComponentSchema`; closure cost measured in §3.5 | identity gap |
| G-05 | Product detail has no `id` and no variant ids, so it cannot address a swap target | `CatalogProductDetailSchema` vs `CatalogProductSchema` | identity gap |
| G-06 | Catalogue filters are `role` / `limit` / `cursor` only | `CatalogProductsQuerySchema` | exists but incomplete |
| G-07 | Retailer identity is not served: prices carry a class, not a merchant | `CatalogOfferSchema` | exists but not exposed through the API |
| G-08 | No builds index: only per-(use case, currency) presets and per-id reads | openapi paths | does not exist |
| G-09 | Some requirement questions are not read by the active model; `inputs_applied` is the gate | `MetaOptionsSchema`; Decision 52 | behavioural constraint |
| G-10 | No auth, no server-side persistence of in-progress work | `lib/homepage/store.ts` (memory-only) | does not exist |
| G-11 | Every offer is seed data today, so every price is `SEED_UNVERIFIED` / `indicative` | `apps/api/src/contracts/catalog.js` header ("Today every offer is seed data") | data state |

### 3.5 Closing G-04 — the smallest API change (proposal, not implemented)

Measured 2026-11-07. **The variant id is already persisted and already read; it is dropped in two
places, and both are in the API's presentation layer.**

#### 3.5.1 The data path, end to end

| Stage | Evidence | State |
| --- | --- | --- |
| The column | `build_component.product_variant_id UUID REFERENCES product_variant(id)`, nullable — `database/migrations/011_reconcile_layer4.sql:172` | exists |
| The original pass writes it | `src/recommendation/persistence/persist-ranked.js:50` — INSERT column list | exists |
| A committed swap writes it | `src/recommendation/orchestrator/swap-commit.js:106` — same INSERT shape | exists |
| The GET reads it | `SELECT_BUILDS_SQL` selects `c.product_variant_id` (`apps/api/src/repository.js:264`) and joins `product_variant` for `v.sku AS variant_sku` (`:281`) | exists |
| The build presenter forwards it | `presentRecommendationResult` passes `build.components` through (`apps/api/src/routes/recommendations.js:339`) | pass-through |
| **`groupBuilds` builds each component** | `apps/api/src/routes/recommendations.js:265-275` — emits `role`, `product_id`, `name`, `slug`, `variant`, `price_used`, `offer_class`, `store_offer_id` | **drops it** |
| **`BuildComponentSchema`** | `apps/api/src/contracts/recommendations.js:56-66`, `additionalProperties: false` | **would strip it** |

So this is not plumbing work: **no migration, no engine change, no SQL edit, no new path.**

#### 3.5.2 The change — two lines

1. In `groupBuilds`, beside `slug`:

```js
product_variant_id: row.product_variant_id === undefined ? null : row.product_variant_id,
```

2. In `BuildComponentSchema`:

```js
product_variant_id: Type.Union([Type.String(), Type.Null()]),
```

Required-and-nullable is not a style choice. fast-json-stringify refuses to serialise a declared property
the payload omits — the route file states exactly that at `apps/api/src/routes/recommendations.js:327-330` — so the field
must be declared **and** always set (`null` for the eight product-keyed roles). Nullable mirrors `slug`'s
precedent, and `variant` stays: it is the human-readable SKU (`product_variant` has no name column), while
the id is the addressable identity. Replacing `variant` would be breaking; adding the id is additive.

#### 3.5.3 The ceremony is the real cost

| Step | Files |
| --- | --- |
| Version bump 1.10.0 → 1.11.0 (additive only) | `docs/API.md` contract note; v1.9 is the precedent — "Additive only: no path and no existing field changed" (`docs/API.md:44-52`) |
| Snapshot rename — the tree keeps exactly ONE snapshot | `apps/api/test/unit/openapi-v1.10.json` → `openapi-v1.11.json` (proposed; not created by this audit); the byte-compare at `apps/api/test/unit/openapi-snapshot.test.js:66,89` is what forces it, and it is also the proof the field reached the wire |
| Reference sweep | `.github/workflows/web-v2.yml:17,22`; `.github/workflows/web.yml:18,23`; `apps/web/scripts/check-api-types.mjs:33`; `apps/web/package.json:16`; `apps/web-v2/scripts/api-types.mjs:19,26`; `apps/api/test/unit/openapi-snapshot.test.js:66`; generated `apps/web-v2/lib/api/schema.d.ts:4` |
| Docs sweep | `AGENTS.md:271`; `docs/TEST_MAP.md:79`; `docs/ROADMAP.md:31,80`; `docs/API.md:911`; `apps/web-v2/README.md:157`; `apps/web-v2/docs/staging-smoke.md:128`; `apps/web-v2/docs/sections/01-homepage.md:948,1105`; `apps/web-v2/docs/sections/01-homepage-api-mapping.md:4`; `apps/web-v2/docs/finder-validation.md:37`; `docs/RECIPES/deploy-free-host.md:260`; `DEVELOPMENT_NOTES.md:1995`; archive entries stay historical |
| Regenerate BOTH clients | `apps/web` and `apps/web-v2`: `npm run gen:api-types`, then `check:api-types` in each |
| New assertion | `apps/api/test/db/recommendations.db.test.js` on the TEST branch: a GPU component carries a non-null id, a CPU component carries `null`, and the GET still serialises `200` |
| Record | a numbered contract item in the decision log, as v1.10 was recorded (Decision 56 item 9) |

#### 3.5.4 Scope boundaries

- **This closes G-04 only.** After it, a build names the variant it holds, so "change this GPU" needs no
  catalogue re-read and no SKU matching.
- **It does not close G-05.** `CatalogProductDetailSchema` still carries no `id` and no `variants`, so a
  product detail page still cannot address a swap. That is a second additive change (+2 fields) with the
  same ceremony.
- **It does not touch G-02 or G-03:** no candidate verdicts, still one committed swap per build.
- **Ordering:** G-04 alone is the smallest change that closes a measured flow. If G-05 is approved too,
  land both under **one** 1.11.0 bump — the rename, both regenerations and the docs sweep are shared — but
  assert each separately.
- **V1 is involved.** The reference sweep and the regeneration touch `apps/web`, which the Step 3.1 brief
  forbids; this change therefore belongs to a later step, not to this audit.

Effort: **2 source lines**, one snapshot rename, two regenerations, one DB test, ~17 reference edits.
No migration, no engine change, no new path, and no existing response field changes.

## 4 Proposed user journey

**Homepage** → `/configurateur?use_case=…&budget=…` → **requirements** → one engine pass → **proposal** (`builds[]`) → at most one **refinement** → **summary**.

The journey is short because the API is short: there is exactly one operation that turns requirements into a
build, and exactly one that changes a build.

### 4.1 Stage A — requirements, mapped to the contract

| Question | Contract field | Where its values come from | Mandatory? |
| --- | --- | --- | --- |
| Intended use | `POST /v1/recommendations.use_case` | `GET /v1/meta/options.use_cases[].value`; frontend fallback `HOME_USE_CASES` = `GAMING`, `OFFICE`, `WORKSTATION` | **yes** |
| Budget | `budget_amount` (JSON number, `> 0`, `<= 1 000 000`) | the visitor; frontend bounds `BUDGET_MIN = 3 500`, `BUDGET_MAX = 100 000`, `BUDGET_STEP = 500` | **yes** |
| Currency | `currency` (exactly 3 characters) | `meta.options.currencies[0]`, fallback `MAD` | not a question: one currency is served, so it is carried and shown, never asked |
| Resolution | `resolution` | `meta.options.resolutions[].value` | **only** when `meta.options.inputs_applied` contains `"resolution"` |
| Priority | `priority` (integer 1–5) | `meta.options.priorities[].value` | **only** when `meta.options.inputs_applied` contains `"priority"` |
| Brand / noise / must-have features / preferred store | — | — | not askable today: no request field accepts them, so asking would collect an answer nothing reads |

`inputs_applied` is the gate, and it is **required but may be empty** (`MetaOptionsSchema`); an empty list
means the active scoring model reads none of the three optional inputs, which is a fact rather than a
failure.

Measured gap in V2 as it stands: `useMetaOptions` (`lib/homepage/use-presets.ts`) reads only `use_cases` and
`currencies[0]`. Neither `inputs_applied`, `resolutions` nor `priorities` is consumed anywhere in
`apps/web-v2`. The configurator must read `inputs_applied` before it can honestly ask for resolution or
priority (**G-09**).

### 4.2 Stage B — modes: two are supported, one is a composition, one does not exist

| Candidate mode | Supported today | Evidence |
| --- | --- | --- |
| Automatic configuration from requirements | **yes** | `POST /v1/recommendations` (one full pass) |
| Guided configuration | **yes, as a frontend composition** over the automatic pass | the vocabulary is `meta.options`; the pass takes the three answers |
| Modify an existing recommended build | **partially** — one replacement per build | `swap-preview` / `swap`; **G-03** (second swap is `409`) |
| Manual component-by-component selection | **no** | **G-01** — no operation accepts a partial component set |

**Recommendation: one experience with three stages, not three modes.** A mode switch would duplicate the
requirements stage and force the store to hold two shapes of the same answer. Manual selection has no
surface to hang a mode on, so offering it as a peer of the others would promise something the backend
cannot answer.

### 4.3 Stage C — the nine catalogue roles, and what each can do

`COMPONENT_ROLES` (`src/recommendation/candidates`) holds **nine** roles; each maps to a `product_category`
through `expectedCategoryForRole`. The swap routes, by contrast, accept only the eight roles in
`EXPANSION_ORDER` (`app.engine.swapPreviewRoles()`).

| Role | Catalogue category | Spec table | Rules that involve it | Swappable? |
| --- | --- | --- | --- | --- |
| `CPU` | `CPU` | `cpu_spec` | CPU ↔ board socket/support; cooler ↔ socket; cooler ↔ TDP | yes |
| `GPU` | `GPU` (variant-keyed) | `gpu_board_spec` | GPU ↔ case length/thickness; GPU ↔ PSU wattage/connectors | yes — **and must name `product_variant_id`** |
| `MOTHERBOARD` | `MOTHERBOARD` | `motherboard_spec` | CPU ↔ board; case form factor; board ↔ RAM type; slots and capacity | yes |
| `RAM` | `MEMORY` | `ram_spec` | board ↔ RAM type; DIMM slots; capacity | yes |
| `SSD_BOOT` | `STORAGE` | `ssd_spec` | no reason code exists for storage — see below | yes |
| `SSD_SECONDARY` | `STORAGE` | `ssd_spec` | none | **no** — catalogued but outside `EXPANSION_ORDER` |
| `PSU` | `PSU` | `psu_spec` | GPU ↔ PSU wattage and connectors | yes |
| `CASE` | `CASE` | `case_spec` | case ↔ form factor; case ↔ radiator; cooler height; GPU clearance | yes |
| `CPU_COOLER` | `COOLER` | `cooler_spec` | cooler ↔ socket; cooler height; cooler ↔ TDP | yes |

Two asymmetries fall out of that table and are recorded in the gap register: **`SSD_SECONDARY` can be
listed and never swapped**, and **no storage-interface compatibility rule exists** — the 32 reason codes
contain none for `ssd_spec`, so the brief's "storage interface compatibility" requirement has no engine
counterpart. `ssd_spec` is read by the engine, but not by a compatibility resolver.

### 4.4 Stage D — compatibility in the journey

The journey may show exactly two verdict surfaces: the whole build's `compatibility_status` (persisted), and
— after the visitor picks a replacement — the per-pair `compatibility.pairs[]` of one `swap-preview`. No
other verdict may be displayed, and none may be computed in the browser. The policy and its arithmetic are
§6.3 (Task 7).

### 4.5 Stage E — budget in the journey

Three money facts are available without any new work: the build's `total_price`, its `price_status`, and (for
a hypothetical replacement only) `price.delta` with `budget.delta` and `budget.within_budget`. The trace table
is §7 (Task 8). Nothing in the journey may sum catalogue prices itself.

### 4.6 Stage F — what a finished build can say, and what it cannot

| Wanted on the summary | Available from | Status |
| --- | --- | --- |
| Selected components with specs | `builds[].components[]` (role, name, slug, price used) + `GET /v1/catalog/products/{slug}` for specs | available, two reads |
| Individual and total price | `components[].price_used`, `builds[].total_price` | available |
| Indicative vs verified | `builds[].price_status`, `components[].offer_class` | available; every price is `indicative` today (**G-11**) |
| Compatibility status | `builds[].compatibility_status` | available for the build; per pair only via a preview |
| Build score | `builds[].build_score` | available; `null` means no assembled build |
| Performance information | — | not available: no FPS or benchmark field exists in the contract |
| Remaining budget | `swap-preview.budget` only | available **only** in the context of a hypothetical swap; a fresh pass reports `budget_floor`, which is not a spend |
| Warnings and alternatives | `explanation` (engine text, French) | no alternatives list exists; there is no "cheaper option" field |

## 5 Component selection architecture

Selection is not one screen in this API; it is three powers with three costs. §4 fixed the journey; this
section fixes what a picker may be, and it is deliberately smaller than a "browse everything" page.

### 5.1 Three selection surfaces

| Surface | Operation | What it answers | Cost |
| --- | --- | --- | --- |
| Automatic selection | `POST /v1/recommendations` | "give me builds for these requirements" | 30/min, a write |
| Candidate substitution | `GET .../swap-preview`, then `POST .../swap` | "what if I replaced THIS part with THIS candidate" | 30/min each; the preview is read-only |
| Browsing | `GET /v1/catalog/products`, `GET /v1/catalog/products/{slug}` | "what exists in this role" | 120/min |

No surface accepts a partial component set (**G-01**), and none lists candidates *with* verdicts
(**G-02**). A picker therefore browses; it does not evaluate.

### 5.2 What a list row can and cannot sort

The row carries `id`, `slug`, `display_name`, `category`, `from_price`, `offer_class`, `has_offer` and
`variants[{id, sku}]` — and nothing else.

- **Sortable client-side:** name, from-price, offer presence.
- **Not sortable without a detail read:** anything spec-shaped (VRAM, length, TDP, slots, radiator size).
  `specs{}` exists only on `GET /v1/catalog/products/{slug}`, so a 20-row page ordered by VRAM costs 20
  detail reads — 17 % of a 120/min read minute for one page.
- **Paging:** `limit` 1–100, keyset `cursor` on `slug`, no total count; ordering is stable but opaque to the
  client.
- **Filtering:** `role` only. Brand, price band, socket, wattage and compatibility all need parameters the
  contract does not have (**G-06**).

Consequence for 3.4: the picker orders by what the row carries. A "filter by VRAM" control is a backend
ask, not a client trick.

### 5.3 Candidate identity is role-dependent

| Role | Identity a swap needs | Where the client gets it |
| --- | --- | --- |
| `GPU` | `product_id` **and** `product_variant_id` | the list row's `variants[]` — the only place the contract supplies both |
| the seven other swappable roles | `product_id` only; a variant id is a `422` | the list row's `id` |
| `SSD_SECONDARY` | none — not swappable | listable (`role=SSD_SECONDARY`), outside `EXPANSION_ORDER` |

The mapping row → swap payload is therefore a per-role function, and for GPU it must carry the
`(id, variant)` pair. The detail page cannot supply it (**G-05**) and the build cannot supply it
(**G-04**), which is why §3.5 exists.

### 5.4 The selection state machine

`idle → browsing(role, cursor, rows) → previewing(candidate) → previewed(verdict, price, budget) → committing → committed(build) | failed(code)`

Non-negotiables:

- The preview is the **only** source of a candidate verdict; a row never shows one (§6.3.3).
- Commit is enabled only after a preview whose `compatibility.status` is not `FAIL`; the server still owns
  the refusal (`409 SWAP_NOT_COMMITTABLE`).
- A second commit is `409 SWAP_ALREADY_COMMITTED`: at most one replacement per build (**G-03**).
- `404 BUILD_NOT_EVALUABLE` exits to "start a new pass", never to a blind retry (§6.3.4).
- Every state is data on the store, not a boolean on a component (§9.3).

### 5.5 What the client must not do

- Compute, infer or filter by compatibility (32 codes; `NULL` must stay `UNKNOWN`) — §6.3.1.
- Sum prices or derive a total — §7.3.
- Guess a GPU variant by matching the build's `variant` SKU string to a catalogue SKU. That is precisely the
  work §3.5 removes; until it lands, 3.5 either scopes GPU swaps out or accepts a documented SKU match as a
  temporary measure. The report recommends the former.

## 6 Hardware compatibility analysis

### 6.1 Rule inventory (32 codes, one row each)

Status class is read from each rule's return site, not from its name. `HARD` means the rule can
produce `FAIL` (a REJECT); `UNKNOWN` means that code is only ever returned with status `UNKNOWN`.
`evidence` cites the module and line of the return site; module paths there are relative to
`src/recommendation/compatibility/`.

| Code | Pair | Class | Evidence |
| --- | --- | --- | --- |
| CPU_SOCKET_MISMATCH | CPU ↔ motherboard | HARD | cpu-motherboard.js:115 |
| CPU_MOTHERBOARD_SUPPORT_FAIL | CPU ↔ motherboard | HARD | cpu-motherboard.js:52 |
| CPU_MOTHERBOARD_CONDITIONAL_UNVERIFIABLE | CPU ↔ motherboard | UNKNOWN | cpu-motherboard.js:58 |
| CPU_SOCKET_UNKNOWN | CPU ↔ motherboard | UNKNOWN | cpu-motherboard.js:101 |
| CPU_MOTHERBOARD_SUPPORT_UNKNOWN | CPU ↔ motherboard | UNKNOWN | cpu-motherboard.js:65,160 |
| COOLER_SOCKET_MISMATCH | cooler ↔ CPU socket | HARD | cooler.js:79 |
| COOLER_SOCKET_SUPPORT_UNKNOWN | cooler ↔ CPU socket | UNKNOWN | cooler.js:43,59,87 |
| COOLER_TOO_TALL | cooler ↔ case clearance | HARD | cooler-height.js:118 |
| COOLER_HEIGHT_UNKNOWN | cooler ↔ case clearance | UNKNOWN | cooler-height.js:88 |
| COOLER_TDP_INSUFFICIENT | cooler ↔ CPU TDP (SOFT rule) | UNKNOWN | cooler-tdp.js:90 |
| COOLER_TDP_UNKNOWN | cooler ↔ CPU TDP | UNKNOWN | cooler-tdp.js:62 |
| CASE_FORM_FACTOR_MISMATCH | case ↔ motherboard form factor | HARD | case-radiator.js:33,116 |
| CASE_FORM_FACTOR_UNKNOWN | case ↔ motherboard form factor | UNKNOWN | case-radiator.js:89,108 |
| RADIATOR_UNSUPPORTED | case ↔ radiator size | HARD | case-radiator.js:198 |
| RADIATOR_SUPPORT_UNKNOWN | case ↔ radiator size | UNKNOWN | case-radiator.js:181,213 |
| PLATFORM_MEMORY_TYPE_UNSUPPORTED | platform/board ↔ RAM type | HARD | memory.js:76,101 |
| PLATFORM_MEMORY_SUPPORT_UNKNOWN | platform/board ↔ RAM type | UNKNOWN | memory.js:51,84,93 |
| MOTHERBOARD_MEMORY_TYPE_MISMATCH | board ↔ RAM type (legacy strict) | HARD | memory.js:209,241 |
| MOTHERBOARD_MEMORY_TYPE_UNSUPPORTED | board ↔ RAM type (positive exclusion) | HARD | memory.js:182 |
| MOTHERBOARD_MEMORY_SUPPORT_UNKNOWN | board ↔ RAM type | UNKNOWN | memory.js:172,217,227 |
| RAM_SLOTS_EXCEEDED | RAM kit ↔ board DIMM slots | HARD | memory-slots.js:81 |
| RAM_SLOTS_UNKNOWN | RAM kit ↔ board DIMM slots | UNKNOWN | memory-slots.js:54 |
| RAM_CAPACITY_EXCEEDED | RAM kit ↔ board capacity | HARD | memory-capacity.js:97 |
| RAM_CAPACITY_UNKNOWN | RAM kit ↔ board capacity | UNKNOWN | memory-capacity.js:67 |
| GPU_TOO_LONG | GPU ↔ case length | HARD | gpu.js:91 |
| GPU_TOO_THICK | GPU ↔ case thickness | HARD | gpu.js:125 |
| GPU_DIMENSIONS_UNKNOWN | GPU ↔ case dimensions | UNKNOWN | gpu.js:92,126 |
| GPU_PSU_WATTAGE_INSUFFICIENT | GPU ↔ PSU wattage | HARD | gpu.js:158 |
| GPU_PSU_WATTAGE_UNKNOWN | GPU ↔ PSU wattage | UNKNOWN | gpu.js:159 |
| GPU_PSU_CONNECTOR_UNAVAILABLE | GPU ↔ PSU connectors | HARD | gpu.js:329 |
| GPU_PSU_CONNECTOR_UNKNOWN | GPU ↔ PSU connectors | UNKNOWN | gpu.js:253,315 |
| GPU_PSU_CONNECTOR_NULL_HIGH_TGP | GPU ↔ PSU connectors, board TGP ≥ 200 W | HARD | gpu.js:301 |

Sixteen codes can produce `FAIL`; sixteen are `UNKNOWN`-only. `COOLER_TDP_INSUFFICIENT` is the one
deliberate SOFT rule: an under-spec cooler is surfaced, never rejected, because vendor TDP figures are
marketing numbers. `GPU_PSU_CONNECTOR_NULL_HIGH_TGP` is the one deliberate fail-safe in the other
direction: on a high-TGP board an unknown connector requirement is treated as `FAIL`, because an
unsafe build costs more than a false negative.

### 6.2 Spec data behind the rules

All eight tables come from `database/migrations/004_hardware_tables.sql`; column names below are the
generated `docs/SCHEMA_REFERENCE.md` list, trimmed to the fields the rules read.

| Table | Columns the rules read | Rules fed |
| --- | --- | --- |
| `cpu_spec` | `socket_id`, `tdp_watts`, `pbp_mtp_watts`, `integrated_gpu_present` | CPU ↔ board socket; cooler ↔ CPU TDP; GPU-absent fallback |
| `motherboard_spec` | `socket_id`, `form_factor`, `memory_type_id`, `dimm_slots`, `max_memory_capacity_gb` | CPU ↔ board; case form factor; board ↔ RAM type; RAM slots and capacity |
| `ram_spec` | `memory_type_id`, `module_count`, `capacity_per_module_gb` | board ↔ RAM type; slots; capacity |
| `case_spec` | `max_gpu_length_mm`, `max_gpu_thickness_slots`, `max_cpu_cooler_height_mm`, `psu_form_factor`, `max_psu_length_mm` | GPU ↔ case; cooler ↔ case |
| `cooler_spec` | `cooling_type`, `max_tdp_watts`, `height_mm`, `radiator_size_mm` | cooler ↔ socket/TDP; cooler height; case ↔ radiator |
| `gpu_board_spec` | `board_tgp_watts`, `length_mm`, `width_slots`, `height_mm`, `required_power_connectors`, `recommended_psu_watts` | GPU ↔ case; GPU ↔ PSU wattage and connectors |
| `psu_spec` | `rated_wattage`, `connector_24pin_atx`, `connector_eps_count`, `connector_pcie_8pin`, `connector_12vhpwr`, `connector_sata` | GPU ↔ PSU wattage and connectors |
| `ssd_spec` | `form_factor`, `interface`, `protocol`, `pcie_generation` | storage interface checks |

`gpu_board_spec` is keyed by `product_variant_id`, not `product_id` — which is why a GPU *candidate*
is a (product, variant) pair and a GPU swap must name its variant (Engine 2B, Decision 55 item 2).
This is also the structural reason for **G-04**: the build response does not carry the variant id.

### 6.3 Compatibility policy

#### 6.3.1 The browser computes no verdict

The configurator displays verdicts; it never derives one. Four measured reasons:

1. **The rules live in the engine, not in a shared library.** All 32 codes and every resolver sit under
   `src/recommendation/compatibility/`; `apps/web-v2` imports none of it (the API boundary is the only
   contract, §2.1). A client-side table would be a second implementation with no test linking it to the
   first.
2. **`UNKNOWN` is frequently the right answer, and it depends on NULL data.** A NULL cooler height, a NULL
   connector requirement below 200 W TGP, or a `CONDITIONAL` source row all resolve to `UNKNOWN` by design
   (Decision 3b, §6.1). Reproducing that in the browser means reproducing the direction of every fail-safe.
3. **Two enforcement policies coexist.** Decision 45 made OG-10/OG-11/OG-12 HARD/REJECT while OG-09 stays
   SOFT/`UNKNOWN`, and `scripts/check-deferred-rules.js` gates any CPU/cooler/case/RAM/motherboard seed on
   it. A UI table would have to encode both policies and would drift the moment either changes.
4. **Aggregation is worst-of** (`aggregateCompatibilityResults`): any `FAIL` decides, otherwise any
   `UNKNOWN` decides, otherwise `PASS`. A card that renders only the winning status still owes the pairs.

#### 6.3.2 Two verdict surfaces, one evaluation surface

| Surface | What it answers | Cost |
| --- | --- | --- |
| `builds[].compatibility_status` | "is this whole build compatible?" | free — it is persisted with the pass |
| `swap-preview.compatibility` | "if I swapped THIS candidate into THIS role of THIS build, what would happen?" | one request per candidate |

There is no third surface. Nothing evaluates an ad-hoc component set (**G-01**), and nothing lists
candidates with verdicts (**G-02**).

#### 6.3.3 The request arithmetic (this is the architectural constraint)

`PREVIEW_RATE_LIMIT = Object.freeze({ max: 30, timeWindow: '1 minute' })`
(`apps/api/src/routes/recommendations.js:114`), and limits are **per route** — the plugin is registered
with `global: false` and each route carries its own `config.rateLimit` (`apps/api/src/app.js:265`), keyed
on the client address (`X-Forwarded-For` behind a proxy, `apps/api/src/app.js:83-97`). Previews and commits therefore
have two separate 30/min buckets, while every read has a 120/min bucket.

One preview answers **one** candidate for **one** role against **one** build.

| Interaction | Preview requests | Share of the 30/min bucket |
| --- | --- | --- |
| One replacement checked on selection | 1 | 3 % |
| Five candidates compared for one role | 5 | 17 % |
| A picker showing 20 GPUs with live verdicts | 20 | 67 % |
| One maximum catalogue page (`limit=100`) with live verdicts | 100 | **333 %** — 3⅓ minutes of budget for one screen |
| A commit after its preview | 0 extra (the commit runs the preview's read half internally) | one more slot in the swap bucket |

**Consequence — the fork Step 3.2 must accept.** Either (A) the picker shows no per-candidate verdict and
compatibility appears once, on the chosen replacement, or (B) the backend gains a candidate-listing route
that returns verdicts for a page of candidates in **one** response. Option B is a **backend ask, not
implemented in Step 3.1**, and it is the only way a 20-card picker can show live verdicts. The evidence
favours B if the picker is a product requirement, and A if it is not; §13 records the decision.

#### 6.3.4 The hard gates a UI must honour

| Condition | Response | What the UI must do |
| --- | --- | --- |
| A second commit on the same build | `409 SWAP_ALREADY_COMMITTED` | offer one change per build; a further change needs a new pass (**G-03**) |
| The build has no such role | `409 SWAP_ROLE_ABSENT` | offer only the roles the build actually carries |
| Verdict is `FAIL`, the candidate is not a candidate, or it has no eligible offer | `409 SWAP_NOT_COMMITTABLE` | never enable commit without a passing preview |
| A GPU swap without `product_variant_id` | `422` | resolve the variant id **before** offering the swap (**G-04**) |
| `product_variant_id` sent for a non-GPU role | `422` | send it only for `GPU` |
| The build no longer reconstructs from the live catalogue, or no role has an eligible offer | `404 BUILD_NOT_EVALUABLE` | say "this build can no longer be changed" and offer a fresh pass — not a generic error |
| Preview monthly budget exhausted on the bucket | `429` + `Retry-After` | countdown; the query client already never retries a 4xx |

#### 6.3.5 The UNKNOWN rendering rule

- **Three states, never two.** `PASS`, `FAIL` and `UNKNOWN` each get their own copy and their own visual
treatment. `UNKNOWN` is not a warning sign on a pass, and it is not a refusal.
- **`unknown_pairwise_count` is the count of `UNKNOWN` pairs — "never 'not PASS'"** (contract comment on
`CompatibilityAggregateSchema`). Show it whenever it is greater than zero.
- **`reason: null` is normal on a `PASS` pair** (no decisive result) and must not be rendered as an error or
dropped from the pair list.
- **Codes are not copy.** `pairs[].reason` is a stable engine code from §6.1; the dictionary maps code →
phrase. A raw `GPU_PSU_CONNECTOR_NULL_HIGH_TGP` must never reach the screen.
- **A build whose `compatibility_status` is `UNKNOWN` must not be presented as compatible.** The homepage
already refuses to render a verdict it does not have; the configurator follows the same rule.
- **Design-system gap:** `apps/web-v2/docs/DESIGN_SYSTEM.md` defines price tones (`verified`, `indicative`,
`estimated`) and `danger` for an invalid field, but **no compatibility tone set**. A third state cannot be
rendered consistently until tokens exist for it; Step 3.2 must add them rather than improvise colours.

#### 6.3.6 What this hands to the roadmap

A picker with live verdicts, or a single-check flow, are different products; §13 makes the choice explicit
and Step 3.5 cannot start before it is made.


## 7 Budget and pricing strategy

### 7.1 The trace table

Every money value a configurator screen may show, and its only legal source.

| Displayed value | Only legal source | Declared type | When it is null |
| --- | --- | --- | --- |
| Indicative total | `builds[].total_price` | number, nullable | show absence, never `0` |
| Price badge | `builds[].price_status` | `indicative` \| `verified` — **no null variant** | cannot be null: a build always carries a badge |
| Offer provenance | `builds[].components[].offer_class` | string, required | cannot be null; today always `SEED_UNVERIFIED` (**G-11**) |
| Candidate price change | `swap-preview.price.previous`, `.next`, `.delta` | number, nullable each | render the pair only, no delta |
| Candidate badge | `swap-preview.price.price_status` | `indicative` \| `verified` \| `null` | `null` → no badge for that candidate |
| Budget position | `swap-preview.budget.budget_amount`, `.total`, `.delta`, `.within_budget` | nullable each | no budget bar; never a `false` default |
| Floor | `budget_floor.cheapest_total`, with `budget_floor.within_budget` and `.missing_roles` | nullable; `budget_floor` itself nullable | no floor line; never a price |
| Catalogue from-price | list row `from_price`, with `has_offer` and `offer_class` | number/nullable, boolean, string/nullable | "no offer" state; never `0` |
| Disclaimer | the pass's `disclaimer` | string, required | cannot be null |

One measured asymmetry the UI must not flatten: `builds[].price_status` has **no** `null` in its schema,
while `swap-preview.price.price_status` does. A build always shows a badge; a hypothetical candidate may
have none. Two components, two null rules.

### 7.2 Null and overrun rules

- A `null` renders as **absence — never as `0`**, and never as a zero-looking currency amount.
- `within_budget: false` renders as an overrun **with** `budget.delta`; it is displayed, never clamped, and
  never "fixed" by silently dropping a component.
- `within_budget: null` is a third state ("budget unknown"), not `false`: the contract declares it nullable.
- `budget_floor` is a diagnostic, not a spend. `cheapest_total` is the cheapest retained-component sum, and
  a pass can legitimately assemble zero builds above it; the floor is a lower bound, not a build.
- Formatting is `formatPrice(value, currency)` only — NBSP grouping, Latin digits in both locales
  (`lib/format/price.ts`). No second formatter and no `Intl` grouping.
- The pass's required `disclaimer` is rendered on every screen that shows a price; it is the contract's own
  honesty mechanism for indicative pricing.

### 7.3 What the configurator may not compute

- **No exchange rate.** One currency is served (`meta.options.currencies`); nothing converts.
- **No tax, shipping or "final total".** A build's total is the engine's sum of `selected_price`; the client
  never re-adds component prices, because that sum is not reproducible from the response.
- **No re-pricing of unchanged components.** The repository says why in its own words: "Decision 56's commit
  copies these five values into the derived `build_component` row, and a swap must not reprice (or relabel)
  a component it did not change" (`apps/api/src/repository.js:1004-1006`).
- **No rounding beyond `formatPrice`'s integer rounding**, and never a locally rounded total presented as
  exact.

### 7.4 What 3.2 needs from this section

3.2 renders a summary skeleton from a persisted build (`from=<id>`), so it needs exactly three rows:
`total_price`, `price_status` and `disclaimer`. The swap rows arrive with 3.5; the floor line with 3.3.

## 8 Homepage integration strategy

### 8.1 What the homepage holds today (measured)

- `useHomepageStore` carries exactly `budgetAmount: number | null` and `useCase: HomeUseCase | null`,
  memory-only (no cookie, no localStorage), and deliberately no resolution field
  (`apps/web-v2/lib/homepage/store.ts`).
- The finder's submit is a no-op **with** a destination: `preventDefault`, scroll to `#configurations`, focus
  its `h2` — "The builds section is rendered by a later task; until then the CTA is a no-op rather than a
  dead link or a premature POST" (`apps/web-v2/components/home/budget-usage-finder.tsx:97-113`).
- No results route exists, and nothing posts.
- **Deviation from the plan:** `NEXT_PUBLIC_HOMEPAGE_SUBMIT` exists only in documentation
  (`apps/web-v2/docs/sections/01-homepage.md:453`, `apps/web-v2/docs/sections/01-homepage-api-mapping.md:248`); no code in
  `apps/web-v2` reads it. The plan's "flag is off" describes a documented design intent, not an
  implemented switch — recorded here rather than repeated.

### 8.2 The handoff is a URL

`/{locale}/configurateur?use_case=GAMING&budget=12000&from=<recommendationId>`

| Param | Type | Rule |
| --- | --- | --- |
| `use_case` | enum | one of `HOME_USE_CASES` (`GAMING`, `OFFICE`, `WORKSTATION`), and of `meta.options.use_cases[].value` |
| `budget` | integer | 3 500–100 000 — the finder's own bounds (`BUDGET_MIN`, `BUDGET_MAX`), carried as a number |
| `from` | uuid | a persisted `recommendation_id`; only a preset card sets it |

Why a URL and not the store: the store is memory-only, so a reload would lose a store-only handoff; a URL
survives reload, sharing and a locale switch, and it makes the configurator addressable. The homepage keeps
its store unchanged and never becomes a second source of configurator state.

Invalid values are **not** silently clamped: the configurator opens the requirements stage with the
offending field marked and a message, because a silently corrected budget is a different question than the
one the visitor asked.

### 8.3 Ownership

- The configurator owns `{ phase, requirements, recommendationId, activeBuildRank, picker, preview }` in
  `apps/web-v2/lib/configurator/store.ts`.
- It is seeded **once** from the URL at mount. The URL is not rewritten per keystroke; when a pass
  succeeds, `from=<id>` is set with `history.replaceState`, so a refresh resumes the same pass.
- `from=<id>` initialises from `GET /v1/recommendations/{id}`: `builds[]` supply `rank`, `components[]`,
  `total_price`, `build_score` and `compatibility_status` — display needs no new endpoint (§4.6).
- The homepage store is never imported by configurator code. That is an acceptance criterion in §15, not a
  convention.

### 8.4 Edge cases the handoff must survive

| Case | Behaviour |
| --- | --- |
| `from` unknown or deleted | `404` → requirements stage with "this build is no longer available", not a crash |
| No params | requirements stage, empty |
| `budget` out of range or non-numeric | that field marked invalid, other answers kept |
| Locale switch | the prefix changes; pathname **and** query must survive — proven in 3.2 |
| `from` only | the recommendation loads; requirements are derived from its `budget_amount` and `use_case` |

### 8.5 What 3.2 delivers from this section

The route, the parser, the store, the summary skeleton and the `from` read. No POST, no picker, no swap:
those are 3.3–3.5.

## 9 UX and responsive layout structure

Structure only: no CSS, no mockups, no colour values. The design system owns appearance (§2.1); this section
owns what exists, what is server-rendered, and what each surface does in each state.

### 9.1 Route and component tree

| Path | Kind | Responsibility |
| --- | --- | --- |
| `apps/web-v2/app/[locale]/configurateur/page.tsx` | server | reads `locale` and `searchParams`, renders the shell; no data fetching beyond what the first paint needs |
| `apps/web-v2/components/configurator/configurator-shell.tsx` | client | owns the store subscription, the stage switch, and the URL seed |
| `apps/web-v2/components/configurator/requirements-form.tsx` | client | use case + budget, per-locale zod schema, `inputs_applied` gate |
| `apps/web-v2/components/configurator/build-proposal.tsx` | client | renders `builds[]` as cards: total, badge, score, verdict, components |
| `apps/web-v2/components/configurator/component-picker.tsx` | client | role-scoped paged list, ordering only, selection → preview |
| `apps/web-v2/components/configurator/verdict-panel.tsx` | client | three-state verdict, `pairs[]`, `unknown_pairwise_count` |
| `apps/web-v2/components/configurator/budget-summary.tsx` | client | total, delta, `within_budget`, overrun |
| `apps/web-v2/components/configurator/build-summary-panel.tsx` | client | the persistent panel: components, total, verdict, one-change CTA |

The route is a sibling of the homepage under the existing locale layout, so `lang` and `dir` are set in the
first byte of HTML by `app/[locale]/layout.tsx` and no provider tree is introduced (§2.3).

### 9.2 Layout and responsive behaviour

- **`lg` and up:** two columns — the active stage on the left, `build-summary-panel` sticky on the right. The
  summary never scrolls away while a picker or a preview is open, because the verdict and the budget are the
  context for that decision.
- **Below `lg`:** the summary collapses to a fixed bottom bar carrying total, verdict and one action; tapping
  it opens the panel as a sheet. The bar must not cover the last row of a list — reserve its height at the
  end of the scroll container.
- **Targets and type:** 48 px minimum touch targets, `rounded-card` 16 px, tokens only
  (`apps/web-v2/docs/DESIGN_SYSTEM.md`); no hex value in a component.
- **Direction:** every layout uses logical properties, so the same tree mirrors under `dir="rtl"` without a
  second stylesheet.

### 9.3 The four states, per surface

| Surface | Loading | Empty | Error | Partial |
| --- | --- | --- | --- | --- |
| Requirements | n/a (local state) | untouched form | field-level validation | some answers valid, one invalid |
| Pass | skeleton cards with the stage named | zero builds above the floor, with the floor line | `422` / `429` / `500` / `503`, each with its own copy | `reused: true` — show the pass, note it was reused |
| Picker | skeleton rows | no candidates for this role | `429`, or `404` build no longer evaluable | last page reached, `next_cursor: null` |
| Preview | "checking this replacement" with `aria-busy` | n/a | `422` / `409` / `404` | verdict present but `unknown_pairwise_count > 0` |
| Summary | skeleton blocks | no build yet | stale build (`404`) → offer a new pass | a swapped build: original + derived, clearly labelled |

A surface with no empty state is usually a surface that has not been designed: the picker's empty state (a
role with no candidates) is a real outcome, not an edge case.

### 9.4 Interaction and accessibility

- **Focus follows navigation.** After a stage change or a scroll-to-section, move focus to that section's
  heading with `tabIndex = -1` — the pattern the finder already uses (`apps/web-v2/components/home/budget-usage-finder.tsx:104-113`).
- **Async verdicts announce themselves:** `aria-live="polite"` on the verdict region, `aria-busy` on the
  preview button while it is in flight. A verdict that appears silently is invisible to a screen reader.
- **Never colour alone.** `PASS`, `FAIL` and `UNKNOWN` each carry a label, an icon and a tone; the token gap
  in §6.3.5 must be closed before 3.6 renders any of them.
- **The picker is keyboard-operable end to end:** arrow through rows, `Enter` to preview, `Escape` to close the
  summary sheet on mobile.
- **360 px is a tested width**, not an aspiration: the layouts above are the ones the 3.8 gate measures.

## 10 French and Arabic architecture

### 10.1 One new namespace

`Configurator`, with subsections `Requirements`, `Proposal`, `Picker`, `Verdict`, `Budget`, `Summary`,
`Errors`, `Actions`. Existing namespaces (`Metadata`, `Price`, `Shell`, `NotFound`, `Homepage`) are not
reused for configurator copy: a shared key means a homepage edit silently changes the configurator.

### 10.2 The parity rule, and the gate that does not exist yet

Measured today: `messages/fr.json` and `messages/ar.json` hold **122 leaf keys each**. `apps/web-v2` has no
`check:i18n` script (V1 does), so nothing currently enforces parity here. 3.7 therefore adds a Vitest
test that asserts three things: identical leaf-key sets, identical `{placeholder}` sets per key, and no
`Configurator` key present in one locale only. That test is the parity rule; prose is not.

### 10.3 Codes are dictionary entries, never copy

- 32 reason codes (§6.1), 3 statuses, and the swap/build error codes (`SWAP_ALREADY_COMMITTED`,
  `SWAP_ROLE_ABSENT`, `SWAP_NOT_COMMITTABLE`, `BUILD_NOT_EVALUABLE`) each get a key in both locales.
- A unit test iterates a checked-in fixture of those codes and fails on a missing key; an E2E assertion checks
  that no raw `[A-Z][A-Z0-9_]{4,}` token appears in the verdict panel's rendered text.
- `UNKNOWN` is a first-class string (§6.3.5), not a fallback.

### 10.4 RTL

- `app/[locale]/layout.tsx:75` computes `const dir = locale === "ar" ? "rtl" : "ltr"` and `:96` sets it on
  `<html>`; the configurator inherits it and adds no second mechanism.
- Layout uses logical properties (`ms-`/`me-`, `text-start`), so panels, the sticky summary and the mobile bar
  mirror without a parallel stylesheet.
- Prices stay Latin-digit and NBSP-grouped in both locales (`lib/format/price.ts`), and the currency symbol
  follows the number in the locale's own form (`8 594 د.م.`) — the formatter, not the component, decides.
- The Arabic E2E must include the mirrored layout at 360 px, following `e2e/homepage-finder-ar.spec.ts`.

### 10.5 The engine's explanation stays French

`builds[].explanation` is engine text served in French, and the homepage already maps it verbatim
(`lib/homepage/builds.ts:111`: `rationale: build?.explanation ?? null`). The configurator does the same: it
may add a localized *label* ("Engine note"), but it does not translate, paraphrase or re-word the text. A
second copy of a verdict in another language would be a second verdict.

### 10.6 Arabic sign-off stays honest

`apps/web-v2/docs/homepage-arabic-review.md` exists and is still outstanding for the homepage. Configurator
vocabulary — compatibility states, "indicative", "swap", "replacement", "budget overrun" — needs native
review before any Arabic screen ships, and nothing in this report claims that review has happened.

## 11 Security and reliability

### 11.1 Verdict authority and request budget

- **Verdicts are server-authoritative.** The client sends identities (`role`, `product_id`,
  `product_variant_id`) and receives a verdict; it never sends a status and never invents one (§6.3.1).
  The preview handler states the same rule: "IDENTITIES only … the engine re-derives every verdict from the
  live catalog; handing it persisted statuses would let it judge a swap against yesterday's relationships"
  (`apps/api/src/routes/recommendations.js`).
- **Verdicts are not cacheable over HTTP.** Both the preview and the commit send
  `Cache-Control: no-store` (`apps/api/src/routes/recommendations.js:821` and `:981`), because a verdict is a function of
  the live catalogue *and* the persisted build. A client-side cache is therefore a UX choice, not a
  protocol one, and its key must include `role`, `product_id`, `product_variant_id` and `catalog_version` —
  omitting any of them can serve one candidate's verdict for another.
- **Rate limits are per route and per client address**, `global: false`, 30/min for preview and for commit,
  120/min for reads (`apps/api/src/app.js:265`, `apps/api/src/routes/recommendations.js:107-114`). A 429 carries `Retry-After`; the
  shared query policy never retries a 4xx (`lib/api/query-client.ts`).
- **Staleness is a first-class state, not an errored one.** `404 BUILD_NOT_EVALUABLE` means the build can no
  longer be judged against today's catalogue (a persisted pick is no longer a candidate, or no role has an
  eligible offer). The remedy is a fresh pass, and the UI must say so.
- **No authentication exists**, so rate-limit buckets are the only abuse control and they are shared by
  everyone behind one egress address. This is another reason a picker must not fan out previews (§6.3.3).

### 11.2 Pricing integrity

- **One source per value.** §7.1's table is exhaustive: a screen that shows a number not in it is a defect,
  and a number recomputed client-side is the same defect with extra steps.
- **The total is the engine's.** `builds[].total_price` is the sum of `selected_price` at pass time; a swap
  copies untouched components' carriers rather than repricing them (§7.3), so a client-side re-add would
  disagree with the server exactly where the server is more careful.
- **`catalog_version` is part of every verdict's meaning.** Persisted builds and previews both carry it; two
  builds with different `catalog_version` values are not comparable on price.
- **Indicative is the honest default.** Every offer is seed data today (**G-11**), so every price is
  `indicative` / `SEED_UNVERIFIED`; the UI must never dress that up as verified.

### 11.3 Error envelope and recovery

- Failures are codes, not prose: `422` (bad identity or role), `404` (`BUILD_NOT_EVALUABLE` or unknown id),
  `409` (the three swap refusals), `429` (with `Retry-After`), `500`, and `503` (the service itself is
  unavailable, which the contract declares on the pass and on two reads). §6.3.4 maps each to a UI action.
- **A refusal is a result.** `200` with `compatibility.status: FAIL` is not an error state — it is the answer
  to "would this work?", and it must look like an answer, not like a crash.
- **No retry on 4xx.** `lib/api/query-client.ts` already retries only `5xx`/`408` and a fetch `TypeError`;
  a configurator mutation inherits `retry: false`, so a duplicate commit cannot be created by a retry loop.
- **Recovery is explicit:** stale build → new pass; rate limited → countdown; unknown candidate → back to the
  picker with the row marked.

### 11.4 Observability, for when it is deployed

No analytics exist in V2 and this audit adds none. What it does fix is the contract a future instrumentation
must respect: never send `product_id`, `product_variant_id`, or a full `swap-preview` body to a third party —
these are catalogue identities, and the verdict text is engine output. Event names, if added, belong in 3.9
with the same `no-store` posture as the responses they describe.

## 12 Testing strategy

The strategy is inherited, not invented: V2 already has the layers, the fixtures and the no-network rule.
What changes is the subject under test.

### 12.1 Layers and the gates that own them

| Layer | Tooling today | Gate | What it must cover here |
| --- | --- | --- | --- |
| Unit | Vitest, 18 files under `tests/**` | `npm test` | store transitions, URL parsing, per-role schema, dictionary completeness, money-null rules |
| Component | Vitest + jsdom, existing `tests/components/**` | `npm test` | the four states of §9.3, three-state verdict, disabled commit without a passing preview |
| E2E | Playwright, 5 specs, `page.route` stubs | `npm run test:e2e` | handoff, pass render, picker paging, preview, commit, `409`/`404`/`429`, RTL at 360 px |
| Contract | `openapi-typescript` against the snapshot | `npm run check:api-types` | no configurator field that the contract does not declare |
| Types | `tsc --noEmit` | `npm run typecheck` | every response shape narrowed from `lib/api/schema.d.ts`, never re-declared |
| Lint | ESLint + Prettier | `npm run lint`, `npm run format:check` | no hand-written hex, no untyped `any` at the API boundary |

### 12.2 Coverage matrix, by capability

| Capability | Unit | Component | E2E |
| --- | --- | --- | --- |
| URL handoff (§8.2) | parse/validate/reject | seeded form | deep link, invalid budget, locale switch keeps query |
| One pass (§4.2) | request-body builder | loading/empty/error/reused | stubbed `POST`, `reused: true` |
| Picker (§5.2) | ordering, cursor | empty role, last page | paging, role switch, no verdict on a row |
| Preview/commit (§5.4) | payload per role | disabled until previewed | `201`, `409`, `404`, `429` |
| Verdict rendering (§6.3.5) | code → key | three states, `reason: null` | no raw code on screen |
| Money (§7.2) | null vs `0` vs `false` | absence, overrun, unknown | overrun visible, never clamped |
| i18n/RTL (§10) | key + placeholder parity | mirrored panel | Arabic 360 px |

### 12.3 Fixtures, and the rule that keeps them honest

- Fixtures are JSON shaped from the contract in §3.1, committed under `apps/web-v2/tests/fixtures/` — the same
  shape a stub returns, so a component test and an E2E test cannot disagree about a field name.
- E2E stubs every `/v1/**` call through `page.route`, as the homepage does, and **fails on an unmatched
  request** rather than letting it reach a network. A test that can silently hit a real API is not a test.
- An opt-in real-engine E2E (analogue of V1's `apps/web/e2e/wizard-engine.spec.ts`) belongs to 3.5: guarded by an env flag,
  skipped by default, writing to the TEST branch only and cleaning up its own pass. It is never in the default
  suite.

### 12.4 Failure modes that must have a test, not a hope

1. A second commit on the same build → `409 SWAP_ALREADY_COMMITTED` renders as "already changed", not as a
   generic error.
2. A stale build → `404 BUILD_NOT_EVALUABLE` offers a fresh pass.
3. A `429` carries `Retry-After`; the UI shows a countdown and the query client does not retry it.
4. `UNKNOWN` renders as its own state in both locales, and `reason: null` is not dropped.
5. `null` money renders as absence; `within_budget: false` renders as an overrun with its delta.
6. A GPU swap without a variant id is impossible to send from the picker (the payload builder is tested per
   role); a non-GPU swap never includes one.
7. A locale switch preserves the query string.

### 12.5 What 3.1 could not test

No live API call was made, so nothing here asserts that the deployed service behaves as the snapshot says —
that is the API's own suite (`npm run test:api`, `test:api:db`), not V2's. The contract snapshot is the oracle
for this layer, and `check:api-types` is the alarm when it moves.

## 13 Implementation roadmap

### 13.1 Steps 3.2–3.9

| Step | Objective | Scope | Expected files | Backend dependency | Acceptance criteria | Testing requirement | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3.2 | Route, handoff, state, summary skeleton | `/{locale}/configurateur`, URL parse + validate, configurator store, summary panel from `from=<id>`; **no POST** | `app/[locale]/configurateur/page.tsx`; `components/configurator/{configurator-shell,requirements-form,build-summary-panel}.tsx`; `lib/configurator/{store,schema}.ts`; `tests/configurator/**`; `e2e/configurator-handoff.spec.ts` | none — `GET /v1/meta/options` and `GET /v1/recommendations/{id}` already exist | §15 criteria 1–5, 8–10 | unit: URL → store, invalid input; component: four states; e2e: deep links, locale switch | URL seed runs twice under React strict mode; make seeding idempotent |
| 3.3 | Requirements → one pass → proposal | requirements form wired to `POST /v1/recommendations`; proposal cards with total, badge, score, verdict; floor line; `reused: true` handled | `lib/configurator/queries.ts`; `components/configurator/build-proposal.tsx` | exists (30/min, write) — gate optional inputs on `inputs_applied` (**G-09**) | one pass renders its `builds[]`; a zero-build pass shows the floor; `reused` is labelled; resolution/priority only asked when applied | stubbed `POST` 200/422/429; request-body assertion; `reused: true` | asking a question the active model discards — mitigated by the meta gate, not by copy |
| 3.4 | Catalogue picker | role-scoped paged list, ordering only, **no per-candidate verdict**; GPU rows expose variant choice | `components/configurator/component-picker.tsx`; `lib/configurator/catalog.ts` | **owner decision** — option A: list only; option B needs a new candidate-listing endpoint and a contract minor (**G-02**) | rows carry name, from-price, offer state; paging; zero preview requests while browsing; GPU row selects a variant | paging, empty role, last page, ordering; assert no `swap-preview` call from the picker | reading a detail per row to sort by a spec exhausts the 120/min read bucket |
| 3.5 | One replacement, checked then committed | preview on selection, verdict panel with pairs, commit, `409`/`404` handling; **GPU swaps scoped out until G-04** | `components/configurator/{verdict-panel,budget-summary}.tsx`; `lib/configurator/swap.ts` | preview + commit exist; GPU needs the §3.5 contract change | preview shows `PASS`/`FAIL`/`UNKNOWN` with pairs; commit disabled unless previewed and not `FAIL`; second commit renders `409` copy; GPU disabled with an explanation | `201`/`409`/`404`/`422` per role; payload builder; no variant id for non-GPU | the GPU flow is blocked by a two-line API change nobody has scheduled — visible product gap, documented |
| 3.6 | Verdict and money surfaces | three-state tokens in the design system, budget bar, overrun, null rules | `app/globals.css` (`@theme`); `docs/DESIGN_SYSTEM.md`; `verdict-panel`, `budget-summary` | none | tokens exist; `UNKNOWN` never renders as pass; overrun shows its delta; `null` renders as absence | component tests per state; contrast checked against the new tones | a third state rendered with improvised colour is a design-system defect that outlives the sprint |
| 3.7 | i18n, RTL, Arabic | `Configurator` namespace, parity test, code dictionary, mirrored layout | `messages/{fr,ar}.json`; `tests/i18n/configurator-parity.test.ts`; `e2e/configurator-ar.spec.ts` | none | parity test green; no raw code reaches the DOM; Arabic at 360 px mirrors without a second stylesheet | parity unit test; Arabic E2E; code-rendering assertion | native Arabic review is outstanding (§10.6) — `ar` must not ship before it |
| 3.8 | Hardening | keyboard paths, focus management, 360 px, bundle budget | picker, verdict panel, summary panel | none | keyboard-only: picker → preview → commit; no horizontal scroll at 360 px; no layout shift when the verdict arrives | E2E keyboard journey; 360 px sweep | a11y work discovered late competes with 3.9; start it inside 3.4 not after |
| 3.9 | Launch readiness | rate-limit UX, error copy coverage, runbook, observability contract | error copy, docs, no new endpoint | none — unless G-02/G-04 are approved, in which case their contract change lands here | every documented code has copy in both locales; `429` countdown; runbook lists the three refusal cases | fault-injection stubs for 429/500; copy-coverage test | shipping without G-04 means GPU replacement is absent from "launch", which the owner must accept explicitly |

### 13.2 The critical path, and the one fork

`3.2 → 3.3 → 3.4 → 3.5` is the critical path. Each step needs the previous one's state, and 3.4/3.5 cannot be
parallelised without building two versions of the picker.

**The fork is at 3.4, and it is a product decision, not an engineering one:**

- **Option A — picker without live verdicts.** 3.4 ships a paged, ordered list; compatibility appears once, on
the chosen candidate, as the preview. This is buildable against the frozen contract with no backend work.
- **Option B — a candidate-listing route that returns verdicts for a page.** A new endpoint, a new contract
minor, and engine work to evaluate N candidates in one pass. It is the only way a 20-card grid can show live
verdicts (§6.3.3: the preview route would otherwise need 333 % of a minute for one page).

**The evidence favours A.** B is a backend programme with its own decision, its own contract bump and its own
risk; A matches the contract the report was written against, and it does not foreclose B — the verdict panel
is the same component either way. The owner decides whether per-candidate verdicts in the grid are a product
requirement; if they are, B becomes a step *before* 3.4 and the roadmap renumbers.

### 13.3 What proceeds independently of that fork

3.2 (route, handoff, state, summary), 3.6 (tokens and money surfaces), 3.7 (i18n/RTL) and most of 3.8 need no
backend decision. 3.3 needs none either — the pass already exists. Only 3.4's grid and 3.5's GPU path wait.

## 14 Technical risks and unresolved decisions

### 14.1 Risks

| Risk | Impact | Likelihood | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| Per-candidate verdicts are assumed available | 3.4 rebuilt after 3.5 | medium | decide §13.2's fork before 3.4 starts; build the verdict panel so either option reuses it | owner |
| GPU replacement cannot be offered (G-04) | a visible gap in the flagship flow | high until the contract change lands | schedule the two-line §3.5 change; scope GPU out of 3.5 explicitly until then | owner / API |
| `UNKNOWN` collapsed into "compatible" | a visitor buys on an unverified pairing | medium | §6.3.5 as an acceptance criterion, not a style guide; three-state tokens in 3.6 | web |
| Rate-limit fan-out (previews per card) | 429 for everyone behind one egress address | medium | no verdict in the grid (option A); no retry on 4xx; countdown copy | web |
| Prices read as final | a support burden and a trust problem | medium | `disclaimer` required on every price surface; `indicative` badge; never "final total" | web |
| Arabic ships un-reviewed | terminology errors on a primary market | medium | §10.6; `ar` gated on the outstanding native review | owner |
| Contract snapshot drifts silently | a configurator field that stops existing | low | `check:api-types` in CI; the same gate V2 already runs | web |

### 14.2 Unresolved decisions (owner-only)

| Id | Decision | Why the audit cannot settle it | Needed before |
| --- | --- | --- | --- |
| D-1 | Live verdicts in the picker: option A or B (§13.2) | it is a product requirement, not a measurement | 3.4 |
| D-2 | Whether to schedule the G-04/G-05 contract minor, and when (it touches V1) | release policy across two apps | 3.5's GPU path |
| D-3 | Whether `ar` may ship before native review | market/legal judgement | 3.7 |
| D-4 | Whether 3.2 includes the `from=<id>` modify flow or only the fresh requirements path | scope, though the backend cost is zero | 3.2 kickoff |
| D-5 | Whether a zero-build pass offers a "raise the budget" action | product tone: guidance vs pressure | 3.3 |
| D-6 | Whether G-02 (candidate listing) is ever built, or the single-check flow is the product | roadmap, not this audit | 3.9 |

## 15 Acceptance criteria for Step 3.2

Each criterion is checkable without reading implementation code, and none depends on a capability the matrix
marked `does not exist` — 3.2 uses two `GET`s that already exist.

1. **The route exists in both locales.** `/{fr,ar}/configurateur` answers `200` and renders an `h1` from the
   `Configurator` namespace.
2. **A deep link pre-fills.** `?use_case=GAMING&budget=12000` renders both answers already chosen, without a
   second interaction.
3. **An invalid budget is refused, not clamped.** `?budget=12` marks the field invalid, keeps the other
   answer, and never silently rewrites the number.
4. **A `from` deep link renders a build.** `?from=<a real id>` shows that build's `total_price`,
   `price_status` and one row per component with its role and name.
5. **An unknown `from` is a state, not a crash.** It renders "this build is no longer available" and the
   requirements form.
6. **State ownership is provable.** No configurator module imports `lib/homepage/store.ts`; the summary panel
   reads only the configurator store.
7. **The locale switch preserves the address.** Switching `fr` → `ar` on a deep-linked URL keeps the pathname
   and the query string.
8. **3.2 issues only reads.** The E2E records every request and fails on any method other than `GET`; the only
   `/v1` calls are `meta/options` and, when `from` is present, `recommendations/{id}`.
9. **360 px is clean.** No horizontal scroll, the mobile summary bar does not cover the last row, and every
   target is at least 48 px.
10. **No raw engine vocabulary on screen.** No `[A-Z][A-Z0-9_]{4,}` token appears in the rendered text of a
    3.2 surface.
11. **The gates are green:** `npm run typecheck`, `npm run lint`, `npm run check:api-types`, `npm test` and
    `npm run test:e2e` all exit 0.

What 3.2 deliberately does **not** include: the pass (§3.3), the picker (§3.4), any swap (§3.5). The brief's
rule holds — 3.2 starts only after the owner has read this report.
