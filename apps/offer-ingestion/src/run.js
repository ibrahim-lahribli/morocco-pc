/**
 * Run — orchestration: parse → match → plan → apply.
 *
 * Entry point used by the CLI and by programmatic callers. Coordinates the
 * ingestion stages but owns no database transaction itself — applyPlan
 * runs inside the caller's transaction.
 *
 * @see RFC §12.1 — runIngestion() orchestration
 * @see existing: src/recommendation/ingestion/run.js
 */

'use strict';

const { parseManualText } = require('./adapters/manual');
const { parseListings, validateListings } = require('./listings');
const { matchListing } = require('./matching');
const { decidePromotion } = require('./promotion');
const { buildPlan, formatPlan } = require('./plan');
const { applyPlan } = require('./apply');

/**
 * Run a full ingestion pass.
 *
 * @param {object} client - pg Client (caller owns transaction for commit mode)
 * @param {object} input - { rows: object[], mode: 'dry-run' | 'commit', now: Date, sourceIdentifier: string, rawText: string, lookupCatalogueKey?: function }
 * @returns {Promise<{ report: string, applied?: number, ingestionRecordId?: number }>}
 */
async function runIngestion(client, input) {
  const { mode = 'dry-run', now = new Date(), sourceIdentifier = 'unknown', rawText = '' } = input;

  // 1. Parse raw text into normalized rows
  const parsed = parseManualText(rawText, { format: input.format });
  if (parsed.errors.length > 0) {
    return {
      report: `Parse failed: ${parsed.errors.length} error(s)\n` +
        parsed.errors.map((e) => `  line ${e.line}: ${e.reason}`).join('\n'),
    };
  }

  // 2. Validate listings
  const { valid, invalid } = parseListings(parsed.rows);

  // 3. Match identities (Tier 0 catalogue key first)
  const lookupCatalogueKey = input.lookupCatalogueKey || (async () => null);
  const matchResults = await Promise.all(
    valid.map((row) => matchListing(row, lookupCatalogueKey))
  );

  // 4. Decide promotion class
  const promotionResults = valid.map((row, i) =>
    decidePromotion(row, matchResults[i], {
      listingId: row.sourceIdentifier || sourceIdentifier,
      seller: row.seller,
      host: row.productUrl ? new URL(row.productUrl).hostname : null,
      fetchedAt: row.fetchedAt,
    })
  );

  // 5. Build plan
  const plan = buildPlan(valid, matchResults, promotionResults);

  // 6. Apply (writes) or dry-run report
  let applied;
  let ingestionRecordId;
  if (mode === 'commit') {
    const result = await applyPlan(client, plan, { now, sourceIdentifier });
    applied = result.applied;
    ingestionRecordId = result.ingestionRecordId;
  }

  const report = formatPlan(plan);
  if (invalid.length > 0) {
    report += `\n\nInvalid rows (skipped): ${invalid.length}\n`;
    for (const { row, errors } of invalid) {
      report += `  ${row.productSlug || '?'}/${row.variantSku || '?'}: ${errors.join(', ')}\n`;
    }
  }

  return { report, applied, ingestionRecordId };
}

module.exports = {
  runIngestion,
};
