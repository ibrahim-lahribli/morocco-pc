'use strict';

/**
 * apps/api/test/unit/presets.test.js - GET /v1/presets, DB-free.
 *
 * The read-only landing-page ribbon (Platform P1 Sprint 6 / Decision 48). Every
 * test drives the REAL route through `fastify.inject` with stubbed
 * collaborators, so what is pinned is the served status code and body, not an
 * internal call sequence.
 *
 * The row fixtures mimic pg's WIRE shape on purpose, exactly as
 * `test/helpers/stub.js` does: NUMERIC columns are STRINGS ('6000.00') and
 * timestamps are Date objects. A hand-written "nice" fixture would hide the
 * conversion this endpoint's whole payload depends on - `budget_amount` and
 * `build_score` are NUMERIC, and a presenter that stopped converting would
 * serve a string where the contract declares a number.
 *
 * Three properties are load-bearing and each has its own test:
 *
 *   1. An EMPTY ribbon is a 200 with an empty list and the catalog version, not
 *      a 404 and not a 503 (Sprint 6 scenario 6.1). The version is what makes
 *      the emptiness attributable: "nothing generated for THIS catalog" is a
 *      different fact from "nothing generated".
 *   2. A use case the ACTIVE model does not declare is a 422 carrying the
 *      vocabulary, never an empty list (scenario 6.4). An empty list would look
 *      like "no presets exist yet" and would invite a generation run for a page
 *      the model cannot score.
 *   3. The route selects by the version IT computed, and a version it cannot
 *      compute is a 503 rather than a silently empty ribbon. A `max(...)` inside
 *      the statement, or a null that selects nothing, would both make a stale or
 *      unattributable list indistinguishable from a correct one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = require('../helpers/stub');
const { priceStatusFor } = require('../../src/routes/presets');

/** The presets query string, valid against the stub's ACTIVE model. */
const VALID_URL = '/v1/presets?use_case=GAMING&currency=MAD';

const RECOMMENDATION_ID = '11111111-1111-4111-8111-111111111111';

/**
 * One row as SELECT_PRESETS_SQL returns it. `overrides` replace whole fields, so
 * a test can pin one column without restating the row.
 *
 * `build_count` / `rank1_component_count` / `rank1_unverified_count` come from
 * the statement as `count(*)::int`, i.e. real JS numbers - unlike the NUMERIC
 * columns above, which arrive as strings.
 */
function presetRow(overrides) {
  return Object.assign({
    budget_amount: '6000.00',
    recommendation_id: RECOMMENDATION_ID,
    generated_at: new Date('2026-10-16T09:00:00.000Z'),
    build_score: '61.25',
    build_count: 2,
    rank1_component_count: 8,
    rank1_unverified_count: 0,
  }, overrides || {});
}

/** An app whose presets read returns `rows` and which records the key it was asked for. */
function appWithPresets(rows, options) {
  const opts = options || {};
  const repository = stub.createRepositoryStub(Object.assign({
    async selectPresets(_db, key) {
      repository.state.presetCalls.push(key);
      return rows;
    },
  }, opts.repository || {}));
  const app = stub.createTestApp({
    repository,
    engine: opts.engine,
    pool: opts.pool,
  });
  return { app, repository };
}

test('an empty ribbon is a 200 with an empty list and the catalog version, not a 404', async () => {
  const { app, repository } = appWithPresets([]);
  const response = await app.inject({ method: 'GET', url: VALID_URL });

  assert.equal(response.statusCode, 200, 'nothing generated yet is a valid answer');
  const body = response.json();
  assert.deepEqual(body.presets, []);
  // The version is served even when nothing was generated: without it an empty
  // list could not be told apart from a list generated against another catalog.
  assert.equal(body.catalog_version, stub.TEST_CATALOG_VERSION);
  // NULL, not a date and not a 1970 epoch: an empty ribbon has no generation
  // time to report, and inventing one would make "not generated yet"
  // indistinguishable from "generated long ago".
  assert.equal(body.generated_at, null);
  assert.equal(repository.state.presetCalls.length, 1, 'the read ran exactly once');
});

