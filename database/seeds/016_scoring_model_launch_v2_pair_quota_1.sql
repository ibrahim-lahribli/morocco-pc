-- ============================================================================
-- Seed 016: scoring model "launch-v2" 1.3.0 (Decision 40 - pair quota, E3)
--
-- Purpose
--   Add a NEW version of launch-v2 whose candidate_caps carries the optional
--   per-pair build quota `max_builds_per_pair`. The assembler skips a GPU branch
--   once its (CPU, GPU) pair holds that many builds, so the max_builds_per_query
--   halt is not spent on one pair (Decision 25 diagnosis; E3 acceptance).
--
-- How the configuration is built
--   launch-v2 1.3.0 = launch-v2 1.0.0's configuration with ONE key changed:
--   candidate_caps gains max_builds_per_pair. Weights, penalties, staleness and
--   use_case_profiles are byte-identical to 1.0.0, so the two versions differ
--   only in the quota.
--
-- Activation and scope
--   This version is inserted ACTIVE on the TEST branch only, beside the existing
--   active rows, so the golden harness can pin it by name@version. launch-v2
--   1.0.0 and seed-minimal-v1 are NOT mutated. The shared database is never
--   touched by this file, and the API's default active-model selection is
--   unchanged for the shared database.
--
-- Idempotency
--   The INSERT is guarded by NOT EXISTS, so a second apply is a no-op. The file
--   does NOT open its own transaction; scripts/apply-seed.js wraps it in one.
--
-- Prerequisite
--   launch-v2 1.0.0 must exist (seed 013). If it does not, the INSERT selects no
--   row and writes nothing (fail-quiet); verify with the SELECT at the bottom.
-- ============================================================================

INSERT INTO scoring_model (name, version, description, configuration, is_active)
SELECT
    'launch-v2',
    '1.3.0',
    'Decision 40 (E3): launch-v2 1.0.0 plus candidate_caps.max_builds_per_pair = 1 (per-pair build quota enforced at GPU depth in the assembly walk).',
    base.configuration || jsonb_build_object(
        'candidate_caps',
        (base.configuration->'candidate_caps') || jsonb_build_object('max_builds_per_pair', 1)
    ),
    true
FROM scoring_model AS base
WHERE base.name = 'launch-v2'
  AND base.version = '1.0.0'
  AND NOT EXISTS (
      SELECT 1 FROM scoring_model WHERE name = 'launch-v2' AND version = '1.3.0'
  );

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only)
-- ---------------------------------------------------------------------------
-- SELECT name, version, is_active,
--        configuration->'candidate_caps' AS candidate_caps
--   FROM scoring_model
--  WHERE name = 'launch-v2'
--  ORDER BY version;
