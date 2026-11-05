'use strict';

/**
 * scripts/lib/catalog-identity-cli.test.js - the I/O contract of
 * `scripts/check-catalog-identity.js`, the gate R-21 moved onto push/PR
 * (2026-11-03).
 *
 * Every assertion here is about the thing CI now depends on: the EXIT CODE
 * (0 PASS or INCONCLUSIVE, 1 FAIL or unreadable, 2 usage), the exact
 * `RESULT:` line a reader must be able to trust, and the fact that the
 * connection string is never printed - the report is meant to be pasted into
 * notes.
 *
 * `main(argv, deps)` takes injected `env` / `log` / `logError` / `createClient`,
 * so this is DB-free: a fake client returns the rows a read would have returned.
 * The real SELECT is still executed by the nightly job and by
 * `verify:pi1`-style live runs; what is pinned here is what happens to its rows.
 *
 * NOT part of `npm run test:unit`; run with:
 *   npm run test:scripts
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIVE_PRODUCTS_SQL,
  main,
  parseArgs,
  DEFAULT_TARGET_ENV,
  DEFAULT_MAX_EXAMPLES,
} = require('../check-catalog-identity');

const SECRET_URL = 'postgres://gate:sup3r-secret@db.example.invalid/neondb';

/** Two products that carry both identity columns. */
const IDENTIFIED = [
  { id: 1, name: 'Ryzen 5 5600', slug: 'ryzen-5-5600', display_name: 'Ryzen 5 5600' },
  { id: 2, name: 'B650M DS3H', slug: 'b650m-ds3h', display_name: 'B650M DS3H' },
];

/**
 * main() with recording writers and an injectable client. `rows` is what the
 * SELECT returns; `connectError` makes the client refuse to connect.
 */
function harness(overrides) {
  const lines = [];
  const errors = [];
  const configs = [];
  const state = { endCalled: 0, queryCount: 0 };
  const settings = Object.assign({ rows: IDENTIFIED, connectError: null }, overrides || {});

  const deps = Object.assign(
    {
      env: { DATABASE_URL: SECRET_URL },
      log: (line) => lines.push(line),
      logError: (line) => errors.push(line),
      createClient: (config) => {
        configs.push(config);
        return {
          connect: async () => {
            if (settings.connectError) throw settings.connectError;
          },
          query: async () => {
            state.queryCount += 1;
            return { rows: settings.rows };
          },
          end: async () => {
            state.endCalled += 1;
          },
        };
      },
    },
    settings.deps || {}
  );

  return {
    deps,
    configs,
    state,
    out: () => lines.join('\n'),
    err: () => errors.join('\n'),
  };
}

test('defaults are the documented ones and the scope is ACTIVE, ordered, offer-free', () => {
  assert.deepEqual(parseArgs([]), {
    targetEnv: DEFAULT_TARGET_ENV,
    maxExamples: DEFAULT_MAX_EXAMPLES,
    help: false,
  });
  assert.equal(DEFAULT_TARGET_ENV, 'DATABASE_URL');
  assert.equal(DEFAULT_MAX_EXAMPLES, 20);

  // The scope is the whole ACTIVE catalogue, not "products with an eligible
  // offer": a NULL slug removes a product from the catalog entirely, so the
  // rows that matter most are the ones no offer would have selected.
  assert.match(ACTIVE_PRODUCTS_SQL, /lifecycle_status = 'ACTIVE'/);
  assert.match(ACTIVE_PRODUCTS_SQL, /ORDER BY p\.id ASC/);
  assert.doesNotMatch(ACTIVE_PRODUCTS_SQL, /store_offer/);
});

test('--help exits 2 and touches nothing', async () => {
  const h = harness();
  assert.equal(await main(['--help'], h.deps), 2);
  assert.match(h.out(), /^usage: node scripts\/check-catalog-identity\.js/);
  assert.equal(h.err(), '');
  assert.equal(h.configs.length, 0);
});

test('the space form of --target is a usage error: a URL must never be accepted there', async () => {
  const h = harness();
  assert.equal(await main(['--target', SECRET_URL], h.deps), 2);
  assert.match(h.err(), /unrecognised argument/);
  assert.match(h.err(), /usage: node scripts\/check-catalog-identity\.js/);
  assert.equal(h.configs.length, 0);
});

