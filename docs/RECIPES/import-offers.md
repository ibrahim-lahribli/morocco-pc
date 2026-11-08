# Recipe: import and refresh offers

The one path for getting prices into the database. No scraper contacts a retailer: the operator
collects the numbers by hand and imports them from a file. This recipe replaces
`docs/IMPORT_OFFERS.md`, `docs/RECIPES/import-offers-manually.md` and `docs/RECIPES/refresh-offers.md`
(all in `docs/archive/`).

Requires migration 017 (offer natural key + provenance) on the target database.

## Adapter interface

An adapter turns a source into normalized listings. The network seam is a file:

```
parse(text, { format }) -> { rows, errors }
```

`rows` are raw field objects (strings) plus a `__line` number; `errors` are file-level problems
(`{ line, reason }`). The runner then validates, matches, plans and (on commit) writes them:

```
rows -> validateListings -> matchListing -> decidePromotion -> applyPlan
```

The only shipped adapter is `manual` (`src/recommendation/ingestion/adapters/manual.js`).

## File format

CSV (header row required) or JSON (array of objects). Auto-detected, or forced with `--format`.

| Column | Required | Notes |
|---|---|---|
| `source` | yes | adapter name, `manual` |
| `store_name` | yes | must match an existing `store.name` exactly |
| `listing_identifier` | yes | retailer-side stable id (site SKU or canonical URL); the offer key |
| `raw_price` | yes | price exactly as collected (`1 299,00`, `1,299.00`, `1299 MAD`) |
| `currency` | yes | must equal the expected currency (`MAD`) |
| `availability` | yes | free text; `OUT_OF_STOCK` is the engine's sentinel |
| `observed_at` | yes | ISO timestamp; must not be in the future |
| `product_url` | no | source URL (reused as `store_offer.product_url`) |
| `title` | no | listing title, used for matching |
| `sku` | no | retailer SKU, used for matching |
| `mpn` | no | manufacturer part number, used for matching |
| `product_slug` | no | curated catalogue slug (`product.slug`); states the product instead of inferring it |
| `variant_sku` | no | curated variant sku (`product_variant.sku`); required when the slug's product has variants |
| `source_note` | no | where/when the row was collected (stored as provenance) |

An example file ships at `scripts/templates/manual-offers.example.csv`. Every row needs a
`source_note` saying where and when the price was collected.

**Quote any CSV field that contains a comma.** An unquoted `source_note` with commas shifts every
later column, so the row arrives with the wrong `product_slug` and is rejected (measured
2026-11-07, not hypothetical).

## Validation rules (invalid rows are reported, never dropped or fixed)

- required fields present and non-empty;
- price parses and is finite and `> 0` (negatives rejected, spaces are thousands separators, a single
  `,`/`.` with 1-2 trailing digits is a decimal);
- `store_name` is a known store (`UNKNOWN_STORE`);
- `currency` equals the expected currency (`UNKNOWN_CURRENCY`);
- `observed_at` is parseable and not in the future (`OBSERVED_AT_IN_FUTURE`);
- no duplicate `listing_identifier` within the file (`DUPLICATE_LISTING_IDENTIFIER`).

Each rejected row is reported with its line number and every failing `field:reason`.

## Matching

Tiers, highest first:

1. `product_slug` (plus `variant_sku` when the product has variants) exact -> `CONFIRMED`, reason
   `CATALOGUE_KEY`. The operator asserted the identity and nothing is inferred.
2. `sku` exact -> `CONFIRMED` (`SKU_EXACT`).
3. `mpn` exact -> `HIGH` (`MPN_EXACT`).
4. normalized model-string containment -> `MEDIUM` (`NAME_CONTAINS`).

Ambiguous or unmatched listings are written to `product_candidate` with status `REVIEW` — they
**never** auto-create a product and never become offers.

### Curated identity: what a refusal means

A curated row that cannot be resolved is REJECTED — it never falls back to inference and never
becomes an offer. Each reason names a different mistake:

| Reason | What it means |
|---|---|
| `UNKNOWN_PRODUCT_SLUG` | no ACTIVE product carries that slug: a typo, or a product that is inactive (the two are indistinguishable here) |
| `VARIANT_SKU_REQUIRED` | the slug's product HAS variants and no `variant_sku` was given; a product-keyed GPU offer can never be selected by the engine |
| `UNKNOWN_VARIANT_SKU` | no variant with that sku under that product — a sku belonging to another product is refused too |
| `VARIANT_SKU_AMBIGUOUS` | more than one variant matched inside that product: a catalogue defect, not a choice the importer may make |
| `VARIANT_SKU_WITHOUT_SLUG` | a `variant_sku` was given with no `product_slug`; a variant sku only means something within its product |
| `OFFER_IDENTITY_MISMATCH` | `(store_name, listing_identifier)` already has an offer on a DIFFERENT product or variant. The stored offer is left untouched, so correct the key or remove the old offer deliberately, then re-run |

