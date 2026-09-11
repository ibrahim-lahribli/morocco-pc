-- ===========================================================================
-- Layer 2: Knowledge & Assessment (migration 008)
--
-- Adds benchmark sources, benchmark definitions, benchmark results, curated
-- component assessments, and scoring model metadata.
--
-- Architecture:
--   Layer 2 is knowledge and assessment. It does NOT contain retailer offers,
--   current prices, price history, recommendation queries, build candidates,
--   build components, or user preferences.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assessment_type') THEN
    CREATE TYPE assessment_type AS ENUM (
        'PERFORMANCE',
        'VALUE',
        'QUALITY',
        'UPGRADEABILITY',
        'THERMALS',
        'EFFICIENCY'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- benchmark_source
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS benchmark_source (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    organization TEXT,
    url TEXT,
    methodology_notes TEXT,
    source_type source_type,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- benchmark
--
-- Benchmark conditions are explicit so different tests are distinguishable.
-- Unknown conditions remain NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS benchmark (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    benchmark_source_id UUID NOT NULL REFERENCES benchmark_source(id),
    name TEXT NOT NULL,
    game_name TEXT,
    workload_type TEXT,
    resolution_width INTEGER,
    resolution_height INTEGER,
    preset TEXT,
    ray_tracing_enabled BOOLEAN,
    upscaling_technology TEXT,
    upscaling_mode TEXT,
    frame_generation_enabled BOOLEAN,
    game_version TEXT,
    benchmark_method TEXT,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_benchmark_resolution_width_positive CHECK (resolution_width IS NULL OR resolution_width > 0),
    CONSTRAINT chk_benchmark_resolution_height_positive CHECK (resolution_height IS NULL OR resolution_height > 0)
);

-- Ensure FK exists even if table was created before this migration
ALTER TABLE benchmark
    DROP CONSTRAINT IF EXISTS benchmark_benchmark_source_id_fkey,
    ADD CONSTRAINT benchmark_benchmark_source_id_fkey FOREIGN KEY (benchmark_source_id) REFERENCES benchmark_source(id);

-- ---------------------------------------------------------------------------
-- benchmark_result
--
-- Stores OBSERVED MEASUREMENTS only. No gaming score, recommendation score,
-- value score, ranking, "best GPU", or recommendation weight.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS benchmark_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    benchmark_id UUID NOT NULL REFERENCES benchmark(id),
    product_id UUID NOT NULL REFERENCES product(id),
    metric_name TEXT NOT NULL,
    metric_value NUMERIC NOT NULL,
    metric_unit TEXT NOT NULL,
    sample_size INTEGER,
    minimum_value NUMERIC,
    maximum_value NUMERIC,
    percentile_1 NUMERIC,
    percentile_01 NUMERIC,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_benchmark_result_sample_size_positive CHECK (sample_size IS NULL OR sample_size > 0),
    CONSTRAINT chk_benchmark_result_minimum_le_value CHECK (minimum_value IS NULL OR metric_value IS NULL OR minimum_value <= metric_value),
    CONSTRAINT chk_benchmark_result_maximum_ge_value CHECK (maximum_value IS NULL OR metric_value IS NULL OR maximum_value >= metric_value),
    CONSTRAINT chk_benchmark_result_percentile_1_le_value CHECK (percentile_1 IS NULL OR metric_value IS NULL OR percentile_1 <= metric_value),
    CONSTRAINT chk_benchmark_result_percentile_01_le_value CHECK (percentile_01 IS NULL OR metric_value IS NULL OR percentile_01 <= metric_value)
);

-- Remove any pre-existing duplicate unique index on the same key
DROP INDEX IF EXISTS idx_benchmark_result_unique;

ALTER TABLE benchmark_result
    DROP CONSTRAINT IF EXISTS uq_benchmark_result_benchmark_product_metric,
    ADD CONSTRAINT uq_benchmark_result_benchmark_product_metric UNIQUE (benchmark_id, product_id, metric_name, metric_unit);

CREATE INDEX IF NOT EXISTS idx_benchmark_result_benchmark_id ON benchmark_result(benchmark_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_result_product_id ON benchmark_result(product_id);

-- ---------------------------------------------------------------------------
-- component_assessment
--
-- Curated/editorial assessments. NOT the recommendation algorithm.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS component_assessment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES product(id),
    assessment_type assessment_type NOT NULL,
    score NUMERIC,
    rating TEXT,
    summary TEXT,
    rationale TEXT,
    confidence confidence_level,
    source_type source_type,
    assessed_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT chk_component_assessment_score_range CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);

-- Upgrade assessment_type from TEXT to enum on existing databases
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'component_assessment'
      AND column_name = 'assessment_type'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE component_assessment
        ALTER COLUMN assessment_type TYPE assessment_type USING assessment_type::text::assessment_type;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- scoring_model
--
-- Identifies future algorithm versions/configuration. JSONB is intentional
-- for versioned algorithm/configuration data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scoring_model (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    configuration JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uq_scoring_model_name_version UNIQUE (name, version)
);
