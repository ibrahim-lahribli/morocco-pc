'use strict';

// scripts/lib/offer-freshness.test.js - the DB-free contract of the OG-30 gate's
// pure half (Platform P3 Sprint 5). Runs in `test:scripts`
// (`node --test "scripts/lib/*.test.js"`).
//
// What it pins, scenario by scenario (the plan's table):
//   5.1  a STALE non-seed offer of ANY class FAILS - including one whose class is
//        not VERIFIED, which the old class-only gate left informational;
//   5.2  a FRESH non-seed offer passes;
//   5.3  the 101 current seed offers stay informational (no failure);
//   5.4  the boundary at exactly `failDays` is INCLUSIVE;
//   5.5  a non-seed offer with NULL `fetched_at` is REPORTED as unknown, never
//        counted as fresh;
//   5.6  the CLI's `--fail-days 14` space form still exits 2 (unchanged by
//        design), asserted by SPAWNING because a `throw` cannot tell you what a
//        process exits with.
//
// The helper is pure: `asOf` is injected, so every date here is exact and no test
// reads the clock.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  FRESHNESS_WINDOW_DAYS,
  DEFAULT_FAIL_DAYS,
  CLASSIFICATIONS,
  isSeedOffer,
  classifyOffer,
  evaluateFreshness,
} = require('./offer-freshness');

const DAY_MS = 24 * 60 * 60 * 1000;
const AS_OF = new Date('2026-10-17T00:00:00.000Z');
const daysAgo = (n) => new Date(AS_OF.getTime() - n * DAY_MS).toISOString();

const INGESTED = '11111111-1111-4111-8111-111111111111';

/** A seed row: no ingestion record (Decision 35 / migration 017). */
function seedRow(id, ageDays) {
  return { id, ingestion_record_id: null, last_checked_at: daysAgo(ageDays) };
}

/** A non-seed row: an ingestion record is present, so its age comes from fetched_at. */
function nonSeedRow(id, ageDays, extra) {
  return Object.assign({
    id,
    ingestion_record_id: INGESTED,
    fetched_at: ageDays === null ? null : daysAgo(ageDays),
  }, extra || {});
}

test('classifyOffer: the four classes, and an unknown class is never VERIFIED', () => {
  assert.equal(classifyOffer(seedRow('s', 1)), CLASSIFICATIONS.SEED, 'no ingestion record is SEED');
  assert.equal(classifyOffer({ ingestion_record_id: null, last_checked_at: daysAgo(1) }), 'SEED');
  assert.equal(classifyOffer({}), 'SEED', 'a row missing every field reads as a seed, not as verified');
  assert.equal(classifyOffer(undefined), 'SEED', 'the classifier is total');

  assert.equal(classifyOffer(nonSeedRow('a', 1, { offer_class: 'VERIFIED' })), 'VERIFIED');
  assert.equal(classifyOffer(nonSeedRow('b', 1, { offer_class: 'SEED_UNVERIFIED' })), 'UNVERIFIED');
  assert.equal(classifyOffer(nonSeedRow('c', 1)), 'NON_SEED_UNVERIFIED', 'an unrecorded class is not assumed verified');
  assert.equal(classifyOffer(nonSeedRow('d', 1, { offer_class: 'REVIEWED' })), 'NON_SEED_UNVERIFIED', 'an unknown class is not verified');
  assert.equal(isSeedOffer(seedRow('s', 1)), true);
  assert.equal(isSeedOffer(nonSeedRow('n', 1)), false);
});

test('5.3: 101 current seed offers produce no failure and stay informational', () => {
  const rows = [];
  for (let i = 0; i < 101; i += 1) rows.push(seedRow('00000000-0000-4000-8000-' + String(i).padStart(12, '0'), 12));
  const view = evaluateFreshness(rows, { failDays: 14, asOf: AS_OF });

  assert.equal(view.counts.total, 101);
  assert.equal(view.counts.seedTotal, 101);
  assert.equal(view.counts.seedFresh, 101);
  assert.equal(view.counts.seedExpired, 0);
  assert.equal(view.counts.nonSeedTotal, 0);
  assert.equal(view.failing.length, 0, 'seed offers never fail the gate');
  assert.equal(view.warnings.length, 0);
  assert.equal(view.firstExpiry, null, 'no non-seed expiry exists yet');
  // 12 days old + a 30-day window = 18 days to first seed expiry.
  assert.equal(Math.round((view.seedFirstExpiry.getTime() - AS_OF.getTime()) / DAY_MS), 18);
});

test('5.3 (pinned): a seed offer NEVER fails, however stale it is', () => {
  const view = evaluateFreshness([seedRow('s1', 400)], { failDays: 14, asOf: AS_OF });
  assert.equal(view.counts.seedExpired, 1, 'the staleness is reported');
  assert.equal(view.failing.length, 0, 'but it stays informational (Decision 35 beta waiver)');
  assert.ok(view.seedFirstExpiry.getTime() < AS_OF.getTime(), 'its expiry is in the past');
});

test('5.1: a STALE non-seed offer fails for every non-seed class', () => {
  const cases = [
    ['u', { offer_class: 'SEED_UNVERIFIED' }, 'UNVERIFIED'],
    ['v', { offer_class: 'VERIFIED' }, 'VERIFIED'],
    ['n', {}, 'NON_SEED_UNVERIFIED'],
  ];
  for (const [id, extra, expectedClass] of cases) {
    const view = evaluateFreshness([nonSeedRow(id, 40, extra)], { failDays: 14, asOf: AS_OF });
    assert.equal(view.failing.length, 1, expectedClass + ' must fail when stale');
    assert.equal(view.failing[0].classification, expectedClass);
    assert.equal(view.failing[0].reason, 'EXPIRED');
    assert.equal(view.counts.nonSeedExpired, 1);
    assert.equal(view.counts.nonSeedFresh, 0);
  }
});

