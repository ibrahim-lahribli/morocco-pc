# Schema Reference (generated)

<!-- GENERATED FILE — do not edit by hand. Regenerate with `npm run gen:schema` (node scripts/gen-schema-reference.js). `--check` exits non-zero when this file is stale. -->

Column-level truth for every table in the `public` schema, generated from the
live database (`information_schema` / `pg_catalog`). Per `AGENTS.md` section 9,
`database/migrations/*.sql` remains the authoritative source; this file is a
generated lookup so "does this column exist?" never requires reading 11 SQL files
(the question that produced audit finding D2).

<!-- schema-digest: f1daa82f581a25d9 -->

## Enum vocabularies (14)

| Enum | Values |
|---|---|
| `assessment_type` | PERFORMANCE \| VALUE \| QUALITY \| UPGRADEABILITY \| THERMALS \| EFFICIENCY |
| `compatibility_status` | PASS \| FAIL \| UNKNOWN \| CONDITIONAL |
| `component_role` | CPU \| GPU \| MOTHERBOARD \| RAM \| SSD_BOOT \| SSD_SECONDARY \| PSU \| CASE \| CPU_COOLER |
| `confidence_level` | CONFIRMED \| HIGH \| MEDIUM \| LOW \| UNVERIFIED |
| `cooling_type` | AIR \| LIQUID \| PASSIVE \| HYBRID |
| `lifecycle_status` | ACTIVE \| DISCONTINUED \| DEVELOPMENT \| PRE_RELEASE |
| `motherboard_form_factor` | ATX \| MICRO_ATX \| MINI_ITX \| E_ATX \| XL_ATX \| MINI_STX \| DTX \| ITX \| NANO_ITX \| PICO_ITX |
| `product_category` | CPU \| MOTHERBOARD \| MEMORY \| GPU \| STORAGE \| PSU \| CASE \| COOLER |
| `product_variant_type` | STANDARD \| OEM \| BUNDLE \| REFURBISHED \| LIMITED |
| `psu_form_factor` | ATX \| SFX \| SFX_L \| TFX \| FLEX_ATX \| LFX |
| `psu_modularity` | FULLY_MODULAR \| SEMI_MODULAR \| NON_MODULAR |
| `source_type` | OFFICIAL \| USER_SUBMITTED \| DATASHEET \| COMMUNITY \| RETAILER |
| `ssd_form_factor` | M_2_2280 \| M_2_2242 \| M_2_2260 \| M_2_22110 \| SATA_25 \| SATA_35 \| U_2 \| PCIE_CARD \| MSATA \| NGFF |
| `support_status` | ACTIVE \| DISCONTINUED \| END_OF_LIFE |

## Tables (41)

### `benchmark` (17 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `benchmark_source_id` | uuid | NO |  |
| `name` | text | NO |  |
| `game_name` | text | YES |  |
| `workload_type` | text | YES |  |
| `resolution_width` | integer | YES |  |
| `resolution_height` | integer | YES |  |
| `preset` | text | YES |  |
| `ray_tracing_enabled` | boolean | YES |  |
| `upscaling_technology` | text | YES |  |
| `upscaling_mode` | text | YES |  |
| `frame_generation_enabled` | boolean | YES |  |
| `game_version` | text | YES |  |
| `benchmark_method` | text | YES |  |
| `notes` | text | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `benchmark_benchmark_source_id_fkey`: `benchmark_source_id` → `benchmark_source.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_benchmark_resolution_height_positive` — CHECK ((resolution_height > 0))
- `chk_benchmark_resolution_width_positive` — CHECK ((resolution_width > 0))

**Indexes:** `benchmark_pkey` · `idx_benchmark_source_id`

