-- 026_cooler_footprint_dimensions.sql
-- Purpose: replace the 120x120 placeholder footprint carried by all four AIR coolers
-- (OG-35, the sibling of the OG-34 height defect) with researched dimensions, and set
-- NULL where NO vendor figure could be read instead of leaving a false number.
--
-- Sources, read 2026-10-31:
--   * DeepCool AG400:
--     https://www.deepcool.com/products/Cooling/cpuaircoolers/GAMMAXX-AG400-Single-Tower-CPU-Cooler-1851-1700-AM5/2024/15898.shtml
--     Row: "Product Dimensions | 125x92x150 mm (LxWxH)" (fan INCLUDED; the same table gives
--     "Heatsink Dimensions | 120x92x150 mm", so the stored 125/92 is the as-shipped product).
--   * MSI MAG COREFROZR AA13 BLACK and WHITE - ONE product, colour only; MSI publishes
--     152 (height) x 121 (width) x 94.5 (depth) mm. Transcribed from a listing that
--     reproduces MSI's own spec table (avadirect.com/.../Product/19688324) because
--     msi.com answered 403 to the research agent. 94.5 mm cannot be stored in an INTEGER
--     column, so the depth is written as 95 and the 0.5 mm rounding is recorded HERE
--     rather than hidden.
--   * Noctua NH-U12S SE-AM5 - noctua.at returned 429 (rate limited) on every attempt, so no
--     vendor figure was read. length_mm / width_mm are set to NULL with that reason: an
--     absent source is NULL, never a placeholder. Re-check trigger: a retry of
--     https://www.noctua.at/en/products/nh-u12s-se-am5/specifications.
--
-- Axis convention: length_mm = the vendor's L (front to back), width_mm = the vendor's W
-- (across the fan). MSI publishes no "L", so its DEPTH is stored as length and its WIDTH as
-- width. No engine module reads either column (COOLER_SPEC_SQL selects product_id,
-- cooling_type, radiator_size_mm and height_mm only), so this repairs provenance drift and
-- cannot move a compatibility verdict.
--
-- Idempotent: every write is guarded on the current value differing, and by cooling_type.

WITH dims(name, new_length_mm, new_width_mm) AS (VALUES
    ('Seed DeepCool AG400',                125,  92),
    ('Seed MSI MAG COREFROZR AA13 BLACK',   95, 121),
    ('Seed MSI MAG COREFROZR AA13 WHITE',   95, 121)
)
UPDATE cooler_spec cs
SET length_mm = d.new_length_mm,
    width_mm  = d.new_width_mm
FROM dims d
JOIN product p ON p.name = d.name
WHERE cs.product_id    = p.id
  AND cs.cooling_type  = 'AIR'
  AND (cs.length_mm IS DISTINCT FROM d.new_length_mm
       OR cs.width_mm IS DISTINCT FROM d.new_width_mm);

UPDATE cooler_spec cs
SET length_mm = NULL,
    width_mm  = NULL
FROM product p
WHERE cs.product_id   = p.id
  AND p.name          = 'Seed Noctua NH-U12S SE-AM5'
  AND cs.cooling_type = 'AIR'
  AND (cs.length_mm IS NOT NULL OR cs.width_mm IS NOT NULL);