test('the ribbon is served in the statement order, with NUMERIC strings presented as numbers', async () => {
  const { app } = appWithPresets([
    presetRow({ budget_amount: '6000.00', build_score: '61.25' }),
    presetRow({
      budget_amount: '8000.00',
      recommendation_id: '22222222-2222-4222-8222-222222222222',
      generated_at: new Date('2026-10-16T09:00:05.000Z'),
      build_score: '70',
    }),
  ]);
  const response = await app.inject({ method: 'GET', url: VALID_URL });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.presets.map((preset) => preset.budget_amount), [6000, 8000]);
  assert.deepEqual(body.presets.map((preset) => preset.build_score), [61.25, 70]);
  assert.equal(typeof body.presets[0].budget_amount, 'number', 'a NUMERIC string is a wire artifact, not the contract');
  // The newest row's timestamp speaks for the list: a client caching the ribbon
  // needs to know when the FRESHEST entry was generated, not the oldest.
  assert.equal(body.generated_at, '2026-10-16T09:00:05.000Z');
});

test('price_status is derived per preset: verified, indicative, or absent when there is no build', async () => {
  const { app } = appWithPresets([
    presetRow({ budget_amount: '6000.00', build_score: '61.25' }),
    presetRow({
      budget_amount: '8000.00',
      recommendation_id: '22222222-2222-4222-8222-222222222222',
      build_score: '70',
      rank1_unverified_count: 3,
    }),
    // A committed pass that assembled NOTHING is a legitimate outcome
    // (Decision 17.2), so this row is real data rather than a fixture shape.
    presetRow({
      budget_amount: '10000.00',
      recommendation_id: '33333333-3333-4333-8333-333333333333',
      build_score: null,
      build_count: 0,
      rank1_component_count: null,
      rank1_unverified_count: null,
    }),
  ]);
  const response = await app.inject({ method: 'GET', url: VALID_URL });

  const body = response.json();
  assert.equal(body.presets[0].price_status, 'verified', 'every component of rank 1 is VERIFIED');
  assert.equal(body.presets[1].price_status, 'indicative', 'one component is not VERIFIED');
  // NULL, never 'verified': the build-less preset has no price to make a claim
  // about, and 'verified' over nothing is the one reading that must not appear.
  assert.equal(body.presets[2].price_status, null);
  assert.equal(body.presets[2].build_score, null);
});

test('a rank-1 build with no component rows is never called verified', async () => {
  // The component-less rank 1 is the case a single `NOT EXISTS (... <> VERIFIED)`
  // boolean would have reported as 'verified' - the empty set contradicts
  // nothing - which is exactly why the statement returns COUNTS instead.
  const { app } = appWithPresets([
    presetRow({ build_count: 1, rank1_component_count: 0, rank1_unverified_count: 0 }),
  ]);
  const response = await app.inject({ method: 'GET', url: VALID_URL });

  assert.equal(response.json().presets[0].price_status, null);
});

test('priceStatusFor treats an unrecognized or missing unverified count as NOT verified', async () => {
  // Fail-safe by direction: an unknown provenance must never be advertised as
  // verified, so anything other than a literal 0 unverified components lands on
  // 'indicative' rather than falling through to 'verified'.
  assert.equal(priceStatusFor({ build_count: 1, rank1_component_count: 8, rank1_unverified_count: 0 }), 'verified');
  assert.equal(priceStatusFor({ build_count: 1, rank1_component_count: 8, rank1_unverified_count: 1 }), 'indicative');
  assert.equal(priceStatusFor({ build_count: 1, rank1_component_count: 8, rank1_unverified_count: null }), 'indicative');
  assert.equal(priceStatusFor({ build_count: 1, rank1_component_count: 8 }), 'indicative');
  assert.equal(priceStatusFor({ build_count: 0, rank1_component_count: 8, rank1_unverified_count: 0 }), null);
});

test('the route reads the catalog version IT computed, and never a version of its own choosing', async () => {
  const { app, repository } = appWithPresets([presetRow()]);
  const response = await app.inject({ method: 'GET', url: VALID_URL });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    repository.state.presetCalls[0],
    { useCase: 'GAMING', currency: 'MAD', catalogVersion: stub.TEST_CATALOG_VERSION },
    'the version is an argument to the read, so a superseded catalog is invisible rather than least-preferred'
  );
  // The served version and the selected version are the same value: a reply that
  // named one catalog while reading another is the exact confusion this endpoint
  // exists to avoid.
  assert.equal(response.json().catalog_version, repository.state.presetCalls[0].catalogVersion);
});