### `benchmark_result` (14 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `benchmark_id` | uuid | NO |  |
| `product_id` | uuid | NO |  |
| `metric_name` | text | NO |  |
| `metric_value` | numeric | NO |  |
| `metric_unit` | text | NO |  |
| `sample_size` | integer | YES |  |
| `minimum_value` | numeric | YES |  |
| `maximum_value` | numeric | YES |  |
| `percentile_1` | numeric | YES |  |
| `percentile_01` | numeric | YES |  |
| `notes` | text | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `benchmark_result_benchmark_id_fkey`: `benchmark_id` → `benchmark.id` (ON DELETE NO ACTION) · `benchmark_result_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_benchmark_result_maximum_ge_value` — CHECK (((maximum_value IS NULL) OR (metric_value IS NULL) OR (maximum_value >= metric_value)))
- `chk_benchmark_result_metric_value_finite` — CHECK ((metric_value IS NOT NULL))
- `chk_benchmark_result_minimum_le_value` — CHECK (((minimum_value IS NULL) OR (metric_value IS NULL) OR (minimum_value <= metric_value)))
- `chk_benchmark_result_percentile_01_le_value` — CHECK (((percentile_01 IS NULL) OR (metric_value IS NULL) OR (percentile_01 <= metric_value)))
- `chk_benchmark_result_percentile_1_le_value` — CHECK (((percentile_1 IS NULL) OR (metric_value IS NULL) OR (percentile_1 <= metric_value)))
- `chk_benchmark_result_sample_size_positive` — CHECK ((sample_size > 0))

**UNIQUE constraints:** `uq_benchmark_result_benchmark_product_metric`

**Indexes:** `benchmark_result_pkey` · `idx_benchmark_result_benchmark_id` · `idx_benchmark_result_product_id` · `uq_benchmark_result_benchmark_product_metric`

### `benchmark_source` (8 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `name` | text | NO |  |
| `organization` | text | YES |  |
| `url` | text | YES |  |
| `methodology_notes` | text | YES |  |
| `source_type` | USER-DEFINED | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Indexes:** `benchmark_source_pkey` · `idx_benchmark_source_name`

### `build_candidate` (6 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `recommendation_query_id` | uuid | NO |  |
| `total_price` | numeric | YES |  |
| `compatibility_status` | USER-DEFINED | NO | 'UNKNOWN'::compatibility_status |
| `score` | numeric | YES |  |
| `created_at` | timestamp with time zone | NO | now() |

**Foreign keys:** `build_candidate_recommendation_query_id_fkey`: `recommendation_query_id` → `recommendation_query.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_build_candidate_score_range` — CHECK (((score IS NULL) OR ((score >= (0)::numeric) AND (score <= (100)::numeric))))
- `chk_build_candidate_total_price_positive` — CHECK (((total_price IS NULL) OR (total_price > (0)::numeric)))

**Indexes:** `build_candidate_pkey` · `idx_build_candidate_recommendation_query_id`

### `build_component` (11 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `build_candidate_id` | uuid | NO |  |
| `product_id` | uuid | NO |  |
| `product_variant_id` | uuid | YES |  |
| `component_role` | USER-DEFINED | NO |  |
| `selected_price` | numeric | NO |  |
| `currency` | text | NO |  |
| `store_id` | uuid | YES |  |
| `price_checked_at` | timestamp with time zone | YES |  |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |

