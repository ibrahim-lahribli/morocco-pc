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
const { parseListings } = require('./listings');
const { matchListing } = require('./matching');
const { decidePromotion } = require('./promotion');
const { buildPlan, formatPlan } = require('./plan');
const { applyPlan, createIngestionRecord, finishIngestionRecord } = require('./apply');

function hostOf(productUrl) {
  if (!productUrl) return null;
  try {
    return new URL(productUrl).hostname;
  } catch (_err) {
    return null;
  }
}

/**
 * Run a full ingestion pass.
 *
 * Entry point used by the CLI and by programmatic callers. Coordinates the
 * ingestion stages but owns no database transaction itself — applyPlan
 * runs inside the caller's transaction.
 *
 * @param {object} client - pg Client (caller owns transaction for commit mode)
 * @param {object} input - {
 *   mode: 'dry-run' | 'commit',
 *   now: Date,
 *   sourceIdentifier: string,
 *   rawText: string,
 *   format: 'csv' | 'json',
 *   lookupCatalogueKey: (slug, sku) => Promise<{productId, variantId} | null>,
 *   lookupStore: (retailer) => Promise<string | null>   // store.name -> store.id
 * }
 * @returns {Promise<{ report: string, applied?: number, inserted?: number, updated?: number, history?: number, ingestionRecordId?: string }>}
 */
async function runIngestion(client, input) {
  const { mode = 'dry-run', now = new Date(), sourceIdentifier = 'unknown', rawText = '', format = null } = input;
  const lookupCatalogueKey = input.lookupCatalogueKey || (async () => null);
  const lookupStore = input.lookupStore || (async () => null);

  // 1. Parse raw text into normalized rows
  const parsed = parseManualText(rawText, { format });
  if (parsed.errors.length > 0) {
    return {
      report: `Parse failed: ${parsed.errors.length} error(s)\n` +
        parsed.errors.map((e) => `  line ${e.line}: ${e.reason}`).join('\n'),
    };
  }

  // 2. Normalize + validate listings
  const { valid, invalid } = parseListings(parsed.rows, { now });

  // 3. Resolve each retailer to an existing active store (Layer 1 read inside
  //    the caller's transaction). Unresolvable retailers are reported, never
  //    guessed at.
  const resolvable = [];
  for (const row of valid) {
    const storeId = await lookupStore(row.retailer);
    if (!storeId) {
      invalid.push({ row, errors: [`retailer: UNKNOWN_STORE (${row.retailer})`] });
      continue;
    }
    row.storeId = storeId;
    resolvable.push(row);
  }

  // 4. Match identities (Tier 0 catalogue key first; unknown keys are rejected
  //    downstream as REJECTED, never force-matched).
  const matchResults = await Promise.all(
    resolvable.map((row) => matchListing(row, lookupCatalogueKey))
  );

  // 5. Decide promotion class
  const promotionResults = resolvable.map((row, i) =>
    decidePromotion(row, matchResults[i], {
      listingId: row.sourceIdentifier,
      seller: row.seller,
      host: hostOf(row.productUrl),
      fetchedAt: row.fetchedAt,
    })
  );

  // 6. Build plan (pure: inserts / updates / skips)
  const plan = buildPlan(resolvable, matchResults, promotionResults);

  let applied;
  let inserted;
  let updated;
  let history;
  let ingestionRecordId;
  if (mode === 'commit') {
    // One ingestion_record per run, then all offers link to it. The caller
    // owns the transaction; on failure it rolls back and the record rolls
    // back with it.
    ingestionRecordId = await createIngestionRecord(
      client,
      { sourceIdentifier, recordCount: resolvable.length, rawText },
      now
    );
    const result = await applyPlan(client, plan, { now, sourceIdentifier, ingestionRecordId });
    applied = result.applied;
    inserted = result.inserted;
    updated = result.updated;
    history = result.history;
    await finishIngestionRecord(client, ingestionRecordId, { recordCount: resolvable.length });
  }

  const report = formatPlan(plan);
  if (invalid.length > 0) {
    report += `\n\nInvalid rows (skipped): ${invalid.length}\n`;
    for (const { row, errors } of invalid) {
      report += `  ${row.productSlug || row.retailer || '?'}: ${errors.join(', ')}\n`;
    }
  }

  return { report, applied, inserted, updated, history, ingestionRecordId };
}

module.exports = {
  runIngestion,
};
