'use strict';

/**
 * apps/api/test/unit/scoring-model-pin.test.js - the API's `SCORING_MODEL_PIN`.
 *
 * Two questions, and the tests are split the same way:
 *
 *   1. PARSING is pure (`src/scoring-model-pin.js`): one `@`, no whitespace, no
 *      empty half. A malformed value must throw, because the alternative is an
 *      operator who believes they pinned a model and a deployment that silently
 *      did not.
 *   2. SELECTION is `repository.selectActiveScoringModel(db, pin)`: a pin is
 *      resolved among ACTIVE rows, and a pin that matches nothing - or matches
 *      two rows - THROWS `SCORING_MODEL_UNAVAILABLE` instead of falling back to
 *      the newest active row.
 *
 * The fallback is the whole point. Measured 2026-11-01: applying seed 027
 * replayed every seed file and moved the deployed demo origin off its model with
 * no code change and no error (OG-54), because the served model was
 * "whichever row is newest and active". These tests pin the refusal, and pin that
 * UNSET still means that old rule - so no existing deployment changes until it
 * opts in.
 */

const test = require('node:test');
const assert = require('node:assert');

const stub = require('../helpers/stub');
const pin = require('../../src/scoring-model-pin');
const repository = require('../../src/repository');

/** A db whose every statement returns the same rows, recording what it was asked. */
function fakeDb(rows) {
  const db = {
    queries: [],
    async query(sql, params) {
      db.queries.push({ sql, params });
      return { rows };
    },
  };
  return db;
}

test('parseModelPin accepts name@version, trims it, and canonicalises the identity', () => {
  assert.deepEqual(
    { ...pin.parseModelPin('  launch-v2@2.4.0  ') },
    { name: 'launch-v2', version: '2.4.0', text: 'launch-v2@2.4.0' }
  );
  assert.equal(pin.parseModelPin('seed-minimal-v1@1.0.0').text, 'seed-minimal-v1@1.0.0');
});

test('a malformed pin is refused, never interpreted', () => {
  // Each of these has a plausible-looking reading, and every one of them is a
  // mistake worth failing on rather than guessing at.
  const malformed = ['', '   ', 'launch-v2', '@2.4.0', 'launch-v2@', 'launch-v2@1@0', 'launch v2@2.4.0'];
  for (const value of malformed) {
    assert.throws(
      () => pin.parseModelPin(value),
      /non-empty|malformed/,
      JSON.stringify(value) + ' must be refused'
    );
  }
});

test('normalizeModelPin maps absent and blank to null, and still refuses nonsense', () => {
  assert.equal(pin.normalizeModelPin(undefined), null);
  assert.equal(pin.normalizeModelPin(null), null);
  assert.equal(pin.normalizeModelPin(''), null);
  assert.equal(pin.normalizeModelPin('   '), null);
  assert.equal(pin.normalizeModelPin('launch-v2@2.4.0'), 'launch-v2@2.4.0');
  assert.throws(() => pin.normalizeModelPin('nonsense'), /malformed/);
});

test('readModelPin reads the environment and names the variable it refused', () => {
  assert.equal(pin.readModelPin({}), null);
  assert.equal(pin.readModelPin({ SCORING_MODEL_PIN: '' }), null);
  assert.equal(pin.readModelPin({ SCORING_MODEL_PIN: 'launch-v2@2.4.0' }), 'launch-v2@2.4.0');
  assert.throws(
    () => pin.readModelPin({ SCORING_MODEL_PIN: 'launch-v2' }),
    /SCORING_MODEL_PIN/,
    'the error must name the setting, not just say "malformed"'
  );
});

test('describeSelection states the choice, including the implicit one', () => {
  assert.match(pin.describeSelection(null), /newest active row/);
  assert.equal(pin.describeSelection('launch-v2@2.4.0'), 'launch-v2@2.4.0');
});

test('a malformed SCORING_MODEL_PIN refuses to build the app at all', () => {
  assert.throws(
    () => stub.createTestApp({ env: { SCORING_MODEL_PIN: 'launch-v2' } }),
    /SCORING_MODEL_PIN/,
    'a typo must fail the deploy, not answer plausible 200s'
  );
});

