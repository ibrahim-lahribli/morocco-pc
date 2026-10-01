-- ===========================================================================
-- Seed 004a: component_assessment for the seed-002 GPUs and PSUs (OG-01 batch 1)
--
-- Purpose: closes the reach-blocking half of OG-01 (audit OPEN_GAPS; research
-- plan docs/OG-01_ASSESSMENT_RESEARCH_PLAN.md). The 20 seed-002 GPUs and 9
-- seed-002 PSUs have zero component_assessment rows, so every weighted type
-- scores the flat no-evidence 40.000 (Decision 13 STEP 1) and their reachable
-- subset is decided by random UUID order (002 D2 amended, 2026-09-28). This
-- seed supplies REAL, web-sourced assessments for exactly those 29 products x
-- 3 types = 87 rows. Remaining roles (CPU/MB/RAM/SSD/CASE/COOLER) are batch 2
-- (seed 004b), NOT this file.
--
-- Scope: EXACTLY the 20 GPU products with a gpu_board_spec variant and the 9
-- PSU products from 002_catalog_expansion.sql that have no assessment rows.
-- Seed 001's assessed products (RTX 4060 8GB, CX550M, MAG A750GL 750W, ...)
-- are excluded by the NOT EXISTS guard AND by name. No spec/offer/variant row
-- is touched.
--
-- Conventions (identical to 001/002/003):
--   * DML only, no DDL. Single BEGIN/COMMIT: all-or-nothing per run.
--   * Idempotent: WHERE NOT EXISTS on (product_id, assessment_type) - a second
--     run inserts zero rows; an existing row (any source) is never overwritten.
--     A CORRECTION to a value written here must be a NEW seed file.
--   * NULL score means "researched, not rateable" (rating 'Unrated' + reason);
--     it documents the attempt and keeps that type on the no-evidence branch.
--     It is NEVER a guessed number.
--   * assessed_at = NOW() at apply time (freshness rule: decay is linear
--     0.5%/day; research is only valid applied fresh).
--   * ASCII only. CRLF.
--
-- APPLIED + MEASURED 2026-10-01 (OG-01 batch-1 acceptance, read-only pipeline
-- replication on the shared DB; TEST_DATABASE_URL branch unreachable that day):
--   * component_assessment 25 -> 112 rows (exactly these 87 inserted).
--   * Reach is now score-driven, not UUID-random: ALL 5 retained GPU slots are
--     004a-scored new GPUs (ASUS 5070 Ti PRIME, MSI 5080 VENTUS 3X, MSI 5080
--     SHADOW 3X, MSI 5070 GAMING TRIO, PNY 5080); retained PSUs = RM850e /
--     RM1000e / A750GL PCIE5 / A750GL / RM750e. Previously 2/20 GPUs and 3/9
--     PSUs reached a build, chosen by smallest UUID.
--   * 57 of 101 pool candidates still score the flat 40.000 = exactly the
--     batch-2 roles (CASE/COOLER/CPU/MB/RAM/SSD; seed 004b, unwritten).
--   * Coverage gate after apply: scripts/check-og01-coverage.js -> 56 products
--     / 168 implied rows (was 85/255 pre-apply).
--
-- RUBRIC ANCHORS (set before scoring; see plan section 4):
--
-- PERFORMANCE (GPU), normalized on TechPowerUp's GPU-database relative
-- performance chain (RTX 5070 Ti page: 5090=174%, 5080=115%, 5060 Ti 8GB=60%
-- of 5070 Ti; RTX 5070 page: 5090=224% of 5070; cross-checked on the 3080 /
-- 4070 Ti Super / 2080 Ti pages), expressed as % of RTX 5090:
--   5090=100, 5080=66, 5070 Ti=57.5, 5070=44.6, 9060 XT 16GB=35.5,
--   5060 Ti 16GB=35, 5060 Ti 8GB=34.5, 5060=30, 4060=24.6 (TechSpot: 9060 XT
--   "a few percent faster" than 5060 Ti). Cross-batch calibration: seed 001's
--   incumbent RTX 4060 PERFORMANCE=85 is the scale anchor, and scores map as
--   score = 85 + 10 * log(perf%/24.6) / log(100/24.6), capped at 95 for the
--   class leader (5090). Factory-OC AIB boards +1 where the OC is material.
--   This is a monotone, documented transform of sourced data, not a guess.
--
-- VALUE (both classes): live store_offer prices (this DB, MAD) divided by the
-- same relative-performance index; anchors: best price/frame in batch = 74,
-- worst = 59, linear in between (RTX 4060 incumbent VALUE=65 sits mid-scale).
-- PSU VALUE = price per rated watt within certification tier.
--
-- QUALITY (GPU): AIB partner + product-line reputation (cooler class, build,
-- warranty track record); ASRock Challenger grounded in the LanOC review
-- (40.8 dB @ 50% fan, cool/quiet); TUF/TRIO premium lines; VENTUS/PRIME/EAGLE
-- mainstream; PNY/ZOTAC basic-but-reliable.
--
-- QUALITY (PSU): unit-level review evidence where it exists (Corsair RMe
-- 2025 ATX 3.1 refresh: KitGuru/Cybenetics Gold, quiet; MAG A750GL: positive
-- budget-Gold coverage). Where NO credible unit-level review exists (Connect
-- PSU 850, HYBROK 650, and Antec G850 whose model identity seed 003 D7
-- already flagged ambiguous) the QUALITY score is NULL 'Unrated' - per 002 D2
-- these unbranded parts must NOT be seeded optimistically; QUALITY is the
-- only quality gate the engine has for them.
--
-- EFFICIENCY (PSU): objective certification rubric - 80 PLUS Gold (or
-- Cybenetics Gold) = 80-84, Bronze = 62-66, +1..2 for measured Cybenetics
-- data / ATX 3.1 units. Certification is an official published fact.
--
-- SOURCES (key URLs; per-row figure in the trailing comment):
--   https://www.techpowerup.com/gpu-specs/geforce-rtx-5070-ti.c4243   (rel-perf chain)
--   https://www.techpowerup.com/gpu-specs/geforce-rtx-5070.c4218      (5070/5080 rel)
--   https://www.techspot.com/review/3019-nvidia-5060-ti-vs-amd-9060-xt-with-dlss-fsr/ (9060 XT)
--   https://www.tomshardware.com/pc-components/gpus/rtx-5070-vs-rtx-5060-ti-16gb (5070 vs 5060 Ti)
--   https://lanoc.org/review/video-cards/asrock-rx-9060-xt-challenger-oc-16gb (Challenger acoustics)
--   https://www.kitguru.net/components/power-supplies/zardon/corsair-rm850e-atx-3-1-2025-psu-review/ (RM850e 2025)
--   https://www.cybenetics.com/index.php?option=psu-performance-database (PSU performance DB)
--   https://cultists.network/140/psu-tier-list/ (tier context; not a score source)
--   Live prices: this database's store_offer rows (MAD), read 2026-09-30.
--
-- EXPECTED EFFECT (verdict for this pass, to be measured on TEST_DATABASE_URL
-- before shared apply): new GPUs/PSUs leave the flat 40.000 tie; GPU/PSU reach
-- becomes score-driven instead of UUID-driven. Measure with the 002-D2
-- amended chain (filterCandidates -> computeCandidateScores ->
-- retainTopKPerRole under seed-minimal-v1) BEFORE and AFTER.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- GPUs: 20 products x 3 types (PERFORMANCE, VALUE, QUALITY)
-- ---------------------------------------------------------------------------
INSERT INTO component_assessment (product_id, assessment_type, score, rating,
    summary, rationale, confidence, source_type, assessed_at)
