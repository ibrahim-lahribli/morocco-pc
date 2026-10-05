-- ===========================================================================
-- Seed 012: backfill motherboard_memory_support from the legacy
-- motherboard_spec.memory_type_id (OG-02, Decision 33)
--
-- Migration 016 created motherboard_memory_support as the SOURCE OF TRUTH
-- for a board that has any row, with a zero-row board falling back to the
-- legacy motherboard_spec.memory_type_id. This seed backfills one row per
-- existing motherboard so every seeded board is represented in the new
-- table immediately - no dual-source ambiguity is left in the live data,
-- and adding a second row is from now on the ONLY way to express a
-- dual-DDR4/DDR5 board (the OG-02 fix in action).
--
-- The rows are written with support_status = 'PASS' (the default): the
-- legacy column asserted the technology outright, so the honest migration
-- of that assertion is an explicit PASS, not an UNKNOWN.
--
-- Idempotency: the INSERT carries a WHERE NOT EXISTS guard keyed on
-- (motherboard_product_id, memory_type_id), mirroring the unique index
-- idx_mms_board_memory_type; a re-run changes zero rows.
--
-- The OG-03 support_status columns added by migration 016 are deliberately
-- left NULL: no presence-only row has ever been researched against an
-- explicit FAIL/UNKNOWN/CONDITIONAL, and inventing one would violate the
-- NULL-means-UNKNOWN discipline. Real statuses arrive only with research.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

INSERT INTO motherboard_memory_support
    (motherboard_product_id, memory_type_id, support_status, source_note)
SELECT
    ms.product_id,
    ms.memory_type_id,
    'PASS',
    'Backfilled from motherboard_spec.memory_type_id by seed 012 (OG-02 / Decision 33)'
FROM motherboard_spec ms
WHERE NOT EXISTS (
    SELECT 1
      FROM motherboard_memory_support mms
     WHERE mms.motherboard_product_id = ms.product_id
       AND mms.memory_type_id = ms.memory_type_id
);
