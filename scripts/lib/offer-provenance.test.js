'use strict';

/**
 * scripts/lib/offer-provenance.test.js - the pure half of
 * `check-offer-provenance.js`.
 *
 * What only a unit test can pin: that each missing piece of provenance gets its
 * OWN class (so the report names the repair), that a URL from another host is a
 * HOST_MISMATCH rather than a pass, that a seed row is never counted as
 * verified, and that an empty non-seed population is INCONCLUSIVE rather than
 * PASS. The SQL half is exercised by running the gate against the live catalog.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVENANCE_CLASSES: C,
  auditObservations,
  classifyOffer,
  evaluateProvenance,
  hostOf,
} = require('./offer-provenance');

const AS_OF = new Date('2026-10-23T12:00:00Z');

/** A fully-provenanced offer; override one field per test. */
function verified(overrides) {
  return Object.assign({
    id: 'offer-1',
    store_name: 'Real Store',
    store_website_url: 'https://www.realstore.ma/',
    ingestion_record_id: '11111111-1111-4111-8111-111111111111',
    listing_identifier: 'RS-RTX4060-8G-0001',
    product_url: 'https://www.realstore.ma/p/rtx-4060-8g',
    seller_name: 'Real Store',
    fetched_at: '2026-10-23T09:00:00Z',
  }, overrides || {});
}

/** A seed row: no ingestion record and no retailer evidence at all. */
function seed(overrides) {
  return Object.assign({
    id: 'seed-1',
    store_name: 'Seed NextGamer',
    store_website_url: 'https://example.ma/nextgamer',
    ingestion_record_id: null,
    listing_identifier: null,
    product_url: null,
    seller_name: null,
    fetched_at: '2026-10-04T04:27:21Z',
  }, overrides || {});
}

test('hostOf parses http(s) URLs, strips www., and rejects anything else', () => {
  assert.equal(hostOf('https://www.NextGamer.ma/p/1'), 'nextgamer.ma');
  assert.equal(hostOf('http://nextgamer.ma'), 'nextgamer.ma');
  assert.equal(hostOf('nextgamer.ma/p/1'), null, 'no scheme is malformed, not a host');
  assert.equal(hostOf('ftp://nextgamer.ma/x'), null, 'a non-http scheme is not a listing page');
  assert.equal(hostOf('javascript:alert(1)'), null);
  assert.equal(hostOf('   '), null);
  assert.equal(hostOf(null), null);
});

test('a fully provenanced offer is VERIFIED', () => {
  assert.equal(classifyOffer(verified(), { asOf: AS_OF }), C.VERIFIED);
});

test('a seed row is SEED_UNVERIFIED, never verified, even with a timestamp', () => {
  assert.equal(classifyOffer(seed(), { asOf: AS_OF }), C.SEED_UNVERIFIED);
});

test('each missing piece of identity gets its OWN class, in repair order', () => {
  assert.equal(classifyOffer(verified({ listing_identifier: null }), { asOf: AS_OF }), C.MISSING_LISTING_IDENTIFIER);
  assert.equal(classifyOffer(verified({ listing_identifier: '   ' }), { asOf: AS_OF }), C.MISSING_LISTING_IDENTIFIER);
  assert.equal(classifyOffer(verified({ product_url: null }), { asOf: AS_OF }), C.MISSING_PRODUCT_URL);
  assert.equal(classifyOffer(verified({ product_url: 'realstore.ma/p/1' }), { asOf: AS_OF }), C.MALFORMED_PRODUCT_URL);
  assert.equal(classifyOffer(verified({ seller_name: '' }), { asOf: AS_OF }), C.MISSING_SELLER_NAME);
  assert.equal(classifyOffer(verified({ fetched_at: null }), { asOf: AS_OF }), C.MISSING_FETCHED_AT);
});

test('a URL from ANOTHER retailer is HOST_MISMATCH, not a pass', () => {
  // The defect this gate exists for: a file labels a row "Real Store" and links
  // to a different retailer (or a marketplace listing under another domain).
  assert.equal(
    classifyOffer(verified({ product_url: 'https://www.ultrapc.ma/p/rtx-4060' }), { asOf: AS_OF }),
    C.HOST_MISMATCH
  );
  // A subdomain of the store's own host is fine; a suffix that merely LOOKS like
  // it is not ("evilrealstore.ma" must not match "realstore.ma").
  assert.equal(
    classifyOffer(verified({ product_url: 'https://shop.realstore.ma/p/1' }), { asOf: AS_OF }),
    C.VERIFIED
  );
  assert.equal(
    classifyOffer(verified({ product_url: 'https://evilrealstore.ma/p/1' }), { asOf: AS_OF }),
    C.HOST_MISMATCH
  );
  // A store row with no usable host is its own problem, never a silent pass.
  assert.equal(
    classifyOffer(verified({ store_website_url: 'example' }), { asOf: AS_OF }),
    C.STORE_WITHOUT_HOST
  );
});

test('an observation time in the FUTURE is not a verified observation', () => {
  assert.equal(
    classifyOffer(verified({ fetched_at: '2026-10-24T00:00:00Z' }), { asOf: AS_OF }),
    C.FETCHED_AT_IN_FUTURE
  );
});

