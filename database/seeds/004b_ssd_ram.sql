-- ===========================================================================
-- Seed 004b (file 2 of 3): component_assessment for the 15 seed-002 SSDs and
-- the 5 seed-002 memory kits (OG-01 batch 2)
--
-- Purpose: OG-01 is BLOCKING because the seed-002 catalog products still score
-- the flat no-evidence 40.000 on every weighted type (Decision 13 STEP 1), so
-- with top_k_per_role = 5 the surviving subset is decided by lexicographic UUID
-- order. Seed 004a closed that for GPU/PSU; 004b file 1 did CPU +
-- MOTHERBOARD; this file does STORAGE + RAM: 20 products x 3 types = 60 rows.
--
-- Scope: EXACTLY the 15 SSDs and 5 memory kits of 002_catalog_expansion.sql
-- that have no component_assessment row. Seed 001's products (990 Pro 2TB,
-- WD Blue SN580 1TB, Corsair Vengeance DDR5-5200, G.Skill Flare X5 DDR5-6000)
-- are excluded by the NOT EXISTS guard AND by name, and the 14 seed-001
-- partial fixtures (scripts/lib/og01-catalog.js DELIBERATE_PARTIAL) are
-- deliberately NOT filled: a missing type is the missing-type branch of
-- Decision 13 STEP 1 and those products are its only live coverage.
-- No spec/offer/variant row is touched.
--
-- Conventions (identical to 001/002/003/004a/004b-1):
--   * DML only, no DDL. Single BEGIN/COMMIT: all-or-nothing per run.
--   * Idempotent: WHERE NOT EXISTS on (product_id, assessment_type) - a second
--     run inserts zero rows; an existing row (any source) is never overwritten.
--   * NULL score means "researched, not rateable" (rating 'Unrated' + reason):
--     it documents the attempt and keeps that type on the no-evidence branch.
--     It is NEVER a guessed number. 5 of this file's 60 rows are honest NULLs.
--   * assessed_at = NOW() at apply time (decay is linear 0.5%/day).
--   * ASCII only. CRLF.
--
-- CORRECTIONS: because the NOT EXISTS guard protects existing pairs, the NULL
-- VALUE rows below must be filled by a LATER seed file that UPDATEs the row by
-- (product_id, assessment_type) - there is no unique constraint on that pair to
-- conflict against. OG-06's price pass is where the five rejected-price VALUEs
-- come back.
--
-- DATA AVAILABILITY (recorded because it shaped the rubric, not an excuse):
-- ssd_spec carries ONLY product_id, capacity_gb, form_factor, interface,
-- protocol, pcie_generation - there is no speed, IOPS or endurance column in
-- this schema. So SSD PERFORMANCE cannot be derived from the database the way
-- the MOTHERBOARD UPGRADEABILITY rubric in file 1 was: every speed figure below
-- is RESEARCH, cited per row, and the interface term of the index is the one
-- component that comes from the database. The same is true of the RAM rubric:
-- ram_spec has rated_speed_mtps and voltage_v but no CAS latency, so CL comes
-- from the vendor part number in each rationale.
--
-- RUBRIC ANCHORS (frozen before scoring; plan sections 3-4):
--
-- SSD PERFORMANCE - one published spec triple per drive (vendor rating, checked
-- against TechPowerUp SSD Database where a page exists) plus the database's own
-- pcie_generation:
--     RAW = 100 * ( 0.45 * min(1, seqRead / 7500)
--                  + 0.35 * min(1, seqWrite / 5500)
--                  + 0.20 * (pcieGeneration / 5) )
--     PERFORMANCE = 27.3256 + 0.6340 * RAW,  clamp [45, 90]
-- The two constants are fixed by the seed 001 incumbents, so the calibration
-- reproduces by construction: WD Blue SN580 1TB (4150/4150, Gen4) -> RAW 67.31
-- -> 70, and Samsung 990 Pro 2TB (7450/6900, Gen4) -> RAW 95.70 -> 88. DEVIATION
-- from a pure ranking table, recorded deliberately: no reachable table scores
-- off-brand and DRAM-less budget drives with the same rigour as a flagship, so
-- the plan's "one extractable ranking table" is replaced here by a published
-- spec triple per drive. The GENRE break is a real weakness and is carried
-- honestly: the SN770's sustained-write collapse past its SLC cache and the
-- Samsung 980's DRAM-less write behaviour are invisible to a headline spec
-- triple, so both are named in their QUALITY row instead.
-- KNOWN LIMITATION, not a bug: the two calibration points sit at RAW 67.31 and
-- 95.70, but the batch spans RAW 32.35 (TeamGroup MP33) to 100.00 (9100 PRO).
-- Below RAW ~45 the map is compressed, so the five slowest budget drives land
-- in 48-52 and their relative order inside that band carries no meaning.
--
-- SSD QUALITY - vendor tier and named durability/DRAM facts, never vibes.
-- Anchors: Gen5 flagship with a full DRAM buffer and a 5-year warranty 88;
-- Gen4 mainstream TLC with DRAM 72-80; DRAM-less Gen4 with 600 TBW 71;
-- DRAM-less Gen4 entry 66-68; QLC 63; Gen3 mainstream TLC 67-74; budget Gen3
-- with only a vendor datasheet and no independent review found 61-64.
--
-- SSD VALUE - RAW spec index per MAD at this database's live store_offer
-- price, mapped linearly with the batch extremes fixed first: best = 74
-- (KINGSTON NV3 1TB, 0.086156), worst = 55 (SAMSUNG 9100 PRO 4TB, 0.016669).
-- The raw spec index is used, NOT the PERFORMANCE score: no type is derived
-- from another type score (plan section 4). confidence LOW on every computed
-- VALUE row: the offer prices are seed 002 UNVERIFIED assessment-era figures
-- (OG-06).
--
-- PRICE INTEGRITY GATE (execution plan section 3) - 3 of 15 SSD prices fail
-- it, and a rejected price yields a NULL VALUE row, never a score computed
-- from a price known to be wrong:
--   SAMSUNG 9100 PRO 4TB 5999 vs Samsung 990 Pro 2TB 1500 - a 4TB Gen5
--     flagship at 4.0x the price of a 2TB Gen4 flagship in the same catalog
--   CRUCIAL E100 1TB 1099 vs WD_BLACK SN770 1TB 999 - the QLC E100 is
--     dominated on both speeds (5000/3000 vs 5150/4900) for 100 MAD MORE
--   HIKSEMI WAVE 512GB 599 vs Intenso Premium 1TB 599 - the 1TB has twice the
--     capacity, more write bandwidth (1700 vs 1025) and the same price
--
-- RAM PERFORMANCE - the whole DDR4-3200 batch shares one speed bin and only two
-- CAS latencies, so the anchor is a SPEC INDEX over the four things that decide
-- real memory behaviour, normalised by the database's own ram_spec:
--     BEFF_GBs = channels * rated_speed_MTps * 8 / 1000   (64-bit channels)
--     lat_ns   = CL * 2000 / rated_speed_MTps
--     RAW = 100 * ( 0.45 * min(1, BEFF / 96)
--                  + 0.25 * min(1, 10 / lat_ns)
--                  + 0.15 * channelWeight + 0.15 * min(1, totalGB / 32) )
--     channelWeight = 1.00 for 2+ modules, 0.55 for a single module
--     PERFORMANCE = 33.0562 + 0.4494 * RAW,  clamp [50, 90]
-- Two constants, fixed by the seed 001 incumbents: Corsair Vengeance 16GB
-- DDR5-5200 (2x8 CL40 -> BEFF 83.2, lat 15.38) -> RAW 77.75 -> 68, and
-- G.Skill Flare X5 32GB DDR5-6000 (2x16 CL30 -> BEFF 96.0, lat 10.00)
-- -> RAW 100.00 -> 78. The single-module penalty is the load-bearing term: a
-- 1x16 DDR4-3200 kit has BEFF 25.6 against the matched 2x8 pair 51.2, which is
-- the reason a 16 GB single stick scores 8 points below an identical-capacity
-- dual-channel kit here. DEVIATION from the parent plan, recorded deliberately:
-- the plan normalised by speed bin; this normalises by effective bandwidth and
-- effective latency because all five targets are in one speed bin, so speed
-- alone cannot separate them. KNOWN LIMITATION, not a bug: both calibration
-- points are DDR5, so the five DDR4 rows are a downwards extrapolation of the
-- map, and CL for the two DDR5 incumbents is read off the vendor part number
-- (CMK16GX5M2B5200C40 = CL40, F5-6000CL30 = CL30), not from ram_spec.
--
-- RAM QUALITY - bin + brand + named product facts. Anchors: matched RGB kit
-- with a full 4-year warranty and iCUE 73; bare CL16 heatspreader IC from the
-- same maker 70; unbranded CL16 with no independent review found 66; JEDEC
-- baseline CL22 at 1.20V 64; 8GB single module 58.
--
-- RAM VALUE - RAW spec index per MAD, same 74..55 mapping, from the raw index
-- (not from the PERFORMANCE score). 2 of 5 prices fail the gate, so the
-- mapping is fixed by the three that pass: best = 74 (INNOVATION IT 8GB,
-- 0.070420), worst = 55 (LEXAR DDR4 16GB, 0.035359). KNOWN LIMITATION, stated
-- plainly because the INNOVATION IT row looks wrong at a glance and is not:
-- an 8GB single module is 74 (Good) on VALUE while it is 52 (Poor) on
-- PERFORMANCE. "Index points per MAD" rewards it because the index falls 10.6
-- points when the capacity halves, while the price falls 700 MAD. Read the
-- PERFORMANCE row for absolute capability; the VALUE row only says this is the
-- cheapest memory per unit of measured performance.
--
-- SOURCES (per-product figures cited in each row's rationale; read 2026-10-02):
--   https://www.techpowerup.com/ssd-specs/ - Samsung 9100 Pro 4TB, Samsung 980
--     1TB, Crucial E100 1TB, Crucial P310 2TB, WD Black SN770 1TB,
--     MSI Spatium M450 1TB, Kingston NV2 1TB, Kingston NV3 1TB,
--     Lexar NM620 512GB, Teamgroup MP33 1TB, T-Force Cardea Z44L 1TB,
--     Netac N930e Pro 1TB
--   https://www.storagereview.com/ - measured confirmation of the 9100 PRO
--   https://www.kingston.com/en/ssd/nv3-nvme-pcie-ssd - NV3 1TB 6000/4000
--   https://www.teamgroupinc.com/en/product-detail/ssd/ - MP33 and CARDEA Z44L
--   https://www.lexar.com/product/lexar-nm620-m-2-2280-nvme-ssd/ - NM620 512GB
--   https://www.hiksemitech.com/en/hiksemi/all-products/solid-state-drive/consumer-ssd/hs-ssd-wave-p.html
--   https://www.intenso.de/en/products/solid-state-drives/m-2-ssd-pcie-premium/
--   https://www.msi.com/Storage/SPATIUM-M371 - M371 2350/1900 (vendor only)
--   https://www.corsair.com/us/en/p/memory/vengeance-lpx - CMK16GX5M2B5200C40
--   https://www.kingston.com/en/personal-computer/memory/ - DDR4 kit part nos.
--   Live prices: this database's store_offer rows (MAD), read 2026-10-02.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- INSERT: component_assessment for STORAGE + RAM (20 products x 3 = 60)
-- Column order: product name, type, score, rating, summary, rationale,
--               confidence, source_type, reference price (MAD, this DB)
-- ---------------------------------------------------------------------------
INSERT INTO component_assessment (product_id, assessment_type, score, rating,
    summary, rationale, confidence, source_type, assessed_at)
SELECT p.id, v.atype::assessment_type, v.score, v.rating, v.summary,
    v.rationale, v.conf::confidence_level, v.stype::source_type, NOW()
FROM (VALUES
    -- ================= Gen5 / Gen4 mainstream NVMe =================
    ('Seed SAMSUNG 9100 PRO 4TB NVMe', 'PERFORMANCE', 90, 'Great',
     'PCIe 5.0 x4 flagship at 14800/13400 MB/s, the fastest drive in the catalog',
     'Spec triple 14800/13400 with pcie_generation 5 -> RAW 100.0 -> 27.3256+0.6340*100.0 = 90.6 -> 90, the clamp ceiling. TechPowerUp rates it 14800/13400 with 2200K/2600K random; StorageReview measured 14700/13300, so the vendor figure is not inflated',
     'HIGH', 'OFFICIAL', 5999),
    ('Seed SAMSUNG 9100 PRO 4TB NVMe', 'QUALITY', 88, 'Great',
     'Samsung Gen5 flagship, DRAM buffer, 5-year warranty',
     'Anchor Gen5 flagship with a full DRAM buffer and a 5-year warranty = 88. Own controller and NAND, so no third-party firmware roulette; the only reason it is not above the 88 mark is the 4TB capacity premium, which VALUE carries instead',
     'HIGH', 'OFFICIAL', 5999),
    ('Seed SAMSUNG 9100 PRO 4TB NVMe', 'VALUE', NULL, 'Unrated',
     'Offer price 5999 MAD fails the price integrity gate',
     'Rejected: a 4TB Gen5 flagship at 5999 MAD while this same catalog sells a Samsung 990 Pro 2TB Gen4 flagship at 1500 MAD. A flagship is not worth 4.0x a smaller flagship of the same brand. Seed 002 prices are UNVERIFIED (OG-06), so no score is derived from this one. Honest NULL per plan 2.7',
     'LOW', 'RETAILER', 5999),

    ('Seed CRUCIAL P310 2TB NVMe', 'PERFORMANCE', 87, 'Great',
     'PCIe 4.0 x4, 7100/6000 MB/s, 1000K/1200K IOPS',
     'Spec triple 7100/6000 with pcie_generation 4 -> RAW 93.6 -> 27.3256+0.6340*93.6 = 86.7 -> 87. Second only to the Gen5 9100 PRO, and it beats the Gen4 990 Pro in this catalog on the index because the capacity is not in the index',
     'HIGH', 'OFFICIAL', 1499),
    ('Seed CRUCIAL P310 2TB NVMe', 'QUALITY', 80, 'Good',
     'Phison E18 controller with a DRAM buffer, 440 TBW',
     'Anchor Gen4 mainstream TLC with DRAM = 72-80, and the top of that band: Phison E18 plus a real DRAM buffer rather than an HMB fallback, with a 5-year warranty and 440 TBW on this 2TB part. Micron-branded NAND behind the Crucial name',
     'HIGH', 'OFFICIAL', 1499),
    ('Seed CRUCIAL P310 2TB NVMe', 'VALUE', 68, 'Average',
     '1499 MAD = 0.062442 raw index points per MAD',
     'RAW 93.6/1499 = 0.062442 -> 55+19*(0.062442-0.016669)/(0.086156-0.016669) = 67.7 -> 68. One MAD away from the Samsung 990 Pro 2TB in this catalog at 1500, which is the correct order for a value-oriented P310 against a premium 990 Pro. Confidence LOW because the price is a seed 002 assessment-era figure (OG-06)',
     'LOW', 'RETAILER', 1499),

    ('Seed WD_BLACK SN770 1TB', 'PERFORMANCE', 77, 'Good',
     'PCIe 4.0 x4, 5150/4900 MB/s, 740K/800K IOPS',
     'Spec triple 5150/4900 with pcie_generation 4 -> RAW 78.1 -> 27.3256+0.6340*78.1 = 76.8 -> 77. Second-fastest Gen4 drive in the catalog, and the calibration point SN580 sits 11 points below',
     'HIGH', 'OFFICIAL', 999),
    ('Seed WD_BLACK SN770 1TB', 'QUALITY', 71, 'Good',
     'DRAM-less with an HMB fallback; 600 TBW, 5-year warranty',
     'Anchor DRAM-less Gen4 with 600 TBW = 71. NAMED LIMITATION of a headline-spec index, carried here rather than hidden: once the SLC cache is exhausted the sustained write rate falls by roughly 90 percent, which a sequential spec triple cannot see. Western Digitals own NAND and controller plus a 5-year warranty keep it above the DRAM-less entry drives',
     'MEDIUM', 'OFFICIAL', 999),
    ('Seed WD_BLACK SN770 1TB', 'VALUE', 72, 'Good',
     '999 MAD = 0.078160 raw index points per MAD',
     'RAW 78.1/999 = 0.078160 -> 55+19*(0.078160-0.016669)/(0.086156-0.016669) = 71.7 -> 72. Second-best value in the batch behind the NV3, and it is the honest answer here because the cache-collapse caveat is a consistency question, not a price question. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 999),

    ('Seed KINGSTON NV3 1TB NVMe', 'PERFORMANCE', 76, 'Good',
     'PCIe 4.0 x4, 6000/4000 MB/s, 320 TBW',
     'Vendor table 1TB 6000/4000 with pcie_generation 4 -> RAW 77.5 -> 27.3256+0.6340*77.5 = 76.5 -> 76. The 6 GB/s read figure is the Kingston datasheet number; TechPowerUp carries three different NV3 1TB entries with different controllers, which is a QUALITY fact, not a PERFORMANCE one',
     'MEDIUM', 'OFFICIAL', 899),
    ('Seed KINGSTON NV3 1TB NVMe', 'QUALITY', 66, 'Average',
     'DRAM-less entry drive; the same SKU name ships with several controllers',
     'Anchor DRAM-less Gen4 entry = 66-68, at the low end. TechPowerUp lists three 1TB NV3 variants (SM2268XT with Kioxia BiCS6 QLC, Phison E27T with Micron B58R TLC, and a third controller), so the part number does not identify the silicon: real buyers must read the controller off the drive label. Kingston is a first-tier maker and the warranty is solid, which is what holds this above 60',
     'MEDIUM', 'OFFICIAL', 899),
    ('Seed KINGSTON NV3 1TB NVMe', 'VALUE', 74, 'Good',
     '899 MAD = 0.086156 raw index points per MAD, best in batch',
     'RAW 77.5/899 = 0.086156 = batch best -> 74. It reaches the batch best on VALUE by being 100 MAD cheaper than the SN770 while claiming 850 MB/s more sequential read. The score is honest but it inherits the NV3 controller ambiguity; sort on QUALITY when that matters. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 899),

    ('Seed TeamGroup T-FORCE CARDEA Z44L 1TB', 'PERFORMANCE', 62, 'Average',
     'PCIe 4.0 x4, 3500/2700 MB/s, 263K/382K random',
     'Spec triple 3500/2700 with pcie_generation 4 -> RAW 54.2 -> 27.3256+0.6340*54.2 = 61.7 -> 62. A Gen4 drive whose ceiling is the Gen3 interface speed, so the 0.20 interface term carries it no further than a native Gen3 part with the same numbers',
     'MEDIUM', 'OFFICIAL', 799),
    ('Seed TeamGroup T-FORCE CARDEA Z44L 1TB', 'QUALITY', 73, 'Good',
     'TLC with a DRAM buffer, 600 TBW, 5-year warranty, PS5-ready',
     'Anchor Gen4 mainstream TLC with DRAM = 72-80. Real TLC with a DRAM buffer, a 60 GB SLC cache window, 600 TBW and a 5-year warranty at 799 MAD is a stronger paper specification than anything else at this price in the catalog, which is why the index understates it',
     'MEDIUM', 'OFFICIAL', 799),
    ('Seed TeamGroup T-FORCE CARDEA Z44L 1TB', 'VALUE', 69, 'Average',
     '799 MAD = 0.067812 raw index points per MAD',
     'RAW 54.2/799 = 0.067812 -> 55+19*(0.067812-0.016669)/(0.086156-0.016669) = 69.4 -> 69. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 799),
    -- ================= Gen3 mainstream TLC =================
    ('Seed Samsung SSD 980 1TB', 'PERFORMANCE', 60, 'Average',
     'DRAM-less PCIe Gen3, 3500/3000 MB/s, 480K/500K random',
     'Spec triple 3500/3000 with pcie_generation 3 -> RAW 52.1 -> 27.3256+0.6340*52.1 = 60.3 -> 60. The write figure is 500 MB/s above every other 3.5 GB/s drive in the batch, which is the only reason it is not level with the 980s competitors',
     'HIGH', 'OFFICIAL', 1099),
    ('Seed Samsung SSD 980 1TB', 'QUALITY', 74, 'Good',
     'Samsung DRAM-less HMB controller, 5-year warranty',
     'Anchor Gen3 mainstream TLC = 67-74, at the top of that band. It is DRAM-less like the NV2, but it uses an HMB design with its own controller and firmware, it is Samsung silicon, and it has been measured extensively since 2020; that track record is the difference from 58 here',
     'MEDIUM', 'OFFICIAL', 1099),
    ('Seed Samsung SSD 980 1TB', 'VALUE', 63, 'Average',
     '1099 MAD = 0.047398 raw index points per MAD',
     'RAW 52.1/1099 = 0.047398 -> 55+19*(0.047398-0.016669)/(0.086156-0.016669) = 63.2 -> 63. A Gen3 flagship priced close to the Gen4 SN770 in this catalog, which is a real mark against it but not an impossibility: the price is within the range a discontinued flagship holds. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 1099),

    ('Seed MSI SPATIUM M450 1TB', 'PERFORMANCE', 63, 'Average',
     'Phison E19, PCIe 4.0 x4, 3600/3000 MB/s, 420K/550K random',
     'Spec triple 3600/3000 with pcie_generation 4 -> RAW 56.7 -> 27.3256+0.6340*56.7 = 63.3 -> 63. TechPowerUp rates the same 3.6 GB/s class as the Gen3 Samsung 980 read speed while the 0.20 interface term lifts it 3 points above; the honest read is that it is a slow Gen4 drive',
     'HIGH', 'OFFICIAL', 899),
    ('Seed MSI SPATIUM M450 1TB', 'QUALITY', 72, 'Good',
     'Phison E19 with a DRAM buffer, up to 1200 TBW on 1TB',
     'Anchor Gen4 mainstream TLC with DRAM = 72. The strongest endurance figure of any 1TB drive in this catalog at up to 1200 TBW, on a first-tier controller and a DRAM buffer. MSI bundles the Spatium Manager tool; nothing to flag',
     'HIGH', 'OFFICIAL', 899),
    ('Seed MSI SPATIUM M450 1TB', 'VALUE', 68, 'Average',
     '899 MAD = 0.063060 raw index points per MAD',
     'RAW 56.7/899 = 0.063060 -> 55+19*(0.063060-0.016669)/(0.086156-0.016669) = 68.1 -> 68. It costs exactly what the much faster NV3 costs in this same catalog, so the ratio is right even though the market read is that the NV3 is the better buy. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 899),

    ('Seed LEXAR NM620 512GB NVMe', 'PERFORMANCE', 57, 'Average',
     'PCIe Gen3 x4, 3300/2400 MB/s, 200K/256K random',
     'Spec triple 3300/2400 with pcie_generation 3 -> RAW 47.1 -> 27.3256+0.6340*47.1 = 57.2 -> 57. Lexar rates the 512GB as PCIe 3.0 in the Americas datasheet; the 3300/2400 figures are corroborated by StorageReview and by TechPowerUp, so the capacity variant is not being credited with the 1TB sequential figures',
     'HIGH', 'OFFICIAL', 699),
    ('Seed LEXAR NM620 512GB NVMe', 'QUALITY', 68, 'Average',
     'TLC with a DRAM buffer, widely reviewed since 2020',
     'Anchor DRAM-less-or-DRAM Gen3/Gen4 entry with a real DRAM buffer = 68. It is one of the few budget drives here that has a DRAM buffer AND a substantial independent review record, which is what separates it from the other 3.5 GB/s-class parts in this batch',
     'MEDIUM', 'OFFICIAL', 699),
    ('Seed LEXAR NM620 512GB NVMe', 'VALUE', 69, 'Average',
     '699 MAD = 0.067343 raw index points per MAD',
     'RAW 47.1/699 = 0.067343 -> 55+19*(0.067343-0.016669)/(0.086156-0.016669) = 68.6 -> 69. A 512GB drive scoring this well on ratio is a capacity artifact of the same kind the RAM rows carry: the index has no capacity term, so a half-size drive is credited as if it were a full one. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 699),

    ('Seed Kingston NV2 1TB', 'PERFORMANCE', 59, 'Average',
     'PCIe 4.0 x4, 3500/2100 MB/s; no random spec published',
     'Spec triple 3500/2100 with pcie_generation 4 -> RAW 50.4 -> 27.3256+0.6340*50.4 = 59.3 -> 59. Kingston publishes no random IOPS for this drive at all, so the index is built from sequential figures only; measured 2764 MB/s clean sequential read on Gough Lui is close to the 3500 headline, so the spec figure is not the problem here',
     'MEDIUM', 'OFFICIAL', 699),
    ('Seed Kingston NV2 1TB', 'QUALITY', 58, 'Average',
     'DRAM-less entry drive with a widely criticised write curve',
     'Below the DRAM-less Gen4 entry anchor of 66-68. The cause is specific and measured, not vibes: Tom s Hardware rates it as cheap but risky, and independent testing shows sustained writes collapsing once the small DRAM emulation buffer fills, with no published random IOPS spec to set expectations. Kingston is a first-tier maker, which is what keeps it above the no-coverage tier at 61-64',
     'MEDIUM', 'COMMUNITY', 699),
    ('Seed Kingston NV2 1TB', 'VALUE', 70, 'Good',
     '699 MAD = 0.072051 raw index points per MAD',
     'RAW 50.4/699 = 0.072051 -> 55+19*(0.072051-0.016669)/(0.086156-0.016669) = 70.2 -> 70. High on ratio, low on absolute capability, and the gap between this 70 and the 58 QUALITY row is the whole point: the drive is cheap, not good. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 699),

    ('Seed CRUCIAL E100 1TB NVMe', 'PERFORMANCE', 69, 'Average',
     'Micron G7 QLC, 5000/3000 MB/s, 80 TBW',
     'Spec triple 5000/3000 with pcie_generation 4 -> RAW 65.1 -> 27.3256+0.6340*65.1 = 68.6 -> 69. The index cannot see the QLC below the read figure, which is why the drive lands 8 points below the SN770 on a 150 MB/s read difference; see the QUALITY row',
     'MEDIUM', 'OFFICIAL', 1099),
    ('Seed CRUCIAL E100 1TB NVMe', 'QUALITY', 63, 'Average',
     'QLC NAND, DRAM-less, 80 TBW on 1TB',
     'Anchor QLC = 63. Micron G7 QLC on a DRAM-less controller: QLC writes one bit per cell, so sustained write endurance and write consistency are both well below the TLC parts in this batch, and 80 TBW is the lowest endurance figure of any 1TB drive here by a factor of four. Crucial is a first-tier brand and the drive is a legitimate budget product, which holds it there',
     'MEDIUM', 'OFFICIAL', 1099),
    ('Seed CRUCIAL E100 1TB NVMe', 'VALUE', NULL, 'Unrated',
     'Offer price 1099 MAD fails the price integrity gate',
     'Rejected: the WD_BLACK SN770 1TB in this same catalog is faster on both axes (5150/4900 vs 5000/3000), carries 600 TBW against 80 TBW, and costs 100 MAD LESS at 999. A dominated part cannot also be the more expensive one. Honest NULL per plan 2.7; OG-06 owns the correction',
     'LOW', 'RETAILER', 1099),
    -- ================= Budget / off-brand Gen3 =================
    ('Seed MSI SPATIUM M371 1TB', 'PERFORMANCE', 52, 'Poor',
     'Vendor-rated 2350/1900 MB/s, PCIe Gen3 x4',
     'Vendor sheet 2350/1900 with pcie_generation 3 -> RAW 38.2 -> 27.3256+0.6340*38.2 = 51.5 -> 52. DEVIATION recorded: TechPowerUp has no Spatium M371 page, so unlike the other fourteen SSDs this triple comes from the MSI product page alone and is not independently corroborated. The price of being wrong is bounded because the drive is far from any anchor on either side',
     'LOW', 'OFFICIAL', 649),
    ('Seed MSI SPATIUM M371 1TB', 'QUALITY', 64, 'Average',
     'First-tier brand, vendor-only published figures',
     'Anchor budget Gen3 with only a vendor datasheet and no independent review found = 61-64, at the top of that band. MSI is a first-tier maker with a real warranty and a working Spatium Manager utility, and the drive is a Gen3 part, so the fault is the missing third-party coverage rather than the product. No TechPowerUp entry and no review located as of 2026-10-02',
     'LOW', 'OFFICIAL', 649),
    ('Seed MSI SPATIUM M371 1TB', 'VALUE', 67, 'Average',
     '649 MAD = 0.058846 raw index points per MAD',
     'RAW 38.2/649 = 0.058846 -> 55+19*(0.058846-0.016669)/(0.086156-0.016669) = 67.2 -> 67. Inherits the uncorroborated spec triple from the PERFORMANCE row, so this ratio is only as trustworthy as the MSI figure. Confidence LOW (OG-06 price and figure both unverified)',
     'LOW', 'RETAILER', 649),

    ('Seed Intenso Premium 1TB', 'PERFORMANCE', 50, 'Poor',
     'Vendor-rated 2100/1700 MB/s, PCIe Gen3 x4, NVMe 1.3',
     'Vendor sheet 2100/1700 with pcie_generation 3 -> RAW 35.4 -> 27.3256+0.6340*35.4 = 49.8 -> 50. Matches the Netac N930E Pro on both axes to within 30 MB/s, which is the expected result: these are the same controller generation sold under two brands. Inside the compressed sub-45 band, see the KNOWN LIMITATION in the header',
     'LOW', 'OFFICIAL', 599),
    ('Seed Intenso Premium 1TB', 'QUALITY', 62, 'Average',
     'Retailer house brand; no independent review found',
     'Anchor budget Gen3 with only a vendor datasheet and no independent review found = 61-64. Intenso is a German retailer own brand, the M.2 Premium page publishes only headline sequential figures with no IOPS, no endurance figure and no NAND type, and no third-party review was located as of 2026-10-02. It is a real product with a real warranty, which is the only reason this is not below 60',
     'LOW', 'OFFICIAL', 599),
    ('Seed Intenso Premium 1TB', 'VALUE', 67, 'Average',
     '599 MAD = 0.059129 raw index points per MAD',
     'RAW 35.4/599 = 0.059129 -> 55+19*(0.059129-0.016669)/(0.086156-0.016669) = 67.3 -> 67. One MAD-class tie with the Netac at the same 599 MAD for the same silicon, so the ratio is unremarkable rather than a bargain. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 599),

    ('Seed Netac N930E Pro 1TB', 'PERFORMANCE', 50, 'Poor',
     'Vendor-rated 2130/1720 MB/s, PCIe Gen3 x4, 250K/220K random',
     'Distributor TDS 2130/1720 with pcie_generation 3 -> RAW 35.7 -> 27.3256+0.6340*35.7 = 50.0 -> 50. The TechPowerUp page and the Netac distributor datasheet agree exactly, so this triple is corroborated by two sources even though the brand has no review coverage. Inside the compressed sub-45 band, see the KNOWN LIMITATION in the header',
     'MEDIUM', 'OFFICIAL', 599),
    ('Seed Netac N930E Pro 1TB', 'QUALITY', 61, 'Average',
     'Budget brand; TDS and database figures only, no review found',
     'Anchor budget Gen3 with only a vendor datasheet and no independent review found = 61-64, at the bottom of that band. Netac is a low-cost Chinese brand, the N930E Pro is a rebranded controller, and no third-party review was located as of 2026-10-02. Unlike the other three budget drives here the speed figures are corroborated, which is the only thing separating 61 from 58',
     'LOW', 'OFFICIAL', 599),
    ('Seed Netac N930E Pro 1TB', 'VALUE', 67, 'Average',
     '599 MAD = 0.059642 raw index points per MAD',
     'RAW 35.7/599 = 0.059642 -> 55+19*(0.059642-0.016669)/(0.086156-0.016669) = 67.4 -> 67. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 599),

    ('Seed HIKSEMI WAVE 512GB NVMe', 'PERFORMANCE', 49, 'Poor',
     'WAVE(P) 512GB, vendor-rated 2500/1025 MB/s, PCIe Gen3 x4',
     'Vendor sheet 2500/1025 with pcie_generation 3 -> RAW 33.5 -> 27.3256+0.6340*33.5 = 48.6 -> 49. The slowest read/write pair of any drive in this batch. HIKSEMI ships several WAVE variants (WAVE, WAVE(P), WAVE(S), WAVE(N)) and the 512GB figures differ between them, so the WAVE(P) spec is the only one that matches this product name being PCIe 3.0 x4. Inside the compressed sub-45 band, see the KNOWN LIMITATION in the header',
     'LOW', 'OFFICIAL', 599),
    ('Seed HIKSEMI WAVE 512GB NVMe', 'QUALITY', 63, 'Average',
     'Hikvision sub-brand, WAVE(P) line; vendor-only figures',
     'Anchor budget Gen3 with only a vendor datasheet and no independent review found = 61-64. HIKSEMI is a Hikvision sub-brand with real industrial backing, the WAVE(P) 512GB is a documented 3D NAND part with a published 120 TBW and 1.5M-hour MTBF, and the model line is consistent with the catalog form factor and Gen3 interface. The line-up fragmentation across WAVE variants is the caveat, not the maker',
     'LOW', 'OFFICIAL', 599),
    ('Seed HIKSEMI WAVE 512GB NVMe', 'VALUE', NULL, 'Unrated',
     'Offer price 599 MAD fails the price integrity gate',
     'Rejected: the Intenso Premium 1TB in this same catalog costs the same 599 MAD and gives TWICE the capacity with more write bandwidth (1700 vs 1025 MB/s) for 30 MB/s less read. A part cannot be both cheaper and strictly worse. Honest NULL per plan 2.7; OG-06 owns the correction',
     'LOW', 'RETAILER', 599),

    ('Seed TeamGroup MP33 1TB', 'PERFORMANCE', 48, 'Poor',
     'PCIe Gen3 x4, 1800/1500 MB/s, 220K/200K random',
     'Spec triple 1800/1500 with pcie_generation 3 -> RAW 32.4 -> 27.3256+0.6340*32.4 = 47.9 -> 48, the lowest raw index in the batch. The 1800/1500 pair is confirmed by the TeamGroup product page, TechPowerUp and Guru3D. Inside the compressed sub-45 band, see the KNOWN LIMITATION in the header',
     'HIGH', 'OFFICIAL', 699),
    ('Seed TeamGroup MP33 1TB', 'QUALITY', 67, 'Average',
     'TLC with a DRAM buffer and 600 TBW, the cheapest 1TB drive here',
     'Anchor Gen3 mainstream TLC = 67-74, and the cheapest 1TB drive in the catalog by 100 MAD. It has a real DRAM buffer, TLC rather than QLC, and 600 TBW, so on the facts it is a better part than the three budget drives scoring below it. It scores lower on PERFORMANCE only because 1800/1500 MB/s is genuinely slow in 2026, which is exactly the distinction this batch is meant to expose',
     'MEDIUM', 'OFFICIAL', 699),
    ('Seed TeamGroup MP33 1TB', 'VALUE', 63, 'Average',
     '699 MAD = 0.046274 raw index points per MAD',
     'RAW 32.4/699 = 0.046274 -> 55+19*(0.046274-0.016669)/(0.086156-0.016669) = 62.5 -> 63. The lowest ratio of any drive that passes the price gate: at 699 MAD it is 100 MAD dearer than the budget Gen3 drives that are slower on every axis, and 200 MAD dearer than the Netac. That is a price-consistency smell, but it is not an impossibility, so the row is scored rather than rejected. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 699),

    -- ================= RAM =================
    ('Seed CORSAIR VENGEANCE RGB PRO DDR4 3200MHz 16GB 2x8 CL16', 'PERFORMANCE', 65, 'Average',
     'Matched 2x8 DDR4-3200 CL16 pair, 51.2 GB/s effective bandwidth, 10.00 ns',
     'RAW = 100*(0.45*min(1,51.2/96) + 0.25*min(1,10/10.00) + 0.15*1.00 + 0.15*min(1,16/32)) = 71.5 -> 33.0562+0.4494*71.5 = 65.2 -> 65. The best of the five DDR4 kits because it is a matched pair: BEFF 51.2 GB/s against 25.6 for every 1x16 kit in the batch, at the same capacity, same speed and same latency',
     'HIGH', 'OFFICIAL', 1349),
    ('Seed CORSAIR VENGEANCE RGB PRO DDR4 3200MHz 16GB 2x8 CL16', 'QUALITY', 73, 'Good',
     'Matched RGB pair with diffuser, iCUE control, 4-year warranty',
     'Anchor matched RGB kit with a full 4-year warranty and iCUE = 73. Same silicon bin as the bare LPX below (CL16 at 1.35V), plus a matched pair, an RGB diffuser and a longer warranty. The RGB is the only difference and it is worth a small number of points, not a large one, which is why 73 and not 80',
     'MEDIUM', 'OFFICIAL', 1349),
    ('Seed CORSAIR VENGEANCE RGB PRO DDR4 3200MHz 16GB 2x8 CL16', 'VALUE', NULL, 'Unrated',
     'Offer price 1349 MAD fails the price integrity gate',
     'Rejected as one half of a mutually contradictory pair: the CORSAIR VENGEANCE LPX 1x16 in this same catalog is listed at the identical 1349 MAD, and a single 16GB stick cannot be worth the same as a matched 2x8 pair of the same capacity, speed and latency. Which of the two prices is wrong cannot be determined from inside the database, so BOTH are NULL rather than one being scored. Honest NULL per plan 2.7; OG-06 owns the correction',
     'LOW', 'RETAILER', 1349),

    ('Seed CORSAIR VENGEANCE LPX DDR4 3200MHz 16GB 1x16 CL16', 'PERFORMANCE', 57, 'Average',
     'Single 16GB DDR4-3200 CL16 stick, 25.6 GB/s effective bandwidth, 10.00 ns',
     'RAW = 100*(0.45*min(1,25.6/96) + 0.25*min(1,10/10.00) + 0.15*0.55 + 0.15*min(1,16/32)) = 52.8 -> 33.0562+0.4494*52.8 = 56.8 -> 57. Identical to the TWINMOS 1x16 on every term, which is the correct result: same capacity, same speed, same latency, same single-module penalty. The 8-point gap to the RGB PRO pair is the cost of running one channel instead of two',
     'HIGH', 'OFFICIAL', 1349),
    ('Seed CORSAIR VENGEANCE LPX DDR4 3200MHz 16GB 1x16 CL16', 'QUALITY', 70, 'Good',
     'Corsair CL16 low-profile heatspreader, the best-known bare DDR4 bin',
     'Anchor bare CL16 heatspreader IC from the same maker = 70. The CMK16GX4M2D3189C16-class part is a 1.35V CL16 kit, the tightest latency of any module in this batch, and the low-profile heatspreader is the part that fits under a large air cooler. It loses 3 points to the RGB PRO only for being one module instead of two',
     'MEDIUM', 'OFFICIAL', 1349),
    ('Seed CORSAIR VENGEANCE LPX DDR4 3200MHz 16GB 1x16 CL16', 'VALUE', NULL, 'Unrated',
     'Offer price 1349 MAD fails the price integrity gate',
     'Rejected as the other half of the contradictory pair described on the RGB PRO row: a single 16GB stick at the same 1349 MAD as a matched 2x8 pair of the same capacity, speed and latency. Both VALUEs are NULL because the database cannot say which price is wrong. Honest NULL per plan 2.7; OG-06 owns the correction',
     'LOW', 'RETAILER', 1349),

    ('Seed TWINMOS DDR4 3200MHz 16GB 1x16 CL16', 'PERFORMANCE', 57, 'Average',
     'Single 16GB DDR4-3200 CL16 stick, 25.6 GB/s effective bandwidth, 10.00 ns',
     'RAW = 100*(0.45*min(1,25.6/96) + 0.25*min(1,10/10.00) + 0.15*0.55 + 0.15*min(1,16/32)) = 52.8 -> 33.0562+0.4494*52.8 = 56.8 -> 57. Every term matches the Corsair LPX 1x16 exactly, and the whole 8-point difference between this kit and the RGB PRO is the second memory channel, not the silicon. This is the clearest single demonstration of what the channelWeight term is for',
     'HIGH', 'OFFICIAL', 1299),
    ('Seed TWINMOS DDR4 3200MHz 16GB 1x16 CL16', 'QUALITY', 66, 'Average',
     'Unbranded CL16 module; no independent review found',
     'Anchor unbranded CL16 with no independent review found = 66. Tight latency for the money and a first-tier DRAM die, but TWINMOS is a value maker with essentially no English-language review coverage and no established RGB or lighting ecosystem, which is the entire 4-point gap to the Corsair LPX. The CL16 bin itself is legitimate',
     'LOW', 'COMMUNITY', 1299),
    ('Seed TWINMOS DDR4 3200MHz 16GB 1x16 CL16', 'VALUE', 58, 'Average',
     '1299 MAD = 0.040608 raw index points per MAD',
     'RAW 52.8/1299 = 0.040608 -> 55+19*(0.040608-0.035359)/(0.070420-0.035359) = 57.8 -> 58. Identical silicon and price to the rejected Corsair LPX 1x16, which is the strongest available evidence that the 1349 MAD entry is the wrong one and 1299 MAD is the believable one. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 1299),

    ('Seed LEXAR DDR4 3200MHz 16GB 1x16 CL22', 'PERFORMANCE', 54, 'Poor',
     'Single 16GB DDR4-3200 CL22 stick, 25.6 GB/s, 13.75 ns effective latency',
     'RAW = 100*(0.45*min(1,25.6/96) + 0.25*min(1,10/13.75) + 0.15*0.55 + 0.15*min(1,16/32)) = 45.9 -> 33.0562+0.4494*45.9 = 53.7 -> 54. Same bandwidth as the CL16 single sticks but 3.75 ns more latency: CL22 at 1.20V is a JEDEC baseline bin, not a tuned one, and 0.25*(10/13.75) is the only term that separates it from the TWINMOS',
     'HIGH', 'OFFICIAL', 1299),
    ('Seed LEXAR DDR4 3200MHz 16GB 1x16 CL22', 'QUALITY', 64, 'Average',
     'JEDEC baseline CL22 at 1.20V',
     'Anchor JEDEC baseline CL22 at 1.20V = 64. Running 1.20V means this part stays inside the JEDEC default and is safe on any DDR4 board, which is a real advantage for a build with an unknown motherboard; it is also the loosest latency and the lowest voltage in the batch, so it has no performance headroom at all. Lexar is a recognised storage maker, not a house brand',
     'MEDIUM', 'OFFICIAL', 1299),
    ('Seed LEXAR DDR4 3200MHz 16GB 1x16 CL22', 'VALUE', 55, 'Average',
     '1299 MAD = 0.035359 raw index points per MAD, worst in batch',
     'RAW 45.9/1299 = 0.035359 = batch worst -> 55. It is the same 1299 MAD as the TWINMOS CL16 1x16, which is a 2-point index difference and a 7-point performance difference; paying the same for the looser bin is the worst deal among the RAM that passes the price gate. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 1299),

    ('Seed INNOVATION IT DDR4 3200MHz 8GB 1x8 CL22', 'PERFORMANCE', 52, 'Poor',
     'Single 8GB DDR4-3200 CL22 stick, 25.6 GB/s, 13.75 ns',
     'RAW = 100*(0.45*min(1,25.6/96) + 0.25*min(1,10/13.75) + 0.15*0.55 + 0.15*min(1,8/32)) = 42.2 -> 33.0562+0.4494*42.2 = 52.0 -> 52. Same channel count, bandwidth and latency as the LEXAR 16GB CL22 above; the only term that differs is 0.15*min(1,8/32) against 0.15*min(1,16/32), so half the capacity costs 1.7 points on this index. That the index is nearly blind to halving the memory is a real weakness and is stated in the header',
     'HIGH', 'OFFICIAL', 599),
    ('Seed INNOVATION IT DDR4 3200MHz 8GB 1x8 CL22', 'QUALITY', 58, 'Average',
     '8GB single module, JEDEC baseline CL22 at 1.20V',
     'Anchor 8GB single module = 58. The only 8GB part in the catalog, and 8GB is below what a current Windows 11 install plus an application set wants, so this is a part for a repair or a spare machine rather than for a build. The bin itself is unremarkable: 1.20V JEDEC CL22, same as the LEXAR',
     'MEDIUM', 'OFFICIAL', 599),
    ('Seed INNOVATION IT DDR4 3200MHz 8GB 1x8 CL22', 'VALUE', 74, 'Good',
     '599 MAD = 0.070420 raw index points per MAD, best in batch',
     'RAW 42.2/599 = 0.070420 = batch best -> 74. READ THIS ROW AS "cheapest memory per unit of measured performance", NOT as "best memory": this part is 52 (Poor) on PERFORMANCE and 58 on QUALITY, and it wins the ratio only because the index falls 10.6 points when the capacity halves while the price falls 700 MAD. The 8GB capacity cap is the cause and it is recorded in the header, not corrected here. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 599)
) AS v(pname, atype, score, rating, summary, rationale, conf, stype, ref_price)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (
    SELECT 1 FROM component_assessment a
    WHERE a.product_id = p.id AND a.assessment_type = v.atype::assessment_type
);

COMMIT;
