'use strict';

/**
 * scripts/lib/golden-loader-parity.js — pure half of the golden loader-parity
 * gate. No SQL, no `pg`, no filesystem: this module compares loader output
 * trees and nothing else.
 *
 * WHY THIS EXISTS
 * The frozen golden pairs in `test/golden/` carry the loader outputs
 * (`query`, `scoringModel`, `candidatePoolResult`, `filteringContext`,
 * `filterResult`, `assessments`) as INPUTS, so `compute.golden.test.js` replays
 * only the pure assemble-and-score seam. No gate runs the real loaders and
 * checks they still produce those inputs. This module is the comparison; the
 * I/O half is `scripts/check-golden-loader-parity.js`.
 *
 * WHAT "PARITY" CAN AND CANNOT MEAN ACROSS DATABASES
 * Seeds mint every identity with `gen_random_uuid()`, and the engine breaks
 * ranking ties on `product_id`. A seed-built database therefore CANNOT
 * reproduce the captured UUIDs or, in general, the captured order. Comparing
 * raw bytes would fail on every scenario for a reason that is not a defect.
 *
 * So the comparison is IDENTITY-AWARE, in two modes:
 *
 *   'mask' (default)  A UUID-shaped string is equal to any other UUID-shaped
 *                     string. A UUID inside an object KEY is replaced with a
 *                     marker, and the object becomes a sorted value list, so
 *                     a UUID-keyed carrier (`prices`, `assessments`, `specs`)
 *                     is compared as a MULTISET of values. Arrays of objects
 *                     are sorted by their canonical content, so a different
 *                     tie-break order is not a false failure. This is the mode
 *                     that can pass on a freshly seeded database: it proves the
 *                     loaders return the same CONTENT for the same catalogue.
 *
 *   'strict'          Identities are values, exactly like any other leaf. This
 *                     only passes against the database the pairs were captured
 *                     from (TEST), and it is the mode that proves byte-level
 *                     reproducibility.
 *
 * Order is deliberately NOT asserted in either mode: rank/selection order is
 * the behavioural harness's job (`eval:scenarios` A8 and the golden replay),
 * not this gate's.
 *
 * Precision: numbers are compared at 6 decimal places, the same stability rule
 * `compute.golden.test.js` applies. Nothing is rounded on the way in.
 *
 * The report is load-bearing in the project's vocabulary: PASS / FAIL /
 * UNMEASURED. A component whose fixture half is absent is UNMEASURED, never
 * PASS and never FAIL.
 */

/** A canonical UUID is an identity, not a value. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const IDENTITY = '<uuid>';
const CLOCK = '<clock>';
const DEFAULT_PRECISION = 6;

/**
 * Row-audit clocks. Every database stamps its own seed time, so these are
 * compared for PRESENCE and TYPE only in 'mask' mode. Narrow on purpose: the
 * value-bearing timestamps (assessment `assessed_at`, offer `price_checked_at`)
 * are compared like any other number.
 */
const CLOCK_KEYS = Object.freeze(['created_at', 'updated_at']);

/** Does this string look like a UUID (an identity) rather than a value? */
function isUuid(text) {
  return typeof text === 'string' && UUID_RE.test(text);
}

/** Does this string EMBED a UUID (the `prices` carrier uses JSON-array keys)? */
function embedsUuid(text) {
  return typeof text === 'string' && new RegExp(UUID_IN_TEXT_RE.source, 'i').test(text);
}

