-- ===========================================================================
-- Migration 011: Reconcile Layer 4 (Recommendation / Build) schema
--
-- Dual-mode reconciliation, following the pattern of migrations 005 and 010:
--
--   Fresh DB:      001 -> ... -> 010 -> 011 -> canonical Layer 4
--   Existing Neon: existing (undocumented, empty) Layer 4 objects -> 011
--                  -> canonical Layer 4
--
-- Safety gate:
--   * If none of the five Layer 4 tables exist (fresh DB), the canonical
--     schema is created normally.
--   * If all five exist (existing database), reconciliation is only allowed
--     when every table contains zero rows and the existing component_role
--     enum (if present) contains exactly the nine expected values.
--   * Any other state FAILS SAFELY instead of transforming user data.
--
-- Canonical decisions (see database/LAYER4_RECONCILIATION_PLAN.md):
--   * component_role enum: CPU, GPU, MOTHERBOARD, RAM, SSD_BOOT,
--     SSD_SECONDARY, PSU, CASE, CPU_COOLER (never altered)
--   * recommendation_query.scoring_model_id NOT NULL
--   * build_candidate.compatibility_status NOT NULL DEFAULT 'UNKNOWN'
--   * build_candidate.total_price nullable, > 0 when present
--   * build_component.selected_price > 0
--   * build_component.price_checked_at TIMESTAMPTZ
--   * store_id IS NULL OR price_checked_at IS NOT NULL
--   * build_component.category removed (redundant with component_role)
--   * unique non-NULL rank per recommendation query
--   * singular-role uniqueness (one CPU / MOTHERBOARD / PSU / CASE /
--     CPU_COOLER / SSD_BOOT per candidate; GPU / RAM / SSD_SECONDARY multiple)
--   * recommendation_profile.name unique
--   * recommendation_profile.priority stays INTEGER (FUTURE redesign)
--   * store_offer_id on build_component NOT added (FUTURE / non-blocking)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Safety gate
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_table_count INTEGER;
    v_row_count   BIGINT;
    v_enum_values TEXT;
    t TEXT;
BEGIN
    SELECT count(*)
      INTO v_table_count
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN (
           'recommendation_profile',
           'recommendation_query',
           'build_candidate',
           'build_component',
           'recommendation_result'
       );

    IF v_table_count = 0 THEN
        RAISE NOTICE 'Migration 011: no Layer 4 tables found; fresh canonical schema will be created.';
        RETURN;
    END IF;

    IF v_table_count <> 5 THEN
        RAISE EXCEPTION
            'Migration 011 safety gate: only % of 5 expected Layer 4 tables exist. Refusing to reconcile a partial Layer 4 state.',
            v_table_count;
    END IF;

    -- All five tables must be empty before reconciliation.
    FOR t IN
        SELECT unnest(ARRAY[
            'recommendation_profile',
            'recommendation_query',
            'build_candidate',
            'build_component',
            'recommendation_result'
        ])
    LOOP
        EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_row_count;
        IF v_row_count <> 0 THEN
            RAISE EXCEPTION
                'Migration 011 safety gate: table % contains % row(s). Reconciliation requires empty Layer 4 tables; aborting without modifying data.',
                t, v_row_count;
        END IF;
    END LOOP;

    -- If component_role already exists, it must contain exactly the expected values.
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'component_role' AND typnamespace = 'public'::regnamespace) THEN
        SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
          INTO v_enum_values
          FROM pg_enum e
         WHERE e.enumtypid = 'public.component_role'::regtype;

        IF v_enum_values IS DISTINCT FROM
           'CPU, GPU, MOTHERBOARD, RAM, SSD_BOOT, SSD_SECONDARY, PSU, CASE, CPU_COOLER' THEN
            RAISE EXCEPTION
                'Migration 011 safety gate: existing component_role enum has unexpected values (%). Aborting.',
                v_enum_values;
        END IF;
    END IF;

    RAISE NOTICE 'Migration 011: safety gate passed (5 empty Layer 4 tables, component_role values verified).';
