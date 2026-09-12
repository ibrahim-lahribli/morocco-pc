/**
 * Engine 1 - Compatibility resolver (foundation).
 *
 * Pure, framework-free compatibility resolution: the data layer loads
 * spec/compatibility rows and hands them in; the resolver produces
 * structured PASS/FAIL/UNKNOWN results; aggregation yields a build-level
 * verdict. The resolver never writes to the database and never reads it.
 *
 * This file currently exposes only the result model, reason vocabulary and
 * aggregation. Individual hardware compatibility rules (CPU, motherboard,
 * RAM, GPU, PSU, cooler, case, radiator) are deliberately NOT implemented
 * yet and will be added here as pure functions.
 */
const { FINAL_STATUSES, SOURCE_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');
const { aggregateCompatibilityResults } = require('./aggregate');

module.exports = {
  FINAL_STATUSES,
  SOURCE_STATUSES,
  REASON_CODES,
  createCompatibilityResult,
  aggregateCompatibilityResults,
};
