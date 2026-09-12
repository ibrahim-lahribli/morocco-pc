-- ===========================================================================
-- Layer 3: Market / Availability (migration 009)
--
-- Current retailer state lives in store_offer. Historical observations live in
-- price_history and are append-only by schema design.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS store (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    website_url TEXT,
    country_code TEXT,
    currency_code TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_store_name_not_empty CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS store_offer (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES store(id),
    product_id UUID NOT NULL REFERENCES product(id),
    product_variant_id UUID REFERENCES product_variant(id),
    price NUMERIC NOT NULL,
    currency TEXT NOT NULL,
    availability TEXT NOT NULL,
    product_url TEXT,
    seller_name TEXT,
    last_checked_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_store_offer_price_positive CHECK (price > 0),
    CONSTRAINT chk_store_offer_currency_not_empty CHECK (btrim(currency) <> ''),
    CONSTRAINT chk_store_offer_availability_not_empty CHECK (btrim(availability) <> '')
);

CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_offer_id UUID NOT NULL REFERENCES store_offer(id),
    price NUMERIC NOT NULL,
    currency TEXT NOT NULL,
    availability TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_price_history_price_positive CHECK (price > 0),
    CONSTRAINT chk_price_history_currency_not_empty CHECK (btrim(currency) <> ''),
    CONSTRAINT chk_price_history_availability_not_empty CHECK (btrim(availability) <> '')
);

CREATE INDEX IF NOT EXISTS idx_store_offer_store_id ON store_offer(store_id);
CREATE INDEX IF NOT EXISTS idx_store_offer_product_id ON store_offer(product_id);
CREATE INDEX IF NOT EXISTS idx_store_offer_product_variant_id ON store_offer(product_variant_id);
CREATE INDEX IF NOT EXISTS idx_store_offer_last_checked_at ON store_offer(last_checked_at);
CREATE INDEX IF NOT EXISTS idx_store_active ON store(is_active);
CREATE INDEX IF NOT EXISTS idx_price_history_store_offer_observed ON price_history(store_offer_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_observed_at ON price_history(observed_at);
