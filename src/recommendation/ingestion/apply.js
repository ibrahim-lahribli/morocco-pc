/**
 * Ingestion — apply layer (DB writes).
 *
 * Boundary: all ingestion WRITES live here. The caller owns the transaction
 * (`BEGIN` / `COMMIT` / `ROLLBACK`); this module issues parameterized
 * statements only and never begins or commits one.
 *
 * Idempotency: UNCHANGED listings produce NO statements at all. A re-run of the
 * same file therefore writes nothing. Provenance is written REPLACE-style
 * (scoped DELETE then INSERT) so a re-insert cannot duplicate it — the same
 * pattern Decision 31 set for build_rejection, and necessary because
 * spec_provenance.target_column may be NULL and a NULL column in a UNIQUE
 * constraint is not a conflict target.
 *
 * Provenance confidence is deliberately 'UNVERIFIED': a manual import records
 * WHERE and WHEN the price was collected (source_note) but is not a
 * verification pass, and fetched_at alone is never evidence of verification.
 */

'use strict';

const crypto = require('crypto');

const SOURCE_TYPE = 'RETAILER';

const INSERT_OFFER_SQL = [
  'INSERT INTO store_offer',
  '  (store_id, product_id, product_variant_id, price, currency, availability,',
  '   product_url, seller_name, last_checked_at, listing_identifier, fetched_at, ingestion_record_id)',
  'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$11)',
  'RETURNING id',
].join('\n');

const UPDATE_OFFER_SQL = [
  'UPDATE store_offer',
  '   SET price = $1, availability = $2, product_url = $3, seller_name = $4,',
  '       last_checked_at = $5, fetched_at = $5, ingestion_record_id = $6, updated_at = now()',
  ' WHERE id = $7',
].join('\n');

const INSERT_HISTORY_SQL = [
  'INSERT INTO price_history',
  '  (store_offer_id, price, currency, availability, observed_at, ingestion_record_id)',
  'VALUES ($1,$2,$3,$4,$5,$6)',
].join('\n');

const DELETE_PROVENANCE_SQL = [
  "DELETE FROM spec_provenance",
  " WHERE target_table = 'store_offer' AND target_id = $1",
  "   AND source_type = $2 AND source_identifier = $3",
].join('\n');

const INSERT_PROVENANCE_SQL = [
  'INSERT INTO spec_provenance',
  '  (target_table, target_id, target_column, source_type, confidence, source_identifier, source_note)',
  "VALUES ('store_offer', $1, NULL, $2, 'UNVERIFIED', $3, $4)",
].join('\n');

const INSERT_REVIEW_SQL = [
  'INSERT INTO product_candidate',
  '  (ingestion_record_id, source_type, source_identifier, product_name, sku, confidence, status, raw_data)',
  'VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
].join('\n');

const INSERT_INGESTION_SQL = [
  'INSERT INTO ingestion_record',
  '  (source_type, source_identifier, status, record_count, raw_payload_hash, started_at)',
  'VALUES ($1,$2,$3,$4,$5, now())',
  'RETURNING id',
].join('\n');

const FINISH_INGESTION_SQL = [
  'UPDATE ingestion_record SET status = $2, record_count = $3, completed_at = now() WHERE id = $1',
].join('\n');

function hashPayload(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

async function createIngestionRecord(db, { sourceIdentifier, recordCount, rawText }) {
  const result = await db.query(INSERT_INGESTION_SQL, [
    SOURCE_TYPE,
    sourceIdentifier,
    'PROCESSING',
    recordCount,
    rawText === undefined ? null : hashPayload(rawText),
  ]);
  return result.rows[0].id;
}

async function finishIngestionRecord(db, id, { status, recordCount, errorMessage }) {
  await db.query(
    'UPDATE ingestion_record SET status = $2, record_count = $3, completed_at = now(), error_message = $4 WHERE id = $1',
    [id, status, recordCount === undefined ? null : recordCount, errorMessage === undefined ? null : errorMessage]
  );
}

async function writeProvenance(db, offerId, listing) {
  await db.query(DELETE_PROVENANCE_SQL, [offerId, SOURCE_TYPE, listing.listing_identifier]);
  await db.query(INSERT_PROVENANCE_SQL, [offerId, SOURCE_TYPE, listing.listing_identifier, listing.source_note]);
}

/**
 * Apply a built plan. Must be called inside the caller's transaction.
 * @param {object} db pg-compatible client
 * @param {object} plan from buildPlan
 * @param {{ingestionRecordId:string, sourceIdentifier?:string}} options
 * @returns {Promise<{inserted:number, updated:number, history:number, reviews:number}>}
 */
async function applyPlan(db, plan, options) {
  const ingestionRecordId = options.ingestionRecordId;
  const sourceIdentifier = options.sourceIdentifier || null;
  const counts = { inserted: 0, updated: 0, history: 0, reviews: 0 };

  for (const item of plan.newOffers) {
    const l = item.listing;
    const inserted = await db.query(INSERT_OFFER_SQL, [
      item.store_id,
      item.match.matched_product_id,
      item.match.matched_product_variant_id,
      l.price,
      l.currency,
      l.availability,
      l.product_url,
      l.store_name,
      l.observed_at,
      l.listing_identifier,
      ingestionRecordId,
    ]);
    counts.inserted += 1;
    await writeProvenance(db, inserted.rows[0].id, l);
  }

  for (const item of plan.changed) {
    const l = item.listing;
    await db.query(UPDATE_OFFER_SQL, [
      l.price,
      l.availability,
      l.product_url,
      l.store_name,
      l.observed_at,
      ingestionRecordId,
      item.existing.id,
    ]);
    counts.updated += 1;
    if (item.promotion.appendHistory) {
      await db.query(INSERT_HISTORY_SQL, [
        item.existing.id,
        l.price,
        l.currency,
        l.availability,
        l.observed_at,
        ingestionRecordId,
      ]);
      counts.history += 1;
    }
    await writeProvenance(db, item.existing.id, l);
  }

  for (const item of plan.review.concat(plan.unmatched)) {
    const l = item.listing;
    await db.query(INSERT_REVIEW_SQL, [
      ingestionRecordId,
      SOURCE_TYPE,
      sourceIdentifier,
      l.title || null,
      l.sku || null,
      item.match.confidence || 'UNVERIFIED',
      'REVIEW',
      JSON.stringify(l.raw_data === null ? { listing_identifier: l.listing_identifier } : l.raw_data),
    ]);
    counts.reviews += 1;
  }

  return counts;
}

module.exports = {
  SOURCE_TYPE,
  createIngestionRecord,
  finishIngestionRecord,
  applyPlan,
  hashPayload,
};
