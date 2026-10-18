'use strict';

/**
 * scripts/lib/origin-readiness.test.js - the PURE half of
 * `scripts/check-origin-readiness.js` (P2 Sprint 2 Step 4 / EU runbook §8.4).
 *
 * What only a unit test can pin: that a table HEADER or the CREATED AT
 * timestamp can never become a trusted address, that a missing `db` field is
 * never read as healthy, and that the health URL cannot acquire a double slash.
 * The I/O half, exit codes and exact FAIL lines are pinned in
 * origin-readiness-cli.test.js; a live origin is the owner's run.
 *
 * NOT part of `npm run test:unit` (that glob covers src/ only); run with:
 *   npm run test:scripts
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseFlyIps, checkHealth, healthUrl } = require('./origin-readiness');

const TABLE = [
  'IP ADDRESS         TYPE      REGION  CREATED AT',
  '66.241.125.10      shared    fra     2026-10-18T09:00:00Z',
  '2a09:8280:1::4a:0  dedicated fra     2026-10-18T09:00:00Z',
].join('\n');

test('parses the address column of a real fly ips list table', () => {
  assert.deepEqual(parseFlyIps(TABLE), ['66.241.125.10', '2a09:8280:1::4a:0']);
});

test('the CREATED AT timestamp is never mistaken for an IPv6 address', () => {
  // The regex this replaced matched "09:00:00" here; net.isIP does not.
  const junk = [
    'IP ADDRESS  TYPE    REGION  CREATED AT',
    'not-an-ip   shared  fra     2026-10-18T09:00:00Z',
  ].join('\n');
  assert.deepEqual(parseFlyIps(junk), []);
});

test('a header-only table yields no addresses', () => {
  assert.deepEqual(parseFlyIps('IP ADDRESS  TYPE  REGION  CREATED AT\n'), []);
  assert.deepEqual(parseFlyIps(''), []);
});

test('duplicates are collapsed and output order is preserved', () => {
  const raw = [
    '2a09:8280:1::4a:0  dedicated',
    '66.241.125.10      shared',
    '66.241.125.10      shared',
  ].join('\r\n');
  assert.deepEqual(parseFlyIps(raw), ['2a09:8280:1::4a:0', '66.241.125.10']);
});

test('indented rows and trailing notes are handled', () => {
  const raw = '  66.241.125.10  shared\nNo IPs found.\n';
  assert.deepEqual(parseFlyIps(raw), ['66.241.125.10']);
});

test('a non-string input is a TypeError, not an empty pass', () => {
  assert.throws(() => parseFlyIps(undefined), TypeError);
  assert.throws(() => parseFlyIps(null), TypeError);
});

test('a healthy 2xx body passes', () => {
  assert.deepEqual(checkHealth(200, '{"status":"ok","db":"ok"}'), {
    ok: true,
    code: 'OK',
    detail: 'status=ok db=ok',
  });
  // Any 2xx counts: the route currently answers 200, and a 201/204-class
  // change must not be treated as an outage.
  assert.equal(checkHealth(201, '{"status":"ok","db":"ok"}').ok, true);
});

test('a non-2xx status fails even when the body looks healthy', () => {
  const verdict = checkHealth(500, '{"status":"ok","db":"ok"}');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'HTTP_STATUS');
  assert.equal(verdict.detail, 'HTTP 500');
  assert.equal(checkHealth(300, '{"status":"ok","db":"ok"}').code, 'HTTP_STATUS');
});

test('an unparseable or non-object body fails', () => {
  assert.equal(checkHealth(200, 'not json').code, 'NOT_JSON');
  assert.equal(checkHealth(200, '').code, 'NOT_JSON');
  assert.equal(checkHealth(204, '').code, 'NOT_JSON');
  assert.equal(checkHealth(200, 'null').code, 'NOT_OBJECT');
  assert.equal(checkHealth(200, '[]').code, 'NOT_OBJECT');
  assert.equal(checkHealth(200, '"ok"').code, 'NOT_OBJECT');
});

test('db must be the exact string "ok" - UNKNOWN is never healthy', () => {
  const down = checkHealth(200, '{"status":"ok","db":"down"}');
  assert.equal(down.ok, false);
  assert.equal(down.code, 'NOT_OK');
  assert.equal(down.detail, 'status=ok db=down');

  const missing = checkHealth(200, '{"status":"ok"}');
  assert.equal(missing.code, 'NOT_OK');
  assert.equal(missing.detail, 'status=ok db=undefined');

  assert.equal(checkHealth(200, '{"status":"OK","db":"ok"}').code, 'NOT_OK');
  assert.equal(checkHealth(200, '{"status":"degraded","db":"ok"}').code, 'NOT_OK');
});

test('the health URL has exactly one slash and carries the probe marker', () => {
  assert.equal(
    healthUrl('https://morocco-pc-api.fly.dev'),
    'https://morocco-pc-api.fly.dev/v1/health?probe=preflight'
  );
  assert.equal(
    healthUrl('https://morocco-pc-api.fly.dev///'),
    'https://morocco-pc-api.fly.dev/v1/health?probe=preflight'
  );
  assert.equal(
    healthUrl(' http://127.0.0.1:8099 '),
    'http://127.0.0.1:8099/v1/health?probe=preflight'
  );
  assert.throws(() => healthUrl('   '), TypeError);
});
