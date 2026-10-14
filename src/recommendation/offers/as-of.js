'use strict';

const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** Decision 38: undefined preserves the legacy transaction-clock path. */
function parseAsOf(options) {
  if (options === null || typeof options !== 'object' || options.asOf === undefined) return null;
  const value = options.asOf;
  const match = typeof value === 'string'
    ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
    : null;
  const ms = match === null ? NaN : Date.parse(value);
  // Date.parse normalizes impossible dates (February 30); reject those too.
  const local = match === null ? NaN : Date.parse(match[1] + 'T' + match[2] + (match[3] || '') + 'Z');
  const validCalendar = Number.isFinite(local)
    && new Date(local).toISOString().slice(0, 19) === match[1] + 'T' + match[2];
  if (!Number.isFinite(ms) || !validCalendar) {
    throw new CandidateSelectionError(ERROR_CODES.INVALID_FIELD_VALUE,
      '"asOf" must be an ISO timestamp with an explicit timezone and millisecond-or-less precision', 'asOf');
  }
  return { nowMs: ms, iso: new Date(ms).toISOString() };
}

module.exports = { parseAsOf };
