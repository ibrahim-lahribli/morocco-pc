-- ============================================================================
-- Seed 019: scoring model "launch-v2" 2.1.0 - OPT IN to archetype_objectives
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- Decision 41 (E4) introduced the three archetype strategies and orders them by
-- the query's `priority`. Decision 37 declared
-- `use_case_profiles.<use case>.archetype_objectives` as a per-use-case
-- weighting of those strategies, and `scoring/use-cases.js` has always
-- validated it - but nothing read it, so GAMING (PERFORMANCE 0.50) and
-- WORKSTATION (PERFORMANCE 0.40 / BALANCED 0.40) nominated the same rank-1
-- strategy at the same priority (gap OG-38).
--
-- Decision 58 makes the weights live at the NEUTRAL priority only: priority
-- 1/2/4/5 stays the user's explicit lean and keeps the old order. The engine
-- applies them ONLY behind the optional boolean `apply_archetype_objectives`,
-- so this file is what ACTIVATES the behaviour for a model - and 2.0.0, which
-- already declares the weights, keeps producing exactly what its committed
-- evidence says.
--
-- WHAT IT ADDS
--
-- `launch-v2` 2.1.0 = `launch-v2` 2.0.0's configuration with exactly ONE key
-- appended: `apply_archetype_objectives: true`. Copying the 2.0.0 JSONB with
-- `||` guarantees the two versions differ only by the new key - weights, caps,
-- penalties, staleness, `use_case_profiles` and `resolution_profiles` stay
-- byte-identical - so a pinned A/B run isolates the ordering change and nothing
-- else.
--
-- WHY A NEW VERSION AND NOT AN UPDATE OF 2.0.0
--
-- A scoring model is identified by `name@version`; every golden artifact, gap
-- row and decision records its pin. Mutating 2.0.0 would make the same identity
-- mean two different rank orders and silently invalidate that evidence. The
-- repo's recipe is explicit: INSERT a new version.
--
-- ACTIVATION - 2.0.0 STAYS ACTIVE ON PURPOSE
--
-- Both versions are `is_active = true`. A pin is a selector, not an activation
-- (`scripts/lib/model-pin.js`), so existing `--model=launch-v2@2.0.0` commands
-- and their committed evidence keep resolving, while the API serves 2.1.0 as
-- the NEWEST active row (`ORDER BY created_at DESC, id ASC`). The A/B pair is
-- the verification: the same engine, two versions differing by one boolean.
--
-- THE VALUES ARE NOT NEW GUESSES
--
-- The weights are the ones `launch-v2` 1.0.0 already declares (seed 013) and
-- `test/golden/scenarios.json` A10 already judges. This file changes no number.
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
-- `launch-v2` 2.0.0 must exist (seed 018). If it does not, the INSERT selects
-- no row and writes nothing (fail-quiet); the SELECT below is the check.
-- ============================================================================

INSERT INTO scoring_model (name, version, description, configuration, is_active)
SELECT
    'launch-v2',
    '2.1.0',
    'Decision 58: launch-v2@2.0.0 plus the archetype_objectives opt-in, so the per-use-case weights order the showcase strategies at neutral priority.',
    base.configuration || jsonb_build_object('apply_archetype_objectives', true),
    true
FROM scoring_model AS base
WHERE base.name = 'launch-v2'
  AND base.version = '2.0.0'
  AND NOT EXISTS (
      SELECT 1 FROM scoring_model WHERE name = 'launch-v2' AND version = '2.1.0'
  );

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only)
-- ---------------------------------------------------------------------------
-- SELECT name, version, is_active,
--        configuration->'apply_archetype_objectives' AS applies_objectives,
--        configuration->'use_case_profiles'->'GAMING'->'archetype_objectives' AS gaming,
--        configuration->'use_case_profiles'->'WORKSTATION'->'archetype_objectives' AS workstation
--   FROM scoring_model
--  WHERE name IN ('seed-minimal-v1', 'launch-v2')
--  ORDER BY name, version;
