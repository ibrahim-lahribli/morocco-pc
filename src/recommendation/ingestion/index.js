/**
 * Ingestion — public surface (barrel only).
 *
 * Boundary-only: re-exports the ingestion boundary without wrappers, logic or
 * orchestration. This is NOT an engine stage: it is the impure edge that turns
 * operator-supplied listings into rows in Layer 3 (store_offer / price_history)
 * plus review rows. It performs no compatibility / scoring / ranking work and
 * never touches the engine's pure modules.
 *
 * Adapter interface: an adapter exposes
 *   parse(text, { format }) -> { rows, errors }
 * and the runner (`runIngestion`) validates rows, matches them, plans changes
 * and (on commit) writes them. See docs/IMPORT_OFFERS.md.
 */

'use strict';

const { parseMadAmount, validateListings } = require('./listings');
const { normalizeModelString, matchListing } = require('./matching');
const { decidePromotion } = require('./promotion');
const { parseManualText } = require('./adapters/manual');
const { buildPlan, formatPlan, planCounts, loadStores, gatherContext } = require('./plan');
const { applyPlan, createIngestionRecord, finishIngestionRecord } = require('./apply');
const { runIngestion } = require('./run');

module.exports = {
  parseMadAmount,
  validateListings,
  normalizeModelString,
  matchListing,
  decidePromotion,
  parseManualText,
  loadStores,
  gatherContext,
  buildPlan,
  planCounts,
  formatPlan,
  applyPlan,
  createIngestionRecord,
  finishIngestionRecord,
  runIngestion,
};
