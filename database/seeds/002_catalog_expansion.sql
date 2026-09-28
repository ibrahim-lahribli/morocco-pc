-- ===========================================================================
-- Seed 002: catalog expansion (85 researched products)
--
-- Sources (supplied research artifacts, NOT committed to this repo):
--   * "Catalog Expansion - Hardware Specification, Compatibility & Market
--     Research" (the catalog report; the LATER of the two)
--   * "Morocco PC catalog research - Phase 2" (companion, listing/source detail)
--
-- Conventions (identical to 001_minimal_builds.sql):
--   * Every display name carries a `Seed ` prefix; every variant SKU uses
--     `SEED-`. Never wipe; resets scope with `WHERE name LIKE 'Seed %'`.
--   * Idempotent: every INSERT is guarded by WHERE NOT EXISTS on the natural
--     key, so re-running this file changes nothing.
--   * DML only, single BEGIN/COMMIT, ASCII, fresh last_checked_at = NOW().
--   * NULL means UNKNOWN. A missing value is never replaced by a plausible
--     one; absence of a compatibility row means UNKNOWN (two documented
--     exceptions: the liquid-cooler radiator rule and the platform-memory
--     exclusion rule - see D4/D7).
--
-- DELIBERATE DECISIONS (recorded so they stay auditable):
--
--   D1. Prices = the catalog report's assessment-era MAD prices (that report
--       states this rule explicitly). The companion file's NEWER aggregator
--       prices were NOT used, although several differ materially (AA13 699
--       vs 264; Kingston NV3 899 vs 1,799; CORELIQUID 240R 799 vs 1,399;
--       Antec CSK1000 1,299 vs 1,064; HYBROK 599 vs 349; RTX 5080 boards).
--       The assessment-era price list itself was not supplied, so these
--       numbers are currently UNVERIFIED: a price pass is required before
--       they are trusted for budget decisions. store_offer has no offer-level
--       unique key, so a later correction INSERTS a second offer instead of
--       updating this one.
--
--   D2. No `component_assessment` rows are seeded (the assessment research
--       was not supplied). By Decision 13 STEP 1 every new product therefore
--       scores the no-evidence branch (50 - 10 = 40) for every weighted type,
--       so this expansion adds candidates/offers but will NOT displace 001's
--       assessed products in ranking.
--
--       AMENDED 2026-09-28 (measured read-only on a TEST_DATABASE_URL branch by
--       running filterCandidates -> computeCandidateScores ->
--       retainTopKPerRole under seed-minimal-v1: neutral_baseline 50,
--       no_evidence_penalty 10, candidate_caps.top_k_per_role 5): the effect is
--       STRONGER than "will not displace". All 20 new GPUs and all 9 new PSUs
--       score EXACTLY 40.000 (a flat tie), while 001's assessed products hold
--       the top slots (GPU: two RTX 4060 variants at 45.421, PSU: MAG A750GL
--       70.533, CX550M 61.062). With top_k_per_role = 5, retention keeps 5 per
--       role, so only 3 of the 20 new GPUs and 3 of the 9 new PSUs survive the
--       pool cut (17 and 6 never leave it), and assembly drops one more GPU,
--       so just 2 GPUs and 3 PSUs reach a build. The new catalog is not merely
--       ranked lower - it is mostly unreachable.
--
--       REPRODUCIBILITY HAZARD: the flat-40 tie falls to retainTopKPerRole's
--       Rule 5 chain, whose first differing key is product_id, and product.id
--       is `UUID ... DEFAULT gen_random_uuid()` (migration 003). WHICH tied
--       product survives the K cut is therefore the lexicographic order of
--       random UUIDs (verified: the 3 surviving new PSUs are exactly the 3
--       smallest UUIDs of the 9). The reachable subset of this expansion is
--       NOT stable across a database reset, so any measurement that depends on
--       WHICH new products reach a build (e.g. the Decision 23 O1 acceptance
--       reach figures) is valid only for the instance it was taken on.
--
--       Seed 003 (GPU/PSU connector + dimension data) canNOT close this gap:
--       candidate_score comes only from component_assessment, and 003 only
--       moves a pair verdict UNKNOWN -> PASS|FAIL (never FAIL -> PASS), so it
--       adds no reach - it only makes the already-retained pairs decisive.
--
--       BLOCKING ITEM: the assessment research named above was never supplied
--       and is the ONLY change that lets this expansion influence scores. It
--       must be OBTAINED, never invented (D1/D6/D7 forbid guessing), before the
--       20 GPUs and 9 PSUs can become scoring-relevant. A later seed file must
--       supply real
--       assessments covering EVERY type in role_weights[role] (CPU/GPU/RAM/
--       SSD: PERFORMANCE+VALUE+QUALITY; MOTHERBOARD: QUALITY+VALUE+
--       UPGRADEABILITY; PSU: QUALITY+EFFICIENCY+VALUE; CASE: QUALITY+VALUE+
--       THERMALS; CPU_COOLER: THERMALS+QUALITY+VALUE) with a FRESH
--       assessed_at (decay 0.5%/day capped at 180 days: an 80 score at 180+
--       days decays to 8) and a non-NULL confidence (NULL fails fast).
--       For the unbranded parts (HYBROK/Connect PSUs, Innovation IT/TwinMOS/
--       Intenso/Netac/Hiksemi) QUALITY is the ONLY quality gate the engine
--       has - do not seed it optimistically.
--
--   D3. CPU `product_family` granularity = SUPPORT-RULE granularity. The
--       engine matches cpu_motherboard_support rows by product_family_id
--       (filtering/filter.js:373), never by name, so one family must not span
--       two different board-support rules. Ryzen 5 3400G gets its own family
--       (`Seed AMD Ryzen 5 3000G`) instead of sharing `Seed AMD Ryzen 3000`
--       with the Ryzen 5 3500X. `Seed AMD Ryzen 4000G` is created with no
--       product so the A520/B550 "4000G PASS" rows have a target; those rows
--       are inert until such a CPU is added.
--
--   D4. `case_radiator_support` is LOAD-BEARING, not documentation: a liquid
--       cooler + a case with ZERO radiator rows is a HARD FAIL
--       (compatibility/case-radiator.js:194-201; decision log 104-128), while
--       a case WITH rows but no matching size is UNKNOWN. The required size
--       can never be established (context-loader.js:363 pins it to null), so
--       this check can never PASS. Only the 2 researched Corsair Frame 4000D
--       cases have documented positions, so the other 6 new cases get NO
--       radiator rows and the 5 new LIQUID coolers are hard-FAILed in
--       combination with them at assembly time. Fix by capturing the missing
--       radiator matrices - never by inventing rows, never by seeding
--       cooling_type NULL to dodge the rule.
--
--   D5. Cooler `max_tdp_watts`/`height_mm` are seeded but NOT consumed by any
--       engine code today: the documented cooler-TDP hard reject
--       (ARCHITECTURE 5.3/7) and the air-cooler-height rule are unimplemented
--       (no src/ reference to max_tdp_watts or max_cpu_cooler_height_mm).
--       Forward-looking data, not enforcement.
--
--   D6. GPU `required_power_connectors`, `width_slots`, `height_mm` stay NULL
--       (never captured), so GPU<->PSU connector and GPU<->case thickness
--       resolve UNKNOWN. GPU<->case LENGTH and GPU<->PSU WATTAGE are live
--       (board length + recommended PSU watts, all 20 boards, from research).
--       CONNECTOR VOCABULARY for later: the engine only knows
--       {24pin_atx, eps, pcie_8pin, 12vhpwr, sata}
--       (compatibility/gpu.js:13-19); map the research's `8-pin` to
--       pcie_8pin and `12V-2x6` to 12vhpwr.
--
--   D7. Research-filled fields (catalog UNKNOWN, companion research
--       unambiguous): GPU board length/TGP/recPSU (20), case clearance
--       matrices, PSU 140 mm length + modularity (9), cooler TDP + dims, and
--       LPC B650 max memory 192 GB + min speed 4800 MT/s. Catalog wins on
--       conflicts (flagged inline): TWINMOS voltage 1.35 vs 1.2; Z790 max
--       memory 256 GB vs 192 GB; Nautilus dims 125/275/125 vs 27/277/120;
--       240R radiator length 274 vs 277; ZOTAC 220.5 mm -> 221 (INTEGER).
--
--   D8. Offers use the two existing 001 stores; seller_name/product_url stay
--       NULL (research captured category-level links only). GPU offers are
--       variant-keyed, all others product-keyed (Stage 1 exact-match rule).
--
-- Deliberately not included: component_assessment (D2), price_history (no
-- engine consumer; 001's blanket backfill attaches a history row to these
-- offers on the next `npm run seed`), spec_provenance (optional audit trail).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Manufacturers (19 new; AMD/NVIDIA/MSI/Gigabyte/Corsair/Samsung/Western
-- Digital/DeepCool already exist from 001)
-- ---------------------------------------------------------------------------

INSERT INTO manufacturer (name)
SELECT m.name FROM (VALUES
    ('Intel'),
    ('PNY'),
    ('ASUS'),
    ('ASRock'),
    ('Zotac'),
    ('Lexar'),
    ('Kingston'),
    ('TeamGroup'),
    ('Crucial'),
    ('Intenso'),
    ('Netac'),
    ('Hiksemi'),
    ('Antec'),
    ('HYBROK'),
    ('Connect'),
    ('Innovation IT'),
    ('TwinMOS'),
    ('Cooler Master'),
    ('LPC')
) AS m(name)
WHERE NOT EXISTS (SELECT 1 FROM manufacturer WHERE manufacturer.name = m.name);

-- ---------------------------------------------------------------------------
-- Sockets / memory types / platforms. AM4 + LGA1700 + DDR4 are new;
-- AM5/DDR5 and `Seed AMD AM5` are reused from 001. One platform row per
-- socket is REQUIRED: the filtering context maps a socket to a platform only
-- when exactly one platform row exists (filtering/context-loader.js), so do
-- not add a second AM4/LGA1700 platform row later.
-- ---------------------------------------------------------------------------