**Foreign keys:** `build_component_build_candidate_id_fkey`: `build_candidate_id` → `build_candidate.id` (ON DELETE NO ACTION) · `build_component_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION) · `build_component_product_variant_id_fkey`: `product_variant_id` → `product_variant.id` (ON DELETE NO ACTION) · `build_component_store_id_fkey`: `store_id` → `store.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_build_component_selected_price_positive` — CHECK ((selected_price > (0)::numeric))
- `chk_build_component_store_requires_checked_at` — CHECK (((store_id IS NULL) OR (price_checked_at IS NOT NULL)))

**Indexes:** `build_component_pkey` · `idx_build_component_build_candidate_id` · `idx_build_component_product_id` · `idx_build_component_product_variant_id` · `idx_build_component_store_id` · `uq_build_component_role_singular`

### `build_rejection` (9 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `recommendation_query_id` | uuid | NO |  |
| `component_role` | USER-DEFINED | NO |  |
| `product_id` | uuid | NO |  |
| `product_variant_id` | uuid | YES |  |
| `partner_product_id` | uuid | YES |  |
| `partner_product_variant_id` | uuid | YES |  |
| `reason_code` | text | NO |  |
| `created_at` | timestamp with time zone | NO | now() |

**Foreign keys:** `build_rejection_partner_product_id_fkey`: `partner_product_id` → `product.id` (ON DELETE CASCADE) · `build_rejection_partner_product_variant_id_fkey`: `partner_product_variant_id` → `product_variant.id` (ON DELETE CASCADE) · `build_rejection_product_id_fkey`: `product_id` → `product.id` (ON DELETE CASCADE) · `build_rejection_product_variant_id_fkey`: `product_variant_id` → `product_variant.id` (ON DELETE CASCADE) · `build_rejection_recommendation_query_id_fkey`: `recommendation_query_id` → `recommendation_query.id` (ON DELETE CASCADE)

**CHECK constraints:**

- `chk_build_rejection_partner_pair_complete` — CHECK ((((partner_product_id IS NULL) AND (partner_product_variant_id IS NULL)) OR ((partner_product_id IS NOT NULL) AND (partner_product_variant_id IS NOT NULL))))
- `chk_build_rejection_reason_not_blank` — CHECK ((btrim(reason_code) <> ''::text))

**Indexes:** `build_rejection_pkey` · `idx_build_rejection_query` · `idx_build_rejection_role_reason`

### `case_motherboard_form_factor` (5 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `case_product_id` | uuid | NO |  |
| `form_factor` | USER-DEFINED | NO |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `case_motherboard_form_factor_case_product_id_fkey`: `case_product_id` → `product.id` (ON DELETE NO ACTION)

**Indexes:** `case_motherboard_form_factor_pkey` · `idx_case_mb_form_factor`

### `case_radiator_support` (6 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `case_product_id` | uuid | NO |  |
| `radiator_size_mm` | integer | NO |  |
| `position` | text | NO |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `case_radiator_support_case_product_id_fkey`: `case_product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_case_radiator_size_positive` — CHECK ((radiator_size_mm > 0))

**Indexes:** `case_radiator_support_pkey` · `idx_case_radiator_support`

### `case_spec` (8 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `product_id` 🔑 | uuid | NO |  |
| `max_gpu_length_mm` | integer | YES |  |
| `max_gpu_thickness_slots` | integer | YES |  |
| `max_cpu_cooler_height_mm` | integer | YES |  |
| `psu_form_factor` | USER-DEFINED | YES |  |
| `max_psu_length_mm` | integer | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `case_spec_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_case_max_cpu_cooler_height_positive` — CHECK ((max_cpu_cooler_height_mm > 0))
- `chk_case_max_gpu_length_positive` — CHECK ((max_gpu_length_mm > 0))
- `chk_case_max_gpu_thickness_positive` — CHECK ((max_gpu_thickness_slots > 0))
- `chk_case_max_psu_length_positive` — CHECK ((max_psu_length_mm > 0))

**Indexes:** `case_spec_pkey`

### `chipset` (4 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `manufacturer_id` | uuid | NO |  |
| `name` | text | NO |  |
| `created_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `chipset_manufacturer_id_fkey`: `manufacturer_id` → `manufacturer.id` (ON DELETE NO ACTION)

**Indexes:** `chipset_pkey` · `idx_chipset_manufacturer_name`

### `component_assessment` (12 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `product_id` | uuid | NO |  |
| `assessment_type` | USER-DEFINED | NO |  |
| `score` | numeric | YES |  |
| `rating` | text | YES |  |
| `summary` | text | YES |  |
| `rationale` | text | YES |  |
| `confidence` | USER-DEFINED | YES |  |
| `source_type` | USER-DEFINED | YES |  |
| `assessed_at` | timestamp without time zone | NO |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `component_assessment_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_component_assessment_score_range` — CHECK (((score IS NULL) OR ((score >= (0)::numeric) AND (score <= (100)::numeric))))

**Indexes:** `component_assessment_pkey` · `idx_component_assessment_product_id` · `idx_component_assessment_type`

### `cooler_socket_support` (7 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `cooler_product_id` | uuid | NO |  |
| `socket_id` | uuid | NO |  |
| `support_status` | USER-DEFINED | NO |  |
| `mounting_note` | text | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `cooler_socket_support_cooler_product_id_fkey`: `cooler_product_id` → `product.id` (ON DELETE NO ACTION) · `cooler_socket_support_socket_id_fkey`: `socket_id` → `socket.id` (ON DELETE NO ACTION)

**Indexes:** `cooler_socket_support_pkey` · `idx_cooler_socket_support`

### `cooler_spec` (9 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `product_id` 🔑 | uuid | NO |  |
| `cooling_type` | USER-DEFINED | YES |  |
| `max_tdp_watts` | integer | YES |  |
| `height_mm` | integer | YES |  |
| `length_mm` | integer | YES |  |
| `width_mm` | integer | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |
| `radiator_size_mm` | integer | YES |  |