Whitespace and case: the listing's `product_slug` and `variant_sku` are trimmed at validation, and
`variant_sku` is also trimmed against the catalogue value. Matching is otherwise exact and
case-sensitive — slugs are lowercase kebab-case by the `chk_product_slug_format` CHECK, so an
upper-case slug is refused as unknown rather than silently rewritten.

### Curated rows need a second reviewer

A curated key is trusted at `CONFIRMED`: a wrong-but-VALID slug associates a real price with the
wrong product, and no gate catches that. Before `--commit`, every row carrying `product_slug` must
be checked by a second person against the retailer page — the slug, the variant, the price and
the `product_url` must all describe the same listing. Record who checked in `source_note`.

### Worked examples

Two rows of one file. The slugs are illustrative — take the real ones from the catalogue — and
`example.test` is a placeholder, because a real `product_url` must be on that store's own host
(the provenance gate checks it):

```csv
source,store_name,listing_identifier,product_url,raw_price,currency,availability,observed_at,title,sku,mpn,product_slug,variant_sku,source_note
manual,Seed UltraPC,GPU-4060-1,https://example.test/gpu-4060-1,3299,MAD,IN_STOCK,2026-11-07T10:00:00Z,NVIDIA RTX 4060 8GB,GPU-4060-1,,seed-rtx-4060-8gb,SEED-GPU-4060,"collected 2026-11-07 by A, checked by B"
manual,Seed UltraPC,MB-B550M-1,https://example.test/mb-b550m-1,899,MAD,IN_STOCK,2026-11-07T10:05:00Z,MSI B550M PRO-VDH,MB-B550M-1,,seed-b550m-pro-vdh,,"collected 2026-11-07 by A, checked by B"
```

The GPU row carries `variant_sku` because its product has variants; the board row leaves it empty
because a product with no variants is product-keyed. The last field is quoted because it contains
commas — that is the rule, not decoration.

## The refresh discipline

A refresh is the same path as an import; what differs is the discipline around it. Do these in order.

1. **Collect by hand, one file per retailer per sweep,** and set `observed_at` to the moment you READ
   the page, not the moment you write the file. Fill `product_url` with the listing page ON that
   retailer's own host, `seller_name` with the seller the price belongs to, and
   `listing_identifier` with the retailer's stable key. The importer accepts a row without them; the
   provenance gate does not, which is deliberate - those three fields are what make a price checkable.
2. **Dry-run (read-only):** `node scripts/ingest-offers.js --adapter=manual --file=<path> --test-db`.
   Check the counts and the per-row detail; fix any `REJECTED` lines.
3. **Commit to the TEST branch first:**
   `node scripts/ingest-offers.js --adapter=manual --file=<path> --commit --test-db`.
4. **Re-run step 3 unchanged:** expect `unchanged: N`, `inserted 0`. That is the idempotency proof.
5. **Confirm the engine still runs on the branch:** `node scripts/test-orchestrator-full-run.js` and
   `node scripts/measure-orchestrator.js`.
6. **Verify provenance and freshness on the same target:** `node scripts/check-offer-provenance.js`
   (PASS means every non-seed offer has a retailer page, a seller, a listing id, a matching store host
   and a timestamped observation) and `node scripts/check-offer-freshness.js`. Both accept
   `--target=env:NAME`, e.g. `--target=env:TARGET_DATABASE_URL` for the EU database.
7. **Clean up probe rows** (`price_history`, `spec_provenance`, `product_candidate`, `store_offer`,
   `ingestion_record`) and confirm residue is 0.
8. **Shared or production:** `--commit` against `DATABASE_URL` is REFUSED unless `--confirm-shared`
   is passed, and should only run once the owner has approved the write. Show the dry-run diff first.

## Release import: the EU database (a NAMED target, never an exported variable)

The EU database is named, never exported. Overriding `DATABASE_URL` in a shell is the footgun: it is
the variable every other tool in that shell reads, so one typo points the importer AND the next
command at the wrong database with nothing checking either.

1. **Dry-run against the named variable** (read-only is still the default):
   `node -r dotenv/config scripts/ingest-offers.js --adapter=manual --file=<path> \
     --target-env=TARGET_DATABASE_URL`
   `.env.eu` is NOT loaded by a bare `node scripts/...`; preload it with `-r dotenv/config` and
   `DOTENV_CONFIG_PATH=.env.eu`, or export the variable for that one command only.
2. **Read the lines the run prints BEFORE it connects:** `target: TARGET_DATABASE_URL (db:<12 hex>)`
   and `AUDIT TARGET: db:<12 hex>`. The digest must be the EU digest already recorded in
   `database/migration-applies.jsonl`; a different digest means stop. No host is ever printed.
