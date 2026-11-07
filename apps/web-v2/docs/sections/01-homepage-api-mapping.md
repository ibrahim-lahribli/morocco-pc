# 01 — Homepage API mapping (supplementary)

Companion to `01-homepage.md`. Every row is taken from the committed contract snapshot
`apps/api/test/unit/openapi-v1.10.json` (OpenAPI **3.0.3**, `info.version` **1.10.0**) and
the generated types in `apps/web-v2/lib/api/schema.d.ts`. Nothing here is inferred from a
future endpoint.

**Rules this document assumes**

- No endpoint, path, field or enum value is used unless it appears in that snapshot.
- The homepage renders what the API serves; it never computes a score, a compatibility
  verdict, a price status or a budget floor.
- No recommendation `POST` is executed by the implementation as a smoke test. Browser
  tests stub `/v1/**`; server-side verification, if any, is read-only.
- Types are regenerated (`npm run gen:api-types`) and drift-checked
  (`npm run check:api-types`); never hand-edited.

---

## 1. Operations in the contract

| Method | Path                                                  | Purpose in the contract                                      |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------ |
| GET    | `/v1/health`                                          | Liveness plus database reachability                          |
| GET    | `/v1/meta/options`                                    | Accepted use cases, currencies, resolutions and priorities   |
| GET    | `/v1/presets`                                         | Generated landing-page presets for one use case and currency |
| POST   | `/v1/recommendations`                                 | Create a recommendation (one full engine pass)               |
| GET    | `/v1/recommendations/{id}`                            | Read a persisted recommendation                              |
| GET    | `/v1/catalog/products`                                | Paginated ACTIVE product catalogue                           |
| GET    | `/v1/catalog/products/{slug}`                         | One ACTIVE product: specs, priced offers, provenance         |
| GET    | `/v1/catalog/products/{slug}/price-history`           | The observations behind one product price                    |
| GET    | `/v1/recommendations/{id}/builds/{rank}/swap-preview` | Preview one component swap                                   |
| POST   | `/v1/recommendations/{id}/builds/{rank}/swap`         | Commit one component swap                                    |

Homepage scope: `meta/options`, `presets`, `recommendations/{id}` (read), and one guarded
`POST /v1/recommendations`. Everything else belongs to a later step.

---

## 2. `GET /v1/meta/options` — finder vocabulary

**Used by:** the finder (usage options, whether resolution is asked) and the
shortcut section (whether to render at all).

**Request:** no parameters, no body.

**Response 200**

```json
{
  "use_cases": [{ "value": "GAMING", "label": "…" }],
  "currencies": [{ "value": "MAD", "label": "…" }],
  "resolutions": [{ "value": "1080p", "label": "…" }],
  "priorities": [{ "value": 3, "label": "…" }],
  "inputs_applied": ["use_case", "priority"]
}
```

| Field                | Use on the homepage                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `use_cases[].value`  | the three finder options' wire values                                                                                             |
| `currencies[].value` | confirm `MAD` is served before posting; render with the detail's `currency`, falling back to the confirmed `MAD`                  |
| `inputs_applied`     | if it lacks `"resolution"`, hide the shortcut tiles once they are enabled; they are hidden in the first release regardless (Q-20) |
| `resolutions`        | the values behind the deferred 1080p / 1440p tiles (Q-20)                                                                         |
| `priorities`         | **not used** (the API default order is the product decision)                                                                      |
| `label`              | **not used** — labels come from the dictionary for voice/Arabic                                                                   |

**Failures:** 429, 500, 503 (503 = no active model / no usable vocabulary).

**Homepage behaviour:** non-blocking. The finder renders the three fallback usages
(`GAMING`, `OFFICE`, `WORKSTATION`) immediately and upgrades to served values if the call
succeeds. A 503 disables nothing in the form; it only removes the shortcuts.

**Caching:** `staleTime` 5 min (vocabulary changes with a deploy, not per request).

---

## 3. `GET /v1/presets` — the generic configuration cards

**Used by:** section 3 (recommended complete PC configurations).

**Request**

| Query      | Required | Notes                                                              |
| ---------- | -------- | ------------------------------------------------------------------ |
| `use_case` | yes      | one advertised value; an unknown value is 422, never an empty list |
| `currency` | yes      | exactly 3 characters, one of the advertised values                 |

