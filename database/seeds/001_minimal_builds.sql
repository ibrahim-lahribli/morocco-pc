-- ===========================================================================
-- Seed 001: minimal real build catalog (2-tier: budget + higher-tier)
--
-- Purpose: enough real (non-fixture) data to assemble and score 2-3
-- complete, compatible, end-to-end buildable PCs through
-- Engine 1 -> 2 -> 3 -> 4. See the seed plan (Plan mode) for the full
-- table-by-table rationale.
--
-- Conventions:
--   * Every seeded display name / SKU carries a `Seed ` / `SEED-` prefix
--     so seed rows are distinguishable from test fixtures (`Test%`) and
--     can be reset with `WHERE name LIKE 'Seed %'` scoping. Never wipe.
--   * Idempotent: every INSERT is guarded by WHERE NOT EXISTS on the
--     natural key (or the partial-unique predicate), so re-running this
--     file changes nothing. Safe on the shared Neon database.
--   * No DDL. No product_variant.overrides column exists on the live
--     schema (verified 2026-09-19 via information_schema); the
--     CONTEXT.md mention is tracked as doc-drift, not seeded here.
--   * Wraps in a single transaction: all-or-nothing per run.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Reference data (natural keys: names)
-- ---------------------------------------------------------------------------

INSERT INTO manufacturer (name, website)
SELECT 'AMD', 'https://www.amd.com'
WHERE NOT EXISTS (SELECT 1 FROM manufacturer WHERE name = 'AMD');

INSERT INTO manufacturer (name, website)
SELECT 'NVIDIA', 'https://www.nvidia.com'
WHERE NOT EXISTS (SELECT 1 FROM manufacturer WHERE name = 'NVIDIA');

INSERT INTO manufacturer (name)
SELECT m.name FROM (VALUES
    ('MSI'),
    ('Gigabyte'),
    ('Corsair'),
    ('G.Skill'),
    ('Western Digital'),
    ('Samsung'),
    ('NZXT'),
    ('Fractal Design'),
    ('DeepCool'),
    ('Noctua')
) AS m(name)
WHERE NOT EXISTS (SELECT 1 FROM manufacturer WHERE manufacturer.name = m.name);

INSERT INTO socket (name)
SELECT 'AM5'
WHERE NOT EXISTS (SELECT 1 FROM socket WHERE name = 'AM5');

INSERT INTO memory_type (name)
SELECT 'DDR5'
WHERE NOT EXISTS (SELECT 1 FROM memory_type WHERE name = 'DDR5');

INSERT INTO platform (name, socket_id)
SELECT 'Seed AMD AM5', s.id FROM socket s
WHERE s.name = 'AM5'
AND NOT EXISTS (SELECT 1 FROM platform WHERE name = 'Seed AMD AM5');

INSERT INTO platform_memory_support (platform_id, memory_type_id)
SELECT p.id, m.id FROM platform p, memory_type m
WHERE p.name = 'Seed AMD AM5' AND m.name = 'DDR5'
AND NOT EXISTS (
    SELECT 1 FROM platform_memory_support pms
    WHERE pms.platform_id = p.id AND pms.memory_type_id = m.id
);

INSERT INTO chipset (manufacturer_id, name)
SELECT m.id, 'AMD B650' FROM manufacturer m
WHERE m.name = 'Gigabyte'
AND NOT EXISTS (
    SELECT 1 FROM chipset c
    WHERE c.manufacturer_id = m.id AND c.name = 'AMD B650'
);

INSERT INTO gpu_chipset (manufacturer_id, name, vram_capacity_gb, vram_type,
    memory_bus_width_bit, pcie_interface, base_tgp_watts)
SELECT m.id, 'RTX 4060 AD107', 8, 'GDDR6', 128, 'PCIe 4.0 x8', 115
FROM manufacturer m
WHERE m.name = 'NVIDIA'
AND NOT EXISTS (
    SELECT 1 FROM gpu_chipset g
    WHERE g.manufacturer_id = m.id AND g.name = 'RTX 4060 AD107'
);

-- ---------------------------------------------------------------------------
-- Product families (natural key: name)
-- ---------------------------------------------------------------------------

