-- ============================================================================
-- Seed 025: two GPUs that fill the measured VRAM/price holes
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- `launch-v2@2.4.0` declares resolution VRAM floors (configuration ->
-- resolution_profiles): 1080p 8 GB, 1440p 12 GB, 2160p 16 GB. Measured on the
-- TEST branch 2026-10-31 over the population the band query actually reads:
-- ACTIVE GPU products carrying a live offer, 21 cards. The query INNER-joins
-- store_offer, so an ACTIVE GPU with no live offer drops out of it; measured on
-- that date none did (21 ACTIVE GPU products, 21 of them with an offer). The 23
-- that appears elsewhere in this header is the POST-seed population, these 21
-- plus the two cards below, and it is not what this table counts:
--
--   BAND          CARDS   >= 8 GB   >= 12 GB   >= 16 GB
--   < 5000            3         3          0          0   <- no 1440p card at all
--   5000-7999         5         5          2          2
--   8000-11999        5         5          5          1   <- one 2160p card only
--   12000-15999       3         3          3          3
--   16000-24999       4         4          4          4
--   25000+            1         1          1          1
--
-- So the cheapest 1440p-eligible card in the catalog was 5900 MAD (the ASRock
-- RX 9060 XT 16 GB): every pass at 1440p paid a 5900 MAD GPU floor no matter
-- how small the budget, and the three cards under 5000 (RTX 4060 3200, and the
-- 5060 pair at 4990/4999) could not enter a 1440p pass at any price. Separately,
-- a 2160p pass had exactly one 16 GB option between 8000 and 11999 (the ASUS
-- 5070 Ti at 11500).
--
-- This seed fills both with one card each:
--
--   Intel Arc B580 12 GB                        3299   first >= 12 GB under 5000
--   GIGABYTE Radeon RX 9070 16 GB GAMING OC    10900   second 16 GB in 8000-11999
--
-- WHAT WAS CONSIDERED AND REJECTED
--
--   * A third RTX 5060 Ti 16 GB around 7599 to close the 5900-7999 price gap.
--     Rejected: the 5900-7999 gap is NOT a VRAM hole - both of its endpoints
--     (9060 XT 5900, ZOTAC 5060 Ti 16 GB 7999) are already 16 GB, so nothing
--     about it blocks a resolution. And the ZOTAC carries the same chip, the
--     same PERFORMANCE 88 and the same QUALITY 75 this card would get, so any
--     price between them makes one of the two a row that can never be selected.
--     That is padding, not coverage.
--   * A Radeon RX 9070 XT for the 12899-15700 gap. Rejected: on this catalog's
--     own chain it lands at 54.9 against the RTX 5070 Ti's 57.5, so priced
--     anywhere near the Ti it is dominated on price AND performance - an entry
--     that exists but can never win. A band is only worth filling with
--     something that can beat or trade with what is already in it.
--   * No new PSU, case or cooler rows, and no GPU<->case / GPU<->PSU
--     compatibility table: those relationships are DERIVED from the numeric
--     columns below (AGENTS hard rule). The real dimensions are what makes that
--     derivation usable, which is why they are vendor figures and not NULLs.
--   * No re-scoring of the 23 incumbent rows. In particular the ASRock 9060 XT
--     carries PERFORMANCE 88 against a chain index of 35.2 while the 5060 Ti
--     16 GB carries 88 at 35.0; both stand. Correcting an incumbent is a new
--     seed with its own evidence.
--
-- CATALOGUE DECISIONS TAKEN WITH THIS SEED (both deliberate, neither is drift)
--
--   (a) The RTX 4060 8 GB at 3200 MAD is now NEAR-DOMINATED and is KEPT.
--       The Arc B580 above costs 99 MAD more for the SAME PERFORMANCE mark (85)
--       and four more gigabytes, so on any 1440p query the 4060 can no longer
--       win. It is kept anyway, because "dominated at 1440p" is not "useless":
--       it is still the cheapest way into a 1080p 8 GB build, and it is the
--       ANCHOR the PERFORMANCE rubric was calibrated on (24.6 percent = 85),
--       so deleting it would remove the row every other GPU score is stated
--       against. Re-pricing it is the alternative and is deliberately NOT
--       done here: a 3200 -> 3101 cut would exist only to restore a dominance
--       the catalogue no longer has, and a seed price is LOW confidence
--       (OG-37). ACCEPTED adjacency; revisit only with a real listing.
--
--   (b) The 5900-7999 MAD band holding just two >= 12 GB cards (ASRock RX 9060
--       XT 16 GB at 5900, ZOTAC RTX 5060 Ti 16 GB at 7999) is an ACCEPTED gap,
--       not a hole. Both ENDPOINTS already clear the 16 GB tier, so nothing a
--       resolution floor asks for is missing between them: the band only looks
--       thin under a "12 GB and nothing bigger" reading, where a 16 GB card at
--       5900 already dominates anything that reading could put in it. An
--       earlier pass called it a hole and proposed a third 5060 Ti inside it;
--       that proposal is REJECTED above for exactly this reason.
--
-- RUBRIC - PERFORMANCE. Recovered from the incumbents, then applied.
--
--   TechPowerUp relative chain as % of RTX 5090 (5090 = 100):
--     score = 85 + 10*log(perf%/24.6)/log(100/24.6), cap 95, 4060 = 85 anchor.
--   That formula reproduces the incumbent rows exactly - 30 -> 86 (5060),
--   34.5 -> 87 (5060 Ti 8GB), 44.6 -> 89 (5070), 57.5 -> 91 (5070 Ti),
--   66 -> 92 (5080), 100 -> 95 (5090) - so it is the formula in use, not a
--   reconstruction that happens to look plausible.
--     Arc B580       24.4 -> 85 + 10*(-0.00816)/1.40235 = 84.94 -> 85
--     Radeon RX 9070 49.3 -> 85 + 10*(0.69532)/1.40235 = 89.96 -> 90
--   The B580 is a PERFORMANCE TIE with the incumbent RTX 4060 (24.6 -> 85).
--   The row says so: this card is here for its 12 GB, not its speed.
--
-- RUBRIC - VALUE. Also recovered from the incumbents; the 002-era formula
-- (`50 + 24*index/best`, where index = perf%/price) is what the 21 incumbent GPU rows
-- actually carry, and it reproduces every one of them:
--     5060 Ti 8GB  34.5/5299 = 0.0065110 -> 74 (the batch best, by definition)
--     5060         30/4990   = 0.0060120 -> 72
--     5070         44.6/8100 = 0.0055062 -> 70
--     5070 Ti      57.5/11500 = 0.0050000 -> 68
--     5080         66/15700 = 0.0042038 -> 65
--     5090         100/39990 = 0.0025006 -> 59
--   best_ratio = 34.5/5299 = 0.0065107. Applied:
--     Arc B580       24.4/3299  = 0.0073962 -> 1.136 x best -> 77.26, CLAMPED
--                                to the catalog ceiling 74 (no GPU row exceeds
--                                74; the clamp is the existing convention)
--     Radeon RX 9070 49.3/10900 = 0.0045229 -> 0.6947 x best -> 50 + 16.67 = 67
--   NOTE the batch ceiling is why the B580's VALUE saturates: 3299 MAD for a
--   12 GB card is off the end of the incumbent value scale, and clamping says
--   so instead of inventing a 78 that no comparison in the catalog supports.
--
-- RUBRIC - QUALITY. AIB partner and product line, against the incumbent range
-- 72 (PNY) to 86 (ASUS TUF):
--     VENTUS 2X 75 | ZOTAC TWIN EDGE 75 | GIGABYTE GAMING OC 74-78 by die |
--     GIGABYTE 5070 74 | GIGABYTE 5080 GAMING OC 78
--     * GIGABYTE GAMING OC on the 220 W RX 9070 -> 76, between the 5070
--       GAMING (74) and the 5080 GAMING OC (78): same OC line, triple-fan
--       cooler, smaller die than the 5080's 360 W part.
--     * Intel Limited Edition -> 70, BELOW the entire AIB range, on purpose.
--       The cooler and the board are first-tier reference quality; the two
--       points a spec sheet cannot show are driver maturity in older titles and
--       weaker resale than an NVIDIA part at the same speed. Marking it up to
--       fit the range would hide the one thing a buyer should know.
--
-- DIMENSIONS AND POWER - vendor pages, not estimates
--
--   Intel Arc B580 Limited Edition: 272 x 115 x 44 mm, 2 slots, 190 W total
--   board power, 600 W system PSU, one 8-pin.
--     https://www.intel.com/content/www/us/en/support/articles/000091128.html
--   GIGABYTE RX 9070 GAMING OC 16G: L=288 W=132 H=50 mm (2.5 slots), 220 W,
--   recommended PSU 750 W, two 8-pin, PCIe 5.0.
--     https://www.gigabyte.com/us/Graphics-Card/GV-R9070GAMING-OC-16GD
--   `pcie_8pin` keys match the incumbent JSON shape
--   ({"pcie_8pin": 1} / {"12vhpwr": 1}), not a new spelling.
--
-- PRICE PROVENANCE
--
--   Both prices are SEED-class (OG-37): plausible Moroccan retail, no listing.
--   The VALUE assessments therefore carry LOW confidence, the same convention
--   004a used for its seed prices. `check-offer-provenance.js` counts these as
--   SEED and never certifies them, which is the correct answer for this file.
--
-- MEASURED AFTER THE APPLY (TEST branch, 2026-10-31, `launch-v2@2.4.0`)
--
--   Catalog: products 111 -> 113, offers 114 -> 116, assessments 313 -> 319.
--   Applied 9 statements / 18 rows; a second apply wrote 0 rows.
--
--   Full golden suite (`node scripts/eval-scenarios.js
--   --model=launch-v2@2.4.0 --no-volatile`), against the pre-seed run seed 024
--   records in its own header:
--
--     before   86 rows   76 PASS / 5 EXPECTED-RED / 4 HARD FAIL / 1 UNKNOWN
--     after    86 rows   79 PASS / 3 EXPECTED-RED / 3 HARD FAIL / 1 UNKNOWN
--
--   No row moved PASS -> FAIL, and three moved FAIL -> PASS: A5 | S10,S11
--   (seed 024 had converged them on one build), A1 | S06 2 -> 3 pairs, and
--   A3 | S04,S15. The three remaining HARD FAILs are ALL pre-existing and
--   none belongs to this batch: both A2 rows sit at a 0.793 spend ratio at
--   30 000 MAD (seed 024) and A10 | S18 is seed 023s third OFFICE archetype
--   awaiting re-approval. No assertion or threshold was edited to reach this
--   result - each of those four rows needs a reviewer, not a number change.
--
--   S06 (GAMING 1440p 12000) ATTRIBUTED, not inferred: all three selected
--   builds pair the Arc B580 with a different CPU -
--     Ryzen 9 5950X  11995 MAD
--     Ryzen 5 5500   11645 MAD
--     Ryzen 9 5900X  11995 MAD
--   so the third pair is CPU breadth that only fits because the GPU floor
--   fell by 2601 MAD, and the rank-1 GPU price (A2b) is 3299. Before this
--   seed the same query found 2 pairs, because the cheapest 1440p card was
--   5900. S09 (2160p 30000) is unchanged in kind:
--     RTX 5080 16 GB 15900 + i7-12700KF   28194 MAD
--     RTX 5070 Ti 16 GB 11500 + i7-12700KF 23794 MAD
--     RTX 5070 Ti 16 GB 11500 + Ryzen 9 5950X 22546 MAD
--
--   A5 and A10 were measured for S06 and S09, which the manifest does not
--   cover at either resolution (A2 is covered by the S06-S08 series, which
--   fails only at 30 000 MAD at 0.793, the seed-024 shape). Throwaway
--   instrumented probe, marked rows removed in FK order, residue 0: both
--   scenarios return [PERFORMANCE, BALANCED, VALUE] at priorities 3 and 5
--   and [VALUE, PERFORMANCE, BALANCED] at priority 1, with ZERO reason
--   codes, and their priority-1 rank-1 build is cheaper than priority-5
--   (S06 11445 < 11995, S09 22546 < 23794) with different signatures - A5
--   holds at both resolutions although it is only declared at 1080p.
--
--   VALUE archetype check (the B580 now holds the joint-top VALUE 74):
--   S06 selects all three archetypes, so the clamp did not collapse the
--   set, and no reason code reports a missing VALUE candidate.
---- SCOPE AND SAFETY
--
--   * DML only, catalog rows only, and idempotent: every insert is guarded by
--     NOT EXISTS on its natural key, so a second apply writes 0 rows.
--   * TEST-branch first, and applied there ALONE. Like every file in this
--     folder it has NO branch awareness: `run-seeds.js` executes it against
--     whatever `DATABASE_URL` names. Pointing that at shared or EU is a
--     deliberate catalogue decision, not something this file does by itself.
--   * Re-checked after the apply: `check-deferred-rules.js`,
--     `check-og01-coverage.js --strict`, `check-offer-provenance.js`, and the
--     scenario harness (this batch changes which GPUs clear 1440p, so the
--     budget-sensitive rows are the ones to re-measure).
-- ============================================================================