**Foreign keys:** `cooler_spec_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_cooler_height_positive` — CHECK ((height_mm > 0))
- `chk_cooler_length_positive` — CHECK ((length_mm > 0))
- `chk_cooler_max_tdp_positive` — CHECK ((max_tdp_watts > 0))
- `chk_cooler_radiator_size_positive` — CHECK ((radiator_size_mm > 0))
- `chk_cooler_width_positive` — CHECK ((width_mm > 0))

**Indexes:** `cooler_spec_pkey`

### `cpu_motherboard_support` (9 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `motherboard_product_id` | uuid | NO |  |
| `cpu_product_family_id` | uuid | YES |  |
| `cpu_product_id` | uuid | YES |  |
| `support_status` | USER-DEFINED | NO |  |
| `min_bios_version` | text | YES |  |
| `source_note` | text | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `cpu_motherboard_support_cpu_product_family_id_fkey`: `cpu_product_family_id` → `product_family.id` (ON DELETE NO ACTION) · `cpu_motherboard_support_cpu_product_id_fkey`: `cpu_product_id` → `product.id` (ON DELETE NO ACTION) · `cpu_motherboard_support_motherboard_product_id_fkey`: `motherboard_product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_cpu_motherboard_specificity` — CHECK ((((cpu_product_family_id IS NOT NULL) AND (cpu_product_id IS NULL)) OR ((cpu_product_family_id IS NULL) AND (cpu_product_id IS NOT NULL))))

**Indexes:** `cpu_motherboard_support_pkey` · `idx_cpu_mb_support_cpu` · `idx_cpu_mb_support_family`

### `cpu_spec` (16 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `product_id` 🔑 | uuid | NO |  |
| `socket_id` | uuid | NO |  |
| `cores` | integer | YES |  |
| `threads` | integer | YES |  |
| `base_clock_mhz` | integer | YES |  |
| `boost_clock_mhz` | integer | YES |  |
| `tdp_watts` | integer | YES |  |
| `pbp_mtp_watts` | integer | YES |  |
| `memory_channels` | integer | YES |  |
| `max_official_memory_speed_mtps` | integer | YES |  |
| `pcie_generation` | integer | YES |  |
| `integrated_gpu_present` | boolean | YES |  |
| `integrated_gpu_model` | text | YES |  |
| `package_note` | text | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `cpu_spec_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION) · `cpu_spec_socket_id_fkey`: `socket_id` → `socket.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_cpu_boost_ge_base` — CHECK (((boost_clock_mhz IS NULL) OR (base_clock_mhz IS NULL) OR (boost_clock_mhz >= base_clock_mhz)))
- `chk_cpu_cores_positive` — CHECK ((cores > 0))
- `chk_cpu_max_mem_speed_positive` — CHECK ((max_official_memory_speed_mtps > 0))
- `chk_cpu_memory_channels_positive` — CHECK ((memory_channels > 0))
- `chk_cpu_pbp_mtp_positive` — CHECK ((pbp_mtp_watts > 0))
- `chk_cpu_pcie_generation_positive` — CHECK ((pcie_generation > 0))
- `chk_cpu_tdp_positive` — CHECK ((tdp_watts > 0))
- `chk_cpu_threads_ge_cores` — CHECK (((threads IS NULL) OR (cores IS NULL) OR (threads >= cores)))

**Indexes:** `cpu_spec_pkey`

### `gpu_board_spec` (10 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `product_variant_id` 🔑 | uuid | NO |  |
| `gpu_chipset_id` | uuid | NO |  |
| `board_tgp_watts` | integer | YES |  |
| `length_mm` | integer | YES |  |
| `width_slots` | numeric(4,2) | YES |  |
| `height_mm` | integer | YES |  |
| `required_power_connectors` | jsonb | YES |  |
| `recommended_psu_watts` | integer | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `gpu_board_spec_gpu_chipset_id_fkey`: `gpu_chipset_id` → `gpu_chipset.id` (ON DELETE NO ACTION) · `gpu_board_spec_product_variant_id_fkey`: `product_variant_id` → `product_variant.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_gpu_board_height_positive` — CHECK ((height_mm > 0))
- `chk_gpu_board_length_positive` — CHECK ((length_mm > 0))
- `chk_gpu_board_recommended_psu_positive` — CHECK ((recommended_psu_watts > 0))
- `chk_gpu_board_tgp_positive` — CHECK ((board_tgp_watts > 0))
- `chk_gpu_board_width_slots_positive` — CHECK ((width_slots > (0)::numeric))

**Indexes:** `gpu_board_spec_pkey`

### `gpu_chipset` (9 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `manufacturer_id` | uuid | NO |  |
| `name` | text | NO |  |
| `vram_capacity_gb` | integer | YES |  |
| `vram_type` | text | YES |  |
| `memory_bus_width_bit` | integer | YES |  |
| `pcie_interface` | text | YES |  |
| `base_tgp_watts` | integer | YES |  |
| `created_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `gpu_chipset_manufacturer_id_fkey`: `manufacturer_id` → `manufacturer.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_gpu_chipset_base_tgp_positive` — CHECK ((base_tgp_watts > 0))
- `chk_gpu_chipset_memory_bus_positive` — CHECK ((memory_bus_width_bit > 0))
- `chk_gpu_chipset_vram_capacity_positive` — CHECK ((vram_capacity_gb > 0))