INSERT INTO product_family (name, manufacturer_id)
SELECT f.name, m.id FROM manufacturer m, (VALUES
    ('Seed AMD AM5 Budget CPUs', 'AMD'),
    ('Seed AMD AM5 G-Series CPUs', 'AMD'),
    ('Seed B650 Motherboards Budget', 'MSI'),
    ('Seed B650 Motherboards Tier', 'Gigabyte'),
    ('Seed DDR5 Budget RAM', 'Corsair'),
    ('Seed DDR5 Tier RAM', 'G.Skill'),
    ('Seed RTX 4060 Boards', 'MSI'),
    ('Seed Boot SSDs Budget', 'Western Digital'),
    ('Seed Boot SSDs Tier', 'Samsung'),
    ('Seed Budget PSUs', 'Corsair'),
    ('Seed Tier PSUs', 'MSI'),
    ('Seed Compact Cases', 'NZXT'),
    ('Seed Full Cases', 'Fractal Design'),
    ('Seed Budget Coolers', 'DeepCool'),
    ('Seed Tier Coolers', 'Noctua')
) AS f(name, mfr)
WHERE m.name = f.mfr
AND NOT EXISTS (SELECT 1 FROM product_family pf WHERE pf.name = f.name);

-- ---------------------------------------------------------------------------
-- Products (natural key: name; all ACTIVE so the Engine 2B loader picks them)
-- ---------------------------------------------------------------------------

INSERT INTO product (product_family_id, manufacturer_id, name, lifecycle_status)
SELECT pf.id, m.id, p.name, 'ACTIVE'
FROM (VALUES
    ('Seed Ryzen 5 7500F',            'Seed AMD AM5 Budget CPUs',    'AMD'),
    ('Seed Ryzen 5 8600G',            'Seed AMD AM5 G-Series CPUs',  'AMD'),
    ('Seed MSI PRO B650M-P',          'Seed B650 Motherboards Budget','MSI'),
    ('Seed Gigabyte B650 AORUS ELITE AX','Seed B650 Motherboards Tier','Gigabyte'),
    ('Seed Corsair Vengeance 16GB DDR5-5200', 'Seed DDR5 Budget RAM','Corsair'),
    ('Seed G.Skill Flare X5 32GB DDR5-6000','Seed DDR5 Tier RAM',   'G.Skill'),
    ('Seed RTX 4060 8GB',             'Seed RTX 4060 Boards',        'MSI'),
    ('Seed WD Blue SN580 1TB',        'Seed Boot SSDs Budget',       'Western Digital'),
    ('Seed Samsung 990 Pro 2TB',      'Seed Boot SSDs Tier',         'Samsung'),
    ('Seed Corsair CX550M 550W',      'Seed Budget PSUs',            'Corsair'),
    ('Seed MSI MAG A750GL 750W',      'Seed Tier PSUs',              'MSI'),
    ('Seed NZXT H5 Flow Compact',     'Seed Compact Cases',          'NZXT'),
    ('Seed Fractal Pop XL',           'Seed Full Cases',             'Fractal Design'),
    ('Seed DeepCool AG400',           'Seed Budget Coolers',         'DeepCool'),
    ('Seed Noctua NH-U12S SE-AM5',    'Seed Tier Coolers',           'Noctua')
) AS p(name, family, mfr)
JOIN product_family pf ON pf.name = p.family
JOIN manufacturer m ON m.name = p.mfr
WHERE NOT EXISTS (SELECT 1 FROM product pr WHERE pr.name = p.name);

-- ---------------------------------------------------------------------------
-- Product-keyed specs (PK = product_id; one row per product)
-- ---------------------------------------------------------------------------

-- CPUs: 7500F has no iGPU (GPU REQUIRED path); 8600G has iGPU (OPTIONAL path)
INSERT INTO cpu_spec (product_id, socket_id, cores, threads, base_clock_mhz,
    boost_clock_mhz, tdp_watts, memory_channels, max_official_memory_speed_mtps,
    pcie_generation, integrated_gpu_present, integrated_gpu_model)
SELECT p.id, s.id, v.cores, v.threads, v.base_mhz, v.boost_mhz, v.tdp,
    2, 5200, 5, v.igpu, v.igpu_model