test('a URL in the env:NAME slot is refused, because the report gets quoted', async () => {
  const h = harness();
  assert.equal(await main(['--target=postgres://u:p@h/db'], h.deps), 2);
  assert.match(h.err(), /takes a variable NAME as env:NAME/);
  assert.match(h.err(), /a connection string is never accepted/);
  assert.equal(h.configs.length, 0);
});

test('an unset variable exits 1 naming the variable, not the value', async () => {
  const h = harness({ deps: { env: {} } });
  assert.equal(await main([], h.deps), 1);
  assert.match(h.err(), /^ERROR: DATABASE_URL is not set \(pass --target=env:NAME to name another variable\)$/m);
  assert.equal(h.configs.length, 0);
});

test('PASS exits 0, states the scope size, and never prints the connection string', async () => {
  const h = harness();
  assert.equal(await main([], h.deps), 0);
  assert.equal(h.err(), '');
  assert.match(h.out(), /^Catalogue identity gate /);
  assert.match(h.out(), /^Target: env:DATABASE_URL$/m);
  assert.match(h.out(), /^RESULT: PASS - 2 ACTIVE product\(s\), every one carries slug and display_name$/m);
  assert.equal(h.out().includes('sup3r-secret'), false);
  assert.equal(h.out().includes('postgres://'), false);

  // The pooled connection is tagged, which is how a session can be attributed.
  assert.equal(h.configs.length, 1);
  assert.equal(h.configs[0].application_name, 'morocco-pc-catalog-identity');
  assert.equal(h.configs[0].statement_timeout, 15000);
  assert.equal(h.state.endCalled, 1);
});

test('FAIL exits 1 and names each offender with the column it lacks', async () => {
  const h = harness({
    rows: [
      { id: 7, name: 'No slug PSU', slug: null, display_name: 'No slug PSU' },
      { id: 9, name: 'No identity SSD', slug: null, display_name: null },
      IDENTIFIED[0],
    ],
  });
  assert.equal(await main([], h.deps), 1);
  assert.match(h.out(), /^RESULT: FAIL - 2 of 3 ACTIVE product\(s\) missing identity \(showing 2\):$/m);
  assert.match(h.out(), /^ {2}id=7 name="No slug PSU" missing=slug$/m);
  assert.match(h.out(), /^ {2}id=9 name="No identity SSD" missing=slug,display_name$/m);
  assert.equal(h.state.endCalled, 1);
});

test('INCONCLUSIVE exits 0 but says in words that nothing was checked', async () => {
  const h = harness({ rows: [] });
  assert.equal(await main([], h.deps), 0);
  assert.match(h.out(), /^RESULT: INCONCLUSIVE - no ACTIVE product exists; nothing could be checked$/m);
  assert.doesNotMatch(h.out(), /RESULT: PASS/);
});

test('--target=env:NAME is honoured and the report names the variable only', async () => {
  const h = harness({ deps: { env: { EU_TARGET: SECRET_URL } } });
  assert.equal(await main(['--target=env:EU_TARGET'], h.deps), 0);
  assert.match(h.out(), /^Target: env:EU_TARGET$/m);
  assert.equal(h.out().includes('neondb'), false);
});

test('--max-examples reaches the report as a truncation, never as a shorter count', async () => {
  const rows = [];
  for (let i = 1; i <= 4; i += 1) rows.push({ id: i, name: 'p' + i, slug: null, display_name: null });
  const h = harness({ rows });
  assert.equal(await main(['--max-examples=1'], h.deps), 1);
  assert.match(h.out(), /^RESULT: FAIL - 4 of 4 ACTIVE product\(s\) missing identity \(showing 1\):$/m);
  assert.equal((h.out().match(/^ {2}id=/gm) || []).length, 1);
});

test('an unreadable catalogue exits 1 and still closes the pool', async () => {
  const h = harness({ connectError: new Error('password authentication failed for user "gate"') });
  assert.equal(await main([], h.deps), 1);
  assert.match(h.err(), /^RESULT: FAIL - the catalogue could not be read: password authentication failed/m);
  assert.doesNotMatch(h.out(), /RESULT: PASS/);
  assert.equal(h.state.endCalled, 1);
});
