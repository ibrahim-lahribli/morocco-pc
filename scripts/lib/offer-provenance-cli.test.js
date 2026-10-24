'use strict';

/**
 * scripts/lib/offer-provenance-cli.test.js - the CLI half of
 * `check-offer-provenance.js`: argument handling, the exit codes, and the exact
 * wording of the INCONCLUSIVE verdict.
 *
 * The wording is pinned because it is the product claim: a seed catalog must never
 * be described as "verified", and a later edit that softens this line should have
 * to change a test on purpose.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { formatReport, parseArgs, USAGE } = require('../check-offer-provenance');
const { evaluateProvenance } = require('./offer-provenance');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AS_OF = new Date('2026-10-23T12:00:00Z');

/** A clean env: dotenv is not read here, so DATABASE_URL must not leak in. */
function isolatedEnv(overrides) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot };
  return Object.assign(env, overrides || {});
}

function run(args, env) {
  return spawnSync(process.execPath, ['scripts/check-offer-provenance.js'].concat(args), {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: isolatedEnv(env),
  });
}

test('the default target is DATABASE_URL and the equals form is mandatory', () => {
  assert.equal(parseArgs([]).targetEnv, 'DATABASE_URL');
  assert.equal(parseArgs([]).maxExamples, 5);
  assert.equal(parseArgs(['--target=env:TARGET_DATABASE_URL']).targetEnv, 'TARGET_DATABASE_URL');
  assert.equal(parseArgs(['--max-examples=0']).maxExamples, 0);

  for (const bad of ['--target=postgres://u:p@ep-x.neon.tech/neondb', '--target=env:', '--target=env:lower_case', '--max-examples=-1', '--max-examples=x']) {
    assert.throws(() => parseArgs([bad]), (error) => error.usage === true, bad + ' must be a usage error');
  }
  // The space form is not accepted: `--target env:X` leaves `env:X` as an
  // unknown argument, which is a usage error rather than a silent default.
  assert.throws(() => parseArgs(['--target', 'env:X']), (error) => error.usage === true);
});

test('CLI: --help and an unknown flag exit 2', () => {
  const help = run(['--help']);
  assert.equal(help.status, 2);
  assert.match(help.stdout + help.stderr, /usage: node scripts\/check-offer-provenance\.js/);

  const unknown = run(['--nope']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout + unknown.stderr, /unknown argument: --nope/);
  assert.match(USAGE, /INCONCLUSIVE/);
});

test('CLI: an unset target variable exits 1 BEFORE connecting', () => {
  const child = run(['--target=env:NOT_SET_ANYWHERE']);
  assert.equal(child.status, 1);
  const output = child.stdout + child.stderr;
  assert.match(output, /NOT_SET_ANYWHERE is not set/);
  assert.doesNotMatch(output, /ECONNREFUSED|ENOTFOUND|getaddrinfo|connection terminated/i, 'nothing dialled a host');
});

test('the INCONCLUSIVE report says the catalog must NOT be presented as verified', () => {
  const offers = [
    {
      id: 's1',
      store_name: 'Seed NextGamer',
      store_website_url: 'https://example.ma/nextgamer',
      ingestion_record_id: null,
      listing_identifier: null,
      product_url: null,
      seller_name: null,
      fetched_at: '2026-10-04T04:27:21Z',
    },
  ];
  const view = evaluateProvenance(offers, [], { asOf: AS_OF });
  const lines = formatReport(view, { asOf: AS_OF, maxExamples: 5 }).join('\n');
  assert.match(lines, /RESULT: INCONCLUSIVE/);
  assert.match(lines, /must not be presented as recently verified/);
  assert.doesNotMatch(lines, /RESULT: PASS/);
  assert.match(lines, /Newest retailer observation: none/);
  assert.match(lines, /Price observations: none/);
});

test('a PASS report names the observation time and no seed row is counted as verified', () => {
  const view = evaluateProvenance(
    [
      {
        id: 'a',
        store_name: 'Real Store',
        store_website_url: 'https://realstore.ma',
        ingestion_record_id: 'r1',
        listing_identifier: 'RS-1',
        product_url: 'https://www.realstore.ma/p/1',
        seller_name: 'Real Store',
        fetched_at: '2026-10-23T09:00:00Z',
      },
    ],
    [{ store_offer_id: 'a', observed_at: '2026-10-23T09:00:00Z', ingestion_record_id: 'r1' }],
    { asOf: AS_OF }
  );
  const lines = formatReport(view, { asOf: AS_OF, maxExamples: 5 }).join('\n');
  assert.match(lines, /RESULT: PASS/);
  assert.match(lines, /Newest retailer observation: 2026-10-23T09:00:00\.000Z/);
});