FROM (VALUES
    ('Seed Ryzen 5 7500F', 6, 12, 3700, 5000, 65, false, NULL),
    ('Seed Ryzen 5 8600G', 6, 12, 4300, 5000, 65, true,  'Radeon 760M')
) AS v(name, cores, threads, base_mhz, boost_mhz, tdp, igpu, igpu_model)
JOIN product p ON p.name = v.name
JOIN socket s ON s.name = 'AM5'
WHERE NOT EXISTS (SELECT 1 FROM cpu_spec c WHERE c.product_id = p.id);

-- Motherboards: budget mATX vs tier ATX, both AM5 + DDR5
INSERT INTO motherboard_spec (product_id, socket_id, chipset_id, form_factor,
    memory_type_id, dimm_slots, max_memory_capacity_gb,
    official_memory_speed_min_mtps, official_memory_speed_max_mtps,
    pcie_x16_slots, pcie_slot_generation, m2_slots, sata_ports, wifi_present)
SELECT p.id, s.id, c.id, v.ff::motherboard_form_factor, m.id,
    v.dimm, v.maxgb, 4800, 6400, 1, 4, v.m2, 4, v.wifi
FROM (VALUES
    ('Seed MSI PRO B650M-P',           'MICRO_ATX', 2, 128, 2, false),
    ('Seed Gigabyte B650 AORUS ELITE AX','ATX',     4, 128, 3, true)
) AS v(name, ff, dimm, maxgb, m2, wifi)
JOIN product p ON p.name = v.name
JOIN socket s ON s.name = 'AM5'
JOIN chipset c ON c.name = 'AMD B650'
JOIN memory_type m ON m.name = 'DDR5'
WHERE NOT EXISTS (SELECT 1 FROM motherboard_spec mb WHERE mb.product_id = p.id);

-- RAM kits
INSERT INTO ram_spec (product_id, memory_type_id, module_count,
    capacity_per_module_gb, rated_speed_mtps, voltage_v)
SELECT p.id, m.id, v.mods, v.cap, v.speed, v.volt
FROM (VALUES
    ('Seed Corsair Vengeance 16GB DDR5-5200', 2, 8,  5200, 1.25),
    ('Seed G.Skill Flare X5 32GB DDR5-6000',  2, 16, 6000, 1.35)
) AS v(name, mods, cap, speed, volt)
JOIN product p ON p.name = v.name
JOIN memory_type m ON m.name = 'DDR5'
WHERE NOT EXISTS (SELECT 1 FROM ram_spec r WHERE r.product_id = p.id);

-- Boot SSDs
INSERT INTO ssd_spec (product_id, capacity_gb, form_factor, interface, protocol, pcie_generation)
SELECT p.id, v.cap, 'M_2_2280'::ssd_form_factor, 'M.2', 'NVMe', 4
FROM (VALUES
    ('Seed WD Blue SN580 1TB', 1000),
    ('Seed Samsung 990 Pro 2TB', 2000)
) AS v(name, cap)
JOIN product p ON p.name = v.name
WHERE NOT EXISTS (SELECT 1 FROM ssd_spec s WHERE s.product_id = p.id);

-- PSUs: 550W (boundary PASS for the 240mm board, FAIL for the 320mm OC board)
-- vs 750W (PASS for both). PSU1 carries 1x 8-pin so the OC board also
-- connector-FAILs against it (double-FAIL evidence case).
INSERT INTO psu_spec (product_id, rated_wattage, efficiency_certification,
    atx_standard_version, form_factor, length_mm, connector_24pin_atx,
    connector_eps_count, connector_pcie_8pin, connector_12vhpwr,
    connector_sata, modularity)
SELECT p.id, v.watts, v.eff, 'ATX 3.0', 'ATX'::psu_form_factor, v.len,
    true, v.eps, v.pcie8, v.hvpwr, 6, v.mod::psu_modularity
FROM (VALUES
    ('Seed Corsair CX550M 550W',  550, 'Bronze', 140, 1, 1, 0, 'SEMI_MODULAR'),
    ('Seed MSI MAG A750GL 750W',  750, 'Gold',   140, 2, 4, 1, 'FULLY_MODULAR')
) AS v(name, watts, eff, len, eps, pcie8, hvpwr, mod)
JOIN product p ON p.name = v.name
WHERE NOT EXISTS (SELECT 1 FROM psu_spec s WHERE s.product_id = p.id);

