# Real-Offer Ingestion Pipeline — Design (F8 / OG-06)

Status: DRAFT — Checkpoint 2 approvals recorded below; source selection still
OPEN pending a readable ultrapc.ma ToS or an official permission/feed.
Date: 2026-10-06. Read-only investigation; no writes to the shared DB.

This document designs a repeatable pipeline that ingests **real** Moroccan
retailer listings into the existing schema, keeps offers fresh, and lets the
engine run on real products.

The single most important finding of this pass: **most of the infrastructure
this pipeline needs already exists.** Migration `007_provenance_tables.sql`
already defines `ingestion_record`, `product_candidate`,
`retailer_listing_alias` and `spec_provenance` — the exact
`SOURCE -> RAW -> NORMALIZE -> MATCH -> REVIEW -> CANONICAL -> PROVENANCE`
flow. All four are empty (0 rows). This design **reuses** them rather than
inventing parallel staging tables.

---

## 1. Verified current state (measured 2026-10-06, read-only)

| Fact | Value / evidence |
|---|---|
| `store_offer` natural key | **None.** `010_reconcile_layer3.sql` drops `uq_store_offer_store_product_variant`; nothing re-adds one. OG-06 root cause. |
| Offers | 101 rows; 100 distinct `product_id`; 2 distinct `store_id` |
| Offers with NULL `product_url` | 101 / 101 |
| Offers with NULL `product_variant_id` | 79 / 101 (the other 22 are GPU variant offers) |
| Duplicates by `(store_id, product_id, product_variant_id)` | **0** (GROUP BY ... HAVING count>1 returned no rows) |
| `price_history` | 101 rows |
| Stores | `Seed NextGamer` and `Seed UltraPC`, both `https://example.ma/...`, currency `MAD`, active |
| Products | 100, all `lifecycle_status = 'ACTIVE'` |
| `lifecycle_status` enum | `ACTIVE, DISCONTINUED, DEVELOPMENT, PRE_RELEASE` (`002_enums.sql:12`) |
| Candidate loader vs lifecycle | filters `p.lifecycle_status = 'ACTIVE'` in all three candidate SQL statements (`src/recommendation/candidates/loader.js:86,110,128`) |
| Staging tables | `ingestion_record` = 0, `product_candidate` = 0, `retailer_listing_alias` = 0, `spec_provenance` = 0 |
| `product_variant.sku` | `UNIQUE` (`003_core_tables.sql:70`) — usable as a matching key |
| `product.manufacturer_part_number` | present, nullable |
| Stage 1 freshness predicate | `o.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'` (`src/recommendation/offers/select.js:70`, Decision 7) |
| Latest migration / seed | `016_og02_og03_memory_and_status.sql` / `012_motherboard_memory_support.sql` |
| `source_type` enum | `OFFICIAL, USER_SUBMITTED, DATASHEET, COMMUNITY, RETAILER` |
| `confidence_level` enum | `CONFIRMED, HIGH, MEDIUM, LOW, UNVERIFIED` |
| Postgres version | **18.6** on the shared DB AND on the TEST branch (confirmed 2026-10-06). The replay scratch DB is created on the same TEST instance, so it is 18.6 too. `NULLS NOT DISTINCT` is available. |

**Doc drift found (report, do not silently fix here):** `AGENTS.md` §7 states
the shared and TEST databases stand at migration **015**, but
`016_og02_og03_memory_and_status.sql` and seed `012` are committed (commit
`fcf40f2`). The migration range cited in `AGENTS.md` §4 is also behind.

**Seed identity observation:** the 100 seed products use display names of the
form `Seed <real model>` (e.g. `Seed DeepCool AG400`,
`Seed Fractal Pop XL`, `Seed NZXT H5 Flow Compact`,
`Seed Noctua NH-U12S SE-AM5`). Several already have **researched, citable
vendor specs** in seeds `009`/`010`/`011`. This is what makes the hybrid seed
strategy in section 7 viable for a documented subset.

---

## 2. OG-06 root cause and offer natural key (migration 017)

### Root cause
Migration `010` deliberately **dropped** `uq_store_offer_store_product_variant`
and added only non-unique indexes. With no key, a re-observed price cannot be
`UPDATE`d safely, so seed 002's header documents the only sound move today:
*a price correction INSERTs a second offer*. That is OG-06.

### Approved key design (revision adopted at Checkpoint 2)
Two scopes, so real offers and legacy seed rows never collide:

