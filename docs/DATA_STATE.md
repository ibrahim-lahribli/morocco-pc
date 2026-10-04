# Data State (generated)

<!-- GENERATED FILE — do not edit by hand. Regenerate with `npm run gen:schema` (node scripts/gen-schema-reference.js). `--check` exits non-zero when this file is stale. -->

Snapshot of the live database contents at generation time. **Every figure here
is instance-specific** — it describes this database at this moment and must never
be cited as a permanent claim in hand-written docs (cite `CONTEXT.md` status
sections instead, which the audit workflow keeps reconciled).

Retention warning (AGENTS.md section 5): retention ties fall through to random
`product.id` UUIDs, so *which* tied products reach a build is not stable across a
database reset — reach figures below are one instance's draw, not a property of
the catalog.

## Row counts (40 tables)

| Table | Rows |
|---|---|
| `benchmark` | 1 |
| `benchmark_result` | 2 |
| `benchmark_source` | 1 |
| `build_candidate` | 0 |
| `build_component` | 0 |
| `case_motherboard_form_factor` | 27 |
| `case_radiator_support` | 59 |
| `case_spec` | 10 |
| `chipset` | 5 |
| `component_assessment` | 280 |
| `cooler_socket_support` | 21 |
| `cooler_spec` | 9 |
| `cpu_motherboard_support` | 21 |
| `cpu_spec` | 18 |
| `gpu_board_spec` | 22 |
| `gpu_chipset` | 9 |
| `ingestion_record` | 0 |
| `manufacturer` | 31 |
| `memory_type` | 2 |
| `motherboard_spec` | 7 |
| `platform` | 3 |
| `platform_memory_support` | 4 |
| `price_history` | 101 |
| `product` | 100 |
| `product_candidate` | 0 |
| `product_family` | 76 |
| `product_variant` | 22 |
| `psu_spec` | 11 |
| `ram_spec` | 7 |
| `recommendation_profile` | 0 |
| `recommendation_query` | 0 |
| `recommendation_result` | 0 |
| `retailer_listing_alias` | 0 |
| `schema_migrations` | 12 |
| `scoring_model` | 1 |
| `socket` | 3 |
| `spec_provenance` | 0 |
| `ssd_spec` | 17 |
| `store` | 2 |
| `store_offer` | 101 |

## Layer summary

| Layer | Tables | Rows |
|---|---|---|
| 1 — Catalog/Hardware | 7 | 237 |
| 2 — Performance/Assessment | 5 | 285 |
| 3 — Market | 3 | 204 |
| 4 — Recommendation | 5 | 0 |

## Coverage

- Products: 100 (22 variants)
- Assessed products: 99 of 100 (280 assessment rows) — the rest score the flat no-evidence baseline (OG-01)
- Offers: 101 (checked 2026-10-04 04:27:21.455192+00 … 2026-10-04 04:27:21.455192+00)
- GPU variants with NULL width_slots/height_mm: 7 (OG-07)
- PSUs with NULL connector_12vhpwr: 2 (OG-08)
- Layer 4 emptiness: ALL five tables 0 rows (write path proven only on the test branch)

---

*Generated from the live database. Regenerate after any seed or migration:*
`npm run gen:schema`.