-- Cases: compact 280mm (FAILs the 320mm OC board) vs full 360mm (fits both)
INSERT INTO case_spec (product_id, max_gpu_length_mm, max_gpu_thickness_slots,
    max_cpu_cooler_height_mm, psu_form_factor, max_psu_length_mm)
SELECT p.id, v.gpul, v.gput, 160, 'ATX'::psu_form_factor, 200
FROM (VALUES
    ('Seed NZXT H5 Flow Compact', 280, 3),
    ('Seed Fractal Pop XL',       360, 3)
) AS v(name, gpul, gput)
JOIN product p ON p.name = v.name
WHERE NOT EXISTS (SELECT 1 FROM case_spec c WHERE c.product_id = p.id);

-- Coolers: both AIR (radiator rule PASS not_applicable). COOLER2 deliberately
-- gets NO cooler_socket_support row -> UNKNOWN (eligible, penalized).
INSERT INTO cooler_spec (product_id, cooling_type, max_tdp_watts, height_mm,
    length_mm, width_mm)
SELECT p.id, 'AIR'::cooling_type, v.tdp, dims.h, 120, 120
FROM (VALUES
    ('Seed DeepCool AG400',        220),
    ('Seed Noctua NH-U12S SE-AM5', 180)
) AS v(name, tdp)
JOIN product p ON p.name = v.name
CROSS JOIN (SELECT 155 AS h) AS dims
WHERE NOT EXISTS (SELECT 1 FROM cooler_spec c WHERE c.product_id = p.id);

-- ---------------------------------------------------------------------------
-- GPU: one product, two variants (variant-keyed candidates)
-- V1 short/budget board; V2 long OC board (FAILs compact case + 550W PSU)
-- ---------------------------------------------------------------------------

INSERT INTO product_variant (product_id, sku, variant_type, support_status)
SELECT p.id, v.sku, 'STANDARD', 'ACTIVE'
FROM (VALUES
    ('Seed RTX 4060 8GB', 'SEED-RTX4060-DUAL-8G'),
    ('Seed RTX 4060 8GB', 'SEED-RTX4060-TRIO-OC-8G')
) AS v(pname, sku)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (SELECT 1 FROM product_variant pv WHERE pv.sku = v.sku);

INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id, board_tgp_watts,
    length_mm, width_slots, height_mm, required_power_connectors,
    recommended_psu_watts)
SELECT pv.id, g.id, v.tgp, v.len, v.w, 130,
    v.conn::jsonb, v.recpsu
FROM (VALUES
    ('SEED-RTX4060-DUAL-8G',    115, 240, 2.00, '{"pcie_8pin": 1}', 550),
    ('SEED-RTX4060-TRIO-OC-8G', 150, 320, 2.50, '{"pcie_8pin": 2}', 650)
) AS v(sku, tgp, len, w, conn, recpsu)
JOIN product_variant pv ON pv.sku = v.sku
JOIN gpu_chipset g ON g.name = 'RTX 4060 AD107'
WHERE NOT EXISTS (SELECT 1 FROM gpu_board_spec b WHERE b.product_variant_id = pv.id);

-- ---------------------------------------------------------------------------
-- Compatibility rows
-- Socket equality is spec-derived (all AM5): no rows needed for PASS there.
-- ---------------------------------------------------------------------------

-- cpu_motherboard_support: family PASS rows + one exact-SKU FAIL override.
-- (MB1, Budget-family) PASS; (MB2, G-family) PASS; (MB2, Budget-family) PASS;
-- exact (MB1, 8600G) FAIL shadows the family fallback (precedence exercise).
INSERT INTO cpu_motherboard_support (motherboard_product_id,
    cpu_product_family_id, cpu_product_id, support_status, min_bios_version,
    source_note)
SELECT mb.id, pf.id, NULL, 'PASS', NULL, 'Seed family rule'
FROM product mb, product_family pf
WHERE ((mb.name = 'Seed MSI PRO B650M-P' AND pf.name = 'Seed AMD AM5 Budget CPUs')
   OR (mb.name = 'Seed Gigabyte B650 AORUS ELITE AX' AND pf.name = 'Seed AMD AM5 G-Series CPUs')
   OR (mb.name = 'Seed Gigabyte B650 AORUS ELITE AX' AND pf.name = 'Seed AMD AM5 Budget CPUs'))
