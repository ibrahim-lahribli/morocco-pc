'use strict';

// Boundary test: explanation/index.js is the canonical public surface and
// re-exports the explainer and the E7 reason-code vocabulary/deriver by
// identity, adding no logic of its own.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const explanation = require('./index');
const explain = require('./explain');
const reasons = require('./reasons');

test('explanation barrel exposes the documented public API, in order', () => {
  assert.deepEqual(Object.keys(explanation), [
    'explainSelection',
    'deriveReasons',
    'REASON_CODES',
    'REASON_ORDER',
  ]);
});

test('explanation barrel re-exports by identity - no wrapper, no copy', () => {
  assert.strictEqual(explanation.explainSelection, explain.explainSelection);
  assert.strictEqual(explanation.deriveReasons, reasons.deriveReasons);
  assert.strictEqual(explanation.REASON_CODES, reasons.REASON_CODES);
  assert.strictEqual(explanation.REASON_ORDER, reasons.REASON_ORDER);
});

test('explanation barrel adds no logic of its own', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  for (const token of ['function ', '.query(', "require('pg')", 'async']) {
    assert.ok(!source.includes(token), `explanation/index.js must not contain ${token}`);
  }
});
