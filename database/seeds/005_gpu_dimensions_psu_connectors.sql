-- ===========================================================================
-- Seed 005: GPU dimension residue (OG-07) + PSU connector residue (OG-08)
--
-- Purpose: fills the fields seed 003 deliberately left NULL under its D4
-- identity rule, now that every one of those rows has been re-researched
-- (2026-10-04):
--   * gpu_board_spec.width_slots for SEED-GB-RTX5060-STD -> rule 9
--     GPU<->case thickness. This is the ONLY OG-07 row whose value
--     resolved; the other six stay NULL with per-row reasons in D2.
--   * psu_spec.connector_eps_count for Seed MSI MAG A750GL PCIE5 750W.
--   * psu_spec connector counts for Seed Antec G850 850W Gold (all four).
--     2 of the 4 OG-08 rows stay NULL (D3).
--
-- Scope: EXACTLY the rows named below; no other product, variant or spec
-- row is touched. height_mm is NOT written for any row (see D1).
--
-- Conventions (identical to 002/003):
--   * DML only, no DDL. Single BEGIN/COMMIT: all-or-nothing per run.
--   * Idempotent: every column is written through
--     COALESCE(<existing column>, <researched value>), so a NULL is filled,
--     an existing non-NULL value is never overwritten, and a second run
--     changes zero rows. A later CORRECTION to a value this file wrote must
--     be a new seed file: this file never rewrites what it (or anyone else)
--     already stored.
--   * NULL means UNKNOWN. A missing value is never replaced by a plausible
--     one, and 0 is never substituted for NULL (003 D5).
--   * ASCII only; per-row trailing SQL comments carry the source.
--
-- DELIBERATE DECISIONS (recorded so they stay auditable):
--
--   D1. PER-COLUMN VALUE DETERMINACY (refines 003 D4 for width_slots only).
--       003 D4 seeded width_slots/height_mm only when the (brand, model
--       line, stored length) triple selected exactly ONE published model.
--       This seed keeps that full rule for height_mm but fills width_slots
--       when the VALUE is invariant across every candidate model: every
--       published model of the same brand + chipset whose length is within
--       +/-2 mm of the stored length publishes the SAME thickness. Rule 9's
--       verdict is then identical under every candidate, so nothing is
--       guessed - the model stays unidentified, the thickness does not.
--       SEED-GB-RTX5060-STD (002 stored length 280 mm): FIVE GIGABYTE
--       RTX 5060 models sit at 281 mm (|280-281| = 1 <= 2) - GAMING OC,
--       GAMING, EAGLE MAX OC, AERO OC and GAMING OC V2 - and all five
--       publish 40 mm thickness / 2 slot (gpus.se RTX 5060 model table:
--       281 x 115-119 x 40 for all five; LDLC corroborates GAMING OC
--       281x126x40 and EAGLE MAX OC 281x115x40; pcspecchart corroborates
--       GAMING OC at 2.0 slots). 003's 2026-09 research saw only two of
--       these candidates ("281 mm selects two models"); the five share the
--       same thickness either way, which is the point of this decision.
--       Rounding per 003 D2: 40 / 20.32 = 1.969 -> 2.00.
--       Heights DIFFER across the candidates (115 / 117 / 119), so
--       height_mm STAYS NULL under the unchanged D4 rule. (height_mm is
--       not read by the engine today - GPU_VARIANT_SPEC_SQL does not
--       select it - so NULL costs nothing.)
--       Note: 003's D4 note quoted "281 mm" for this row; 002 stored 280,
--       which is inside the +/-2 mm tolerance either way.
--
--   D2. THE SIX OG-07 ROWS THAT STAY NULL after re-research. Each is
--       researched, not unexplored; the reason is identity or source
--       conflict, never "no time":
--       * SEED-GB-RTX5070-STD (stored 265): no GIGABYTE RTX 5070 exists
--         near 265 - WINDFORCE OC SFF 282, EAGLE OC SFF / EAGLE OC ICE
--         SFF 290 (003 research + e-catalog comparison), GAMING OC 336
--         (GIGABYTE's own "Card Dimensions (L x H x W) 336 x 144 x 75 mm"
--         mirrored on gigabyte.comx.co.za), AORUS MASTER ~363.
--       * SEED-MSI-RTX5060TI8-VENTUS2X (stored 242): EVERY MSI RTX 5060
--         Ti 8GB VENTUS 2X variant is 227 mm - gpus.se (VENTUS 2X PLUS
--         and VENTUS 2X OC PLUS: 227 x 126 x 41) and Scan UK (LN158382,
--         manufacturer code "RTX 5060 Ti 8G VENTUS 2X OC PLUS",
--         GTIN 4711377338868: 227 x 127 x 41). 242 mm matches the 16GB
--         VENTUS 2X length instead, so the stored row mixes an 8GB name
--         with a 16GB-class length and cannot be identified. 003's
--         "published 227 vs stored 242" stands, now with four sources.
--       * SEED-PNY-RTX5060-STD (stored 245): no PNY RTX 5060 publishes at
--         245 - Dual Fan 200, Overclocked Dual Fan 200 or 280 (gpus.se vs
--         pcspecchart disagree with each other but never say 245), Triple
--         Fan ARGB OC 280 (pny.com's own models page), Single Fan ~125.
--         003's cited "Dual Fan 200 x 120 x 40" stands.
--       * SEED-PNY-RTX5080-STD (stored 300): pny.com's own 5080 models
--         page publishes Card Dimensions 12.94 x 5.42 x 2.35 in
--         (~329 x 138 x 60 mm, 3 slot) for its triple-fan 5080s, agreeing
--         with 003's recorded "Triple Fan / ARGB 329"; TechPowerUp's
--         "300 mm" entries for two PNY 5080s conflict with the vendor's
--         own figure. Source conflict -> identity not established.
--       * SEED-ZOT-RTX5080-STD (stored 245): the shortest ZOTAC RTX 5080
--         published anywhere is SOLID CORE at 303.5 mm (gpus.se full
--         table; SOLID 329.7, AMP Extreme INFINITY 332.1). Nothing near
--         245. 003's finding stands, now with the full lineup.
--       * SEED-ASR-RX9060XT16-STD (stored 303): ASRock 16GB sources
--         conflict on BOTH axes - length 298 (gpus.se, tech-gaming review,
--         003) vs 304 (TechPowerUp/techspot, Overclockers UK), and
--         thickness 41 vs 51 mm (=> 2.00 vs 2.50 slots). Challenger 249
--         and Challenger Pro 290 are out of range under either reading;
--         the only in-range reading is source-dependent and the slot
--         VALUE itself is not determinate -> NULL.
--
--   D3. PSU identity + counts (OG-08).
--       * MSI MAG A750GL PCIE5 750W: connector_eps_count = 1. Sources:
--         TechPowerUp PSU database (connector list "1x 12V-2x6,
--         3x 6+2-pin PCIe, 8x SATA, 2x 4-pin Peripheral, 1x EPS,
--         1x ATX-24") + Nikas' Parts review spec table ("1x EPS
--         (4+4 pin)"). 003 already filled the other three columns.
--       * Seed Antec G850 850W Gold: the catalog row is 80 PLUS Gold,
--         NON_MODULAR, 140 mm, named "G850". Three Antec 850W Gold units
--         can be confused; the recorded fields separate them:
--           - "G850" (antec.com/product/power/g850-850 - Gold, ATX 3.1):
--             name-exact match; its spec table reads ATX 1, EPS 2,
--             PCI-E 6, SATA 8, Peripheral 2, 12VHPWR 0, length 140.
--           - "Atom G850" is Semi-Modular (comx, laptopdirect, progenix,
--             mctech, rebelgaming, titan-ice) -> EXCLUDED by the
--             catalog's NON_MODULAR. It publishes the same connector
--             counts anyway (antec.com/product/power/atom-g850).
--           - "GSK850" is Fully Modular with 1x12VHPWR, 2x CPU (EPS),
--             4x PCIe, 8x SATA (comx.co.za spec sheet, skycomp) ->
--             EXCLUDED by NON_MODULAR. This is exactly the ambiguity
--             003 D7 recorded ("GSK ATX 850 = one 12VHPWR"); modularity
--             settles it, and the GSK reading never reaches the data.
--         Result: eps 2, pcie_8pin 6, 12vhpwr 0, sata 8. The 0 is a
--         VERIFIED zero taken from the manufacturer's own connector
--         table - stronger than 003 D5's "list omits it" test - so a
--         12vhpwr requirement resolves FAIL GPU_PSU_CONNECTOR_UNAVAILABLE
--         (a real deficit) instead of Decision 26's NULL escalation.
--       * Seed Connect PSU 850 Bronze + Seed HYBROK PSU 650 Bronze: STAY
--         NULL across all four columns, with stated reason. Both brands
--         exist in the Moroccan/North-African retail the catalog came
--         from - Connect PSU 850: techspace.ma, pcgamer.ma, progear.ma,
--         ultrapc.ma, inksolutions.ma (EAN 760122791711; 850W; 80 PLUS
--         Bronze; Non-modular - matching the catalog row); HYBROK 650W
--         Bronze: upscalemedia-dz, click-dz (model PSU650WB,
--         EAN 3722104523243), qsnet.tn, pcgamer.ma - but NOT ONE listing
--         publishes connector counts: wattage, efficiency, modularity
--         and dimensions only, and the one distributor sheet found
--         (click-dz) stops before the connector block. No citable source
--         exists, so the columns stay NULL rather than plausible.
--
--   D4. EXPECTED ENGINE EFFECT (measured read-only after apply):
--       * Rule 9 (compatibility/gpu.js resolveGpuCaseThickness):
--         SEED-GB-RTX5060-STD vs all 10 cases flips
--         UNKNOWN (GPU_DIMENSIONS_UNKNOWN) -> PASS, because every case
--         publishes max_gpu_thickness_slots = 3 and 2.00 <= 3.
--       * Rule 11 (compatibility/gpu.js resolveGpuPsuConnectors):
--         - the 9 pcie_8pin GPUs (8 requiring 1x, 1 requiring 2x) vs the
--           Antec G850: UNKNOWN -> PASS (1,2 <= 6);
--         - the 13 {12vhpwr:1} GPUs vs the Antec G850: all 13 are
--           >= 200 W-TGP boards, so they were already FAIL via
--           GPU_PSU_CONNECTOR_NULL_HIGH_TGP (Decision 26); they stay FAIL
--           but the reason upgrades to GPU_PSU_CONNECTOR_UNAVAILABLE
--           (verifiable 0 < 1 deficit). No verdict flips the other way.
--         - connector_eps_count feeds no GPU-side requirement (GPUs never
--           require eps), so the A750GL fill is data completion, not a
--           verdict change.
--       * build-local unknown_pairwise_count (Decision 23 O2) drops by one
--         for every pair that leaves UNKNOWN as above.
--
-- ===========================================================================
-- Post-apply expectations (read-only sanity check):
--   * gpu_board_spec: rows with NULL width_slots 7 -> 6; NULL height_mm
--     stays 7 (no row gets a height in this file).
--   * psu_spec: rows with ANY NULL connector count 4 -> 2 (Antec G850 and
--     the A750GL leave the NULL set; Connect and HYBROK stay).
--     Per column: NULL eps 4 -> 2, NULL pcie_8pin 3 -> 2,
--     NULL 12vhpwr 3 -> 2 (Antec 0 replaces NULL), NULL sata 3 -> 2.
--   * Re-running this file changes nothing (COALESCE guards).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. gpu_board_spec: ONE row (SEED-GB-RTX5060-STD) gets width_slots = 2.00.
--    height_mm stays NULL for every row (D1). The other six NULL-dimension
--    rows are deliberately absent from this file (D2).
--    Source: gpus.se RTX 5060 model table + LDLC (D1).
-- ---------------------------------------------------------------------------
UPDATE gpu_board_spec b
   SET width_slots = COALESCE(b.width_slots, v.w)
  FROM (VALUES
    -- 5 candidate models @281mm all publish 40mm / 2-slot (D1):
    -- 40 / 20.32 = 1.969 -> 2.00 per 003 D2 rounding
    ('SEED-GB-RTX5060-STD', 2.00)
  ) AS v(sku, w)
  JOIN product_variant pv ON pv.sku = v.sku
 WHERE b.product_variant_id = pv.id;

-- ---------------------------------------------------------------------------
-- 2. psu_spec: TWO rows.
--    A750GL: eps only (the other three columns were filled by 003).
--    Antec G850: all four columns (D3, antec.com G850 spec table).
--    The other two NULL rows are deliberate (D3): the COALESCE guards leave
--    Connect and HYBROK exactly as 002 stored them.
-- ---------------------------------------------------------------------------
UPDATE psu_spec s
   SET connector_eps_count = COALESCE(s.connector_eps_count, v.eps::integer),
       connector_pcie_8pin = COALESCE(s.connector_pcie_8pin, v.pcie8::integer),
       connector_12vhpwr   = COALESCE(s.connector_12vhpwr,   v.hvpwr::integer),
       connector_sata      = COALESCE(s.connector_sata,      v.sata::integer)
  FROM (VALUES
    -- TechPowerUp PSU database + Nikas' Parts: 1x EPS (4+4) (D3)
    ('Seed MSI MAG A750GL PCIE5 750W', 1, NULL::integer, NULL::integer, NULL::integer),
    -- antec.com/product/power/g850-850 (Gold, ATX 3.1): EPS 2, PCI-E 6,
    -- 12VHPWR 0 (verified zero), SATA 8 (D3)
    ('Seed Antec G850 850W Gold', 2, 6, 0, 8)
  ) AS v(name, eps, pcie8, hvpwr, sata)
  JOIN product p ON p.name = v.name
 WHERE s.product_id = p.id;

COMMIT;



