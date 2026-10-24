-- ============================================================================
-- Seed 018: scoring model "launch-v2" 2.0.0 - DECLARED resolution_profiles (E5)
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- Decision 42 (E5) implemented a configurable per-resolution VRAM floor in
-- Engine 3: a GPU whose KNOWN chipset VRAM is below
-- `resolution_profiles.<resolution>.vram_floor_gb` is skipped at GPU depth.
-- The rule is OPT-IN by construction, and until this file NO model declared the
-- key, so the floor was provably inert (gap OG-47). E5 cannot be called active
-- while no served model declares it, and A4's 1440p/2160p floor rows stay
-- EXPECTED-RED for exactly that reason.
--
-- WHAT IT ADDS
--
-- `launch-v2` 2.0.0 = `launch-v2` 1.0.0's configuration with exactly ONE key
-- appended: `resolution_profiles`. Copying the 1.0.0 JSONB with `||` guarantees
-- the two versions differ only by the new key - weights, caps, penalties,
-- staleness and `use_case_profiles` stay byte-identical - so a pinned A/B run
-- isolates the floor's effect and nothing else.
--
-- THE VALUES ARE THE H3-REVIEWED FLOORS, not new guesses:
--   1080p 8 GB / 1440p 12 GB / 2160p 16 GB
-- They are the values `test/golden/scenarios.json` A4 already asserts
-- (`A4_vram_floor_gb`), so the golden assertion now judges the ACTIVE policy
-- rather than a parallel hypothesis. The review of record is
-- `docs/ENGINE_HYPOTHESIS_REVIEW_2026-10-24.md`; any future value change
-- belongs in a NEW version, never an edit to this row.
--
-- WHY A NEW VERSION AND NOT AN UPDATE OF 1.0.0
--
-- A scoring model is identified by `name@version`; every golden artifact, gap
-- row and decision records its pin. Mutating 1.0.0's configuration would make
-- the same identity mean two different policies and silently invalidate that
-- evidence. The repo's recipe (`docs/RECIPES/add-a-scoring-model-version.md`)
-- is explicit: INSERT a new version.
--
-- ACTIVATION - 1.0.0 STAYS ACTIVE ON PURPOSE
--
-- Both versions are `is_active = true`. A pin is a selector, not an activation
-- (`scripts/lib/model-pin.js`), so existing `--model=launch-v2@1.0.0` commands
-- and their committed evidence keep resolving, while the API serves 2.0.0 as
-- the NEWEST active row (`ORDER BY created_at DESC, id ASC`). The A/B pair is
-- the verification: the same engine, two model versions differing by one key.
--
-- SCOPE AND SAFETY
--
-- * DML only; no schema change, no migration.
-- * Idempotent: the `NOT EXISTS` guard makes a second apply a no-op. The file
--   does NOT open its own transaction, so it can be rehearsal-wrapped.
-- * TEST-branch-first. The SHARED database deliberately stays on
--   `seed-minimal-v1` and is NOT a target of this task; a shared apply would
--   change the served model there and needs its own owner-gated decision.
-- * No cooler/RAM/case/motherboard row is touched, so the Decision 26
--   `check-deferred-rules.js` trigger does not apply.
--
-- PREREQUISITE
--
-- `launch-v2` 1.0.0 must exist (seed 013). If it does not, the INSERT selects
-- no row and writes nothing (fail-quiet); the SELECT below is the check.
-- ============================================================================

INSERT INTO scoring_model (name, version, description, configuration, is_active)
SELECT
    'launch-v2',
    '2.0.0',
    'Decision 52 (E5): launch-v2@1.0.0 plus the H3-reviewed per-resolution VRAM floors (1080p 8 / 1440p 12 / 2160p 16 GB). 1.0.0 stays active so pinned A/B evidence keeps resolving; the API serves this version as the newest active row.',
    base.configuration || jsonb_build_object(
        'resolution_profiles',
        jsonb_build_object(
            '1080p', jsonb_build_object('vram_floor_gb', 8),
            '1440p', jsonb_build_object('vram_floor_gb', 12),
            '2160p', jsonb_build_object('vram_floor_gb', 16)
        )
    ),
    true
FROM scoring_model AS base
WHERE base.name = 'launch-v2'
  AND base.version = '1.0.0'
  AND NOT EXISTS (
      SELECT 1 FROM scoring_model WHERE name = 'launch-v2' AND version = '2.0.0'
  );

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only)
-- ---------------------------------------------------------------------------
-- SELECT name, version, is_active,
--        configuration->'resolution_profiles' AS floors,
--        (configuration ? 'use_case_profiles') AS keeps_use_case_profiles
--   FROM scoring_model
--  WHERE name IN ('seed-minimal-v1', 'launch-v2')
--  ORDER BY name, version;
