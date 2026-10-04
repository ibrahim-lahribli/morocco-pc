-- ===========================================================================
-- Seed 006: offer-freshness refresh (OG-30)
--
-- Purpose: re-stamp store_offer.last_checked_at for the seed-catalog offers
-- so Stage 1 (offers/select.js:70, Decision 7: last_checked_at >=
-- CURRENT_TIMESTAMP - INTERVAL '30 days', re-enforced in JS) keeps finding
-- them. Seeds 001/002 wrote last_checked_at = NOW() once at apply time and
-- nothing ever refreshed it (DATA_STATE.md checked-range 2026-09-19 to
-- 2026-09-25); unrenewed, the oldest rows expire 2026-10-19 and every query
-- fails with EMPTY_CANDIDATE_POOL by 2026-10-25.
--
-- Scope: timestamp columns ONLY. Prices, currency, availability, seller and
-- URL are untouched, so this UPDATE creates no new offer semantics and
-- OG-06 (price VALUE accuracy) stays open by design: eligibility is renewed,
-- accuracy is not. No price_history rows are appended: price_history is
-- append-only with no retention rule (status review K15), and a refresh that
-- observed no price change must not grow it by 101 rows per run.
--
-- Conventions (identical to 001/002/005):
--   * DML only, no DDL. Single BEGIN/COMMIT: all-or-nothing per run.
--   * Idempotent: only rows older than 7 days are touched, so a second run
--     changes zero rows. A price CORRECTION is never done here (002 header:
--     correcting a price INSERTs a second offer; store_offer has no unique
--     key, so UPDATE must never rewrite price/currency/availability).
--   * Seed rows only (product.name LIKE 'Seed %'): never touches real data.
--   * ASCII only.
-- ===========================================================================

BEGIN;

UPDATE store_offer o
SET last_checked_at = NOW(),
    updated_at = NOW()
FROM product p
WHERE o.product_id = p.id
  AND p.name LIKE 'Seed %'
  AND o.last_checked_at < NOW() - INTERVAL '7 days';

COMMIT;
