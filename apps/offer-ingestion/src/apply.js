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

/**
 * Apply a planned ingestion inside the caller's transaction.
 * @param {object} client - pg Client (caller owns BEGIN/COMMIT/ROLLBACK)
 * @param {object} plan - Result from buildPlan()
 * @param {object} options - { now: Date, sourceIdentifier: string, rawText: string }
 * @returns {Promise<{ applied: number, ingestionRecordId?: number }>}
 */
async function applyPlan(client, plan, options = {}) {
  const { now = new Date(), sourceIdentifier = 'unknown' } = options;
  let applied = 0;

  for (const insert of plan.inserts) {
    await createIngestionRecord(client, insert.row, now, sourceIdentifier);
    applied += 1;
  }

  for (const update of plan.updates) {
    await updateOfferPrice(client, update.row, now);
    applied += 1;
  }

  return { applied };
}

/**
 * Create an ingestion_record row and linked store_offer / price_history rows.
 * @param {object} client - pg Client
 * @param {object} row - Normalized listing row
 * @param {Date} now
 * @param {string} sourceIdentifier
 * @returns {Promise<number>} ingestionRecordId
 */
async function createIngestionRecord(client, row, now, sourceIdentifier) {
  // TODO(step 4/5 migration): port SQL from src/recommendation/ingestion/apply.js.
  // Writes only Layer 3 tables. Never Layer 4.
  // Example (not executed):
  //   INSERT INTO ingestion_record (source_identifier, fetched_at, raw_text)
  //   VALUES ($1, $2, $3) RETURNING id
  throw new Error('createIngestionRecord not yet implemented — port from scripts/src/recommendation/ingestion/apply.js');
}

/**
 * Update or insert a store_offer row.
 * @param {object} client - pg Client
 * @param {object} row - Normalized listing row
 * @param {Date} now
 * @returns {Promise<void>}
 */
async function updateOfferPrice(client, row, now) {
  // TODO(step 4/5 migration): port SQL from src/recommendation/ingestion/apply.js.
  throw new Error('updateOfferPrice not yet implemented — port from scripts/src/recommendation/ingestion/apply.js');
}

/**
 * Finish an ingestion record (mark completed).
 * @param {object} client - pg Client
 * @param {number} ingestionRecordId
 * @returns {Promise<void>}
 */
async function finishIngestionRecord(client, ingestionRecordId) {
  // TODO(step 4/5 migration): port from src/recommendation/ingestion/apply.js.
  throw new Error('finishIngestionRecord not yet implemented — port from scripts/src/recommendation/ingestion/apply.js');
}

module.exports = {
  applyPlan,
  createIngestionRecord,
  finishIngestionRecord,
  updateOfferPrice,
};