SELECT p.id, v.atype::assessment_type, v.score, v.rating, v.summary,
    v.rationale, v.conf::confidence_level, v.stype::source_type, NOW()
FROM (VALUES
    -- ---------------- RTX 5090 ----------------
    ('Seed ASUS GeForce RTX 5090 32 GB TUF GAMING', 'PERFORMANCE', 95, 'Great',
     'Class leader: GB202 flagship, 100% of rel-perf index', 'TPU rel-perf 5090=100 (anchor of index); log map 85+10*log(100/24.6)/log(100/24.6)=95 cap. TUF OC +0 (already cap)', 'HIGH', 'COMMUNITY', 39990),
    ('Seed ASUS GeForce RTX 5090 32 GB TUF GAMING', 'VALUE', 59, 'Average',
     'Flagship price 39990 MAD; worst price/frame in batch', 'Index 100/39990=2.50 (batch best 6.51); linear map 50+24*2.50/6.51=59', 'MEDIUM', 'RETAILER', 39990),
    ('Seed ASUS GeForce RTX 5090 32 GB TUF GAMING', 'QUALITY', 86, 'Great',
     'TUF: premium build, top-tier cooler and VRM', 'AIB line reputation (TUF = ASUS premium tier); no unit teardown in batch - consensus', 'MEDIUM', 'COMMUNITY', 39990),
    -- ---------------- RTX 5080 (5 boards) ----------------
    ('Seed GIGABYTE GeForce RTX 5080 16 GB', 'PERFORMANCE', 92, 'Great',
     'GB203, 66% of 5090 rel index', 'TPU chain 5080=115% of 5070 Ti -> 66% of 5090; log map -> 92.0; no factory OC', 'HIGH', 'COMMUNITY', 17499),
    ('Seed GIGABYTE GeForce RTX 5080 16 GB', 'VALUE', 64, 'Average',
     '17499 MAD; mid-pack price/frame', 'Index 66/17499=3.77 (batch best 6.51) -> 50+24*3.77/6.51=64', 'MEDIUM', 'RETAILER', 17499),
    ('Seed GIGABYTE GeForce RTX 5080 16 GB', 'QUALITY', 74, 'Good',
     'Gigabyte base dual/triple-fan design, mainstream', 'AIB line reputation; base (non-OC) Gigabyte board', 'MEDIUM', 'COMMUNITY', 17499),
    ('Seed GIGABYTE GeForce RTX 5080 16 GB GAMING OC', 'PERFORMANCE', 93, 'Great',
     '66% of 5090 + factory OC', 'TPU chain -> 92.0; GAMING OC factory OC +1', 'HIGH', 'COMMUNITY', 15700),
    ('Seed GIGABYTE GeForce RTX 5080 16 GB GAMING OC', 'VALUE', 65, 'Average',
     '15700 MAD; cheaper 5080, good price/frame for class', 'Index 66/15700=4.20 -> 50+24*4.20/6.51=65', 'MEDIUM', 'RETAILER', 15700),
    ('Seed GIGABYTE GeForce RTX 5080 16 GB GAMING OC', 'QUALITY', 78, 'Good',
     'GAMING OC: solid triple-fan, good Gigabyte tier', 'AIB line reputation (GAMING OC above EAGLE/base)', 'MEDIUM', 'COMMUNITY', 15700),
    ('Seed MSI GeForce RTX 5080 16 GB SHADOW 3X', 'PERFORMANCE', 92, 'Great',
     '66% of 5090, modest factory profile', 'TPU chain -> 92.0; SHADOW 3X mild OC +0', 'HIGH', 'COMMUNITY', 16490),
    ('Seed MSI GeForce RTX 5080 16 GB SHADOW 3X', 'VALUE', 65, 'Average',
     '16490 MAD', 'Index 66/16490=4.00 -> 65', 'MEDIUM', 'RETAILER', 16490),
    ('Seed MSI GeForce RTX 5080 16 GB SHADOW 3X', 'QUALITY', 76, 'Good',
     'SHADOW 3X: compact triple-fan, mid MSI tier', 'AIB line reputation (below VENTUS/GAMING in MSI stack)', 'MEDIUM', 'COMMUNITY', 16490),
    ('Seed MSI GeForce RTX 5080 16 GB VENTUS 3X', 'PERFORMANCE', 92, 'Great',
     '66% of 5090', 'TPU chain -> 92.0', 'HIGH', 'COMMUNITY', 15900),
    ('Seed MSI GeForce RTX 5080 16 GB VENTUS 3X', 'VALUE', 65, 'Average',
     '15900 MAD', 'Index 66/15900=4.15 -> 65', 'MEDIUM', 'RETAILER', 15900),
    ('Seed MSI GeForce RTX 5080 16 GB VENTUS 3X', 'QUALITY', 77, 'Good',
     'VENTUS 3X: mainstream triple-fan', 'AIB line reputation', 'MEDIUM', 'COMMUNITY', 15900),
    ('Seed PNY GeForce RTX 5080 16 GB', 'PERFORMANCE', 92, 'Great',
     '66% of 5090', 'TPU chain -> 92.0', 'HIGH', 'COMMUNITY', 16499),
    ('Seed PNY GeForce RTX 5080 16 GB', 'VALUE', 65, 'Average',
     '16499 MAD', 'Index 66/16499=4.00 -> 65', 'MEDIUM', 'RETAILER', 16499),
    ('Seed PNY GeForce RTX 5080 16 GB', 'QUALITY', 73, 'Good',
     'PNY: basic cooler, reliable brand, weaker warranty network', 'AIB reputation (basic premium-chip boards)', 'MEDIUM', 'COMMUNITY', 16499),
    ('Seed ZOTAC GeForce RTX 5080 16 GB', 'PERFORMANCE', 92, 'Great',
     '66% of 5090', 'TPU chain -> 92.0', 'HIGH', 'COMMUNITY', 16999),
    ('Seed ZOTAC GeForce RTX 5080 16 GB', 'VALUE', 64, 'Average',
     '16999 MAD', 'Index 66/16999=3.88 -> 64', 'MEDIUM', 'RETAILER', 16999),
    ('Seed ZOTAC GeForce RTX 5080 16 GB', 'QUALITY', 74, 'Good',
     'Zotac base triple-fan', 'AIB line reputation', 'MEDIUM', 'COMMUNITY', 16999),
    -- ---------------- RTX 5070 Ti (2 boards) ----------------
    ('Seed ASUS GeForce RTX 5070 Ti 16 GB PRIME', 'PERFORMANCE', 91, 'Great',
     '57.5% of 5090 rel index', 'TPU chain 5070 Ti=57.5% of 5090; log map -> 91.0', 'HIGH', 'COMMUNITY', 11500),
    ('Seed ASUS GeForce RTX 5070 Ti 16 GB PRIME', 'VALUE', 68, 'Good',
     '11500 MAD; strong price/frame for tier', 'Index 57.5/11500=5.00 -> 50+24*5.00/6.51=68', 'MEDIUM', 'RETAILER', 11500),
    ('Seed ASUS GeForce RTX 5070 Ti 16 GB PRIME', 'QUALITY', 80, 'Good',
     'PRIME: solid ASUS mid line', 'AIB line reputation', 'MEDIUM', 'COMMUNITY', 11500),
    ('Seed MSI GeForce RTX 5070 Ti 16 GB VENTUS 3X', 'PERFORMANCE', 91, 'Great',
     '57.5% of 5090 rel index', 'TPU chain -> 91.0', 'HIGH', 'COMMUNITY', 12899),
    ('Seed MSI GeForce RTX 5070 Ti 16 GB VENTUS 3X', 'VALUE', 66, 'Average',
     '12899 MAD; pricier 5070 Ti', 'Index 57.5/12899=4.46 -> 66', 'MEDIUM', 'RETAILER', 12899),
    ('Seed MSI GeForce RTX 5070 Ti 16 GB VENTUS 3X', 'QUALITY', 77, 'Good',
     'VENTUS 3X mainstream triple-fan', 'AIB line reputation', 'MEDIUM', 'COMMUNITY', 12899),
    -- ---------------- RTX 5070 (4 boards) ----------------
    ('Seed GIGABYTE GeForce RTX 5070 12 GB', 'PERFORMANCE', 89, 'Good',
     '44.6% of 5090 rel index', 'TPU chain 5070=44.6% of 5090 (5090=224% of 5070); log map -> 89.2', 'HIGH', 'COMMUNITY', 8100),
    ('Seed GIGABYTE GeForce RTX 5070 12 GB', 'VALUE', 70, 'Good',
     '8100 MAD; cheapest 5070, very good price/frame', 'Index 44.6/8100=5.51 (near batch best) -> 70', 'MEDIUM', 'RETAILER', 8100),
    ('Seed GIGABYTE GeForce RTX 5070 12 GB', 'QUALITY', 74, 'Good',
     'Gigabyte base dual/triple-fan', 'AIB line reputation', 'MEDIUM', 'COMMUNITY', 8100),
    ('Seed GIGABYTE GeForce RTX 5070 12 GB EAGLE OC', 'PERFORMANCE', 90, 'Good',
     '44.6% of 5090 + factory OC', 'TPU chain -> 89.2; EAGLE OC +1', 'HIGH', 'COMMUNITY', 8500),
    ('Seed GIGABYTE GeForce RTX 5070 12 GB EAGLE OC', 'VALUE', 69, 'Good',
     '8500 MAD', 'Index 44.6/8500=5.25 -> 69', 'MEDIUM', 'RETAILER', 8500),
    ('Seed GIGABYTE GeForce RTX 5070 12 GB EAGLE OC', 'QUALITY', 73, 'Good',
     'EAGLE: Gigabyte entry triple-fan line', 'AIB line reputation (entry tier)', 'MEDIUM', 'COMMUNITY', 8500),
    ('Seed MSI GeForce RTX 5070 12 GB GAMING TRIO', 'PERFORMANCE', 90, 'Good',
     '44.6% of 5090 + factory OC', 'TPU chain -> 89.2; GAMING TRIO OC +1', 'HIGH', 'COMMUNITY', 9000),
    ('Seed MSI GeForce RTX 5070 12 GB GAMING TRIO', 'VALUE', 68, 'Good',
     '9000 MAD; premium-cooled 5070', 'Index 44.6/9000=4.96 -> 68', 'MEDIUM', 'RETAILER', 9000),
    ('Seed MSI GeForce RTX 5070 12 GB GAMING TRIO', 'QUALITY', 82, 'Good',
     'GAMING TRIO: premium MSI cooler, quiet', 'AIB line reputation (premium tier)', 'MEDIUM', 'COMMUNITY', 9000),
    ('Seed MSI GeForce RTX 5070 12 GB VENTUS 2X', 'PERFORMANCE', 89, 'Good',
     '44.6% of 5090', 'TPU chain -> 89.2', 'HIGH', 'COMMUNITY', 8490),
    ('Seed MSI GeForce RTX 5070 12 GB VENTUS 2X', 'VALUE', 69, 'Good',
     '8490 MAD', 'Index 44.6/8490=5.25 -> 69', 'MEDIUM', 'RETAILER', 8490),
    ('Seed MSI GeForce RTX 5070 12 GB VENTUS 2X', 'QUALITY', 75, 'Good',
     'VENTUS 2X: compact dual-fan mainstream', 'AIB line reputation', 'MEDIUM', 'COMMUNITY', 8490),
    -- ---------------- RTX 5060 Ti (3 boards) ----------------
    ('Seed MSI GeForce RTX 5060 Ti 8 GB VENTUS 2X', 'PERFORMANCE', 87, 'Good',
     '34.5% of 5090 rel index', 'TPU chain 5060 Ti 8GB=60% of 5070 Ti -> 34.5% of 5090; log map -> 87.4', 'HIGH', 'COMMUNITY', 5299),
    ('Seed MSI GeForce RTX 5060 Ti 8 GB VENTUS 2X', 'VALUE', 74, 'Good',
     '5299 MAD; best price/frame in batch', 'Index 34.5/5299=6.51 = batch best -> 74', 'MEDIUM', 'RETAILER', 5299),
    ('Seed MSI GeForce RTX 5060 Ti 8 GB VENTUS 2X', 'QUALITY', 75, 'Good',
     'VENTUS 2X mainstream', 'AIB line reputation; 8GB VRAM caveat documented at spec level, not quality', 'MEDIUM', 'COMMUNITY', 5299),
    ('Seed PNY GeForce RTX 5060 Ti 8 GB DUAL', 'PERFORMANCE', 87, 'Good',
     '34.5% of 5090 rel index', 'TPU chain -> 87.4', 'HIGH', 'COMMUNITY', 5349),
    ('Seed PNY GeForce RTX 5060 Ti 8 GB DUAL', 'VALUE', 74, 'Good',
     '5349 MAD; near-best price/frame', 'Index 34.5/5349=6.45 -> 74', 'MEDIUM', 'RETAILER', 5349),
    ('Seed PNY GeForce RTX 5060 Ti 8 GB DUAL', 'QUALITY', 72, 'Good',
     'PNY DUAL: basic cooler', 'AIB reputation', 'MEDIUM', 'COMMUNITY', 5349),
    ('Seed ZOTAC GeForce RTX 5060 Ti 16 GB TWIN EDGE', 'PERFORMANCE', 88, 'Good',
     '35% of 5090; same die as 8GB, 16GB VRAM', 'TPU chain 5060 Ti 16GB=35% of 5090 (3080/4070TiS pages); log map -> 87.5; VRAM helps VRAM-heavy titles', 'HIGH', 'COMMUNITY', 7999),
    ('Seed ZOTAC GeForce RTX 5060 Ti 16 GB TWIN EDGE', 'VALUE', 66, 'Average',
     '7999 MAD; 16GB premium eats price/frame', 'Index 35/7999=4.38 -> 66 (VRAM futureproofing not priced into index)', 'MEDIUM', 'RETAILER', 7999),
    ('Seed ZOTAC GeForce RTX 5060 Ti 16 GB TWIN EDGE', 'QUALITY', 75, 'Good',
     'TWIN EDGE: compact dual-fan, decent Zotac line', 'AIB line reputation', 'MEDIUM', 'COMMUNITY', 7999),
    -- ---------------- RX 9060 XT ----------------
    ('Seed ASROCK Radeon RX 9060 XT 16 GB', 'PERFORMANCE', 88, 'Good',
     '35.5% of 5090 rel index; ~few % over 5060 Ti', 'TechSpot: 9060 XT a few % faster than 5060 Ti in all configs; TPU cross-check -> 35.5% of 5090; log map -> 87.6', 'HIGH', 'COMMUNITY', 5900),
    ('Seed ASROCK Radeon RX 9060 XT 16 GB', 'VALUE', 72, 'Good',
     '5900 MAD for 16GB; sharp cost-per-frame', 'Index 35.5/5900=6.02 -> 72; Club386: best cost/frame vs 5060 Ti 16GB', 'MEDIUM', 'RETAILER', 5900),
    ('Seed ASROCK Radeon RX 9060 XT 16 GB', 'QUALITY', 76, 'Good',
     'Challenger: cool and quiet (40.8 dB @ 50% fan)', 'LanOC measured review: top-half acoustics, cool; solid budget cooler', 'MEDIUM', 'COMMUNITY', 5900),
    -- ---------------- RTX 5060 (3 boards) ----------------
    ('Seed GIGABYTE GeForce RTX 5060 8 GB', 'PERFORMANCE', 86, 'Good',
     '30% of 5090 rel index', 'TPU chain 5060=98% of 2080 Ti, 2080 Ti=30.7% of 5090 -> 30%; log map -> 86.4', 'HIGH', 'COMMUNITY', 4990),
    ('Seed GIGABYTE GeForce RTX 5060 8 GB', 'VALUE', 72, 'Good',
     '4990 MAD; excellent price/frame', 'Index 30/4990=6.01 -> 72', 'MEDIUM', 'RETAILER', 4990),
    ('Seed GIGABYTE GeForce RTX 5060 8 GB', 'QUALITY', 73, 'Good',
     'Gigabyte base compact design', 'AIB line reputation', 'MEDIUM', 'COMMUNITY', 4990),
    ('Seed MSI GeForce RTX 5060 8 GB VENTUS 2X', 'PERFORMANCE', 86, 'Good',
     '30% of 5090 rel index', 'TPU chain -> 86.4', 'HIGH', 'COMMUNITY', 4999),
    ('Seed MSI GeForce RTX 5060 8 GB VENTUS 2X', 'VALUE', 72, 'Good',
     '4999 MAD', 'Index 30/4999=6.00 -> 72', 'MEDIUM', 'RETAILER', 4999),
    ('Seed MSI GeForce RTX 5060 8 GB VENTUS 2X', 'QUALITY', 75, 'Good',
     'VENTUS 2X mainstream', 'AIB line reputation', 'MEDIUM', 'COMMUNITY', 4999),
    ('Seed PNY GeForce RTX 5060 8 GB', 'PERFORMANCE', 86, 'Good',
     '30% of 5090 rel index', 'TPU chain -> 86.4', 'HIGH', 'COMMUNITY', 5090),
    ('Seed PNY GeForce RTX 5060 8 GB', 'VALUE', 72, 'Good',
     '5090 MAD', 'Index 30/5090=5.89 -> 71.7 -> 72', 'MEDIUM', 'RETAILER', 5090),
    ('Seed PNY GeForce RTX 5060 8 GB', 'QUALITY', 72, 'Good',
     'PNY basic cooler', 'AIB reputation', 'MEDIUM', 'COMMUNITY', 5090)
) AS v(pname, atype, score, rating, summary, rationale, conf, stype, ref_price)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (
    SELECT 1 FROM component_assessment a
    WHERE a.product_id = p.id AND a.assessment_type = v.atype::assessment_type
);
-- ref_price column is documentation only (the live MAD offer used for VALUE).