test('the pin reaches the ONE selection point, and unset stays the newest active row', async () => {
  const seen = [];
  const repositoryStub = stub.createRepositoryStub({
    async selectActiveScoringModel(_db, value) {
      seen.push(value);
      return stub.ACTIVE_MODEL;
    },
  });

  const pinned = stub.createTestApp({
    repository: repositoryStub,
    env: { SCORING_MODEL_PIN: 'launch-v2@2.4.0' },
  });
  await pinned.inject({ method: 'POST', url: '/v1/recommendations', payload: stub.validBody() });
  assert.deepEqual(seen, ['launch-v2@2.4.0']);

  seen.length = 0;
  const unpinned = stub.createTestApp({ repository: repositoryStub });
  await unpinned.inject({ method: 'POST', url: '/v1/recommendations', payload: stub.validBody() });
  assert.deepEqual(seen, [null], 'unset keeps the pre-existing rule, so no deployment changes silently');
});

test('a pin that cannot be served is a 503, and the pin stays out of the body', async () => {
  const repositoryStub = stub.createRepositoryStub({
    async selectActiveScoringModel() {
      const error = new Error('scoring model pin launch-v2@9.9.9 matched no ACTIVE row');
      error.code = 'SCORING_MODEL_UNAVAILABLE';
      throw error;
    },
  });
  const app = stub.createTestApp({
    repository: repositoryStub,
    env: { SCORING_MODEL_PIN: 'launch-v2@9.9.9' },
  });

  const post = await app.inject({ method: 'POST', url: '/v1/recommendations', payload: stub.validBody() });
  assert.equal(post.statusCode, 503);
  assert.equal(post.json().error, 'SCORING_MODEL_UNAVAILABLE');
  assert.ok(!JSON.stringify(post.json()).includes('9.9.9'), 'the pin is an operator detail, never a client one');

  const meta = await app.inject({ method: 'GET', url: '/v1/meta/options' });
  assert.equal(meta.statusCode, 503, 'the option list is never served from a model we refused to use');
});

test('the pinned statement keeps is_active in the identity and ordering deterministic', () => {
  assert.match(repository.SELECT_PINNED_SCORING_MODEL_SQL, /name = \$1 AND version = \$2 AND is_active = true/);
  assert.match(repository.SELECT_PINNED_SCORING_MODEL_SQL, /ORDER BY id ASC/);
});

test('a pinned hit resolves that row and asks one statement with the parsed halves', async () => {
  const db = fakeDb([{ id: 'm-2.4.0', name: 'launch-v2', version: '2.4.0', configuration: { depth: 5 } }]);
  const model = await repository.selectActiveScoringModel(db, 'launch-v2@2.4.0');

  assert.deepEqual(model, { id: 'm-2.4.0', configuration: { depth: 5 } });
  assert.equal(db.queries.length, 1);
  assert.equal(db.queries[0].sql, repository.SELECT_PINNED_SCORING_MODEL_SQL);
  assert.deepEqual(db.queries[0].params, ['launch-v2', '2.4.0']);
});

test('a pinned MISS and an ambiguous pin both throw SCORING_MODEL_UNAVAILABLE - never the newest row', async () => {
  const miss = fakeDb([]);
  await assert.rejects(
    () => repository.selectActiveScoringModel(miss, 'launch-v2@9.9.9'),
    (error) => error.code === 'SCORING_MODEL_UNAVAILABLE'
      && /never the newest active row/.test(error.message),
    'an inactive or missing pin must not degrade into "serve something else"'
  );
  assert.equal(miss.queries.length, 1, 'a miss is not repaired by a second selection query');

  const ambiguous = fakeDb([{ id: 'a' }, { id: 'b' }]);
  await assert.rejects(
    () => repository.selectActiveScoringModel(ambiguous, 'launch-v2@2.4.0'),
    (error) => error.code === 'SCORING_MODEL_UNAVAILABLE' && /ambiguous/.test(error.message)
  );
});

test('with no pin the newest-active query is unchanged, and no row is still null', async () => {
  const none = fakeDb([]);
  assert.equal(await repository.selectActiveScoringModel(none), null);
  assert.equal(none.queries[0].sql, repository.SELECT_ACTIVE_SCORING_MODEL_SQL);
  assert.equal(none.queries[0].params, undefined, 'the unpinned statement takes no parameters');

  const one = fakeDb([{ id: 'm-1', configuration: {} }]);
  assert.deepEqual(
    await repository.selectActiveScoringModel(one, null),
    { id: 'm-1', configuration: {} }
  );
});
