-- ===========================================================================
-- Add cooler_spec.radiator_size_mm (migration 013)
--
-- Gap: OG-28 (docs/OPEN_GAPS.md). The CASE side of the radiator rule is
-- fully populated - all 10 of 10 cases carry a case_radiator_support matrix,
-- since OG-05 closed - but the COOLER side had nowhere to record a radiator
-- size at all. cooler_spec held cooling_type, max_tdp_watts, height_mm,
-- length_mm and width_mm, and no radiator column.
--
-- Consequence, verified by reading the resolver rather than by assumption:
-- src/recommendation/filtering/context-loader.js hardcoded
-- radiator_size_mm: null for every cooler, and
-- src/recommendation/compatibility/case-radiator.js rule 5 matches
-- `row.radiator_size_mm === radiator_size_mm`. A NOT NULL integer never
-- equals null, so every liquid cooler in a case that HAS a matrix fell to
-- the no-match branch and returned UNKNOWN RADIATOR_SUPPORT_UNKNOWN. The
-- rule was implemented and enforced; it simply could never reach PASS, no
-- matter how much case data was added.
--
-- Why this is safe to add (the blast radius was MEASURED before authoring,
-- over all 10 cases x 5 liquid coolers = 50 pairs, using the vendor sizes in
-- seed 007): 43 pairs flip UNKNOWN -> PASS, 7 stay UNKNOWN, and ZERO flip to
-- FAIL. The direction is monotone because rule 5 FAILs only on
-- `liquid + ZERO radiator rows`; every case now has rows (OG-05), so that
-- branch is unreachable and this column cannot reject a build that is
-- currently accepted. It can only convert a permanent UNKNOWN into a real
-- PASS - and UNKNOWN was already eligible, so no build is lost.
--
-- Ranking relevance: unknown_compat_penalty is 5 per build-local UNKNOWN
-- pairwise count, so each liquid cooler was costing a retained build 5 points.
--
-- NULLability: the column is NULLABLE and stays NULL for every AIR cooler, so
-- the NULL = UNKNOWN rule (AGENTS.md section 8) is preserved - an air cooler
-- never needs a radiator size. NULL is never coerced to 0.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) The column itself (additive; guarded, so re-running is a no-op)
-- ---------------------------------------------------------------------------
ALTER TABLE cooler_spec
    ADD COLUMN IF NOT EXISTS radiator_size_mm INTEGER;

-- ---------------------------------------------------------------------------
-- 2) Positivity guard, matching the convention of the sibling cooler_spec
--    CHECKs (chk_cooler_height_positive etc.). A CHECK on a NULL column
--    evaluates to NULL and is therefore not violated, so AIR coolers and any
--    future un-researched cooler are unaffected by this constraint.
-- ---------------------------------------------------------------------------
ALTER TABLE cooler_spec
    DROP CONSTRAINT IF EXISTS chk_cooler_radiator_size_positive;

ALTER TABLE cooler_spec
    ADD CONSTRAINT chk_cooler_radiator_size_positive CHECK (radiator_size_mm > 0);
