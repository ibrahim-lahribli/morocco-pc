'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAsOf } = require('./as-of');

test('asOf normalizes offset timestamps and preserves absent input', () => {
  assert.equal(parseAsOf(undefined), null);
  assert.equal(parseAsOf({}), null);
  assert.deepEqual(parseAsOf({ asOf: '2026-10-08T22:00:00+02:00' }), {
    nowMs: Date.parse('2026-10-08T20:00:00.000Z'), iso: '2026-10-08T20:00:00.000Z',
  });
});

test('asOf rejects impossible calendar dates, local time, null and excess precision', () => {
  for (const asOf of [null, '', 123, '2026-02-30T00:00:00Z', '2026-10-08T24:00:00Z',
    '2026-10-08T20:00:00', '2026-10-08T20:00:00.1234Z', '2026-10-08T20:00:00+25:00']) {
    assert.throws(() => parseAsOf({ asOf }), e => e.field === 'asOf');
  }
});
