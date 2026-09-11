-- ===========================================================================
-- Provenance & data-quality infrastructure (migration 007)
--
-- Tables that keep untrusted external data out of the canonical product layer
-- until it has been reviewed and verified:
--
--   ingestion_record       – one row per source ingestion run
--   product_candidate      – normalised product data awaiting canonicalisation
--   retailer_listing_alias – retailer listing → canonical product mapping
--   spec_provenance        – audit trail for every canonical spec value
--
-- Architecture:
--   SOURCE → RAW DATA → PARSING → NORMALIZATION → IDENTITY MATCHING
--          → VALIDATION → CONFLICT DETECTION → HUMAN REVIEW
--          → CANONICAL PRODUCT → PROVENANCE
--
-- Unverified external data never silently becomes canonical product data:
-- candidates and aliases start with confidence = 'UNVERIFIED' and their
-- matched_product_id is NULL. A CHECK constraint prevents a canonical
-- product_id from being assigned until confidence reaches at least MEDIUM.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- ingestion_record
--
-- One row per ingestion run (a single source pulled at a point in time).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_record (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type      source_type NOT NULL,
    source_identifier TEXT NOT NULL,
    status           TEXT NOT NULL,
    record_count     INTEGER,
    raw_payload_hash TEXT,
    started_at       TIMESTAMP NOT NULL DEFAULT now(),
    completed_at     TIMESTAMP,
    error_message    TEXT,

    CONSTRAINT chk_ingestion_status
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_ingestion_status
    ON ingestion_record (status);

CREATE INDEX IF NOT EXISTS idx_ingestion_source
    ON ingestion_record (source_type, source_identifier);


-- ---------------------------------------------------------------------------
-- product_candidate
--
-- Normalised product data extracted from a source but NOT yet promoted to
-- the canonical product table. Rows are reviewed and then either rejected or
-- canonicalised.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_candidate (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingestion_record_id  UUID REFERENCES ingestion_record(id),
    source_type          source_type NOT NULL,
    source_identifier    TEXT,
    manufacturer_name    TEXT,
    product_family_name  TEXT,
    product_name         TEXT,
    sku                  TEXT,
    ean_gtin             TEXT,
    source_category      product_category,
    matched_product_id   UUID REFERENCES product(id),
    confidence           confidence_level NOT NULL DEFAULT 'UNVERIFIED',
    status               TEXT NOT NULL DEFAULT 'UNREVIEWED',
    raw_data             JSONB,
    created_at           TIMESTAMP NOT NULL DEFAULT now(),
    updated_at           TIMESTAMP NOT NULL DEFAULT now(),

    CONSTRAINT chk_candidate_status
        CHECK (status IN ('UNREVIEWED', 'MATCHED', 'REVIEW', 'REJECTED', 'CANONICALIZED')),

    -- Only verified candidates (confidence >= MEDIUM) may reference
    -- a canonical product. Unverified data cannot silently become canonical.
    CONSTRAINT chk_candidate_matched_requires_confidence
        CHECK (
            matched_product_id IS NULL
         OR
            confidence IN ('CONFIRMED', 'HIGH', 'MEDIUM')
        )
);

CREATE INDEX IF NOT EXISTS idx_product_candidate_ingestion
    ON product_candidate (ingestion_record_id);

CREATE INDEX IF NOT EXISTS idx_product_candidate_status
    ON product_candidate (status, confidence);

CREATE INDEX IF NOT EXISTS idx_product_candidate_match
    ON product_candidate (matched_product_id);

CREATE INDEX IF NOT EXISTS idx_product_candidate_sku
    ON product_candidate (sku)
    WHERE sku IS NOT NULL;


-- ---------------------------------------------------------------------------
-- retailer_listing_alias
--
-- Maps a retailer-specific identifier (URL, SKU, etc.) to a canonical
-- product once an identity match has been verified.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retailer_listing_alias (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    retailer_name     TEXT NOT NULL,
    listing_identifier TEXT NOT NULL,
    matched_product_id  UUID REFERENCES product(id),
    confidence        confidence_level NOT NULL DEFAULT 'UNVERIFIED',
    created_at        TIMESTAMP NOT NULL DEFAULT now(),
    updated_at        TIMESTAMP NOT NULL DEFAULT now(),

    -- Only verified aliases (confidence >= MEDIUM) may reference
    -- a canonical product.
    CONSTRAINT chk_alias_matched_requires_confidence
        CHECK (
            matched_product_id IS NULL
         OR
            confidence IN ('CONFIRMED', 'HIGH', 'MEDIUM')
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_retailer_listing
    ON retailer_listing_alias (retailer_name, listing_identifier);

CREATE INDEX IF NOT EXISTS idx_retailer_listing_match
    ON retailer_listing_alias (matched_product_id);


-- ---------------------------------------------------------------------------
-- spec_provenance
--
-- Audit trail: for every canonical spec value, record which source(s)
-- contributed it and at what confidence level.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spec_provenance (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_table     TEXT NOT NULL,
    target_id        UUID NOT NULL,
    target_column    TEXT,
    source_type      source_type NOT NULL,
    confidence       confidence_level NOT NULL DEFAULT 'UNVERIFIED',
    source_identifier TEXT,
    source_note      TEXT,
    reviewed_by      TEXT,
    reviewed_at      TIMESTAMP,
    created_at       TIMESTAMP NOT NULL DEFAULT now(),

    -- Prevent duplicate provenance entries for the same source+target+field.
    CONSTRAINT uq_spec_provenance_target_source_field
        UNIQUE (target_table, target_id, target_column, source_type, source_identifier)
);

CREATE INDEX IF NOT EXISTS idx_spec_provenance_target
    ON spec_provenance (target_table, target_id);

CREATE INDEX IF NOT EXISTS idx_spec_provenance_source
    ON spec_provenance (source_type, confidence);