AND NOT EXISTS (
    SELECT 1 FROM cpu_motherboard_support s
    WHERE s.motherboard_product_id = mb.id
      AND s.cpu_product_family_id = pf.id
      AND s.cpu_product_id IS NULL
);

INSERT INTO cpu_motherboard_support (motherboard_product_id,
    cpu_product_family_id, cpu_product_id, support_status, min_bios_version,
    source_note)
SELECT mb.id, NULL, cpu.id, 'FAIL', 'F10', 'Seed exact-SKU override: 8600G not validated on budget mATX rev 1.0'
FROM product mb, product cpu
WHERE mb.name = 'Seed MSI PRO B650M-P' AND cpu.name = 'Seed Ryzen 5 8600G'
AND NOT EXISTS (
    SELECT 1 FROM cpu_motherboard_support s
    WHERE s.motherboard_product_id = mb.id AND s.cpu_product_id = cpu.id
);

-- cooler_socket_support: ONLY the budget cooler gets a row (PASS).
-- The tier cooler deliberately has no AM5 row -> UNKNOWN (eligible, penalized).
INSERT INTO cooler_socket_support (cooler_product_id, socket_id, support_status,
    mounting_note)
SELECT p.id, s.id, 'PASS', 'Seed: AM5 bracket included'
FROM product p, socket s
WHERE p.name = 'Seed DeepCool AG400' AND s.name = 'AM5'
AND NOT EXISTS (
    SELECT 1 FROM cooler_socket_support c
    WHERE c.cooler_product_id = p.id AND c.socket_id = s.id
);

-- case_motherboard_form_factor: compact takes mATX only; full takes both.
-- (Budget ATX board, compact case) has no row -> UNKNOWN.
INSERT INTO case_motherboard_form_factor (case_product_id, form_factor)
SELECT p.id, v.ff::motherboard_form_factor
FROM (VALUES
    ('Seed NZXT H5 Flow Compact', 'MICRO_ATX'),
    ('Seed Fractal Pop XL',       'MICRO_ATX'),
    ('Seed Fractal Pop XL',       'ATX')
) AS v(name, ff)
JOIN product p ON p.name = v.name
WHERE NOT EXISTS (
    SELECT 1 FROM case_motherboard_form_factor f
    WHERE f.case_product_id = p.id AND f.form_factor = v.ff::motherboard_form_factor
);

-- case_radiator_support: realism rows for both cases (AIR coolers PASS anyway).
INSERT INTO case_radiator_support (case_product_id, radiator_size_mm, position)
SELECT p.id, v.size, v.pos
FROM (VALUES
    ('Seed NZXT H5 Flow Compact', 240, 'TOP'),
    ('Seed Fractal Pop XL',       240, 'TOP'),
    ('Seed Fractal Pop XL',       360, 'FRONT')
) AS v(name, size, pos)
JOIN product p ON p.name = v.name
WHERE NOT EXISTS (
    SELECT 1 FROM case_radiator_support r
    WHERE r.case_product_id = p.id
      AND r.radiator_size_mm = v.size AND r.position = v.pos
);

-- ---------------------------------------------------------------------------
-- Market: 2 stores, 1 MAD offer per candidate (16 offers), + price history
-- Non-GPU candidates use NULL-variant offers; GPU uses exact (product,variant)
-- ---------------------------------------------------------------------------

INSERT INTO store (name, website_url, country_code, currency_code, is_active)
SELECT s.name, s.url, 'MA', 'MAD', true
FROM (VALUES
    ('Seed NextGamer', 'https://example.ma/nextgamer'),
    ('Seed UltraPC',   'https://example.ma/ultrapc')
) AS s(name, url)
WHERE NOT EXISTS (SELECT 1 FROM store st WHERE st.name = s.name);

-- Product-keyed offers (all roles except GPU), alternating stores
INSERT INTO store_offer (store_id, product_id, product_variant_id, price,
    currency, availability, last_checked_at)
