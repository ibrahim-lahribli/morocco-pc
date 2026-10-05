-- ===========================================================================
-- Seed 009: liquid-cooler pump heights + max_tdp_watts corrections (OG-27)
--
-- Gap: OG-27 (docs/OPEN_GAPS.md), found 2026-10-02 while researching seed
-- 004b_case_cooler.sql. Two distinct defects, closed together because both
-- live in cooler_spec and both are spec-data (NOT assessment) work:
--
--   A. cooler_spec.height_mm is NULL for 4 of the 5 LIQUID coolers. An AIO
--      does have a height: the PUMP BLOCK, and it is the dimension that
--      decides whether the block clears a side panel. NULL therefore means
--      UNKNOWN, not "no height" - and per the project's NULL rule an unknown
--      can never be read as 0 or as a pass.
--
--   B. Three max_tdp_watts values disagree with the vendor, in BOTH
--      directions - two optimistic (wrongly generous) and one invented.
--
-- D1. HEIGHTS ARE THE PUMP BLOCK, not the radiator. The radiator's own
--     dimensions are already carried as radiator_size_mm (migration 013 /
--     seed 007) and length_mm, so the only missing dimension for case fit is
--     the vertical height of the block that sits on the CPU. Sources below
--     quote the block/pump explicitly; no value is derived or averaged.
--     The column is INTEGER, so the two fractional vendor figures are stored
--     rounded UP (57.8 -> 58, 56.98 -> 57). Rounding up is the conservative
--     direction for a clearance check: it can over-reserve space, never
--     under-reserve it.
--
--     Sources, per cooler:
--       Seed Cooler Master MasterLiquid ML280 Mirror      -> 58
--         lanoc.org, ocinside.de and modders-inc all give
--         "Pump Dimensions 81.2 x 76 x 57.8 mm" (Cooler Master's own page
--         lists a different, newer Core II pump, so the retailer-reviewed
--         figure is the citable one for the Mirror variant).
--       Seed DeepCool MYSTIQUE 360 Black AIO              -> 66
--         deepcool.com product page: "Pump Dimensions 93x77x66 mm(LxWxH)";
--         tech4gamers, guru3d, aphnetworks and thepcenthusiast all agree.
--       Seed MSI MAG CoreLiquid A13 360 White AIO         -> 57
--         msi.com spec page: "Block Dimensions (WxDxH) 70.9 x 69.3 x
--         56.98 mm" (also on the gzhls.at MSI datasheet PDF).
--       Seed MSI MAG CORELIQUID 240R                     -> 49
--         IDENTITY NOTE, recorded rather than hidden. The catalog row is the
--         V1 "240R"; MSI's own spec page documents the "240R V2" at
--         80.57 x 66.82 x 48.58 mm. The V1 pump is published by e-catalog at
--         81 x 67 x 49 mm - which is the same block to within rounding
--         (80.57->81, 66.82->67, 48.58->49). The V1/V2 distinction therefore
--         does not change the stored height, so this value is safe despite
--         the identity ambiguity that blocked OG-07/OG-08 elsewhere. This is
--         stated because silently borrowing V2 numbers for a V1 product is
--         exactly the error OG-31 was registered for.
--
-- D2. TDP CORRECTIONS, one per disputed value:
--       Seed Cooler Master MasterLiquid ML280 Mirror  280 -> 230  (CORRECTED,
--         downward) lanoc.org spec table reads "TDP 230 W"; modders-inc
--         independently reads "TDP - 230 W". The stored 280 was optimistic -
--         it claimed MORE cooling capacity than the vendor states.
--       Seed MSI MAG COREFROZR AA13 BLACK / WHITE     220 -> 240  (CORRECTED,
--         upward) msi.com product page: "height of just 152mm, TDP 240W";
--         avadirect, dateks and miatlantic all publish 240 W.
--       Seed Corsair Nautilus 240 RS ARGB Black AIO  260 -> NULL (CORRECTED
--         to honest UNKNOWN) Corsair publishes NO TDP rating for this unit -
--         the corsair.com product page, the RS-series "everything you need
--         to know" article and the manual all state socket support and pump
--         specs without a wattage. The stored 260 was an ESTIMATE with no
--         citable source, and a fabricated capacity figure is exactly what
--         the NULL-equals-UNKNOWN rule exists to prevent. Per OG-08/D5
--         precedent (003's own decision) an unverifiable count is written
--         NULL rather than guessed. CONSEQUENCE, stated plainly: this makes
--         the cooler x CPU scope of the DEFERRED OG-09 rule unmeasurable for
--         this one cooler (its "not-measured (NULL side)" count rises 0 -> 1
--         cooler). That is the gate reporting honest uncertainty, not a
--         regression: violations remain 0 and no engine module reads the
--         column at all (Decision 26 item B).
--
-- SAFETY - measured before authoring, not assumed. Decision 26 makes this a
-- binding pre-merge trigger, and two of the three TDP edits move a value
-- that a deferred rule reads:
--   * OG-09 (cooler max_tdp_watts vs CPU tdp_watts): 0 live violations
--     before. The catalog's highest CPU tdp_watts is 125 W, far below even
--     the corrected ML280 floor of 230 W, so NO correction can introduce a
--     violation. Verified by direct query, not by bounding alone.
--   * OG-10 (AIR cooler height_mm vs case max_cpu_cooler_height_mm) is
--     scoped "[AIR cooler x case]" and reads NO liquid cooler, so the four
--     new heights cannot affect it. Verified via check-deferred-rules.js,
--     which reports its AIR-only scope.
--
-- CONVENTIONS (identical to 005/006/007/008):
--   * DML only, no DDL. Single BEGIN/COMMIT per block.
--   * Seed rows only, matched by EXACT product name - never a LIKE that
--     could catch a real product.
--   * ASCII only.
--   * BOTH guards live in the DML, not only in this header:
--       - heights use COALESCE, so an already-filled height is never
--         overwritten and a re-run changes zero rows;
--       - the height UPDATE is additionally constrained to
--         cooling_type = 'LIQUID', so a name ever re-typed to an AIR row
--         cannot receive a pump height;
--       - TDP is guarded by `max_tdp_watts IS DISTINCT FROM <desired>`, which
--         is what makes writing an explicit NULL possible while still
--         leaving an already-correct value untouched.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Block 1: liquid-cooler pump-block heights (fills NULLs only)
-- ---------------------------------------------------------------------------
UPDATE cooler_spec cs
   SET height_mm = COALESCE(cs.height_mm, v.height_mm::integer),
       updated_at = NOW()
  FROM (VALUES
    ('Seed Cooler Master MasterLiquid ML280 Mirror',   57.8),
    ('Seed DeepCool MYSTIQUE 360 Black AIO',           66.0),
    ('Seed MSI MAG CoreLiquid A13 360 White AIO',      56.98),
    ('Seed MSI MAG CORELIQUID 240R',                   49.0)
  ) AS v(name, height_mm)
  JOIN product p ON p.name = v.name
 WHERE cs.product_id = p.id
   AND cs.cooling_type = 'LIQUID'
   AND cs.height_mm IS NULL;

-- ---------------------------------------------------------------------------
-- Block 2: max_tdp_watts corrections
--
-- This block deliberately does NOT use COALESCE, for the same reason seed
-- 008 does: it CORRECTS wrong values rather than filling empty ones, and
-- filling-the-NULLs would be a no-op against a value that is present but
-- wrong. A first draft guarded it with
--     max_tdp_watts IS DISTINCT FROM COALESCE(max_tdp_watts, tdp)
-- which is a real bug caught by the branch rehearsal: whenever the stored
-- value is non-NULL, COALESCE returns that same value, so the two sides are
-- always EQUAL, the predicate is always FALSE, and the block silently
-- updates ZERO rows. It also could never express the honest NULL below,
-- because COALESCE(260, NULL) is 260. The guard therefore compares the
-- stored value directly against the DESIRED value, which is both correct
-- and idempotent, and the SET assigns unconditionally.
-- ---------------------------------------------------------------------------
UPDATE cooler_spec cs
   SET max_tdp_watts = v.tdp::integer,
       updated_at = NOW()
  FROM (VALUES
    ('Seed Cooler Master MasterLiquid ML280 Mirror',     230),
    ('Seed MSI MAG COREFROZR AA13 BLACK',                240),
    ('Seed MSI MAG COREFROZR AA13 WHITE',               240),
    -- Corsair publishes no TDP for the NAUTILUS RS ARGB; 260 was an
    -- unsourced estimate and is replaced by the honest NULL.
    ('Seed Corsair Nautilus 240 RS ARGB Black AIO',  NULL::integer)
  ) AS v(name, tdp)
  JOIN product p ON p.name = v.name
 WHERE cs.product_id = p.id
   AND cs.max_tdp_watts IS DISTINCT FROM v.tdp::integer;

COMMIT;