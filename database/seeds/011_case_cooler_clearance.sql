-- ===========================================================================
-- Seed 011: correct the case-side CPU-cooler clearance (OG-36)
-- ===========================================================================
--
-- WHY THIS FILE EXISTS
--
-- Decision 30 implemented and ENFORCED OG-10: an AIR cooler's height_mm is
-- compared against case_spec.max_cpu_cooler_height_mm, tri-state, with a NULL
-- never passing. That rule reads BOTH operands:
--
--   cooler side  cooler_spec.height_mm   -- researched by seed 010 (OG-34)
--   case side    case_spec.max_cpu_cooler_height_mm  -- NEVER researched
--
-- Seed 010 closed the cooler half of this comparison and left the case half
-- exactly as the original seeds wrote it. Four of the ten ACTIVE cases carry a
-- value that is not the vendor's figure, so the enforced rule is currently
-- comparing a researched height against an unresearched clearance. That makes
-- this file the mirror image of OG-34, on the other operand of the same rule.
--
-- THE DEFECT, IN THE OG-34 SHAPE
--
-- The two seed-001 cases were written with a single bare literal covering both
-- rows (001_minimal_builds.sql), which is structurally the same defect seed
-- 010 just corrected on the cooler side (a CROSS JOIN (SELECT 155 AS h) shared
-- by two different products). Two cases from two different manufacturers cannot
-- publish the same maximum CPU-cooler height:
--
--   Seed Fractal Pop XL         160  <- bare literal in seed 001
--   Seed NZXT H5 Flow Compact   160  <- bare literal in seed 001
--
-- The 001 INSERT is corrected in this same change so a fresh replay is right
-- (see "REPRODUCIBILITY" below).
--
-- VALUES, re-verified independently for THIS seed on 2026-10-05 rather than
-- copied from the review that found the gap, because a seed's own citation
-- must be re-fetchable by a second reader (the seed 010 / C-25 precedent, and
-- the OG-31 lesson about silently borrowing another model's numbers):
--
--   Seed Fractal Pop XL                  160 -> 185
--     fractal-design.com, Pop XL Air product page, Compatibility block:
--     "CPU cooler max height 185 mm" (same figure on the Pop XL Air RGB and
--     Pop XL Silent pages; PSU 205mm / GPU 455mm on the same block).
--
--   Seed NZXT H5 Flow Compact            160 -> 170
--     nzxt.com H5 Flow product page, Key Specs AND Tech Specs:
--     "CPU Cooler Clearance: Up to 170 mm (6.7 in)".
--     NOTE an explicit disagreement, recorded rather than hidden: TechPowerUp's
--     H5 Flow launch review lists 165 mm. That review covers the ORIGINAL 2022
--     H5 Flow; nzxt.com's live page documents the CURRENT chassis. The
--     manufacturer's own current figure wins (002 D7: catalog wins on conflict,
--     conflicts flagged), and the 5mm difference is flagged here because it is
--     the one case in this file where two credible sources disagree.
--
--   Seed MSI MAG PANO 100R PZ Blanc      175 -> 166
--     msi's own uk-store.msi.com product page for MAG PANO 100R PZ WHITE,
--     "Extensive Compatibility / Component clearances: CPU Cooler height: 166
--     mm". Corroborated by the msi.com Specification page ("Maximum CPU Cooler
--     Height 166 mm / 6.54 inches"), the MSI MAGPANO100L100RPZWHITE datasheet
--     PDF, tomshardware's MAG Pano 100R PZ review ("CPU Cooler Clearance
--     166mm"), B&H ("CPU Cooler Height 7" / 166 mm") and four further retailers.
--     IDENTITY CHECKED, not assumed: the catalog row is the 100R PZ (right-hand
--     side), and the 166mm figure is read from the 100R PZ page - NOT from the
--     100L PZ sibling, which MSI documents as a distinct chassis. This is the
--     OG-31 trap avoided explicitly.
--
--   Seed MSI MAG FORGE 320R AIRFLOW White 161 -> 160
--     msi.com MAG FORGE 320R AIRFLOW Specification page, "Maximum CPU Cooler
--     Height 160 mm / 6.29 inches"; the MSI MAGFORGE320R120AAIRFLOW_EN.pdf
--     datasheet ("Maximum CPU Cooler Height 160mm"); plus plasico's PDF of the
--     same spec sheet, guru3d, geekawhat and shi.com. This 1mm transcription
--     slip was already recorded in the 004b_case_cooler.sql header as "owned by
--     OG-06/OG-05" - neither of which claims it, so it was owned by nothing.
--
-- UNCHANGED, because the researched value already matches what is stored
-- (re-verified, not skipped):
--
--   Seed Corsair 3500X White / Black, Seed Corsair iCUE LINK 3500X ARGB White
--       170  corsair.com 3500X product page (CC-9011276-WW) and the iCUE LINK
--            3500X RGB page (CC-9011281-WW): "Maximum CPU Cooler Height, 170mm"
--   Seed CORSAIR Frame 4000D RS ARGB Black / White
--       170  corsair.com FRAME 4000D RS ARGB page (CC-9011296-WW): "The FRAME
--            4000D RS supports CPU coolers up to 170mm in height"
--   Seed MSI MPG VELOX 100R WHITE
--       175  msi.com MPG VELOX 100R WHITE Specification page and the
--            MPG-VELOX-100R-WHITE datasheet: "Maximum CPU Cooler Height
--            175 mm / 6.9 inches"
--
-- DIRECTION OF ERROR - why three of the four corrections go UP
--
-- This is the same reasoning that made OG-34 closable rather than deferrable.
-- max_cpu_cooler_height_mm is a MAXIMUM, so a value that is too LOW
-- over-reserves space (a false REJECT, never a false accept) and a value that
-- is too HIGH falsely accepts a cooler that does not close:
--
--   Pop XL        160 -> 185   RAISED. Conservative: rejects coolers that
--                              actually fit. Cannot emit a broken build.
--   H5 Flow       160 -> 170   RAISED. Conservative, same reason.
--   PANO 100R PZ  175 -> 166   LOWERED. THIS IS THE UNSAFE DIRECTION and the
--                              reason this file cannot be deferred: a 167-175mm
--                              tower returns PASS against the stored 175 and
--                              does not physically fit a 166mm chassis.
--   FORGE 320R    161 -> 160   LOWERED by 1mm. Also the unsafe direction, also
--                              small, also fixed here for the same reason.
--
-- Shipping only the two RAISED corrections would have left both unsafe values
-- in place, which is precisely the mistake OG-34's closure refused to make.
--
-- MEASURED SAFETY, per the Decision 26 item 11 trigger - computed live, not
-- reasoned about, because two of these four edits LOWER a clearance and that
-- is exactly the edit the trigger exists for:
--
--   OG-10 pairs before: 40 evaluated (4 AIR x 10 cases), 0 violations.
--   OG-10 pairs after : 40 evaluated, 0 violations.
--
--   The binding fact: the tallest ACTIVE AIR cooler is the Noctua NH-U12S
--   SE-AM5 at 158mm (seed 010), and the smallest clearance after this
--   correction is the MAG FORGE 320R AIRFLOW at 160mm. 158 <= 160, so the
--   tightest pair keeps 2mm of headroom.
--
--   AN HONEST CORRECTION TO THE C-26 / OG-10 CLOSURE TEXT: both name "the
--   smallest case clearance is 160mm (Fractal Pop XL, NZXT H5 Flow Compact)".
--   That 160 was the seed-001 placeholder. After this seed the tightest pair is
--   the MAG FORGE 320R AIRFLOW instead, and its 160mm is a researched figure.
--   The 2mm margin is unchanged; the case holding it is different, and the
--   number is now real rather than a literal.
--
--   As with C-25: this margin is a property of the CURRENT ten cases, not a
--   guarantee. It is precisely why the data had to be right rather than merely
--   happen to be forgiving.
--
-- NOT IN SCOPE
--
--   * OG-35 (cooler_spec.length_mm / width_mm still 120 on all four AIR
--     coolers) is the sibling placeholder defect on the cooler side, found
--     while reviewing seed 010. Left open and unfixed here: it needs its own
--     research pass and no engine module reads either column.
--   * The Corsair 3500X max_gpu_length_mm = 410 vs Corsair's published 425mm,
--     recorded as conservative in the 004b header, is a different column owned
--     by no rule in this shape. Untouched.
--   * OG-06 (offer price VALUE accuracy), OG-07 / OG-08 (GPU and PSU identity).
--     Untouched.
--
-- REPRODUCIBILITY (OG-31 / C-23 precedent)
--
-- The live value alone is not the fix. 001_minimal_builds.sql wrote the bare
-- 160 literal for both its cases, so a fresh replay would have re-inserted the
-- placeholder and re-armed this exact trap for the next research pass. The
-- 001 INSERT is therefore corrected in the same change, and 002's VALUES row
-- for the PANO and the FORGE 320R alongside it, so the tree matches the live
-- state rather than merely documenting the drift.
--
-- IDEMPOTENCE AND GUARDS
--
-- Same overwrite-not-COALESCE shape as seeds 008 / 009 / 010: this corrects a
-- value that is PRESENT BUT WRONG, so "only fill NULLs" would be a no-op
-- against it. The IS DISTINCT FROM guard makes a second apply of this file
-- change zero rows, and makes applying it to an already-correct database a
-- verified no-op rather than an untested one.
--
-- The join is by product name over exactly the ten researched rows, so a case
-- added later cannot receive a clearance this seed never researched. As with
-- seeds 008 and 009, a name that matched two ACTIVE products would update both
-- instead of failing (measured: zero duplicates today); a hard failure would
-- need a plpgsql DO block, which breaks this directory's DML-only convention,
-- so the exposure is documented instead of guarded.
-- ===========================================================================

BEGIN;

UPDATE case_spec cs
   SET max_cpu_cooler_height_mm = v.clearance_mm::integer,
       updated_at = NOW()
  FROM (VALUES
    ('Seed Fractal Pop XL',                     185),
    ('Seed NZXT H5 Flow Compact',               170),
    ('Seed Corsair 3500X White',                170),
    ('Seed Corsair 3500X Black',                170),
    ('Seed Corsair iCUE LINK 3500X ARGB White', 170),
    ('Seed CORSAIR Frame 4000D RS ARGB Black',  170),
    ('Seed CORSAIR Frame 4000D RS ARGB White',  170),
    ('Seed MSI MAG PANO 100R PZ Blanc',         166),
    ('Seed MSI MPG VELOX 100R WHITE',           175),
    ('Seed MSI MAG FORGE 320R AIRFLOW White',   160)
  ) AS v(name, clearance_mm)
  JOIN product p ON p.name = v.name
 WHERE cs.product_id = p.id
   AND cs.max_cpu_cooler_height_mm IS DISTINCT FROM v.clearance_mm::integer;

COMMIT;