INSERT INTO socket (name)
SELECT s.name FROM (VALUES ('AM4'), ('LGA1700')) AS s(name)
WHERE NOT EXISTS (SELECT 1 FROM socket WHERE socket.name = s.name);

INSERT INTO memory_type (name)
SELECT t.name FROM (VALUES ('DDR4')) AS t(name)
WHERE NOT EXISTS (SELECT 1 FROM memory_type WHERE memory_type.name = t.name);

INSERT INTO platform (name, socket_id)
SELECT p.name, s.id
FROM (VALUES
    ('Seed AMD AM4',       'AM4'),
    ('Seed Intel LGA1700', 'LGA1700')
) AS p(name, sock)
JOIN socket s ON s.name = p.sock
WHERE NOT EXISTS (SELECT 1 FROM platform pl WHERE pl.name = p.name);

-- platform_memory_support is presence-only, and a platform that HAS rows
-- excluding the requested type is a FAIL (positive exclusion evidence,
-- compatibility/memory.js:98-110) - which is what we want for AM4 (DDR4 only)
-- and for the DDR5-only Z790 board. `Seed AMD AM5 + DDR5` is listed again only
-- so the block is self-documenting; the guard makes it a no-op.
INSERT INTO platform_memory_support (platform_id, memory_type_id)
SELECT pl.id, mt.id
FROM (VALUES
    ('Seed AMD AM5',       'DDR5'),
    ('Seed AMD AM4',       'DDR4'),
    ('Seed Intel LGA1700', 'DDR5'),
    ('Seed Intel LGA1700', 'DDR4')
) AS v(pname, mtname)
JOIN platform pl ON pl.name = v.pname
JOIN memory_type mt ON mt.name = v.mtname
WHERE NOT EXISTS (
    SELECT 1 FROM platform_memory_support pms
    WHERE pms.platform_id = pl.id AND pms.memory_type_id = mt.id
);

-- ---------------------------------------------------------------------------
-- Chipsets. `chipset.manufacturer` is the BOARD VENDOR in this schema (001
-- precedent: 001 seeds 'AMD B650' under Gigabyte), because the unique key is
-- (manufacturer_id, name). The LPC B650 board therefore needs its own
-- 'AMD B650' row, distinct from 001's Gigabyte row.
-- ---------------------------------------------------------------------------

INSERT INTO chipset (manufacturer_id, name)
SELECT m.id, v.name
FROM (VALUES
    ('MSI', 'AMD A520'),
    ('MSI', 'AMD B550'),
    ('MSI', 'Intel Z790'),
    ('LPC', 'AMD B650')
) AS v(mfr, name)
JOIN manufacturer m ON m.name = v.mfr
WHERE NOT EXISTS (
    SELECT 1 FROM chipset c
    WHERE c.manufacturer_id = m.id AND c.name = v.name
);

-- ---------------------------------------------------------------------------
-- GPU chipsets (silicon level). VRAM variants need DISTINCT names because the
-- unique key is (manufacturer_id, name). base_tgp_watts is the reference board
-- TGP; the RX 9060 XT value was never established -> NULL, never guessed.
-- ---------------------------------------------------------------------------

INSERT INTO gpu_chipset (manufacturer_id, name, vram_capacity_gb, vram_type,
    memory_bus_width_bit, pcie_interface, base_tgp_watts)
SELECT m.id, v.name, v.vram, v.vtype, v.bus, v.pcie, v.tgp
FROM (VALUES
    ('NVIDIA', 'RTX 5060',           8, 'GDDR7', 128, 'PCIe 5.0 x8',  145),
    ('NVIDIA', 'RTX 5060 Ti 8GB',    8, 'GDDR7', 128, 'PCIe 5.0 x8',  180),
    ('NVIDIA', 'RTX 5060 Ti 16GB',  16, 'GDDR7', 128, 'PCIe 5.0 x8',  180),
    ('NVIDIA', 'RTX 5070',          12, 'GDDR7', 192, 'PCIe 5.0 x16', 250),
    ('NVIDIA', 'RTX 5070 Ti',       16, 'GDDR7', 256, 'PCIe 5.0 x16', 300),
    ('NVIDIA', 'RTX 5080',          16, 'GDDR7', 256, 'PCIe 5.0 x16', 360),
    ('NVIDIA', 'RTX 5090',          32, 'GDDR7', 512, 'PCIe 5.0 x16', 575),
    ('AMD',    'Radeon RX 9060 XT', 16, 'GDDR6', 128, 'PCIe 5.0 x16', NULL::INTEGER)
) AS v(mfr, name, vram, vtype, bus, pcie, tgp)
JOIN manufacturer m ON m.name = v.mfr
WHERE NOT EXISTS (
    SELECT 1 FROM gpu_chipset g
    WHERE g.manufacturer_id = m.id AND g.name = v.name
);

-- ---------------------------------------------------------------------------
-- Product families (natural key: name; guarded by name, so names must be
-- globally unique - the RAM families are therefore manufacturer-qualified).
-- Granularity: CPU families follow BOARD-SUPPORT rules (D3); every other role
-- uses product-line granularity. 61 families (8 CPU + 16 GPU + 4 motherboard
-- + 5 RAM + 15 SSD + 5 PSU + 3 case + 5 cooler); the cooler role uses 5
-- product-line families rather than 4 because MSI's air and liquid lines are
-- unrelated products.
-- NOTE: product_family has no unique index at all; this guard IS the
-- protection against duplicates.
-- ---------------------------------------------------------------------------

INSERT INTO product_family (name, manufacturer_id)
SELECT f.name, m.id
FROM manufacturer m, (VALUES
    ('Seed AMD Ryzen 3000',             'AMD'),
    ('Seed AMD Ryzen 5 3000G',          'AMD'),
    ('Seed AMD Ryzen 4000G',            'AMD'),
    ('Seed AMD Ryzen 5000',             'AMD'),
    ('Seed AMD Ryzen 5000G',            'AMD'),
    ('Seed AMD Ryzen 7000',             'AMD'),
    ('Seed AMD Ryzen 8000',             'AMD'),
    ('Seed Intel Core 12th Gen',        'Intel'),
    ('Seed MSI GeForce RTX 5070',       'MSI'),
    ('Seed MSI GeForce RTX 5080',       'MSI'),
    ('Seed MSI GeForce RTX 5060',       'MSI'),
    ('Seed MSI GeForce RTX 5060 Ti',    'MSI'),
    ('Seed MSI GeForce RTX 5070 Ti',    'MSI'),
    ('Seed Gigabyte GeForce RTX 5080',  'Gigabyte'),
    ('Seed Gigabyte GeForce RTX 5060',  'Gigabyte'),
    ('Seed Gigabyte GeForce RTX 5070',  'Gigabyte'),
    ('Seed PNY GeForce RTX 5060 Ti',    'PNY'),
    ('Seed PNY GeForce RTX 5060',       'PNY'),
    ('Seed PNY GeForce RTX 5080',       'PNY'),
    ('Seed Zotac GeForce RTX 5060 Ti',  'Zotac'),
    ('Seed Zotac GeForce RTX 5080',     'Zotac'),
    ('Seed ASUS GeForce RTX 5090',      'ASUS'),
    ('Seed ASUS GeForce RTX 5070 Ti',   'ASUS'),
    ('Seed ASRock Radeon RX 9060 XT',   'ASRock'),
    ('Seed MSI A520 Motherboards',      'MSI'),
    ('Seed MSI B550 Motherboards',      'MSI'),
    ('Seed MSI Z790 Motherboards',      'MSI'),
    ('Seed LPC B650 Motherboards',      'LPC'),
    ('Seed Lexar DDR4 3200',            'Lexar'),
    ('Seed Innovation IT DDR4 3200',    'Innovation IT'),
    ('Seed Corsair Vengeance LPX DDR4', 'Corsair'),
    ('Seed Corsair Vengeance RGB Pro DDR4', 'Corsair'),
    ('Seed TwinMOS DDR4 3200',          'TwinMOS'),
    ('Seed Crucial E100',               'Crucial'),
    ('Seed Hiksemi Wave',               'Hiksemi'),
    ('Seed Kingston NV3',               'Kingston'),
    ('Seed Crucial P310',               'Crucial'),
    ('Seed Lexar NM620',                'Lexar'),
    ('Seed Samsung 9100 PRO',           'Samsung'),
    ('Seed TeamGroup MP33',             'TeamGroup'),
    ('Seed Intenso Premium',            'Intenso'),
    ('Seed MSI SPATIUM M371',           'MSI'),
    ('Seed MSI SPATIUM M450',           'MSI'),
    ('Seed Netac N930E Pro',            'Netac'),
    ('Seed TeamGroup T-FORCE CARDEA Z44L', 'TeamGroup'),
    ('Seed WD_BLACK SN770',             'Western Digital'),
    ('Seed Samsung SSD 980',            'Samsung'),
    ('Seed Kingston NV2',               'Kingston'),
    ('Seed Corsair RMx/RMe PSUs',       'Corsair'),
    ('Seed Antec PSUs',                 'Antec'),
    ('Seed MSI MAG PSUs',               'MSI'),
    ('Seed HYBROK PSUs',                'HYBROK'),
    ('Seed Connect PSUs',               'Connect'),
    ('Seed Corsair Frame 4000D Cases',  'Corsair'),
    ('Seed Corsair 3500X Cases',        'Corsair'),
    ('Seed MSI Mid-Tower Cases',        'MSI'),
    ('Seed MSI MAG COREFROZR Coolers',  'MSI'),
    ('Seed MSI MAG CoreLiquid Coolers', 'MSI'),
    ('Seed Corsair Nautilus Coolers',   'Corsair'),
    ('Seed DeepCool MYSTIQUE Coolers',  'DeepCool'),
    ('Seed Cooler Master MasterLiquid Coolers', 'Cooler Master')
) AS f(name, mfr)
WHERE m.name = f.mfr
AND NOT EXISTS (SELECT 1 FROM product_family pf WHERE pf.name = f.name);

