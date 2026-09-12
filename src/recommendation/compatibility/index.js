/**
 * Engine 1 - Compatibility resolver.
 *
 * Pure, framework-free compatibility resolution: the data layer loads
 * spec/compatibility rows and hands them in; the resolver produces
 * structured PASS/FAIL/UNKNOWN results; aggregation yields a build-level
 * verdict. The resolver never writes to the database and never reads it.
 */
const { FINAL_STATUSES, SOURCE_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');
const { aggregateCompatibilityResults } = require('./aggregate');
const {
  resolveCpuMotherboardSocket,
  resolveCpuMotherboardSupport,
} = require('./cpu-motherboard');
const { resolveCoolerSocketSupport } = require('./cooler');
const {
  resolveCaseMotherboardFormFactor,
  resolveCaseRadiator,
} = require('./case-radiator');
const {
  resolvePlatformMemorySupport,
  resolveMotherboardRamMemoryType,
} = require('./memory');

module.exports = {
  FINAL_STATUSES,
  SOURCE_STATUSES,
  REASON_CODES,
  createCompatibilityResult,
  aggregateCompatibilityResults,
  resolveCpuMotherboardSocket,
  resolveCpuMotherboardSupport,
  resolveCoolerSocketSupport,
  resolveCaseMotherboardFormFactor,
  resolveCaseRadiator,
  resolvePlatformMemorySupport,
  resolveMotherboardRamMemoryType,
};
