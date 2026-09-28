-- ===========================================================================
-- Seed 003: GPU/PSU connector & dimension data
--
-- Purpose: fills the fields seed 002 deliberately left NULL (its header
-- decision D6) so that the two remaining live rules can fire:
--   * gpu_board_spec.required_power_connectors  -> rule 11 GPU<->PSU connectors
--   * gpu_board_spec.width_slots / height_mm    -> rule 9 GPU<->case thickness
--   * psu_spec connector_eps_count / _pcie_8pin / _12vhpwr / _sata
--     -> the PSU side of rule 11
--
-- Scope (Decision 23 / O1): EXACTLY the 20 GPU variants added by
-- 002_catalog_expansion.sql and the 9 PSUs added by the same file.
-- 001_minimal_builds.sql rows are neither read nor written; no other
-- product, variant or spec row is touched.
--
-- Conventions (identical to 001/002):
--   * DML only, no DDL. Single BEGIN/COMMIT: all-or-nothing per run.
--   * Idempotent: every column is written through
--     COALESCE(<existing column>, <researched value>), so a NULL is filled,
--     an existing non-NULL value is never overwritten, and a second run
--     changes zero rows. A later CORRECTION to a value this file wrote must
--     be a new seed file: this file never rewrites what it (or anyone else)
--     already stored.
--   * NULL means UNKNOWN. A missing value is never replaced by a plausible
--     one, and 0 is never substituted for NULL (see D5).
--   * ASCII only, one trailing SQL comment per row carrying the published
--     figure the value was derived from.
--
-- DELIBERATE DECISIONS (recorded so they stay auditable):
--
--   D1. CONNECTOR VOCABULARY (002 D6, verbatim). The engine's connector
--       vocabulary is the fixed set in
--       src/recommendation/compatibility/gpu.js:
--         KNOWN_CONNECTORS = {24pin_atx, eps, pcie_8pin, 12vhpwr, sata}
--       Research "8-pin (6+2) PCIe" -> pcie_8pin; "12VHPWR" / "12V-2x6" /
--       "16-pin" -> 12vhpwr; "8-pin (4+4) EPS/CPU" -> eps. A connector name
--       outside that set is NEVER written: the resolver treats an unknown
--       required name as UNKNOWN for the whole rule, so writing one would
--       destroy the verdict rather than record it. Counts are positive
--       integers only: normalizeRequiredConnectors drops zero entries, so
--       "requires none of X" is expressed by OMISSION, never by 0.
--
--   D2. width_slots CONVENTION. Published card thickness in mm / 20.32,
--       rounded to the nearest 0.5 (the repository's gpu_board_spec
--       width_slots is NUMERIC(4,2), so 0.5 steps are expressible).
--       Vendor-published slot claims are mutually inconsistent and therefore
--       unusable as a shared scale: ASUS states 72 mm = "3.6 Slot", a major
--       US retailer states the same 70 mm card as "Quad Slot", and one
--       reseller states 49 mm as "2.2-Slot" (the same physical class another
--       vendor states as 2.5). The mm figure is the only vendor-neutral fact,
--       so every value below is (published mm) / 20.32 rounded to 0.5:
--         40-41.6 mm -> 2.00   48-50 mm -> 2.50   70-72 mm -> 3.50
--       Expected consequence (see D9): 3.50-slot cards FAIL the thickness
--       rule against every case in the current pool, because 002 seeded all
--       8 of its new cases as max_gpu_thickness_slots = 3.
--
--   D3. CONFLICT POLICY (002 D7 applies). Where the catalog/research length
--       already stored in gpu_board_spec and the vendor's published length
--       disagree, the stored value is NEVER rewritten here; the conflict is
--       flagged inline instead. One row conflicts:
--         SEED-MSI-RTX5080-VENTUS3X  stored 304 mm vs MSI 303 mm.
--       A <= 2 mm difference is treated as the same card (rounding /
--       measurement noise), not as a different SKU.
--
--   D4. IDENTITY RULE (the "never guess" rule, made mechanical). width_slots
--       and height_mm are seeded ONLY when BOTH hold:
--         (a) the (brand, model line, stored length_mm) triple selects
--             exactly ONE published model, and
--         (b) |stored length_mm - published length| <= 2 mm.
--       When either fails, the CONNECTOR is still seeded (it is uniform
--       across the model line and is what rule 11 consumes), and the two
--       dimension columns STAY NULL - never a nearest-candidate value, never
--       a plausible one. The 7 rows in that bucket, with the reason:
--         SEED-GB-RTX5060-STD           281 mm selects two models
--                                       (GAMING OC H=119 vs EAGLE MAX OC H=115)
--         SEED-MSI-RTX5060TI8-VENTUS2X  published VENTUS 2X is 227 mm,
--                                       stored 242 mm (15 mm apart)
--         SEED-GB-RTX5070-STD           stored 265 mm matches no model
--                                       (WINDFORCE SFF 282, EAGLE SFF 290)
--         SEED-PNY-RTX5060-STD          stored 245 mm matches no model
--                                       (Dual Fan 200 mm)
--         SEED-PNY-RTX5080-STD          stored 300 mm matches no model
--                                       (Triple Fan / ARGB 329 mm)
--         SEED-ZOT-RTX5080-STD          stored 245 mm matches no model
--                                       (SOLID CORE 303.5, SOLID 329.7)
--         SEED-ASR-RX9060XT16-STD       stored 303 mm matches no model
--                                       (Steel Legend 298, Challenger 249)
--       Re-identifying these 7 cards from the original Morocco catalog /
--       companion source and filling their dimensions is a LATER item; no
--       value here is guessed in the meantime.
--
--   D5. NULL vs 0 (the engine depends on this distinction). For the psu_spec
--       connector columns, 0 and NULL are different answers:
--         * 0    = "this PSU verifiably has none" -> a required connector
--                  resolves FAIL (GPU_PSU_CONNECTOR_UNAVAILABLE).
--         * NULL = "unverified" -> that connector resolves UNKNOWN
--                  (GPU_PSU_CONNECTOR_UNKNOWN), and one UNKNOWN required
--                  connector makes the whole rule UNKNOWN even when another
--                  connector is provably deficient.
--                  DECISION 26 amendment (2026-09-28): on a HIGH-TGP board
--                  (`gpu_board_spec.board_tgp_watts >= 200`) the NULL case is
--                  now FAIL `GPU_PSU_CONNECTOR_NULL_HIGH_TGP`, decided BEFORE
--                  the unknown-name branch - 39 live (GPU, PSU) pairs flip
--                  UNKNOWN -> FAIL. The 0-vs-NULL semantics above are
--                  unchanged. Comment only: no data change, do NOT re-apply
--                  this seed for it.
--       Therefore a 0 is written ONLY where a manufacturer's own connector
--       list omits that connector (today: Seed MSI MAG A650BN 650W, whose
--       published list stops at PCI-E 6+2 pin x2), and NULL is kept
--       everywhere the absence could not be verified from a citable source.
--
--   D6. NO ADAPTER MODELLING. Several GeForce RTX 50-series boxes ship a
--       12V-2x6 -> 3x 8-pin adapter cable. That adapter is NOT a PSU power
--       connector requirement: rule 11 compares per-connector counts with no
--       fallback and no adapter logic (compatibility/gpu.js), so every card
--       whose board takes a 16-pin connector is recorded as {"12vhpwr": 1}
--       regardless of what was in the box. This is what makes D5's 0 a live
--       FAIL rather than an UNKNOWN.
--
--   D7. UNVERIFIED PSUs STAY NULL. Three of the 9 PSUs cannot be sourced to
--       the standard required, so their connector columns are written as
--       NULL (the COALESCE guard leaves them untouched, unchanged from 002):
--         * Seed HYBROK PSU 650 Bronze  - no manufacturer page exists and no
--           listing publishes connector counts (regional dealer pages only).
--         * Seed Connect PSU 850 Bronze - same; the only page found describes
--           the connector types without a single count.
--         * Seed Antec G850 850W Gold  - AMBIGUOUS model. Antec's "Atom G850"
--           is semi-modular with NO 16-pin connector, while Antec's
--           "GSK ATX 850" is fully modular WITH one 12VHPWR. Those two
--           candidates disagree on connector_12vhpwr (0 vs 1), which is
--           precisely the value rule 11 consumes, and 002 stores modularity
--           NON_MODULAR (matching Atom G850, contradicting the name). All
--           four columns stay NULL until the SKU is pinned.
--       Seed MSI MAG A750GL PCIE5 750W is seeded PARTIALLY for the same
--       reason: msi.com returns HTTP 403 to automated fetches, so
--       connector_eps_count stays NULL while the three columns that a major
--       retailer plus the MSI manual do state are filled in.
--
--   D8. SOURCES (manufacturer spec page, or a major retailer / certification
--       lab where the manufacturer page is unavailable or blocks fetching):
--         MSI RTX 5070 12G VENTUS 2X OC
--           msi.com/Graphics-Card/GeForce-RTX-5070-12G-VENTUS-2X-OC/Specification
--         MSI RTX 5060 8G VENTUS 2X OC
--           msi.com/Graphics-Card/GeForce-RTX-5060-8G-VENTUS-2X-OC/Specification
--         MSI RTX 5080 16G VENTUS 3X OC
--           msi.com/Graphics-Card/GeForce-RTX-5080-16G-VENTUS-3X-OC/Specification
--           (datasheet: storage-asset.msi.com/datasheet/vga/...-VENTUS-3X-OC.pdf)
--         GIGABYTE RTX 5080 GAMING OC 16G
--           gigabyte.com/Graphics-Card/GV-N5080GAMING-OC-16GD/sp
--         GIGABYTE RTX 5060 8G (candidates for the stored length)
--           GV-N5060GAMINGOC-8GD and GV-N5060EAGLEMAX-OC-8GD (both 281 mm)
--         MSI RTX 5060 Ti 8G/16G VENTUS 2X OC PLUS
--           msi.com/Graphics-Card/GeForce-RTX-5060-Ti-8g-VENTUS-2X-OC-PLUS/Specification
--         GIGABYTE RTX 5070 12G (candidates for the stored length)
--           gigabyte.com/Graphics-Card/GV-N5070WF3OC-12GD/sp (282 mm)
--           GV-N5070EAGLE-OC-12GD (290 mm)
--         MSI RTX 5070 12G GAMING TRIO OC
--           msi.com/Graphics-Card/GeForce-RTX-5070-12G-GAMING-TRIO-OC/Specification
--         MSI RTX 5070 Ti 16G VENTUS 3X OC
--           MSI datasheet (storage-asset.msi.com) + techpowerup.com GPU database
--         PNY RTX 5060 Ti 8GB Dual Fan
--           newegg.com N82E16814985015 + pny.com/geforce-rtx-5060-ti-8gb-models
--         ASUS TUF Gaming RTX 5090 32GB
--           asus.com/us/motherboards-components/graphics-cards/tuf-gaming/
--             tuf-rtx5090-32g-gaming/techspec/
--         GIGABYTE RTX 5070 EAGLE OC SFF 12G (GV-N5070EAGLE-OC-12GD)
--           GIGABYTE spec sheet as published by retail listings
--         PNY RTX 5060 8GB
--           pny.com/geforce-rtx-5060-8gb-models + newegg.com N82E16814133997
--         PNY RTX 5080 16GB
--           pny.com/geforce-rtx-5080-models
--         ZOTAC GAMING RTX 5060 Ti 16GB Twin Edge
--           zotac.com/product/graphics_card/
--             zotac-gaming-geforce-rtx-5060-ti-16gb-twin-edge
--         ZOTAC GAMING RTX 5080 16GB SOLID CORE OC
--           zotac.com/product/graphics_card/
--             zotac-gaming-geforce-rtx-5080-solid-core-oc
--         GIGABYTE RTX 5080 WINDFORCE OC SFF 16G
--           gigabyte.com/us/Graphics-Card/GV-N5080WF3OC-16GD/sp
--         ASRock Radeon RX 9060 XT Steel Legend 16GB OC
--           asrock.com/Graphics-Card/AMD/Radeon RX 9060 XT Steel Legend 16GB OC/
--         MSI RTX 5080 16G SHADOW 3X OC
--           msi.com/Graphics-Card/GeForce-RTX-5080-16G-SHADOW-3X-OC/Specification
--         ASUS PRIME RTX 5070 Ti 16GB OC Edition
--           asus.com/us/motherboards-components/graphics-cards/prime/
--             prime-rtx5070ti-o16g/techspec/
--         Corsair RM750e / RM850e / RM1000e (ATX v3.1 cable & connector tables)
--           cybenetics.com/evaluations/psus/2625, /2630, /2624
--         Antec CSK1000 PRO ATX3.1 1000W
--           antec.com/product/power/csk-pro-atx-3-1-1000
--         MSI MAG A650BN 650W
--           msi.com/Power-Supply/MAG-A650BN/Specification
--         MSI MAG A750GL PCIE5 750W
--           newegg.com N82E16817701022 + pcpartpicker.com + MSI PRO Series
--           user manual (download.msi.com/archive/mnu_exe/psu/...)
--         Antec G850 (ambiguity evidence: antec.com/product/power/gsk-atx-850
--           vs retailer listings of Antec Atom G850)
--
--   D9. EXPECTED ENGINE EFFECT (forward-looking, not enforced here). Of the
--       20 GPUs, 13 require 12vhpwr and 7 require only pcie_8pin. Against the
--       MAG A650BN (12vhpwr = 0) every one of those 13 becomes a live FAIL
--       (candidate REJECT) instead of UNKNOWN, and the two 3.50-slot cards
--       (ASUS TUF 5090, GIGABYTE 5080 GAMING OC) become incompatible with
--       every 3-slot case in the pool. HYBROK and Connect stay UNKNOWN and
--       therefore keep contributing unknown_compat_penalty; this file does
--       not, by itself, discharge Decision 23's O1 acceptance gate (the
--       GAMING/OFFICE re-measurement), which is its own measurement step:
--       scripts/measure-orchestrator.js preflights the full seed catalog
--       (100 Seed % products / 101 offers / 25 assessments) with 001+002+003
--       applied, then measures the two queries on a TEST_DATABASE_URL branch.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. gpu_board_spec (20 variant rows): required_power_connectors,
--    width_slots, height_mm.
--
--    Keyed by the SEED- SKUs used by 002. Each row carries the published
--    figure the derived value comes from. Rows whose dimensions are
--    deliberately NULL per D4 still list their connector (also see D4 for the
--    reason each dimension is missing).
-- ---------------------------------------------------------------------------
UPDATE gpu_board_spec b
   SET required_power_connectors = COALESCE(b.required_power_connectors, v.conn::jsonb),
       width_slots               = COALESCE(b.width_slots,               v.w::numeric(4,2)),
       height_mm                 = COALESCE(b.height_mm,                 v.h::integer)
  FROM (VALUES
    -- MSI 236 x 126 x 50 mm -> 50/20.32 = 2.46 -> 2.50
    ('SEED-MSI-RTX5070-VENTUS2X',     '{"12vhpwr": 1}',   2.50, 126),
    -- MSI 197 x 120 x 41 mm -> 41/20.32 = 2.02 -> 2.00
    ('SEED-MSI-RTX5060-VENTUS2X',     '{"pcie_8pin": 1}', 2.00, 120),
    -- MSI 303 x 121 x 49 mm -> 49/20.32 = 2.41 -> 2.50 (D3: stored 304 vs 303)
    ('SEED-MSI-RTX5080-VENTUS3X',     '{"12vhpwr": 1}',   2.50, 121),
    -- GIGABYTE L=340 W=140 H=70 mm -> 70/20.32 = 3.44 -> 3.50
    ('SEED-GB-RTX5080-GAMINGOC',      '{"12vhpwr": 1}',   3.50, 140),
    -- D4: 281 mm candidates differ in height (119 vs 115) -> dims stay NULL
    ('SEED-GB-RTX5060-STD',           '{"pcie_8pin": 1}', NULL, NULL),
    -- D4: published VENTUS 2X = 227 x 126 x 41 mm vs stored 242 mm -> NULL
    ('SEED-MSI-RTX5060TI8-VENTUS2X',  '{"pcie_8pin": 1}', NULL, NULL),
    -- D4: stored 265 mm matches no Gigabyte 5070 (282 / 290 mm) -> NULL
    ('SEED-GB-RTX5070-STD',           '{"12vhpwr": 1}',  NULL, NULL),
    -- MSI 338 x 140 x 50 mm -> 2.50
    ('SEED-MSI-RTX5070-GAMINGTRIO',   '{"12vhpwr": 1}',   2.50, 140),
    -- MSI 303 x 121 x 48 mm -> 48/20.32 = 2.36 -> 2.50
    ('SEED-MSI-RTX5070TI-VENTUS3X',   '{"12vhpwr": 1}',   2.50, 121),
    -- PNY 245 x 120 x 40 mm -> 1.97 -> 2.00
    ('SEED-PNY-RTX5060TI8-DUAL',      '{"pcie_8pin": 1}', 2.00, 120),
    -- ASUS 348 x 146 x 72 mm -> 72/20.32 = 3.54 -> 3.50 (ASUS states "3.6 Slot")
    ('SEED-ASUS-RTX5090-TUF',         '{"12vhpwr": 1}',   3.50, 146),
    -- GIGABYTE 290 x 120 x 50 mm -> 2.50
    ('SEED-GB-RTX5070-EAGLEOC',       '{"12vhpwr": 1}',   2.50, 120),
    -- D4: stored 245 mm matches no PNY 5060 (Dual Fan 200 x 120 x 40 mm) -> NULL
    ('SEED-PNY-RTX5060-STD',          '{"pcie_8pin": 1}', NULL, NULL),
    -- D4: stored 300 mm matches no PNY 5080 (Triple Fan/ARGB 329 mm) -> NULL
    ('SEED-PNY-RTX5080-STD',          '{"12vhpwr": 1}',  NULL, NULL),
    -- ZOTAC 220.5 x 120.25 x 41.6 mm -> 41.6/20.32 = 2.05 -> 2.00
    -- (ZOTAC's 220.5 mm was already rounded to the INTEGER length 221 in 002)
    ('SEED-ZOT-RTX5060TI16-TWINEDGE', '{"pcie_8pin": 1}', 2.00, 120),
    -- D4: stored 245 mm matches no ZOTAC 5080 (303.5 / 329.7 mm) -> NULL
    ('SEED-ZOT-RTX5080-STD',          '{"12vhpwr": 1}',  NULL, NULL),
    -- GIGABYTE RTX 5080 WINDFORCE OC SFF (GV-N5080WF3OC-16GD): gigabyte.com spec
    -- "Power Connectors 16 pin*1" (Recommended PSU 850W), 304 x 126 x 50 mm -> 2.50
    ('SEED-GB-RTX5080-STD',           '{"12vhpwr": 1}',   2.50, 126),
    -- D4: stored 303 mm matches neither ASRock model (298 / 249 mm) -> NULL
    ('SEED-ASR-RX9060XT16-STD',       '{"pcie_8pin": 1}', NULL, NULL),
    -- MSI 303 x 121 x 49 mm -> 2.50
    ('SEED-MSI-RTX5080-SHADOW3X',     '{"12vhpwr": 1}',   2.50, 121),
    -- ASUS 304 x 126 x 50 mm -> 2.50
    ('SEED-ASUS-RTX5070TI-PRIME',     '{"12vhpwr": 1}',   2.50, 126)
  ) AS v(sku, conn, w, h)
  JOIN product_variant pv ON pv.sku = v.sku
 WHERE b.product_variant_id = pv.id;

-- ---------------------------------------------------------------------------
-- 2. psu_spec (9 product rows): connector_eps_count, connector_pcie_8pin,
--    connector_12vhpwr, connector_sata.
--
--    connector_24pin_atx is already true for all 9 (002) and is not touched.
--    NULL rows are deliberate (D7): the COALESCE guard leaves the column
--    exactly as 002 stored it.
-- ---------------------------------------------------------------------------
UPDATE psu_spec s
   SET connector_eps_count = COALESCE(s.connector_eps_count, v.eps::integer),
       connector_pcie_8pin = COALESCE(s.connector_pcie_8pin, v.pcie8::integer),
       connector_12vhpwr   = COALESCE(s.connector_12vhpwr,   v.hvpwr::integer),
       connector_sata      = COALESCE(s.connector_sata,      v.sata::integer)
  FROM (VALUES
    -- Cybenetics RM1000e (ATX v3.1): 24-pin x1, 4+4 EPS x2, 6+2 PCIe 2+2,
    -- 12+2 PCIe (600W) x1, SATA 2+4
    ('Seed Corsair RM1000e 1000W',                      2,    4, 1, 6),
    -- Antec product page: 1 x 24(20+4); 1 x 16(12+4) PCIE 5.1 12V-2x6 (600W);
    -- 2 x 8(4+4) CPU; 4 x 8(6+2) PCI-E; 6 x SATA
    ('Seed Antec CSK1000 PRO EC ATX3.1 1000W Bronze',   2,    4, 1, 6),
    -- D7: model ambiguous (Antec Atom G850 = no 16-pin vs GSK ATX 850 = one
    -- 12VHPWR) -> all four stay NULL rather than guess the 12vhpwr answer
    ('Seed Antec G850 850W Gold',                    NULL, NULL, NULL, NULL),
    -- Cybenetics RM750e (ATX v3.1): 24-pin x1, 4+4 EPS x2, 6+2 PCIe 1+2,
    -- 12+2 PCIe (600W) x1, SATA 4+2
    ('Seed Corsair RM750e 750W',                        2,    3, 1, 6),
    -- Cybenetics RM850e (ATX v3.1): identical connector shape to the RM750e
    ('Seed Corsair RM850e 850W',                        2,    3, 1, 6),
    -- D7: msi.com blocks fetches (HTTP 403), so the CPU connector count is
    -- left NULL; the other three come from Newegg (3 x 8-pin VGA),
    -- PCPartPicker (PCIe 6+2 = 3, SATA = 8) and MSI's own manual (native
    -- 12V-2x6)
    ('Seed MSI MAG A750GL PCIE5 750W',               NULL,    3, 1, 8),
    -- MSI spec page: ATX (24 pin) 1; EPS (4+4 pin) 1; PCI-E (6+2 pin) 2;
    -- SATA (15 pin) 5. The published list contains no 16-pin, so this is the
    -- ONE verified zero in this file (D5): a 12vhpwr requirement now FAILs
    -- against this PSU instead of resolving UNKNOWN.
    ('Seed MSI MAG A650BN 650W',                        1,    2, 0, 5),
    -- D7: no manufacturer page and no listing publishes connector counts
    ('Seed HYBROK PSU 650 Bronze',                   NULL, NULL, NULL, NULL),
    -- D7: connector types only, never counts
    ('Seed Connect PSU 850 Bronze',                  NULL, NULL, NULL, NULL)
  ) AS v(name, eps, pcie8, hvpwr, sata)
  JOIN product p ON p.name = v.name
 WHERE s.product_id = p.id;

COMMIT;

-- ===========================================================================
-- Post-apply expectations (read-only sanity check):
--   * 20 GPU rows touched: 13 with required_power_connectors = {"12vhpwr": 1},
--     7 with {"pcie_8pin": 1}; 13 with width_slots/height_mm populated,
--     7 with both still NULL (D4).
--   * 9 PSU rows matched: 5 fully populated, 1 partially (A750GL: eps NULL),
--     3 all-NULL (Antec G850, HYBROK, Connect).
--   * Re-running this file changes nothing (COALESCE guards).
-- ===========================================================================
