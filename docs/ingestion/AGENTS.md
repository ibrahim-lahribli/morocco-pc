# AGENTS.md — offer ingestion

Scope: offer ingestion as it exists today — `src/recommendation/ingestion/**` and the offer scripts in
`scripts/`. The design is `PIPELINE_DESIGN.md` beside this file (F8 / OG-06). There is no
`apps/offer-ingestion/` package yet; do not create one as part of a documentation task.

## Non-negotiables

- **Never invent, infer or "fix" a price.** An unverified observation stays unverified; the offer
  class records it, and no seed price becomes VERIFIED by re-stamping.
- **An offer is VERIFIED only with all of**: an ingestion record, a listing identifier, an http(s)
  `product_url` whose host belongs to its own store, a `seller_name`, and a non-future `fetched_at`.
  Anything less is not provenance.
- **Identity matching is strict.** Product-keyed offers require `product_variant_id IS NULL`;
  variant-keyed candidates require an exact variant match. No cross-variant fallback.
- **Invalid rows are reported, never dropped or silently corrected.** A refusal is a finding.
- **Freshness is a gate, not an opinion.** Offers age out of the Decision 7 window; a beta on seed data
  fails loud rather than re-stamping to stay green.

## Commands

```bash
node scripts/check-offer-provenance.js          # read-only: does each price have a retailer behind it?
node scripts/check-offer-freshness.js --fail-days=14   # equals form is mandatory
node scripts/ingest-offers.js --dry-run         # validate an import file without writing
```

`check-offer-provenance.js` answers **INCONCLUSIVE** (exit 0) when no non-seed offer exists — never
PASS over a seed catalogue. `check-offer-freshness.js` is likewise INCONCLUSIVE on seeds. Both run
nightly in `recurring-gates`.

## Recipe

`recipes/import-offers.md` — adapter interface, file format, validation, matching, curated identity,
and the refresh procedure. Read it before writing an importer or refreshing the catalog.
