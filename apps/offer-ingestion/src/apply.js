/**
 * Apply — writes inside a caller-owned transaction.
 *
 * Writes only Layer 3 tables (`store`, `store_offer`, `price_history`,
 * `ingestion_record`) plus review rows. Never writes Layer 4 tables. The
 * caller owns the transaction (BEGIN / COMMIT / ROLLBACK); this module
 * issues statements on the supplied client and never starts or commits a
 * transaction itself.
 *
 * @see RFC §12.1 — apply.js: only DB writes, inside caller-owned transaction
 * @see RFC §12.4 — Must never write Layer 4 tables; never commit outside a caller-owned transaction
 * @see existing: src/recommendation/ingestion/apply.js
 */

'use strict';

const crypto = require('crypto');

const SOURCE_TYPE = 'RETAILER';
const STATUS_PROCESSING = 'PROCESSING';
const STATUS_COMPLETED = 'COMPLETED';

const INSERT_INGESTION_SQL = [
  'INSERT INTO ingestion_record',
  '  (source_type, source_identifier, status, record_count, raw_payload_hash, started_at)',
  'VALUES ($1, $2, $3, $4, $5, now())',
  'RETURNING id',
].join('\n');

const INSERT_OFFER_SQL = [
  'INSERT INTO store_offer',
  '  (store_id, product_id, product_variant_id, price, currency, availability,',
  '   product_url, seller_name, last_checked_at, fetched_at, listing_identifier, ingestion_record_id)',
  'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)',
  'RETURNING id',
].join('\n');

const UPDATE_OFFER_SQL = [
  'UPDATE store_offer',
  '   SET price = $1, availability = $2, product_url = $3, seller_name = $4,',
  '       last_checked_at = $5, fetched_at = $5, ingestion_record_id = $6, updated_at = now()',
  ' WHERE store_id = $7 AND listing_identifier = $8',
  'RETURNING id',
].join('\n');

