-- ===========================================================================
-- Seed 004b (pilot): component_assessment for the 16 seed-002 CPUs and the
-- 5 seed-002 motherboards (OG-01 batch 2, file 1 of 3)
--
-- Purpose: OG-01 is BLOCKING because 56 catalog products still score the flat
-- no-evidence 40.000 on every weighted type (Decision 13 STEP 1), so with
-- top_k_per_role = 5 the surviving subset is decided by lexicographic UUID
-- order (002 D2 amended 2026-09-28). Seed 004a closed that for GPU/PSU; this
-- file does CPU + MOTHERBOARD: 21 products x 3 types = 63 rows.
--
-- Scope: EXACTLY the 16 CPUs and 5 motherboards of 002_catalog_expansion.sql
-- that have no component_assessment row. Seed 001's products (7500F, 8600G,
-- B650 AORUS, B650M-P, ...) are excluded by the NOT EXISTS guard AND by name,
-- and the 14 seed-001 partial fixtures (scripts/lib/og01-catalog.js
-- DELIBERATE_PARTIAL) are deliberately NOT filled: a missing type is the
-- missing-type branch of Decision 13 STEP 1 and those products are its only
-- live coverage. No spec/offer/variant row is touched.
--
-- Conventions (identical to 001/002/003/004a):
--   * DML only, no DDL. Single BEGIN/COMMIT: all-or-nothing per run.
--   * Idempotent: WHERE NOT EXISTS on (product_id, assessment_type) - a second
--     run inserts zero rows; an existing row (any source) is never overwritten.
--   * NULL score means "researched, not rateable" (rating 'Unrated' + reason):
--     it documents the attempt and keeps that type on the no-evidence branch.
--     It is NEVER a guessed number. 10 of this file's 63 rows are honest NULLs.
--   * assessed_at = NOW() at apply time (decay is linear 0.5%/day).
--   * ASCII only. CRLF.
--
-- CORRECTIONS: because the NOT EXISTS guard protects existing pairs, the NULL
-- VALUE rows below (and any corrected value) must be filled by a LATER seed
-- file that UPDATEs the row by (product_id, assessment_type) - there is no
-- unique constraint on that pair to conflict against. OG-06's price pass is
-- where the six rejected-price VALUEs and the four unrateable types come back.
--
-- RUBRIC ANCHORS (frozen before scoring; plan sections 3-4):
--
-- CPU PERFORMANCE - single anchor chain on Cinebench 2024 MULTI-CORE, read
-- from one ranking table (nanoreview.net CPU ranking list) that carries every
-- target chip. DEVIATION from the parent plan, recorded deliberately: the plan
-- named Cinebench R23 multi, but R23 is retired and no current published table
-- covers all 16 chips uniformly; Cinebench 2024 is the same test's successor
-- version and one extractable table serves the whole batch. The CALIBRATION is
-- unchanged, so seed 001's incumbent still reproduces by construction:
--
--     score = 78 + 10 * ln(cb2024multi / cb2024multi_7500F)
--                   / ln(cb2024multi_5950X / cb2024multi_7500F),  cap [50, 90]
--
-- with cb2024multi_7500F = 833 and cb2024multi_5950X = 1464 from that table.
-- 7500F -> 78 exactly (seed 001); 5950X -> 88 (class top of this batch).
-- Geekbench 6 multi-core from the same table is the documented cross-check.
-- KNOWN LIMITATION, not a bug: a multi-thread metric cannot see 3D V-Cache,
-- so 7800X3D lands beside the 7700X (83 vs 83) despite being the better
-- gaming part; its QUALITY row carries that difference instead.
--
-- CPU QUALITY - silicon/tier plus named product facts, never vibes. Anchors:
-- current-gen flagship 85-88 (7800X3D 88, 12700KF 86), mainstream Zen 4 /
-- Alder Lake 79-84, mainstream Zen 3 75-78, budget Zen 3 72-73, Zen 2 70-71,
-- aging APU 66, OEM-locked PRO 65.
--
-- CPU VALUE - PERFORMANCE points per MAD at this database's live
-- store_offer price, mapped linearly with the batch extremes fixed first:
-- best = 74 (Ryzen 5 5500, 0.08009), worst = 55 (7800X3D, 0.02339).
-- confidence LOW on every computed VALUE row: the offer prices are seed 002's
-- UNVERIFIED assessment-era figures (OG-06).
--
-- PRICE INTEGRITY GATE (execution plan section 3) - 6 of 16 CPU prices fail it,
-- and a rejected price yields a NULL VALUE row, never a score from a price
-- known to be wrong:
--   5700G 5160 vs 5700X 1890  - same 8C/16T Zen 3 die, 2.7x apart
--   5600  2199 vs 5600X 1599  - the weaker part priced higher
--   5950X 2999 vs 5900X 3199  - the 16-core priced below the 12-core
--   3400G 1599 vs 5500  899  - a 4-core Zen+ above a Zen 3 6C/12T
--   5655G 2699                - OEM-only SKU, no retail market (also no anchor figure)
--   A520M A-PRO 582 vs B550M PRO-VDH 952 - cheaper board, strictly fewer features
--
-- MOTHERBOARD QUALITY - vendor tier + published VRM/build facts. MSI PRO (77)
-- sits above the entry A-series (68); the mid ATX Z790 Gaming Plus (78) is a
-- 14+1+1 design. `Seed LPC Gaming B650 DDR5` returns ZERO published coverage
-- (searched 2026-10-02: no vendor page, no review, no listing) so its QUALITY
-- is an honest NULL - the same treatment 004a gave the Connect/HYBROK PSUs.
--
-- MOTHERBOARD UPGRADEABILITY - objective, from this database's spec columns,
-- which seed 002 populated from vendor sheets:
--     50 + 5 per DIMM beyond 2 + min(15, maxGB/192*15)
--        + min(8, max(0,(memMT/s-4400)/400)) + min(7, M.2*1.75)
--        + min(5, PCIe x16*1.67) + 2 if Wi-Fi,            cap 92
-- Calibration: seed 001's "2 DIMM slots -> 60" is the precedent; this rubric
-- scores a 2-DIMM entry board 64 and the 4-DIMM PRO board 75. A NULL
-- pcie_x16_slots (LPC B650) contributes 0 and is documented as UNKNOWN, never
-- as "no slots".
--
-- MOTHERBOARD VALUE - upgrade-spec index per MAD, same 74..55 mapping, from
-- the raw spec columns (not from the UPGRADEABILITY score: no type is derived
-- from another type's score, plan section 4). best = 74 (B550M PRO-VDH
-- 0.07896), worst = 55 (Z790 Gaming Plus 0.03624).
--
-- SOURCES (per-product figures cited in each row's rationale):
--   https://nanoreview.net/en/cpu-list/amd-chips-rating   (AMD CB2024 + GB6)
--   https://nanoreview.net/en/cpu-list/intel-chips-rating (Intel CB2024 + GB6)
--   https://www.msi.com/Motherboard/A520M-A-PRO
--   https://www.msi.com/Motherboard/B550M-PRO-VDH
--   https://www.msi.com/Motherboard/B550M-PRO-VDH-WIFI
--   https://www.tomshardware.com/features/cheap-AMD-b550-motherboards-tested/2
--   https://www.msi.com/Motherboard/Z790-GAMING-PLUS-WIFI
--   https://www.cpubenchmark.net/cpu.php?cpu=AMD+Ryzen+5+PRO+5655G&id=6343
--   Live prices: this database's store_offer rows (MAD), read 2026-10-02.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- INSERT: component_assessment for CPU + MOTHERBOARD (21 products x 3 = 63)
-- Column order: product name, type, score, rating, summary, rationale,
--               confidence, source_type, reference price (MAD, this DB)
-- ---------------------------------------------------------------------------
INSERT INTO component_assessment (product_id, assessment_type, score, rating,
    summary, rationale, confidence, source_type, assessed_at)
SELECT p.id, v.atype::assessment_type, v.score, v.rating, v.summary,
    v.rationale, v.conf::confidence_level, v.stype::source_type, NOW()
FROM (VALUES
    -- ================= Zen+ / Zen 2 / budget (AMD) =================
    ('Seed AMD Ryzen 5 3400G', 'PERFORMANCE', 59, 'Average',
     'Zen+ Picasso 4C/8T; CB2024 multi 292, lowest in this batch',
     'CB2024 multi 292 -> 78+10*ln(292/833)/ln(1464/833)=59.2 -> 59. Geekbench 6 multi 3926 agrees it is last in the batch',
     'MEDIUM', 'COMMUNITY', 1599),
    ('Seed AMD Ryzen 5 3400G', 'QUALITY', 66, 'Average',
     'Zen+ 12nm APU, the oldest platform in this batch',
     'Anchor aging APU = 66: Zen+ Picasso on 12nm, 4C/8T, no current-generation process or platform support',
     'MEDIUM', 'COMMUNITY', 1599),
    ('Seed AMD Ryzen 5 3400G', 'VALUE', NULL, 'Unrated',
     'Offer price 1599 MAD fails the price integrity gate',
     'Rejected: a 4-core Zen+ at 1599 MAD while the Zen 3 6C/12T 5500 sits at 899 MAD in this same catalog. Seed 002 prices are UNVERIFIED (OG-06), so no score is derived from this one. Honest NULL per plan 2.7',
     'LOW', 'RETAILER', 1599),

    ('Seed AMD Ryzen 5 3500X', 'PERFORMANCE', NULL, 'Unrated',
     'No figure in the anchor dataset',
     'The batch anchor table (nanoreview AMD ranking) lists no Ryzen 5 3500X and no per-CPU page exists for it; a sibling SKU figure is deliberately NOT substituted because that would break the single-dataset rule. Honest NULL per plan 2.7',
     'LOW', 'COMMUNITY', 1299),
    ('Seed AMD Ryzen 5 3500X', 'QUALITY', 71, 'Average',
     'Zen 2 6C/6T, PCIe 3.0-only platform',
     'Anchor Zen 2 = 70-71: Zen 2 with a 24-lane PCIe 3.0 platform and a restricted Ryzen 5000 support list',
     'MEDIUM', 'COMMUNITY', 1299),
    ('Seed AMD Ryzen 5 3500X', 'VALUE', NULL, 'Unrated',
     'Not rateable: no PERFORMANCE figure to divide by a price',
     'CPU VALUE is computed from the PERFORMANCE index; with PERFORMANCE NULL there is no input. Honest NULL per plan 2.7',
     'LOW', 'RETAILER', 1299),

    ('Seed AMD Ryzen 5 5500', 'PERFORMANCE', 72, 'Good',
     'Zen 3 Cezanne 6C/12T; CB2024 multi 588',
     'CB2024 multi 588 -> 78+10*ln(588/833)/ln(1464/833)=72.1 -> 72. Geekbench 6 multi 8220 cross-check',
     'MEDIUM', 'COMMUNITY', 899),
    ('Seed AMD Ryzen 5 5500', 'QUALITY', 73, 'Average',
     'Budget Zen 3 on the cut-down Cezanne die',
     'Anchor budget Zen 3 = 72-73: same Zen 3 IPC but reduced PCIe lanes and a trimmed L3 budget versus the 5600',
     'MEDIUM', 'COMMUNITY', 899),
    ('Seed AMD Ryzen 5 5500', 'VALUE', 74, 'Good',
     '899 MAD = 0.08009 performance points per MAD, best in batch',
     '72/899 = 0.08009 = batch best -> 74. Confidence LOW because the price is a seed 002 assessment-era figure (OG-06)',
     'LOW', 'RETAILER', 899),

    ('Seed AMD Ryzen 5 5600', 'PERFORMANCE', 73, 'Good',
     'Zen 3 Vermeer 6C/12T; CB2024 multi 618',
     'CB2024 multi 618 -> 78+10*ln(618/833)/ln(1464/833)=72.7 -> 73. Geekbench 6 multi 9081 cross-check',
     'MEDIUM', 'COMMUNITY', 2199),
    ('Seed AMD Ryzen 5 5600', 'QUALITY', 75, 'Good',
     'Zen 3 6C/12T mainstream part, no iGPU',
     'Anchor mainstream Zen 3 = 75-78: full Zen 3 6-core, no integrated graphics, nothing to flag',
     'MEDIUM', 'COMMUNITY', 2199),
    ('Seed AMD Ryzen 5 5600', 'VALUE', NULL, 'Unrated',
     'Offer price 2199 MAD fails the price integrity gate',
     'Rejected: the non-X 5600 is priced above the strictly faster 5600X (1599 MAD) in this same catalog. Honest NULL per plan 2.7; OG-06 owns the correction',
     'LOW', 'RETAILER', 2199),

    ('Seed AMD Ryzen 5 5600X', 'PERFORMANCE', 72, 'Good',
     'Zen 3 Vermeer 6C/12T at higher clocks; CB2024 multi 583',
     'CB2024 multi 583 -> 78+10*ln(583/833)/ln(1464/833)=71.7 -> 72 (ties the 5500 on multi-thread; the X part is the gaming-faster of the two)',
     'MEDIUM', 'COMMUNITY', 1599),
    ('Seed AMD Ryzen 5 5600X', 'QUALITY', 76, 'Good',
     'Zen 3 6C/12T, the mainstream AM4 gaming pick',
     'Anchor mainstream Zen 3 = 75-78: Zen 3 6-core with higher boost; long-established platform support',
     'MEDIUM', 'COMMUNITY', 1599),
    ('Seed AMD Ryzen 5 5600X', 'VALUE', 62, 'Average',
     '1599 MAD = 0.04503 performance points per MAD',
     '72/1599 = 0.04503 -> 74-(0.04503-0.02339)/(0.08009-0.02339)*19 = 62. Confidence LOW (OG-06 price)',
     'LOW', 'RETAILER', 1599),

    ('Seed AMD Ryzen 5 PRO 5655G', 'PERFORMANCE', NULL, 'Unrated',
     'No figure in the anchor dataset',
     'The batch anchor table lists no PRO 5655G. The nearest measured chip (5600G) is a different SKU with lower clocks, so its figure is NOT substituted. Honest NULL per plan 2.7',
     'LOW', 'COMMUNITY', 2699),
    ('Seed AMD Ryzen 5 PRO 5655G', 'QUALITY', 65, 'Average',
     'OEM-locked PRO APU (Cezanne rebadge), not a retail part',
     'Anchor OEM-locked = 64-70: the PRO 5655G is an OEM-only SKU rebadged from 5600G silicon, sold inside business machines rather than retail',
     'MEDIUM', 'OFFICIAL', 2699),
    ('Seed AMD Ryzen 5 PRO 5655G', 'VALUE', NULL, 'Unrated',
     'Not rateable: OEM-only SKU with no retail price and no PERFORMANCE figure',
     'Two independent reasons for an honest NULL per plan 2.7: no PERFORMANCE index to value, and no retail market to price against (cpubenchmark lists this SKU with no price)',
     'LOW', 'RETAILER', 2699),

    -- ================= Zen 3 (Vermeer / Cezanne) =================
    ('Seed AMD Ryzen 7 5700G', 'PERFORMANCE', 76, 'Good',
     'Zen 3 Cezanne 8C/16T APU with Vega graphics; CB2024 multi 755',
     'CB2024 multi 755 -> 78+10*ln(755/833)/ln(1464/833)=76.3 -> 76. Geekbench 6 multi 9839 cross-check',
     'MEDIUM', 'COMMUNITY', 5160),
    ('Seed AMD Ryzen 7 5700G', 'QUALITY', 72, 'Average',
     'Zen 3 APU: strong iGPU, 8 cores on the older Cezanne step',
     'Anchor APU tier = 72: capable but a previous-step die (Zen 3 not Zen 3+), so it sits below the Vermeer 8-cores on sustained performance per core',
     'MEDIUM', 'COMMUNITY', 5160),
    ('Seed AMD Ryzen 7 5700G', 'VALUE', NULL, 'Unrated',
     'Offer price 5160 MAD fails the price integrity gate',
     'Rejected: 5160 MAD against 1890 MAD for the 5700X, which is the same 8C/16T Zen 3 silicon without the APU penalty - a 2.7x gap on one die. Honest NULL per plan 2.7; OG-06 owns the correction',
     'LOW', 'RETAILER', 5160),

    ('Seed AMD Ryzen 7 5700X', 'PERFORMANCE', 78, 'Good',
     'Zen 3 Vermeer 8C/16T; CB2024 multi 830',
     'CB2024 multi 830 -> 78+10*ln(830/833)/ln(1464/833)=78.0 -> 78. Geekbench 6 multi 10313 cross-check (the map reproduces seed 001 7500F = 78 exactly at the anchor point)',
     'MEDIUM', 'COMMUNITY', 1890),
    ('Seed AMD Ryzen 7 5700X', 'QUALITY', 76, 'Good',
     'Zen 3 8C/16T mainstream part',
     'Anchor mainstream Zen 3 = 75-78: full Vermeer 8-core, the value entry into Zen 3 8-core',
     'MEDIUM', 'COMMUNITY', 1890),
    ('Seed AMD Ryzen 7 5700X', 'VALUE', 61, 'Average',
     '1890 MAD = 0.04127 performance points per MAD',
     '78/1890 = 0.04127 -> 74-(0.04127-0.02339)/(0.08009-0.02339)*19 = 61. Confidence LOW (OG-06 price)',
     'LOW', 'RETAILER', 1890),

    ('Seed AMD Ryzen 7 5800X', 'PERFORMANCE', 79, 'Good',
     'Zen 3 Vermeer 8C/16T at 105 W; CB2024 multi 876',
     'CB2024 multi 876 -> 78+10*ln(876/833)/ln(1464/833)=78.9 -> 79. Geekbench 6 multi 10270 cross-check',
     'MEDIUM', 'COMMUNITY', 2249),
    ('Seed AMD Ryzen 7 5800X', 'QUALITY', 77, 'Good',
     'Zen 3 8C/16T, ageing at 105 W',
     'Anchor mainstream Zen 3 = 75-78: strong silicon, but a 2020 part drawing 105 W against 65 W parts of the same class',
     'MEDIUM', 'COMMUNITY', 2249),
    ('Seed AMD Ryzen 7 5800X', 'VALUE', 59, 'Average',
     '2249 MAD = 0.03513 performance points per MAD',
     '79/2249 = 0.03513 -> 74-(0.03513-0.02339)/(0.08009-0.02339)*19 = 59. Confidence LOW (OG-06 price)',
     'LOW', 'RETAILER', 2249),

    ('Seed AMD Ryzen 9 5900X', 'PERFORMANCE', 84, 'Good',
     'Zen 3 Vermeer 12C/24T at 105 W; CB2024 multi 1193',
     'CB2024 multi 1193 -> 78+10*ln(1193/833)/ln(1464/833)=84.4 -> 84. Geekbench 6 multi 12701 cross-check',
     'MEDIUM', 'COMMUNITY', 3199),
    ('Seed AMD Ryzen 9 5900X', 'QUALITY', 78, 'Good',
     'Zen 3 12C/24T, proven but on an end-of-life platform',
     'Anchor mainstream Zen 3 = 75-78: excellent silicon; AM4 receives no further CPU generations, which caps how long the platform stays current',
     'MEDIUM', 'COMMUNITY', 3199),
    ('Seed AMD Ryzen 9 5900X', 'VALUE', 56, 'Average',
     '3199 MAD = 0.02626 performance points per MAD',
     '84/3199 = 0.02626 -> 74-(0.02626-0.02339)/(0.08009-0.02339)*19 = 56. Confidence LOW (OG-06 price)',
     'LOW', 'RETAILER', 3199),

    ('Seed AMD Ryzen 9 5950X', 'PERFORMANCE', 88, 'Great',
     'Zen 3 Vermeer 16C/32T, the batch performance leader; CB2024 multi 1464',
     'CB2024 multi 1464 -> 78+10*ln(1464/833)/ln(1464/833)=88 = the fixed top anchor of this batch. Geekbench 6 multi 12728 cross-check',
     'HIGH', 'COMMUNITY', 2999),
    ('Seed AMD Ryzen 9 5950X', 'QUALITY', 80, 'Good',
     'Zen 3 16C/32T flagship, one of the most recommended chips of its era',
     'Anchor mainstream Zen 3 upper = 80: full 16-core Vermeer with strong consensus reliability, minus the AM4 platform end-of-life',
     'MEDIUM', 'COMMUNITY', 2999),
    ('Seed AMD Ryzen 9 5950X', 'VALUE', NULL, 'Unrated',
     'Offer price 2999 MAD fails the price integrity gate',
     'Rejected: the 16-core is priced below the 12-core 5900X (3199 MAD) in this same catalog, which is not a possible price ordering. Honest NULL per plan 2.7; OG-06 owns the correction',
     'LOW', 'RETAILER', 2999),

    -- ================= Zen 4 (AM5) =================
    ('Seed AMD Ryzen 7 7700X', 'PERFORMANCE', 83, 'Good',
     'Zen 4 Raphael 8C/16T at 105 W; CB2024 multi 1104',
     'CB2024 multi 1104 -> 78+10*ln(1104/833)/ln(1464/833)=82.9 -> 83. Geekbench 6 multi 15478 cross-check',
     'MEDIUM', 'COMMUNITY', 2799),
    ('Seed AMD Ryzen 7 7700X', 'QUALITY', 84, 'Good',
     'Zen 4 mainstream with a usable 2-core iGPU',
     'Anchor mainstream Zen 4 = 79-84: current-generation 8-core on a live AM5 platform; the integrated graphics make it the safer all-round pick here',
     'MEDIUM', 'COMMUNITY', 2799),
    ('Seed AMD Ryzen 7 7700X', 'VALUE', 57, 'Average',
     '2799 MAD = 0.02965 performance points per MAD',
     '83/2799 = 0.02965 -> 74-(0.02965-0.02339)/(0.08009-0.02339)*19 = 57. Confidence LOW (OG-06 price)',
     'LOW', 'RETAILER', 2799),

    ('Seed AMD Ryzen 7 7800X3D', 'PERFORMANCE', 83, 'Good',
     'Zen 4 8C/16T with 3D V-Cache; CB2024 multi 1119',
     'CB2024 multi 1119 -> 78+10*ln(1119/833)/ln(1464/833)=83.3 -> 83. DOCUMENTED LIMITATION: a multi-thread chain cannot see the V-Cache advantage, so it lands level with the 7700X although it is clearly the faster gaming part; the QUALITY row carries that difference',
     'MEDIUM', 'COMMUNITY', 3549),
    ('Seed AMD Ryzen 7 7800X3D', 'QUALITY', 88, 'Great',
     'Class-leading gaming part: Zen 4 plus stacked 3D V-Cache',
     'Anchor current-gen flagship = 85-88: the batch top, on documented gaming-first position and 96 MB of L3 rather than a higher multi-thread score',
     'HIGH', 'COMMUNITY', 3549),
    ('Seed AMD Ryzen 7 7800X3D', 'VALUE', 55, 'Average',
     '3549 MAD = 0.02339 performance points per MAD, worst in batch',
     '83/3549 = 0.02339 = batch worst -> 55. Confidence LOW (OG-06 price); a gaming-weighted chain would rate this part differently, which the header records as a known limitation',
     'LOW', 'RETAILER', 3549),

    ('Seed AMD Ryzen 7 8700F', 'PERFORMANCE', 80, 'Good',
     'Zen 4 Phoenix 8C/16T at 65 W; CB2024 multi 947',
     'CB2024 multi 947 -> 78+10*ln(947/833)/ln(1464/833)=80.3 -> 80. Geekbench 6 multi 14313 cross-check',
     'MEDIUM', 'COMMUNITY', 1749),
    ('Seed AMD Ryzen 7 8700F', 'QUALITY', 79, 'Good',
     'Zen 4 8-core at 65 W, efficient F-variant',
     'Anchor mainstream Zen 4 = 79-84: current generation and efficient; no iGPU, which is the only reason it sits below the 7700X',
     'MEDIUM', 'COMMUNITY', 1749),
    ('Seed AMD Ryzen 7 8700F', 'VALUE', 62, 'Average',
     '1749 MAD = 0.04574 performance points per MAD',
     '80/1749 = 0.04574 -> 74-(0.04574-0.02339)/(0.08009-0.02339)*19 = 62. Confidence LOW (OG-06 price)',
     'LOW', 'RETAILER', 1749),

    -- ================= Intel Alder Lake (LGA1700) =================
    ('Seed Intel Core i5-12400F', 'PERFORMANCE', 73, 'Good',
     'Alder Lake 6P+0E at 65 W; CB2024 multi 640',
     'CB2024 multi 640 -> 78+10*ln(640/833)/ln(1464/833)=73.3 -> 73. Geekbench 6 multi 9477 cross-check',
     'MEDIUM', 'COMMUNITY', 1549),
    ('Seed Intel Core i5-12400F', 'QUALITY', 76, 'Good',
     'Efficient 6-core Alder Lake, but an F-part with no iGPU',
     'Anchor mainstream class = 76: current-generation efficiency and broad LGA1700 support; no integrated graphics is the one drawback on a no-GPU build',
     'MEDIUM', 'COMMUNITY', 1549),
    ('Seed Intel Core i5-12400F', 'VALUE', 63, 'Average',
     '1549 MAD = 0.04713 performance points per MAD',
     '73/1549 = 0.04713 -> 74-(0.04713-0.02339)/(0.08009-0.02339)*19 = 63. Confidence LOW (OG-06 price)',
     'LOW', 'RETAILER', 1549),

    ('Seed Intel Core i7-12700KF', 'PERFORMANCE', 86, 'Great',
     'Alder Lake 8P+4E hybrid, the batch multi-thread leader among 65-125 W parts; CB2024 multi 1284',
     'CB2024 multi 1284 -> 78+10*ln(1284/833)/ln(1464/833)=86.1 -> 86. Geekbench 6 multi 15378 cross-check',
     'HIGH', 'COMMUNITY', 2699),
    ('Seed Intel Core i7-12700KF', 'QUALITY', 82, 'Good',
     'Hybrid 12-core with a strong single-thread tier',
     'Anchor mainstream class = 82: 8 performance plus 4 efficiency cores and very high single-thread for the generation; KF means no iGPU',
     'MEDIUM', 'COMMUNITY', 2699),
    ('Seed Intel Core i7-12700KF', 'VALUE', 58, 'Average',
     '2699 MAD = 0.03186 performance points per MAD',
     '86/2699 = 0.03186 -> 74-(0.03186-0.02339)/(0.08009-0.02339)*19 = 58. Confidence LOW (OG-06 price)',
     'LOW', 'RETAILER', 2699),

    -- ================= Motherboards =================
    ('Seed LPC Gaming B650 DDR5', 'QUALITY', NULL, 'Unrated',
     'No published coverage found for this regional brand',
     'Searched 2026-10-02 for a vendor page, a review or a retail listing: zero results, so build quality, VRM and warranty cannot be sourced. QUALITY is the only quality gate the engine has for this board, so per 002 D2 it must not be seeded optimistically. Honest NULL per plan 2.7',
     'LOW', 'COMMUNITY', 2190),
    ('Seed LPC Gaming B650 DDR5', 'UPGRADEABILITY', 86, 'Great',
     '4 DIMM, 192 GB max, DDR5-4800..6400, 2 M.2, Wi-Fi',
     'Spec rubric from this database columns: 50 + 5*(4-2) + min(15,192/192*15) + min(8,(6400-4400)/400) + min(7,2*1.75) + 0 for the UNKNOWN pcie_x16_slots + 2 wifi = 85.5 -> 86. The NULL PCIe count contributes 0 and is documented as unknown, not as no slots; the board may well be more expandable than it is provable here',
     'MEDIUM', 'OFFICIAL', 2190),
    ('Seed LPC Gaming B650 DDR5', 'VALUE', 56, 'Average',
     '2190 MAD = 0.03904 upgrade-spec points per MAD',
     'Raw spec index 85.5/2190 = 0.03904 -> 74-(0.03904-0.03624)/(0.07896-0.03624)*19 = 56. Computed from the raw spec columns, not from the UPGRADEABILITY score',
     'LOW', 'RETAILER', 2190),

    ('Seed MSI A520M A-PRO', 'QUALITY', 68, 'Average',
     'MSI entry A-series micro-ATX with a 4+2 phase VRM',
     'Tier anchor: MSI A-series entry = 68. Vendor sheet and board teardowns describe a 4+2 design, 2 DIMM and a single M.2 - adequate for a 65 W Ryzen 3000/5000, not a tier above it',
     'HIGH', 'OFFICIAL', 582),
    ('Seed MSI A520M A-PRO', 'UPGRADEABILITY', 64, 'Average',
     '2 DIMM, 128 GB max, DDR4-1866..4600, 1 M.2, no Wi-Fi',
     'Spec rubric: 50 + 0 (only 2 DIMM) + min(15,128/192*15) + min(8,(4600-4400)/400) + min(7,1*1.75) + min(5,1*1.67) + 0 = 63.9 -> 64. Seed 001 calibrated its 2-DIMM board at 60; this rubric lands an equivalent board at 64',
     'MEDIUM', 'OFFICIAL', 582),
    ('Seed MSI A520M A-PRO', 'VALUE', NULL, 'Unrated',
     'Offer price 582 MAD fails the price integrity gate',
     'Rejected: a strictly worse board (2 DIMM, 1 M.2, no Wi-Fi, entry chipset) priced below the B550M PRO-VDH at 952 MAD in this same catalog. Honest NULL per plan 2.7; OG-06 owns the correction',
     'LOW', 'RETAILER', 582),

    ('Seed MSI B550M PRO-VDH', 'QUALITY', 77, 'Good',
     'MSI PRO micro-ATX: 4+2 phase VRM on 2 oz copper with a thermal solution',
     'Tier anchor: MSI PRO line = 77. The PRO series is MSI business-oriented with a heavier VRM than its budget lines; Tomshardware tested it among four affordable B550 boards and found it the better-built of the set',
     'HIGH', 'OFFICIAL', 952),
    ('Seed MSI B550M PRO-VDH', 'UPGRADEABILITY', 75, 'Good',
     '4 DIMM, 128 GB max, DDR4-1866..4400, 2 M.2, no Wi-Fi',
     'Spec rubric: 50 + 5*(4-2) + min(15,128/192*15) + 0 (4400 ceiling) + min(7,2*1.75) + min(5,1*1.67) + 0 = 75.2 -> 75',
     'MEDIUM', 'OFFICIAL', 952),
    ('Seed MSI B550M PRO-VDH', 'VALUE', 74, 'Good',
     '952 MAD = 0.07896 upgrade-spec points per MAD, best in batch',
     'Raw spec index 75.2/952 = 0.07896 = batch best -> 74. This is the cheapest genuinely expandable board in the set',
     'LOW', 'RETAILER', 952),

    ('Seed MSI B550M PRO-VDH WIFI', 'QUALITY', 77, 'Good',
     'Same board as the PRO-VDH plus the wireless module',
     'Same tier anchor as the non-WIFI board (MSI PRO line = 77): identical silicon and VRM, the radio is an add-on and does not raise build quality, so it is not scored higher here',
     'HIGH', 'OFFICIAL', 1267),
    ('Seed MSI B550M PRO-VDH WIFI', 'UPGRADEABILITY', 77, 'Good',
     '4 DIMM, 128 GB max, DDR4-1866..4400, 2 M.2, Wi-Fi',
     'Spec rubric: 75.2 as the non-WIFI board plus the 2-point Wi-Fi allowance = 77.2 -> 77',
     'MEDIUM', 'OFFICIAL', 1267),
    ('Seed MSI B550M PRO-VDH WIFI', 'VALUE', 66, 'Average',
     '1267 MAD = 0.06091 upgrade-spec points per MAD',
     'Raw spec index 77.2/1267 = 0.06091 -> 74-(0.06091-0.03624)/(0.07896-0.03624)*19 = 66. The 315 MAD premium over the non-WIFI board buys the radio and two rubric points',
     'LOW', 'RETAILER', 1267),

    ('Seed MSI Z790 GAMING PLUS WIFI', 'QUALITY', 78, 'Good',
     'MSI mid-range ATX Z790 with a 14+1+1 power design',
     'Tier anchor: MSI mid ATX = 78, below the PRO Z790 boards but a genuine 14+1+1 design with dual power connectors per the vendor sheet; LGA1700 platform with 12th-14th gen support',
     'HIGH', 'OFFICIAL', 2649),
    ('Seed MSI Z790 GAMING PLUS WIFI', 'UPGRADEABILITY', 92, 'Great',
     '4 DIMM, 256 GB max, DDR5-4800..7200, 4 M.2, 3x PCIe x16, Wi-Fi',
     'Spec rubric: 50 + 5*(4-2) + min(15,256/192*15) + min(8,(7200-4400)/400) + min(7,4*1.75) + min(5,3*1.67) + 2 = 96.0, capped at 92 - the most expandable board in the set on every axis',
     'MEDIUM', 'OFFICIAL', 2649),
    ('Seed MSI Z790 GAMING PLUS WIFI', 'VALUE', 55, 'Average',
     '2649 MAD = 0.03624 upgrade-spec points per MAD, worst in batch',
     'Raw spec index 96.0/2649 = 0.03624 = batch worst -> 55. The board is the most expandable and among the most expensive, so per-dirham expansion is the lowest here',
     'LOW', 'RETAILER', 2649)
) AS v(pname, atype, score, rating, summary, rationale, conf, stype, ref_price)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (
    SELECT 1 FROM component_assessment a
    WHERE a.product_id = p.id AND a.assessment_type = v.atype::assessment_type
);

COMMIT;
