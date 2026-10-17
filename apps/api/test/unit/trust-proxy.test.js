'use strict';

/**
 * apps/api/test/unit/trust-proxy.test.js - `TRUST_PROXY`, the trusted-proxy list
 * that decides whether `request.ip` is the client or the proxy (Platform P2
 * Sprint 2).
 *
 * Why a proxy ADDRESS and not a hop count: the plan called for a hop count, but
 * fastify@5.12 deliberately disables numeric `trustProxy` - its `getTrustProxyFn`
 * returns a function that trusts nothing - because a bare hop count cannot
 * validate the immediate peer, so a direct client could spoof `X-Forwarded-For`
 * by supplying enough hops. Verified 2026-10-17 against the installed 5.12.5:
 * `trustProxy: 1` leaves `request.ip` at the socket address. Naming the proxy is
 * the form Fastify supports, and it is strictly stronger: the parser REFUSES a
 * hop count and `true` (which trusts the whole chain, including a client-written
 * prefix) instead of coercing either into something that silently voids the
 * per-IP contract.
 *
 * The bucket consequences are pinned in `rate-limit.test.js` (scenarios 2.1-2.3).
 * What this file owns is the CONFIG contract: what a value parses to, that the
 * unsafe shapes are REFUSED, and that `buildApp` takes the value from the
 * environment unless a caller passes one explicitly.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = require('../helpers/stub');
const { parseTrustProxy } = require('../../src/app');

const CLIENT_A = '203.0.113.9';
const CLIENT_B = '198.51.100.7';

/**
 * One request's remaining budget. With distinct buckets the two calls below both
 * report 29; in one shared bucket the second reports 28 - which is exactly the
 * property the whole setting exists for, probed with two requests instead of 31.
 */
async function remaining(app, forwardedFor) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/recommendations',
    payload: stub.validBody(),
    headers: { 'x-forwarded-for': forwardedFor },
  });
  return response.headers['x-ratelimit-remaining'];
}

test('unset, blank or an explicit false disables proxy trust - the default', () => {
  for (const value of [undefined, null, false, '', '   ', 'false', 'FALSE', '0', 'off', 'no']) {
    assert.equal(parseTrustProxy(value), false, 'expected false for ' + JSON.stringify(value));
  }
});

test('a proxy address, CIDR or named range becomes a trusted-peer list', () => {
  assert.deepEqual(parseTrustProxy('127.0.0.1'), ['127.0.0.1']);
  assert.deepEqual(parseTrustProxy('::1'), ['::1']);
  assert.deepEqual(parseTrustProxy('10.0.0.0/8'), ['10.0.0.0/8']);
  assert.deepEqual(parseTrustProxy('fd00::/8'), ['fd00::/8']);
  assert.deepEqual(parseTrustProxy('loopback'), ['loopback']);
  assert.deepEqual(
    parseTrustProxy(' 127.0.0.1 , 192.168.0.0/16 '),
    ['127.0.0.1', '192.168.0.0/16'],
    'the list is trimmed and ordered as written'
  );
});

test('a hop count is REFUSED with a message that names the supported form', () => {
  for (const value of [1, '1', '2']) {
    assert.throws(
      () => parseTrustProxy(value),
      (error) => /TRUST_PROXY/.test(error.message) && /hop count/i.test(error.message) && /127\.0\.0\.1/.test(error.message),
      'a hop count of ' + JSON.stringify(value) + ' must fail at startup, not silently ignore every header'
    );
  }
});

test('`true` is REFUSED: trusting the whole chain lets a client write its own key', () => {
  for (const value of ['true', 'TRUE', 'yes', 'on']) {
    assert.throws(
      () => parseTrustProxy(value),
      /TRUST_PROXY/,
      JSON.stringify(value) + ' must not be accepted'
    );
  }
});

test('a /0 prefix is REFUSED too: it is `true` in CIDR spelling', () => {
  // Trusting every peer makes request.ip the leftmost X-Forwarded-For entry, so
  // a CIDR that covers the whole space reopens exactly the bypass `true` is
  // refused for. A narrow prefix must keep working either side of it.
  for (const value of ['0.0.0.0/0', '::/0', '127.0.0.1, 0.0.0.0/0']) {
    assert.throws(
      () => parseTrustProxy(value),
      /EVERY peer/,
      JSON.stringify(value) + ' must be refused as equivalent to true'
    );
  }
  assert.deepEqual(parseTrustProxy('0.0.0.0/1'), ['0.0.0.0/1']);
  assert.deepEqual(parseTrustProxy('::/1'), ['::/1']);
});

test('a malformed entry is REFUSED, not dropped', () => {
  for (const value of ['not-an-ip', '203.0.113.9/33', 'fd00::/129', '10.0.0.0/8/9', '127.0.0.1, nope']) {
    assert.throws(
      () => parseTrustProxy(value),
      /TRUST_PROXY/,
      'the value ' + JSON.stringify(value) + ' must fail loudly'
    );
  }
});

test('a hop count in the environment fails APP CONSTRUCTION, not merely the parser', () => {
  // server.js builds the app before it listens, so this throw is a startup
  // failure: the process exits 1 instead of serving with every header ignored.
  assert.throws(
    () => stub.createTestApp({ env: { TRUST_PROXY: '1' } }),
    /hop count/i
  );
});

test('buildApp takes the trusted proxy from TRUST_PROXY without an explicit option', async () => {
  const app = stub.createTestApp({ env: { TRUST_PROXY: '127.0.0.1' } });
  assert.equal(await remaining(app, CLIENT_A), '29');
  assert.equal(await remaining(app, CLIENT_B), '29', 'two addresses, two buckets');
});

test('an explicit trustProxy option wins over the environment', async () => {
  const app = stub.createTestApp({ env: { TRUST_PROXY: '127.0.0.1' }, trustProxy: false });
  assert.equal(await remaining(app, CLIENT_A), '29');
  assert.equal(await remaining(app, CLIENT_B), '28', 'both addresses share one bucket');
});

test('with nothing configured the two forwarded addresses share one bucket', async () => {
  const app = stub.createTestApp({ env: {} });
  assert.equal(await remaining(app, CLIENT_A), '29');
  assert.equal(await remaining(app, CLIENT_B), '28', 'the default must ignore the header');
});

test('an untrusted socket address is still ignored, so the list is a real allow-list', async () => {
  // inject's socket is 127.0.0.1; trusting a DIFFERENT address must change nothing.
  const app = stub.createTestApp({ env: { TRUST_PROXY: '10.0.0.0/8' } });
  assert.equal(await remaining(app, CLIENT_A), '29');
  assert.equal(await remaining(app, CLIENT_B), '28', 'a proxy list that excludes the peer trusts nothing');
});