1. **Ingested offers — keyed by the retailer-side stable id.** Add
   `store_offer.listing_identifier TEXT` (site SKU, or the canonicalised
   listing URL when no SKU exists). Uniqueness is **scoped per store** because
   `store_id` is the leading column:

   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uq_store_offer_listing
       ON store_offer (store_id, listing_identifier)
       WHERE listing_identifier IS NOT NULL;
   ```

   `store_offer.product_url` is **reused as the source URL** (section 4), so
   `listing_identifier` is the key and `product_url` the human-readable
   provenance — not two URL columns.

2. **Legacy / seed rows — a PARTIAL guard, only where there is no listing id.**
   All 101 current rows have `listing_identifier IS NULL` and `product_url IS
   NULL`. The one-offer-per-variant-per-store cap applies **only** to those:

   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uq_store_offer_legacy_identity
       ON store_offer (store_id, product_id, product_variant_id)
       NULLS NOT DISTINCT
       WHERE listing_identifier IS NULL;
   ```

   Making it partial is deliberate: an ingested offer (non-NULL
   `listing_identifier`) is **not** covered, so a real store may hold more than
   one listing for the same product/variant (re-lists, bundles) without a
   constraint error. `NULLS NOT DISTINCT` is available (Postgres 18.6). The
   COALESCE expression form is a fallback only for a server < 15 — not needed
   here.

**Safe today:** the measured duplicate count is **0**, so both indexes can be
created with no dedup step and no data loss. The plan is preventive. If a
future measurement finds duplicates, fix them with a deterministic keep-one
rule (highest `last_checked_at`, then lowest `id`) inside the migration's
transaction — never a bare `DELETE`.

### Promotion conflict policy (how the key interacts with ingested listings)
Never raise a constraint error. Promotion performs an explicit lookup, then
INSERT or UPDATE:

1. Look up the offer by `(store_id, listing_identifier)` (the ingested key).
   - Found -> UPDATE that row; append one `price_history` row only if `price`
     or `availability` changed (section 3).
   - Not found -> INSERT.
2. Two different listings from the same store mapping to the same variant are
   **allowed** (they have different `listing_identifier`s and are outside the
   partial legacy index). The engine's Stage 1 selection already picks the
   cheapest eligible offer per candidate (`src/recommendation/offers/select.js`),
   so duplicates do not corrupt a build. Listings whose match confidence is
   below MEDIUM go to the review queue instead of becoming offers at all.
3. A new ingested offer for a product/variant that already has a **seed**
   offer does not conflict: the seed row is NULL-id and the new row is
   non-NULL-id, so they sit in different index scopes. The seed offer is not
   silently overwritten.

### Migration 017 — contents (approved, TEST-only until separate go-ahead)
1. `ALTER TABLE store_offer ADD COLUMN IF NOT EXISTS listing_identifier TEXT;`
2. `ALTER TABLE store_offer ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ;`
3. `ALTER TABLE store_offer ADD COLUMN IF NOT EXISTS ingestion_record_id UUID REFERENCES ingestion_record(id);`
4. `ALTER TABLE price_history ADD COLUMN IF NOT EXISTS ingestion_record_id UUID REFERENCES ingestion_record(id);`
5. Backfill: `UPDATE store_offer SET fetched_at = last_checked_at WHERE fetched_at IS NULL;`
6. Index `uq_store_offer_listing` (scope 1) and `uq_store_offer_legacy_identity`
   (scope 2).
7. CRLF, guarded (`IF NOT EXISTS`), ledgered via `run-migrations.js`; single
   application guaranteed by the OG-14 ledger, not the guards.

No row counts change. **Shared-DB application is a separate, explicitly gated
action**, showing the exact SQL and before/after counts first.

---

## 3. `price_history` write policy

`price_history` is append-only by schema design. The promotion path must:

- Append a row **only** when the stored `price` **or** `availability` actually
  changes (exact comparison, no rounding).
- Append **nothing** when a re-fetch returns the same price and availability —
  Idempotency falls out of the change test: running the same ingestion twice
  appends zero rows the second time.
- `NULL` stays `NULL` (a missing availability is not an empty string).
- Every appended row carries `ingestion_record_id`.

`price_history` has no retention rule today (status review K15) — out of scope;
note it, do not invent one.

---

## 4. Offer provenance (approved, trimmed)

- **Source URL** reuses the existing `store_offer.product_url`. No new URL column.
- **`fetched_at TIMESTAMPTZ`** on `store_offer`, set on the fetch that produced
  the current observation. `last_checked_at` keeps its Stage 1 eligibility
  meaning — they are **not** merged, because seed 006 re-stamps
  `last_checked_at` without any fetch, so the semantics genuinely differ.