function roundNumber(value, precision) {
  if (!Number.isFinite(value)) return value;
  // toFixed keeps the comparison deterministic; the fixtures hold exact values.
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Deterministic stringify: object keys are sorted, so two structurally equal
 * canonical trees stringify identically regardless of insertion order. Used
 * for multiset ordering only.
 */
function stableStringify(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
}

/**
 * Canonicalize one tree for comparison.
 *
 * @param {*} value raw loader output or fixture half
 * @param {object} opts { identityMode: 'mask'|'strict', precision }
 * @param {object} stats mutable { identities } counter
 * @returns {*} canonical value
 */
function canonicalize(value, opts, stats) {
  // Loaders return TIMESTAMPTZ as Date objects; the fixture carries the ISO
  // string JSON produced at capture time. Normalize before comparing so a Date
  // is never mistaken for an empty object.
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'number') return roundNumber(value, opts.precision);

  if (typeof value === 'string') {
    if (isUuid(value)) {
      if (opts.identityMode === 'mask') {
        stats.identities += 1;
        return IDENTITY;
      }
      return value.toLowerCase();
    }
    return value;
  }

  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    const items = value.map((entry) => canonicalize(entry, opts, stats));
    // A set comparison, not an order comparison: see the header.
    return items.slice().sort((a, b) => (stableStringify(a) < stableStringify(b) ? -1 : 1));
  }

  const keys = Object.keys(value);

  // A UUID-keyed carrier (`prices`, `assessments`, `specs`) is a multiset of
  // values. Dropping the keys is the whole point: those keys cannot match
  // across databases, but the values must.
  if (keys.length > 0 && keys.every((key) => embedsUuid(key))) {
    const values = keys.map((key) => canonicalize(value[key], opts, stats));
    return values.sort((a, b) => (stableStringify(a) < stableStringify(b) ? -1 : 1));
  }

  const out = {};
  for (const key of keys) {
    if (opts.identityMode === 'mask' && CLOCK_KEYS.includes(key) && value[key] !== null) {
      stats.clocks += 1;
      out[key] = CLOCK;
      continue;
    }
    if (embedsUuid(key)) {
      // Mixed identity-bearing keys: keep a deterministic marker plus the
      // canonical value. Two such keys in one object would collide, so the
      // value becomes a list keyed by the masked key.
      stats.identities += 1;
      const masked = key.replace(UUID_IN_TEXT_RE, IDENTITY);
      if (Object.prototype.hasOwnProperty.call(out, masked)) {
        out[masked] = [].concat(out[masked], canonicalize(value[key], opts, stats));
      } else {
        out[masked] = canonicalize(value[key], opts, stats);
      }
    } else {
      out[key] = canonicalize(value[key], opts, stats);
    }
  }
  return out;
}

/**
 * Leaf-level differences between two canonical trees, up to `limit` paths.
 * A local copy of the idea `test/golden/capture.js` uses, extended with a
 * bound so a structural mismatch cannot produce thousands of lines.
 */
function diffCanonical(actual, expected, path, out, limit) {
  if (out.length >= limit) return out;
  if (stableStringify(actual) === stableStringify(expected)) return out;

  const aObj = actual !== null && typeof actual === 'object';
  const eObj = expected !== null && typeof expected === 'object';
  if (!aObj || !eObj) {
    out.push({ path: path || '<root>', actual, expected });
    return out;
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    out.push({ path: path || '<root>', actual, expected });
    return out;
  }
  if (Array.isArray(actual)) {
    const n = Math.max(actual.length, expected.length);
    for (let i = 0; i < n; i += 1) {
      if (i >= actual.length || i >= expected.length) {
        out.push({ path: (path || '') + '[' + i + ']', actual: actual[i], expected: expected[i] });
        if (out.length >= limit) return out;
        continue;
      }
      diffCanonical(actual[i], expected[i], (path || '') + '[' + i + ']', out, limit);
      if (out.length >= limit) return out;
    }
    return out;
  }
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const key of keys) {
    const next = path ? path + '.' + key : key;
    if (!Object.prototype.hasOwnProperty.call(actual, key)
      || !Object.prototype.hasOwnProperty.call(expected, key)) {
      out.push({ path: next, actual: actual[key], expected: expected[key] });
      if (out.length >= limit) return out;
      continue;
    }
    diffCanonical(actual[key], expected[key], next, out, limit);
    if (out.length >= limit) return out;
  }
  return out;
}