SELECT st.id, p.id, NULL, v.price, 'MAD', 'IN_STOCK', NOW()
FROM (VALUES
    ('Seed Ryzen 5 7500F',                 'Seed NextGamer', 1800),
    ('Seed Ryzen 5 8600G',                 'Seed UltraPC',   2800),
    ('Seed MSI PRO B650M-P',               'Seed NextGamer', 1500),
    ('Seed Gigabyte B650 AORUS ELITE AX',  'Seed UltraPC',   2400),
    ('Seed Corsair Vengeance 16GB DDR5-5200','Seed NextGamer',700),
    ('Seed G.Skill Flare X5 32GB DDR5-6000','Seed UltraPC', 1400),
    ('Seed WD Blue SN580 1TB',             'Seed NextGamer',  800),
    ('Seed Samsung 990 Pro 2TB',           'Seed UltraPC',   1500),
    ('Seed Corsair CX550M 550W',           'Seed NextGamer',  650),
    ('Seed MSI MAG A750GL 750W',           'Seed UltraPC',   1100),
    ('Seed NZXT H5 Flow Compact',          'Seed NextGamer',  900),
    ('Seed Fractal Pop XL',                'Seed UltraPC',   1400),
    ('Seed DeepCool AG400',                'Seed NextGamer',  350),
    ('Seed Noctua NH-U12S SE-AM5',         'Seed UltraPC',    750)
) AS v(pname, sname, price)
JOIN product p ON p.name = v.pname
JOIN store st ON st.name = v.sname
WHERE NOT EXISTS (
    SELECT 1 FROM store_offer o
    WHERE o.store_id = st.id AND o.product_id = p.id
      AND o.product_variant_id IS NULL AND o.price = v.price AND o.currency = 'MAD'
);

-- GPU variant-keyed offers (exact product+variant match required by Stage 1)
INSERT INTO store_offer (store_id, product_id, product_variant_id, price,
    currency, availability, last_checked_at)
SELECT st.id, p.id, pv.id, v.price, 'MAD', 'IN_STOCK', NOW()
FROM (VALUES
    ('SEED-RTX4060-DUAL-8G',    'Seed NextGamer', 3200),
    ('SEED-RTX4060-TRIO-OC-8G', 'Seed UltraPC',   4800)
) AS v(sku, sname, price)
JOIN product_variant pv ON pv.sku = v.sku
JOIN product p ON p.id = pv.product_id
JOIN store st ON st.name = v.sname
WHERE NOT EXISTS (
    SELECT 1 FROM store_offer o
    WHERE o.store_id = st.id AND o.product_id = p.id
      AND o.product_variant_id = pv.id AND o.price = v.price AND o.currency = 'MAD'
);

-- One price_history observation per seeded offer (append-only realism)
INSERT INTO price_history (store_offer_id, price, currency, availability,
    observed_at)
SELECT o.id, o.price, o.currency, o.availability, NOW() - INTERVAL '1 day'
FROM store_offer o
JOIN product p ON p.id = o.product_id
WHERE p.name LIKE 'Seed %'
AND NOT EXISTS (
    SELECT 1 FROM price_history h
    WHERE h.store_offer_id = o.id AND h.price = o.price
      AND h.currency = o.currency AND h.availability = o.availability
);

-- ---------------------------------------------------------------------------
-- Layer 2: benchmark provenance (no engine consumer; minimal realism)
-- ---------------------------------------------------------------------------

INSERT INTO benchmark_source (name, organization, url, methodology_notes,
    source_type)
SELECT 'Seed TechPowerUp', 'TechPowerUp', 'https://www.techpowerup.com',
    'Seed: editorial review measurements', 'DATASHEET'
WHERE NOT EXISTS (
    SELECT 1 FROM benchmark_source WHERE name = 'Seed TechPowerUp'
);

INSERT INTO benchmark (benchmark_source_id, name, workload_type,
    benchmark_method, notes)
SELECT s.id, 'Seed Cinebench R23 Multi', 'RENDER', 'AVERAGE',
    'Seed: stock, AM5 test bench'
FROM benchmark_source s
WHERE s.name = 'Seed TechPowerUp'
AND NOT EXISTS (
    SELECT 1 FROM benchmark b
    WHERE b.benchmark_source_id = s.id AND b.name = 'Seed Cinebench R23 Multi'
);

INSERT INTO benchmark_result (benchmark_id, product_id, metric_name,
    metric_value, metric_unit, sample_size)
