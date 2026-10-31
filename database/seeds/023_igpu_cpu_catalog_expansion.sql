-- ============================================================================
-- Seed 023: four integrated-GPU CPUs, so OFFICE's CPU pool can outgrow six
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- Decision 59 (seed 022) pins `launch-v2@2.4.0`, which raises the CPU candidate
-- depth to 10 and leaves the other seven roles at 5. Measured against that pin
-- on 2026-10-31, the three OFFICE passes retain 41 candidates instead of 40:
-- SEVEN roles x 5 = 35 plus SIX CPUs. The audit that followed explains the six:
-- under a declared `IGPU_ALLOWED` policy `retention/igpu-pool.js` keeps only
-- CPUs whose `cpu_spec.integrated_gpu_present` is TRUE, and the catalogue held
-- exactly six such parts (Ryzen 5 3400G, Ryzen 5 PRO 5655G, Ryzen 7 5700G,
-- Ryzen 7 7700X, Ryzen 7 7800X3D, Ryzen 5 8600G) out of 18 CPUs. Every flag was
-- verified, not missing - so OFFICE was capped by CATALOGUE COMPOSITION, and a
-- CPU depth of 10 could never be exercised there.
--
-- This seed adds four more iGPU parts across all three sockets the catalogue
-- supports (AM4, AM5, LGA1700), so the OFFICE CPU pool can reach ten and the
-- pair-diversity question becomes measurable instead of structural.
--
-- SOURCES (read 2026-10-31; every figure traceable, none interpolated)
--
--   Cinebench 2024 MULTI-CORE, the anchor chain 004b froze:
--     Ryzen 5 5600G   589  https://www.cpu-monkey.com/en/cpu-amd_ryzen_5_5600g
--     Ryzen 5 8500G   742  https://www.cpu-monkey.com/en/cpu-amd_ryzen_5_8500g
--     Ryzen 7 8700G   986  https://www.cpu-monkey.com/en/cpu-amd_ryzen_7_8700g
--     Core i5-14400   862  https://nanoreview.net/en/cpu/intel-core-i5-14400
--   AGGREGATE CAVEAT, recorded rather than hidden: both sites publish an average
--   of submitted runs, not a single reviewer measurement. nanoreview's 8500G
--   sample is thin (two runs, 655/557) which is why cpu-monkey's 742 is used;
--   the i5-14400's CB2024 figure exists on only one of the two sites; 5600G
--   disagrees 589 (cpu-monkey) vs 642 (nanoreview) and the lower one is used
--   because 642 sits at the top of nanoreview's own 562-646 sample spread.
--   Geekbench 6 MT cross-check (cpu-monkey, all four): 7966 / 11063 / 14326 /
--   13682 - same ordering as the Cinebench chain, no contradiction.
--
-- RUBRIC (identical to 004b; recomputed here, not copied)
--
--   PERFORMANCE = 78 + 10*ln(CB/833)/ln(1464/833), rounded:
--     5600G 589 -> 72.0 -> 72 | 8500G 742 -> 76.0 -> 76
--     8700G 986 -> 81.0 -> 81 | i5-14400 862 -> 78.6 -> 79
--   The formula reproduces the incumbents exactly (5500 588 -> 72, 5600X 1599
--   MAD -> VALUE 62), which is the calibration check.
--
--   QUALITY - tier anchors from 004b (mainstream Zen 4 / Alder Lake 79-84,
--   budget/mainstream Zen 3 72-78, APU penalties for halved L3 and PCIe 3.0):
--     5600G  72  Cezanne APU: 16 MB L3, PCIe 3.0 - the 5700G's own anchor
--     8500G  74  hybrid 2 Zen 4 + 4 Zen 4c, 16 MB L3, 4-CU 740M
--     8700G  80  full 8C Zen 4 APU, 16 MB L3, 12-CU 780M; below the 7700X's
--               84 for the smaller L3 and x8 PCIe
--     i5-14400 79 6P+4E Raptor Lake refresh, 20 MB L3; above the 12400F's 76,
--               below the 12700KF's 82
--
--   VALUE - PERFORMANCE points per MAD on the linear map 004b fixed
--   (0.08009 -> 74, 0.02339 -> 55):
--     5600G    72/1399 = 0.05147 -> 64
--     8500G    76/1699 = 0.04473 -> 62
--     8700G    81/2999 = 0.02701 -> 56
--     i5-14400 79/1899 = 0.04160 -> 61
--   Confidence LOW on every VALUE row: these prices are seed-class and
--   UNVERIFIED, the same OG-37 debt 004b's computed rows carry.
--
-- PRICES - calibrated against the live ladder, never invented upward
--
--   5600G 1399 is below the 5600X's 1599: same 72 PERFORMANCE, less L3 and
--   PCIe 3.0, so the APU sits under the discrete part.
--   8500G 1699 is below the 8700F's 1749 (PERFORMANCE 80): the honest ordering.
--   8700G 2999 is ABOVE the 7700X's 2799 even though it is slower - a real
--   iGPU premium, not a typo, and the reason no "weaker part must be cheaper"
--   integrity rule is applied across different dies.
--   14400 1899 sits between the 12400F's 1549 (73) and the 12700KF's 2699 (86).
--
-- KNOWN DIVERGENCE, left untouched
--
--   The existing seed-001 `Seed Ryzen 5 8600G` carries PERFORMANCE 82, which the
--   formula puts at CB2024 ~1044 - above the 8700G's published 986. It is a
--   seed-001 fixture-era row (it also carries no QUALITY row), so it is NOT
--   edited here and the new scores are NOT bent to match it; the two figures
--   disagree and this comment is the record.
--
-- DELIBERATELY NOT ADDED
--
--   * No `cpu_motherboard_support` rows: a (board, CPU) pair with no row is the
--     documented UNKNOWN path, and writing PASS rows needs per-board vendor
--     evidence this batch did not gather. The measurement reports what UNKNOWN
--     does with these parts rather than pre-declaring support.
--   * No `price_history` rows (004b's own pattern) and no `product_variant`.
--   * No engine code, no scoring-model row, no migration.
--
-- SCOPE AND SAFETY
--
--   * DML only; catalog rows only.
--   * Idempotent: every insert is guarded by NOT EXISTS on its natural key, so
--     a second apply writes 0 rows.
--   * TEST-branch first, and applied there ALONE (2026-10-31). Like every file in this
--     folder it has NO branch awareness: `run-seeds.js` executes it against whatever
--     `DATABASE_URL` names (the seed-017 lesson - a replay once produced four ACTIVE
--     models that way). Pointing a seed run at shared or EU is therefore a DELIBERATE
--     catalogue decision that also settles the target-parity DIFF recorded below;
--     it is not something this file does on its own.
--   * `check-deferred-rules.js` is re-run after the apply (AGENTS 6), because a
--     CPU row participates in the cooler/RAM/motherboard rule scope.
-- ============================================================================

-- 1/5 Family: a 14th-gen Intel family does not exist yet.
INSERT INTO product_family (name, manufacturer_id)
SELECT v.name, m.id
FROM (VALUES ('Seed Intel Core 14th Gen')) AS v(name)
JOIN manufacturer m ON m.name = 'Intel'
WHERE NOT EXISTS (SELECT 1 FROM product_family pf WHERE pf.name = v.name);

-- 2/5 Products (4).
INSERT INTO product (product_family_id, manufacturer_id, name, lifecycle_status)
SELECT pf.id, m.id, v.name, 'ACTIVE'
FROM (VALUES
    ('Seed AMD Ryzen 5 5600G',  'Seed AMD Ryzen 5000G',       'AMD'),
    ('Seed AMD Ryzen 5 8500G',  'Seed AMD AM5 G-Series CPUs', 'AMD'),
    ('Seed AMD Ryzen 7 8700G',  'Seed AMD AM5 G-Series CPUs', 'AMD'),
    ('Seed Intel Core i5-14400','Seed Intel Core 14th Gen',   'Intel')
) AS v(name, family, mfr)
JOIN product_family pf ON pf.name = v.family
JOIN manufacturer m ON m.name = v.mfr
WHERE NOT EXISTS (SELECT 1 FROM product p WHERE p.name = v.name);

-- 3/5 CPU specs (4). Column list and ordering follow seed 002's cpu_spec insert, which
-- fixes `memory_channels` at 2 for EVERY CPU in the catalogue (dual channel is universal
-- on these four platforms). Section 3b converges the rows the first apply of this file
-- wrote with NULL.
INSERT INTO cpu_spec (product_id, socket_id, cores, threads, base_clock_mhz,
    boost_clock_mhz, tdp_watts, pbp_mtp_watts, memory_channels,
    max_official_memory_speed_mtps, pcie_generation, integrated_gpu_present,
    integrated_gpu_model)
SELECT p.id, s.id, v.cores, v.threads, v.base, v.boost, v.tdp, NULL, 2, v.mem,
    v.pcie, true, v.igpu
FROM (VALUES
    ('Seed AMD Ryzen 5 5600G',   'AM4',       6, 12, 3900, 4400,  65, 3200, 3, 'Radeon Vega 7'),
    ('Seed AMD Ryzen 5 8500G',   'AM5',       6, 12, 3500, 5000,  65, 5200, 4, 'Radeon 740M'),
    ('Seed AMD Ryzen 7 8700G',   'AM5',       8, 16, 4200, 5100,  65, 5200, 4, 'Radeon 780M'),
    ('Seed Intel Core i5-14400', 'LGA1700',  10, 16, 2500, 4700,  65, 4800, 5, 'Intel UHD Graphics 730')
) AS v(name, socket, cores, threads, base, boost, tdp, mem, pcie, igpu)
JOIN product p ON p.name = v.name
JOIN socket s ON s.name = v.socket
WHERE NOT EXISTS (SELECT 1 FROM cpu_spec cs WHERE cs.product_id = p.id);

-- 3b/5 Convergence: the FIRST apply of this file wrote these four rows with
-- `memory_channels` NULL, where every other cpu_spec row carries 2. Guarded on IS NULL,
-- so a fresh apply (correct above) and a repeat apply both write nothing.
UPDATE cpu_spec cs
   SET memory_channels = 2
  FROM product p
 WHERE p.id = cs.product_id
   AND p.name IN ('Seed AMD Ryzen 5 5600G', 'Seed AMD Ryzen 5 8500G',
                  'Seed AMD Ryzen 7 8700G', 'Seed Intel Core i5-14400')
   AND cs.memory_channels IS NULL;

-- 4/5 Offers (4). Seed stores only, the 002/004b pattern: seller_name and
-- product_url stay NULL (D8), so these are SEED-class offers and the
-- provenance gate counts them without certifying them.
INSERT INTO store_offer (store_id, product_id, product_variant_id, price,
    currency, availability, seller_name, product_url, last_checked_at)
SELECT st.id, p.id, NULL, v.price, 'MAD', 'IN_STOCK', NULL, NULL, NOW()
FROM (VALUES
    ('Seed AMD Ryzen 5 5600G',   'Seed UltraPC',    1399),
    ('Seed AMD Ryzen 5 8500G',   'Seed NextGamer',  1699),
    ('Seed AMD Ryzen 7 8700G',   'Seed UltraPC',    2999),
    ('Seed Intel Core i5-14400', 'Seed NextGamer',  1899)
) AS v(pname, sname, price)
JOIN product p ON p.name = v.pname
JOIN store st ON st.name = v.sname
WHERE NOT EXISTS (
    SELECT 1 FROM store_offer o
    WHERE o.store_id = st.id AND o.product_id = p.id
      AND o.product_variant_id IS NULL AND o.price = v.price AND o.currency = 'MAD'
);

-- 5/5 Assessments (4 x 3). Column order matches 004b: product name, type,
-- score, rating, summary, rationale, confidence, source_type.
INSERT INTO component_assessment (product_id, assessment_type, score, rating,
    summary, rationale, confidence, source_type, assessed_at)
SELECT p.id, v.atype::assessment_type, v.score, v.rating, v.summary,
    v.rationale, v.conf::confidence_level, v.stype::source_type, NOW()
FROM (VALUES
    ('Seed AMD Ryzen 5 5600G', 'PERFORMANCE', 72, 'Good',
     'Cezanne APU 6C/12T; CB2024 multi 589',
     'CB2024 multi 589 -> 78+10*ln(589/833)/ln(1464/833)=72.0 -> 72 (cpu-monkey aggregate; nanoreview reports 642, the top of its own 562-646 spread, so the lower figure is used). Geekbench 6 multi 7966 cross-check',
     'MEDIUM', 'COMMUNITY'),
    ('Seed AMD Ryzen 5 5600G', 'QUALITY', 72, 'Average',
     'Zen 3 Cezanne APU: 16 MB L3 and a PCIe 3.0 platform',
     'Anchor budget/mainstream Zen 3 72-78 with the APU penalty: 16 MB L3 (half the discrete part) and PCIe 3.0 only, which is the same anchor the 8C 5700G carries at 72',
     'MEDIUM', 'COMMUNITY'),
    ('Seed AMD Ryzen 5 5600G', 'VALUE', 64, 'Average',
     'Offer price 1399 MAD; 72 PERFORMANCE points per MAD 0.05147',
     'VALUE = 55 + (0.05147-0.02339)/(0.08009-0.02339)*19 = 64.4 -> 64, on 004b''s fixed map. LOW confidence: the 1399 MAD price is a seed-class figure (OG-37), not a verified retailer listing',
     'LOW', 'RETAILER'),

    ('Seed AMD Ryzen 5 8500G', 'PERFORMANCE', 76, 'Good',
     'Phoenix 2 hybrid 6C/12T (2 Zen 4 + 4 Zen 4c); CB2024 multi 742',
     'CB2024 multi 742 -> 78+10*ln(742/833)/ln(1464/833)=76.0 -> 76 (cpu-monkey aggregate; nanoreview has two samples only, 655/557, so it is not the anchor). Geekbench 6 multi 11063 cross-check',
     'MEDIUM', 'COMMUNITY'),
    ('Seed AMD Ryzen 5 8500G', 'QUALITY', 74, 'Average',
     'Zen 4 hybrid with a 4-CU 740M; 16 MB L3',
     'Anchor: below the full 8C Zen 4 parts and above budget Zen 3. Two full Zen 4 cores plus four Zen 4c cores, 16 MB L3, and the smallest iGPU of this batch (4 CU) are why it sits at 74 rather than the 8700G''s 80',
     'MEDIUM', 'COMMUNITY'),
    ('Seed AMD Ryzen 5 8500G', 'VALUE', 62, 'Average',
     'Offer price 1699 MAD; 76 PERFORMANCE points per MAD 0.04473',
     'VALUE = 55 + (0.04473-0.02339)/(0.08009-0.02339)*19 = 62.2 -> 62. LOW confidence: seed-class price (OG-37)',
     'LOW', 'RETAILER'),

    ('Seed AMD Ryzen 7 8700G', 'PERFORMANCE', 81, 'Good',
     'Phoenix APU 8C/16T with a 12-CU 780M; CB2024 multi 986',
     'CB2024 multi 986 -> 78+10*ln(986/833)/ln(1464/833)=81.0 -> 81 (cpu-monkey 986 and nanoreview 995 agree within 1%, the firmest pair in this batch; the lower is used). Geekbench 6 multi 14326 cross-check',
     'MEDIUM', 'COMMUNITY'),
    ('Seed AMD Ryzen 7 8700G', 'QUALITY', 80, 'Good',
     'Full 8C Zen 4 APU, 16 MB L3, 12-CU iGPU',
     'Anchor mainstream Zen 4 79-84, minus the APU deductions: 16 MB L3 against the 7700X''s 32 MB and x8 PCIe, so 80 and not 84. The strongest iGPU in the catalogue is a capability, not a tier, so it does not add points here',
     'MEDIUM', 'COMMUNITY'),
    ('Seed AMD Ryzen 7 8700G', 'VALUE', 56, 'Average',
     'Offer price 2999 MAD; 81 PERFORMANCE points per MAD 0.02701',
     'VALUE = 55 + (0.02701-0.02339)/(0.08009-0.02339)*19 = 56.2 -> 56. LOW confidence: seed-class price (OG-37). The 2999 MAD figure sits above the 7700X''s 2799 and is recorded as the real iGPU premium, not corrected away',
     'LOW', 'RETAILER'),

    ('Seed Intel Core i5-14400', 'PERFORMANCE', 79, 'Good',
     'Raptor Lake refresh 6P+4E (10C/16T); CB2024 multi 862',
     'CB2024 multi 862 -> 78+10*ln(862/833)/ln(1464/833)=78.6 -> 79 (nanoreview, the only source carrying a CB2024 figure for this SKU; cpu-monkey publishes none, so this row is single-source). Geekbench 6 multi 13682 cross-check',
     'MEDIUM', 'COMMUNITY'),
    ('Seed Intel Core i5-14400', 'QUALITY', 79, 'Good',
     '6P+4E Raptor Lake refresh, 20 MB L3',
     'Anchor Alder Lake 79-84 carried forward to the refresh: above the 6P-only 12400F''s 76 because of the four E-cores, below the 8P+4E 12700KF''s 82',
     'MEDIUM', 'COMMUNITY'),
    ('Seed Intel Core i5-14400', 'VALUE', 61, 'Average',
     'Offer price 1899 MAD; 79 PERFORMANCE points per MAD 0.04160',
     'VALUE = 55 + (0.04160-0.02339)/(0.08009-0.02339)*19 = 61.1 -> 61. LOW confidence: seed-class price (OG-37)',
     'LOW', 'RETAILER')
) AS v(pname, atype, score, rating, summary, rationale, conf, stype)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (
    SELECT 1 FROM component_assessment a
    WHERE a.product_id = p.id AND a.assessment_type = v.atype::assessment_type
);

-- MEASURED AFTER APPLY (TEST branch, 2026-10-31, engine at bdd7751; `launch-v2@2.4.0`)

-- The pool ceiling is gone: OFFICE retention goes from 41 candidates (7 roles x 5 + SIX
-- CPUs) to 45 (7 x 5 + TEN CPUs), so the Decision 59 depth of 10 is now exercised
-- instead of clipped. Per-pass, through the real repository + `runFullRun` path:

-- | pass | retained CPU | assembled builds | selected builds | distinct (CPU,GPU) pairs |
-- |---|---|---|---|---|
-- | S17 OFFICE 6000 | 6 -> 10 | 2 -> 4 | 1 -> 2 | 1 -> 2 |
-- | S18 OFFICE 8000 | 6 -> 10 | 4 -> 10 | 2 -> 3 | 2 -> 3 |
-- | S19 OFFICE 10000 | 6 -> 10 | 12 -> 20 | 3 -> 3 | 3 -> 3 |

-- A6 is now PASS on all three OFFICE rows (`selected_builds_with_gpu: 0`, rank-1 CPU
-- iGPU true), and A1 S19 still reads 3 pairs. At `launch-v2@2.2.0` (uniform 5) the same
-- catalogue reads S17 1 pair, S18 3, S19 3 - so DEPTH still buys S17 one pair, and
-- S18/S19 are at their pair-space ceiling either way.

-- TWO CONSEQUENCES, RECORDED NOT SMOOTHED

-- 1. `A10 | S18` is now a HARD FAIL. With three pair-distinct OFFICE builds available the
--    selector nominates `[BALANCED, VALUE, PERFORMANCE]`, while the 2026-10-31 approved
--    order for `launch-v2@2.4.0` is two entries `[BALANCED, VALUE]`. That expectation is
--    pin-scoped METADATA, so re-approving it is a reviewer act - this seed does not
--    satisfy itself by editing `test/golden/scenarios.json`, and the suite stays RED
--    (exit 1) until someone reviews the new order.

-- 2. `A1 | S06` moved BACK from PASS to EXPECTED-RED: 3 pairs -> 1. The mechanism is
--    visible in the trace, not inferred. Retention still keeps 10 CPUs, but the new parts
--    score high enough to take score-ranked slots (`8700G` 81, `14400` 79, `8500G` 76,
--    `5600G` 72) and displace the cheap AM4 parts (`5600X`, `5700X`, `5800X`, `12400F`)
--    that used to form S06's three pairs. Those new parts sit on AM5/LGA1700, whose
--    boards and DDR5 cost more than a 12000 MAD 1440p build can absorb, so only TWO CPUs
--    assemble at all - `Ryzen 5 5500` and the new `5600G`, both on the same 16 GB RX 9060
--    XT - and the selection returns a single build (A9 `selected_builds: 1`, A1 1 pair).
--    Retention is score-driven and blind to PLATFORM COST: the same blind spot OG-26
--    documented for budget, one layer down. That is an engine question, not a data one,
--    and it is why the iGPU parts were added as a measurement rather than as an improvement.

-- FULL SUITE at `--model=launch-v2@2.4.0 --no-baseline --no-volatile` after the apply:
-- 86 rows, 79 PASS / 5 EXPECTED-RED / 1 HARD FAIL / 1 UNKNOWN, exit 1, cleanup residue 0.
-- A5 still passes BOTH pairs (11246 < 11845, 13946 < 19246). The three A3 rows and the one
-- A4 row are the pre-existing EXPECTED-RED hypotheses and did not move.

-- BRANCH-ONLY, BY DESIGN

-- This file is applied to the TEST branch and NOT to the shared database, so
-- `check-target-parity.js` will now report a DIFF (4 products, 4 CPU specs, 4 offers, 12
-- assessments, 1 family) until an owner decides whether the canonical catalogue grows.
-- Post-apply verification (read-only)
-- ---------------------------------------------------------------------------
-- SELECT p.name, s.name AS socket, cs.integrated_gpu_present,
--        cs.integrated_gpu_model, o.price,
--        (SELECT string_agg(a.assessment_type::text || '=' || coalesce(a.score::text,'NULL'), ' ' ORDER BY a.assessment_type)
--           FROM component_assessment a WHERE a.product_id = p.id) AS scores
--   FROM product p
--   JOIN cpu_spec cs ON cs.product_id = p.id
--   LEFT JOIN socket s ON s.id = cs.socket_id
--   LEFT JOIN store_offer o ON o.product_id = p.id
--  WHERE p.name IN ('Seed AMD Ryzen 5 5600G', 'Seed AMD Ryzen 5 8500G',
--                   'Seed AMD Ryzen 7 8700G', 'Seed Intel Core i5-14400')
--  ORDER BY p.name;
--
-- SELECT count(*) FILTER (WHERE integrated_gpu_present) AS igpu_cpus,
--        count(*) AS cpus
--   FROM cpu_spec;
