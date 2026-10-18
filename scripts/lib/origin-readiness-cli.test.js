'use strict';

/**
 * scripts/lib/origin-readiness-cli.test.js - the I/O contract of
 * `scripts/check-origin-readiness.js` (P2 Sprint 2 Step 4 / EU runbook §8.4).
 *
 * Every assertion here is about the thing the runbook relies on: the EXIT CODE
 * (0 both facts held, 1 an assertion failed, 2 usage), the exact `FAIL
 * preflight:` line an operator must stop on, and the fact that a failed first
 * check never reaches the second one (no health GET, no addresses printed).
 *
 * `main(argv, deps)` takes injected `runFly` / `fetchHealth` / writers, so this
 * is DB-free, network-free and flyctl-free. A stub `fly` on PATH would have
 * tested the stub; a local HTTP server would have tested the socket. The live
 * run is the owner's, in the runbook.
 *
 * NOT part of `npm run test:unit`; run with:
 *   npm run test:scripts
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  normalizeOrigin,
  main,
  USAGE,
  DEFAULT_APP,
} = require('../check-origin-readiness');

const TABLE = [
  'IP ADDRESS         TYPE      REGION  CREATED AT',
  '66.241.125.10      shared    fra     2026-10-18T09:00:00Z',
  '2a09:8280:1::4a:0  dedicated fra     2026-10-18T09:00:00Z',
].join('\n');

/** main() with recording writers and injectable collaborators. */
function harness(overrides) {
  const lines = [];
  const errors = [];
  const calls = { fly: [], health: [] };
  const deps = Object.assign(
    {
      runFly: (app) => {
        calls.fly.push(app);
        return { status: 0, stdout: TABLE, stderr: '', error: null };
      },
      fetchHealth: async (url) => {
        calls.health.push(url);
        return { status: 200, bodyText: '{"status":"ok","db":"ok"}' };
      },
      log: (line) => lines.push(line),
      logError: (line) => errors.push(line),
    },
    overrides || {}
  );
  return {
    deps,
    calls,
    out: () => lines.join('\n'),
    err: () => errors.join('\n'),
  };
}

test('defaults: the runbook app and its own fly.dev origin', () => {
  assert.deepEqual(parseArgs([]), { help: false, app: DEFAULT_APP, origin: null });
  assert.equal(DEFAULT_APP, 'morocco-pc-api');
});

test('a green origin exits 0 and prints the table plus the pin-able addresses', async () => {
  const h = harness();
  const code = await main([], h.deps);
  assert.equal(code, 0);
  assert.equal(h.err(), '');
  assert.equal(h.calls.fly[0], DEFAULT_APP);
  assert.deepEqual(h.calls.health, ['https://morocco-pc-api.fly.dev/v1/health?probe=preflight']);
  assert.match(h.out(), /^IP ADDRESS/);
  assert.match(h.out(), /PREFLIGHT OK - addresses:\n66\.241\.125\.10\n2a09:8280:1::4a:0$/);
});

test('--app and --origin are honoured, and a trailing slash is removed', async () => {
  const h = harness();
  const code = await main(
    ['--app=morocco-pc-api-eu', '--origin=https://api.example.test///'],
    h.deps
  );
  assert.equal(code, 0);
  assert.equal(h.calls.fly[0], 'morocco-pc-api-eu');
  assert.deepEqual(h.calls.health, ['https://api.example.test/v1/health?probe=preflight']);
});

test('--help exits 0 and names the usage', async () => {
  const h = harness();
  assert.equal(await main(['--help'], h.deps), 0);
  assert.ok(h.out().includes(USAGE));
  assert.equal(h.calls.fly.length, 0);
});

test('usage errors exit 2 before anything is run', async () => {
  for (const argv of [
    ['--nope=1'],
    ['--app='],
    ['--app=  '],
    ['--origin=ftp://morocco-pc-api.fly.dev'],
    ['--origin=not-a-url'],
    ['--origin=https://example.test/?a=1'],
    ['https://morocco-pc-api.fly.dev'],
  ]) {
    const h = harness();
    const code = await main(argv, h.deps);
    assert.equal(code, 2, 'argv: ' + JSON.stringify(argv));
    assert.ok(h.err().includes(USAGE), 'usage printed for ' + JSON.stringify(argv));
    assert.equal(h.calls.fly.length, 0, 'fly not run for ' + JSON.stringify(argv));
  }
});