-- ---------------------------------------------------------------------------
-- Products (natural key: name; all ACTIVE so the Engine 2B loader picks them).
-- Names are the catalog's exact listing names with the `Seed ` prefix.
-- Part 1/3: CPU (16) + GPU (20).
-- ---------------------------------------------------------------------------

INSERT INTO product (product_family_id, manufacturer_id, name, lifecycle_status)
SELECT pf.id, m.id, p.name, 'ACTIVE'
FROM (VALUES
    -- CPU (16)
    ('Seed AMD Ryzen 5 5600',            'Seed AMD Ryzen 5000',        'AMD'),
    ('Seed AMD Ryzen 5 5500',            'Seed AMD Ryzen 5000',        'AMD'),
    ('Seed AMD Ryzen 5 5600X',           'Seed AMD Ryzen 5000',        'AMD'),
    ('Seed AMD Ryzen 5 3400G',           'Seed AMD Ryzen 5 3000G',     'AMD'),
    ('Seed AMD Ryzen 5 PRO 5655G',       'Seed AMD Ryzen 5000G',       'AMD'),
    ('Seed AMD Ryzen 5 3500X',           'Seed AMD Ryzen 3000',        'AMD'),
    ('Seed AMD Ryzen 7 5700X',           'Seed AMD Ryzen 5000',        'AMD'),
    ('Seed AMD Ryzen 7 5700G',           'Seed AMD Ryzen 5000G',       'AMD'),
    ('Seed AMD Ryzen 7 5800X',           'Seed AMD Ryzen 5000',        'AMD'),
    ('Seed AMD Ryzen 9 5900X',           'Seed AMD Ryzen 5000',        'AMD'),
    ('Seed AMD Ryzen 9 5950X',           'Seed AMD Ryzen 5000',        'AMD'),
    ('Seed AMD Ryzen 7 7700X',           'Seed AMD Ryzen 7000',        'AMD'),
    ('Seed AMD Ryzen 7 7800X3D',         'Seed AMD Ryzen 7000',        'AMD'),
    ('Seed AMD Ryzen 7 8700F',           'Seed AMD Ryzen 8000',        'AMD'),
    ('Seed Intel Core i5-12400F',        'Seed Intel Core 12th Gen',   'Intel'),
    ('Seed Intel Core i7-12700KF',       'Seed Intel Core 12th Gen',   'Intel'),
    -- GPU (20)
    ('Seed MSI GeForce RTX 5070 12 GB VENTUS 2X',      'Seed MSI GeForce RTX 5070',      'MSI'),
    ('Seed MSI GeForce RTX 5060 8 GB VENTUS 2X',       'Seed MSI GeForce RTX 5060',      'MSI'),
    ('Seed MSI GeForce RTX 5080 16 GB VENTUS 3X',      'Seed MSI GeForce RTX 5080',      'MSI'),
    ('Seed GIGABYTE GeForce RTX 5080 16 GB GAMING OC', 'Seed Gigabyte GeForce RTX 5080', 'Gigabyte'),
    ('Seed GIGABYTE GeForce RTX 5060 8 GB',            'Seed Gigabyte GeForce RTX 5060', 'Gigabyte'),
    ('Seed MSI GeForce RTX 5060 Ti 8 GB VENTUS 2X',    'Seed MSI GeForce RTX 5060 Ti',   'MSI'),
    ('Seed GIGABYTE GeForce RTX 5070 12 GB',           'Seed Gigabyte GeForce RTX 5070', 'Gigabyte'),
    ('Seed MSI GeForce RTX 5070 12 GB GAMING TRIO',    'Seed MSI GeForce RTX 5070',      'MSI'),
    ('Seed MSI GeForce RTX 5070 Ti 16 GB VENTUS 3X',   'Seed MSI GeForce RTX 5070 Ti',   'MSI'),
    ('Seed PNY GeForce RTX 5060 Ti 8 GB DUAL',         'Seed PNY GeForce RTX 5060 Ti',   'PNY'),
    ('Seed ASUS GeForce RTX 5090 32 GB TUF GAMING',    'Seed ASUS GeForce RTX 5090',     'ASUS'),
    ('Seed GIGABYTE GeForce RTX 5070 12 GB EAGLE OC',  'Seed Gigabyte GeForce RTX 5070', 'Gigabyte'),
    ('Seed PNY GeForce RTX 5060 8 GB',                 'Seed PNY GeForce RTX 5060',      'PNY'),
    ('Seed PNY GeForce RTX 5080 16 GB',                'Seed PNY GeForce RTX 5080',      'PNY'),
    ('Seed ZOTAC GeForce RTX 5060 Ti 16 GB TWIN EDGE', 'Seed Zotac GeForce RTX 5060 Ti', 'Zotac'),
    ('Seed ZOTAC GeForce RTX 5080 16 GB',              'Seed Zotac GeForce RTX 5080',    'Zotac'),
    ('Seed GIGABYTE GeForce RTX 5080 16 GB',           'Seed Gigabyte GeForce RTX 5080', 'Gigabyte'),
    ('Seed ASROCK Radeon RX 9060 XT 16 GB',            'Seed ASRock Radeon RX 9060 XT',  'ASRock'),
    ('Seed MSI GeForce RTX 5080 16 GB SHADOW 3X',      'Seed MSI GeForce RTX 5080',      'MSI'),
    ('Seed ASUS GeForce RTX 5070 Ti 16 GB PRIME',      'Seed ASUS GeForce RTX 5070 Ti',  'ASUS')
) AS p(name, family, mfr)
JOIN product_family pf ON pf.name = p.family
JOIN manufacturer m ON m.name = p.mfr
WHERE NOT EXISTS (SELECT 1 FROM product pr WHERE pr.name = p.name);

-- ---------------------------------------------------------------------------
-- Part 2/4: Motherboard (5) + RAM (5) + Boot SSD (15).
-- ---------------------------------------------------------------------------

INSERT INTO product (product_family_id, manufacturer_id, name, lifecycle_status)
SELECT pf.id, m.id, p.name, 'ACTIVE'
FROM (VALUES
    -- Motherboard (5)
    ('Seed MSI A520M A-PRO',              'Seed MSI A520 Motherboards', 'MSI'),
    ('Seed MSI B550M PRO-VDH',            'Seed MSI B550 Motherboards', 'MSI'),
    ('Seed MSI B550M PRO-VDH WIFI',       'Seed MSI B550 Motherboards', 'MSI'),
    ('Seed MSI Z790 GAMING PLUS WIFI',    'Seed MSI Z790 Motherboards', 'MSI'),
    ('Seed LPC Gaming B650 DDR5',         'Seed LPC B650 Motherboards', 'LPC'),
    -- RAM (5)
    ('Seed LEXAR DDR4 3200MHz 16GB 1x16 CL22',                    'Seed Lexar DDR4 3200',            'Lexar'),
    ('Seed INNOVATION IT DDR4 3200MHz 8GB 1x8 CL22',              'Seed Innovation IT DDR4 3200',    'Innovation IT'),
    ('Seed CORSAIR VENGEANCE LPX DDR4 3200MHz 16GB 1x16 CL16',    'Seed Corsair Vengeance LPX DDR4', 'Corsair'),
    ('Seed CORSAIR VENGEANCE RGB PRO DDR4 3200MHz 16GB 2x8 CL16', 'Seed Corsair Vengeance RGB Pro DDR4', 'Corsair'),
    ('Seed TWINMOS DDR4 3200MHz 16GB 1x16 CL16',                  'Seed TwinMOS DDR4 3200',          'TwinMOS'),
    -- Boot SSD (15)
    ('Seed CRUCIAL E100 1TB NVMe',                    'Seed Crucial E100',   'Crucial'),
    ('Seed HIKSEMI WAVE 512GB NVMe',                  'Seed Hiksemi Wave',   'Hiksemi'),
    ('Seed KINGSTON NV3 1TB NVMe',                    'Seed Kingston NV3',   'Kingston'),
    ('Seed CRUCIAL P310 2TB NVMe',                    'Seed Crucial P310',   'Crucial'),
    ('Seed LEXAR NM620 512GB NVMe',                   'Seed Lexar NM620',    'Lexar'),
    ('Seed SAMSUNG 9100 PRO 4TB NVMe',                'Seed Samsung 9100 PRO','Samsung'),
    ('Seed TeamGroup MP33 1TB',                       'Seed TeamGroup MP33', 'TeamGroup'),
    ('Seed Intenso Premium 1TB',                      'Seed Intenso Premium','Intenso'),
    ('Seed MSI SPATIUM M371 1TB',                     'Seed MSI SPATIUM M371','MSI'),
    ('Seed MSI SPATIUM M450 1TB',                     'Seed MSI SPATIUM M450','MSI'),
    ('Seed Netac N930E Pro 1TB',                      'Seed Netac N930E Pro','Netac'),
    ('Seed TeamGroup T-FORCE CARDEA Z44L 1TB',        'Seed TeamGroup T-FORCE CARDEA Z44L', 'TeamGroup'),
    ('Seed WD_BLACK SN770 1TB',                       'Seed WD_BLACK SN770', 'Western Digital'),
    ('Seed Samsung SSD 980 1TB',                      'Seed Samsung SSD 980','Samsung'),
    ('Seed Kingston NV2 1TB',                         'Seed Kingston NV2',   'Kingston')
) AS p(name, family, mfr)
JOIN product_family pf ON pf.name = p.family
JOIN manufacturer m ON m.name = p.mfr
WHERE NOT EXISTS (SELECT 1 FROM product pr WHERE pr.name = p.name);

-- ---------------------------------------------------------------------------
-- Part 3/4: PSU (9) + Case (8) + CPU cooler (7).
-- NOTE: `Seed MSI MAG A750GL PCIE5 750W` is deliberately a SECOND row beside
-- 001's `Seed MSI MAG A750GL 750W` (1,100 MAD) - same real-world unit, two
-- listing names. 001's twin is ASSESSED (QUALITY 88 / EFFICIENCY 85) and this
-- one is not, so the newcomer cannot win a ranking today.
-- ---------------------------------------------------------------------------