BEGIN;

-- 1/6 Families (2 new).
INSERT INTO product_family (name, manufacturer_id)
SELECT v.name, m.id
FROM (VALUES
    ('Seed Intel Arc B580',          'Intel'),
    ('Seed GIGABYTE Radeon RX 9070', 'Gigabyte')
) AS v(name, mfr)
JOIN manufacturer m ON m.name = v.mfr
WHERE NOT EXISTS (SELECT 1 FROM product_family pf WHERE pf.name = v.name);

-- 2/6 GPU chipsets (2). Neither name exists: the catalog held only NVIDIA
-- chipsets plus a single AMD 'Radeon RX 9060 XT'. B580 is 12 GB on a 192-bit
-- bus (PCIe 4.0 x8); the RX 9070 is 16 GB on 256-bit (PCIe 5.0 x16).
INSERT INTO gpu_chipset (manufacturer_id, name, vram_capacity_gb, vram_type,
    memory_bus_width_bit, pcie_interface, base_tgp_watts)
SELECT m.id, v.name, v.vram, v.vtype, v.bus, v.pcie, v.tgp
FROM (VALUES
    ('Arc B580',       'Intel', 12, 'GDDR6', 192, 'PCIe 4.0 x8',  190),
    ('Radeon RX 9070', 'AMD',   16, 'GDDR6', 256, 'PCIe 5.0 x16', 220)
) AS v(name, mfr, vram, vtype, bus, pcie, tgp)
JOIN manufacturer m ON m.name = v.mfr
WHERE NOT EXISTS (SELECT 1 FROM gpu_chipset gc WHERE gc.name = v.name);

