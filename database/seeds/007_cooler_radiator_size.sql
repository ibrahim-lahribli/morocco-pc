-- ===========================================================================
-- Seed 007: per-cooler radiator size (OG-28)
--
-- Purpose: give the COOLER side of the case-radiator rule (rule 5) the one
-- value it needs. The CASE side is complete - all 10 of 10 cases carry a
-- case_radiator_support matrix since OG-05 closed - but cooler_spec had no
-- radiator-size column at all, so the context loader hardcoded
-- radiator_size_mm: null for every cooler. Rule 5 matches
-- `row.radiator_size_mm === radiator_size_mm`, and a NOT NULL integer never
-- equals null. The rule was implemented, wired and enforced; it simply could
-- never reach PASS. Every liquid cooler in a case that HAD a matrix was
-- returning UNKNOWN RADIATOR_SUPPORT_UNKNOWN, permanently, and no amount of
-- further case data could change that.
--
-- Schema: migration 013_cooler_radiator_size.sql adds the nullable
-- cooler_spec.radiator_size_mm column. THIS FILE IS DML ONLY and must be
-- applied AFTER 013; run-seeds.js applies seeds in filename order and does
-- not order them against migrations.
--
-- Scope: EXACTLY the 5 LIQUID coolers in this catalog. The 4 AIR coolers are
-- deliberately left NULL - an air cooler requires no radiator, the rule
-- returns PASS for it without ever reading a size, and NULL is the honest
-- representation of "not applicable". NULL is never coerced to 0
-- (AGENTS.md section 8: preserve NULL = UNKNOWN).
--
-- DATA AVAILABILITY (recorded because it shaped the work): radiator size is
-- RESEARCH, not a derivation. cooler_spec.length_mm is NOT a proxy for it -
-- it is close for some units (ML280 length_mm 317 vs a 318mm radiator) and
-- badly wrong for others (CORELIQUID 240R length_mm 274, MYSTIQUE 360
-- length_mm 402). Radiator size is the nominal 120/140/240/280/360 class the
-- vendor markets the unit in, which is exactly what case_radiator_support.
-- radiator_size_mm stores on the case side - so the two sides are now
-- directly comparable, which is the whole point.
--
-- SOURCES (every value transcribed from the manufacturer's own specification
-- page; each corroborated by at least one independent retailer or review, per
-- the 004b sourcing convention):
--
--   Seed Cooler Master MasterLiquid ML280 Mirror = 280
--     Cooler Master product page (legacy.coolermaster.com/en-global/products/
--     masterliquid-ml280-mirror/) and B&H's spec table ("280mm Radiator, 2 x
--     140mm Fans"); radiator 318 x 140 x 27.2mm per LANOC, thinkcomputers and
--     APH Networks. 318mm = two 140mm fans = the 280 class.
--
--   Seed Corsair Nautilus 240 RS ARGB Black AIO = 240
--     Corsair's own NAUTILUS RS / RS ARGB page ("available with 240mm or
--     360mm radiators", 240 radiator 276 x 120 x 27mm); B&H CW-9060092-WW
--     ("240mm Aluminum Radiator") and CentralComputer ("Radiator Size,
--     240mm"). Part CW-9060092-WW (black).
--
--   Seed DeepCool MYSTIQUE 360 Black AIO = 360
--     DeepCool's own product page for MYSTIQUE 360 (radiator 402 x 120 x
--     27mm, part R-AJ360 family); Geekawhat's spec table states "Radiator
--     Size, 360mm". 402mm = three 120mm fans = the 360 class.
--
--   Seed MSI MAG CORELIQUID 240R = 240
--     MSI's own MAG CORELIQUID 240R specification page (radiator 274 x 120 x
--     27mm, 2 fans); MSI lists "Radiator Size 240 mm" on the A13 240 sibling
--     and multiple retailers give 240mm for the 240R. 274mm = two 120mm.
--
--   Seed MSI MAG CoreLiquid A13 360 White AIO = 360
--     MSI's own MAG CORELIQUID A13 360 / WHITE specification page, which
--     states "Radiator Size 360 mm" and gives the radiator as
--     394 x 119.6 x 27.2mm. 394mm = three 120mm fans = the 360 class.
--
-- No value here is estimated or inferred, and none is NULL: all 5 liquid
-- coolers in the catalog publish a radiator size. (Contrast OG-27, where 4 of
-- the same 5 liquid coolers have a NULL height_mm - the vendor publishes a
-- pump height for some units and not others. That is a separate row and a
-- separate pass; it is deliberately NOT fixed here.)
--
-- MEASURED EFFECT (computed against the live case matrices BEFORE this file
-- was applied, over all 10 cases x 5 liquid coolers = 50 pairs):
--   43 pairs  UNKNOWN -> PASS
--    7 pairs  stay UNKNOWN (case has no row of that size; support is never
--             invented, so these remain UNKNOWN rather than becoming FAIL)
--    0 pairs  -> FAIL
-- The zero is structural, not lucky: rule 5 FAILs only on `liquid + ZERO
-- radiator rows`, and OG-05's closure guarantees every case has rows. So this
-- seed cannot reject a build that is currently accepted - UNKNOWN was already
-- eligible - and can only convert a permanent UNKNOWN into a real PASS.
-- Ranking effect: unknown_compat_penalty is 5 per build-local UNKNOWN pair,
-- so each retained liquid cooler was costing its builds 5 points.
--
-- The 7 pairs that stay UNKNOWN, by design:
--   ML280 (280)     x Fractal Pop XL            - only 240 and 360
--   ML280 (280)     x NZXT H5 Flow Compact      - only 240
--   ML280 (280)     x CORSAIR Frame 4000D Black - only 240 and 360
--   ML280 (280)     x CORSAIR Frame 4000D White - only 240 and 360
--   ML280 (280)     x MAG PANO 100R PZ Blanc    - 120, 240, 360
--   MYSTIQUE 360    x NZXT H5 Flow Compact      - only 240
--   A13 360         x NZXT H5 Flow Compact      - only 240
-- These are the cases whose matrix genuinely lacks a 280 or 360 mount, so the
-- honest answer is UNKNOWN. Turning them into FAIL would reject builds on
-- absence of evidence, which the engine's UNKNOWN policy exists to prevent.
--
-- Conventions (identical to 001/002/003/004a/004b/005/006):
--   * DML only, no DDL. Single BEGIN/COMMIT: all-or-nothing per run.
--   * Idempotent: the WHERE clause only fills a NULL, so a second run changes
--     zero rows and an existing researched value is never overwritten or
--     duplicated.
--   * Seed rows only (product.name LIKE 'Seed %'): never touches real data.
--   * Natural key: the product name, matching seeds 001/002/003.
--   * updated_at is bumped so the change is attributable.
--   * ASCII only. CRLF.
-- ===========================================================================