INSERT INTO product (product_family_id, manufacturer_id, name, lifecycle_status)
SELECT pf.id, m.id, p.name, 'ACTIVE'
FROM (VALUES
    -- PSU (9)
    ('Seed Corsair RM1000e 1000W',                   'Seed Corsair RMx/RMe PSUs', 'Corsair'),
    ('Seed Antec CSK1000 PRO EC ATX3.1 1000W Bronze','Seed Antec PSUs',          'Antec'),
    ('Seed Antec G850 850W Gold',                    'Seed Antec PSUs',          'Antec'),
    ('Seed Corsair RM750e 750W',                     'Seed Corsair RMx/RMe PSUs', 'Corsair'),
    ('Seed Corsair RM850e 850W',                     'Seed Corsair RMx/RMe PSUs', 'Corsair'),
    ('Seed MSI MAG A750GL PCIE5 750W',               'Seed MSI MAG PSUs',        'MSI'),
    ('Seed MSI MAG A650BN 650W',                     'Seed MSI MAG PSUs',        'MSI'),
    ('Seed HYBROK PSU 650 Bronze',                   'Seed HYBROK PSUs',         'HYBROK'),
    ('Seed Connect PSU 850 Bronze',                  'Seed Connect PSUs',        'Connect'),
    -- Case (8)
    ('Seed CORSAIR Frame 4000D RS ARGB Black',      'Seed Corsair Frame 4000D Cases', 'Corsair'),
    ('Seed CORSAIR Frame 4000D RS ARGB White',      'Seed Corsair Frame 4000D Cases', 'Corsair'),
    ('Seed Corsair 3500X White',                    'Seed Corsair 3500X Cases', 'Corsair'),
    ('Seed Corsair 3500X Black',                    'Seed Corsair 3500X Cases', 'Corsair'),
    ('Seed Corsair iCUE LINK 3500X ARGB White',     'Seed Corsair 3500X Cases', 'Corsair'),
    ('Seed MSI MAG PANO 100R PZ Blanc',             'Seed MSI Mid-Tower Cases', 'MSI'),
    ('Seed MSI MPG VELOX 100R WHITE',               'Seed MSI Mid-Tower Cases', 'MSI'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White',       'Seed MSI Mid-Tower Cases', 'MSI'),
    -- CPU cooler (7)
    ('Seed MSI MAG COREFROZR AA13 WHITE',           'Seed MSI MAG COREFROZR Coolers', 'MSI'),
    ('Seed MSI MAG COREFROZR AA13 BLACK',           'Seed MSI MAG COREFROZR Coolers', 'MSI'),
    ('Seed MSI MAG CoreLiquid A13 360 White AIO',   'Seed MSI MAG CoreLiquid Coolers','MSI'),
    ('Seed Corsair Nautilus 240 RS ARGB Black AIO', 'Seed Corsair Nautilus Coolers',  'Corsair'),
    ('Seed DeepCool MYSTIQUE 360 Black AIO',        'Seed DeepCool MYSTIQUE Coolers', 'DeepCool'),
    ('Seed Cooler Master MasterLiquid ML280 Mirror','Seed Cooler Master MasterLiquid Coolers', 'Cooler Master'),
    ('Seed MSI MAG CORELIQUID 240R',                'Seed MSI MAG CoreLiquid Coolers','MSI')
) AS p(name, family, mfr)
JOIN product_family pf ON pf.name = p.family
JOIN manufacturer m ON m.name = p.mfr
WHERE NOT EXISTS (SELECT 1 FROM product pr WHERE pr.name = p.name);

-- ---------------------------------------------------------------------------
-- GPU: one product + one STANDARD variant per new board (variant-keyed
-- candidates/prices). Internal SEED- SKUs: the real manufacturer part numbers
-- were never captured, so these are placeholders and must be replaced when
-- MPNs are obtained (sku is the unique natural key).
-- ---------------------------------------------------------------------------

INSERT INTO product_variant (product_id, sku, variant_type, support_status)
SELECT p.id, v.sku, 'STANDARD', 'ACTIVE'
FROM (VALUES
    ('Seed MSI GeForce RTX 5070 12 GB VENTUS 2X',      'SEED-MSI-RTX5070-VENTUS2X'),
    ('Seed MSI GeForce RTX 5060 8 GB VENTUS 2X',       'SEED-MSI-RTX5060-VENTUS2X'),
    ('Seed MSI GeForce RTX 5080 16 GB VENTUS 3X',      'SEED-MSI-RTX5080-VENTUS3X'),
    ('Seed GIGABYTE GeForce RTX 5080 16 GB GAMING OC', 'SEED-GB-RTX5080-GAMINGOC'),
    ('Seed GIGABYTE GeForce RTX 5060 8 GB',            'SEED-GB-RTX5060-STD'),
    ('Seed MSI GeForce RTX 5060 Ti 8 GB VENTUS 2X',    'SEED-MSI-RTX5060TI8-VENTUS2X'),
    ('Seed GIGABYTE GeForce RTX 5070 12 GB',           'SEED-GB-RTX5070-STD'),
    ('Seed MSI GeForce RTX 5070 12 GB GAMING TRIO',    'SEED-MSI-RTX5070-GAMINGTRIO'),
    ('Seed MSI GeForce RTX 5070 Ti 16 GB VENTUS 3X',   'SEED-MSI-RTX5070TI-VENTUS3X'),
    ('Seed PNY GeForce RTX 5060 Ti 8 GB DUAL',         'SEED-PNY-RTX5060TI8-DUAL'),
    ('Seed ASUS GeForce RTX 5090 32 GB TUF GAMING',    'SEED-ASUS-RTX5090-TUF'),
    ('Seed GIGABYTE GeForce RTX 5070 12 GB EAGLE OC',  'SEED-GB-RTX5070-EAGLEOC'),
    ('Seed PNY GeForce RTX 5060 8 GB',                 'SEED-PNY-RTX5060-STD'),
    ('Seed PNY GeForce RTX 5080 16 GB',                'SEED-PNY-RTX5080-STD'),
    ('Seed ZOTAC GeForce RTX 5060 Ti 16 GB TWIN EDGE', 'SEED-ZOT-RTX5060TI16-TWINEDGE'),
    ('Seed ZOTAC GeForce RTX 5080 16 GB',              'SEED-ZOT-RTX5080-STD'),
    ('Seed GIGABYTE GeForce RTX 5080 16 GB',           'SEED-GB-RTX5080-STD'),
    ('Seed ASROCK Radeon RX 9060 XT 16 GB',            'SEED-ASR-RX9060XT16-STD'),
    ('Seed MSI GeForce RTX 5080 16 GB SHADOW 3X',      'SEED-MSI-RTX5080-SHADOW3X'),
    ('Seed ASUS GeForce RTX 5070 Ti 16 GB PRIME',      'SEED-ASUS-RTX5070TI-PRIME')
) AS v(pname, sku)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (SELECT 1 FROM product_variant pv WHERE pv.sku = v.sku);

-- gpu_board_spec: board_tgp_watts / length_mm / recommended_psu_watts come
-- from the companion research (all 20 boards captured). width_slots,
-- height_mm and required_power_connectors are OMITTED -> stay NULL (D6), so
-- GPU<->case thickness and GPU<->PSU connector checks resolve UNKNOWN while
-- LENGTH and WATTAGE are enforced. ZOTAC TWIN EDGE is 220.5 mm in the source;
-- rounded to 221 for the INTEGER column.
-- ---------------------------------------------------------------------------

INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id, board_tgp_watts,
    length_mm, recommended_psu_watts)
SELECT pv.id, g.id, v.tgp, v.len, v.recpsu
FROM (VALUES
    ('SEED-MSI-RTX5070-VENTUS2X',     'RTX 5070',           250, 236,  650),
    ('SEED-MSI-RTX5060-VENTUS2X',     'RTX 5060',           145, 197,  550),
    ('SEED-MSI-RTX5080-VENTUS3X',     'RTX 5080',           360, 304,  850),
    ('SEED-GB-RTX5080-GAMINGOC',      'RTX 5080',           360, 340,  850),
    ('SEED-GB-RTX5060-STD',           'RTX 5060',           145, 280,  550),
    ('SEED-MSI-RTX5060TI8-VENTUS2X',  'RTX 5060 Ti 8GB',    180, 242,  600),
    ('SEED-GB-RTX5070-STD',           'RTX 5070',           250, 265,  650),
    ('SEED-MSI-RTX5070-GAMINGTRIO',   'RTX 5070',           250, 338,  650),
    ('SEED-MSI-RTX5070TI-VENTUS3X',   'RTX 5070 Ti',        300, 303,  750),
    ('SEED-PNY-RTX5060TI8-DUAL',      'RTX 5060 Ti 8GB',    180, 245,  600),
    ('SEED-ASUS-RTX5090-TUF',         'RTX 5090',           575, 348, 1000),
    ('SEED-GB-RTX5070-EAGLEOC',       'RTX 5070',           250, 290,  650),
    ('SEED-PNY-RTX5060-STD',          'RTX 5060',           145, 245,  550),
    ('SEED-PNY-RTX5080-STD',          'RTX 5080',           360, 300,  850),
    ('SEED-ZOT-RTX5060TI16-TWINEDGE', 'RTX 5060 Ti 16GB',   180, 221,  600),
    ('SEED-ZOT-RTX5080-STD',          'RTX 5080',           360, 245,  850),
    ('SEED-GB-RTX5080-STD',           'RTX 5080',           360, 304,  850),
    ('SEED-ASR-RX9060XT16-STD',       'Radeon RX 9060 XT',  160, 303,  550),
    ('SEED-MSI-RTX5080-SHADOW3X',     'RTX 5080',           360, 303,  850),
    ('SEED-ASUS-RTX5070TI-PRIME',     'RTX 5070 Ti',        300, 304,  750)
) AS v(sku, chipset, tgp, len, recpsu)
JOIN product_variant pv ON pv.sku = v.sku
JOIN gpu_chipset g ON g.name = v.chipset
WHERE NOT EXISTS (SELECT 1 FROM gpu_board_spec b WHERE b.product_variant_id = pv.id);