END
$$;

-- ---------------------------------------------------------------------------
-- 2. component_role enum (fresh DBs only; never altered on existing DBs)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type
        WHERE typname = 'component_role' AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE component_role AS ENUM (
            'CPU',
            'GPU',
            'MOTHERBOARD',
            'RAM',
            'SSD_BOOT',
            'SSD_SECONDARY',
            'PSU',
            'CASE',
            'CPU_COOLER'
        );
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Canonical Layer 4 tables (fresh DBs; existing DBs reconciled below)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recommendation_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    use_case TEXT,
    priority INTEGER,
    default_resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendation_query (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_profile_id UUID REFERENCES recommendation_profile(id),
    scoring_model_id UUID NOT NULL REFERENCES scoring_model(id),
    budget_amount NUMERIC NOT NULL,
    currency TEXT NOT NULL,
    use_case TEXT,
    priority INTEGER,
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_recommendation_query_budget_positive CHECK (budget_amount > 0)
);

CREATE TABLE IF NOT EXISTS build_candidate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_query_id UUID NOT NULL REFERENCES recommendation_query(id),
    total_price NUMERIC,
    compatibility_status compatibility_status NOT NULL DEFAULT 'UNKNOWN',
    score NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_build_candidate_total_price_positive CHECK (total_price IS NULL OR total_price > 0),
    CONSTRAINT chk_build_candidate_score_range CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);

CREATE TABLE IF NOT EXISTS build_component (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    build_candidate_id UUID NOT NULL REFERENCES build_candidate(id),
    product_id UUID NOT NULL REFERENCES product(id),
    product_variant_id UUID REFERENCES product_variant(id),
    component_role component_role NOT NULL,
    selected_price NUMERIC NOT NULL,
    currency TEXT NOT NULL,
    store_id UUID REFERENCES store(id),
    price_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_build_component_selected_price_positive CHECK (selected_price > 0),
    CONSTRAINT chk_build_component_store_requires_checked_at
        CHECK (store_id IS NULL OR price_checked_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS recommendation_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_query_id UUID NOT NULL REFERENCES recommendation_query(id),
    build_candidate_id UUID REFERENCES build_candidate(id),
    rank INTEGER,
    explanation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_recommendation_result_rank_positive CHECK (rank > 0)
);

-- ---------------------------------------------------------------------------
-- 4. Reconcile phase (no-ops on fresh DBs; repairs the existing database)
-- ---------------------------------------------------------------------------

-- 4.1 Remove the redundant build_component.category column.
ALTER TABLE build_component
    DROP COLUMN IF EXISTS category;

-- 4.2 Convert any remaining naive Layer 4 timestamps to TIMESTAMPTZ (UTC).
--     Migration 010 established naive timestamps as UTC. The AT TIME ZONE
--     conversion is applied only to columns that are still naive, so this is
--     safe against either starting state and never double-shifts an
--     already-converted TIMESTAMPTZ value.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT table_name, column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN (
               'recommendation_profile',
               'recommendation_query',
               'build_candidate',
               'build_component',
               'recommendation_result'
           )
           AND data_type = 'timestamp without time zone'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.%I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE %L',
            r.table_name, r.column_name, r.column_name, 'UTC'
        );
    END LOOP;
END
$$;

-- 4.3 Required fields.
ALTER TABLE recommendation_query
    ALTER COLUMN scoring_model_id SET NOT NULL;

ALTER TABLE build_candidate
    ALTER COLUMN compatibility_status SET DEFAULT 'UNKNOWN',
    ALTER COLUMN compatibility_status SET NOT NULL;

-- 4.4 Canonical price CHECKs (drop-then-add keeps this idempotent).
ALTER TABLE build_component
    DROP CONSTRAINT IF EXISTS chk_build_component_selected_price_nonneg;