**Indexes:** `gpu_chipset_pkey` · `idx_gpu_chipset_manufacturer_name`

### `ingestion_record` (9 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `source_type` | USER-DEFINED | NO |  |
| `source_identifier` | text | NO |  |
| `status` | text | NO |  |
| `record_count` | integer | YES |  |
| `raw_payload_hash` | text | YES |  |
| `started_at` | timestamp without time zone | NO | now() |
| `completed_at` | timestamp without time zone | YES |  |
| `error_message` | text | YES |  |

**CHECK constraints:**

- `chk_ingestion_status` — CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'COMPLETED'::text, 'FAILED'::text, 'CANCELLED'::text])))

**Indexes:** `idx_ingestion_source` · `idx_ingestion_status` · `ingestion_record_pkey`

### `manufacturer` (5 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `name` | text | NO |  |
| `website` | text | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Indexes:** `idx_manufacturer_name` · `manufacturer_pkey`

### `memory_type` (3 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `name` | text | NO |  |
| `created_at` | timestamp without time zone | NO | now() |

**Indexes:** `idx_memory_type_name` · `memory_type_pkey`

### `motherboard_spec` (17 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `product_id` 🔑 | uuid | NO |  |
| `socket_id` | uuid | NO |  |
| `chipset_id` | uuid | NO |  |
| `form_factor` | USER-DEFINED | YES |  |
| `memory_type_id` | uuid | NO |  |
| `dimm_slots` | integer | YES |  |
| `max_memory_capacity_gb` | integer | YES |  |
| `official_memory_speed_min_mtps` | integer | YES |  |
| `official_memory_speed_max_mtps` | integer | YES |  |
| `pcie_x16_slots` | integer | YES |  |
| `pcie_slot_generation` | integer | YES |  |
| `m2_slots` | integer | YES |  |
| `sata_ports` | integer | YES |  |
| `wifi_present` | boolean | YES |  |
| `bios_notes` | text | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `motherboard_spec_chipset_id_fkey`: `chipset_id` → `chipset.id` (ON DELETE NO ACTION) · `motherboard_spec_memory_type_id_fkey`: `memory_type_id` → `memory_type.id` (ON DELETE NO ACTION) · `motherboard_spec_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION) · `motherboard_spec_socket_id_fkey`: `socket_id` → `socket.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_mb_dimm_slots_positive` — CHECK ((dimm_slots > 0))
- `chk_mb_m2_slots_nonneg` — CHECK ((m2_slots >= 0))
- `chk_mb_max_memory_capacity_positive` — CHECK ((max_memory_capacity_gb > 0))
- `chk_mb_memory_speed_max_ge_min` — CHECK (((official_memory_speed_max_mtps IS NULL) OR (official_memory_speed_min_mtps IS NULL) OR (official_memory_speed_max_mtps >= official_memory_speed_min_mtps)))
- `chk_mb_memory_speed_max_positive` — CHECK ((official_memory_speed_max_mtps > 0))
- `chk_mb_memory_speed_min_positive` — CHECK ((official_memory_speed_min_mtps > 0))
- `chk_mb_pcie_slot_generation_positive` — CHECK ((pcie_slot_generation > 0))
- `chk_mb_pcie_x16_slots_nonneg` — CHECK ((pcie_x16_slots >= 0))
- `chk_mb_sata_ports_nonneg` — CHECK ((sata_ports >= 0))

**Indexes:** `motherboard_spec_pkey`

### `platform` (5 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `name` | text | NO |  |
| `socket_id` | uuid | NO |  |
| `release_year` | integer | YES |  |
| `created_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `platform_socket_id_fkey`: `socket_id` → `socket.id` (ON DELETE NO ACTION)

