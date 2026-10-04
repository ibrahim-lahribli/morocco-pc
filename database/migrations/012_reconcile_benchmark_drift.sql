-- ===========================================================================
-- Reconcile live-only Layer 2 drift (migration 012)
--
-- Gap: OG-25 (docs/OPEN_GAPS.md), discovered by the OG-13 empty-database
-- replay on 2026-09-30. That replay found that the live Neon database holds
-- MORE than migrations 001-011 create, in the Layer 2 (benchmark) tables:
--
--   1. The three benchmark CHECK constraints lost their `IS NULL OR` escape
--      hatch live, so they now enforce `> 0` even for what would have been a
--      NULL value. This migration adopts the stricter live form as canonical.
--   2. `chk_benchmark_result_metric_value_finite` exists live only; it is
--      semantically `metric_value IS NOT NULL` (a NUMERIC column can hold
--      'Infinity'/'-Infinity'/'NaN', and this CHECK is the deployed attempt
--      to fence the pathological values). Adopted verbatim.
--   3. Five performance indexes exist live only: a UNIQUE index on
--      `benchmark_source.name`, plus plain indexes on
--      `benchmark.benchmark_source_id`,
--      `component_assessment.product_id`,
--      `component_assessment.assessment_type`, and
--      `scoring_model.is_active`. Adopted verbatim.
--
-- Provenance of the live-only objects is unknown (pre-migration manual work or
-- a lost migration); this migration makes the migrations tree a faithful
-- description of the live schema instead of leaving the drift undocumented.
--
-- Engine-relevant impact: NONE. No engine module reads benchmark_source.name
-- uniqueness, the benchmark tables' CHECKs, or any of these five indexes. This
-- is schema-documentation reconciliation, not behaviour change. It is safe to
-- apply on a fresh database AND on the live database, because every statement
-- is drop-then-recreate with IF EXISTS / IF NOT EXISTS guards.
--
-- Line endings: CRLF (repo convention).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) benchmark: adopt the stricter resolution CHECKs (drop the NULL escape)
-- ---------------------------------------------------------------------------
ALTER TABLE benchmark DROP CONSTRAINT IF EXISTS chk_benchmark_resolution_width_positive;
ALTER TABLE benchmark DROP CONSTRAINT IF EXISTS chk_benchmark_resolution_height_positive;
ALTER TABLE benchmark
    ADD CONSTRAINT chk_benchmark_resolution_width_positive CHECK (resolution_width > 0),
    ADD CONSTRAINT chk_benchmark_resolution_height_positive CHECK (resolution_height > 0);

-- ---------------------------------------------------------------------------
-- 2) benchmark_result: adopt the stricter sample_size CHECK and the
--    metric_value finiteness CHECK
-- ---------------------------------------------------------------------------
ALTER TABLE benchmark_result DROP CONSTRAINT IF EXISTS chk_benchmark_result_sample_size_positive;
ALTER TABLE benchmark_result
    ADD CONSTRAINT chk_benchmark_result_sample_size_positive CHECK (sample_size > 0);

ALTER TABLE benchmark_result DROP CONSTRAINT IF EXISTS chk_benchmark_result_metric_value_finite;
ALTER TABLE benchmark_result
    ADD CONSTRAINT chk_benchmark_result_metric_value_finite CHECK (metric_value IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3) the five live-only indexes
--    (the UNIQUE on benchmark_source.name requires names to be distinct; the
--    live catalog satisfies this, seed 001's 'Seed TechPowerUp' is unique)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmark_source_name
    ON benchmark_source(name);
CREATE INDEX IF NOT EXISTS idx_benchmark_source_id
    ON benchmark(benchmark_source_id);
CREATE INDEX IF NOT EXISTS idx_component_assessment_product_id
    ON component_assessment(product_id);
CREATE INDEX IF NOT EXISTS idx_component_assessment_type
    ON component_assessment(assessment_type);
CREATE INDEX IF NOT EXISTS idx_scoring_model_active
    ON scoring_model(is_active);