SELECT b.id, p.id, 'score', v.score, 'points', 3
FROM (VALUES
    ('Seed Ryzen 5 7500F', 19000),
    ('Seed Ryzen 5 8600G', 20000)
) AS v(pname, score)
JOIN product p ON p.name = v.pname
JOIN benchmark b ON b.name = 'Seed Cinebench R23 Multi'
WHERE NOT EXISTS (
    SELECT 1 FROM benchmark_result r
    WHERE r.benchmark_id = b.id AND r.product_id = p.id
      AND r.metric_name = 'score' AND r.metric_unit = 'points'
);

-- ---------------------------------------------------------------------------
-- component_assessment: STEP-1 branch coverage
-- CASE1 (compact) has NO rows -> no-evidence; CPU2 VALUE is NULL-score;
-- GPU PERFORMANCE has a newer NULL shadowing an older scored row;
-- RAM1 PERFORMANCE is stale (200d > max_age_days 180); rest normal.
-- ---------------------------------------------------------------------------

INSERT INTO component_assessment (product_id, assessment_type, score, rating,
    summary, rationale, confidence, source_type, assessed_at)
SELECT p.id, v.atype::assessment_type, v.score, v.rating, v.summary,
    'Seed curated assessment', v.conf::confidence_level, 'OFFICIAL',
    NOW() - (v.age_days || ' days')::INTERVAL
FROM (VALUES
    -- CPUs
    ('Seed Ryzen 5 7500F', 'PERFORMANCE', 78,   'Good',     'Seed: 6C value gaming CPU',        'CONFIRMED', 7),
    ('Seed Ryzen 5 7500F', 'VALUE',       70,   'Good',     'Seed: strong price per frame',     'HIGH',      7),
    ('Seed Ryzen 5 8600G', 'PERFORMANCE', 82,   'Good',     'Seed: 6C APU with 760M iGPU',      'CONFIRMED', 7),
    ('Seed Ryzen 5 8600G', 'VALUE',       NULL, 'Unrated',  'Seed: iGPU value under review',    'MEDIUM',    7),
    -- GPU (product-level; applies to both variants)
    ('Seed RTX 4060 8GB', 'PERFORMANCE', 85,   'Good',     'Seed: 1080p efficient',            'CONFIRMED', 30),
    ('Seed RTX 4060 8GB', 'PERFORMANCE', NULL, 'Unrated',  'Seed: OC retest pending',          'MEDIUM',    2),
    ('Seed RTX 4060 8GB', 'VALUE',       65,   'Average',  'Seed: fair at MSRP',               'HIGH',      7),
    -- Motherboards
    ('Seed MSI PRO B650M-P', 'QUALITY',        75, 'Good', 'Seed: solid budget mATX',          'HIGH',      7),
    ('Seed MSI PRO B650M-P', 'UPGRADEABILITY', 60, 'Average','Seed: 2 DIMM slots',              'MEDIUM',    7),
    ('Seed Gigabyte B650 AORUS ELITE AX', 'QUALITY', 80, 'Good','Seed: tier ATX VRM',          'HIGH',      7),
    ('Seed Gigabyte B650 AORUS ELITE AX', 'VALUE',   72, 'Good','Seed: fair tier board',       'MEDIUM',    7),
    -- RAM: budget PERFORMANCE stale, tier fresh
    ('Seed Corsair Vengeance 16GB DDR5-5200', 'PERFORMANCE', 68, 'Average','Seed: baseline DDR5 kit','MEDIUM', 200),
    ('Seed G.Skill Flare X5 32GB DDR5-6000',  'PERFORMANCE', 78, 'Good',  'Seed: sweet-spot DDR5', 'HIGH',   7),
    ('Seed G.Skill Flare X5 32GB DDR5-6000',  'VALUE',       74, 'Good',  'Seed: fair 32GB kit',   'MEDIUM', 7),
    -- SSDs
    ('Seed WD Blue SN580 1TB',  'PERFORMANCE', 70, 'Good', 'Seed: budget NVMe',   'MEDIUM',    7),
    ('Seed WD Blue SN580 1TB',  'VALUE',       75, 'Good', 'Seed: cheap per GB',  'HIGH',      7),
    ('Seed Samsung 990 Pro 2TB','PERFORMANCE', 88, 'Great','Seed: flagship Gen4','CONFIRMED', 7),
    ('Seed Samsung 990 Pro 2TB','VALUE',       70, 'Good', 'Seed: premium per GB','MEDIUM',   7),
    -- PSUs
    ('Seed Corsair CX550M 550W', 'QUALITY',    80, 'Good', 'Seed: budget bronze',   'HIGH',   7),
    ('Seed Corsair CX550M 550W', 'EFFICIENCY', 75, 'Good', 'Seed: bronze eff',      'MEDIUM', 7),
    ('Seed MSI MAG A750GL 750W', 'QUALITY',    88, 'Great','Seed: tier gold ATX3',  'CONFIRMED', 7),
    ('Seed MSI MAG A750GL 750W', 'EFFICIENCY', 85, 'Great','Seed: gold eff',        'HIGH',   7),
    -- Cases: compact deliberately unassessed (no-evidence), full normal
    ('Seed Fractal Pop XL', 'QUALITY', 70, 'Good', 'Seed: roomy full tower', 'MEDIUM', 7),
    -- Coolers
    ('Seed DeepCool AG400',        'THERMALS', 76, 'Good', 'Seed: budget tower', 'HIGH',      7),
    ('Seed Noctua NH-U12S SE-AM5', 'THERMALS', 84, 'Great','Seed: proven tower',  'CONFIRMED', 7)
) AS v(pname, atype, score, rating, summary, conf, age_days)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (
    SELECT 1 FROM component_assessment a
    WHERE a.product_id = p.id
      AND a.assessment_type = v.atype::assessment_type
      AND ((a.score = v.score) OR (a.score IS NULL AND v.score IS NULL))
      AND a.confidence = v.conf::confidence_level
);