-- ---------------------------------------------------------------------------
-- CPU specs (16). pbp_mtp_watts is a single INTEGER column, so the Intel
-- "65 / 117" and "125 / 190" pairs are stored as PBP only (65 / 125); the
-- turbo figure has no column. AMD rows leave it NULL.
-- ---------------------------------------------------------------------------

INSERT INTO cpu_spec (product_id, socket_id, cores, threads, base_clock_mhz,
    boost_clock_mhz, tdp_watts, pbp_mtp_watts, memory_channels,
    max_official_memory_speed_mtps, pcie_generation, integrated_gpu_present,
    integrated_gpu_model)
SELECT p.id, s.id, v.cores, v.threads, v.base_mhz, v.boost_mhz, v.tdp_watts,
    v.pbp, 2, v.mem_mtps, v.pcie, v.igpu, v.igpu_model
FROM (VALUES
    ('Seed AMD Ryzen 5 5600',      'AM4',      6, 12, 3500, 4400,  65, NULL, 3200, 4, false, NULL),
    ('Seed AMD Ryzen 5 5500',      'AM4',      6, 12, 3600, 4200,  65, NULL, 3200, 3, false, NULL),
    ('Seed AMD Ryzen 5 5600X',     'AM4',      6, 12, 3700, 4600,  65, NULL, 3200, 4, false, NULL),
    ('Seed AMD Ryzen 5 3400G',     'AM4',      4,  8, 3700, 4200,  65, NULL, 2933, 3, true,  'Radeon Vega 11'),
    ('Seed AMD Ryzen 5 PRO 5655G', 'AM4',      6, 12, 3900, 4400,  65, NULL, 3200, 3, true,  'Radeon Vega 7'),
    ('Seed AMD Ryzen 5 3500X',     'AM4',      6,  6, 3600, 4100,  65, NULL, 3200, 4, false, NULL),
    ('Seed AMD Ryzen 7 5700X',     'AM4',      8, 16, 3400, 4600,  65, NULL, 3200, 4, false, NULL),
    ('Seed AMD Ryzen 7 5700G',     'AM4',      8, 16, 3800, 4600,  65, NULL, 3200, 3, true,  'Radeon Vega 8'),
    ('Seed AMD Ryzen 7 5800X',     'AM4',      8, 16, 3800, 4700, 105, NULL, 3200, 4, false, NULL),
    ('Seed AMD Ryzen 9 5900X',     'AM4',     12, 24, 3700, 4800, 105, NULL, 3200, 4, false, NULL),
    ('Seed AMD Ryzen 9 5950X',     'AM4',     16, 32, 3400, 4900, 105, NULL, 3200, 4, false, NULL),
    ('Seed AMD Ryzen 7 7700X',     'AM5',      8, 16, 4500, 5400, 105, NULL, 5200, 5, true,  'Radeon Graphics'),
    ('Seed AMD Ryzen 7 7800X3D',   'AM5',      8, 16, 4200, 5000, 120, NULL, 5200, 5, true,  'Radeon Graphics'),
    ('Seed AMD Ryzen 7 8700F',     'AM5',      8, 16, 4100, 5000,  65, NULL, 5200, 4, false, NULL),
    ('Seed Intel Core i5-12400F',  'LGA1700',  6, 12, 2500, 4400,  65,   65, 4800, 5, false, NULL),
    ('Seed Intel Core i7-12700KF', 'LGA1700', 12, 20, 3600, 5000, 125,  125, 4800, 5, false, NULL)
) AS v(name, sock, cores, threads, base_mhz, boost_mhz, tdp_watts, pbp,
       mem_mtps, pcie, igpu, igpu_model)
JOIN product p ON p.name = v.name
JOIN socket s ON s.name = v.sock
WHERE NOT EXISTS (SELECT 1 FROM cpu_spec c WHERE c.product_id = p.id);

-- ---------------------------------------------------------------------------
-- Motherboard specs (5). pcie_slot_generation and bios_notes were never
-- captured -> omitted (stay NULL). Values are the catalog report's; the two
-- catalog/companion conflicts are noted inline.
-- ---------------------------------------------------------------------------

INSERT INTO motherboard_spec (product_id, socket_id, chipset_id, form_factor,
    memory_type_id, dimm_slots, max_memory_capacity_gb,
    official_memory_speed_min_mtps, official_memory_speed_max_mtps,
    pcie_x16_slots, m2_slots, sata_ports, wifi_present)
SELECT p.id, s.id, c.id, v.ff::motherboard_form_factor, mt.id, v.dimm,
    v.maxmem, v.minmtps, v.maxmtps, v.x16, v.m2, v.sata, v.wifi
FROM (VALUES
    ('Seed MSI A520M A-PRO',           'AM4',     'MSI', 'AMD A520',   'MICRO_ATX', 'DDR4', 2, 128, 1866, 4600, 1, 1, 4, false),
    ('Seed MSI B550M PRO-VDH',         'AM4',     'MSI', 'AMD B550',   'MICRO_ATX', 'DDR4', 4, 128, 1866, 4400, 1, 2, 4, false),
    ('Seed MSI B550M PRO-VDH WIFI',    'AM4',     'MSI', 'AMD B550',   'MICRO_ATX', 'DDR4', 4, 128, 1866, 4400, 1, 2, 4, true),
    -- Z790: catalog says 256 GB max and "7200+" (stored as 7200); the
    -- companion research said 192 GB - catalog wins.
    ('Seed MSI Z790 GAMING PLUS WIFI', 'LGA1700', 'MSI', 'Intel Z790', 'ATX',       'DDR5', 4, 256, 4800, 7200, 3, 4, 6, true),
    -- LPC: form factor and x16 slot count were never captured -> NULL
    -- (-> case-form-factor verdict stays UNKNOWN). Max memory 192 GB and
    -- minimum speed 4800 MT/s are research-filled (catalog had UNKNOWN).
    ('Seed LPC Gaming B650 DDR5',      'AM5',     'LPC', 'AMD B650',   NULL,        'DDR5', 4, 192, 4800, 6400, NULL, 2, 4, true)
) AS v(name, sock, mfr, chipset, ff, mem, dimm, maxmem, minmtps, maxmtps,
       x16, m2, sata, wifi)
JOIN product p ON p.name = v.name
JOIN socket s ON s.name = v.sock
JOIN manufacturer m ON m.name = v.mfr
JOIN chipset c ON c.name = v.chipset AND c.manufacturer_id = m.id
JOIN memory_type mt ON mt.name = v.mem
WHERE NOT EXISTS (SELECT 1 FROM motherboard_spec ms WHERE ms.product_id = p.id);

-- ---------------------------------------------------------------------------
-- RAM specs (5). TWINMOS voltage: catalog says 1.35 V, companion research
-- said 1.2 V - catalog wins (flagged; unverifiable either way).
-- ---------------------------------------------------------------------------

INSERT INTO ram_spec (product_id, memory_type_id, module_count,
    capacity_per_module_gb, rated_speed_mtps, voltage_v)
SELECT p.id, mt.id, v.modules, v.cap_gb, v.speed, v.volts
FROM (VALUES
    ('Seed LEXAR DDR4 3200MHz 16GB 1x16 CL22',                    1, 16, 3200, 1.20),
    ('Seed INNOVATION IT DDR4 3200MHz 8GB 1x8 CL22',              1,  8, 3200, 1.20),
    ('Seed CORSAIR VENGEANCE LPX DDR4 3200MHz 16GB 1x16 CL16',    1, 16, 3200, 1.35),
    ('Seed CORSAIR VENGEANCE RGB PRO DDR4 3200MHz 16GB 2x8 CL16', 2,  8, 3200, 1.35),
    ('Seed TWINMOS DDR4 3200MHz 16GB 1x16 CL16',                  1, 16, 3200, 1.35)
) AS v(name, modules, cap_gb, speed, volts)
JOIN product p ON p.name = v.name
JOIN memory_type mt ON mt.name = 'DDR4'
WHERE NOT EXISTS (SELECT 1 FROM ram_spec rs WHERE rs.product_id = p.id);

-- ---------------------------------------------------------------------------
-- Boot SSD specs (15). All are M.2 2280 / M.2 / NVMe per the research; only
-- capacity and PCIe generation vary.
-- ---------------------------------------------------------------------------

INSERT INTO ssd_spec (product_id, capacity_gb, form_factor, interface,
    protocol, pcie_generation)
SELECT p.id, v.cap_gb, 'M_2_2280'::ssd_form_factor, 'M.2', 'NVMe', v.gen
FROM (VALUES
    ('Seed CRUCIAL E100 1TB NVMe',             1000, 4),
    ('Seed HIKSEMI WAVE 512GB NVMe',            512, 3),
    ('Seed KINGSTON NV3 1TB NVMe',             1000, 4),
    ('Seed CRUCIAL P310 2TB NVMe',             2000, 4),
    ('Seed LEXAR NM620 512GB NVMe',             512, 3),
    ('Seed SAMSUNG 9100 PRO 4TB NVMe',         4000, 5),
    ('Seed TeamGroup MP33 1TB',                1000, 3),
    ('Seed Intenso Premium 1TB',               1000, 3),
    ('Seed MSI SPATIUM M371 1TB',              1000, 3),
    ('Seed MSI SPATIUM M450 1TB',              1000, 4),
    ('Seed Netac N930E Pro 1TB',               1000, 3),
    ('Seed TeamGroup T-FORCE CARDEA Z44L 1TB', 1000, 4),
    ('Seed WD_BLACK SN770 1TB',                1000, 4),
    ('Seed Samsung SSD 980 1TB',               1000, 3),
    ('Seed Kingston NV2 1TB',                  1000, 4)
) AS v(name, cap_gb, gen)
JOIN product p ON p.name = v.name
WHERE NOT EXISTS (SELECT 1 FROM ssd_spec ss WHERE ss.product_id = p.id);

-- ---------------------------------------------------------------------------
-- PSU specs (9). Connector MATRICES were never captured -> eps / pcie_8pin /
-- 12vhpwr / sata omitted (stay NULL), so GPU<->PSU CONNECTOR checks resolve
-- UNKNOWN while the WATTAGE check is enforced. length_mm and modularity are
-- research-filled; efficiency uses the catalog's exact certification strings.
-- ---------------------------------------------------------------------------