test('an origin that embeds credentials is refused without echoing them', async () => {
  const h = harness();
  const code = await main(['--origin=https://user:secret@example.test'], h.deps);
  assert.equal(code, 2);
  assert.match(h.err(), /must not embed credentials/);
  assert.doesNotMatch(h.err(), /secret/);
  assert.equal(h.calls.fly.length, 0);
});

test('a fly failure fails closed with fly\'s own detail and no health probe', async () => {
  const h = harness({
    runFly: () => ({
      status: 1,
      stdout: '',
      stderr: 'Error: authentication required\n',
      error: null,
    }),
  });
  assert.equal(await main([], h.deps), 1);
  assert.match(h.err(), /FAIL preflight: 'fly ips list' itself failed/);
  assert.match(h.err(), /authentication required/);
  assert.equal(h.calls.health.length, 0);
});

test('a spawn error and a thrown runner are both failures, not crashes', async () => {
  const spawn = harness({
    runFly: () => ({ status: null, stdout: '', stderr: '', error: new Error('spawnSync fly ENOENT') }),
  });
  assert.equal(await main([], spawn.deps), 1);
  assert.match(spawn.err(), /itself failed/);
  assert.match(spawn.err(), /ENOENT/);

  const thrown = harness({
    runFly: () => {
      throw new Error('fly is not installed');
    },
  });
  assert.equal(await main([], thrown.deps), 1);
  assert.match(thrown.err(), /itself failed/);
  assert.match(thrown.err(), /fly is not installed/);
});

test('an addressless app fails with allocation advice and no health probe', async () => {
  const h = harness({
    runFly: () => ({ status: 0, stdout: 'IP ADDRESS  TYPE  REGION  CREATED AT\n', stderr: '', error: null }),
  });
  assert.equal(await main(['--app=morocco-pc-api'], h.deps), 1);
  assert.match(h.err(), /FAIL preflight: fly ips list printed no address\./);
  assert.match(h.err(), /fly ips allocate-v6 --app morocco-pc-api/);
  assert.match(h.err(), /do not pin TRUST_PROXY/);
  assert.equal(h.calls.health.length, 0);
});

test('a health probe that never answers fails', async () => {
  const h = harness({
    fetchHealth: async () => {
      throw new Error('The operation was aborted due to timeout');
    },
  });
  assert.equal(await main([], h.deps), 1);
  assert.match(h.err(), /GET https:\/\/morocco-pc-api\.fly\.dev\/v1\/health\?probe=preflight did not answer 2xx/);
  assert.match(h.err(), /aborted due to timeout/);
});

test('a non-2xx health answer fails and names the status', async () => {
  const h = harness({ fetchHealth: async () => ({ status: 500, bodyText: '{}' }) });
  assert.equal(await main([], h.deps), 1);
  assert.match(h.err(), /did not answer 2xx \(HTTP 500\)\./);
});

test('a non-JSON health body fails', async () => {
  const h = harness({ fetchHealth: async () => ({ status: 200, bodyText: '<html>gateway</html>' }) });
  assert.equal(await main([], h.deps), 1);
  assert.match(h.err(), /FAIL preflight: health body is not JSON/);
});

test('db "down" fails with the exact stop line', async () => {
  const h = harness({
    fetchHealth: async () => ({ status: 200, bodyText: '{"status":"ok","db":"down"}' }),
  });
  assert.equal(await main([], h.deps), 1);
  assert.match(h.err(), /FAIL preflight: status=ok db=down - fix the deploy, then re-run this check/);
});

test('the address table is printed even when a later check fails', async () => {
  const h = harness({ fetchHealth: async () => ({ status: 503, bodyText: '{}' }) });
  await main([], h.deps);
  assert.match(h.out(), /^IP ADDRESS/);
  assert.match(h.out(), /66\.241\.125\.10/);
  assert.doesNotMatch(h.out(), /PREFLIGHT OK/);
});

test('normalizeOrigin accepts http(s) and strips trailing slashes', () => {
  assert.equal(normalizeOrigin('https://example.test///'), 'https://example.test');
  assert.equal(normalizeOrigin('http://127.0.0.1:8099'), 'http://127.0.0.1:8099');
  assert.throws(() => normalizeOrigin('ftp://example.test'), /http\(s\)/);
});
