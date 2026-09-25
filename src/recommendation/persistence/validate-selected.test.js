'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateSelected } = require('./validate-selected');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const STORE_A = '11111111-1111-4111-8111-111111111111';
const TS = '2026-09-20T12:00:00.000Z';

function price(overrides) {
  const base = {
    selected_price: 100,
    currency: 'MAD',
    store_id: STORE_A,
    price_checked_at: TS,
  };
  if (overrides !== undefined) {
    for (const k of Object.keys(overrides)) base[k] = overrides[k];
  }
  return Object.freeze(base);
}

function comp(role, pid, opts) {
  const o = opts || {};
  return Object.freeze({
    component_role: o.role !== undefined ? o.role : role,
    product_id: o.productId !== undefined ? o.productId : pid,
    product_variant_id: o.variant !== undefined ? o.variant : (role === 'GPU' ? pid + '-var' : null),
    category: o.category !== undefined ? o.category : 'IGNORED-CATEGORY',
    status: o.status !== undefined ? o.status : 'PASS',
    price: o.priceMissing === true ? undefined : (o.price !== undefined ? o.price : price(o.priceOverrides)),
  });
}

function build8(priceOverrides) {
  return {
    components: Object.freeze([
      comp('CPU', 'cpu-1', { priceOverrides }),
      comp('GPU', 'gpu-1', { priceOverrides }),
      comp('MOTHERBOARD', 'mb-1', { priceOverrides }),
      comp('RAM', 'ram-1', { priceOverrides }),
      comp('SSD_BOOT', 'ssd-1', { priceOverrides }),
      comp('SSD_SECONDARY', 'ssd-2', { priceOverrides }),
      comp('PSU', 'psu-1', { priceOverrides }),
      comp('CASE', 'case-1', { priceOverrides }),
    ]),
  };
}

function build7NoGpu(priceOverrides) {
  return {
    components: Object.freeze([
      comp('CPU', 'cpu-2', { priceOverrides }),
      comp('MOTHERBOARD', 'mb-2', { priceOverrides }),
      comp('RAM', 'ram-2', { priceOverrides }),
      comp('SSD_BOOT', 'ssd-3', { priceOverrides }),
      comp('PSU', 'psu-2', { priceOverrides }),
      comp('CASE', 'case-2', { priceOverrides }),
      comp('CPU_COOLER', 'cooler-2', { priceOverrides }),
    ]),
  };
}

function entry(rank, build, opts) {
  const o = opts || {};
  const rec = {
    persisted_rank: o.rank !== undefined ? o.rank : rank,
    build_score: o.score !== undefined ? o.score : 80,
    total_price: o.total !== undefined ? o.total : 5000,
    compatibility_status: o.status !== undefined ? o.status : 'PASS',
    signature: 'sig-' + rank,
    explanation: o.explanation !== undefined ? o.explanation : ('Ranked ' + rank + ': valid test explanation'),
    build: o.buildMissing === true ? undefined : build,
  };
  return rec;
}

function cloneWith(entryObj, patch) {
  const copy = {
    persisted_rank: entryObj.persisted_rank,
    build_score: entryObj.build_score,
    total_price: entryObj.total_price,
    compatibility_status: entryObj.compatibility_status,
    signature: entryObj.signature,
    explanation: entryObj.explanation,
    build: entryObj.build,
  };
  for (const k of Object.keys(patch)) copy[k] = patch[k];
  return copy;
}

function singleEntry(patch, buildPatch) {
  const b = buildPatch !== undefined ? buildPatch : build8();
  const e = entry(1, b);
  if (patch !== undefined) return cloneWith(e, patch);
  return e;
}

