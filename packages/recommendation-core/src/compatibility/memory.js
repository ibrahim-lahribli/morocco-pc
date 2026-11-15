const { FINAL_STATUSES, SOURCE_STATUSES } = require('./statuses');
const { REASON_CODES } = require('./reason-codes');
const { createCompatibilityResult } = require('./result');

/**
 * Rule 6: platform <-> RAM memory type.
 *
 * Uses the already-loaded platform_memory_support rows for the CPU's
 * platform. Presence-only table. The approved evidence-based absence
 * policy (Decision 1):
 *
 *   requested type has a matching row      -> PASS
 *   platform HAS rows, type not among them -> FAIL
 *                                             (PLATFORM_MEMORY_TYPE_UNSUPPORTED:
 *                                              positive evidence of exclusion)
 *   platform has ZERO rows                 -> UNKNOWN
 *                                             (PLATFORM_MEMORY_SUPPORT_UNKNOWN:
 *                                              no evidence; do NOT reject the
 *                                              whole pool during sparse seeding)
 *   requested memory type missing          -> UNKNOWN (never PASS)
 *
 * @param {object} input
 * @param {string|null} input.platform_id
 * @param {string|null} input.memory_type_id  Requested RAM memory type.
 * @param {Array<object>} input.platform_memory_records Loaded rows.
 */
function resolvePlatformMemorySupport(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('resolvePlatformMemorySupport expects an input object');
  }

  const {
    platform_id = null,
    memory_type_id,
    platform_memory_records = [],
  } = input;

  const baseEvidence = {
    rule: 'platform_memory_support',
    platform_id,
    memory_type_id: memory_type_id ?? null,
  };

  if (!Array.isArray(platform_memory_records)) {
    throw new TypeError('platform_memory_records must be an array');
  }

  if (memory_type_id == null) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.PLATFORM_MEMORY_SUPPORT_UNKNOWN,
      evidence: [{ ...baseEvidence, source_status: null }],
    });
  }

  const matching = platform_memory_records.find(
    (row) => row != null && row.memory_type_id === memory_type_id
  );

  if (matching) {
    const evidenceItem = {
      ...baseEvidence,
      source_id: matching.source_id,
      source_status: matching.support_status ?? SOURCE_STATUSES.PASS,
    };

    switch (matching.support_status ?? SOURCE_STATUSES.PASS) {
      case SOURCE_STATUSES.PASS:
        return createCompatibilityResult({
          status: FINAL_STATUSES.PASS,
          evidence: [evidenceItem],
        });
      case SOURCE_STATUSES.FAIL:
        return createCompatibilityResult({
          status: FINAL_STATUSES.FAIL,
          reason: REASON_CODES.PLATFORM_MEMORY_TYPE_UNSUPPORTED,
          evidence: [evidenceItem],
        });
      case SOURCE_STATUSES.CONDITIONAL:
      case SOURCE_STATUSES.UNKNOWN:
      default:
        return createCompatibilityResult({
          status: FINAL_STATUSES.UNKNOWN,
          reason: REASON_CODES.PLATFORM_MEMORY_SUPPORT_UNKNOWN,
          evidence: [evidenceItem],
        });
    }
  }

  if (platform_memory_records.length === 0) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.PLATFORM_MEMORY_SUPPORT_UNKNOWN,
      evidence: [{ ...baseEvidence, source_status: null, row_count: 0 }],
    });
  }

  // Rows exist but not for the requested type: positive exclusion evidence.
  return createCompatibilityResult({
    status: FINAL_STATUSES.FAIL,
    reason: REASON_CODES.PLATFORM_MEMORY_TYPE_UNSUPPORTED,
    evidence: [{
      ...baseEvidence,
      source_status: null,
      row_count: platform_memory_records.length,
      supported_memory_type_ids: platform_memory_records
        .map((row) => row.memory_type_id)
        .filter((id) => id != null),
    }],
  });
}

