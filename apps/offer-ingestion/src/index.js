/**
 * Ingestion — public surface (barrel only).
 *
 * Re-exports the ingestion boundary. This module is the entry point for
 * consumers of @morocco-pc/offer-ingestion. It performs no engine logic and
 * imports nothing from @morocco-pc/recommendation-core or
 * @morocco-pc/recommendation-runtime.
 *
 * @see RFC §12.3 — Target shape
 * @see RFC §12.4 — Hard rule: no core/runtime imports
 */

'use strict';

const { parseManualText } = require('./adapters/manual');
const { parseListings, validateListings } = require('./listings');
const { matchListing, normalizeModelString } = require('./matching');
const { decidePromotion } = require('./promotion');
const { buildPlan, formatPlan, planCounts } = require('./plan');
const { applyPlan, createIngestionRecord, finishIngestionRecord } = require('./apply');
const { runIngestion } = require('./run');

module.exports = {
  parseManualText,
  parseListings,
  validateListings,
  matchListing,
  normalizeModelString,
  decidePromotion,
  buildPlan,
  formatPlan,
  planCounts,
  applyPlan,
  createIngestionRecord,
  finishIngestionRecord,
  runIngestion,
};
