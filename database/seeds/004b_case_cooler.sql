-- ===========================================================================
-- Seed 004b (file 3 of 3, FINAL): component_assessment for the 8 seed-002 cases
-- and 7 seed-002 CPU coolers (OG-01 batch 2) + the missing radiator matrices
--
-- Purpose: this file closes OG-01. The 8 cases and 7 coolers below are the
-- last 15 of the 56 products that still scored the flat no-evidence 40.000
-- on every weighted type (Decision 13 STEP 1), so with top_k_per_role = 5 the
-- surviving subset was decided by lexicographic UUID order. After this file
-- `node scripts/check-og01-coverage.js --strict` is clean and no live catalog
-- product reaches a build on a flat 40.000.
--
-- Scope: EXACTLY the 8 cases and 7 coolers of 002_catalog_expansion.sql that
-- have no component_assessment row. Deliberately NOT filled:
--   * Seed Fractal Pop XL (DELIBERATE_PARTIAL, missing THERMALS + VALUE)
--   * Seed NZXT H5 Flow Compact (DELIBERATE_NO_EVIDENCE)
--   * Seed DeepCool AG400, Seed Noctua NH-U12S SE-AM5 (DELIBERATE_PARTIAL,
--     missing QUALITY + VALUE)
-- Those keep Decision 13 STEP 1's missing-type branch and its no-evidence
-- branch live; they are the only coverage those two branches have
-- (scripts/lib/og01-catalog.js). Seed 001's fully-assessed products are
-- excluded by the NOT EXISTS guard AND by name. No spec/offer/variant row
-- is touched.
--
-- SECOND JOB: OG-05. 6 of the 10 cases in this catalog had ZERO
-- case_radiator_support rows, which is a HARD FAIL for every liquid cooler
-- in the catalog. Those 6 are exactly the 6 cases scored below, so this file
-- also writes their radiator matrices (52 rows, section 3). That is why this
-- file touches a second table: the CASE THERMALS rubric is DERIVED from the
-- radiator matrix, so the matrix has to exist for the scores to be checkable.
-- After this file all 10 cases have a radiator matrix.
--
-- Conventions (identical to 001/002/003/004a/004b files 1-2):
--   * DML only, no DDL. Single BEGIN/COMMIT: all-or-nothing per run.
--   * Idempotent: WHERE NOT EXISTS on both inserts - a second run inserts zero
--     rows; an existing row (any source) is never overwritten or duplicated.
--   * NULL score means "researched, not rateable" (rating 'Unrated' + reason).
--   * assessed_at = NOW() at apply time (decay is linear 0.5%/day).
--   * ASCII only. CRLF.
--   * 0 of this file's 45 rows are honest NULLs, unlike files 1 and 2. That
--     is a finding, not an omission - see PRICE INTEGRITY GATE below.
--
-- DATA AVAILABILITY (recorded because it shaped the rubric):
--   * case_spec has max_gpu_length_mm, max_gpu_thickness_slots,
--     max_cpu_cooler_height_mm, psu_form_factor, max_psu_length_mm - and NO
--     airflow, radiator or noise column. Radiator capacity lives in a SEPARATE
--     table (case_radiator_support: radiator_size_mm + free-text position),
--     which was empty for 6 of 10 cases until this file.
--   * cooler_spec has cooling_type, max_tdp_watts, height_mm, length_mm,
--     width_mm - and NO radiator_size, fan_size or noise column. So the
--     radiator term of the COOLER THERMALS rubric is RESEARCH, and radiator
--     size is deliberately NOT inferred from length_mm.
--
-- RUBRIC ANCHORS (frozen before scoring; plan sections 3-4):
--
-- CASE THERMALS - a spec index over what actually decides whether a case can
-- cool a build. TOP2 is the sum of the two largest per-position maxima, i.e.
-- the largest pair of radiators a builder can actually fit at once; summing
-- every supported size instead would count alternatives as if they were
-- simultaneous and would score a case for mounting holes it cannot use.
-- NPOS is the number of distinct radiator positions.
--     RAW = 100 * ( 0.45 * min(1, TOP2mm / 720)      <- 2 x 360mm
--                  + 0.25 * min(1, cpuCoolerMm / 180)
--                  + 0.20 * min(1, gpuLengthMm / 430)
--                  + 0.10 * min(1, NPOS / 4) )
--     THERMALS = 25 + 0.65 * RAW,  clamp [50, 92]
-- DEVIATION from the parent plan, recorded deliberately: this rubric has NO
-- seed-001 calibration point. The only existing CASE assessment is Fractal
-- Pop XL QUALITY 70, which is a different type, so unlike files 1 and 2 there
-- is nothing to reproduce and no reproduction is claimed. The constants are a
-- stated spec rubric in the same spirit as the MOTHERBOARD UPGRADEABILITY
-- rubric in file 1, which was likewise uncalibrated. 720mm and 430mm are the
-- batch maxima (dual-360 and the Frame 4000D), so no target saturates on them
-- except by tying.
--
-- CASE QUALITY - vendor tier and named build facts. The single anchor is
-- seed 001's Fractal Pop XL at 70, a budget ATX mid-tower, so the budget
-- mesh-front class is 70 and everything above it is scored on what it adds:
-- panoramic glass and reverse-connector support 80, the iCUE LINK ecosystem
-- 78, premium dual-glass 76, mainstream dual-glass 74, four pre-installed
-- ARGB fans 73. Note what this is NOT: 7 of the 8 land in the Good band
-- because all eight are competent cases and there is no bad one in the batch.
-- The two colour variants of the same chassis score IDENTICALLY, because
-- colour is not a build-quality difference.
--
-- CASE VALUE - the RAW spec index per MAD at this database's live store_offer
-- price, mapped linearly with the batch extremes fixed first: best = 74 (MSI
-- MAG FORGE 320R AIRFLOW White, 0.100707), worst = 55 (MSI MAG PANO 100R PZ
-- Blanc, 0.057354). The raw index, NOT the THERMALS score: no type is derived
-- from another type score (plan section 4). confidence LOW on every computed
-- VALUE row - the offer prices are seed 002 UNVERIFIED assessment-era figures
-- (OG-06).
--
-- PRICE INTEGRITY GATE (execution plan section 3) - RUN AND CLEAN: 0 of the
-- 15 prices fail, so this file has no rejected-price NULL. Four comparisons
-- were run and all four are internally consistent:
--   * iCUE LINK 3500X ARGB 1599 vs 3500X 949 - a 68% premium, but Corsair
--     prices the real product the same way (about $155 vs about $100), and it
--     adds a LINK hub, preinstalled fans and an ARGB strip. Not impossible.
--   * MAG PANO 100R PZ 1699 vs MPG VELOX 100R WHITE 1619 - PANO has three
--     360-capable positions to the VELOX two, the VELOX has 250mm of PSU
--     clearance to the PANO 200mm. Near-even parts, near-even prices.
--   * MAG FORGE 320R AIRFLOW 849 vs Corsair 3500X 949 - the cheaper one is
--     the more radiator-limited one, which is the correct direction.
--   * CORELIQUID 240R 799 vs A13 360 WHITE 1299 - a 240mm AIO below a 360mm
--     AIO, and the MYSTIQUE 360 at 1699 is above the LCD-less A13 for the LCD.
-- Recorded here so a later pass does not re-open the question and so the
-- absence of NULLs is visibly deliberate.
--
-- COOLER THERMALS - the database gives max_tdp_watts but not radiator size, so
-- the index is a rated-TDP term plus a researched radiator-class term:
--     RAW = 100 * ( 0.55 * min(1, max_tdp_watts / 300)
--                  + 0.45 * min(1, radiatorMm / 360) )   <- 0 for AIR
--     THERMALS = 67.9333 + 0.20 * RAW,  clamp [50, 92]
-- The intercept is pinned by the one seed-001 point this rubric can honour:
-- DeepCool AG400, an AIR cooler rated 220 W, scored THERMALS 76 - the same
-- 220 W class as this batch's only air target, so 76 is reproduced by
-- construction. The slope 0.20 is fixed, not fitted.
-- DEVIATION, recorded deliberately and NOT worked around: seed 001's OTHER
-- cooler, Noctua NH-U12S SE-AM5, is rated 180 W and scored THERMALS 84, which
-- is ABOVE the 220 W AG400. No rating-based formula can reproduce both, and
-- that is not an error in either row: the NH-U12S SE-AM5 genuinely outperforms
-- its rating (a 7-fin 120 mm tower on the NF-A12x25), so seed 001 wrote
-- THERMALS as a MEASURED-BEHAVIOUR judgement rather than a rating
-- transcription. Reproducing it would need one uniform measured dataset
-- covering the Noctua and all seven targets, and none exists. The honest
-- consequence is a class asymmetry that is left visible rather than fudged:
-- a liquid cooler with no radiator data scores 0 on the radiator term, so the
-- air class tops out near 79-84 on this scale, which is exactly where the
-- Noctua already sits and is the standard consensus that a premium air cooler
-- is worth about a small AIO.
--
-- COOLER QUALITY - named product facts, never vibes. ML280 Mirror 74: two
-- 140 mm ARGB fans and a <10 dBA pump, but a 2020 design on a 3-PIN pump
-- connector with no PWM control. Nautilus 240 RS ARGB 78: convex cold plate,
-- pre-applied paste, 5-year warranty, 2100 RPM, no LCD to go wrong. MYSTIQUE
-- 360 80: LCD, 3-phase 6-slot motor, 3400 RPM, documented anti-leak design,
-- and the best-reviewed cooler in this batch. A13 360 WHITE 76: 12 widened
-- water channels, ceramic bearings, 3800 RPM pump, but no display.
-- COREFROZR AA13 70: MSI's first air cooler in a decade, 4 heat pipes,
-- 152 mm, 30.11 dBA, correct for its class. CORELIQUID 240R 64: the ORIGINAL
-- 240R, not the V2 - MSI ships a revision because of it, and MSI's own forum
-- carries a long thread on its pump cycling and gurgling. That is a documented
-- product fault, not a preference, and it is the only reason a 64 sits in this
-- file.
--
-- COOLER VALUE - the RAW spec index per MAD, same 74..55 mapping, from the
-- raw index (not from the THERMALS score). best = 74 (MSI MAG CORELIQUID
-- 240R, 0.083438), worst = 55 (Cooler Master ML280 Mirror, 0.057594).
-- KNOWN LIMITATION, stated because it looks wrong and is not: the
-- CORELIQUID 240R is 74 (Good) on VALUE while it is 64 (Average) on QUALITY,
-- the same index-per-MAD artifact the RAM rows in file 2 carry. "Index points
-- per MAD" rewards a cheap part; read QUALITY for whether it is a good one.
--
-- SOURCES (per-product figures cited in each row's rationale; read 2026-10-02):
--   https://www.corsair.com/us/en/p/pc-cases/cc-9011276-ww/3500x-mid-tower-pc-case-cc-9011276-ww
--     3500X radiator layout, 170mm CPU cooler, 180mm PSU, no fans included
--   https://www.corsair.com/us/en/p/pc-cases/cc-9011281-ww/icue-link-3500x-rgb-mid-tower-pc-case-white-cc-9011281-ww
--     iCUE LINK 3500X radiator layout, dual 360mm
--   https://www.corsair.com/us/en/p/cpu-coolers/cw-9060092-ww/nautilus-240-rs-argb-liquid-cpu-cooler-cw-9060092-ww
--   https://www.msi.com/PC-Case/MAG-FORGE-320R-AIRFLOW/Specification
--   https://storage-asset.msi.com/datasheet/pcc/id/MAG-FORGE-320R-AIRFLOW.pdf
--   https://us.msi.com/PC-Case/MAG-PANO-100R-PZ/Specification
--   https://download.msi.com/archive/mnu_exe/case/MAGPANO100L100RPZWHITE_English.pdf
--   https://www.msi.com/PC-Case/MPG-VELOX-100R-WHITE/Specification
--   https://www.msi.com/Air-Cooling/MAG-COREFROZR-AA13   (240W, 4 heat pipes)
--   https://www.msi.com/Liquid-Cooling/MAG-CORELIQUID-240R-V2/Specification
--   https://www.msi.com/Liquid-Cooling/MAG-CORELIQUID-A13-360/Specification
--   https://forum-en.msi.com/index.php?threads/mag-coreliquid-240r-msi-pump-noise.367296/
--   https://www.deepcool.com/products/Cooling/cpuliquidcoolers/MYSTIQUE-360-5th-Gen-Liquid-Cooler-with-LCD-1851-1700-AM5/2024/18059.shtml
--   https://aphnetworks.com/reviews/deepcool-mystique-360   (3400 RPM, 21 dBA)
--   https://www.kitguru.net/components/cooling/james-dawson/deepcool-mystique-360-aio-cpu-cooler-review/
--   https://lanoc.org/review/cooling/cooler-master-masterliquid-ml280-mirror
--   https://thinkcomputers.org/cooler-master-masterliquid-ml280-mirror-liquid-cpu-cooler-review/
--   https://www.tomshardware.com/pc-components/air-cooling/msi-introduces-240-watt-core-frozr-cpu-cooler-marks-return-to-air-cooling-market-after-10-year-hiatus
--   Live prices: this database's store_offer rows (MAD), read 2026-10-02.
--
-- KNOWN DATA DISCREPANCIES found while researching (recorded, not corrected -
-- these are spec rows owned by seed 002, and OG-06/OG-05 own the fix):
--   * case_spec.max_cpu_cooler_height_mm = 161 for MAG FORGE 320R; MSI
--     publishes 160mm in five places. 1mm, but it is a transcription slip.
--   * case_spec.max_gpu_length_mm = 410 for the Corsair 3500X; Corsair
--     publishes 425mm. The DB is CONSERVATIVE, so no build is falsely
--     accepted, which is the safe direction for this column.
--   * cooler_spec.max_tdp_watts = 220 for the COREFROZR AA13; MSI publishes
--     240W. Used 220 (the DB figure) in the THERMALS index so the rubric
--     stays reproducible from the database; 240W would add 3.7 RAW points.
--   * cooler_spec.max_tdp_watts = 280 for the ML280 Mirror; Cooler Master and
--     thinkcomputers both give 230W. The DB is OPTIMISTIC here, the opposite
--     direction to the GPU column, so this one is a real overstatement.
--   * cooler_spec.height_mm is NULL for 4 of the 5 liquid coolers. An AIO
--     block does have a height and it is the dimension that decides whether
--     the pump clears a side panel. NULL here means UNKNOWN, not zero, which
--     is why the deferred OG-10 rule correctly evaluates AIR coolers only.
--     Registered as a new gap rather than quietly filled.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- INSERT 1: component_assessment for CASE + CPU_COOLER (15 products x 3 = 45)
-- Column order: product name, type, score, rating, summary, rationale,
--               confidence, source_type, reference price (MAD, this DB)
-- ---------------------------------------------------------------------------
INSERT INTO component_assessment (product_id, assessment_type, score, rating,
    summary, rationale, confidence, source_type, assessed_at)
SELECT p.id, v.atype::assessment_type, v.score, v.rating, v.summary,
    v.rationale, v.conf::confidence_level, v.stype::source_type, NOW()
FROM (VALUES
    -- ================= CASE (QUALITY / THERMALS / VALUE) =================
    ('Seed MSI MAG PANO 100R PZ Blanc', 'THERMALS', 88, 'Great',
     'Three 360-capable positions (top, side, bottom), 175mm cooler, RAW 97.4',
     'Spec index 100*(0.45*min(1,720/720) + 0.25*min(1,175/180) + 0.20*min(1,390/430) + 0.10*min(1,4/4)) = 97.4 -> 25+0.65*97.4 = 88.4 -> 88. The only case in the catalog with a 360mm mount on all three of top, side and bottom, plus the joint-highest CPU-cooler clearance in the batch. Highest raw index of the eight',
     'HIGH', 'OFFICIAL', 1699),
    ('Seed MSI MAG PANO 100R PZ Blanc', 'QUALITY', 80, 'Good',
     '270-degree panoramic glass, Project Zero ready, 4 ARGB fans included',
     'Anchor: panoramic glass plus reverse-connector support = 80, the top of this file. MSI states ATX and Micro-ATX back-connect support on the PZ variant, four ARGB fans ship in the box, and it takes E-ATX. The 200mm PSU limit is the one spec that is genuinely below the class and belongs in the THERMALS row, where it is not hidden either',
     'HIGH', 'OFFICIAL', 1699),
    ('Seed MSI MAG PANO 100R PZ Blanc', 'VALUE', 55, 'Average',
     '1699 MAD = 0.057354 raw index points per MAD, worst in batch',
     'RAW 97.4/1699 = 0.057354 = batch worst -> 55. It is the best case in the catalog on THERMALS and the worst on VALUE, and both are true: this is the most capable chassis here and the second most expensive. 1619 MAD buys the MPG VELOX 100R WHITE, which is close on this index. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 1699),

    ('Seed MSI MPG VELOX 100R WHITE', 'THERMALS', 88, 'Great',
     'Front and top both 360-capable, side 240, 175mm cooler, RAW 97.0',
     'Spec index 100*(0.45*min(1,720/720) + 0.25*min(1,175/180) + 0.20*min(1,380/430) + 0.10*min(1,4/4)) = 97.0 -> 88.1 -> 88. Two 360mm mounts and a 175mm cooler clearance, the same raw index as the PANO to within 0.5. It trails only on GPU length (380mm) and on its side mount, which MSI caps at 240mm rather than 360mm',
     'HIGH', 'OFFICIAL', 1619),
    ('Seed MSI MPG VELOX 100R WHITE', 'QUALITY', 73, 'Good',
     'Four pre-installed ARGB fans, 250mm PSU clearance, vertical GPU mount',
     'Anchor: four pre-installed ARGB fans = 73. A well-built mainstream chassis with the best PSU clearance in the batch at 250mm, which is the one place it beats the more expensive PANO, and a steel side panel with a vertical GPU mount. Nothing premium about it and nothing wrong with it',
     'HIGH', 'OFFICIAL', 1619),
    ('Seed MSI MPG VELOX 100R WHITE', 'VALUE', 56, 'Average',
     '1619 MAD = 0.059901 raw index points per MAD',
     'RAW 97.0/1619 = 0.059901 -> 55+19*(0.059901-0.057354)/(0.100707-0.057354) = 56.1 -> 56. Second-worst ratio in the batch. The price-integrity check passed: the PANO at 1699 has a genuinely better radiator layout for 80 MAD more, so the order is defensible even though both are expensive. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 1619),

    ('Seed Corsair 3500X Black', 'THERMALS', 87, 'Great',
     'Dual 360mm mounts (top + side), 170mm cooler, 425mm GPU per Corsair',
     'Spec index 100*(0.45*min(1,720/720) + 0.25*min(1,170/180) + 0.20*min(1,410/430) + 0.10*min(1,3/4)) = 95.2 -> 25+0.65*95.2 = 86.9 -> 87. Corsair states dual 360mm radiator support explicitly, which is what TOP2 = 720 encodes. The 0.10 position term costs it 0.5 RAW against the four-position cases because there are three, not four, mounts. This seed also writes its 7-row radiator matrix',
     'HIGH', 'OFFICIAL', 949),
    ('Seed Corsair 3500X Black', 'QUALITY', 74, 'Good',
     'Dual removable tempered glass, E-ATX, 45mm cable space, no fans included',
     'Anchor: mainstream dual-glass = 74. A two-year warranty, wraparound removable glass on both panels, E-ATX to 305x277mm and 45mm behind the motherboard for cable routing, plus reverse-connector motherboard support. No fans ship with it, which is the one thing a buyer should know before comparing it to the MSI cases that include four',
     'HIGH', 'OFFICIAL', 949),
    ('Seed Corsair 3500X Black', 'VALUE', 74, 'Good',
     '949 MAD = 0.100296 raw index points per MAD, joint best in batch',
     'RAW 95.2/949 = 0.100296 -> 74. It ties the FORGE 320R on the batch-best VALUE while scoring 6 THERMALS points above it, which is the strongest value-per-capability claim in the file: dual 360mm mounting and E-ATX at the price of a budget mesh case. This is the Corsair MSRP of about $100 landing at roughly the right local price, and no catalog sibling contradicts it. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 949),

    ('Seed Corsair 3500X White', 'THERMALS', 87, 'Great',
     'Dual 360mm mounts (top + side), 170mm cooler; identical chassis to the Black',
     'Spec index 95.2 -> 86.9 -> 87, the same raw index as the Black to the decimal. This is a colour variant of one chassis, so a different score here would be a fabricated difference; the radiator matrix written by this seed is identical too, 7 rows each. See the Black row rationale for the index terms',
     'HIGH', 'OFFICIAL', 949),
    ('Seed Corsair 3500X White', 'QUALITY', 74, 'Good',
     'Dual removable tempered glass, E-ATX, no fans included; identical to the Black',
     'Anchor mainstream dual-glass = 74, unchanged from the Black because nothing about the build differs. Only the colour and the 7-row radiator matrix (identical) and the offer row differ. Scoring a white chassis higher than a black one would be exactly the kind of invented difference this batch exists to remove',
     'HIGH', 'OFFICIAL', 949),
    ('Seed Corsair 3500X White', 'VALUE', 74, 'Good',
     '949 MAD = 0.100296 raw index points per MAD, joint best in batch',
     'RAW 95.2/949 = 0.100296 = 0.100296 exactly, identical to the Black because both are 949 MAD for the same chassis. The Black is 899 MAD in this catalog, so the White carries a 50 MAD colour premium and this VALUE row is the honest place for it to show up. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 949),

    ('Seed Corsair iCUE LINK 3500X ARGB White', 'THERMALS', 87, 'Great',
     'Dual 360mm mounts (top + side), 170mm cooler, 425mm GPU',
     'Spec index 95.2 -> 86.9 -> 87, identical to the plain 3500X on every term. The iCUE LINK 3500X is the same chassis with the lighting and hub ecosystem swapped in, not a thermally different case, and scoring it higher on THERMALS would invent a difference. This seed also writes its 7-row radiator matrix',
     'HIGH', 'OFFICIAL', 1599),
    ('Seed Corsair iCUE LINK 3500X ARGB White', 'QUALITY', 78, 'Good',
     'iCUE LINK ecosystem: system hub, preinstalled ARGB, Link cable chain',
     'Anchor: iCUE LINK ecosystem = 78. The quality difference over the plain 3500X is real and specific: a preinstalled iCUE LINK system hub, ARGB fans wired into the Link chain so lighting needs one cable, and 10 fan positions. That is a genuine convenience feature set, which is why it earns +4 on QUALITY and exactly 0 on THERMALS',
     'HIGH', 'OFFICIAL', 1599),
    ('Seed Corsair iCUE LINK 3500X ARGB White', 'VALUE', 56, 'Average',
     '1599 MAD = 0.059525 raw index points per MAD',
     'RAW 95.2/1599 = 0.059525 -> 56.0 -> 56, the second-worst ratio in the batch, and the 74 on its sibling 3500X White is the comparison that matters: 650 MAD more for the same thermal envelope. The price-integrity gate checked this pair and let it through, because Corsair charges roughly the same premium in the real market (about $155 vs about $100) for the LINK hub, so the 68% premium is an ecosystem tax rather than a broken price. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 1599),

    ('Seed CORSAIR Frame 4000D RS ARGB Black', 'THERMALS', 81, 'Good',
     '360mm front + 240mm top, the longest GPU clearance in the batch, RAW 86.1',
     'Spec index 100*(0.45*min(1,600/720) + 0.25*min(1,170/180) + 0.20*min(1,430/430) + 0.10*min(1,2/4)) = 86.1 -> 25+0.65*86.1 = 81.0 -> 81. It scores BELOW the cheaper 3500X despite the best GPU clearance in the catalog (430mm) because it has the fewest radiator positions of the eight: two, against the 3500X three and the PANO and VELOX four, and its best pair is 360+240 rather than 360+360. That trade is the honest reading of the index, and it is why the cheapest 3500X outscores it',
     'HIGH', 'OFFICIAL', 899),
    ('Seed CORSAIR Frame 4000D RS ARGB Black', 'QUALITY', 76, 'Good',
     'Premium mesh front with tempered-glass side, 3 ARGB fans included',
     'Anchor: premium dual-glass = 76. The best chassis construction in the catalog alongside the MSI PANO - steel frame, a fine-mesh front for airflow rather than tempered glass across the whole front, glass on one side only so the airflow path stays open, and three ARGB fans in the box against the Corsair 3500Xs zero. The open mesh front is exactly why its radiator count is low and it is a deliberate design, not a shortfall',
     'MEDIUM', 'OFFICIAL', 899),
    ('Seed CORSAIR Frame 4000D RS ARGB Black', 'VALUE', 72, 'Good',
     '899 MAD = 0.095785 raw index points per MAD',
     'RAW 86.1/899 = 0.095785 -> 71.8 -> 72. Third in the batch on ratio, and the best of the three cases that take a 360mm radiator. The 899 MAD against a 430mm GPU limit is the reason it beats its own White sibling. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 899),

    ('Seed CORSAIR Frame 4000D RS ARGB White', 'THERMALS', 81, 'Good',
     '360mm front + 240mm top, 430mm GPU; identical chassis to the Black',
     'Spec index 86.1 -> 81.0 -> 81, identical to the Black to the decimal. Its radiator matrix already existed before this seed (240mm TOP, 360mm FRONT), which is why this case is not among the six this file had to write; TOP2 = 600 and NPOS = 2 come straight from those two pre-existing rows',
     'HIGH', 'OFFICIAL', 949),
    ('Seed CORSAIR Frame 4000D RS ARGB White', 'QUALITY', 76, 'Good',
     'Premium mesh front with tempered-glass side, 3 ARGB fans; same as the Black',
     'Anchor premium dual-glass = 76, unchanged from the Black. Nothing about the build differs, so nothing about the quality differs; the 50 MAD colour premium shows up in the VALUE row and only there',
     'MEDIUM', 'OFFICIAL', 949),
    ('Seed CORSAIR Frame 4000D RS ARGB White', 'VALUE', 70, 'Good',
     '949 MAD = 0.090739 raw index points per MAD',
     'RAW 86.1/949 = 0.090739 -> 69.6 -> 70, exactly 2 points below the Black on the same chassis, which is the arithmetic of the 50 MAD difference at this ratio and nothing more. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 949),

    ('Seed MSI MAG FORGE 320R AIRFLOW White', 'THERMALS', 81, 'Good',
     '240mm front limit, 360mm top, 160mm cooler per MSI, RAW 85.5',
     'Spec index 100*(0.45*min(1,600/720) + 0.25*min(1,161/180) + 0.20*min(1,390/430) + 0.10*min(1,3/4)) = 85.5 -> 80.6 -> 81. The most radiator-limited of the eight: the front mount stops at 240mm, so a 360mm AIO can only go in the top. Two other limits are worth stating because MSI publishes them and the database does not carry them exactly: MSI says 160mm CPU-cooler clearance where case_spec holds 161, and 200mm of PSU length without the drive tray where case_spec holds 210. The index uses the database values so it stays reproducible from the catalog',
     'MEDIUM', 'OFFICIAL', 849),
    ('Seed MSI MAG FORGE 320R AIRFLOW White', 'QUALITY', 70, 'Good',
     'Budget mesh-front class: 4 ARGB fans in, no glass, thin steel',
     'Anchor budget mesh-front = 70, and this is the direct calibration point: seed 001 scored the Fractal Pop XL, the other budget mesh-front ATX case in this catalog, at exactly 70. The class earns 70 because it does the important things cheaply - four ARGB fans included, 390mm of GPU room, 360mm top radiator - and gives up tempered glass, a tool-less design and the 45mm of cable space the Corsairs have',
     'MEDIUM', 'OFFICIAL', 849),
    ('Seed MSI MAG FORGE 320R AIRFLOW White', 'VALUE', 74, 'Good',
     '849 MAD = 0.100707 raw index points per MAD, best in batch',
     'RAW 85.5/849 = 0.100707 = batch best -> 74, and it is only 0.4 index points per MAD ahead of the 3500X, which outscores it by 6 THERMALS points. So the honest summary is that the FORGE 320R is the cheapest way into this class and the 3500X is the better buy for 100 MAD more. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 849),
    -- ================= CPU_COOLER (THERMALS / QUALITY / VALUE) =================
    ('Seed DeepCool MYSTIQUE 360 Black AIO', 'THERMALS', 88, 'Great',
     '360mm radiator, 300W rating, saturates the index at RAW 100.0',
     'Spec index 100*(0.55*min(1,300/300) + 0.45*min(1,360/360)) = 100.0 -> 67.9333+0.20*100 = 87.9 -> 88. Radiator class from the DeepCool product page and the aphnetworks review, not inferred from length_mm. It ties the A13 360 on the raw index exactly because the two are identical on both inputs - 300W and a 360mm radiator - and the difference between them is entirely in the QUALITY row, where it belongs',
     'HIGH', 'OFFICIAL', 1699),
    ('Seed DeepCool MYSTIQUE 360 Black AIO', 'QUALITY', 80, 'Good',
     'LCD pump, 3-phase 6-slot motor, 3400 RPM, 21 dBA pump, anti-leak',
     'The best-documented cooler in this batch and the only one with a display. A 3-phase 6-slot motor at 3400 RPM +/-10% with a 21 dBA pump rating, a documented anti-leak design, and LGA1851/LGA1700/AM5/AM4 mounting. KitGuru measured it as within a few degrees of the best Intel coolers once noise is normalised to 40 dBA, which is the real reason this is 80 and not higher: the LCD is a cost and a failure mode as well as a feature',
     'HIGH', 'OFFICIAL', 1699),
    ('Seed DeepCool MYSTIQUE 360 Black AIO', 'VALUE', 56, 'Average',
     '1699 MAD = 0.058858 raw index points per MAD',
     'RAW 100.0/1699 = 0.058858 -> 56.0 -> 56. The joint most expensive cooler in the batch for the joint highest THERMALS. The MSI A13 360 WHITE is the same thermal envelope for 400 MAD less and its 69 sits right next to it; that gap is the LCD, and this row is where a buyer can see it. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 1699),

    ('Seed MSI MAG CoreLiquid A13 360 White AIO', 'THERMALS', 88, 'Great',
     '360mm radiator, 300W rating, RAW 100.0',
     'Spec index 100*(0.55*min(1,300/300) + 0.45*min(1,360/360)) = 100.0 -> 87.9 -> 88. Identical raw index to the MYSTIQUE 360 by construction, since the two share both inputs. MSI states 394 x 119.6 x 27.2mm for the radiator and 12 widened water channels for 25% more flow at the same 27mm thickness, so the thermal design is current rather than inherited',
     'HIGH', 'OFFICIAL', 1299),
    ('Seed MSI MAG CoreLiquid A13 360 White AIO', 'QUALITY', 76, 'Good',
     '3800 RPM pump on ceramic bearings, 12-channel cold plate, EZ Connect',
     'A current-generation MSI AIO with the details that matter: a pump on ceramic bearings at up to 3800 RPM, a 70.9mm block, and the EZ Connect fitting that removes the fiddly CPU-side cable routing. It is 4 points behind the MYSTIQUE 360 for exactly one reason - it has no display - and that is the whole difference between the two best coolers here',
     'HIGH', 'OFFICIAL', 1299),
    ('Seed MSI MAG CoreLiquid A13 360 White AIO', 'VALUE', 69, 'Average',
     '1299 MAD = 0.076982 raw index points per MAD',
     'RAW 100.0/1299 = 0.076982 -> 69.5 -> 69, the second-best cooler ratio in the batch and by far the best of the 360mm class. 400 MAD below the MYSTIQUE 360 for the same THERMALS, which makes this the value pick of the two flagship AIOs. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 1299),

    ('Seed Cooler Master MasterLiquid ML280 Mirror', 'THERMALS', 85, 'Great',
     '280mm radiator, 280W database rating, RAW 86.3',
     'Spec index 100*(0.55*min(1,280/300) + 0.45*min(1,280/360)) = 86.3 -> 67.9333+0.20*86.3 = 85.2 -> 85. RADIATOR-SIZE HAZARD, and it is the reason this cooler is 85 rather than 88: 280mm is a Cooler Master-proprietary class that no other brand sells, and only 4 of the 8 cases in this catalog accept a 280mm mount at all - the two Corsair 3500Xs, the iCUE LINK 3500X and the MAG FORGE 320R top mount. The MSI PANO 100R and MPG VELOX 100R WHITE do not list 280mm anywhere, so this cooler cannot go in two of the catalog best cases. The case_radiator_support matrices this seed writes are what make that checkable',
     'MEDIUM', 'OFFICIAL', 1499),
    ('Seed Cooler Master MasterLiquid ML280 Mirror', 'QUALITY', 74, 'Good',
     'Two 140mm ARGB SickleFlow fans, <10 dBA pump, but a 3-PIN pump connector',
     'A 2020 design that is still well made: two 140mm ARGB SickleFlow fans, a mirrored pump face, a pump rated under 10 dBA with a 70,000-hour MTTF. The named fault is the connector: lanoc and modders-inc both record a 3-PIN pump power connector, so the pump runs at full speed with no PWM control and no BIOS tuning, which is a real usability cost on a 1499 MAD part. Age, not build, is the reason this is 74 and not 78',
     'MEDIUM', 'OFFICIAL', 1499),
    ('Seed Cooler Master MasterLiquid ML280 Mirror', 'VALUE', 55, 'Average',
     '1499 MAD = 0.057594 raw index points per MAD, worst in batch',
     'RAW 86.3/1499 = 0.057594 = batch worst -> 55. The most expensive cooler in the batch for the third-best thermal envelope, and the only one here whose radiator class restricts where it can be installed at all. A 1499 MAD 280mm AIO in a catalog whose best cases take 360mm is a hard sell on the evidence, and this row is the evidence. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 1499),

    ('Seed Corsair Nautilus 240 RS ARGB Black AIO', 'THERMALS', 83, 'Good',
     '240mm radiator, 260W rating, 13.3-72.8 CFM, RAW 77.7',
     'Spec index 100*(0.55*min(1,260/300) + 0.45*min(1,240/360)) = 77.7 -> 67.9333+0.20*77.7 = 83.5 -> 83. Corsair publishes no TDP figure for any AIO, so cooler_spec.max_tdp_watts = 260 is a database estimate, not a vendor number, and the 240mm radiator size is from the Corsair product page (276 x 120 x 27mm). A 240mm class part is 5 points behind the 360mm group on this rubric, which matches the consensus that a 360 pushes a 250W part further under sustained all-core load',
     'MEDIUM', 'OFFICIAL', 1099),
    ('Seed Corsair Nautilus 240 RS ARGB Black AIO', 'QUALITY', 78, 'Good',
     'Convex cold plate with pre-applied paste, 0-2100 RPM, 5-year warranty',
     'The best-quality-per-mad cooler in the batch. A convex cold plate with the thermal paste already applied, a 0-2100 RPM +/-10% fan range, 13.3-72.8 CFM of airflow, 10-36 dBA, and a 5-year warranty - the same warranty as the parts costing 400 MAD more, with no LCD to fail and no proprietary pump connector. Nothing to flag',
     'HIGH', 'OFFICIAL', 1099),
    ('Seed Corsair Nautilus 240 RS ARGB Black AIO', 'VALUE', 65, 'Average',
     '1099 MAD = 0.070670 raw index points per MAD',
     'RAW 77.7/1099 = 0.070670 -> 65.0 -> 65. The ratio says 240mm-class, the QUALITY row says best-in-batch build, and both are true. Against the CORELIQUID 240R, which is the same radiator class for 300 MAD less, this row is the clearest single argument in the file for paying a premium for a part that is built to last. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 1099),

    ('Seed MSI MAG COREFROZR AA13 BLACK', 'THERMALS', 76, 'Good',
     'AIR, 220W database rating, no radiator term, RAW 40.3',
     'Spec index 100*(0.55*min(1,220/300) + 0.45*0) = 40.3 -> 67.9333+0.20*40.3 = 76.0 -> 76, which REPRODUCES seed 001 DeepCool AG400 exactly, because both are 220W air coolers. Two things must be said plainly rather than hidden. First, MSI publishes 240W for this cooler, not the 220W in cooler_spec; the index uses the database figure so the rubric stays reproducible from the catalog, and 240W would add 3.7 RAW points. Second, the zero radiator term is structural, not a verdict on the part - see the header, where the deliberate class asymmetry is documented',
     'HIGH', 'OFFICIAL', 699),
    ('Seed MSI MAG COREFROZR AA13 BLACK', 'QUALITY', 70, 'Good',
     'MSI first air cooler in 10 years: 4 heat pipes, 152mm, 30.11 dBA',
     'A well-executed budget tower and a credible answer at this price: four 6mm copper heat pipes, a single 120mm CycloBlade fan rated 30.11 dBA peaking at 34.1 dBA, and 152mm of height, which clears every case in this catalog including the 160mm MAG FORGE 320R. MSI has not made an air cooler in a decade, which is a mark against the brand track record here rather than against the part',
     'HIGH', 'OFFICIAL', 699),
    ('Seed MSI MAG COREFROZR AA13 BLACK', 'VALUE', 55, 'Average',
     '699 MAD = 0.057701 raw index points per MAD',
     'RAW 40.3/699 = 0.057701 -> 55.0 -> 55. The lowest ratio in the batch, and this is the clearest case in the file of the index-per-MAD artifact: a 699 MAD air cooler prices out below a 240mm AIO at 799 MAD because the radiator term is zero by construction, not because the air cooler is worse value. Read this as 699 MAD for a rated 220W, which is a fair price, and not as a ranking. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 699),

    ('Seed MSI MAG COREFROZR AA13 WHITE', 'THERMALS', 76, 'Good',
     'AIR, 220W database rating, no radiator term; identical to the Black',
     'Spec index 40.3 -> 76.0 -> 76, identical to the Black to the decimal, because it is the same cooler in a different colour and both are 699 MAD. A different score here would be an invented difference',
     'HIGH', 'OFFICIAL', 699),
    ('Seed MSI MAG COREFROZR AA13 WHITE', 'QUALITY', 70, 'Good',
     '4 heat pipes, 152mm, 30.11 dBA; identical build to the Black',
     'Anchor unchanged at 70 for the reason given on the Black row. The WHITE variant shares the 4-heatpipe 152mm 30.11 dBA specification exactly, so the only difference between these two products anywhere in this file is the colour word in the name and their two offer rows',
     'HIGH', 'OFFICIAL', 699),
    ('Seed MSI MAG COREFROZR AA13 WHITE', 'VALUE', 55, 'Average',
     '699 MAD = 0.057701 raw index points per MAD',
     'RAW 40.3/699 = 0.057701 = 0.057701 exactly, identical to the Black because the two are listed at the same 699 MAD. Unlike the Corsair colour pairs, MSI did not attach a colour premium to this one, and the identical VALUE rows are the check that the two really are the same listing at the same money. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 699),

    ('Seed MSI MAG CORELIQUID 240R', 'THERMALS', 81, 'Good',
     '240mm radiator, 200W rating, the lowest in the batch, RAW 66.7',
     'Spec index 100*(0.55*min(1,200/300) + 0.45*min(1,240/360)) = 66.7 -> 67.9333+0.20*66.7 = 81.3 -> 81. The lowest rated TDP of the seven coolers, 200W, so the TDP term alone drags it 6 points below the Nautilus 240 in the same radiator class. MSI states the radiator as 274 x 120 x 27mm with 2 fans. Note this is the ORIGINAL 240R, not the V2, which is what the QUALITY row is about',
     'MEDIUM', 'OFFICIAL', 799),
    ('Seed MSI MAG CORELIQUID 240R', 'QUALITY', 64, 'Average',
     'The original 240R, not the V2: documented pump cycling and gurgling',
     'The only row in this file below 70, and it is a documented product fault rather than a preference. MSI now ships a MAG CORELIQUID 240R V2 whose own product page leads with a lower noise level than the competition, which is the vendor conceding the original had a noise problem; MSI support forum thread 367296 is a long report of the pump making bubble and pop noises as it cycles with temperature. A rotating-cap design, 2 fans and 14.3-34.3 dBA are otherwise ordinary parts. Own the fault, price the part',
     'MEDIUM', 'OFFICIAL', 799),
    ('Seed MSI MAG CORELIQUID 240R', 'VALUE', 74, 'Good',
     '799 MAD = 0.083438 raw index points per MAD, best in batch',
     'RAW 66.7/799 = 0.083438 = batch best -> 74. READ THIS ROW AS CHEAPEST PER INDEX POINT, NOT AS BEST: this is the lowest-THERMALS cooler in the file and its only 64 (Average) on QUALITY, and the two facts come from the same purchase. The MSI A13 360 WHITE is 3 THERMALS points better and scores 5 points lower on VALUE at 1299 MAD. The index-per-MAD artifact is recorded in the header, not smoothed away here. Confidence LOW (OG-06)',
     'LOW', 'RETAILER', 799)
) AS v(pname, atype, score, rating, summary, rationale, conf, stype, ref_price)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (
    SELECT 1 FROM component_assessment a
    WHERE a.product_id = p.id AND a.assessment_type = v.atype::assessment_type
);

-- ---------------------------------------------------------------------------
-- INSERT 2: case_radiator_support for the 6 cases that had zero rows (OG-05)
--
-- Read from each vendor's own published radiator-layout table, 2026-10-02:
--   Corsair 3500X (CC-9011276-WW) and iCUE LINK 3500X (CC-9011281-WW)
--     Top 360/280/240, Side 360/280/240, Rear 120; Front and Bottom NONE.
--     The plain 3500X is a two-glass case whose second mount is on the SIDE,
--     not the front - Corsair lists Radiator Support - Front: None
--     explicitly - so FRONT is deliberately absent here.
--   MSI MAG FORGE 320R AIRFLOW   Front 120/140/240, Top 120/240/280/360, Rear 120
--   MSI MAG PANO 100R PZ / WHITE  Top 120/240/360, Rear 120, Side 120/240/360,
--                                Bottom 120/240/360; Front NA
--   MSI MPG VELOX 100R WHITE      Front 120/140/240/280/360,
--                                Top 120/140/240/280/360, Rear 120, Side 120/240
-- position is a free-text column; TOP/FRONT/SIDE/BOTTOM/REAR are the values
-- the vendor tables themselves use. Idempotent on the full triple, so a
-- second run inserts zero rows and a pre-existing row is never duplicated.
-- ---------------------------------------------------------------------------
INSERT INTO case_radiator_support (case_product_id, radiator_size_mm, position)
SELECT p.id, v.rsize, v.rpos
FROM (VALUES
    -- ================= OG-05: radiator matrices, 6 cases x rows below =====
    -- Corsair 3500X Black (CC-9011276-WW): Top 360/280/240, Side 360/280/240,
    -- Rear 120. Corsair lists "Radiator Support - Front: None" and
    -- "Radiator Support - Bottom: None" explicitly, so neither appears here.
    ('Seed Corsair 3500X Black', 240, 'TOP'),
    ('Seed Corsair 3500X Black', 280, 'TOP'),
    ('Seed Corsair 3500X Black', 360, 'TOP'),
    ('Seed Corsair 3500X Black', 240, 'SIDE'),
    ('Seed Corsair 3500X Black', 280, 'SIDE'),
    ('Seed Corsair 3500X Black', 360, 'SIDE'),
    ('Seed Corsair 3500X Black', 120, 'REAR'),

    -- Corsair 3500X White: the same chassis in white, so the same 7 rows.
    ('Seed Corsair 3500X White', 240, 'TOP'),
    ('Seed Corsair 3500X White', 280, 'TOP'),
    ('Seed Corsair 3500X White', 360, 'TOP'),
    ('Seed Corsair 3500X White', 240, 'SIDE'),
    ('Seed Corsair 3500X White', 280, 'SIDE'),
    ('Seed Corsair 3500X White', 360, 'SIDE'),
    ('Seed Corsair 3500X White', 120, 'REAR'),

    -- Corsair iCUE LINK 3500X RGB White (CC-9011281-WW): identical chassis and
    -- identical radiator layout to the plain 3500X; the LINK ecosystem changes
    -- the lighting and the hub, not where a radiator fits.
    ('Seed Corsair iCUE LINK 3500X ARGB White', 240, 'TOP'),
    ('Seed Corsair iCUE LINK 3500X ARGB White', 280, 'TOP'),
    ('Seed Corsair iCUE LINK 3500X ARGB White', 360, 'TOP'),
    ('Seed Corsair iCUE LINK 3500X ARGB White', 240, 'SIDE'),
    ('Seed Corsair iCUE LINK 3500X ARGB White', 280, 'SIDE'),
    ('Seed Corsair iCUE LINK 3500X ARGB White', 360, 'SIDE'),
    ('Seed Corsair iCUE LINK 3500X ARGB White', 120, 'REAR'),

    -- MSI MAG FORGE 320R AIRFLOW White: Front 120/140/240, Top 120/240/280/360,
    -- Rear 120. The 240mm front ceiling is why this case has the lowest TOP2 in
    -- the batch and why it cannot take a 360mm AIO in the front at all.
    ('Seed MSI MAG FORGE 320R AIRFLOW White', 120, 'FRONT'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White', 140, 'FRONT'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White', 240, 'FRONT'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White', 120, 'TOP'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White', 240, 'TOP'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White', 280, 'TOP'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White', 360, 'TOP'),
    ('Seed MSI MAG FORGE 320R AIRFLOW White', 120, 'REAR'),

    -- MSI MAG PANO 100R PZ / WHITE: Top 120/240/360, Rear 120,
    -- Side 120/240/360, Bottom 120/240/360; Front NA. Three 360-capable
    -- positions, the only case in the catalog with that, which is the whole
    -- reason it tops the CASE THERMALS index at RAW 97.4.
    ('Seed MSI MAG PANO 100R PZ Blanc', 120, 'TOP'),
    ('Seed MSI MAG PANO 100R PZ Blanc', 240, 'TOP'),
    ('Seed MSI MAG PANO 100R PZ Blanc', 360, 'TOP'),
    ('Seed MSI MAG PANO 100R PZ Blanc', 120, 'REAR'),
    ('Seed MSI MAG PANO 100R PZ Blanc', 120, 'SIDE'),
    ('Seed MSI MAG PANO 100R PZ Blanc', 240, 'SIDE'),
    ('Seed MSI MAG PANO 100R PZ Blanc', 360, 'SIDE'),
    ('Seed MSI MAG PANO 100R PZ Blanc', 120, 'BOTTOM'),
    ('Seed MSI MAG PANO 100R PZ Blanc', 240, 'BOTTOM'),
    ('Seed MSI MAG PANO 100R PZ Blanc', 360, 'BOTTOM'),

    -- MSI MPG VELOX 100R WHITE: Front 120/140/240/280/360,
    -- Top 120/140/240/280/360, Rear 120, Side 120/240. Four positions, but the
    -- side mount stops at 240mm, so only two of them take a 360mm radiator.
    ('Seed MSI MPG VELOX 100R WHITE', 120, 'FRONT'),
    ('Seed MSI MPG VELOX 100R WHITE', 140, 'FRONT'),
    ('Seed MSI MPG VELOX 100R WHITE', 240, 'FRONT'),
    ('Seed MSI MPG VELOX 100R WHITE', 280, 'FRONT'),
    ('Seed MSI MPG VELOX 100R WHITE', 360, 'FRONT'),
    ('Seed MSI MPG VELOX 100R WHITE', 120, 'TOP'),
    ('Seed MSI MPG VELOX 100R WHITE', 140, 'TOP'),
    ('Seed MSI MPG VELOX 100R WHITE', 240, 'TOP'),
    ('Seed MSI MPG VELOX 100R WHITE', 280, 'TOP'),
    ('Seed MSI MPG VELOX 100R WHITE', 360, 'TOP'),
    ('Seed MSI MPG VELOX 100R WHITE', 120, 'REAR'),
    ('Seed MSI MPG VELOX 100R WHITE', 120, 'SIDE'),
    ('Seed MSI MPG VELOX 100R WHITE', 240, 'SIDE')
) AS v(pname, rsize, rpos)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (
    SELECT 1 FROM case_radiator_support r
    WHERE r.case_product_id = p.id
      AND r.radiator_size_mm = v.rsize
      AND r.position = v.rpos
);

COMMIT;
