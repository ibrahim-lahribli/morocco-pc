-- ============================================================================
-- Seed 021: scoring model "launch-v2" 2.3.0 - a deeper candidate cap (OG-56)
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- OG-56 diagnosed the last red A1 row. S06 (GAMING, 1440p, 12000 MAD) selects
-- ONE distinct (CPU, GPU) pair where the approved A1 threshold is 3, and the
-- cause is not the E5 floor and not the quota: at 1440p the 12 GB floor leaves
-- exactly ONE GPU cheap enough to anchor a build at that budget, so every pair
-- must come from the CPU axis - and `top_k_per_role = 5` retains only one CPU
-- whose cheapest assembly still fits. The budget itself is not the lever
-- either (12500 gives 2 pairs and 14500 gives 3, but raising a scenario's
-- budget to make an assertion pass is forbidden).
--
-- Measured on the TEST branch 2026-10-30 with the engine at commit 0d04833,
-- driving the real pipeline stages over the same inputs:
--
--   top_k_per_role   builds   distinct pairs   archetypes       reason codes
--   5                2        1                PERFORMANCE      NO_BALANCED, NO_VALUE
--   8                4        2                2                NO_VALUE
--   10               6        3                all three        none
--   13               8        4                all three        none
--   18              14        7                all three        none
--
-- 10 is the SMALLEST depth that measured A1 green on S06, so this seed carries
-- 10 and nothing else. It is not an H3-reviewed value: OG-44's lesson (do not
-- promote a measured starting point beyond the corpus) applies to a depth
-- exactly as it did to a quota.
--
-- WHAT IT ADDS
--
-- `launch-v2` 2.3.0 = `launch-v2` 2.2.0's configuration with exactly ONE nested
-- value set: `candidate_caps.top_k_per_role = 10`. The `||` on the nested
-- `candidate_caps` object preserves `max_builds_per_pair` (the quota of 2) and
-- `max_builds_per_query`, and the outer `||` preserves every other key -
-- `apply_archetype_objectives`, the use-case weights, `resolution_profiles`,
-- penalties, staleness - so a pinned A/B against 2.2.0 isolates the depth.
--
-- WHY A NEW VERSION AND NOT AN UPDATE OF 2.2.0
--
-- A scoring model is identified by `name@version`; mutating 2.2.0 would make
-- its approved A10 evidence resolve against a different assembly breadth. The
-- recipe is to INSERT a new version (seeds 019 and 020 follow the same rule).
--
-- COST TO WATCH, RECORDED RATHER THAN HIDDEN
--
-- Depth widens the Engine 3 walk for every role, not just CPU. The instrumented
-- run above timed assembly at 3.1 ms (K=5) and 14.2 ms (K=10) for S06, and
-- 5.2 ms to 29.5 ms for S19 on the post-fix engine - single calls, indicative,
-- NOT a benchmark. A pass pays that once per scenario; if it matters, the
-- precise alternative is a per-role cap keyed on CPU only (OG-56's second
-- option), which is a bigger change because `top_k_per_role` is Decision 14's
-- uniform contract.
--
-- ACTIVATION - 2.2.0 STAYS ACTIVE ON PURPOSE
--
-- Both rows are `is_active = true`. A pin is a selector, not an activation
-- (`scripts/lib/model-pin.js`), so `--model=launch-v2@2.2.0` keeps resolving its
-- committed evidence while the API serves 2.3.0 as the NEWEST active row. The
-- SHARED database deliberately stays on `seed-minimal-v1` (Decision 57) and is
-- NOT a target of this file.
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
-- MEASURED AFTER APPLY (TEST branch, 2026-10-30, engine at commit 0d04833)
--
-- `node scripts/eval-scenarios.js --model=launch-v2@2.3.0 --no-baseline
-- --no-volatile`: 86 assertion rows, 75 PASS / 4 EXPECTED-RED / 6 HARD FAIL
-- / 1 UNKNOWN, exit 1, cleanup residue 0.
--
-- * A1 IS GREEN, 15 of 15 rows, every one reporting exactly 3 distinct
--   pairs. S06 moves EXPECTED-RED -> PASS, which is what this file is for.
-- * THE COST IS REAL AND IS NOT HIDDEN. Two approved assertions move:
--   A5 FAILS on S10/S11 because at depth 10 the priority-1 and priority-5
--   rank-1 builds are THE SAME BUILD (signature_differ false, both 11986
--   MAD), so `priority` no longer discriminates rank 1 for GAMING 1080p at
--   12000 - the depth that opens the CPU axis also converges the archetype
--   picks. A10 fails on S03/S10/S11/S18/S19, all five because the unscoped
--   approved order has two entries and this pin returns three.
-- * Therefore 2.3.0 is a MEASUREMENT VERSION, not an adoption: A1 green at
--   the cost of A5 is a trade a reviewer has to accept, and OG-56 records
--   the per-role (CPU-only) alternative that may avoid it.
--
-- PREREQUISITE
--
-- `launch-v2` 2.2.0 must exist (seed 020). If it does not, the INSERT selects no
-- row and writes nothing (fail-quiet); the SELECT below is the check.
-- ============================================================================

INSERT INTO scoring_model (name, version, description, configuration, is_active)
SELECT
    'launch-v2',
    '2.3.0',
    'OG-56: launch-v2@2.2.0 plus candidate_caps.top_k_per_role = 10, so a 1440p 12000 MAD GAMING pass can carry three pair-distinct archetypes from the CPU axis.',
    base.configuration || jsonb_build_object(
        'candidate_caps',
        (base.configuration->'candidate_caps') || jsonb_build_object('top_k_per_role', 10)
    ),
    true
FROM scoring_model AS base
WHERE base.name = 'launch-v2'
  AND base.version = '2.2.0'
  AND NOT EXISTS (
      SELECT 1 FROM scoring_model WHERE name = 'launch-v2' AND version = '2.3.0'
  );

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only)
-- ---------------------------------------------------------------------------
-- SELECT name, version, is_active,
--        configuration->'candidate_caps' AS candidate_caps,
--        configuration->'apply_archetype_objectives' AS applies_objectives
--   FROM scoring_model
--  WHERE name IN ('seed-minimal-v1', 'launch-v2')
--  ORDER BY name, version;
