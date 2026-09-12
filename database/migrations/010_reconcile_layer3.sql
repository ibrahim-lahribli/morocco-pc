-- ===========================================================================
-- Layer 3: Reconcile the existing database with the canonical market schema.
-- Existing timestamp-without-time-zone values represent UTC timestamps.
-- ===========================================================================

ALTER TABLE store
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE store_offer
    ALTER COLUMN last_checked_at TYPE TIMESTAMPTZ USING last_checked_at AT TIME ZONE 'UTC',
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
    ALTER COLUMN availability SET NOT NULL,
    ALTER COLUMN last_checked_at SET NOT NULL;

ALTER TABLE price_history
    ALTER COLUMN observed_at TYPE TIMESTAMPTZ USING observed_at AT TIME ZONE 'UTC',
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
    ALTER COLUMN availability SET NOT NULL;

ALTER TABLE store_offer
    DROP CONSTRAINT IF EXISTS chk_store_offer_price_nonneg,
    DROP CONSTRAINT IF EXISTS chk_store_offer_price_positive,
    DROP CONSTRAINT IF EXISTS chk_store_offer_currency_not_empty,
    DROP CONSTRAINT IF EXISTS chk_store_offer_availability_not_empty,
    ADD CONSTRAINT chk_store_offer_price_positive CHECK (price > 0),
    ADD CONSTRAINT chk_store_offer_currency_not_empty CHECK (btrim(currency) <> ''),
    ADD CONSTRAINT chk_store_offer_availability_not_empty CHECK (btrim(availability) <> '');

ALTER TABLE price_history
    DROP CONSTRAINT IF EXISTS chk_price_history_price_nonneg,
    DROP CONSTRAINT IF EXISTS chk_price_history_price_positive,
    DROP CONSTRAINT IF EXISTS chk_price_history_currency_not_empty,
    DROP CONSTRAINT IF EXISTS chk_price_history_availability_not_empty,
    ADD CONSTRAINT chk_price_history_price_positive CHECK (price > 0),
    ADD CONSTRAINT chk_price_history_currency_not_empty CHECK (btrim(currency) <> ''),
    ADD CONSTRAINT chk_price_history_availability_not_empty CHECK (btrim(availability) <> '');

ALTER TABLE store
    DROP CONSTRAINT IF EXISTS chk_store_name_not_empty,
    ADD CONSTRAINT chk_store_name_not_empty CHECK (btrim(name) <> '');

ALTER TABLE store_offer
    DROP CONSTRAINT IF EXISTS uq_store_offer_store_product_variant;

DROP INDEX IF EXISTS uq_store_offer_store_product_variant;

DROP INDEX IF EXISTS idx_price_history_store_offer_id;
DROP INDEX IF EXISTS idx_price_history_store_offer_observed_at;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'idx_price_history_store_offer_observed'
          AND indexdef NOT LIKE '%(store_offer_id, observed_at DESC)%'
    ) THEN
        DROP INDEX idx_price_history_store_offer_observed;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_store_active ON store(is_active);
CREATE INDEX IF NOT EXISTS idx_store_offer_store_id ON store_offer(store_id);
CREATE INDEX IF NOT EXISTS idx_store_offer_product_id ON store_offer(product_id);
CREATE INDEX IF NOT EXISTS idx_store_offer_product_variant_id ON store_offer(product_variant_id);
CREATE INDEX IF NOT EXISTS idx_store_offer_last_checked_at ON store_offer(last_checked_at);
CREATE INDEX IF NOT EXISTS idx_price_history_store_offer_observed ON price_history(store_offer_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_observed_at ON price_history(observed_at);