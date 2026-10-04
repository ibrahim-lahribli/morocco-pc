'use strict';

/**
 * Input contract for the rejection writer (OG-04).
 *
 * The sibling of ./validate-selected: it owns every fail-fast check so
 * ./persist-rejections stays a pure DML loop. Its job is narrower in one
 * important way - it FILTERS rather than only validating. Engine 2D emits
 * every candidate verdict, and this boundary accepts that whole array and
 * keeps only the REJECT entries, because:
 *
 *   - persisting PASS/UNKNOWN rows would conflate a survival with a rejection
 *     and bury the REJECTs that matter;
 *   - it keeps the caller from having to pre-filter, so the filter cannot be
 *     forgotten in a second call site later.
 *
 * Fail-fast rules (all raise CandidateSelectionError with the offending field,
 * so a malformed diagnostic can never be written as if it were a real one):
 *
 *   - `rejections` must be an array (a missing/null one is a MISSING_REQUIRED_FIELD;
 *     a non-array is INVALID_FIELD_VALUE). [] is VALID and means "nothing was
 *     rejected" - the common, healthy case.
 *   - `queryId` must be a non-empty string.
 *   - each entry must be an object carrying a string `component_role`, a
 *     non-empty string `product_id`, and a non-empty string `reason`.
 *
 *   NOTE the field name: an Engine 2D candidate verdict carries the decisive
 *   reason in `reason` (filter.js sets `reason = firstFailed.reason`), NOT
 *   `reason_code`. Reading `reason_code` here looks plausible and silently
 *   rejects every real verdict - measured against the live branch, all 101
 *   verdicts use `reason`, so the writer must too. The DB column is named
 *   reason_code; that mapping happens in this validator, not in the caller.
 *   - `product_variant_id` and both partner ids are optional; when present they
 *     must be non-empty strings. NULL/undefined means "not applicable".
 *   - the partner pair must be both-present or both-absent, mirroring
 *     chk_build_rejection_partner_pair_complete at the schema level. This is
 *     checked here so the error names the field instead of surfacing as an
 *     opaque 23514 from the INSERT.
 *   - an entry with a non-string or blank `reason_code` is rejected rather than
 *     defaulted: a REJECT always carries a decisive reason in filter.js, so a
 *     missing one means the caller passed something that is not a verdict.
 *   - entries whose `status` is present but not 'REJECT' are skipped, not
 *     validated further - they are simply not persisted.
 *
 * NULL is never coerced: a NULL/absent partner id stays null in the returned
 * row and is passed to the INSERT as null, never as '' or 0 (the project's
 * NULL != 0 rule, AGENTS.md section 8).
 */

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** The one status this writer persists. */
const REJECT_STATUS = 'REJECT';

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireIdentifier(value, field, index) {
  if (value === undefined || value === null) {
    fail(
      ERROR_CODES.MISSING_REQUIRED_FIELD,
      field,
      'rejections[' + index + '] requires "' + field + '"'
    );
  }
  if (typeof value !== 'string' || value.length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      field,
      'rejections[' + index + '].' + field + ' must be a non-empty string'
    );
  }
  // A whitespace-only value is not a real identifier. This mirrors the schema's
  // own guards (chk_build_rejection_reason_not_blank is btrim(reason_code) <> '')
  // so the failure names the field here instead of arriving from the INSERT as
  // an opaque constraint violation.
  if (value.trim().length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      field,
      'rejections[' + index + '].' + field + ' must not be blank'
    );
  }
  return value;
}

/** Optional identifier: absent/NULL stays null; a present value must be a string. */
function optionalIdentifier(value, field, index) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      field,
      'rejections[' + index + '].' + field + ' must be a non-empty string when present'
    );
  }
  return value;
}

/**
 * Validate the input and normalize it into persistable rows.
 *
 * @param {object} args
 * @param {string} args.queryId pinned recommendation_query.id
 * @param {Array} args.rejections Engine 2D candidate verdicts (any status)
 * @returns {Array<object>} frozen array of frozen rows, REJECT entries only,
 *          in input order. Input is never mutated.
 * @throws CandidateSelectionError on any malformed input.
 */
function validateRejections({ queryId, rejections }) {
  if (queryId === undefined || queryId === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'queryId', 'validateRejections requires "queryId"');
  }
  if (typeof queryId !== 'string' || queryId.length === 0) {
    fail(ERROR_CODES.INVALID_FIELD_VALUE, 'queryId', '"queryId" must be a non-empty string');
  }

  if (rejections === undefined || rejections === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'rejections', 'validateRejections requires "rejections"');
  }
  if (!Array.isArray(rejections)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'rejections',
      '"rejections" must be an array of Engine 2D candidate verdicts'
    );
  }

  const rows = [];
  for (let index = 0; index < rejections.length; index += 1) {
    const entry = rejections[index];
    if (!isPlainObject(entry)) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        'rejections',
        'rejections[' + index + '] must be a candidate verdict object'
      );
    }

    // Not a rejection: skipped silently. A PASS/UNKNOWN verdict is a
    // survival and is deliberately not persisted here.
    if (entry.status !== undefined && entry.status !== null && entry.status !== REJECT_STATUS) {
      continue;
    }

    const componentRole = requireIdentifier(entry.component_role, 'component_role', index);
    const productId = requireIdentifier(entry.product_id, 'product_id', index);
    // Engine 2D's field is `reason`; the DB column is `reason_code`. See the
    // NOTE in this file's header - reading the wrong name fails every real run.
    const reasonCode = requireIdentifier(entry.reason, 'reason', index);

    const productVariantId = optionalIdentifier(
      entry.product_variant_id,
      'product_variant_id',
      index
    );
    const partnerProductId = optionalIdentifier(
      entry.partner_product_id,
      'partner_product_id',
      index
    );
    const partnerProductVariantId = optionalIdentifier(
      entry.partner_product_variant_id,
      'partner_product_variant_id',
      index
    );

    // Mirrors chk_build_rejection_partner_pair_complete, so the failure names
    // the field instead of arriving as an opaque constraint violation.
    const hasPartnerProduct = partnerProductId !== null;
    const hasPartnerVariant = partnerProductVariantId !== null;
    if (hasPartnerProduct !== hasPartnerVariant) {
      fail(
        ERROR_CODES.INVALID_FIELD_VALUE,
        hasPartnerProduct ? 'partner_product_variant_id' : 'partner_product_id',
        'rejections[' + index + '] partner ids must both be present or both be absent'
      );
    }

    rows.push(
      Object.freeze({
        component_role: componentRole,
        product_id: productId,
        product_variant_id: productVariantId,
        partner_product_id: partnerProductId,
        partner_product_variant_id: partnerProductVariantId,
        reason_code: reasonCode,
      })
    );
  }

  return Object.freeze(rows);
}

module.exports = { validateRejections, REJECT_STATUS };