-- 3/6 Products (2).
INSERT INTO product (product_family_id, manufacturer_id, name, lifecycle_status)
SELECT pf.id, m.id, v.name, 'ACTIVE'
FROM (VALUES
    ('Seed Intel Arc B580 12 GB',                    'Seed Intel Arc B580',          'Intel'),
    ('Seed GIGABYTE Radeon RX 9070 16 GB GAMING OC', 'Seed GIGABYTE Radeon RX 9070', 'Gigabyte')
) AS v(name, family, mfr)
JOIN product_family pf ON pf.name = v.family
JOIN manufacturer m ON m.name = v.mfr
WHERE NOT EXISTS (SELECT 1 FROM product p WHERE p.name = v.name);

-- 4/6 Product variants (2). GPU is the variant-keyed category: the board spec
-- hangs off the variant, not the product.
INSERT INTO product_variant (product_id, sku, variant_type, support_status)
SELECT p.id, v.sku, 'STANDARD', 'ACTIVE'
FROM (VALUES
    ('Seed Intel Arc B580 12 GB',                    'SEED-INTEL-ARCB580-12'),
    ('Seed GIGABYTE Radeon RX 9070 16 GB GAMING OC', 'SEED-GB-RX9070-GAMINGOC')
) AS v(pname, sku)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (SELECT 1 FROM product_variant pv WHERE pv.sku = v.sku);