- **Raw price string** lives in staging (`product_candidate.raw_data` JSONB,
  and/or the adapter fixture), **not** on `store_offer`.
- **`ingestion_record_id`** nullable on **both** `store_offer` and
  `price_history`.
- **`NULL` provenance means seed/unverified, not an error.** A standing gate
  asserts the complement: every non-seed offer has a non-null `product_url`
  AND `ingestion_record_id`.
- Run-level provenance lives in the `ingestion_record` row for the run.

---

## 5. Staging model (reuse migration 007)

No new staging tables:

| Pipeline step | Table | Notes |
|---|---|---|
| A source pulled at a point in time | `ingestion_record` | one row per run; `source_type='RETAILER'`, `status`, `raw_payload_hash` |
| Normalised listing awaiting match | `product_candidate` | `status` `UNREVIEWED/MATCHED/REVIEW/REJECTED/CANONICALIZED`; CHECK forbids `matched_product_id` below confidence MEDIUM |
| Listing -> canonical product mapping | `retailer_listing_alias` | unique `(retailer_name, listing_identifier)`; confidence CHECK >= MEDIUM |
| Spec-value audit trail | `spec_provenance` | unique `(target_table, target_id, target_column, source_type, source_identifier)` |

**Promotion rule:** a scraped listing lands in `product_candidate` first; it is
promoted to `store_offer` only after a confident match produces a
`retailer_listing_alias`. Unmatched or ambiguous listings **never** auto-create
a `product` or a `store_offer`.

---

## 6. Matching and the review queue

Normalisation ladder:
1. Uppercase; trim; collapse whitespace; strip punctuation and vendor
   boilerplate suffixes.
2. Exact `product_variant.sku` match (unique index) -> `CONFIRMED`.
3. Exact `product.manufacturer_part_number` match -> `HIGH`.
4. Normalised model-string match against `product.name` (with the `Seed `
   prefix stripped for comparison) -> `MEDIUM`.
5. Fuzzy/token-overlap only ever proposes -> `LOW`/`UNVERIFIED`.

- `CONFIRMED`/`HIGH`/`MEDIUM` -> may set `matched_product_id`.
- `LOW`/`UNVERIFIED` -> `product_candidate.status = 'REVIEW'` (human queue).
- No existing variant -> a `product_candidate` row + new-product proposal;
  never an INSERT into `product`.

Pure module: normalization + scoring with fixture-driven unit tests covering
exact, ambiguous, and unmatched cases.

---

## 7. Seed replacement strategy — hybrid (APPROVED)

Default: **retire, do not delete.**

- `UPDATE product SET lifecycle_status = 'DISCONTINUED' WHERE name LIKE 'Seed %'`
  for the retired set. No new enum, no new status column.
- **In-place identity correction** only for seed rows with **documented
  evidence** of a verified real model. Candidates are products whose specs were
  already researched from vendor pages in seeds `009`/`010`/`011` (and
  `003`/`005`/`007`/`008`). Each correction cites URL + date accessed; anything
  not re-fetchable is **UNVERIFIED** and is not corrected. (The per-product
  evidence list is produced in the B2 pass; this document does not fabricate it.)
- **No deletion.** The 280 `component_assessment` rows and all compatibility
  data are preserved. All 100 products are `ACTIVE` today; nothing is retired here.

Cutover gate (binding):
1. No shared-DB retirement until a reach check shows real products cover
   **all required engine roles** on the TEST branch.
2. At cutover, seed offers are **expired** (never price-corrected).
3. Verify **every** read path filters `ACTIVE` (today: candidate loader only)
   and add a test that a retired product cannot appear in a run.
4. Seeds remain on the TEST branch as fixtures.
5. Every retirement/correction is recorded for auditability (evidence + date).

---

## 8. Source selection — audit and recommendation

Audit date: **2026-10-06**. Every claim was fetched on that date. Where a page
could not be read in the allowed number of requests, the verdict is
**UNVERIFIED**, never assumed.

