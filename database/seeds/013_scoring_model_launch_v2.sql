-- ============================================================================
-- Seed 013: scoring model "launch-v2" (Decision 37 - use_case_profiles)
--
-- Purpose
--   Add the launch-v2 scoring model that owns its per-use-case policy AND the
--   use-case vocabulary, so the API's accepted use cases stop deriving from
--   `gpu_required_use_cases` (OG-38). `seed-minimal-v1` is RETAINED for
--   reproducibility: its row is never mutated or deleted.
--
-- How the configuration is built
--   launch-v2's configuration is the launch-v1 configuration with exactly ONE
--   key appended: `use_case_profiles`. Copying the existing row's JSONB with
--   `||` guarantees the two models differ only by the new key - the weights,
--   caps, penalties and staleness are byte-identical to v1, so switching models
--   changes the VOCABULARY and the policy surface, not today's scoring numbers.
--
-- Activation
--   The seed makes launch-v2 the single active model and deactivates v1's row.
--   APPLYING THIS FILE IS A COORDINATED STEP, NOT A ROUTINE SEED RUN:
--     * four harnesses pin `seed-minimal-v1 ... is_active = true` by name
--       (scripts/measure-orchestrator.js, scripts/test-orchestrator-full-run.js,
--       scripts/verify-pool-independence.js, scripts/measure-og01-reach.js) and
--       will fail their preflight on a database where v1 is inactive;
--     * apps/api/'s selectActiveScoringModel will begin serving launch-v2.
--   Update those harnesses to the new active model BEFORE applying this on any
--   database whose gates must stay green.
--
-- Idempotency
--   Both statements are guarded, so a second apply is a no-op. The file does NOT
--   open its own transaction: it is DML-only and re-runnable, which also lets a
--   rehearsal wrap it in BEGIN/ROLLBACK without the inner COMMIT problem.
--
-- Prerequisite
--   `seed-minimal-v1` `1.0.0` must exist. If it does not, the INSERT selects no
--   row and writes nothing (fail-quiet); verify with the SELECT at the bottom.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. launch-v2 = v1's configuration + use_case_profiles
-- ---------------------------------------------------------------------------
INSERT INTO scoring_model (name, version, description, configuration, is_active)
SELECT
    'launch-v2',
    '1.0.0',
    'Decision 37: per-use-case policy (gpu_policy, spend_targets, archetype_objectives) and the use-case vocabulary; supersedes seed-minimal-v1 as the active model.',
    base.configuration || jsonb_build_object(
        'use_case_profiles',
        jsonb_build_object(
            'GAMING', jsonb_build_object(
                'gpu_policy', 'REQUIRED',
                'spend_targets', jsonb_build_object(
                    'CPU', 0.17, 'GPU', 0.38, 'MOTHERBOARD', 0.10,
                    'RAM', 0.07, 'SSD_BOOT', 0.07, 'PSU', 0.07,
                    'CASE', 0.07, 'CPU_COOLER', 0.04
                ),
                'archetype_objectives', jsonb_build_object('PERFORMANCE', 0.50, 'BALANCED', 0.30, 'VALUE', 0.20)
            ),
            'WORKSTATION', jsonb_build_object(
                'gpu_policy', 'REQUIRED',
                'spend_targets', jsonb_build_object(
                    'CPU', 0.24, 'GPU', 0.25, 'MOTHERBOARD', 0.10,
                    'RAM', 0.12, 'SSD_BOOT', 0.08, 'PSU', 0.07,
                    'CASE', 0.07, 'CPU_COOLER', 0.05
                ),
                'archetype_objectives', jsonb_build_object('PERFORMANCE', 0.40, 'BALANCED', 0.40, 'VALUE', 0.20)
            ),
            'OFFICE', jsonb_build_object(
                'gpu_policy', 'IGPU_ALLOWED',
                'spend_targets', jsonb_build_object(
                    'CPU', 0.22, 'GPU', 0.10, 'MOTHERBOARD', 0.12,
                    'RAM', 0.10, 'SSD_BOOT', 0.10, 'PSU', 0.09,
                    'CASE', 0.11, 'CPU_COOLER', 0.05
                ),
                'archetype_objectives', jsonb_build_object('PERFORMANCE', 0.20, 'BALANCED', 0.40, 'VALUE', 0.40)
            )
        )
    ),
    true
FROM scoring_model AS base
WHERE base.name = 'seed-minimal-v1'
  AND base.version = '1.0.0'
  AND NOT EXISTS (
      SELECT 1 FROM scoring_model WHERE name = 'launch-v2' AND version = '1.0.0'
  );

-- ---------------------------------------------------------------------------
-- 2. launch-v2 is the active model; v1 is retained but no longer active
-- ---------------------------------------------------------------------------
UPDATE scoring_model
   SET is_active = false,
       updated_at = now()
 WHERE name = 'seed-minimal-v1'
   AND version = '1.0.0'
   AND is_active = true
   AND EXISTS (
       SELECT 1 FROM scoring_model WHERE name = 'launch-v2' AND version = '1.0.0'
   );

-- ---------------------------------------------------------------------------
-- 3. Post-apply verification (read-only)
-- ---------------------------------------------------------------------------
-- SELECT name, version, is_active,
--        jsonb_object_keys(configuration->'use_case_profiles') AS use_case
--   FROM scoring_model
--  WHERE name IN ('seed-minimal-v1', 'launch-v2')
--  ORDER BY name, version;