-- 5/6 Board specs (2). The case rule reads length_mm/width_slots and the PSU
-- rule reads recommended_psu_watts/connectors, so these are the columns that
-- make the two new cards actually assemblable.
INSERT INTO gpu_board_spec (product_variant_id, gpu_chipset_id, board_tgp_watts,
    length_mm, width_slots, height_mm, required_power_connectors,
    recommended_psu_watts)
SELECT pv.id, gc.id, v.tgp, v.len, v.slots, v.height, v.conn::jsonb, v.psu
FROM (VALUES
    ('SEED-INTEL-ARCB580-12',          'Arc B580',       190, 272, 2.00, 44, '{"pcie_8pin": 1}', 600),
    ('SEED-GB-RX9070-GAMINGOC',        'Radeon RX 9070', 220, 288, 2.50, 50, '{"pcie_8pin": 2}', 750)
) AS v(sku, chipset, tgp, len, slots, height, conn, psu)
JOIN product_variant pv ON pv.sku = v.sku
JOIN gpu_chipset gc ON gc.name = v.chipset
WHERE NOT EXISTS (SELECT 1 FROM gpu_board_spec b WHERE b.product_variant_id = pv.id);

-- 6/6 Offers (2) + assessments (2 x 3) in one section each below.
-- The offer carries the VARIANT id, which is the shape every GPU offer row in
-- this catalog already has (all of them point at a variant, unlike the
-- CPU/motherboard rows whose offers are product-level).
INSERT INTO store_offer (store_id, product_id, product_variant_id, price,
    currency, availability, seller_name, product_url, last_checked_at)