No `resolution`, no `budget`, no `limit` — and unknown query parameters are refused
(422), so the homepage must not add one.

**Response 200**

```json
{
  "catalog_version": "9f0c1a…",
  "generated_at": "2026-10-16T09:00:00.000Z",
  "presets": [
    {
      "budget_amount": 6000,
      "recommendation_id": "b6f1c0a5-…",
      "build_score": 61.25,
      "price_status": "verified"
    }
  ]
}
```

| Field                         | Homepage use                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `presets[].budget_amount`     | the served preset budget, rendered as the card's `builds.budgetLabel` line via `formatPrice(value, currency)`; also the ladder key — responses arrive ordered by it                                    |
| `presets[].recommendation_id` | the key for the detail read and the card's identity                                                                                                                                                    |
| `presets[].build_score`       | the configuration score (`builds.scoreLabel`); `null` means "pass assembled nothing" → render "—", never `0`                                                                                           |
| `presets[].price_status`      | preset-level summary of its rank-1 build at generation time; **not the card badge source** once a detail is rendered (the build's own status wins — §4); `null` means "no build to make a claim about" |
| `catalog_version`             | part of the query key, so a price update invalidates the render                                                                                                                                        |
| `generated_at`                | **not rendered** in Step 1 (no "as of" copy approved)                                                                                                                                                  |

**Deterministic selection (owner decision: 12,000 MAD ceiling).** For each use case,
select the highest row with `budget_amount <= 12_000`: filter the ascending list
(`SELECT_PRESETS_SQL` already orders by `budget_amount ASC`) to rows at or below 12,000
and take the last one. Never select the median of the ladder and never fall back to a
row above 12,000 — a use case with no qualifying preset keeps its slot and shows its
empty state. The selected row's `budget_amount` is the displayed tier: it may be below
12,000 and is never labelled as an exact 12,000 DH build. Detail reads are requested
only for those three ids, in the fixed order Gaming → Office → Workstation; a missing
detail never substitutes another use case, and a preset whose `builds` is empty makes
no complete-PC claim. After a finder answer, pick the highest preset of the **selected**
use case with `budget_amount <= visitorBudget` (empty state when none,
`builds.budgetCap` when the budget exceeds the top tier).

**What a preset is not.** It carries **no title, no components, no total price**. It is a
pointer to a persisted recommendation. The card's spec pills, total price, rationale and
compatibility status therefore require §4.

**Failures and states**

| Response               | Meaning                                          | Homepage                                         |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------ |
| 200 with `presets: []` | "nothing generated for this catalog yet" — valid | empty state (`builds.empty.*`), not an error     |
| 422                    | our bug (wrong use case/currency)                | generic error; logged                            |
| 429                    | rate limit (120/min reads)                       | error block with retry after `retryAfterSeconds` |
| 500 / 503              | server or no active model                        | error block with retry                           |

**Calls:** exactly one per use case — three for the initial cards (`GAMING`, `OFFICE`, `WORKSTATION`) — because the route takes exactly one; they run in parallel and each response stays keyed by its use case. Step 1 has no filter tabs: the section shows one card per use case, and the finder narrows it (selection rule below).

---

## 4. `GET /v1/recommendations/{id}` — preset detail

**Used by:** section 3, once per rendered preset (at most three), in parallel.

**Request:** path `id` (the `recommendation_id` from §3). No query.

**Response 200 (fields the homepage reads)**

```json
{
  "id": "…",
  "budget_amount": 20000,
  "currency": "MAD",
  "use_case": "GAMING",
  "generated_at": "…",
  "budget_floor": {
    "cheapest_total": 4477,
    "currency": "MAD",
    "budget_amount": 20000,
    "within_budget": true,
    "cheapest_by_role": { "CPU": 899 },
    "missing_roles": []
  },
  "engine_version": "…",
  "catalog_version": "…",
  "reused": false,
  "reason": null,
  "disclaimer": "Prix indicatifs, non actualisés.",
  "input_effects": [{ "input": "use_case", "effect": "APPLIED", "reason": "USE_CASE_PROFILE" }],
  "served_by": { "engine_version": "…" },
  "builds": [
    {
      "rank": 1,
      "total_price": 12000,
      "build_score": 77.5,
      "compatibility_status": "PASS",
      "strategy_key": "PERFORMANCE",
      "explanation": "…",
      "price_status": "indicative",
      "components": [
        {
          "role": "CPU",
          "product_id": "…",
          "name": "AMD Ryzen 5 5600",
          "slug": "amd-ryzen-5-5600",
          "variant": null,
          "price_used": 1999,
          "offer_class": "SEED_UNVERIFIED",
          "store_offer_id": "…"
        }
      ]
    }
  ]
}
```

**Field mapping to the card**

| Card element      | Field                            | Rule                                                                                                                                                                                                                             |
| ----------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title             | —                                | **ours**: the use-case label (`builds.category.*`); the API carries no title and the H3 copy is open (Q-16)                                                                                                                      |
| Total price       | `builds[0].total_price`          | `formatPrice(value, detail.currency)`; `null` → render no price, keeping the `builds.budgetLabel` line — never relabel the budget as a price                                                                                     |
| Price badge       | `builds[0].price_status`         | the only badge source: `verified` → `builds.badge.verified`; `indicative` → `builds.badge.indicative`; `null` or no complete build → **no badge** — never `presets[].price_status` as a stand-in, never "indicatif" as a default |
| Compatibility     | `builds[0].compatibility_status` | **not rendered on the homepage card** in Step 1 (§6 carries the score and price badges only); never turn an unknown verdict into an OK claim                                                                                     |
| Score overlay     | `builds[0].build_score`          | `builds.scoreLabel` + "{n}/100", never FPS or a benchmark; `null` → "—"                                                                                                                                                          |
| Spec pills        | `builds[0].components[]`         | first four by role order `CPU`, `GPU`, `RAM`, `SSD_BOOT`, showing `name` (not `variant`, which may be `null`)                                                                                                                    |
| Rationale         | `builds[0].explanation`          | if present, one clamped line; `null` → omit the block                                                                                                                                                                            |
| Pattern/archetype | `builds[0].strategy_key`         | not rendered in Step 1; reserved for Step 2                                                                                                                                                                                      |
| Disclaimer        | `disclaimer`                     | rendered once under the price row, not per card                                                                                                                                                                                  |
| `budget_floor`    | `budget_floor.*`                 | **not rendered** — never used as a build price or as proof an assembly exists (§6)                                                                                                                                               |

**Deliberate non-mappings**

- `explanation` is engine text in French. It is rendered **as served**, not translated and
  not templated: producing it is Engine 6's job, and the Arabic page shows the served
  French sentence with no local re-wording. If product rejects French on `/ar`, that is an
  API/localisation question, not a frontend rewrite (see the open questions).
- `budget_floor` is informational. It is never used to declare a build "within budget",
  and the homepage never recomputes it.
- `reused`, `served_by`, `engine_version` are not rendered on the homepage (they belong to
  the results page's diagnostics, if at all).

**Failures:** 404 (a preset pointing at a vanished pass — render the card without detail or badge and log it; never substitute another preset's detail), 429, 500, 503.

**Calls.** The three detail reads on first paint are the homepage's _initial_ fan-out,
not a lifetime limit: a preset the finder selects later reuses a cached detail for the
same `recommendation_id` and `catalog_version`, and otherwise issues exactly one more
`GET /v1/recommendations/{id}` (§7). One failed detail degrades only its own card, and the
previous selection's components are cleared as soon as the selection changes — stale
specifications from another preset are never displayed.

**Detail states on a selection change.** Loading → keep the slot and clear pills, score
and badge; 404 → card without detail or badge, logged; `builds: []` → no complete-PC claim
and no price; 429/500/503 → that card's error line with retry, the section stays usable.

---

## 5. `POST /v1/recommendations` — the finder's submit

**Used by:** the finder CTA only (§5.5 of the main spec), and gated by
`NEXT_PUBLIC_HOMEPAGE_SUBMIT` (default **off** until the results route exists).

**Request body** (`additionalProperties: false` — unknown fields are 422)

```json
{ "budget_amount": 12000, "currency": "MAD", "use_case": "GAMING", "resolution": "1440p" }
```

| Field           | Homepage source                                         | Notes                                                                            |
| --------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `budget_amount` | finder store                                            | JSON **number**, integer, 3 500–100 000 client-side; API accepts up to 1 000 000 |
| `currency`      | `MAD`, confirmed via `meta/options`                     | must be an advertised value                                                      |
| `use_case`      | finder store                                            | `GAMING` \| `OFFICE` \| `WORKSTATION` (served vocabulary)                        |
| `resolution`    | **not sent in the first release** (tiles hidden — Q-20) | when enabled, shortcut tiles only; omitted when the visitor never chose one      |
| `priority`      | **never sent**                                          | the default order is the product decision                                        |

**Responses:** `201` (new pass) and `200` (`reused: true`, same `id`) carry the same body —
the homepage only needs `id` to navigate. Both count as success.

**Request identity / dedupe** (contract v1.3): a repeat POST with the same
`(budget_amount, currency, use_case, resolution, priority, scoring model, catalog_version,
engine_version)` is answered from the committed pass and writes nothing. The 500 MAD step
makes accidental exact repeats unlikely but harmless.

**Cost:** a pass is a real engine write (~74 statements). That is why the homepage posts
only on an explicit CTA, never on load, never on filter change, and never in a retry loop
(`retry: false` on the mutation).

**Failures and UI**

| Response            | UI                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------- |
| 422                 | generic submit error; logged as a frontend bug (the form mirrors the contract)         |
| 429                 | `finder.error.rateLimited` with `retryAfterSeconds`; submit disabled for the countdown |
| 500 / 503           | `finder.error.submit` + retry button; answers preserved                                |
| network `TypeError` | the query client's single TypeError retry, then the same error block                   |

---

## 6. Endpoints deliberately **not** used on the homepage

| Need in the brief                        | Endpoint                                                  | Why not now                                                                                               |
| ---------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| "Featured guides" content                | none exists                                               | static typed content module; guide routes are Step 4                                                      |
| "Trust / methodology" copy               | none exists                                               | static dictionary copy                                                                                    |
| "Toutes les configurations (N)"          | `GET /v1/catalog/products` lists _components_, not builds | there is no builds index; the link is disabled in Step 1                                                  |
| Saved builds / header badge              | none exists (no auth, no persistence in V2)               | omitted                                                                                                   |
| 1080p / 1440p "from" prices              | `GET /v1/presets` has no resolution parameter             | tiles deferred (Q-20, approved); no price is derived and no simulated resolution filtering is implemented |
| Hero "Sélection du moment" rig           | `GET /v1/presets` + §4 detail                             | only when data is available (source use case undecided — Q-19); otherwise the text-only shell             |
| Liveness banner ("Index MAD temps réel") | `GET /v1/health` exists                                   | **removed by owner decision (Q-17)**: not a price index, and the claim ships in neither dictionary        |

---

## 7. Rate limits, caching and query keys

| Operation                      | Contract limit | Homepage policy                                                                                                                                                     |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/meta/options`         | 120/min        | `staleTime` 5 min, one request per session                                                                                                                          |
| `GET /v1/presets`              | 120/min        | one per use case, `staleTime` 60 s, key includes `use_case`, `currency` and `catalog_version` when known                                                            |
| `GET /v1/recommendations/{id}` | 120/min        | one per rendered card, `staleTime` 60 s, key `["recommendation", recommendationId, catalogVersion]`; a cached entry is reused when the finder reselects that preset |
| `POST /v1/recommendations`     | 30/min         | `retry: false`; one request per explicit CTA click                                                                                                                  |

Retry policy stays the foundation's: 5xx/408 twice, fetch `TypeError` once, 4xx and 429
never, mutations never. A 429 is a UI countdown, not a retry.

---

## 8. Verification rules for the implementation

1. `npm run gen:api-types` then `npm run check:api-types` after any contract change; the
   homepage must still typecheck unchanged.
2. Playwright stubs every `/v1/**` call with `page.route`; no test reaches a real API and
   no test creates a recommendation row.
3. Unit tests use the injected `fetch` from `createApiClient({ fetch })`; no test opens a
   socket.
4. Server rendering must not require the API: `npm run build` passes with no API process,
   which is why the data-bearing section is a client island.
5. Any field added to a card must exist in this document first; a field that is not in the
   contract is a spec bug, not an implementation detail.