ALTER TABLE build_candidate
    DROP CONSTRAINT IF EXISTS chk_build_candidate_total_price_nonneg;

ALTER TABLE build_component
    DROP CONSTRAINT IF EXISTS chk_build_component_selected_price_positive,
    ADD CONSTRAINT chk_build_component_selected_price_positive CHECK (selected_price > 0);

ALTER TABLE build_candidate
    DROP CONSTRAINT IF EXISTS chk_build_candidate_total_price_positive,
    ADD CONSTRAINT chk_build_candidate_total_price_positive
        CHECK (total_price IS NULL OR total_price > 0);

-- 4.5 Store / price-snapshot consistency.
ALTER TABLE build_component
    DROP CONSTRAINT IF EXISTS chk_build_component_store_requires_checked_at,
    ADD CONSTRAINT chk_build_component_store_requires_checked_at
        CHECK (store_id IS NULL OR price_checked_at IS NOT NULL);

-- 4.6 Canonicalize the remaining broad CHECKs so both starting states end
--     with identical definitions.
ALTER TABLE recommendation_query
    DROP CONSTRAINT IF EXISTS chk_recommendation_query_budget_positive,
    ADD CONSTRAINT chk_recommendation_query_budget_positive CHECK (budget_amount > 0);

ALTER TABLE build_candidate
    DROP CONSTRAINT IF EXISTS chk_build_candidate_score_range,
    ADD CONSTRAINT chk_build_candidate_score_range
        CHECK (score IS NULL OR (score >= 0 AND score <= 100));

ALTER TABLE recommendation_result
    DROP CONSTRAINT IF EXISTS chk_recommendation_result_rank_positive,
    ADD CONSTRAINT chk_recommendation_result_rank_positive CHECK (rank > 0);

-- ---------------------------------------------------------------------------
-- 5. Index phase
-- ---------------------------------------------------------------------------

-- 5.1 Recommendation-result ranking: duplicate non-NULL ranks are impossible
--     within one recommendation query. This index also covers
--     (query_id, rank) access; the standalone query_id index stays for
--     NULL-rank lookups.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendation_result_query_rank
    ON recommendation_result (recommendation_query_id, rank)
    WHERE rank IS NOT NULL;

-- 5.2 Singular component roles: at most one CPU, MOTHERBOARD, PSU, CASE,
--     CPU_COOLER, or SSD_BOOT per build candidate. GPU, RAM, and
--     SSD_SECONDARY remain allowed in multiples.
CREATE UNIQUE INDEX IF NOT EXISTS uq_build_component_role_singular
    ON build_component (build_candidate_id, component_role)
    WHERE component_role IN ('CPU','MOTHERBOARD','PSU','CASE','CPU_COOLER','SSD_BOOT');

-- 5.3 Profile names are configuration-like identifiers; make them unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_profile_name
    ON recommendation_profile (name);

-- 5.4 Access indexes.
CREATE INDEX IF NOT EXISTS idx_build_component_product_variant_id
    ON build_component (product_variant_id);
CREATE INDEX IF NOT EXISTS idx_build_component_store_id
    ON build_component (store_id);
CREATE INDEX IF NOT EXISTS idx_build_candidate_recommendation_query_id
    ON build_candidate (recommendation_query_id);
CREATE INDEX IF NOT EXISTS idx_build_component_build_candidate_id
    ON build_component (build_candidate_id);
CREATE INDEX IF NOT EXISTS idx_build_component_product_id
    ON build_component (product_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_profile_use_case
    ON recommendation_profile (use_case);
CREATE INDEX IF NOT EXISTS idx_recommendation_query_profile_id
    ON recommendation_query (recommendation_profile_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_query_scoring_model_id
    ON recommendation_query (scoring_model_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_result_build_candidate_id
    ON recommendation_result (build_candidate_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_result_recommendation_query_id
    ON recommendation_result (recommendation_query_id);