/**
 * Rule 7: motherboard <-> RAM memory type.
 *
 * Two sources, with a strict precedence (Decision 33, closing OG-02):
 *
 * 1. motherboard_memory_support rows (migration 016) when the board has
 *    ANY: the row set is the source of truth. A RAM type matching a row
 *    is judged on that row's support_status (NULL of the legacy column is
 *    irrelevant); a RAM type matching no row is positive exclusion
 *    evidence (FAIL MOTHERBOARD_MEMORY_TYPE_UNSUPPORTED). This is what
 *    makes a dual-DDR4/DDR5 board representable: two rows, both PASS.
 * 2. Zero rows: fall back to the legacy single motherboard memory_type_id
 *    exactly as Decision 2 shipped it, byte-identical semantics:
 *
 *      both known and equal      -> PASS
 *      both known and different  -> FAIL (MOTHERBOARD_MEMORY_TYPE_MISMATCH)
 *      either value missing      -> UNKNOWN (MOTHERBOARD_MEMORY_SUPPORT_UNKNOWN)
 *
 * A row carrying support_status UNKNOWN is impossible at the schema level
 * (chk_mms_status_not_unknown) and is treated as UNKNOWN here rather than
 * trusted, the same defensive reading the other resolvers apply.
 *
 * @param {object} input
 * @param {string|null} input.motherboard_memory_type_id  Legacy column; used
 *   only when motherboard_memory_rows is empty.
 * @param {string|null} input.ram_memory_type_id
 * @param {Array<object>} [input.motherboard_memory_rows]  Loaded
 *   motherboard_memory_support rows for the board (each with memory_type_id
 *   and optional support_status).
 */
function resolveMotherboardRamMemoryType(input) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError(
      'resolveMotherboardRamMemoryType expects an input object'
    );
  }

  const {
    motherboard_memory_type_id,
    ram_memory_type_id,
    motherboard_memory_rows = [],
  } = input;

  const baseEvidence = {
    rule: 'motherboard_memory_type',
    motherboard_memory_type_id: motherboard_memory_type_id ?? null,
    ram_memory_type_id: ram_memory_type_id ?? null,
  };

  if (!Array.isArray(motherboard_memory_rows)) {
    throw new TypeError('motherboard_memory_rows must be an array');
  }

  // --- Source of truth: explicit motherboard_memory_support rows ---
  const rows = motherboard_memory_rows.filter((row) => row != null);
  if (rows.length > 0) {
    if (ram_memory_type_id == null) {
      return createCompatibilityResult({
        status: FINAL_STATUSES.UNKNOWN,
        reason: REASON_CODES.MOTHERBOARD_MEMORY_SUPPORT_UNKNOWN,
        evidence: [{ ...baseEvidence, row_count: rows.length }],
      });
    }

    const matching = rows.find((row) => row.memory_type_id === ram_memory_type_id);

    if (!matching) {
      return createCompatibilityResult({
        status: FINAL_STATUSES.FAIL,
        reason: REASON_CODES.MOTHERBOARD_MEMORY_TYPE_UNSUPPORTED,
        evidence: [{
          ...baseEvidence,
          source_status: null,
          row_count: rows.length,
          supported_memory_type_ids: rows
            .map((row) => row.memory_type_id)
            .filter((id) => id != null),
        }],
      });
    }

    const evidenceItem = {
      ...baseEvidence,
      source_id: matching.source_id ?? null,
      source_status: matching.support_status ?? SOURCE_STATUSES.PASS,
    };

    switch (matching.support_status ?? SOURCE_STATUSES.PASS) {
      case SOURCE_STATUSES.PASS:
        return createCompatibilityResult({
          status: FINAL_STATUSES.PASS,
          evidence: [evidenceItem],
        });
      case SOURCE_STATUSES.FAIL:
        return createCompatibilityResult({
          status: FINAL_STATUSES.FAIL,
          reason: REASON_CODES.MOTHERBOARD_MEMORY_TYPE_MISMATCH,
          evidence: [evidenceItem],
        });
      case SOURCE_STATUSES.CONDITIONAL:
      case SOURCE_STATUSES.UNKNOWN:
      default:
        return createCompatibilityResult({
          status: FINAL_STATUSES.UNKNOWN,
          reason: REASON_CODES.MOTHERBOARD_MEMORY_SUPPORT_UNKNOWN,
          evidence: [evidenceItem],
        });
    }
  }

  // --- Legacy fallback: zero explicit rows -> the Decision 2 strict rule ---
  if (motherboard_memory_type_id == null || ram_memory_type_id == null) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.UNKNOWN,
      reason: REASON_CODES.MOTHERBOARD_MEMORY_SUPPORT_UNKNOWN,
      evidence: [baseEvidence],
    });
  }

  if (motherboard_memory_type_id === ram_memory_type_id) {
    return createCompatibilityResult({
      status: FINAL_STATUSES.PASS,
      evidence: [baseEvidence],
    });
  }

  return createCompatibilityResult({
    status: FINAL_STATUSES.FAIL,
    reason: REASON_CODES.MOTHERBOARD_MEMORY_TYPE_MISMATCH,
    evidence: [baseEvidence],
  });
}

module.exports = {
  resolvePlatformMemorySupport,
  resolveMotherboardRamMemoryType,
};