function rejectionOf(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

test('happy path: 2 valid entries (8 comps + 7 comps GPU-omitted) pass', () => {
  const a = entry(1, build8());
  const b = entry(2, build7NoGpu({ store_id: null }), { status: 'UNKNOWN' });
  assert.equal(validateSelected([a, b]), undefined);
  assert.equal(b.build.components.length, 7);
  assert.ok(b.build.components.every((c) => c.component_role !== 'GPU'));
});

test('empty array passes immediately', () => {
  assert.equal(validateSelected([]), undefined);
});

test('non-array selected fails with INVALID_INPUT', () => {
  for (const bad of [undefined, null, {}, 'x', 5]) {
    const err = rejectionOf(() => validateSelected(bad));
    assert.ok(err instanceof CandidateSelectionError, 'must throw for ' + String(bad));
    assert.equal(err.code, ERROR_CODES.INVALID_INPUT);
    assert.equal(err.field, 'selected');
  }
});

test('persisted_rank gap [1,3] fails', () => {
  const arr = [entry(1, build8()), entry(3, build7NoGpu())];
  const err = rejectionOf(() => validateSelected(arr));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('persisted_rank offset [2,3] fails', () => {
  const a = entry(1, build8());
  const b = entry(2, build7NoGpu());
  const off = [cloneWith(a, { persisted_rank: 2 }), cloneWith(b, { persisted_rank: 3 })];
  const err = rejectionOf(() => validateSelected(off));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('duplicate persisted_rank [1,1] fails', () => {
  const arr = [entry(1, build8()), cloneWith(entry(2, build7NoGpu()), { persisted_rank: 1 })];
  const err = rejectionOf(() => validateSelected(arr));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('non-integer persisted_rank fails; missing rank is MISSING_REQUIRED_FIELD', () => {
  const errFloat = rejectionOf(() => validateSelected([singleEntry({ persisted_rank: 1.5 })]));
  assert.ok(errFloat instanceof CandidateSelectionError);
  assert.equal(errFloat.code, ERROR_CODES.INVALID_FIELD_VALUE);
  const errMissing = rejectionOf(() => validateSelected([singleEntry({ persisted_rank: undefined })]));
  assert.ok(errMissing instanceof CandidateSelectionError);
  assert.equal(errMissing.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
});

test('total_price zero/non-finite fails; missing is MISSING_REQUIRED_FIELD', () => {
  for (const v of [0, -5, NaN, Infinity, '5000']) {
    const err = rejectionOf(() => validateSelected([singleEntry({ total_price: v })]));
    assert.ok(err instanceof CandidateSelectionError, 'total_price ' + String(v) + ' must fail');
    assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  }
  const errMissing = rejectionOf(() => validateSelected([singleEntry({ total_price: undefined })]));
  assert.equal(errMissing.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
});

test('build_score out of [0,100] fails; boundaries 0 and 100 pass', () => {
  for (const v of [-1, 100.1, NaN, Infinity, '80']) {
    const err = rejectionOf(() => validateSelected([singleEntry({ build_score: v })]));
    assert.ok(err instanceof CandidateSelectionError, 'score ' + String(v) + ' must fail');
    assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  }
  assert.equal(validateSelected([singleEntry({ build_score: 0 })]), undefined);
  assert.equal(validateSelected([singleEntry({ build_score: 100 })]), undefined);
});

test('compatibility_status lowercase and unknown strings fail', () => {
  for (const v of ['pass', 'unknown', 'Pass', 'FAIL', 'REJECT', '']) {
    const err = rejectionOf(() => validateSelected([singleEntry({ compatibility_status: v })]));
    assert.ok(err instanceof CandidateSelectionError, 'status ' + String(v) + ' must fail');
    assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  }
  assert.equal(validateSelected([singleEntry({ compatibility_status: 'UNKNOWN' })]), undefined);
});

test('empty product_id fails', () => {
  const b = build8();
  const bad = { components: Object.freeze([comp('CPU', 'cpu-1', { productId: '' })].concat(b.components.slice(1))) };
  const err = rejectionOf(() => validateSelected([singleEntry({}, bad)]));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('bad component_role fails (incl lowercase)', () => {
  const b = build8();
  for (const role of ['SSD', 'cpu', 'Gpu', 'INVALID']) {
    const bad = { components: Object.freeze([comp('CPU', 'cpu-1', { role })].concat(b.components.slice(1))) };
    const err = rejectionOf(() => validateSelected([singleEntry({}, bad)]));
    assert.ok(err instanceof CandidateSelectionError, 'role ' + String(role) + ' must fail');
    assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  }
});

test('defensive component status REJECT fails', () => {
  const b = build8();
  const bad = { components: Object.freeze([comp('CPU', 'cpu-1', { status: 'REJECT' })].concat(b.components.slice(1))) };
  const err = rejectionOf(() => validateSelected([singleEntry({}, bad)]));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('explanation required non-empty string (Decision 22 item 5)', () => {
  // Valid explanation passes
  assert.equal(validateSelected([singleEntry({ explanation: 'Ranked 1: valid explanation' })]), undefined);

  // Missing or null fails with MISSING_REQUIRED_FIELD
  const errMissing = rejectionOf(() => validateSelected([singleEntry({ explanation: undefined })]));
  assert.ok(errMissing instanceof CandidateSelectionError);
  assert.equal(errMissing.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.match(errMissing.message, /selected\[0\]\.explanation is required/);

  const errNull = rejectionOf(() => validateSelected([singleEntry({ explanation: null })]));
  assert.ok(errNull instanceof CandidateSelectionError);
  assert.equal(errNull.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.match(errNull.message, /selected\[0\]\.explanation is required/);

  // Empty, whitespace-only, or non-string fails with INVALID_FIELD_VALUE
  for (const bad of ['', '   ', '\t\n ', 123, true, {}, []]) {
    const errBad = rejectionOf(() => validateSelected([singleEntry({ explanation: bad })]));
    assert.ok(errBad instanceof CandidateSelectionError, 'explanation ' + JSON.stringify(bad) + ' must fail');
    assert.equal(errBad.code, ERROR_CODES.INVALID_FIELD_VALUE);
    assert.match(errBad.message, /selected\[0\]\.explanation must be a non-empty string/);
  }
});

test('missing component.price entirely fails clearly, not a raw TypeError', () => {
  const b = build8();
  const bad = { components: Object.freeze([comp('CPU', 'cpu-1', { priceMissing: true })].concat(b.components.slice(1))) };
  const err = rejectionOf(() => validateSelected([singleEntry({}, bad)]));
  assert.ok(err instanceof CandidateSelectionError, 'must be CandidateSelectionError, got ' + String(err));
  assert.equal(err.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.match(err.message, /price is required/);
});

test('selected_price zero or non-finite fails; currency lowercase fails', () => {
  for (const v of [0, -1, NaN, Infinity]) {
    const err = rejectionOf(() => validateSelected([singleEntry({}, build8({ selected_price: v }))]));
    assert.ok(err instanceof CandidateSelectionError, 'selected_price ' + String(v) + ' must fail');
    assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  }
  const errCur = rejectionOf(() => validateSelected([singleEntry({}, build8({ currency: 'mad' }))]));
  assert.ok(errCur instanceof CandidateSelectionError);
  assert.equal(errCur.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('store_id set plus price_checked_at null fails (migration 011 direction)', () => {
  const err = rejectionOf(() => validateSelected([singleEntry({}, build8({ store_id: STORE_A, price_checked_at: null }))]));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.match(err.message, /price_checked_at/);
});

test('price_checked_at set plus store_id null passes (asymmetric, allowed)', () => {
  assert.equal(validateSelected([singleEntry({}, build8({ store_id: null, price_checked_at: TS }))]), undefined);
});

test('category and build.currency are ignored, never read', () => {
  const weird = {
    components: Object.freeze([comp('CPU', 'cpu-1', { category: 'TOTALLY-WRONG' }), comp('GPU', 'gpu-1', { category: 123 })]),
    currency: 'not-a-currency',
  };
  assert.equal(validateSelected([singleEntry({}, weird)]), undefined);
});

test('validate-selected.js reuses ranking error vocabulary, has no SQL or DB', () => {
  const source = fs.readFileSync(path.join(__dirname, 'validate-selected.js'), 'utf8');
  assert.ok(source.includes("require('../candidates/errors')"), 'must reuse candidates/errors');
  assert.ok(source.includes("require('../candidates/roles')"), 'must reuse role vocabulary');
  assert.ok(source.includes('MISSING_REQUIRED_FIELD'), 'must use MISSING_REQUIRED_FIELD');
  assert.ok(source.includes('INVALID_FIELD_VALUE'), 'must use INVALID_FIELD_VALUE');
  assert.ok(!source.includes('class CandidateSelectionError'), 'must not redefine error class');
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const banned = ['client.query', '.query(', 'SELECT', 'INSERT', 'UPDATE ', 'DELETE ', 'COMMIT', "require('pg')", 'new Pool'];
  for (const token of banned) {
    assert.ok(!stripped.includes(token), 'must not contain ' + token);
  }
});