**Indexes:** `platform_pkey`

### `platform_memory_support` (2 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `platform_id` 🔑 | uuid | NO |  |
| `memory_type_id` 🔑 | uuid | NO |  |

**Foreign keys:** `platform_memory_support_memory_type_id_fkey`: `memory_type_id` → `memory_type.id` (ON DELETE NO ACTION) · `platform_memory_support_platform_id_fkey`: `platform_id` → `platform.id` (ON DELETE NO ACTION)

**Indexes:** `platform_memory_support_pkey`

### `price_history` (7 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `store_offer_id` | uuid | NO |  |
| `price` | numeric | NO |  |
| `currency` | text | NO |  |
| `availability` | text | NO |  |
| `observed_at` | timestamp with time zone | NO |  |
| `created_at` | timestamp with time zone | NO | now() |

**Foreign keys:** `price_history_store_offer_id_fkey`: `store_offer_id` → `store_offer.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_price_history_availability_not_empty` — CHECK ((btrim(availability) <> ''::text))
- `chk_price_history_currency_not_empty` — CHECK ((btrim(currency) <> ''::text))
- `chk_price_history_price_positive` — CHECK ((price > (0)::numeric))

**Indexes:** `idx_price_history_observed_at` · `idx_price_history_store_offer_observed` · `price_history_pkey`

### `product` (9 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `product_family_id` | uuid | NO |  |
| `manufacturer_id` | uuid | NO |  |
| `name` | text | NO |  |
| `manufacturer_part_number` | text | YES |  |
| `ean_gtin` | text | YES |  |
| `lifecycle_status` | USER-DEFINED | NO | 'ACTIVE'::lifecycle_status |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `product_manufacturer_id_fkey`: `manufacturer_id` → `manufacturer.id` (ON DELETE NO ACTION) · `product_product_family_id_fkey`: `product_family_id` → `product_family.id` (ON DELETE NO ACTION)

**Indexes:** `product_pkey`

### `product_candidate` (16 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `ingestion_record_id` | uuid | YES |  |
| `source_type` | USER-DEFINED | NO |  |
| `source_identifier` | text | YES |  |
| `manufacturer_name` | text | YES |  |
| `product_family_name` | text | YES |  |
| `product_name` | text | YES |  |
| `sku` | text | YES |  |
| `ean_gtin` | text | YES |  |
| `source_category` | USER-DEFINED | YES |  |
| `matched_product_id` | uuid | YES |  |
| `confidence` | USER-DEFINED | NO | 'UNVERIFIED'::confidence_level |
| `status` | text | NO | 'UNREVIEWED'::text |
| `raw_data` | jsonb | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `product_candidate_ingestion_record_id_fkey`: `ingestion_record_id` → `ingestion_record.id` (ON DELETE NO ACTION) · `product_candidate_matched_product_id_fkey`: `matched_product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_candidate_matched_requires_confidence` — CHECK (((matched_product_id IS NULL) OR (confidence = ANY (ARRAY['CONFIRMED'::confidence_level, 'HIGH'::confidence_level, 'MEDIUM'::confidence_level]))))
- `chk_candidate_status` — CHECK ((status = ANY (ARRAY['UNREVIEWED'::text, 'MATCHED'::text, 'REVIEW'::text, 'REJECTED'::text, 'CANONICALIZED'::text])))

**Indexes:** `idx_product_candidate_ingestion` · `idx_product_candidate_match` · `idx_product_candidate_sku` · `idx_product_candidate_status` · `product_candidate_pkey`

### `product_family` (4 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `name` | text | NO |  |
| `manufacturer_id` | uuid | NO |  |
| `created_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `product_family_manufacturer_id_fkey`: `manufacturer_id` → `manufacturer.id` (ON DELETE NO ACTION)

**Indexes:** `product_family_pkey`

### `product_variant` (7 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `product_id` | uuid | NO |  |
| `sku` | text | NO |  |
| `variant_type` | USER-DEFINED | NO | 'STANDARD'::product_variant_type |
| `support_status` | USER-DEFINED | NO | 'ACTIVE'::support_status |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `product_variant_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION)

**Indexes:** `idx_product_variant_sku` · `product_variant_pkey`