| Candidate | robots.txt | Terms of use | Feed / API / affiliate | Prices & stock | Currency / VAT | Engine-role coverage |
|---|---|---|---|---|---|---|
| **iris.ma** (direct) | `User-agent: *` allows `/` except `/api/`; explicitly `Allow: /` for `GPTBot`/`OAI-SearchBot`/`ClaudeBot`/etc. (`Disallow: /api/`) | **PROHIBITED (reproduction)** — CGV art. 11 (Propriété Intellectuelle): "Toute tentative de reproduction est considérée comme étant illégale et frauduleuse" — content is SGM2I property | None found | Server-rendered HTML | MAD, prices TTC (VAT included) | Broad, but see verdict |
| **ultrapc.ma** (direct) | PrestaShop; product/category pages allowed (only controllers/`/app/`/`/js/`/`?search_query=` disallowed) | **UNVERIFIED** — terms/CGV page not located within the allowed requests | PrestaShop; UNVERIFIED feed/affiliate | Server-rendered HTML | MAD | Broad (major Moroccan high-tech retailer) |
| **pcbuilder.ma** (aggregator, 23 retailers) | `User-agent: *` -> `Allow: /`; explicitly allows AI/search bots; `sitemap.xml` | **UNVERIFIED**; also a **direct competitor** of morocco-pc | None published; UNVERIFIED | Server-rendered HTML; shows observation date + price history | MAD (DH) | Broad, but **second-hand** |
| **nextlevelpc.ma** (direct) | **403 Forbidden** on `/robots.txt` | UNVERIFIED and unreachable | — | — | MAD | **DO NOT CRAWL** (robots unreachable) |

### Verdicts
- **iris.ma — do not build a scraper.** Robots permits crawling, but the CGV
  Article 11 IP clause prohibits reproduction of site content, which republishing
  prices would be. Verdict: **PROHIBITED**.
- **ultrapc.ma — cannot proceed yet.** Its ToS/CGV page could not be located;
  **UNVERIFIED**. No adapter until the terms are read and permit the use.
- **pcbuilder.ma — not used.** It competes with morocco-pc directly; depending on
  a competitor for price data risks block/rate-limit/disappearance, and its data
  is second-hand. Only with an explicit licence.
- **nextlevelpc.ma — excluded.** robots unreachable (403); do not work around it.

### Recommendation
**No source is currently cleared to scrape.** Recommended path:
1. **Pursue an official feed / permission** from an ultrapc.ma-type retailer
   (first-hand prices, stable SKUs, licensable) — the durable option.
2. In parallel, **read ultrapc.ma's ToS** (locate the page) before any adapter.
3. **Do not scrape iris.ma** (IP clause) and **do not scrape pcbuilder.ma**
   without a licence (competitor).
4. Proceed now with the **source-independent B2 work** (migration 017, promotion
   library, matching module, CLI, adapter interface) — none of it needs a chosen
   source, and the adapter interface is designed so a licensed source drops in.

---

## 9. Freshness and operations

- Freshness derived from `store_offer.fetched_at` (real fetch time) and the
  retailer's `availability`. `OUT_OF_STOCK` / discontinued represented
  explicitly in `availability` — never by deleting a row.
- **The 30-day Stage 1 window is Decision 7** — changing it or switching the
  predicate to `fetched_at` requires a **new Decision record**. Flagged, not
  changed silently.
- Schedule: a runner periodically fetches each active source, upserts offers,
  appends history on change. Retries with backoff per source; a failed source is
  isolated and reported, not fatal.
- Alerting: `check-offer-freshness.js` becomes the stale-offer alarm, extended
  to real `fetched_at`/`valid_until` semantics, plus an alert when a source's
  markup changes (zero parseable listings where there were many).
- New standing gate: every **non-seed** offer has `product_url` AND
  `ingestion_record_id`.

---

## 10. Assessment dependency (OG-01) — surface to the user

The engine scores from `component_assessment`. New real products arrive with
**no** assessment rows and will score at the flat no-evidence value. The
pipeline ships **data**, not scores. Per new product:

- Reuse `docs/OG-01_ASSESSMENT_RESEARCH_PLAN.md`,
  `docs/OG01_BATCH2_RESEARCH_CHECKLIST.md`,
  `scripts/og01-research-checklist.js`.
- `node scripts/check-og01-coverage.js` stays red while any active product
  lacks assessments.
- Benchmark data may feed assessments only where a citable benchmark exists;
  **no fabricated assessment scores**.

---

## 11. Phased plan and effort

| Phase | Work | Effort |
|---|---|---|
| B1 | This document + source audit | ~1 session |
| B2.1 | Migration 017 — TEST first, `verify:replay`, `run-migrations.js --check`; shared apply gated | ~0.5 session |
| B2.2 | Promotion/upsert library + tests | ~0.5 session |
| B2.3 | Matching module + review queue + tests | ~0.5 session |
| B2.4 | First source adapter + recorded fixtures | ~1 session |
| B2.5 | `scripts/ingest-offers.js` CLI (dry-run default, `--commit`) | ~0.5 session |
| B2.6 | End-to-end on TEST, then shared dry-run diff + approval | ~0.5 session |
| B2.7 | Gates/docs updates | ~0.5 session |
| B2.8 | Decision record | ~0.25 session |

