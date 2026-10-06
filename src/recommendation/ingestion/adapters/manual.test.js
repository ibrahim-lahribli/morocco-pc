'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseCsv, parseManualText } = require('./manual');

const HEADER = 'source,store_name,listing_identifier,raw_price,currency,availability,observed_at';

test('parseCsv honours quoted fields containing commas and newlines', () => {
  const rows = parseCsv('a,"b,c",d\n"x\ny",z,1\n');
  assert.deepEqual(rows[0], ['a', 'b,c', 'd']);
  assert.deepEqual(rows[1], ['x\ny', 'z', '1']);
});

test('a valid CSV produces rows with 1-based line numbers', () => {
  const csv = HEADER + ',title\nmanual,Seed UltraPC,L1,"1 299,00",MAD,IN_STOCK,2026-10-01T00:00:00Z,Seed Ryzen 5 7500F\n';
  const out = parseManualText(csv, { format: 'csv' });
  assert.equal(out.errors.length, 0);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].__line, 2);
  assert.equal(out.rows[0].raw_price, '1 299,00');
  assert.equal(out.rows[0].title, 'Seed Ryzen 5 7500F');
});

test('a missing required column is a file-level error, not a silent drop', () => {
  const csv = 'source,store_name,listing_identifier,raw_price,currency,availability\nmanual,S,L,1,MAD,IN_STOCK\n';
  const out = parseManualText(csv, { format: 'csv' });
  assert.equal(out.rows.length, 0);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0].reason, /^MISSING_COLUMNS:/);
  assert.match(out.errors[0].reason, /observed_at/);
});

test('an unknown column is rejected rather than ignored', () => {
  const csv = HEADER + ',bogus\nmanual,S,L,1,MAD,IN_STOCK,2026-10-01T00:00:00Z,x\n';
  const out = parseManualText(csv, { format: 'csv' });
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0].reason, /^UNKNOWN_COLUMNS:/);
});

test('JSON array input is accepted and auto-detected', () => {
  const json = JSON.stringify([
    { source: 'manual', store_name: 'S', listing_identifier: 'L', raw_price: '1', currency: 'MAD', availability: 'IN_STOCK', observed_at: '2026-10-01T00:00:00Z' },
  ]);
  const out = parseManualText(json);
  assert.equal(out.format, 'json');
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].__line, 1);
});

test('malformed JSON is reported, never thrown', () => {
  const out = parseManualText('{ not json');
  assert.equal(out.format, 'json');
  assert.equal(out.rows.length, 0);
  assert.equal(out.errors[0].reason, 'INVALID_JSON');
});

test('a non-array JSON document is rejected', () => {
  const out = parseManualText('{"offers": 5}');
  assert.equal(out.errors[0].reason, 'JSON_MUST_BE_ARRAY');
});