### `psu_spec` (14 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `product_id` 🔑 | uuid | NO |  |
| `rated_wattage` | integer | YES |  |
| `efficiency_certification` | text | YES |  |
| `atx_standard_version` | text | YES |  |
| `form_factor` | USER-DEFINED | YES |  |
| `length_mm` | integer | YES |  |
| `connector_24pin_atx` | boolean | YES |  |
| `connector_eps_count` | integer | YES |  |
| `connector_pcie_8pin` | integer | YES |  |
| `connector_12vhpwr` | integer | YES |  |
| `connector_sata` | integer | YES |  |
| `modularity` | USER-DEFINED | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `psu_spec_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_psu_connector_12vhpwr_nonneg` — CHECK ((connector_12vhpwr >= 0))
- `chk_psu_connector_eps_count_nonneg` — CHECK ((connector_eps_count >= 0))
- `chk_psu_connector_pcie_8pin_nonneg` — CHECK ((connector_pcie_8pin >= 0))
- `chk_psu_connector_sata_nonneg` — CHECK ((connector_sata >= 0))
- `chk_psu_length_positive` — CHECK ((length_mm > 0))
- `chk_psu_rated_wattage_positive` — CHECK ((rated_wattage > 0))

**Indexes:** `psu_spec_pkey`

### `ram_spec` (8 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `product_id` 🔑 | uuid | NO |  |
| `memory_type_id` | uuid | NO |  |
| `module_count` | integer | YES |  |
| `capacity_per_module_gb` | integer | YES |  |
| `rated_speed_mtps` | integer | YES |  |
| `voltage_v` | numeric(4,2) | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `ram_spec_memory_type_id_fkey`: `memory_type_id` → `memory_type.id` (ON DELETE NO ACTION) · `ram_spec_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_ram_capacity_per_module_positive` — CHECK ((capacity_per_module_gb > 0))
- `chk_ram_module_count_positive` — CHECK ((module_count > 0))
- `chk_ram_rated_speed_positive` — CHECK ((rated_speed_mtps > 0))
- `chk_ram_voltage_positive` — CHECK ((voltage_v > (0)::numeric))

**Indexes:** `ram_spec_pkey`

### `recommendation_profile` (8 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `name` | text | NO |  |
| `description` | text | YES |  |
| `use_case` | text | YES |  |
| `priority` | integer | YES |  |
| `default_resolution` | text | YES |  |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |

**Indexes:** `idx_recommendation_profile_name` · `idx_recommendation_profile_use_case` · `recommendation_profile_pkey`

### `recommendation_query` (9 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `recommendation_profile_id` | uuid | YES |  |
| `scoring_model_id` | uuid | NO |  |
| `budget_amount` | numeric | NO |  |
| `currency` | text | NO |  |
| `use_case` | text | YES |  |
| `priority` | integer | YES |  |
| `resolution` | text | YES |  |
| `created_at` | timestamp with time zone | NO | now() |

**Foreign keys:** `recommendation_query_recommendation_profile_id_fkey`: `recommendation_profile_id` → `recommendation_profile.id` (ON DELETE NO ACTION) · `recommendation_query_scoring_model_id_fkey`: `scoring_model_id` → `scoring_model.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_recommendation_query_budget_positive` — CHECK ((budget_amount > (0)::numeric))

**Indexes:** `idx_recommendation_query_profile_id` · `idx_recommendation_query_scoring_model_id` · `recommendation_query_pkey`

### `recommendation_result` (6 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `recommendation_query_id` | uuid | NO |  |
| `build_candidate_id` | uuid | YES |  |
| `rank` | integer | YES |  |
| `explanation` | text | YES |  |
| `created_at` | timestamp with time zone | NO | now() |

**Foreign keys:** `recommendation_result_build_candidate_id_fkey`: `build_candidate_id` → `build_candidate.id` (ON DELETE NO ACTION) · `recommendation_result_recommendation_query_id_fkey`: `recommendation_query_id` → `recommendation_query.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_recommendation_result_rank_positive` — CHECK ((rank > 0))

**Indexes:** `idx_recommendation_result_build_candidate_id` · `idx_recommendation_result_recommendation_query_id` · `recommendation_result_pkey` · `uq_recommendation_result_query_rank`

### `retailer_listing_alias` (7 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `retailer_name` | text | NO |  |
| `listing_identifier` | text | NO |  |
| `matched_product_id` | uuid | YES |  |
| `confidence` | USER-DEFINED | NO | 'UNVERIFIED'::confidence_level |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `retailer_listing_alias_matched_product_id_fkey`: `matched_product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_alias_matched_requires_confidence` — CHECK (((matched_product_id IS NULL) OR (confidence = ANY (ARRAY['CONFIRMED'::confidence_level, 'HIGH'::confidence_level, 'MEDIUM'::confidence_level]))))

