-- ============================================================================
-- Seed 022: scoring model "launch-v2" 2.4.0 - a CPU-ONLY depth (OG-56, Decision 59)
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- OG-56 measured two ways to give S06 (GAMING, 1440p, 12000 MAD) the three
-- distinct (CPU, GPU) pairs A1 requires. At 1440p the 12 GB floor leaves exactly
-- ONE GPU a 12000 MAD pass can afford, so every pair has to come from the CPU
-- axis:
--
--   * UNIFORM depth 10 (seed 021, `launch-v2@2.3.0`) turns A1 green, 15 of 15,
--     but BREAKS A5: at that depth the priority-1 and priority-5 rank-1 builds
--     for GAMING 1080p become the SAME build (11986 MAD, signatures equal), so
--     `priority` stops discriminating rank 1.
--   * CPU-ONLY depth 10 keeps A1 green 15 of 15 AND leaves A5 intact on BOTH
--     approved pairs - S10 11246 vs S11 11845 and S12 13946 vs S13 19246,
--     signatures differ in both - because the seven roles that buy no pair
--     keep their depth of 5.
--
-- Measured 2026-10-30 on the TEST branch with the engine at commit fc71061,
-- through a replica of orchestrator stages 1-13 that was calibrated against the
-- real engine at BOTH depths (replica K=5 matched 2.2.0 and replica K=10 matched
-- 2.3.0 on S06/S10/S11/S19, including every selected signature and the A10
-- order) before the merged CPU-only mode - which neither pin can express - was
-- used. Two full runs over the 15 A1 scenarios agreed line for line.
--
-- WHAT IT ADDS
--
-- `launch-v2` 2.4.0 = `launch-v2` 2.2.0's configuration with exactly ONE nested
-- value set: `candidate_caps.top_k_by_role = {"CPU": 10}`. The nested `||`
-- preserves `max_builds_per_pair` (the quota of 2) and `max_builds_per_query`,
-- and the outer `||` preserves every other key - `apply_archetype_objectives`,
-- the use-case weights, `resolution_profiles`, penalties, staleness - so a
-- pinned A/B against 2.2.0 isolates the depth axis.
--
-- 2.2.0 (not 2.3.0) is the base ON PURPOSE: 2.3.0 already carries a uniform
-- depth of 10, so building on it would set both keys and make it impossible to
-- tell whether a pair came from the CPU override or from the uniform widening.
--
-- WHAT IT COSTS, RECORDED RATHER THAN HIDDEN
--
-- * Assembly rises toward the 25-build cap on 1440p GAMING passes: measured
--   2026-10-31 at 281 -> 344 assembled builds over one 20-pass sweep (+22%),
--   with 8 passes moving (S03/S10/S11 +14, S14 +12, S06 +4, S18 +2, S19 +2,
--   S07 +1) and 12 already at the cap. The PERSISTED set barely moves -
--   47/371 -> 50/394 build_candidate/build_component rows - because only the
--   selected top-3 set is written, and engine CPU time is unchanged within
--   noise (median 32 ms vs 16 ms over 40 passes each).
-- * A10 moved on S18 and S19: the 2.2.0 pin-scoped approval expected
--   `["BALANCED"]` at S18 and two entries at S19, while CPU-only depth
--   nominates `["BALANCED","VALUE"]` and `["BALANCED","VALUE","PERFORMANCE"]`.
--   Both were APPROVED for this pin on 2026-10-31 (Ibrahim Lahribli) after the
--   added archetypes were checked; the values are the measured output and no
--   threshold moved. Approving the ORDER is not adopting the model: which
--   model ships stays Decision 57's gate.
--
-- ACTIVATION - 2.2.0 AND 2.3.0 STAY ACTIVE ON PURPOSE
--
-- Every row is `is_active = true`. A pin is a selector, not an activation
-- (`scripts/lib/model-pin.js`), so `--model=launch-v2@2.2.0` keeps resolving its
-- committed evidence. The SHARED database deliberately stays on
-- `seed-minimal-v1` (Decision 57) and is NOT a target of this file.
--
-- SCOPE AND SAFETY
--
-- * DML only; no schema change, no migration.
-- * Idempotent: the `NOT EXISTS` guard makes a second apply a no-op. The file
--   does NOT open its own transaction, so it can be rehearsal-wrapped.
-- * TEST-branch-first.
-- * No catalog row is touched, so the Decision 26 `check-deferred-rules.js`
--   trigger does not apply.
--
-- PREREQUISITE
--
-- `launch-v2` 2.2.0 must exist (seed 020). If it does not, the INSERT selects no
-- row and writes nothing (fail-quiet); the SELECT below is the check.
-- ============================================================================

INSERT INTO scoring_model (name, version, description, configuration, is_active)
SELECT
    'launch-v2',
    '2.4.0',
    'OG-56 / Decision 59: launch-v2@2.2.0 plus candidate_caps.top_k_by_role {"CPU": 10}, so CPU-axis pair diversity is bought without widening the seven roles that buy no pair (keeps A5 while turning A1 S06 green).',
    base.configuration || jsonb_build_object(
        'candidate_caps',
        (base.configuration->'candidate_caps')
            || jsonb_build_object('top_k_by_role', jsonb_build_object('CPU', 10))
    ),
    true
FROM scoring_model AS base
WHERE base.name = 'launch-v2'
  AND base.version = '2.2.0'
  AND NOT EXISTS (
      SELECT 1 FROM scoring_model WHERE name = 'launch-v2' AND version = '2.4.0'
  );

-- MEASURED AFTER APPLY (TEST branch, 2026-10-30, engine at commit fc71061)
--
-- `node scripts/eval-scenarios.js --model=launch-v2@2.4.0 --no-baseline
-- --no-volatile`: 86 assertion rows, 81 PASS / 4 EXPECTED-RED / 0 HARD FAIL
-- / 1 UNKNOWN, exit 0, cleanup residue 0.
--
-- * A1 IS GREEN, 15 of 15, exactly 3 distinct pairs on every row - S06 moves
--   EXPECTED-RED -> PASS, which is what this file is for.
-- * A5 PASSES BOTH approved pairs: S10 11246 < S11 11845 and S12 13946 <
--   S13 19246, signatures differ in both. This is the result uniform depth 10
--   could NOT keep, and the whole reason the override is CPU-only.
-- * A10 passes on all five rows against the pin-scoped entry in
--   `test/golden/scenarios.json` that carries THIS pin's measured order (S03
--   and S11 [PERFORMANCE, BALANCED, VALUE], S10 [VALUE, PERFORMANCE, BALANCED],
--   S18 [BALANCED, VALUE], S19 [BALANCED, VALUE, PERFORMANCE]). That entry was
--   APPROVED for this pin on 2026-10-31, so the gate is enforced: a wrong order
--   is a HARD FAIL, where the unscoped two-entry approval fails all five rows.
-- * The 4 EXPECTED-RED rows are the pre-existing A3 x3 and A4 x1 hypotheses and
--   did not move.
-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only)
-- ---------------------------------------------------------------------------
-- SELECT name, version, is_active,
--        configuration->'candidate_caps' AS candidate_caps,
--        configuration->'apply_archetype_objectives' AS applies_objectives
--   FROM scoring_model
--  WHERE name IN ('seed-minimal-v1', 'launch-v2')
--  ORDER BY name, version;