-- ---------------------------------------------------------------------------
-- scoring_model: complete Decision 3(a) configuration (loader-validated)
-- gpu_required_use_cases is byte-exact per Decision 10 Rule 3.
-- ---------------------------------------------------------------------------

INSERT INTO scoring_model (name, version, description, configuration, is_active)
SELECT 'seed-minimal-v1', '1.0.0',
    'Seed: minimal 2-tier catalog; GAMING required, OFFICE iGPU-optional',
    '{
      "version_note": "seed v1 2026-09-19: minimal 2-tier catalog; MAD market",
      "role_weights": {
        "CPU":         { "PERFORMANCE": 0.5, "VALUE": 0.3, "QUALITY": 0.2 },
        "GPU":         { "PERFORMANCE": 0.6, "VALUE": 0.3, "QUALITY": 0.1 },
        "MOTHERBOARD": { "QUALITY": 0.5, "VALUE": 0.3, "UPGRADEABILITY": 0.2 },
        "RAM":         { "PERFORMANCE": 0.4, "VALUE": 0.4, "QUALITY": 0.2 },
        "SSD_BOOT":    { "PERFORMANCE": 0.5, "VALUE": 0.3, "QUALITY": 0.2 },
        "PSU":         { "QUALITY": 0.5, "EFFICIENCY": 0.3, "VALUE": 0.2 },
        "CASE":        { "QUALITY": 0.5, "VALUE": 0.3, "THERMALS": 0.2 },
        "CPU_COOLER":  { "THERMALS": 0.5, "QUALITY": 0.3, "VALUE": 0.2 }
      },
      "type_weights": {
        "PERFORMANCE": 1.0, "VALUE": 0.8, "QUALITY": 0.7,
        "UPGRADEABILITY": 0.5, "THERMALS": 0.5, "EFFICIENCY": 0.6
      },
      "neutral_baseline": 50,
      "no_evidence_penalty": 10,
      "unknown_compat_penalty": 5,
      "confidence_multipliers": {
        "CONFIRMED": 1.0, "HIGH": 0.8, "MEDIUM": 0.6, "LOW": 0.3, "UNVERIFIED": 0.0
      },
      "staleness": { "max_age_days": 180, "per_day_decay": 0.005 },
      "candidate_caps": { "top_k_per_role": 5, "max_builds_per_query": 25 },
      "gpu_required_use_cases": ["GAMING", "WORKSTATION"]
    }'::jsonb,
    true
WHERE NOT EXISTS (
    SELECT 1 FROM scoring_model
    WHERE name = 'seed-minimal-v1' AND version = '1.0.0'
);

COMMIT;

COMMIT;
