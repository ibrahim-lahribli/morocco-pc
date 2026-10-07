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

test('use_case is derived from the active scoring model, not from a second hardcoded list', async () => {
  const meta = require('../../src/meta');

  // A configuration change alone must change the advertised vocabulary.
  assert.deepEqual(meta.useCaseValues({ gpu_required_use_cases: ['GAMING', 'WORKSTATION'] }), ['GAMING', 'WORKSTATION']);
  assert.deepEqual(meta.useCaseValues({ gpu_required_use_cases: ['OFFICE'] }), ['OFFICE']);
  assert.deepEqual(meta.useCaseValues({}), []);
  assert.deepEqual(meta.useCaseValues(null), []);
  // Unknown-but-real values are labelled by falling back to the raw value.
  assert.deepEqual(meta.useCaseOptions({ gpu_required_use_cases: ['OFFICE'] }), [{ value: 'OFFICE', label: 'Bureautique' }]);
  assert.equal(meta.useCaseOptions({ gpu_required_use_cases: ['NEW_THING'] })[0].label, 'NEW_THING');
  // Duplicates collapse; non-strings are ignored.
  assert.deepEqual(meta.useCaseValues({ gpu_required_use_cases: ['GAMING', 'GAMING', 7, null] }), ['GAMING']);
});