const INSERT_HISTORY_SQL = [
  'INSERT INTO price_history',
  '  (store_offer_id, price, currency, availability, observed_at, ingestion_record_id)',
  'VALUES ($1, $2, $3, $4, $5, $6)',
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

const FINISH_INGESTION_SQL = [
  'UPDATE ingestion_record SET status = $2, record_count = $3, completed_at = now() WHERE id = $1',
].join('\n');

function hashPayload(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * Create ONE ingestion_record for the whole run, inside the caller's
 * transaction. Layer 3 only.
 * @param {object} client - pg Client
 * @param {object} options - { sourceIdentifier: string, recordCount: number, rawText: string }
 * @param {Date} [now]
 * @returns {Promise<string>} ingestion_record id
 */
async function createIngestionRecord(client, options, now = new Date()) {
  const { sourceIdentifier = 'unknown', recordCount = 0, rawText = null } = options;
  const result = await client.query(INSERT_INGESTION_SQL, [
    SOURCE_TYPE,
    sourceIdentifier,
    STATUS_PROCESSING,
    recordCount,
    rawText === undefined || rawText === null ? null : hashPayload(rawText),
  ]);
  return String(result.rows[0].id);
}

/**
 * Mark the run's ingestion_record completed.
 * @param {object} client - pg Client
 * @param {string} ingestionRecordId
 * @param {object} [options] - { recordCount?: number }
 * @returns {Promise<void>}
 */
async function finishIngestionRecord(client, ingestionRecordId, options = {}) {
  const recordCount = options.recordCount === undefined || options.recordCount === null ? null : options.recordCount;
  await client.query(FINISH_INGESTION_SQL, [ingestionRecordId, STATUS_COMPLETED, recordCount]);
}

/**
 * Replace-style provenance for one offer row: delete then insert so a
 * re-import cannot duplicate provenance rows (target_column is NULL, so a
 * NULL column in a UNIQUE constraint is not a conflict target).
 * @param {object} client - pg Client
 * @param {string} offerId - store_offer.id
 * @param {object} row - normalized listing row
 * @returns {Promise<void>}
 */
async function writeProvenance(client, offerId, row) {
  await client.query(DELETE_PROVENANCE_SQL, [offerId, SOURCE_TYPE, row.listingIdentifier]);
  await client.query(INSERT_PROVENANCE_SQL, [offerId, SOURCE_TYPE, row.listingIdentifier, row.sourceNote]);
}



/**
 * Update one store_offer row by its natural key (store_id, listing_identifier),
 * append exactly one price_history row, and refresh its provenance.
 * Layer 3 only. The natural key is unique per store (migration 017), so the
 * update touches at most one row.
 * @param {object} client - pg Client
 * @param {object} row - normalized listing row (needs storeId, listingIdentifier, price, ...)
 * @param {Date} now
 * @param {string} ingestionRecordId
 * @returns {Promise<string>} store_offer id
 */
async function updateOfferPrice(client, row, now, ingestionRecordId) {
  const result = await client.query(UPDATE_OFFER_SQL, [
    row.price,
    row.currency,
    row.availability,
    row.seller || null,
    now,
    ingestionRecordId,
    row.storeId,
    row.listingIdentifier,
  ]);
  if (result.rowCount !== 1) {
    throw new Error(
      'store_offer not found for natural key (store_id=' + row.storeId + ', listing_identifier=' + row.listingIdentifier + ')'
    );
  }
  await client.query(INSERT_HISTORY_SQL, [
    result.rows[0].id,
    row.price,
    row.currency,
    row.availability,
    now,
    ingestionRecordId,
  ]);
  await writeProvenance(client, result.rows[0].id, row);
  return String(result.rows[0].id);
}

/**
 * Apply a planned ingestion inside the caller's transaction.
 *
 * Writes only Layer 3 tables (`ingestion_record` once per run, then
 * `store_offer`, `price_history`, `spec_provenance`). Never issues
 * BEGIN / COMMIT / ROLLBACK — the caller owns the transaction. Never
 * touches Layer 4 tables.
 *
 * @param {object} client - pg Client (caller owns BEGIN/COMMIT/ROLLBACK)
 * @param {object} plan - Result from buildPlan()
 * @param {object} options - { now: Date, sourceIdentifier: string, ingestionRecordId: string }
 * @returns {Promise<{ applied: number, inserted: number, updated: number, history: number, ingestionRecordId: string }>}
 */
async function applyPlan(client, plan, options = {}) {
  const { now = new Date(), sourceIdentifier = 'unknown', ingestionRecordId } = options;
  if (!ingestionRecordId) {
    throw new Error('applyPlan requires options.ingestionRecordId (one ingestion_record per run)');
  }

  let applied = 0;
  let inserted = 0;
  let updated = 0;
  let history = 0;

  for (const insert of plan.inserts) {
    const row = insert.row;
    const match = insert.match;
    const result = await client.query(INSERT_OFFER_SQL, [
      row.storeId,
      match.productId,
      match.variantId === undefined ? null : match.variantId,
      row.price,
      row.currency,
      row.availability,
      row.productUrl,
      row.seller || null,
      now,
      row.listingIdentifier,
      ingestionRecordId,
    ]);
    inserted += 1;
    applied += 1;
    await writeProvenance(client, String(result.rows[0].id), row);
  }

  for (const update of plan.updates) {
    await updateOfferPrice(client, update.row, now, ingestionRecordId);
    updated += 1;
    history += 1;
    applied += 1;
  }

  return { applied, inserted, updated, history, ingestionRecordId };
}

module.exports = {
  SOURCE_TYPE,
  STATUS_PROCESSING,
  STATUS_COMPLETED,
  createIngestionRecord,
  finishIngestionRecord,
  applyPlan,
  updateOfferPrice,
  writeProvenance,
  hashPayload,
};