SELECT st.id, p.id, pv.id, v.price, 'MAD', 'IN_STOCK', NULL, NULL, NOW()
FROM (VALUES
    ('Seed Intel Arc B580 12 GB',                    'Seed UltraPC',   3299),
    ('Seed GIGABYTE Radeon RX 9070 16 GB GAMING OC', 'Seed NextGamer', 10900)
) AS v(pname, sname, price)
JOIN product p ON p.name = v.pname
JOIN product_variant pv ON pv.product_id = p.id
JOIN store st ON st.name = v.sname
WHERE NOT EXISTS (
    SELECT 1 FROM store_offer o
    WHERE o.store_id = st.id AND o.product_id = p.id
      AND o.product_variant_id = pv.id AND o.currency = 'MAD'
);

-- Assessments (2 x 3). GPU requires PERFORMANCE / QUALITY / VALUE under
-- launch-v2@2.4.0's role_weights.
INSERT INTO component_assessment (product_id, assessment_type, score, rating,
    summary, rationale, confidence, source_type, assessed_at)
SELECT p.id, v.atype::assessment_type, v.score, v.rating, v.summary,
    v.rationale, v.conf::confidence_level, v.stype::source_type, NOW()
FROM (VALUES
    ('Seed Intel Arc B580 12 GB', 'PERFORMANCE', 85, 'Good',
     'Intel Arc B580 12 GB; 24.4 percent of RTX 5090, a tie with the RTX 4060',
     'Chain 24.4 percent of RTX 5090 -> 85 + 10*log(24.4/24.6)/log(100/24.6) = 84.94 -> 85, the same mark the incumbent RTX 4060 carries at 24.6. Stated plainly: this card is a PERFORMANCE TIE with the 4060, and the only thing it adds is 4 GB of VRAM plus 1440p eligibility at a 3299 MAD price',
     'MEDIUM', 'COMMUNITY'),
    ('Seed Intel Arc B580 12 GB', 'QUALITY', 70, 'Good',
     'Intel Limited Edition, 272 mm dual-slot, 190 W, one 8-pin',
     'Board and cooler are first-tier reference quality - that alone would put it in the 72-75 AIB band. Held at 70, BELOW every incumbent GPU row, for the two facts a spec sheet cannot show: driver maturity in older titles and weaker resale than an NVIDIA part of the same speed. Deliberately not rounded up to fit the range',
     'MEDIUM', 'COMMUNITY'),
    ('Seed Intel Arc B580 12 GB', 'VALUE', 74, 'Good',
     'Index 24.4/3299 = 0.00740 against a batch best of 0.00651; clamps to 74',
     'VALUE = 50 + 24*(0.0073962/0.0065107) = 77.26, CLAMPED to the catalog ceiling 74 - the ratio is 1.136x the batch best (5060 Ti 8 GB at 5299), i.e. off the end of the incumbent value scale, and no GPU row in this catalog exceeds 74. It is also the cheapest 1440p-eligible card in the catalog by 2601 MAD. LOW confidence: the 3299 MAD price is seed-class (OG-37)',
     'LOW', 'RETAILER'),

    ('Seed GIGABYTE Radeon RX 9070 16 GB GAMING OC', 'PERFORMANCE', 90, 'Good',
     'Radeon RX 9070 16 GB; 49.3 percent of RTX 5090, between the 5070 and 5070 Ti',
     'Chain 49.3 percent of RTX 5090 -> 85 + 10*log(49.3/24.6)/log(100/24.6) = 89.96 -> 90. It sits 5.5 points below the 5070 Ti (57.5 -> 91) and 1 above the 5070 (44.6 -> 89), and its price sits between theirs too - the row is consistent with both neighbours, which is the point of adding it next to a 11500 MAD 5070 Ti',
     'MEDIUM', 'COMMUNITY'),
    ('Seed GIGABYTE Radeon RX 9070 16 GB GAMING OC', 'QUALITY', 76, 'Good',
     'GIGABYTE GAMING OC triple-fan, 288 x 132 x 50 mm, 220 W, two 8-pin',
     'Anchor GIGABYTE GAMING OC 74-78 by die: same OC line and triple-fan cooler at a 220 W envelope, so it sits between the 5070 GAMING (74) and the 5080 GAMING OC (78) at 76 - a cooler sized for more than this die, which is why it is not scored above the 5080',
     'MEDIUM', 'COMMUNITY'),
    ('Seed GIGABYTE Radeon RX 9070 16 GB GAMING OC', 'VALUE', 67, 'Good',
     'Index 49.3/10900 = 0.00452 against a batch best of 0.00651',
     'VALUE = 50 + 24*(0.0045229/0.0065107) = 66.67 -> 67 on the formula the 23 incumbent GPU rows carry. Not priced to beat the 5070 Ti at 11500 (VALUE 68, PERFORMANCE 91): it is 600 MAD cheaper for 1 performance point and a 4-point lower QUALITY score, so the two trade rather than one dominating. LOW confidence: the 10900 MAD price is seed-class (OG-37)',
     'LOW', 'RETAILER')
) AS v(pname, atype, score, rating, summary, rationale, conf, stype)
JOIN product p ON p.name = v.pname
WHERE NOT EXISTS (
    SELECT 1 FROM component_assessment a
    WHERE a.product_id = p.id AND a.assessment_type = v.atype::assessment_type
);

COMMIT;