BEGIN;

UPDATE cooler_spec cs
SET radiator_size_mm = v.rsize,
    updated_at = NOW()
FROM (VALUES
    -- Cooler Master ML280 Mirror: 280mm radiator, 318 x 140 x 27.2mm.
    ('Seed Cooler Master MasterLiquid ML280 Mirror',    280),
    -- Corsair Nautilus 240 RS ARGB: 240mm radiator, 276 x 120 x 27mm.
    ('Seed Corsair Nautilus 240 RS ARGB Black AIO',     240),
    -- DeepCool MYSTIQUE 360: 360mm radiator, 402 x 120 x 27mm.
    ('Seed DeepCool MYSTIQUE 360 Black AIO',            360),
    -- MSI MAG CORELIQUID 240R: 240mm radiator, 274 x 120 x 27mm.
    ('Seed MSI MAG CORELIQUID 240R',                    240),
    -- MSI MAG CoreLiquid A13 360: 360mm radiator, 394 x 119.6 x 27.2mm.
    ('Seed MSI MAG CoreLiquid A13 360 White AIO',       360)
) AS v(name, rsize)
JOIN product p ON p.name = v.name
WHERE cs.product_id = p.id
  AND p.name LIKE 'Seed %'
  -- Enforce the header's claim in the DML itself, not just in prose: only a
  -- LIQUID cooler may carry a radiator size. This keeps an AIR/PASSIVE/HYBRID
  -- row NULL even if a name above were ever re-typed, so the "AIR coolers are
  -- left NULL" invariant is enforced by the query and not by convention.
  AND cs.cooling_type = 'LIQUID'
  -- Never overwrite an existing researched value (idempotency).
  AND cs.radiator_size_mm IS NULL;

COMMIT;
