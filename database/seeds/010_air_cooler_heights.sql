-- ===========================================================================
-- Seed 010: correct the AIR-cooler height_mm placeholder (OG-34)
--
-- Gap: OG-34 (docs/OPEN_GAPS.md), registered 2026-10-04 while researching
-- OG-27. All 4 AIR coolers in the catalog carry an IDENTICAL height_mm of
-- 155. Three of them are different products from three different
-- manufacturers, so a single shared value cannot be a measurement of any of
-- them - it is a placeholder. Seed 009 made this visible only by comparison:
-- once the LIQUID rows were researched, four unresearched AIR rows sitting on
-- the same number looked like research that had never happened.
--
-- WHY A PLACEHOLDER IS WORTH A CORRECTIVE SEED, even though nothing reads the
-- column today: OG-10 (AIR cooler height_mm vs case
-- max_cpu_cooler_height_mm) is the ONLY rule that reads it, it is DEFERRED,
-- and this row set is precisely its input. A wrong input that is silently
-- plausible is worse than a NULL, which would at least be visibly unknown.
--
-- THE VALUES, and their provenance. Re-verified independently for this seed
-- (2026-10-05) rather than copied from the OG-34 research note, because a
-- seed's own citation must be re-fetchable by a second reader:
--   Seed DeepCool AG400                      155 -> 150
--     deepcool.com AG400 spec table reads
--     "Heatsink Dimensions 120x92x150 mm(LxWxH)". tomshardware's AG400 review
--     spec table independently lists the same 120x92x150 mm, and mcscomputers,
--     techbuy.com.au and woolworths.com.au (AU retailer spec tables) all read
--     150 mm. NOTE the distinction being drawn: DeepCool publishes BOTH a
--     "Product Dimensions 125x92x150 mm" and a "Heatsink Dimensions
--     120x92x150 mm". Only WIDTH differs between the two, so the HEIGHT is
--     unambiguous at 150 either way. The AG400 PLUS also publishes
--     120x92x150, so it does not introduce a conflicting height.
--   Seed MSI MAG COREFROZR AA13 BLACK       155 -> 152
--   Seed MSI MAG COREFROZR AA13 WHITE       155 -> 152
--     msi.com MAG COREFROZR AA13 product page: "With a height of just
--     152mm, the cooler fits most mid-tower cases". Reproduced verbatim on
--     dateks.lv, theitstore.ie, quzo.co.uk, ecomp.lt, pccasegear and
--     greenapple - all quoting MSI's own copy. One figure for both colour
--     variants, which is correct: they are the same cooler.
--   Seed Noctua NH-U12S SE-AM5              155 -> 158
--     noctua.at NH-U12S SE-AM4 specifications page: "Total height 158 mm",
--     with socket compatibility listed as "AM5, AM4" - i.e. the AM5 row is
--     covered by this page. Independently corroborated by aphnetworks, amazon
--     and pangoly listings at 158 mm.
--
-- DIRECTION OF ERROR, stated because it is the whole point of the gap. Two of
-- the three corrections LOWER the stored height (155 -> 150, 155 -> 152). That
-- is the conservative direction for a clearance check: it over-reserves space
-- and can never let an incompatible cooler through. The THIRD correction
-- RAISES it (155 -> 158), which is the unsafe direction - the stored value was
-- UNDERSTATED, so a future OG-10 evaluating a case with, say, 156 mm of
-- clearance would have compared 155 <= 156, returned PASS, and produced a
-- build whose cooler does not physically fit. That is why this row is in the
-- same seed as the other two rather than being deferred as "only cosmetic":
-- shipping the two safe ones alone would leave the one unsafe value in place.
--
-- SAFETY - measured before authoring, not assumed (Decision 26 trigger). The
-- raising correction is exactly the kind of edit the trigger exists for, so
-- the OG-10 pair set was recomputed live before this file was written:
--   * 4 AIR coolers x 10 cases = 40 pairs, 0 would-FAIL both before and after.
--     The binding fact is the narrow clearance margin in the catalog itself:
--     the SMALLEST case max_cpu_cooler_height_mm is 160 mm (Fractal Pop XL and
--     NZXT H5 Flow Compact), and the tallest corrected cooler is 158 mm. The
--     tightest pair therefore has 2 mm of headroom, so raising 155 -> 158
--     flips nothing. Verified by direct query on both databases, not by
--     bounding alone.
--   * Consequence worth recording: this safety margin is a property of the
--     CURRENT 10 cases, not a guarantee. Adding a 158 mm-class case to the
--     catalog would make the margin vanish. The gap is closed because the DATA
--     is right, not because the current catalog happens to be forgiving.
--   * OG-09 (max_tdp_watts vs CPU tdp_watts) is untouched: this file writes no
--     TDP column at all.
--
-- CONVENTIONS (identical to 005/006/007/008/009):
--   * DML only, no DDL. Single BEGIN/COMMIT: all-or-nothing per run.
--   * Seed rows only, matched by EXACT product name - never a LIKE that
--     could catch a real product.
--   * ASCII only.
--   * THIS UPDATE OVERWRITES rather than COALESCEs, for the reason seed 008
--     gives: the stored value is wrong, so "only fill NULLs" would be a no-op
--     and the tree would stay unreproducible. Idempotency is guaranteed instead
--     by `height_mm IS DISTINCT FROM <desired>`, so a second run changes zero
--     rows.
--   * That guard is in the DML, not only in this header, so an already-correct
--     row is provably left alone.
--   * The UPDATE is additionally constrained to cooling_type = 'AIR', so a
--     name ever re-typed onto a LIQUID row cannot receive an air-tower height.
-- ===========================================================================

BEGIN;

UPDATE cooler_spec cs
   SET height_mm = v.height_mm::integer,
       updated_at = NOW()
  FROM (VALUES
    ('Seed DeepCool AG400',              150),
    ('Seed MSI MAG COREFROZR AA13 BLACK', 152),
    ('Seed MSI MAG COREFROZR AA13 WHITE', 152),
    ('Seed Noctua NH-U12S SE-AM5',       158)
  ) AS v(name, height_mm)
  JOIN product p ON p.name = v.name
 WHERE cs.product_id = p.id
   AND cs.cooling_type = 'AIR'
   AND cs.height_mm IS DISTINCT FROM v.height_mm::integer;

COMMIT;