INSERT INTO psu_spec (product_id, rated_wattage, efficiency_certification,
    atx_standard_version, form_factor, length_mm, connector_24pin_atx,
    modularity)
SELECT p.id, v.watts, v.eff, v.atx, 'ATX'::psu_form_factor, v.len,
    true, v.mod::psu_modularity
FROM (VALUES
    ('Seed Corsair RM1000e 1000W',                   1000, '80 PLUS Gold',   NULL,      140, 'FULLY_MODULAR'),
    ('Seed Antec CSK1000 PRO EC ATX3.1 1000W Bronze',1000, '80 PLUS Bronze', 'ATX 3.1', 140, 'NON_MODULAR'),
    ('Seed Antec G850 850W Gold',                     850, '80 PLUS Gold',   NULL,      140, 'NON_MODULAR'),
    ('Seed Corsair RM750e 750W',                      750, '80 PLUS Gold',   NULL,      140, 'FULLY_MODULAR'),
    ('Seed Corsair RM850e 850W',                      850, '80 PLUS Gold',   NULL,      140, 'FULLY_MODULAR'),
    ('Seed MSI MAG A750GL PCIE5 750W',                750, '80 PLUS Gold',   NULL,      140, 'FULLY_MODULAR'),
    ('Seed MSI MAG A650BN 650W',                      650, '80 PLUS Bronze', NULL,      140, 'NON_MODULAR'),
    ('Seed HYBROK PSU 650 Bronze',                     650, '80 PLUS Bronze', NULL,      140, 'NON_MODULAR'),
    ('Seed Connect PSU 850 Bronze',                    850, '80 PLUS Bronze', NULL,      140, 'NON_MODULAR')
) AS v(name, watts, eff, atx, len, mod)
JOIN product p ON p.name = v.name
WHERE NOT EXISTS (SELECT 1 FROM psu_spec ps WHERE ps.product_id = p.id);

-- ---------------------------------------------------------------------------
-- Case specs (8). max_gpu_length/thickness/cooler-height/PSU-length come from
-- the companion research (the catalog listed several as UNKNOWN). Thickness
-- is 3 slots for all 8. See D4: the radiator matrix is a SEPARATE, load-bearing
-- table, seeded below for only 2 of these 8 cases.
-- ---------------------------------------------------------------------------

INSERT INTO case_spec (product_id, max_gpu_length_mm, max_gpu_thickness_slots,
    max_cpu_cooler_height_mm, psu_form_factor, max_psu_length_mm)
SELECT p.id, v.gpu_len, v.gpu_slots, v.cooler_h, 'ATX'::psu_form_factor,
    v.psu_len
FROM (VALUES
    ('Seed CORSAIR Frame 4000D RS ARGB Black',  430, 3, 170, 180),
    ('Seed CORSAIR Frame 4000D RS ARGB White',  430, 3, 170, 180),
    ('Seed Corsair 3500X White',                410, 3, 170, 180),
    ('Seed Corsair 3500X Black',                410, 3, 170, 180),
    ('Seed Corsair iCUE LINK 3500X ARGB White', 410, 3, 170, 180),
    ('Seed MSI MAG PANO 100R PZ Blanc',         390, 3, 175, 200),
    ('Seed MSI MPG VELOX 100R WHITE',           380, 3, 175, 250),
    ('Seed MSI MAG FORGE 320R AIRFLOW White',   390, 3, 161, 210)
) AS v(name, gpu_len, gpu_slots, cooler_h, psu_len)
JOIN product p ON p.name = v.name
WHERE NOT EXISTS (SELECT 1 FROM case_spec cs WHERE cs.product_id = p.id);

-- ---------------------------------------------------------------------------
-- Cooler specs (7). cooling_type drives the radiator rule (air -> not
-- applicable, liquid -> the zero-row HARD FAIL of D4). max_tdp_watts is
-- research-filled but UNUSED by the engine today (D5).
-- Dimensions: for AIR coolers height/length/width are the tower dims
-- (155/120/120, same mapping as 001). For LIQUID coolers height_mm is
-- deliberately NULL (an AIO has no tower height) and length/width are the
-- RADIATOR dims: from the research (27 x L x 120/140) where the catalog said
-- UNKNOWN, and taken VERBATIM from the catalog where it stated values - so
-- the Nautilus 240 keeps the catalog's 125/275/125 (the research's
-- 27/277/120 looks physically closer; flagged, catalog wins per D7).
-- ---------------------------------------------------------------------------

INSERT INTO cooler_spec (product_id, cooling_type, max_tdp_watts, height_mm,
    length_mm, width_mm)
SELECT p.id, v.ctype::cooling_type, v.tdp, v.h, v.len, v.w
FROM (VALUES
    ('Seed MSI MAG COREFROZR AA13 WHITE',            'AIR',    220, 155, 120, 120),
    ('Seed MSI MAG COREFROZR AA13 BLACK',            'AIR',    220, 155, 120, 120),
    ('Seed MSI MAG CoreLiquid A13 360 White AIO',    'LIQUID', 300, NULL, 397, 120),
    ('Seed Corsair Nautilus 240 RS ARGB Black AIO',  'LIQUID', 260, 125, 275, 125),
    ('Seed DeepCool MYSTIQUE 360 Black AIO',         'LIQUID', 300, NULL, 402, 120),
    ('Seed Cooler Master MasterLiquid ML280 Mirror', 'LIQUID', 280, NULL, 317, 140),
    ('Seed MSI MAG CORELIQUID 240R',                 'LIQUID', 200, NULL, 274, 120)
) AS v(name, ctype, tdp, h, len, w)
JOIN product p ON p.name = v.name
WHERE NOT EXISTS (SELECT 1 FROM cooler_spec c WHERE c.product_id = p.id);

-- ---------------------------------------------------------------------------
-- CPU <-> motherboard support (17 rows: 15 family + 2 exact).
-- FAMILY rows are keyed by product_family_id (see D3). The 3400G exception is
-- an EXACT-SKU FAIL, which by the approved precedence (exact > family,
-- compatibility/cpu-motherboard.js:135-168) wins over any family rule; the
-- A520 intentionally has NO 3400G row, so that pair stays UNKNOWN - the
-- catalog did not establish current A520 support for that Picasso APU.
-- `Seed AMD Ryzen 4000G` rows are inert placeholders (no such CPU in the
-- catalog yet; they document the boards' ability, they cannot match).
-- ---------------------------------------------------------------------------

INSERT INTO cpu_motherboard_support (motherboard_product_id,
    cpu_product_family_id, cpu_product_id, support_status, min_bios_version,
    source_note)
SELECT mb.id, pf.id, NULL, v.status::compatibility_status, NULL, v.note
FROM (VALUES
    ('Seed MSI A520M A-PRO',           'Seed AMD Ryzen 3000',        'PASS',        'Seed: manufacturer/local listing describes Ryzen 3000 support'),
    ('Seed MSI A520M A-PRO',           'Seed AMD Ryzen 5000',        'PASS',        'Seed: manufacturer/local listing describes Ryzen 5000 support'),
    ('Seed MSI A520M A-PRO',           'Seed AMD Ryzen 5000G',       'PASS',        'Seed: manufacturer/local listing describes 5000G support'),
    ('Seed MSI A520M A-PRO',           'Seed AMD Ryzen 4000G',       'PASS',        'Seed: manufacturer/local listing describes 4000G support'),
    ('Seed MSI B550M PRO-VDH',         'Seed AMD Ryzen 3000',        'PASS',        'Seed: MSI support documentation'),
    ('Seed MSI B550M PRO-VDH',         'Seed AMD Ryzen 5000',        'PASS',        'Seed: MSI support documentation'),
    ('Seed MSI B550M PRO-VDH',         'Seed AMD Ryzen 5000G',       'PASS',        'Seed: MSI support documentation'),
    ('Seed MSI B550M PRO-VDH',         'Seed AMD Ryzen 4000G',       'PASS',        'Seed: MSI support documentation'),
    ('Seed MSI B550M PRO-VDH WIFI',    'Seed AMD Ryzen 3000',        'PASS',        'Seed: MSI support documentation'),
    ('Seed MSI B550M PRO-VDH WIFI',    'Seed AMD Ryzen 5000',        'PASS',        'Seed: MSI support documentation'),
    ('Seed MSI B550M PRO-VDH WIFI',    'Seed AMD Ryzen 5000G',       'PASS',        'Seed: MSI support documentation'),
    ('Seed MSI B550M PRO-VDH WIFI',    'Seed AMD Ryzen 4000G',       'PASS',        'Seed: MSI support documentation'),
    ('Seed MSI Z790 GAMING PLUS WIFI', 'Seed Intel Core 12th Gen',   'PASS',        'Seed: MSI officially lists 12th/13th/14th Gen support'),
    ('Seed LPC Gaming B650 DDR5',      'Seed AMD Ryzen 7000',        'PASS',        'Seed: Moroccan listing markets Ryzen 7000 support'),
    ('Seed LPC Gaming B650 DDR5',      'Seed AMD Ryzen 8000',        'CONDITIONAL', 'Seed: listing says 7000/8000/9000, BIOS floor not established')
) AS v(mb_name, family, status, note)
JOIN product mb ON mb.name = v.mb_name
JOIN product_family pf ON pf.name = v.family
WHERE NOT EXISTS (
    SELECT 1 FROM cpu_motherboard_support s
    WHERE s.motherboard_product_id = mb.id
      AND s.cpu_product_family_id = pf.id
      AND s.cpu_product_id IS NULL
);

INSERT INTO cpu_motherboard_support (motherboard_product_id,
    cpu_product_family_id, cpu_product_id, support_status, min_bios_version,
    source_note)
SELECT mb.id, NULL, cpu.id, 'FAIL', NULL,
    'Seed: MSI explicitly documents this board as incompatible with Ryzen 5 3400G'
FROM product mb, product cpu
WHERE mb.name IN ('Seed MSI B550M PRO-VDH', 'Seed MSI B550M PRO-VDH WIFI')
  AND cpu.name = 'Seed AMD Ryzen 5 3400G'
AND NOT EXISTS (
    SELECT 1 FROM cpu_motherboard_support s
    WHERE s.motherboard_product_id = mb.id AND s.cpu_product_id = cpu.id
);

-- ---------------------------------------------------------------------------
-- Cooler <-> socket support (20 rows). Absence = UNKNOWN, never PASS, so
-- ML280's AM5 row is deliberately ABSENT (the catalog could not confirm the
-- AM5 mounting-kit revision): ML280 + AM5 CPU resolves UNKNOWN (eligible,
-- penalised) rather than PASS.
-- ---------------------------------------------------------------------------