test('5.1 (the regression the sprint exists for): an expired NON_SEED_UNVERIFIED offer is not informational', () => {
  // Exactly the shape the old gate could not see: a non-seed offer whose class is
  // not VERIFIED. It must be in `failing`, not in `warnings`.
  const view = evaluateFreshness([nonSeedRow('x', 31)], { failDays: 7, asOf: AS_OF });
  assert.equal(view.failing.length, 1);
  assert.equal(view.warnings.length, 0);
  assert.equal(view.failing[0].reason, 'EXPIRED');
});

test('5.2: a fresh non-seed offer passes', () => {
  const view = evaluateFreshness([nonSeedRow('f', 1)], { failDays: 14, asOf: AS_OF });
  assert.equal(view.failing.length, 0);
  assert.equal(view.warnings.length, 0);
  assert.equal(view.counts.nonSeedFresh, 1);
  assert.equal(Math.round((view.firstExpiry.getTime() - AS_OF.getTime()) / DAY_MS), 29);
});

test('5.4: the boundary at exactly failDays is INCLUSIVE', () => {
  const atBoundary = 30 - 7; // → expires in exactly 7 days
  const justInside = 30 - 7 - 0.0001; // → 7.0001 days out, just outside
  assert.equal(
    evaluateFreshness([nonSeedRow('b', atBoundary)], { failDays: 7, asOf: AS_OF }).failing.length,
    1,
    'exactly failDays out is failing'
  );
  const inside = evaluateFreshness([nonSeedRow('i', justInside)], { failDays: 7, asOf: AS_OF });
  assert.equal(inside.failing.length, 0, 'one moment beyond the boundary passes');
  assert.equal(inside.counts.nonSeedFresh, 1);
  // An offer expiring exactly NOW (age === the window) is expired, not fresh.
  const expired = evaluateFreshness([nonSeedRow('e', FRESHNESS_WINDOW_DAYS)], { failDays: 7, asOf: AS_OF });
  assert.equal(expired.failing[0].reason, 'EXPIRED');
  assert.equal(expired.counts.nonSeedExpired, 1);
});

test('5.5: a non-seed offer with NULL fetched_at is REPORTED as unknown, never fresh', () => {
  const view = evaluateFreshness([nonSeedRow('z', null)], { failDays: 14, asOf: AS_OF });
  assert.equal(view.warnings.length, 1, 'the offer is surfaced');
  assert.deepEqual(view.warnings[0], { id: 'z', classification: 'NON_SEED_UNVERIFIED', reason: 'UNKNOWN_AGE' });
  assert.equal(view.failing.length, 0, 'unknown age is not expired age');
  assert.equal(view.counts.nonSeedUnknownAge, 1);
  assert.equal(view.counts.nonSeedFresh, 0, 'unknown is never counted as fresh');
  assert.equal(view.counts.nonSeedExpired, 0);
  assert.equal(view.firstExpiry, null, 'no known non-seed expiry to report');
});

test('evaluateFreshness is PURE and total: it validates its inputs and never reads the clock', () => {
  assert.throws(() => evaluateFreshness({}, { failDays: 7, asOf: AS_OF }), TypeError);
  assert.throws(() => evaluateFreshness([], { failDays: 7 }), /asOf/, 'asOf is required - no clock read');
  assert.throws(() => evaluateFreshness([], { failDays: 'x', asOf: AS_OF }), /failDays/);
  assert.throws(() => evaluateFreshness([], { failDays: -1, asOf: AS_OF }), /failDays/);

  // Same inputs → identical verdict, and neither the rows nor the sort is mutated.
  const rows = [nonSeedRow('b', 40), nonSeedRow('a', 40)];
  const before = JSON.stringify(rows);
  const first = evaluateFreshness(rows, { failDays: 7, asOf: AS_OF });
  const second = evaluateFreshness(rows, { failDays: 7, asOf: AS_OF });
  assert.deepEqual(first, second);
  assert.deepEqual(first.failing.map((f) => f.id), ['a', 'b'], 'sorted by id, code-unit');
  assert.equal(JSON.stringify(rows), before, 'inputs are not mutated');

  // DEFAULT_FAIL_DAYS applies when failDays is omitted (7, not 14).
  assert.equal(DEFAULT_FAIL_DAYS, 7);
  assert.equal(evaluateFreshness([nonSeedRow('d', 30 - 5)], { asOf: AS_OF }).failing.length, 1, '5 days out fails at the default 7');
});

test('5.6: the CLI space form exits 2 with the usage text and no stack trace', () => {
  const child = spawnSync(process.execPath, ['scripts/check-offer-freshness.js', '--fail-days', '14'], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    // Blanked: even if the argument loop were bypassed, main() would fail loud
    // rather than reach the shared database.
    env: Object.assign({}, process.env, { DATABASE_URL: '' }),
  });
  assert.equal(child.status, 2, 'the space form is a usage error by design, not a run failure');
  assert.match(child.stderr + child.stdout, /usage: node scripts\/check-offer-freshness\.js/);
  assert.doesNotMatch(child.stderr + child.stdout, /Node\.js v|at main/, 'a usage problem prints no stack');
});
