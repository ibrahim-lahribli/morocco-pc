# Importing offers (manual adapter)

The beta runs on the data already in the database. When real prices are needed,
the operator collects them **by hand** and imports them from a file — no scraper
contacts any retailer. This document defines the adapter interface, the file
format, and the validation rules.

## Adapter interface

An adapter turns a source into normalized listings. The network seam is a file:

```
parse(text, { format }) -> { rows, errors }
```

`rows` are raw field objects (strings) plus a `__line` number; `errors` are
file-level problems (`{ line, reason }`). The runner then validates, matches,
plans and (on commit) writes them:

```
rows -> validateListings -> matchListing -> decidePromotion -> applyPlan
```

The only shipped adapter is `manual` (`src/recommendation/ingestion/adapters/manual.js`).

## File format

CSV (header row required) or JSON (array of objects). Auto-detected, or forced
with `--format`.

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
| `source_note` | no | where/when the row was collected (stored as provenance) |

An example file ships at `scripts/templates/manual-offers.example.csv`.

## Validation rules (invalid rows are reported, never dropped or fixed)

- required fields present and non-empty;
- price parses and is finite and `> 0` (negatives rejected, spaces are thousands
  separators, a single `,`/`.` with 1-2 trailing digits is a decimal);
- `store_name` is a known store (`UNKNOWN_STORE`);
- `currency` equals the expected currency (`UNKNOWN_CURRENCY`);
- `observed_at` is parseable and not in the future (`OBSERVED_AT_IN_FUTURE`);
- no duplicate `listing_identifier` within the file
  (`DUPLICATE_LISTING_IDENTIFIER`).

Each rejected row is reported with its line number and every failing
`field:reason`.

## Matching

`sku` exact → `CONFIRMED`; `mpn` exact → `HIGH`; normalized model-string
containment → `MEDIUM`. Ambiguous or unmatched listings are written to
`product_candidate` with status `REVIEW` — they **never** auto-create a product
and never become offers.

## CLI

```bash
# dry-run (default): read-only, prints the diff
node scripts/ingest-offers.js --adapter=manual --file=<path>

# commit to the isolated test branch
node scripts/ingest-offers.js --adapter=manual --file=<path> --commit --test-db

# commit to the shared DB — refused unless explicitly confirmed
node scripts/ingest-offers.js --adapter=manual --file=<path> --commit --confirm-shared
```

The dry-run prints `new / changed / unchanged / unmatched / ambiguous /
rejected` counts plus one line per row. `--commit` against the shared
`DATABASE_URL` requires `--confirm-shared`; without it the CLI refuses and
writes nothing.

## Idempotency

A re-run of the same file writes nothing: unchanged offers produce no
statements, and `price_history` gains a row only when `price` or `availability`
actually changed. Proof: `docs/RECIPES/import-offers-manually.md`.