INSERT INTO cooler_socket_support (cooler_product_id, socket_id,
    support_status, mounting_note)
SELECT p.id, s.id, 'PASS', 'Seed: manufacturer ' || s.name || ' mounting kit'
FROM (VALUES
    ('Seed MSI MAG COREFROZR AA13 WHITE',            'AM4'),
    ('Seed MSI MAG COREFROZR AA13 WHITE',            'AM5'),
    ('Seed MSI MAG COREFROZR AA13 WHITE',            'LGA1700'),
    ('Seed MSI MAG COREFROZR AA13 BLACK',            'AM4'),
    ('Seed MSI MAG COREFROZR AA13 BLACK',            'AM5'),
    ('Seed MSI MAG COREFROZR AA13 BLACK',            'LGA1700'),
    ('Seed MSI MAG CoreLiquid A13 360 White AIO',    'AM4'),
    ('Seed MSI MAG CoreLiquid A13 360 White AIO',    'AM5'),
    ('Seed MSI MAG CoreLiquid A13 360 White AIO',    'LGA1700'),
    ('Seed Corsair Nautilus 240 RS ARGB Black AIO',  'AM4'),
    ('Seed Corsair Nautilus 240 RS ARGB Black AIO',  'AM5'),
    ('Seed Corsair Nautilus 240 RS ARGB Black AIO',  'LGA1700'),
    ('Seed DeepCool MYSTIQUE 360 Black AIO',         'AM4'),
    ('Seed DeepCool MYSTIQUE 360 Black AIO',         'AM5'),
    ('Seed DeepCool MYSTIQUE 360 Black AIO',         'LGA1700'),
    -- ML280: AM4 + LGA1700 only (AM5 intentionally omitted - UNKNOWN)
    ('Seed Cooler Master MasterLiquid ML280 Mirror', 'AM4'),
    ('Seed Cooler Master MasterLiquid ML280 Mirror', 'LGA1700'),
    ('Seed MSI MAG CORELIQUID 240R',                 'AM4'),
    ('Seed MSI MAG CORELIQUID 240R',                 'AM5'),
    ('Seed MSI MAG CORELIQUID 240R',                 'LGA1700')
) AS v(cname, sock)
JOIN product p ON p.name = v.cname
JOIN socket s ON s.name = v.sock
WHERE NOT EXISTS (
    SELECT 1 FROM cooler_socket_support c
    WHERE c.cooler_product_id = p.id AND c.socket_id = s.id
);

-- ---------------------------------------------------------------------------
-- Case <-> motherboard form factor (24 rows = 8 cases x 3). Explicit, never
-- inferred from dimensions; no E_ATX row is proposed (no evidence).
-- ---------------------------------------------------------------------------