test('a use case the ACTIVE model does not declare is a 422 carrying the vocabulary, not an empty list', async () => {
  // OFFICE appears only in PROFILE_MODEL's Decision 37 `use_case_profiles`, so
  // the legacy `gpu_required_use_cases` derivation cannot offer it (OG-38). A
  // request for it against the legacy model is a CLIENT error: answering an
  // empty ribbon would look like "no presets generated yet" and would invite a
  // generation run for a page that model cannot score.
  const { app, repository } = appWithPresets([presetRow()]);
  const response = await app.inject({ method: 'GET', url: '/v1/presets?use_case=OFFICE&currency=MAD' });

  assert.equal(response.statusCode, 422);
  const body = response.json();
  assert.equal(body.error, 'VALIDATION_ERROR');
  assert.equal(body.details[0].field, 'use_case');
  assert.match(body.details[0].message, /GAMING, WORKSTATION/, 'the message names the accepted values');
  assert.equal(repository.state.presetCalls.length, 0, 'nothing is read for a request the model cannot answer');

  // The same value is a 200 against a model that DOES declare it, which is what
  // makes this a vocabulary check rather than a hardcoded list.
  const allowed = appWithPresets([presetRow()], { repository: { async selectActiveScoringModel() { return stub.PROFILE_MODEL; } } });
  const ok = await allowed.app.inject({ method: 'GET', url: '/v1/presets?use_case=OFFICE&currency=MAD' });
  assert.equal(ok.statusCode, 200);
});

test('a currency outside the advertised list is a 422, and required parameters are required', async () => {
  const { app, repository } = appWithPresets([presetRow()]);

  const badCurrency = await app.inject({ method: 'GET', url: '/v1/presets?use_case=GAMING&currency=USD' });
  assert.equal(badCurrency.statusCode, 422);
  assert.equal(badCurrency.json().details[0].field, 'currency');

  // Required, not defaulted: a defaulted use case would silently serve one
  // ribbon for a request that asked for another.
  const missingUseCase = await app.inject({ method: 'GET', url: '/v1/presets?currency=MAD' });
  assert.equal(missingUseCase.statusCode, 422);
  assert.equal(missingUseCase.json().details[0].field, 'use_case');

  // Unknown parameters are refused rather than ignored (ajv
  // `removeAdditional: false`), so a typo is a 422 and not a broader query.
  const unknown = await app.inject({ method: 'GET', url: VALID_URL + '&budget=6000' });
  assert.equal(unknown.statusCode, 422);

  assert.equal(repository.state.presetCalls.length, 0, 'no read is attempted for an invalid request');
});

test('no active model, or a model with no usable vocabulary, is a 503 rather than an empty ribbon', async () => {
  const noModel = appWithPresets([], { repository: { async selectActiveScoringModel() { return null; } } });
  const unavailable = await noModel.app.inject({ method: 'GET', url: VALID_URL });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.json().error, 'SCORING_MODEL_UNAVAILABLE');

  // NULL vocabulary is UNKNOWN, never an empty list (Decision 36 item 3): the
  // state belongs to the MODEL, so blaming the request with a 422 would be wrong.
  const noVocabulary = appWithPresets([], {
    repository: { async selectActiveScoringModel() { return { id: 'c-1', configuration: {} }; } },
  });
  const vocabless = await noVocabulary.app.inject({ method: 'GET', url: VALID_URL });
  assert.equal(vocabless.statusCode, 503);
  assert.equal(vocabless.json().error, 'SCORING_MODEL_UNAVAILABLE');
});

test('a catalog version that cannot be computed is a 503, not an empty ribbon', async () => {
  // The digest is the SELECTOR here, unlike on a POST where it is only a dedupe
  // key: without a version there is nothing to select by, and an empty list
  // would tell a client to generate pages that already exist.
  const engine = stub.createEngineStub();
  engine.catalogVersion = async () => {
    throw new Error('digest unavailable');
  };
  const { app, repository } = appWithPresets([presetRow()], { engine });
  const response = await app.inject({ method: 'GET', url: VALID_URL });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, 'CATALOG_VERSION_UNAVAILABLE');
  assert.equal(repository.state.presetCalls.length, 0, 'nothing is read without a version to read by');
  assert.ok(!response.body.includes('digest unavailable'), 'no internal detail leaks');
});