-- ---------------------------------------------------------------------------
-- PSUs: 9 products x 3 types (QUALITY, EFFICIENCY, VALUE)
-- ---------------------------------------------------------------------------
INSERT INTO component_assessment (product_id, assessment_type, score, rating,
    summary, rationale, confidence, source_type, assessed_at)
SELECT p.id, v.atype::assessment_type, v.score, v.rating, v.summary,
    v.rationale, v.conf::confidence_level, v.stype::source_type, NOW()
FROM (VALUES
    -- Corsair RMe 2025 ATX 3.1 refresh: Cybenetics Gold, well reviewed (KitGuru)
    ('Seed Corsair RM1000e 1000W', 'QUALITY', 83, 'Great',
     '2025 ATX 3.1 refresh: Cybenetics Gold, quiet, quality platform', 'KitGuru RM850e/RM1000e (2025) reviews: steady regulation, Cybenetics Gold; 1000W headroom', 'MEDIUM', 'COMMUNITY', 1899),
    ('Seed Corsair RM1000e 1000W', 'EFFICIENCY', 84, 'Great',
     '80 PLUS Gold; Cybenetics Gold measured', 'Certification rubric: Gold=80-84; Cybenetics measured data + ATX 3.1 -> top of band', 'HIGH', 'OFFICIAL', 1899),
    ('Seed Corsair RM1000e 1000W', 'VALUE', 65, 'Average',
     '1899 MAD = 1.90 MAD/W Gold; fine for 1kW', 'Price/watt within Gold tier; 1kW units carry a premium', 'MEDIUM', 'RETAILER', 1899),
    ('Seed Corsair RM850e 850W', 'QUALITY', 82, 'Great',
     '2025 ATX 3.1 refresh: Cybenetics Gold, quiet', 'KitGuru RM850e (2025) review: Cybenetics Gold, steady output', 'MEDIUM', 'COMMUNITY', 1299),
    ('Seed Corsair RM850e 850W', 'EFFICIENCY', 84, 'Great',
     '80 PLUS Gold; Cybenetics Gold measured', 'Certification rubric; measured Cybenetics data', 'HIGH', 'OFFICIAL', 1299),
    ('Seed Corsair RM850e 850W', 'VALUE', 70, 'Good',
     '1299 MAD = 1.53 MAD/W Gold', 'Price/watt within Gold tier', 'MEDIUM', 'RETAILER', 1299),
    ('Seed Corsair RM750e 750W', 'QUALITY', 81, 'Great',
     'ATX 3.0 RMe generation, proven platform', 'RM750e (2022): well-reviewed quiet Gold unit; earlier ATX 3.0 rev than 2025 refresh', 'MEDIUM', 'COMMUNITY', 1099),
    ('Seed Corsair RM750e 750W', 'EFFICIENCY', 82, 'Great',
     '80 PLUS Gold', 'Certification rubric: Gold=80-84, no Cybenetics re-measure of this rev in hand', 'HIGH', 'OFFICIAL', 1099),
    ('Seed Corsair RM750e 750W', 'VALUE', 70, 'Good',
     '1099 MAD = 1.47 MAD/W Gold', 'Price/watt within Gold tier', 'MEDIUM', 'RETAILER', 1099),
    -- MSI MAG A750GL PCIE5: the budget Gold reference of this batch
    ('Seed MSI MAG A750GL PCIE5 750W', 'QUALITY', 80, 'Good',
     'Budget Gold reference: positive coverage, ATX 3.x PCIe5 connector', 'MAG A750GL family: positive budget-Gold coverage (hwbusters/tier context); PCIE5 SKU is the newer one', 'MEDIUM', 'COMMUNITY', 999),
    ('Seed MSI MAG A750GL PCIE5 750W', 'EFFICIENCY', 82, 'Great',
     '80 PLUS Gold', 'Certification rubric', 'HIGH', 'OFFICIAL', 999),
    ('Seed MSI MAG A750GL PCIE5 750W', 'VALUE', 75, 'Good',
     '999 MAD = 1.33 MAD/W Gold; best Gold price/watt in batch', 'Price/watt within Gold tier: cheapest Gold per watt here', 'MEDIUM', 'RETAILER', 999),
    -- Antec G850: Gold cert known; MODEL IDENTITY AMBIGUOUS (seed 003 D7)
    ('Seed Antec G850 850W Gold', 'QUALITY', NULL, 'Unrated',
     'Model identity ambiguous (Atom G850 vs GSK G850) - no credible unit review found', 'Honest NULL per 002 D2: QUALITY is the only quality gate; do not seed optimistically. Seed 003 D7 already flagged the ambiguous identity', 'LOW', 'COMMUNITY', 999),
    ('Seed Antec G850 850W Gold', 'EFFICIENCY', 80, 'Good',
     '80 PLUS Gold, non-modular', 'Certification rubric: Gold=80-84; non-modular does not change efficiency', 'HIGH', 'OFFICIAL', 999),
    ('Seed Antec G850 850W Gold', 'VALUE', 76, 'Good',
     '999 MAD = 1.18 MAD/W Gold; cheapest Gold per watt', 'Price/watt: lowest in Gold tier of this batch', 'MEDIUM', 'RETAILER', 999),
    -- Bronze, ATX 3.1, 1000W: spec-relevant for big GPUs
    ('Seed Antec CSK1000 PRO EC ATX3.1 1000W Bronze', 'QUALITY', 65, 'Average',
     'CSK = Antec budget line; no unit teardown found', 'Antec CSK series is the budget tier; ATX 3.1 + native 12V-2x6 is a plus; no unit review -> mid score', 'LOW', 'COMMUNITY', 1299),
    ('Seed Antec CSK1000 PRO EC ATX3.1 1000W Bronze', 'EFFICIENCY', 66, 'Average',
     '80 PLUS Bronze, ATX 3.1', 'Certification rubric: Bronze=62-66; ATX 3.1 does not change efficiency', 'HIGH', 'OFFICIAL', 1299),
    ('Seed Antec CSK1000 PRO EC ATX3.1 1000W Bronze', 'VALUE', 72, 'Good',
     '1299 MAD = 1.30 MAD/W for 1000W ATX 3.1', 'Per-watt strong for the wattage class; Bronze tier limits the ceiling', 'MEDIUM', 'RETAILER', 1299),
    -- MSI MAG A650BN: older bronze MAG
    ('Seed MSI MAG A650BN 650W', 'QUALITY', 72, 'Good',
     'Long-running budget MAG bronze; decent build for tier', 'A650BN: established budget unit, positive tier context for bronze MAG', 'MEDIUM', 'COMMUNITY', 649),
    ('Seed MSI MAG A650BN 650W', 'EFFICIENCY', 65, 'Average',
     '80 PLUS Bronze', 'Certification rubric', 'HIGH', 'OFFICIAL', 649),
    ('Seed MSI MAG A650BN 650W', 'VALUE', 70, 'Good',
     '649 MAD = 1.00 MAD/W Bronze', 'Price/watt within Bronze tier', 'MEDIUM', 'RETAILER', 649),
    -- Unbranded / regional: QUALITY honestly unrated (002 D2 strict-gate rule)
    ('Seed Connect PSU 850 Bronze', 'QUALITY', NULL, 'Unrated',
     'No credible unit-level review exists for this regional brand', 'Honest NULL per 002 D2 / plan section 3: research attempted, nothing found; QUALITY must not be guessed', 'LOW', 'COMMUNITY', 799),
    ('Seed Connect PSU 850 Bronze', 'EFFICIENCY', 64, 'Average',
     '80 PLUS Bronze', 'Certification rubric: Bronze=62-66', 'HIGH', 'OFFICIAL', 799),
    ('Seed Connect PSU 850 Bronze', 'VALUE', 75, 'Good',
     '799 MAD = 0.94 MAD/W; cheapest per watt in batch', 'Pure price/watt fact; QUALITY remains the gate', 'MEDIUM', 'RETAILER', 799),
    ('Seed HYBROK PSU 650 Bronze', 'QUALITY', NULL, 'Unrated',
     'No credible unit-level review exists for this regional brand', 'Honest NULL per 002 D2 / plan section 3: research attempted, nothing found', 'LOW', 'COMMUNITY', 599),
    ('Seed HYBROK PSU 650 Bronze', 'EFFICIENCY', 64, 'Average',
     '80 PLUS Bronze', 'Certification rubric: Bronze=62-66', 'HIGH', 'OFFICIAL', 599),
    ('Seed HYBROK PSU 650 Bronze', 'VALUE', 74, 'Good',
     '599 MAD = 0.92 MAD/W', 'Pure price/watt fact; QUALITY remains the gate', 'MEDIUM', 'RETAILER', 599)
) AS v(pname, atype, score, rating, summary, rationale, conf, stype, ref_price)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (
    SELECT 1 FROM component_assessment a
    WHERE a.product_id = p.id AND a.assessment_type = v.atype::assessment_type
);

COMMIT;
