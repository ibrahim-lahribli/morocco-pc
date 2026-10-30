-- ============================================================================
-- Seed 020: scoring model "launch-v2" 2.2.0 - a pair quota of 2 (OG-55)
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- OG-55 records the A1 debt on the canonical line: with no pair quota, the E4
-- showcase selects 1-2 distinct (CPU, GPU) pairs where the approved A1
-- threshold is 3, so all 15 A1 rows are EXPECTED-RED at 2.0.0 and 2.1.0.
--
-- The lever already exists and is measured. `launch-v2@1.1.0` (seed 014, =
-- 1.0.0 plus `candidate_caps.max_builds_per_pair: 2`) measured A1 green across
-- S03-S09 with 4-6 distinct pairs (test/golden/_scratch-v4-e3.md), and 3 pairs
-- after the later epics (_scratch-v9-e8-launch-v2-1.1.0.md). Seed 017 retired
-- 1.1.0 with its sibling experiments, so nothing on the canonical line has
-- carried the quota since.
--
-- WHAT IT ADDS
--
-- `launch-v2` 2.2.0 = `launch-v2` 2.1.0's configuration with exactly ONE nested
-- value set: `candidate_caps.max_builds_per_pair = 2`. The `||` on the nested
-- `candidate_caps` object preserves `top_k_per_role` and `max_builds_per_query`,
-- and the outer `||` preserves every other key - `apply_archetype_objectives`,
-- the use-case weights, `resolution_profiles`, penalties, staleness - so a
-- pinned A/B against 2.1.0 isolates the quota.
--
-- WHY A NEW VERSION AND NOT AN UPDATE OF 2.1.0
--
-- A scoring model is identified by `name@version`; mutating 2.1.0 would make
-- its committed A10 evidence resolve against a different assembly. The repo's
-- recipe is to INSERT a new version (see seed 019's header for the same rule).
--
-- QUOTA 2 IS A MEASURED STARTING POINT, NOT A REVIEWED VALUE
--
-- 2 is the smallest quota that measured A1 green on this corpus (the 100-product
-- seed catalog). It is NOT an H3-reviewed value, and OG-44's lesson stands: do
-- not promote it beyond the corpus without evidence. What this version buys is
-- a measurable candidate whose only difference from 2.1.0 is assembly breadth.
--
-- ACTIVATION - 2.1.0 STAYS ACTIVE ON PURPOSE
--
-- Both rows are `is_active = true`. A pin is a selector, not an activation
-- (`scripts/lib/model-pin.js`), so `--model=launch-v2@2.1.0` keeps resolving its
-- committed evidence while the API serves 2.2.0 as the NEWEST active row.
--
-- SCOPE AND SAFETY
--
-- * DML only; no schema change, no migration.
-- * Idempotent: the `NOT EXISTS` guard makes a second apply a no-op. The file
--   does NOT open its own transaction, so it can be rehearsal-wrapped.
-- * TEST-branch-first. The SHARED database deliberately stays on
--   `seed-minimal-v1` (Decision 57) and is NOT a target of this task.
-- * No catalog row is touched, so the Decision 26 `check-deferred-rules.js`
--   trigger does not apply.
--
-- PREREQUISITE
--
-- `launch-v2` 2.1.0 must exist (seed 019). If it does not, the INSERT selects no
-- row and writes nothing (fail-quiet); the SELECT below is the check.
-- ============================================================================

INSERT INTO scoring_model (name, version, description, configuration, is_active)
SELECT
    'launch-v2',
    '2.2.0',
    'OG-55: launch-v2@2.1.0 plus candidate_caps.max_builds_per_pair = 2, so the showcase can carry three pair-distinct archetypes.',
    base.configuration || jsonb_build_object(
        'candidate_caps',
        (base.configuration->'candidate_caps') || jsonb_build_object('max_builds_per_pair', 2)
    ),
    true
FROM scoring_model AS base
WHERE base.name = 'launch-v2'
  AND base.version = '2.1.0'
  AND NOT EXISTS (
      SELECT 1 FROM scoring_model WHERE name = 'launch-v2' AND version = '2.2.0'
  );

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only)
-- ---------------------------------------------------------------------------
-- SELECT name, version, is_active,
--        configuration->'candidate_caps' AS candidate_caps,
--        configuration->'apply_archetype_objectives' AS applies_objectives,
--        configuration->'use_case_profiles'->'GAMING'->'archetype_objectives' AS gaming
--   FROM scoring_model
--  WHERE name IN ('seed-minimal-v1', 'launch-v2')
--  ORDER BY name, version;
