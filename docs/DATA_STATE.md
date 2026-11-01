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

## Row counts (44 tables)

| Table | Rows |
|---|---|
| `benchmark` | 1 |
| `benchmark_result` | 2 |
| `benchmark_source` | 1 |
| `build_candidate` | 8 |
| `build_component` | 64 |
| `build_rejection` | 18 |
| `case_motherboard_form_factor` | 27 |
| `case_radiator_support` | 59 |
| `case_spec` | 10 |
| `chipset` | 8 |
| `component_assessment` | 319 |
| `cooler_socket_support` | 22 |
| `cooler_spec` | 9 |
| `cpu_motherboard_support` | 21 |
| `cpu_spec` | 22 |
| `gpu_board_spec` | 24 |
| `gpu_chipset` | 11 |
| `ingestion_record` | 0 |
| `manufacturer` | 31 |
| `memory_type` | 2 |
| `motherboard_memory_support` | 11 |
| `motherboard_spec` | 11 |
| `platform` | 3 |
| `platform_memory_support` | 4 |
| `price_history` | 114 |
| `product` | 113 |
| `product_candidate` | 0 |
| `product_family` | 84 |
| `product_variant` | 24 |
| `psu_spec` | 11 |
| `ram_spec` | 10 |
| `recommendation_preset` | 0 |
| `recommendation_profile` | 10 |
| `recommendation_query` | 9 |
| `recommendation_result` | 8 |
| `recommendation_swap` | 0 |
| `retailer_listing_alias` | 0 |
| `schema_migrations` | 23 |
| `scoring_model` | 7 |
| `socket` | 3 |
| `spec_provenance` | 0 |
| `ssd_spec` | 17 |
| `store` | 2 |
| `store_offer` | 114 |

## Layer summary

| Layer | Tables | Rows |
|---|---|---|
| 1 — Catalog/Hardware | 7 | 260 |
| 2 — Performance/Assessment | 5 | 330 |
| 3 — Market | 3 | 230 |
| 4 — Recommendation | 5 | 99 |

## Coverage

- Products: 113 (24 variants)
- Assessed products: 112 of 113 (319 assessment rows) — the rest score the flat no-evidence baseline (OG-01)
- Offers: 114 (checked 2026-11-01 00:52:11.013254+00 … 2026-11-01 00:52:13.649048+00)
- GPU variants with NULL width_slots/height_mm: 7 (OG-07)
- PSUs with NULL connector_12vhpwr: 2 (OG-08)
- Layer 4 emptiness: 99 rows present

---

*Generated from the live database. Regenerate after any seed or migration:*
`npm run gen:schema`.