test('price observations must carry the run that made them', () => {
  const history = [
    { store_offer_id: 'a', observed_at: '2026-10-20T00:00:00Z', ingestion_record_id: 'r1' },
    { store_offer_id: 'a', observed_at: '2026-10-21T00:00:00Z', ingestion_record_id: null },
    { store_offer_id: 'b', observed_at: null, ingestion_record_id: 'r1' },
    { store_offer_id: 'c', observed_at: '2026-10-25T00:00:00Z', ingestion_record_id: 'r1' },
  ];
  const audit = auditObservations(history, { asOf: AS_OF });
  assert.equal(audit.total, 4);
  assert.equal(audit.traced, 1);
  assert.equal(audit.untraceable.length, 3);
  assert.deepEqual(audit.untraceable.map((row) => row.reason), [
    'NO_INGESTION_RECORD',
    'NO_OBSERVED_AT',
    'OBSERVED_AT_IN_FUTURE',
  ]);
  assert.equal(audit.newest.toISOString(), '2026-10-20T00:00:00.000Z');
});

test('the verdict is INCONCLUSIVE when the catalog is ALL seed rows', () => {
  // Today's live state: 101 seed offers, nothing verified. A PASS here is what
  // let a seed catalog be read as "recently verified".
  const view = evaluateProvenance([seed({ id: 's1' }), seed({ id: 's2' })], [], { asOf: AS_OF });
  assert.equal(view.verdict, 'INCONCLUSIVE');
  assert.equal(view.verifiedTotal, 0);
  assert.equal(view.seedTotal, 2);
  assert.equal(view.nonSeedTotal, 0);
  assert.equal(view.newestFetchedAt, null, 'a seed timestamp is not a retailer observation');
  assert.deepEqual(view.problems, []);
});

test('one unprovenanced NON-SEED offer fails the gate and is named', () => {
  const view = evaluateProvenance(
    [
      verified({ id: 'ok' }),
      verified({ id: 'bad', product_url: 'https://www.ultrapc.ma/p/x' }),
      seed({ id: 's1' }),
    ],
    [{ store_offer_id: 'ok', observed_at: '2026-10-23T09:00:00Z', ingestion_record_id: 'r1' }],
    { asOf: AS_OF }
  );
  assert.equal(view.verdict, 'FAIL');
  assert.equal(view.verifiedTotal, 1);
  assert.equal(view.seedTotal, 1);
  assert.deepEqual(view.problems, [{ id: 'bad', store: 'Real Store', class: C.HOST_MISMATCH }]);
});

test('price history on SEED offers is reported, not audited, and never fails the gate', () => {
  // Today's live state: 101 seed offers and 101 seed price_history rows with no
  // ingestion record. Failing on those would make the gate permanently red for
  // the fixture the plan deliberately keeps; they are counted as non-auditable.
  const view = evaluateProvenance(
    [seed({ id: 's1' })],
    [
      { store_offer_id: 's1', observed_at: '2026-10-04T04:27:21Z', ingestion_record_id: null },
      { store_offer_id: 's1', observed_at: '2026-10-04T04:27:21Z', ingestion_record_id: null },
    ],
    { asOf: AS_OF }
  );
  assert.equal(view.verdict, 'INCONCLUSIVE');
  assert.equal(view.observations.total, 0, 'nothing auditable');
  assert.equal(view.observations.seedRows, 2);
  assert.equal(view.observations.untraceable.length, 0);
});

test('an untraceable price observation fails the gate even when offers are verified', () => {
  const view = evaluateProvenance(
    [verified({ id: 'ok' })],
    [{ store_offer_id: 'ok', observed_at: '2026-10-23T09:00:00Z', ingestion_record_id: null }],
    { asOf: AS_OF }
  );
  assert.equal(view.verdict, 'FAIL');
  assert.equal(view.observations.traced, 0);
});

test('a fully provenanced catalog PASSES, and the newest observation is reported', () => {
  const view = evaluateProvenance(
    [verified({ id: 'a', fetched_at: '2026-10-22T08:00:00Z' }), verified({ id: 'b', fetched_at: '2026-10-23T08:00:00Z' })],
    [
      { store_offer_id: 'a', observed_at: '2026-10-22T08:00:00Z', ingestion_record_id: 'r1' },
      { store_offer_id: 'b', observed_at: '2026-10-23T08:00:00Z', ingestion_record_id: 'r1' },
    ],
    { asOf: AS_OF }
  );
  assert.equal(view.verdict, 'PASS');
  assert.equal(view.verifiedTotal, 2);
  assert.equal(view.newestFetchedAt.toISOString(), '2026-10-23T08:00:00.000Z');
  assert.equal(view.observations.newest.toISOString(), '2026-10-23T08:00:00.000Z');
});

test('store buckets are ordered deterministically and never rely on localeCompare', () => {
  const view = evaluateProvenance(
    [seed({ id: '1', store_name: 'Zeta' }), seed({ id: '2', store_name: 'Alpha' })],
    [],
    { asOf: AS_OF }
  );
  assert.deepEqual(view.stores.map((store) => store.name), ['Alpha', 'Zeta']);
});