3. **Commit with the rollback named:**
   `... --commit --target-env=TARGET_DATABASE_URL --restore-point=<neon-restore-point>`
   `--commit` against a named target is REFUSED without a restore point matching
   `^[A-Za-z0-9_-]{8,}$`, and a target whose digest equals the shared database's is refused whatever
   the variable is called. `--test-db` with `--target-env`, and `--confirm-shared` with
   `--target-env`, are refused as CONFLICTS rather than resolved by precedence, and a
   `--restore-point` with no named target is refused too: a restore point nothing reads is not a
   rollback plan.
4. **Regenerate the preset shelf on the SAME target,** or the API serves no presets for the new
   catalog version:
   `node scripts/generate-presets.js --target-env=TARGET_DATABASE_URL --restore-point=<id>`
5. **Verify on the same target:** `check-offer-provenance.js --target=env:TARGET_DATABASE_URL`
   (retailer evidence per offer) and `check-offer-coverage.js --target=env:TARGET_DATABASE_URL`
   (per-role eligible VERIFIED offers and distinct stores), both read-only.
   `check-offer-freshness.js` still reads `DATABASE_URL` only.

### The expected empty-shelf window

An import changes the catalog, so the next preset read computes a NEW `catalog_version`. Every stored
preset carries the OLD one and `SELECT_PRESETS_SQL` matches on plain equality, so that use
case/currency answers EMPTY from the import commit until `generate-presets` has written the new rows.
The window is bounded by that one regeneration run, not by the import: on EU the last measured shelf
regeneration spanned 161.5 s for 52 presets (2026-11-03T23:30:09Z -> 23:32:50Z). Do not fill it by
serving old-version presets - a preset points at a committed pass whose prices are the old
catalog's.

## What the write records

`store_offer.fetched_at` and `last_checked_at` both become the row's `observed_at`;
`ingestion_record_id` ties the row to the run that wrote it; `spec_provenance` records where it came
from. `price_history` appends an `observed_at` row only when the price or the availability CHANGED, so
a new offer's first observation lives on the offer row itself - an empty history is "no change yet",
not "never observed".

**Until `check-offer-provenance.js` reports PASS, these offers are not verified,** and nothing
user-facing may describe them as recently checked. Its INCONCLUSIVE verdict is today's state (114 seed
offers, none with retailer provenance), and the API's `price_status` reports `verified` only when every
offer behind a price is `VERIFIED`.

## The freshness cliff (OG-30)

Stage 1 hard-filters `store_offer.last_checked_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`
(`src/recommendation/offers/select.js`, Decision 7). Seeds 001/002 wrote `last_checked_at = NOW()`
once; nothing refreshes it. Unrenewed, queries fail with `EMPTY_CANDIDATE_POOL` once all rows are
stale. Seed 006 re-stamps the timestamp without touching prices (OG-37 stays open by design).

1. Check the cliff: `node scripts/check-offer-freshness.js` (read-only; exit 1 when offers are expired
   or the first expiry is near). CI uses `--fail-days=14` - the EQUALS form is mandatory.
2. Dry-run: `node scripts/run-seeds.js --dry-run` (006 must appear; the naive `split(';')` count is
   approximate when comments hold semicolons).
3. Branch-first: apply 006 to `TEST_DATABASE_URL`, then `node scripts/test-orchestrator-full-run.js`
   green before touching shared.
4. Apply to the shared DB (`npm run seed` applies all seeds in order; 006 only touches `Seed %` rows
   older than 7 days, so it is a no-op for fresh rows). Never UPDATE price/currency/availability here -
   a price correction INSERTs a second offer. Never append `price_history` rows on a no-change refresh.
5. `npm run gen:schema`, then `node scripts/verify-docs.js --live` and
   `node scripts/check-offer-freshness.js` (expect PASS, blackout ~+30d).

Since Decision 35 the gate reports two provenance classes (`SEED_UNVERIFIED` =
`ingestion_record_id IS NULL`, `VERIFIED` = non-NULL) and fails on the VERIFIED class ONLY, so the
PASS line is about verified offers once real ingestion exists. A stale SEED class is a WARN, not a
failure: a beta can keep running by passing `options.allow_unverified_seed_offers` to the orchestrator
(`runRecommendationFullRun(client, queryId, { allow_unverified_seed_offers: true })`), default OFF.
Re-stamping seed 006 is still the cure, and re-stamping is never allowed to touch prices.

## Verify

```bash
node scripts/ingest-offers.js --adapter=manual --file=<path> --test-db
node scripts/check-offer-provenance.js
node scripts/check-offer-freshness.js --fail-days=14
npm run test:unit
npm run test:scripts
node scripts/verify-docs.js --offline
```

Never edit an existing migration; the offer key lives in migration 017. Never write to the shared
`DATABASE_URL` without the owner's explicit approval.
