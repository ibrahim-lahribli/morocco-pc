-- ============================================================================
-- Seed 024: budget motherboards and RAM kits, the PLATFORM-COST axis
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- OG-58 measured retention at S06 (GAMING 1440p 12000 MAD) and found that
-- eight of the ten retained CPUs cannot produce a single in-budget build,
-- because a CPU's affordability is decided by the board and RAM its socket
-- forces. The cheapest legal rest-of-build there is fixed at 8297 MAD, leaving
-- 3703 for CPU + board + RAM, and the catalogue's platform floor was:
--
--   AM4      582 (MSI A520M A-PRO)  + 599 (8 GB DDR4)  = 1181
--   AM5     1500 (MSI PRO B650M-P)  + 700 (16 GB DDR5) = 2200
--   LGA1700 2649 (MSI Z790 WIFI)    + 700 (16 GB DDR5) = 3349
--
-- Two of those three numbers are not a market fact, they are a CATALOGUE GAP.
-- LGA1700 held exactly ONE board and it was a 2649 MAD Z790, so no LGA1700 CPU
-- above 354 MAD could ever build at that budget; AM5's cheapest board was a
-- 1500 MAD B650. The role counts made it visible: MOTHERBOARD held 7 products
-- and MEMORY 7, against 22 CPUs, 21 GPUs and 17 SSDs, and MEMORY carried only
-- TWO DDR5 kits, the cheapest being a 16 GB pair.
--
-- This seed adds the missing floor: four budget boards across all three
-- sockets (including the first LGA1700 DDR4 boards, which the catalogue could
-- not express before) and three kits, so the platform axis stops being the
-- binding constraint and the OG-58 options become measurable on data.
--
-- WHAT IT ADDS (7 products)
--
--   boards   MSI PRO H610M-E DDR4      LGA1700 DDR4   899   (new chipset H610)
--            Gigabyte B760M DS3H DDR4  LGA1700 DDR4  1349   (new chipset B760)
--            MSI PRO A620M-E           AM5     DDR5   999   (new chipset A620)
--            Gigabyte B650M D3HP       AM5     DDR5  1599
--   RAM      Crucial DDR5-4800 8GB 1x8 CL40          399
--            Corsair Vengeance DDR5-5600 16GB 2x8 CL36  750
--            CORSAIR VENGEANCE LPX DDR4-3600 16GB 2x8 CL18  899
--
-- Resulting platform floor: AM4 1181 (unchanged), AM5 999 + 399 = 1398,
-- LGA1700 899 + 599 = 1498. Both gaps close by roughly 800-1850 MAD.
--
-- RUBRIC - MOTHERBOARD (identical to 004b, recomputed here, never copied)
--
--   UPGRADEABILITY = 50 + 5 per DIMM beyond 2 + min(15, maxGB/192*15)
--                      + min(8, max(0,(memMT/s-4400)/400)) + min(7, M.2*1.75)
--                      + min(5, PCIe x16*1.67) + 2 if Wi-Fi, cap 92
--      H610M-E   58.42 -> 58   B760M DS3H  75.17 -> 75
--      A620M-E   65.92 -> 66   B650M D3HP  80.17 -> 80
--   VALUE = 55 + 19*(ratio-0.03624)/(0.07896-0.03624), ratio = RAW index/MAD,
--   clamp [55,74], the same frozen anchors the Z790 (0.03624) and the B550M
--   PRO-VDH (0.07896) set:
--      H610M-E   0.064984 -> 68     B760M DS3H 0.055722 -> 64
--      A620M-E   0.065986 -> 68     B650M D3HP 0.050138 -> 61
--   QUALITY is a vendor-tier judgement with the reason named per row (the 004b
--   anchor set: entry A-series 68, MSI PRO / mainstream mid 74-77, flagship 78).
--
-- RUBRIC - RAM (identical to 004b, recomputed here)
--
--   RAW = 100 * ( 0.45*min(1,BEFF/96) + 0.25*min(1,10/lat_ns)
--                 + 0.15*channelWeight + 0.15*min(1,totalGB/32) )
--     BEFF = channels * MT/s * 8/1000, lat_ns = CL*2000/MT/s,
--     channelWeight 1.00 for 2+ modules and 0.55 for a single module
--   PERFORMANCE = 33.0562 + 0.4494*RAW, clamp [50,90]
--      Crucial 8GB      BEFF 38.4, lat 16.67 -> RAW 45.00 -> 53
--      Corsair 16GB 5600 BEFF 89.6, lat 12.86 -> RAW 83.94 -> 71
--      LPX 16GB 3600     BEFF 57.6, lat 10.00 -> RAW 74.50 -> 67
--   VALUE = 55 + 19*(ratio-0.035359)/(0.070420-0.035359), ratio = RAW/MAD
--   KNOWN LIMITATION, stated because it looks like a template error: all three
--   kits SATURATE the frozen 74 ceiling, since RAW/MAD beats the best anchor
--   (0.070420, the 8 GB DDR4 module) at these prices. That is the mapping's
--   documented behaviour, not a rounding artefact, and it means VALUE does not
--   separate these three - PERFORMANCE and QUALITY do. Re-anchoring the RAM
--   VALUE map would rescore all seven existing RAM rows, so it is a scoring
--   review act, never something a data seed does.
--   CL is not a ram_spec column: it is read from the vendor part number
--   (4800 CL40, 5600 CL36, 3600 CL18), the same way 004b read the two DDR5
--   calibration rows, and every rationale below says so.
--
-- PRICES - calibrated against the live ladder, never invented upward
--
--   H610M-E 899 is the first LGA1700 board under the 2649 Z790, and sits below
--   the B760M; A620M-E 999 is below the 1500 B650M-P, which stays the mid
--   option; B650M D3HP 1599 sits ABOVE the 1500 B650M-P on purpose, because it
--   carries four DIMM slots and a second M.2 rather than because it is old.
--   DDR5 8 GB 399 is priced on the catalogue's OWN DDR5 ladder (700 for 16 GB,
--   1400 for 32 GB, i.e. ~44 MAD/GB): a real 2026 street price would be higher,
--   and the OG-37 verification pass is where that gets corrected for all of
--   them. The DDR4-3600 kit at 899 EXPOSES A STALE PRICE rather than inventing
--   one: the catalogue still asks 1349 for a slower DDR4-3200 CL16 2x8 kit, so
--   the new row is cheaper AND faster than that incumbent. That pair is
--   recorded as a finding for the price pass, not smoothed by pricing the new
--   kit up to match a stale figure.
--
-- DELIBERATELY NOT ADDED
--
--   * No `cpu_motherboard_support` rows. A (board, CPU) pair with no row is
--     the documented UNKNOWN path (Decision 3b); writing PASS rows would
--     assert verified per-SKU support this batch did not gather, the same
--     position seed 023 took for its CPUs. Socket matching is DERIVED from
--     socket_id, so every new board still pairs correctly with its socket's
--     CPUs and UNKNOWN is never read as PASS.
--   * No `motherboard_memory_support` rows: both new DDR4 boards and both new
--     DDR5 boards are single-type, so the legacy `memory_type_id` column is the
--     precise answer (Rule 7's zero-row fallback) and the DDR4/DDR5 split still
--     FAILs correctly in both directions.
--   * No `price_history` rows and no `product_variant` (004b/023 pattern).
--   * No engine code, no scoring-model row, no migration, no re-anchoring of
--     any VALUE map.
--
-- DATA OBSERVATION, NOT TOUCHED
--
--   `chipset` holds TWO rows named 'AMD B650' (ids 82b5d4a2..., 70ada563...),
--   so a board lookup by chipset NAME can fan out to duplicate spec rows. This
--   file resolves the B650 chipset through `ORDER BY id LIMIT 1` and does not
--   repair the duplicate, which would need a dedupe of any spec rows pointing
--   at the loser - a migration-shaped act, out of scope here.
--
-- SCOPE AND SAFETY
--
--   * DML only; catalog rows only. Idempotent: every insert is guarded by
--     NOT EXISTS on its natural key, so a second apply writes 0 rows.
--   * TEST-branch first, and applied there ALONE. Like every file in this
--     folder it has NO branch awareness: `run-seeds.js` executes it against
--     whatever `DATABASE_URL` names. Pointing a seed run at shared or EU is a
--     deliberate catalogue decision, not something this file does on its own.
--   * `check-deferred-rules.js` and `check-og01-coverage.js --strict` are
--     re-run after the apply: these boards and kits enter the RAM/cooler/board
--     rule scopes AND must carry all three required assessment types.
-- ============================================================================

BEGIN;

-- 1/7 Families. Five are new; the two Corsair kits reuse the families the
-- catalogue already has for them ('Seed DDR5 Budget RAM', 'Seed Corsair
-- Vengeance LPX DDR4') so a family page does not split one product line.
INSERT INTO product_family (name, manufacturer_id)
SELECT v.name, m.id
FROM (VALUES
    ('Seed MSI H610 Motherboards',      'MSI'),
    ('Seed Gigabyte B760 Motherboards', 'Gigabyte'),
    ('Seed MSI A620 Motherboards',      'MSI'),
    ('Seed Gigabyte B650 Motherboards', 'Gigabyte'),
    ('Seed Crucial DDR5',               'Crucial')
) AS v(name, mfr)
JOIN manufacturer m ON m.name = v.mfr
WHERE NOT EXISTS (SELECT 1 FROM product_family pf WHERE pf.name = v.name);

-- 2/7 Chipsets (3). A620, B760 and H610 do not exist yet; Z790 and B650 do.
INSERT INTO chipset (manufacturer_id, name)
SELECT m.id, v.name
FROM (VALUES
    ('AMD A620',   'AMD'),
    ('Intel B760', 'Intel'),
    ('Intel H610', 'Intel')
) AS v(name, mfr)
JOIN manufacturer m ON m.name = v.mfr
WHERE NOT EXISTS (SELECT 1 FROM chipset c WHERE c.name = v.name AND c.manufacturer_id = m.id);

-- 3/7 Products (7).
INSERT INTO product (product_family_id, manufacturer_id, name, display_name, slug, lifecycle_status)
SELECT pf.id, m.id, v.name, ident.display_name, ident.slug, 'ACTIVE'
FROM (VALUES
    ('Seed MSI PRO H610M-E DDR4',                          'Seed MSI H610 Motherboards',      'MSI'),
    ('Seed Gigabyte B760M DS3H DDR4',                      'Seed Gigabyte B760 Motherboards', 'Gigabyte'),
    ('Seed MSI PRO A620M-E',                               'Seed MSI A620 Motherboards',      'MSI'),
    ('Seed Gigabyte B650M D3HP',                           'Seed Gigabyte B650 Motherboards', 'Gigabyte'),
    ('Seed Crucial DDR5 4800MHz 8GB 1x8 CL40',             'Seed Crucial DDR5',               'Crucial'),
    ('Seed Corsair Vengeance DDR5 5600MHz 16GB 2x8 CL36',  'Seed DDR5 Budget RAM',            'Corsair'),
    ('Seed CORSAIR VENGEANCE LPX DDR4 3600MHz 16GB 2x8 CL18', 'Seed Corsair Vengeance LPX DDR4', 'Corsair')
) AS v(name, family, mfr)
-- Migration 020 (product identity) owns this derivation, and these seeds used to
-- skip it: they inserted products with display_name and slug NULL, which is why
-- 13 catalogue rows served `slug: null` and `test:api:db` failed. Both columns
-- come from the ONE source of truth (the name), using 020's own expressions -
-- display_name without the "Seed " prefix, slug lowercased and hyphenated - so a
-- replay cannot write a slug that disagrees with its product. Measured before
-- writing: every derived slug satisfies chk_product_slug_format, with ZERO
-- collisions against the slugs already in the catalogue (uq_product_slug enforces
-- it at insert time, so a future clash fails loudly instead of writing NULL).
CROSS JOIN LATERAL (
    SELECT dn.display_name,
           trim(both '-' FROM regexp_replace(
               lower(regexp_replace(dn.display_name, '[^a-zA-Z0-9]+', '-', 'g')),
               '-+', '-', 'g')) AS slug
      FROM (SELECT regexp_replace(v.name, '^Seed ', '') AS display_name) AS dn
) AS ident
JOIN product_family pf ON pf.name = v.family
JOIN manufacturer m ON m.name = v.mfr
WHERE NOT EXISTS (SELECT 1 FROM product p WHERE p.name = v.name);

-- 4/7 Motherboard specs (4). Every board states dimm_slots and
-- max_memory_capacity_gb, so the two HARD RAM rules (OG-11 slots, OG-12
-- capacity) return a real PASS/FAIL on these boards instead of UNKNOWN.
-- The B650 chipset is resolved deterministically because the catalog holds
-- two 'AMD B650' rows (see DATA OBSERVATION above).
INSERT INTO motherboard_spec (product_id, socket_id, chipset_id, form_factor,
    memory_type_id, dimm_slots, max_memory_capacity_gb,
    official_memory_speed_min_mtps, official_memory_speed_max_mtps,
    pcie_x16_slots, pcie_slot_generation, m2_slots, sata_ports, wifi_present,
    bios_notes)
SELECT p.id, s.id,
    (SELECT c.id FROM chipset c WHERE c.name = v.chipset ORDER BY c.id LIMIT 1),
    v.ff::motherboard_form_factor, mt.id, v.dimm, v.maxgb, v.spdmin, v.spdmax,
    v.x16, v.pcie, v.m2, v.sata, v.wifi, v.bios
FROM (VALUES
    ('Seed MSI PRO H610M-E DDR4',         'LGA1700', 'Intel H610', 'MICRO_ATX', 'DDR4', 2, 64,  2133, 3200, 1, 4, 1, 4, false,
     'LGA1700. 14th-gen support needs a current BIOS on early H610 revisions; no VRM heatsinks, so 65 W parts only'),
    ('Seed Gigabyte B760M DS3H DDR4',     'LGA1700', 'Intel B760', 'MICRO_ATX', 'DDR4', 4, 128, 2133, 3200, 1, 4, 2, 4, false,
     'LGA1700 DDR4 variant. 14th-gen support from the launch BIOS'),
    ('Seed MSI PRO A620M-E',              'AM5',     'AMD A620',   'MICRO_ATX', 'DDR5', 2, 96,  4800, 6400, 1, 4, 1, 4, false,
     'AM5 entry chipset: PCIe 4.0 only, no CPU PCIe 5.0 lanes, 65 W-class VRM'),
    ('Seed Gigabyte B650M D3HP',          'AM5',     'AMD B650',   'MICRO_ATX', 'DDR5', 4, 128, 4800, 6400, 1, 4, 2, 4, false,
     'AM5 mid chipset, four DIMM slots and a second M.2')
) AS v(pname, socket, chipset, ff, memtype, dimm, maxgb, spdmin, spdmax, x16, pcie, m2, sata, wifi, bios)
JOIN product p ON p.name = v.pname
JOIN socket s ON s.name = v.socket
JOIN memory_type mt ON mt.name = v.memtype
WHERE NOT EXISTS (SELECT 1 FROM motherboard_spec ms WHERE ms.product_id = p.id);

-- 5/7 RAM specs (3). ram_spec carries no CAS-latency column, so CL lives in
-- the product name and the rationale (004b read its two calibration rows the
-- same way).
INSERT INTO ram_spec (product_id, memory_type_id, module_count,
    capacity_per_module_gb, rated_speed_mtps, voltage_v)
SELECT p.id, mt.id, v.modules, v.permod, v.mtps, v.voltage
FROM (VALUES
    ('Seed Crucial DDR5 4800MHz 8GB 1x8 CL40',                 'DDR5', 1, 8,  4800, 1.10),
    ('Seed Corsair Vengeance DDR5 5600MHz 16GB 2x8 CL36',      'DDR5', 2, 8,  5600, 1.25),
    ('Seed CORSAIR VENGEANCE LPX DDR4 3600MHz 16GB 2x8 CL18',  'DDR4', 2, 8,  3600, 1.35)
) AS v(pname, memtype, modules, permod, mtps, voltage)
JOIN product p ON p.name = v.pname
JOIN memory_type mt ON mt.name = v.memtype
WHERE NOT EXISTS (SELECT 1 FROM ram_spec rs WHERE rs.product_id = p.id);

-- 6/7 Offers (7). Seed stores only, the 002/004b/023 pattern: seller_name and
-- product_url stay NULL (D8), so these are SEED-class offers and the
-- provenance gate counts them without certifying them.
INSERT INTO store_offer (store_id, product_id, product_variant_id, price,
    currency, availability, seller_name, product_url, last_checked_at)
SELECT st.id, p.id, NULL, v.price, 'MAD', 'IN_STOCK', NULL, NULL, NOW()
FROM (VALUES
    ('Seed MSI PRO H610M-E DDR4',                              'Seed UltraPC',    899),
    ('Seed Gigabyte B760M DS3H DDR4',                          'Seed UltraPC',   1349),
    ('Seed MSI PRO A620M-E',                                   'Seed UltraPC',    999),
    ('Seed Gigabyte B650M D3HP',                               'Seed NextGamer', 1599),
    ('Seed Crucial DDR5 4800MHz 8GB 1x8 CL40',                 'Seed NextGamer',  399),
    ('Seed Corsair Vengeance DDR5 5600MHz 16GB 2x8 CL36',      'Seed UltraPC',    750),
    ('Seed CORSAIR VENGEANCE LPX DDR4 3600MHz 16GB 2x8 CL18',  'Seed NextGamer',  899)
) AS v(pname, sname, price)
JOIN product p ON p.name = v.pname
JOIN store st ON st.name = v.sname
WHERE NOT EXISTS (
    SELECT 1 FROM store_offer o
    WHERE o.store_id = st.id AND o.product_id = p.id
      AND o.product_variant_id IS NULL AND o.price = v.price AND o.currency = 'MAD'
);

-- 7/7 Assessments (7 x 3). MOTHERBOARD requires QUALITY / UPGRADEABILITY /
-- VALUE and MEMORY PERFORMANCE / QUALITY / VALUE under this model's
-- role_weights, so every row here is one of those six types and none may be
-- left out (these products are NOT among the DELIBERATE_PARTIAL fixtures).
INSERT INTO component_assessment (product_id, assessment_type, score, rating,
    summary, rationale, confidence, source_type, assessed_at)
SELECT p.id, v.atype::assessment_type, v.score, v.rating, v.summary,
    v.rationale, v.conf::confidence_level, v.stype::source_type, NOW()
FROM (VALUES
    -- ================= MOTHERBOARD =================
    ('Seed MSI PRO H610M-E DDR4', 'QUALITY', 68, 'Average',
     'Entry Intel H610 mATX board: two DIMM slots, no VRM heatsinks',
     'Anchor entry tier = 68 (the A520M A-PRO precedent). H610 is the bottom of the Intel stack: 65 W-class VRM without heatsinks, two DIMM slots and no PCIe 5.0, so it sits at the entry mark rather than the 74-77 MSI PRO mid boards carry',
     'MEDIUM', 'COMMUNITY'),
    ('Seed MSI PRO H610M-E DDR4', 'UPGRADEABILITY', 58, 'Average',
     '2 DIMM, 64 GB ceiling, DDR4-3200, 1 M.2, 1 PCIe x16',
     'RAW = 50 + 5*max(0,2-2) + min(15,64/192*15=5.0) + min(8,max(0,(3200-4400)/400)=0) + min(7,1*1.75) + min(5,1*1.67) + 0 = 58.42 -> 58. The 64 GB ceiling and the single M.2 are what hold it below the four-DIMM boards',
     'MEDIUM', 'DATASHEET'),
    ('Seed MSI PRO H610M-E DDR4', 'VALUE', 68, 'Good',
     'Upgrade index per MAD 58.42/899 = 0.064984',
     'VALUE = 55 + 19*(0.064984-0.03624)/(0.07896-0.03624) = 67.8 -> 68, on the frozen 004b anchor pair (Z790 0.03624 -> 55, B550M PRO-VDH 0.07896 -> 74). Cheapest way into LGA1700 in the catalog by 1750 MAD, with a correspondingly thin spec sheet. LOW confidence: the 899 MAD price is seed-class (OG-37)',
     'LOW', 'RETAILER'),

    ('Seed Gigabyte B760M DS3H DDR4', 'QUALITY', 74, 'Good',
     'Mainstream Intel B760 mATX on DDR4, four DIMM slots, no VRM fan',
     'Anchor mainstream mid = 74-77: B760 is the volume chipset, the DS3H carries a heatsinked VRM adequate for 65 W parts and four DIMM slots, but not the 14+1+1 design or the connectivity that lifts the Z790 to 78',
     'MEDIUM', 'COMMUNITY'),
    ('Seed Gigabyte B760M DS3H DDR4', 'UPGRADEABILITY', 75, 'Good',
     '4 DIMM, 128 GB, DDR4-3200, 2 M.2, 1 PCIe x16',
     'RAW = 50 + 5*(4-2) + min(15,128/192*15=10.0) + 0 + min(7,2*1.75=3.5) + min(5,1.67) + 0 = 75.17 -> 75. Identical to the B550M PRO-VDH raw index, which is the check that this formula is being applied unchanged across sockets',
     'MEDIUM', 'DATASHEET'),
    ('Seed Gigabyte B760M DS3H DDR4', 'VALUE', 64, 'Good',
     'Upgrade index per MAD 75.17/1349 = 0.055722',
     'VALUE = 55 + 19*(0.055722-0.03624)/(0.07896-0.03624) = 63.7 -> 64. Mid-priced board with mid-upper specs, so it lands mid-mapping. LOW confidence: seed-class price (OG-37)',
     'LOW', 'RETAILER'),

    ('Seed MSI PRO A620M-E', 'QUALITY', 70, 'Good',
     'AM5 entry chipset (A620) on a PRO-branded mATX board',
     'A620 is the entry AM5 chipset: PCIe 4.0 only, no CPU PCIe 5.0 lanes and a 65 W-class VRM, so it scores above the bare H610/A520 entry boards (68) but below the B650 parts (74-75) despite the PRO name',
     'MEDIUM', 'COMMUNITY'),
    ('Seed MSI PRO A620M-E', 'UPGRADEABILITY', 66, 'Good',
     '2 DIMM, 96 GB, DDR5-6400, 1 M.2, 1 PCIe x16',
     'RAW = 50 + 0 + min(15,96/192*15=7.5) + min(8,max(0,(6400-4400)/400)=5) + min(7,1.75) + min(5,1.67) + 0 = 65.92 -> 66. The DDR5 speed ceiling earns the +5 that no DDR4 board here can, and the two DIMM slots cap it below the four-DIMM B650M',
     'MEDIUM', 'DATASHEET'),
    ('Seed MSI PRO A620M-E', 'VALUE', 68, 'Good',
     'Upgrade index per MAD 65.92/999 = 0.065986',
     'VALUE = 55 + 19*(0.065986-0.03624)/(0.07896-0.03624) = 68.2 -> 68. The cheapest AM5 entry in the catalog, 501 MAD under the B650M-P. LOW confidence: seed-class price (OG-37)',
     'LOW', 'RETAILER'),

    ('Seed Gigabyte B650M D3HP', 'QUALITY', 74, 'Good',
     'Mainstream AMD B650 mATX, four DIMM slots, two M.2',
     'Anchor mainstream mid = 74-77. B650 is the volume AM5 chipset and the D3HP is the plain version: a heatsinked VRM sized for 65-105 W parts and four DIMM slots, without the Wi-Fi, the third M.2 and the 14-phase design of the AORUS ELITE at 2400 MAD',
     'MEDIUM', 'COMMUNITY'),
    ('Seed Gigabyte B650M D3HP', 'UPGRADEABILITY', 80, 'Good',
     '4 DIMM, 128 GB, DDR5-6400, 2 M.2, 1 PCIe x16',
     'RAW = 50 + 10 + min(15,10.0) + min(8,5) + min(7,3.5) + min(5,1.67) + 0 = 80.17 -> 80. Same raw build-up as the B760M DS3H plus the DDR5 speed term, which is the whole 5-point gap between them',
     'MEDIUM', 'DATASHEET'),
    ('Seed Gigabyte B650M D3HP', 'VALUE', 61, 'Good',
     'Upgrade index per MAD 80.17/1599 = 0.050138',
     'VALUE = 55 + 19*(0.050138-0.03624)/(0.07896-0.03624) = 61.2 -> 61. Deliberately priced ABOVE the 1500 B650M-P because the extra DIMM pair and M.2 slot are the reason to buy it; the value score is lower than the A620M-E for exactly that reason. LOW confidence: seed-class price (OG-37)',
     'LOW', 'RETAILER'),

    -- ================= RAM =================
    ('Seed Crucial DDR5 4800MHz 8GB 1x8 CL40', 'PERFORMANCE', 53, 'Average',
     'Single 8 GB DDR5-4800 CL40 module (part number lists CL40)',
     'BEFF = 1*4800*8/1000 = 38.4 GB/s; lat = 40*2000/4800 = 16.67 ns; RAW = 100*(0.45*min(1,38.4/96) + 0.25*min(1,10/16.67) + 0.15*0.55 + 0.15*min(1,8/32)) = 45.00 -> 33.0562+0.4494*45.00 = 53. One module is the load-bearing term here: the 0.55 channel weight and the 8/32 capacity term cost it 13 points against a matched 16 GB pair',
     'MEDIUM', 'DATASHEET'),
    ('Seed Crucial DDR5 4800MHz 8GB 1x8 CL40', 'QUALITY', 58, 'Average',
     'JEDEC DDR5-4800 at 1.10 V, 8 GB single module, no heatspreader',
     'Anchor 8 GB single module = 58, the same mark 004b gave the earlier 8 GB module. Crucial is a first-tier DRAM maker but this is an OEM-grade JEDEC stick with no heatspreader and no XMP profile, so the brand does not lift it above the anchor',
     'MEDIUM', 'DATASHEET'),
    ('Seed Crucial DDR5 4800MHz 8GB 1x8 CL40', 'VALUE', 74, 'Good',
     'Raw index per MAD 45.00/399 = 0.112782, above the map ceiling',
     'VALUE clamps to 74: the raw ratio 0.1128 is 60 percent above the best frozen anchor (0.070420, the 8 GB DDR4 module at 599), so the score is the ceiling rather than a computed 79. Read PERFORMANCE (53) for capability: this row says only that no kit in the catalog is cheaper per index point. LOW confidence: seed-class price (OG-37)',
     'LOW', 'RETAILER'),

    ('Seed Corsair Vengeance DDR5 5600MHz 16GB 2x8 CL36', 'PERFORMANCE', 71, 'Good',
     'Matched DDR5-5600 CL36 pair, 2x8 = 16 GB (part number lists CL36)',
     'BEFF = 2*5600*8/1000 = 89.6 GB/s; lat = 36*2000/5600 = 12.86 ns; RAW = 100*(0.45*min(1,89.6/96) + 0.25*min(1,10/12.86) + 0.15*1.00 + 0.15*0.5) = 83.94 -> 33.0562+0.4494*83.94 = 70.8 -> 71. Three points above the DDR5-5200 incumbent on bandwidth and latency, with the same channel and capacity terms',
     'MEDIUM', 'DATASHEET'),
    ('Seed Corsair Vengeance DDR5 5600MHz 16GB 2x8 CL36', 'QUALITY', 71, 'Good',
     'Matched 2x8 kit with a heatspreader at 1.25 V, no RGB lighting',
     'Anchor matched RGB kit with iCUE and a 4-year warranty = 73; this is the same matched-pair construction and warranty WITHOUT the lighting ecosystem, which is the 2-point difference. It is not a bare IC, so it stays well above the 66 unbranded anchor',
     'MEDIUM', 'COMMUNITY'),
    ('Seed Corsair Vengeance DDR5 5600MHz 16GB 2x8 CL36', 'VALUE', 74, 'Good',
     'Raw index per MAD 83.94/750 = 0.111920, above the map ceiling',
     'VALUE clamps to 74: 0.1119 is 59 percent above the best frozen anchor, so the ceiling binds and the computed value (78.9) is not used. This kit and the 8 GB module therefore TIE on VALUE while being 18 PERFORMANCE points apart - read the PERFORMANCE row, as the RAM VALUE rows in 004b already warn. LOW confidence: seed-class price (OG-37)',
     'LOW', 'RETAILER'),

    ('Seed CORSAIR VENGEANCE LPX DDR4 3600MHz 16GB 2x8 CL18', 'PERFORMANCE', 67, 'Good',
     'Matched DDR4-3600 CL18 pair, 2x8 = 16 GB (part number lists CL18)',
     'BEFF = 2*3600*8/1000 = 57.6 GB/s; lat = 18*2000/3600 = 10.00 ns; RAW = 100*(0.45*0.6 + 0.25*1.0 + 0.15*1.00 + 0.15*0.5) = 74.50 -> 33.0562+0.4494*74.50 = 66.5 -> 67. Two points above the DDR4-3200 CL16 kit that costs 450 MAD more: 3600 at CL18 wins latency and bandwidth on the same dual-channel, same-capacity build',
     'MEDIUM', 'DATASHEET'),
    ('Seed CORSAIR VENGEANCE LPX DDR4 3600MHz 16GB 2x8 CL18', 'QUALITY', 70, 'Good',
     'Bare LPX heatspreader, matched 2x8 at 1.35 V, no RGB',
     'Anchor bare CL16 heatspreader IC from a first-tier maker = 70, carried here unchanged: same LPX construction, same Corsair warranty, no lighting to differentiate it from the RGB PRO kit scored 73',
     'MEDIUM', 'COMMUNITY'),
    ('Seed CORSAIR VENGEANCE LPX DDR4 3600MHz 16GB 2x8 CL18', 'VALUE', 74, 'Good',
     'Raw index per MAD 74.50/899 = 0.082870, above the map ceiling',
     'VALUE clamps to 74: 0.0829 is 18 percent above the best frozen anchor, so the computed 80.6 is truncated at the ceiling. This is also the row that exposes a stale incumbent price - the DDR4-3200 CL16 2x8 kit is still listed at 1349 MAD, 450 more for 2 fewer PERFORMANCE points. LOW confidence: seed-class price (OG-37)',
     'LOW', 'RETAILER')
) AS v(pname, atype, score, rating, summary, rationale, conf, stype)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (
    SELECT 1 FROM component_assessment a
    WHERE a.product_id = p.id AND a.assessment_type = v.atype::assessment_type
);

-- MEASURED AFTER APPLY (TEST branch, 2026-10-31, engine at ca1e3ea; `launch-v2@2.4.0`)

-- Catalogue: products 104 -> 111, MOTHERBOARD 7 -> 11, MEMORY 7 -> 10. Platform floor:
-- AM4 1181 (unchanged), AM5 1500+700=2200 -> 999+399=1398, LGA1700 2649+700=3349 ->
-- 899+599=1498. `check-deferred-rules` PASS (0 violations, all four rules, 23 reachable
-- RAM pairs measured instead of UNKNOWN) and `check-og01-coverage --strict` PASS.

-- The pass that mattered: S06 (GAMING 1440p 12000) through the real repository +
-- `runFullRun` path.
--
-- | before (seed 023) | after (seed 024) |
-- |---|---|
-- | 2 assembled builds | 3 assembled builds |
-- | 1 selected build | 2 selected builds |
-- | 1 distinct pair | 2 distinct pairs |
--
-- The new pair is a BUILD, not a reshuffle: 8500G + Seed Gigabyte B650M D3HP + Seed
-- Crucial DDR5 8GB + RX 9060 XT 16 GB at 11994 MAD, beside the AM4 lane at 11947 and
-- 11847 (both Ryzen 5 5500 on the B550M PRO-VDH, which now carries the new DDR4-3600
-- kit). A1 S06 therefore moves EXPECTED-RED 1 -> 2 of the 3 pairs it needs.

-- WHY LGA1700 STILL ASSEMBLES NOTHING, measured rather than assumed: the 14400 IS
-- retained (10-CPU bucket traced: 12700KF, 7800X3D, 5950X, 8700G, 7700X, 14400, 5900X,
-- 8700F, 8500G, 5500), so this is not supply. Its cheapest legal build is 43 MAD over
-- budget: GPU 5900 (the 12 GB floor) + SSD 599 + PSU 599 + case 849 + cooler 699 +
-- H610M 899 + DDR4 8GB 599 + CPU 1899 = 12043. THREE HUNDRED AND FORTY-NINE of those
-- MAD are a compatibility-table gap, not a price: the 350 MAD DeepCool AG400 has
-- `cooler_socket_support` rows for AM5 only, so the cheapest LGA1700 cooler in the
-- catalog is the 699 MAD MSI COREFROZR. With an AG400 LGA1700 row the same build is
-- 11694 and fits. That row is NOT written here - it asserts per-socket vendor support
-- and belongs to its own evidence-bearing change, not to a price-and-spec seed.

-- FULL SUITE at `--model=launch-v2@2.4.0 --no-baseline --no-volatile`: 86 assertion
-- rows, 76 PASS / 5 EXPECTED-RED / 4 HARD FAIL / 1 UNKNOWN, exit 1, residue 0.
-- A1 stays green on 14 of 15 rows and S06 improves 1 -> 2. THREE FAILURES ARE NEW AND
-- ARE CAUSED BY THIS BATCH, recorded rather than tuned away:
--
--   * `A5 | S10,S11` - the price-first and performance-first rank-1 builds are now the
--     SAME build at 11896 MAD, where they were 11246 vs 11845. The new cheap DDR4-3600
--     kit and the A620/B650M boards give the value strategy nothing it cannot already
--     afford, so the priority lever stops separating them.
--   * `A2 | S03..S05` and `A2 | S06..S08` - the rank-1 build now spends 23794 of 30000
--     (ratio 0.793) where the assertion wants >= 0.8. Same cause: a cheaper catalogue
--     lowers what the top-scoring build costs, so the highest budget no longer gets
--     spent. That is a fact about the ENGINE score-to-price relation, exposed by data.
--   * `A10 | S18` is the pre-existing seed-023 consequence (three pair-distinct OFFICE
--     builds vs a two-entry approved order) and does not involve this batch.
--
-- Pricing the new parts UP to make those assertions pass would be scenario tuning with
-- a data costume, so it was not done. Whether the canonical catalogue grows is an
-- owner decision, and until it does `check-target-parity` reports the DIFF (7 products,
-- 4 boards, 3 RAM specs, 7 offers, 21 assessments, 5 families, 3 chipsets).

COMMIT;
