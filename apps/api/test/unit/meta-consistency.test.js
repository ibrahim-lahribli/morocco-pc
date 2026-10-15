'use strict';

/**
 * apps/api/test/unit/meta-consistency.test.js - the option list and the
 * validator are the same vocabulary.
 *
 * The failure this guards against is a form that offers a value the API then
 * rejects (or hides a value it would accept). Both directions are asserted:
 * every advertised value is accepted by POST, and a value that is NOT
 * advertised is rejected.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = require('../helpers/stub');

async function postWith(app, overrides) {
  return app.inject({
    method: 'POST',
    url: '/v1/recommendations',
    payload: stub.validBody(overrides),
  });
}

test('every value /v1/meta/options advertises is accepted by POST', async () => {
  const app = stub.createTestApp();
  const options = (await app.inject({ method: 'GET', url: '/v1/meta/options' })).json();

  assert.ok(options.use_cases.length > 0);
  assert.ok(options.currencies.length > 0);
  assert.ok(options.resolutions.length > 0);
  assert.ok(options.priorities.length > 0);

  for (const option of options.use_cases) {
    const response = await postWith(app, { use_case: option.value });
    assert.notEqual(response.statusCode, 422, 'use_case ' + option.value + ' must be accepted');
    assert.notEqual(response.statusCode, 503, 'use_case ' + option.value + ' must be accepted');
  }

  for (const option of options.currencies) {
    const response = await postWith(app, { currency: option.value });
    assert.notEqual(response.statusCode, 422, 'currency ' + option.value + ' must be accepted');
  }

  for (const option of options.resolutions) {
    const response = await postWith(app, { resolution: option.value });
    assert.notEqual(response.statusCode, 422, 'resolution ' + option.value + ' must be accepted');
  }

  for (const option of options.priorities) {
    const response = await postWith(app, { priority: option.value });
    assert.notEqual(response.statusCode, 422, 'priority ' + option.value + ' must be accepted');
  }
});

test('a value that is NOT advertised is rejected in every dimension', async () => {
  const app = stub.createTestApp();

  const useCase = await postWith(app, { use_case: 'NOT_A_USE_CASE' });
  assert.equal(useCase.statusCode, 422);

  const currency = await postWith(app, { currency: 'USD' });
  assert.equal(currency.statusCode, 422);

  const resolution = await postWith(app, { resolution: '8K' });
  assert.equal(resolution.statusCode, 422);

  const priority = await postWith(app, { priority: 6 });
  assert.equal(priority.statusCode, 422);
});

test('the engine, not the API, owns the use-case vocabulary', () => {
  const engine = require('../../src/engine');

  // A LEGACY model (no `use_case_profiles`) keeps the pre-Decision-37
  // derivation byte-for-byte: the retained seed-minimal-v1 must behave
  // exactly as it always did.
  assert.deepEqual(
    engine.useCaseVocabulary({ gpu_required_use_cases: ['GAMING', 'WORKSTATION'] }),
    ['GAMING', 'WORKSTATION']
  );
  assert.deepEqual(engine.useCaseVocabulary({ gpu_required_use_cases: ['OFFICE'] }), ['OFFICE']);

  // A Decision 37 model takes its vocabulary from the PROFILES, which is how
  // OFFICE becomes reachable even though `gpu_required_use_cases` never names
  // it (OG-38). `listUseCases` reads the KEYS - validating the profile bodies
  // is the configuration validator's job - so a minimal body is enough here.
  assert.deepEqual(
    engine.useCaseVocabulary({
      gpu_required_use_cases: ['GAMING'],
      use_case_profiles: { GAMING: {}, OFFICE: {} },
    }),
    ['GAMING', 'OFFICE']
  );

  // UNKNOWN is NULL, never an empty list: none of these shapes is a
  // vocabulary, and the routes turn null into a 503.
  assert.equal(engine.useCaseVocabulary({}), null);
  assert.equal(engine.useCaseVocabulary(null), null);
  assert.equal(engine.useCaseVocabulary(undefined), null);
  assert.equal(engine.useCaseVocabulary({ use_case_profiles: {} }), null);
});

test('the presenter labels, dedupes and orders the vocabulary it is handed', () => {
  const meta = require('../../src/meta');

  assert.deepEqual(meta.useCaseValues(['GAMING', 'WORKSTATION']), ['GAMING', 'WORKSTATION']);
  assert.deepEqual(meta.useCaseOptions(['OFFICE']), [{ value: 'OFFICE', label: 'Bureautique' }]);
  // Unknown-but-real values are labelled by falling back to the raw value.
  assert.equal(meta.useCaseOptions(['NEW_THING'])[0].label, 'NEW_THING');
  // Duplicates collapse; non-strings are ignored.
  assert.deepEqual(meta.useCaseValues(['GAMING', 'GAMING', 7, null]), ['GAMING']);
  // No vocabulary is an empty list HERE; the ROUTE is what must never serve one.
  assert.deepEqual(meta.useCaseValues(null), []);
  assert.deepEqual(meta.useCaseValues(undefined), []);
  // A raw CONFIGURATION is not a vocabulary - the caller derives first. The old
  // signature invited exactly this call, so pin that it now yields nothing.
  assert.deepEqual(meta.useCaseValues({ gpu_required_use_cases: ['GAMING'] }), []);
});

test('a legacy model advertises exactly the use cases it always advertised', async () => {
  const app = stub.createTestApp();
  const options = (await app.inject({ method: 'GET', url: '/v1/meta/options' })).json();
  assert.deepEqual(options.use_cases.map((option) => option.value), ['GAMING', 'WORKSTATION']);
});

test('a profiles model advertises OFFICE, and POST accepts it', async () => {
  const app = stub.createTestApp({
    repository: stub.createRepositoryStub({
      selectActiveScoringModel: async () => stub.PROFILE_MODEL,
    }),
  });

  const options = (await app.inject({ method: 'GET', url: '/v1/meta/options' })).json();
  assert.deepEqual(options.use_cases.map((option) => option.value), ['GAMING', 'WORKSTATION', 'OFFICE']);
  assert.equal(options.use_cases[2].label, 'Bureautique', 'OFFICE is labelled, not raw');

  const accepted = await postWith(app, { use_case: 'OFFICE' });
  assert.equal(accepted.statusCode, 201, 'an ADVERTISED use case must be accepted, not a 422');

  // The other direction still holds: a use case the model does not declare is
  // still a 422, so this is not "accept everything".
  const rejected = await postWith(app, { use_case: 'STREAMING' });
  assert.equal(rejected.statusCode, 422);
  assert.match(
    rejected.json().details[0].message,
    /GAMING, WORKSTATION, OFFICE/,
    "the 422 names the vocabulary the model actually declares"
  );
});

test('a model with no usable vocabulary is a 503, not an empty form', async () => {
  const app = stub.createTestApp({
    repository: stub.createRepositoryStub({
      selectActiveScoringModel: async () => ({ id: 'no-vocabulary', configuration: {} }),
    }),
  });

  const options = await app.inject({ method: 'GET', url: '/v1/meta/options' });
  assert.equal(options.statusCode, 503, 'an empty use_cases array would be a form nobody can submit');
  assert.equal(options.json().error, 'SCORING_MODEL_UNAVAILABLE');

  const post = await postWith(app);
  assert.equal(post.statusCode, 503, 'the vocabulary is unavailable, so the request is not to blame');
  assert.equal(post.json().error, 'SCORING_MODEL_UNAVAILABLE');
});
