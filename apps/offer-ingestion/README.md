# @morocco-pc/offer-ingestion

Operator job that turns retailer/operator-supplied listings into Layer 3 rows
(`store`, `store_offer`, `price_history`, `ingestion_record`) plus provenance
review rows. It performs **no** compatibility, scoring, ranking, or assembly
work, and it never touches the recommendation engine's pure modules.

## Ownership (RFC §12, §8)

| Aspect | Decision |
|---|---|
| **Project** | P3 — Offer ingestion (application) |
| **Accountable** | Ingestion owner (name unassigned — see RFC §21.1 A5 safeguard) |
| **Consumes** | Layer 1 identities (`product.slug`, `product_variant.sku`); Layer 3 tables for reads/writes |
| **Depends on** | `@morocco-pc/database-guard` (target digest + restore-point rule); `pg` for SQL execution |
| **Must not import** | `@morocco-pc/recommendation-core`, `@morocco-pc/recommendation-runtime`, or any path under them |
| **Must never** | Write Layer 4 tables; re-implement scoring/ranking; invent a match, price, provenance class, or timestamp; commit outside a caller-owned transaction |

## Boundary rule (enforced)

`apps/offer-ingestion/**` may not require `recommendation-core`, `recommendation-runtime`, or any module beneath them. This is a hard rule — zero inbound engine edges exist today (§6.3) and must stay zero.

## What lives here

| Path | Responsibility |
|---|---|
| `src/adapters/` | Listing parsers (manual today; retailer adapters later) |
| `src/listings.js` | Parse + validate raw listings into normalized rows |
| `src/matching.js` | Identity matching tiers (Tier 0 `CATALOGUE_KEY` wins over SKU/MPN/name) |
| `src/promotion.js` | Class promotion rules (what makes an offer `VERIFIED`) |
| `src/plan.js` | Dry-run plan (reads only) |
| `src/apply.js` | Writes inside a caller-owned transaction |
| `src/run.js` | Orchestration: parse → match → plan → apply |
| `bin/ingest-offers.js` | CLI entry point (dry-run default) |
| `gates/` | `check-offer-provenance.js`, `check-offer-freshness.js`, `check-offer-coverage.js` |
| `test/` | Unit + CLI suites |

## Safety

- Dry-run is the default; `--commit` writes.
- Writes target the isolated TEST branch via `TEST_DATABASE_URL`; the shared `DATABASE_URL` is refused unless explicitly confirmed.
- Every run prints `target:` and, for non-test targets, `AUDIT TARGET: db:<12 hex> restore-point=<id>` before connecting.
- The write-target guard (`@morocco-pc/database-guard`) owns target comparison; this package never re-implements it.

## Related

- RFC §12: Ingestion architecture
- RFC §8.3: Gate ownership (ingestion owns provenance / freshness / coverage)
- Existing implementation (pre-migration): `src/recommendation/ingestion/`, `scripts/ingest-offers.js`, `scripts/check-offer-*.js`