**Indexes:** `idx_retailer_listing` · `idx_retailer_listing_match` · `retailer_listing_alias_pkey`

### `schema_migrations` (2 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `filename` 🔑 | text | NO |  |
| `applied_at` | timestamp with time zone | NO | now() |

**Indexes:** `schema_migrations_pkey`

### `scoring_model` (8 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `name` | text | NO |  |
| `version` | text | NO |  |
| `description` | text | YES |  |
| `configuration` | jsonb | YES |  |
| `is_active` | boolean | NO | true |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**UNIQUE constraints:** `uq_scoring_model_name_version`

**Indexes:** `idx_scoring_model_active` · `scoring_model_pkey` · `uq_scoring_model_name_version`

### `socket` (3 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `name` | text | NO |  |
| `created_at` | timestamp without time zone | NO | now() |

**Indexes:** `idx_socket_name` · `socket_pkey`

### `spec_provenance` (11 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `target_table` | text | NO |  |
| `target_id` | uuid | NO |  |
| `target_column` | text | YES |  |
| `source_type` | USER-DEFINED | NO |  |
| `confidence` | USER-DEFINED | NO | 'UNVERIFIED'::confidence_level |
| `source_identifier` | text | YES |  |
| `source_note` | text | YES |  |
| `reviewed_by` | text | YES |  |
| `reviewed_at` | timestamp without time zone | YES |  |
| `created_at` | timestamp without time zone | NO | now() |

**UNIQUE constraints:** `uq_spec_provenance_target_source_field`

**Indexes:** `idx_spec_provenance_source` · `idx_spec_provenance_target` · `spec_provenance_pkey` · `uq_spec_provenance_target_source_field`

### `ssd_spec` (8 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `product_id` 🔑 | uuid | NO |  |
| `capacity_gb` | integer | YES |  |
| `form_factor` | USER-DEFINED | YES |  |
| `interface` | text | YES |  |
| `protocol` | text | YES |  |
| `pcie_generation` | integer | YES |  |
| `created_at` | timestamp without time zone | NO | now() |
| `updated_at` | timestamp without time zone | NO | now() |

**Foreign keys:** `ssd_spec_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_ssd_capacity_positive` — CHECK ((capacity_gb > 0))
- `chk_ssd_pcie_generation_positive` — CHECK ((pcie_generation > 0))

**Indexes:** `ssd_spec_pkey`

### `store` (8 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `name` | text | NO |  |
| `website_url` | text | YES |  |
| `country_code` | text | YES |  |
| `currency_code` | text | YES |  |
| `is_active` | boolean | NO | true |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |

**CHECK constraints:**

- `chk_store_name_not_empty` — CHECK ((btrim(name) <> ''::text))

**Indexes:** `idx_store_active` · `store_pkey`

### `store_offer` (12 columns)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` 🔑 | uuid | NO | gen_random_uuid() |
| `store_id` | uuid | NO |  |
| `product_id` | uuid | NO |  |
| `product_variant_id` | uuid | YES |  |
| `price` | numeric | NO |  |
| `currency` | text | NO |  |
| `availability` | text | NO |  |
| `product_url` | text | YES |  |
| `seller_name` | text | YES |  |
| `last_checked_at` | timestamp with time zone | NO |  |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |

**Foreign keys:** `store_offer_product_id_fkey`: `product_id` → `product.id` (ON DELETE NO ACTION) · `store_offer_product_variant_id_fkey`: `product_variant_id` → `product_variant.id` (ON DELETE NO ACTION) · `store_offer_store_id_fkey`: `store_id` → `store.id` (ON DELETE NO ACTION)

**CHECK constraints:**

- `chk_store_offer_availability_not_empty` — CHECK ((btrim(availability) <> ''::text))
- `chk_store_offer_currency_not_empty` — CHECK ((btrim(currency) <> ''::text))
- `chk_store_offer_price_positive` — CHECK ((price > (0)::numeric))

**Indexes:** `idx_store_offer_last_checked_at` · `idx_store_offer_product_id` · `idx_store_offer_product_variant_id` · `idx_store_offer_store_id` · `store_offer_pkey`

---

*Generated from the live database; regenerating against a schema that changed
will update this file. Keep hand-written schema claims in the migrations.*