INSERT INTO case_motherboard_form_factor (case_product_id, form_factor)
SELECT p.id, v.ff::motherboard_form_factor
FROM (VALUES
    ('Seed CORSAIR Frame 4000D RS ARGB Black',   'ATX'),
    ('Seed CORSAIR Frame 4000D RS ARGB Black',   'MICRO_ATX'),
    ('Seed CORSAIR Frame 4000D RS ARGB Black',   'MINI_ITX'),
    ('Seed CORSAIR Frame 4000D RS ARGB White',   'ATX'),
    ('Seed CORSAIR Frame 4000D RS ARGB White',   'MICRO_ATX'),
    ('Seed CORSAIR Frame 4000D RS ARGB White',   'MINI_ITX'),
    ('Seed Corsair 3500X White',                 'ATX'),
    ('Seed Corsair 3500X White',                 'MICRO_ATX'),
    ('Seed Corsair 3500X White',                 'MINI_ITX'),
    ('Seed Corsair 3500X Black',                 'ATX'),
    ('Seed Corsair 3500X Black',                 'MICRO_ATX'),
    ('Seed Corsair 3500X Black',                 'MINI_ITX'),
    ('Seed Corsair iCUE LINK 3500X ARGB White',  'ATX'),
    ('Seed Corsair iCUE LINK 3500X ARGB White',  'MICRO_ATX'),
    ('Seed Corsair iCUE LINK 3500X ARGB White',  'MINI_ITX'),
    ('Seed MSI MAG PANO 100R PZ Blanc',          'ATX'),
    ('Seed MSI MAG PANO 100R PZ Blanc',          'MICRO_ATX'),
    ('Seed MSI MAG PANO 100R PZ Blanc',          'MINI_ITX'),
    ('Seed MSI MPG VELOX 100R WHITE',            'ATX'),
    ('Seed MSI MPG VELOX 100R WHITE',            'MICRO_ATX'),
    ('Seed MSI MPG VELOX 100R WHITE',            'MINI_ITX'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White',    'ATX'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White',    'MICRO_ATX'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White',    'MINI_ITX')
) AS v(cname, ff)
JOIN product p ON p.name = v.cname
WHERE NOT EXISTS (
    SELECT 1 FROM case_motherboard_form_factor f
    WHERE f.case_product_id = p.id AND f.form_factor = v.ff::motherboard_form_factor
);

-- ---------------------------------------------------------------------------
-- Case <-> radiator support (4 rows, Frame 4000D Black + White only).
-- READ D4 FIRST: these rows are LOAD-BEARING. Their absence is a HARD FAIL for
-- every LIQUID cooler in that case, so the 6 new cases without rows can only
-- host AIR coolers. The catalog documents 240 TOP and 360 FRONT for the Frame
-- 4000D; the "360 TOP where the manufacturer permits" variant is NOT seeded
-- (position-specific confirmation was not captured).
-- ---------------------------------------------------------------------------

INSERT INTO case_radiator_support (case_product_id, radiator_size_mm, position)
SELECT p.id, v.size, v.pos
FROM (VALUES
    ('Seed CORSAIR Frame 4000D RS ARGB Black', 240, 'TOP'),
    ('Seed CORSAIR Frame 4000D RS ARGB Black', 360, 'FRONT'),
    ('Seed CORSAIR Frame 4000D RS ARGB White', 240, 'TOP'),
    ('Seed CORSAIR Frame 4000D RS ARGB White', 360, 'FRONT')
) AS v(cname, size, pos)
JOIN product p ON p.name = v.cname
WHERE NOT EXISTS (
    SELECT 1 FROM case_radiator_support r
    WHERE r.case_product_id = p.id
      AND r.radiator_size_mm = v.size AND r.position = v.pos
);

-- ---------------------------------------------------------------------------
-- Market: 1 MAD offer per new product (85 offers), reusing the two 001 stores.
-- Non-GPU products are product-keyed (product_variant_id NULL); GPU offers are
-- variant-keyed, which Stage 1 requires for exact matching. seller_name and
-- product_url stay NULL (D8). Guard = the 001 offer key
-- (store, product, variant, price, currency): correcting a price later inserts
-- a SECOND offer rather than updating this one (store_offer has no unique key).
-- seller/product_url/availability are 'IN_STOCK' and last_checked_at = NOW().
-- Part 1/3: CPU (16) + Motherboard (5) + RAM (5).
-- ---------------------------------------------------------------------------

INSERT INTO store_offer (store_id, product_id, product_variant_id, price,
    currency, availability, seller_name, product_url, last_checked_at)
SELECT st.id, p.id, NULL, v.price, 'MAD', 'IN_STOCK', NULL, NULL, NOW()
FROM (VALUES
    ('Seed AMD Ryzen 5 5600',                    'Seed NextGamer', 2199),
    ('Seed AMD Ryzen 5 5500',                    'Seed UltraPC',    899),
    ('Seed AMD Ryzen 5 5600X',                   'Seed NextGamer', 1599),
    ('Seed AMD Ryzen 5 3400G',                   'Seed UltraPC',   1599),
    ('Seed AMD Ryzen 5 PRO 5655G',               'Seed NextGamer', 2699),
    ('Seed AMD Ryzen 5 3500X',                   'Seed UltraPC',   1299),
    ('Seed AMD Ryzen 7 5700X',                   'Seed NextGamer', 1890),
    ('Seed AMD Ryzen 7 5700G',                   'Seed UltraPC',   5160),
    ('Seed AMD Ryzen 7 5800X',                   'Seed NextGamer', 2249),
    ('Seed AMD Ryzen 9 5900X',                   'Seed UltraPC',   3199),
    ('Seed AMD Ryzen 9 5950X',                   'Seed NextGamer', 2999),
    ('Seed AMD Ryzen 7 7700X',                   'Seed UltraPC',   2799),
    ('Seed AMD Ryzen 7 7800X3D',                 'Seed NextGamer', 3549),
    ('Seed AMD Ryzen 7 8700F',                   'Seed UltraPC',   1749),
    ('Seed Intel Core i5-12400F',                'Seed NextGamer', 1549),
    ('Seed Intel Core i7-12700KF',               'Seed UltraPC',   2699),
    ('Seed MSI A520M A-PRO',                     'Seed NextGamer',  582),
    ('Seed MSI B550M PRO-VDH',                   'Seed UltraPC',    952),
    ('Seed MSI B550M PRO-VDH WIFI',              'Seed NextGamer', 1267),
    ('Seed MSI Z790 GAMING PLUS WIFI',           'Seed UltraPC',   2649),
    ('Seed LPC Gaming B650 DDR5',                'Seed NextGamer', 2190),
    ('Seed LEXAR DDR4 3200MHz 16GB 1x16 CL22',   'Seed UltraPC',   1299),
    ('Seed INNOVATION IT DDR4 3200MHz 8GB 1x8 CL22', 'Seed NextGamer', 599),
    ('Seed CORSAIR VENGEANCE LPX DDR4 3200MHz 16GB 1x16 CL16', 'Seed UltraPC', 1349),
    ('Seed CORSAIR VENGEANCE RGB PRO DDR4 3200MHz 16GB 2x8 CL16', 'Seed NextGamer', 1349),
    ('Seed TWINMOS DDR4 3200MHz 16GB 1x16 CL16', 'Seed UltraPC',   1299)
) AS v(pname, sname, price)
JOIN product p ON p.name = v.pname
JOIN store st ON st.name = v.sname
WHERE NOT EXISTS (
    SELECT 1 FROM store_offer o
    WHERE o.store_id = st.id AND o.product_id = p.id
      AND o.product_variant_id IS NULL AND o.price = v.price AND o.currency = 'MAD'
);

-- Offers part 2/3: Boot SSD (15) + PSU (9).
-- ---------------------------------------------------------------------------

INSERT INTO store_offer (store_id, product_id, product_variant_id, price,
    currency, availability, seller_name, product_url, last_checked_at)
SELECT st.id, p.id, NULL, v.price, 'MAD', 'IN_STOCK', NULL, NULL, NOW()
FROM (VALUES
    ('Seed CRUCIAL E100 1TB NVMe',              'Seed NextGamer', 1099),
    ('Seed HIKSEMI WAVE 512GB NVMe',            'Seed UltraPC',    599),
    ('Seed KINGSTON NV3 1TB NVMe',              'Seed NextGamer',  899),
    ('Seed CRUCIAL P310 2TB NVMe',              'Seed UltraPC',   1499),
    ('Seed LEXAR NM620 512GB NVMe',             'Seed NextGamer',  699),
    ('Seed SAMSUNG 9100 PRO 4TB NVMe',          'Seed UltraPC',   5999),
    ('Seed TeamGroup MP33 1TB',                 'Seed NextGamer',  699),
    ('Seed Intenso Premium 1TB',                'Seed UltraPC',    599),
    ('Seed MSI SPATIUM M371 1TB',               'Seed NextGamer',  649),
    ('Seed MSI SPATIUM M450 1TB',               'Seed UltraPC',    899),
    ('Seed Netac N930E Pro 1TB',                'Seed NextGamer',  599),
    ('Seed TeamGroup T-FORCE CARDEA Z44L 1TB',  'Seed UltraPC',    799),
    ('Seed WD_BLACK SN770 1TB',                 'Seed NextGamer',  999),
    ('Seed Samsung SSD 980 1TB',                'Seed UltraPC',   1099),
    ('Seed Kingston NV2 1TB',                   'Seed NextGamer',  699),
    ('Seed Corsair RM1000e 1000W',              'Seed UltraPC',   1899),
    ('Seed Antec CSK1000 PRO EC ATX3.1 1000W Bronze', 'Seed NextGamer', 1299),
    ('Seed Antec G850 850W Gold',               'Seed UltraPC',    999),
    ('Seed Corsair RM750e 750W',                'Seed NextGamer', 1099),
    ('Seed Corsair RM850e 850W',                'Seed UltraPC',   1299),
    ('Seed MSI MAG A750GL PCIE5 750W',          'Seed NextGamer',  999),
    ('Seed MSI MAG A650BN 650W',                'Seed UltraPC',    649),
    ('Seed HYBROK PSU 650 Bronze',              'Seed NextGamer',  599),
    ('Seed Connect PSU 850 Bronze',             'Seed UltraPC',    799)
) AS v(pname, sname, price)
JOIN product p ON p.name = v.pname
JOIN store st ON st.name = v.sname
WHERE NOT EXISTS (
    SELECT 1 FROM store_offer o
    WHERE o.store_id = st.id AND o.product_id = p.id
      AND o.product_variant_id IS NULL AND o.price = v.price AND o.currency = 'MAD'
);

-- Offers part 3/3a: Case (8) + CPU cooler (7).
-- ---------------------------------------------------------------------------

INSERT INTO store_offer (store_id, product_id, product_variant_id, price,
    currency, availability, seller_name, product_url, last_checked_at)
SELECT st.id, p.id, NULL, v.price, 'MAD', 'IN_STOCK', NULL, NULL, NOW()
FROM (VALUES
    ('Seed CORSAIR Frame 4000D RS ARGB Black',      'Seed NextGamer',  899),
    ('Seed CORSAIR Frame 4000D RS ARGB White',      'Seed UltraPC',    949),
    ('Seed Corsair 3500X White',                    'Seed NextGamer',  949),
    ('Seed Corsair 3500X Black',                    'Seed UltraPC',    949),
    ('Seed Corsair iCUE LINK 3500X ARGB White',     'Seed NextGamer', 1599),
    ('Seed MSI MAG PANO 100R PZ Blanc',             'Seed UltraPC',   1699),
    ('Seed MSI MPG VELOX 100R WHITE',               'Seed NextGamer', 1619),
    ('Seed MSI MAG FORGE 320R AIRFLOW White',       'Seed UltraPC',    849),
    ('Seed MSI MAG COREFROZR AA13 WHITE',           'Seed NextGamer',  699),
    ('Seed MSI MAG COREFROZR AA13 BLACK',           'Seed UltraPC',    699),
    ('Seed MSI MAG CoreLiquid A13 360 White AIO',   'Seed NextGamer', 1299),
    ('Seed Corsair Nautilus 240 RS ARGB Black AIO', 'Seed UltraPC',   1099),
    ('Seed DeepCool MYSTIQUE 360 Black AIO',        'Seed NextGamer', 1699),
    ('Seed Cooler Master MasterLiquid ML280 Mirror','Seed UltraPC',   1499),
    ('Seed MSI MAG CORELIQUID 240R',                'Seed NextGamer',  799)
) AS v(pname, sname, price)
JOIN product p ON p.name = v.pname
JOIN store st ON st.name = v.sname
WHERE NOT EXISTS (
    SELECT 1 FROM store_offer o
    WHERE o.store_id = st.id AND o.product_id = p.id
      AND o.product_variant_id IS NULL AND o.price = v.price AND o.currency = 'MAD'
);

-- ---------------------------------------------------------------------------
-- Offers part 3/3b: GPU (20), VARIANT-keyed (exact product+variant match is
-- what Stage 1 requires).
-- ---------------------------------------------------------------------------

INSERT INTO store_offer (store_id, product_id, product_variant_id, price,
    currency, availability, seller_name, product_url, last_checked_at)
SELECT st.id, p.id, pv.id, v.price, 'MAD', 'IN_STOCK', NULL, NULL, NOW()
FROM (VALUES
    ('SEED-MSI-RTX5070-VENTUS2X',     'Seed NextGamer',  8490),
    ('SEED-MSI-RTX5060-VENTUS2X',     'Seed UltraPC',    4999),
    ('SEED-MSI-RTX5080-VENTUS3X',     'Seed NextGamer', 15900),
    ('SEED-GB-RTX5080-GAMINGOC',      'Seed UltraPC',   15700),
    ('SEED-GB-RTX5060-STD',           'Seed NextGamer',  4990),
    ('SEED-MSI-RTX5060TI8-VENTUS2X',  'Seed UltraPC',    5299),
    ('SEED-GB-RTX5070-STD',           'Seed NextGamer',  8100),
    ('SEED-MSI-RTX5070-GAMINGTRIO',   'Seed UltraPC',    9000),
    ('SEED-MSI-RTX5070TI-VENTUS3X',   'Seed NextGamer', 12899),
    ('SEED-PNY-RTX5060TI8-DUAL',      'Seed UltraPC',    5349),
    ('SEED-ASUS-RTX5090-TUF',         'Seed NextGamer', 39990),
    ('SEED-GB-RTX5070-EAGLEOC',       'Seed UltraPC',    8500),
    ('SEED-PNY-RTX5060-STD',          'Seed NextGamer',  5090),
    ('SEED-PNY-RTX5080-STD',          'Seed UltraPC',   16499),
    ('SEED-ZOT-RTX5060TI16-TWINEDGE', 'Seed NextGamer',  7999),
    ('SEED-ZOT-RTX5080-STD',          'Seed UltraPC',   16999),
    ('SEED-GB-RTX5080-STD',           'Seed NextGamer', 17499),
    ('SEED-ASR-RX9060XT16-STD',       'Seed UltraPC',    5900),
    ('SEED-MSI-RTX5080-SHADOW3X',     'Seed NextGamer', 16490),
    ('SEED-ASUS-RTX5070TI-PRIME',     'Seed UltraPC',   11500)
) AS v(sku, sname, price)
JOIN product_variant pv ON pv.sku = v.sku
JOIN product p ON p.id = pv.product_id
JOIN store st ON st.name = v.sname
WHERE NOT EXISTS (
    SELECT 1 FROM store_offer o
    WHERE o.store_id = st.id AND o.product_id = p.id
      AND o.product_variant_id = pv.id AND o.price = v.price AND o.currency = 'MAD'
);

-- ===========================================================================
-- VERIFICATION (run after applying):
--   node scripts/run-seeds.js --dry-run      -- parse/statement count only
--   npm run seed                             -- applies 001 (no-op) then 002
-- Expected `npm run seed` summary after this file:
--   products=100    (15 existing + 85 new)
--   offers=101      (16 existing + 85 new)
--   assessments=25  (unchanged - this file seeds none, see D2)
-- Targeted read-only checks (all Seed-scoped):
--   product_variant     : 20 new SEED-% rows (22 total with 001)
--   cpu_spec 16, motherboard_spec 5, ram_spec 5, ssd_spec 15, psu_spec 9,
--   case_spec 8, cooler_spec 7, gpu_board_spec 20
--   cpu_motherboard_support 17, cooler_socket_support 20,
--   case_motherboard_form_factor 24, case_radiator_support 4
-- NOTE: the first `npm run seed` AFTER this file re-runs 001, whose blanket
-- price_history statement attaches one history row per new Seed offer. That is
-- expected and not a defect; price_history has no engine consumer.
-- ===========================================================================

COMMIT;