---

## 12. Risks and open questions

1. **No source is cleared to scrape** (iris prohibited, ultrapc unverified,
   pcbuilder is a competitor, nextlevelpc excluded). Source is the critical path.
2. Aggregator dependency is strategically risky (it competes with morocco-pc).
3. Changing the 30-day freshness window is Decision 7 — needs a new Decision.
4. New products score flat until assessments exist (OG-01).
5. ~~`NULLS NOT DISTINCT` requires Postgres 15+~~ **RESOLVED 2026-10-06:** the
   shared server and TEST branch both report **18.6**.
6. Doc drift: `AGENTS.md` claims migrations stop at 015 but 016 exists.

---

## Checkpoint 2 — approvals recorded

- **(i) Offer natural key + migration 017 — APPROVED WITH CONDITIONS.** Conditions
  applied in section 2: PG >= 15 confirmed on shared + TEST (both 18.6); the
  legacy cap is a partial index `WHERE listing_identifier IS NULL`; ingested
  offers are keyed by `UNIQUE (store_id, listing_identifier)` scoped per store;
  a documented promotion policy handles a second listing without a constraint
  error. Proceed on **TEST only**; shared apply needs a separate go-ahead with
  exact SQL and before/after counts.
- **(ii) Seed replacement strategy — APPROVED** (hybrid, section 7).
- **(iii) Source list — HELD.** iris.ma found PROHIBITED (reproduction),
  ultrapc.ma UNVERIFIED, pcbuilder.ma excluded as a competitor, nextlevelpc.ma
  excluded. Recommendation in section 8; awaiting a readable ultrapc.ma ToS or
  an official feed/permission.

Nothing in this document has been applied to the shared database.

> **UPDATE 2026-10-07 — the sentence above was true when written and is not true now.** Migration
> `017_offer_identity_and_provenance.sql` (this document's section 2) WAS applied to the shared
> database on 2026-10-06, and the `schema_migrations` ledger reads 17 on both shared and TEST. The
> original sentence is kept for the record. Still unapplied on shared: section 13's migration
> `018_build_component_offer_provenance.sql` (applied on the TEST branch only) and every seed/data
> change section 7 describes.

## 13. Beta launch: seed-offer freshness

> **UPDATE 2026-10-07 — IMPLEMENTED as Decision 35; the "DESIGN ONLY — not implemented" status this
> heading used to carry is superseded.** Migration `018_build_component_offer_provenance.sql` adds
> `build_component.offer_class` + `store_offer_id`, the default-OFF engine option
> `allow_unverified_seed_offers` waives Decision 7's 30-day window for SEED offers only (VERIFIED
> offers keep it unchanged), and `scripts/check-offer-freshness.js` reports both classes and fails on
> the VERIFIED one. `018` is applied on the TEST branch and still PENDING on shared. The original
> design text follows, unedited, as the record of what was proposed.

Per the task brief, seed offers are NOT re-stamped or extended. This section only proposes.

**What Stage 1 does when offers expire:** `src/recommendation/offers/select.js` filters
`last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'` (Decision 7). Once every
seed offer is older than 30 days the query returns no eligible rows and the stage
throws `EMPTY_CANDIDATE_POOL` — a loud exception, not silent zero builds. `budget_floor`
is computed after Stage 1 and never runs on that path. The 101 seed offers were written
with `last_checked_at = NOW()` and seed 006 re-stamps them; the measured first expiry is
**2026-11-03**, so a beta running on seed data fails loudly after that date unless a
decision is made.

**Proposal (DECIDED 2026-10-06 as Decision 35 — it changed Decision 7's predicate for SEED offers only, through a default-OFF option rather than by editing the window; see the UPDATE at the top of this section):**
1. Classify offers from provenance, not from a new column: an offer with
   `ingestion_record_id IS NULL` is **seed/demo**, an offer with a non-NULL id is
   **verified**. This is already derivable from migration 017.
2. Keep Decision 7's 30-day window unchanged for **verified** offers.
3. Add a beta-scoped rule for **seed/demo** offers (e.g. treat them as non-expiring demo
   data, or require an explicit beta flag), rather than re-stamping the data.
4. Add a gate that reports seed vs verified expiry separately, so the cliff is visible
   and the beta trade-off is explicit.

**Rejected:** re-stamping seed offers to keep the gate green (the brief forbids it, and it
would hide that the prices are unverified); extending the 30-day window for everything
(changes Decision 7 for verified offers too). Not implemented — awaiting the decision.