/**
 * Compare one loader output against its fixture half.
 *
 * @param {object} args
 * @param {string} args.label component name (`candidatePoolResult`, ...)
 * @param {*} args.actual live loader output (absent when the loader could not run)
 * @param {*} args.expected the fixture half
 * @param {boolean} [args.measured] false when there was nothing to run
 * @param {string} [args.reason] why it was not measured
 * @param {'mask'|'strict'} [args.identityMode]
 * @param {number} [args.precision]
 * @param {number} [args.limit] max reported differences
 * @returns {{label: string, status: 'PASS'|'FAIL'|'UNMEASURED', identities: number,
 *            differences: Array<{path: string, actual: *, expected: *}>, reason: string|null}}
 */
function compareComponent(args) {
  const opts = {
    identityMode: args.identityMode === 'strict' ? 'strict' : 'mask',
    precision: Number.isInteger(args.precision) ? args.precision : DEFAULT_PRECISION,
  };
  const limit = Number.isInteger(args.limit) ? args.limit : 5;

  if (!args.measured) {
    return {
      label: args.label,
      status: 'UNMEASURED',
      identities: 0,
      differences: [],
      reason: args.reason || 'the loader was not run for this component',
    };
  }
  if (args.expected === undefined) {
    return {
      label: args.label,
      status: 'UNMEASURED',
      identities: 0,
      differences: [],
      reason: 'no committed fixture half exists for this component',
    };
  }

  const actualStats = { identities: 0, clocks: 0 };
  const expectedStats = { identities: 0, clocks: 0 };
  const canonicalActual = canonicalize(args.actual, opts, actualStats);
  const canonicalExpected = canonicalize(args.expected, opts, expectedStats);
  const differences = diffCanonical(canonicalActual, canonicalExpected, '', [], limit);

  return {
    label: args.label,
    status: differences.length === 0 ? 'PASS' : 'FAIL',
    identities: Math.max(actualStats.identities, expectedStats.identities),
    clocks: Math.max(actualStats.clocks, expectedStats.clocks),
    differences,
    reason: null,
  };
}

/** The six fixture halves this gate compares, in capture order. */
const COMPONENT_LABELS = Object.freeze([
  'query',
  'scoringModel',
  'candidatePoolResult',
  'filteringContext',
  'filterResult',
  'assessments',
]);

/**
 * Compare a whole scenario from a live-loader result object.
 *
 * @param {object} args
 * @param {object} args.fixture the committed fixture half
 * @param {object} args.live { query?, scoringModel?, candidatePoolResult?,
 *        filteringContext?, filterResult?, assessments? } — a missing key is
 *        UNMEASURED with `unmeasuredReasons[key]` as its reason.
 * @param {object} [args.unmeasuredReasons]
 * @param {'mask'|'strict'} [args.identityMode]
 * @param {number} [args.precision]
 * @returns {{status: 'PASS'|'FAIL'|'UNMEASURED', components: object[]}}
 */
function compareScenario(args) {
  const reasons = args.unmeasuredReasons || {};
  const components = COMPONENT_LABELS.map((label) => {
    const measured = Object.prototype.hasOwnProperty.call(args.live, label);
    return compareComponent({
      label,
      actual: args.live[label],
      expected: args.fixture[label],
      measured,
      reason: reasons[label],
      identityMode: args.identityMode,
      precision: args.precision,
    });
  });

  let status = 'PASS';
  if (components.some((c) => c.status === 'FAIL')) status = 'FAIL';
  else if (components.every((c) => c.status === 'UNMEASURED')) status = 'UNMEASURED';

  return { status, components };
}

module.exports = {
  CLOCK_KEYS,
  COMPONENT_LABELS,
  DEFAULT_PRECISION,
  canonicalize,
  compareComponent,
  compareScenario,
  diffCanonical,
  embedsUuid,
  isUuid,
  stableStringify,
};
