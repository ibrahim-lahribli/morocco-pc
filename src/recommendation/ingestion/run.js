/**
 * Ingestion — orchestrator.
 *
 * Boundary: wires validation -> context load -> plan -> (optional) apply. The
 * CALLER owns the transaction; in commit mode this module writes through the
 * apply layer inside that transaction. In dry-run mode it performs reads only.
 *
 * Determinism: `now` is supplied by the caller (the CLI) so validation is
 * reproducible; nothing here reads the clock for classification.
 */

'use strict';

const { validateListings, DEFAULT_CURRENCY } = require('./listings');
const { loadStores, gatherContext, buildPlan, formatPlan, planCounts } = require('./plan');
const { applyPlan, createIngestionRecord, finishIngestionRecord } = require('./apply');

/**
 * @param {object} db pg-compatible client
 * @param {object} input
 *   @param {Array<object>} input.rows   raw adapter rows
 *   @param {Date|string}   input.now    validation reference time
 *   @param {'dry-run'|'commit'} [input.mode='dry-run']
 *   @param {string}        [input.source]            display source name
 *   @param {string}        [input.sourceIdentifier]  e.g. the file path
 *   @param {string}        [input.expectedCurrency='MAD']
 *   @param {string}        [input.rawText]           hashed into ingestion_record
 * @returns {Promise<{counts:object, report:string, applied:object|null, ingestionRecordId:string|null}>}
 */
async function runIngestion(db, input) {
  const mode = input.mode === 'commit' ? 'commit' : 'dry-run';
  const expectedCurrency = input.expectedCurrency || DEFAULT_CURRENCY;

  const storesByName = await loadStores(db);
  const { valid, invalid } = validateListings(input.rows, {
    now: input.now,
    expectedCurrency,
    knownStores: new Set(storesByName.keys()),
  });

  const context = await gatherContext(db, valid, storesByName);
  const plan = buildPlan(valid, context);
  plan.mode = mode;

  const counts = planCounts(plan, invalid);
  const report = formatPlan(plan, invalid);

  if (mode !== 'commit') {
    return { counts, report, applied: null, ingestionRecordId: null };
  }

  const ingestionRecordId = await createIngestionRecord(db, {
    sourceIdentifier: input.sourceIdentifier || input.source || 'manual',
    recordCount: input.rows.length,
    rawText: input.rawText,
  });
  const applied = await applyPlan(db, plan, {
    ingestionRecordId,
    sourceIdentifier: input.sourceIdentifier || null,
  });
  await finishIngestionRecord(db, ingestionRecordId, {
    status: 'COMPLETED',
    recordCount: input.rows.length,
  });

  return { counts, report, applied, ingestionRecordId };
}

module.exports = { runIngestion };
