'use strict';

// DB-free unit tests for the shared scoring-model pin (Step-2 item 1 / OG-39).
// A fake client pins the SQL contract and every failure mode, so the pin can be
// proven without a database; the two-active-model rehearsal lives on the branch.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIVE_MODELS_SQL,
  DEFAULT_MODEL_PIN,
  MODEL_PIN_ENV,
  PIN_EXISTS_SQL,
  PIN_SQL,
  formatModelPin,
  listActiveModels,
  modelPinFromEnv,
  modelPinValue,
  parseModelPin,
  readModelPinFlag,
  resolvePinnedModel,
} = require('./model-pin');

const ROW = { id: '11111111-1111-1111-1111-111111111111', name: 'seed-minimal-v1', version: '1.0.0', configuration: { candidate_caps: {} } };

/** Fake client: answers the three pin SQL statements, records every call. */
function fakeClient({ pinned = [], exists = [], active = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === PIN_SQL) return { rows: pinned };
      if (sql === PIN_EXISTS_SQL) return { rows: exists };
      if (sql === ACTIVE_MODELS_SQL) return { rows: active };
      throw new Error('unexpected SQL in fake client: ' + sql);
    },
  };
}

test('the default pin keeps the legacy identity, so no existing caller changes behaviour', () => {
  assert.equal(DEFAULT_MODEL_PIN, 'seed-minimal-v1@1.0.0');
  assert.deepEqual(parseModelPin(DEFAULT_MODEL_PIN), { name: 'seed-minimal-v1', version: '1.0.0' });
  // The pin must never be resolved by taking an arbitrary row.
  assert.ok(!PIN_SQL.includes('LIMIT'));
});

test('parseModelPin accepts a well-formed pin and trims it', () => {
  assert.deepEqual(parseModelPin(' launch-v2@1.0.0 '), { name: 'launch-v2', version: '1.0.0' });
  assert.deepEqual(parseModelPin('a@0'), { name: 'a', version: '0' });
});

test('parseModelPin fails closed on every malformed shape', () => {
  const malformed = ['', '   ', 'seed-minimal-v1', '@1.0.0', 'seed-minimal-v1@', 'seed-minimal-v1@@1.0.0', 'a@b@c', 'seed minimal@1.0.0', 'seed@1.0 0'];
  for (const value of malformed) {
    assert.throws(() => parseModelPin(value), /malformed|non-empty/, 'expected a rejection for ' + JSON.stringify(value));
  }
  for (const value of [null, undefined, 123, {}, []]) {
    assert.throws(() => parseModelPin(value), /non-empty/, 'expected a rejection for ' + JSON.stringify(value));
  }
});

test('modelPinValue: flag beats env beats the default, and a blank never shadows', () => {
  const env = { [MODEL_PIN_ENV]: 'launch-v2@1.0.0' };
  assert.equal(modelPinValue('other@2.0.0', env), 'other@2.0.0');
  assert.equal(modelPinValue('  ', env), 'launch-v2@1.0.0');
  assert.equal(modelPinValue(null, env), 'launch-v2@1.0.0');
  assert.equal(modelPinValue(null, { [MODEL_PIN_ENV]: '  ' }), DEFAULT_MODEL_PIN);
  assert.equal(modelPinValue(null, {}), DEFAULT_MODEL_PIN);
  assert.equal(modelPinValue(null, null), DEFAULT_MODEL_PIN);
});

test('modelPinFromEnv reports "no pin" rather than the default, so a caller can keep its own fallback', () => {
  assert.equal(modelPinFromEnv({}), null);
  assert.equal(modelPinFromEnv({ [MODEL_PIN_ENV]: '' }), null);
  assert.equal(modelPinFromEnv(null), null);
  assert.equal(modelPinFromEnv({ [MODEL_PIN_ENV]: ' launch-v2@1.0.0 ' }), 'launch-v2@1.0.0');
});

test('readModelPinFlag reads --model= only, ignores unrelated args, and refuses a repeat', () => {
  assert.equal(readModelPinFlag(['--filter=S03']), null);
  assert.equal(readModelPinFlag(['--filter=S03', '--model=launch-v2@1.0.0']), 'launch-v2@1.0.0');
  assert.throws(() => readModelPinFlag(['--model=a@1', '--model=b@2']), /more than once/);
  assert.throws(() => readModelPinFlag('not-an-array'), /argv array/);
});

test('resolvePinnedModel returns a frozen copy of the single matching active row', async () => {
  const client = fakeClient({ pinned: [ROW] });
  const model = await resolvePinnedModel(client, DEFAULT_MODEL_PIN);
  assert.deepEqual(model, ROW);
  assert.ok(Object.isFrozen(model), 'the resolved model is frozen');
  assert.notEqual(model, ROW, 'the row is copied, never handed out by reference');
  assert.deepEqual(client.calls[0].params, ['seed-minimal-v1', '1.0.0']);
});

test('resolvePinnedModel refuses an ambiguous pin instead of guessing', async () => {
  const client = fakeClient({ pinned: [ROW, { ...ROW, id: 'other' }] });
  await assert.rejects(resolvePinnedModel(client, DEFAULT_MODEL_PIN), /ambiguous, refusing to guess/);
  assert.equal(client.calls.length, 1, 'an ambiguous pin never falls through to the active list');
});

test('resolvePinnedModel refuses a pin whose only row is INACTIVE, and says so', async () => {
  const client = fakeClient({ pinned: [], exists: [{ is_active: false }], active: [{ name: 'seed-minimal-v1', version: '1.0.0' }] });
  await assert.rejects(resolvePinnedModel(client, 'launch-v2@1.0.0'), /exists but is NOT ACTIVE.*seed-minimal-v1@1\.0\.0/s);
});

test('resolvePinnedModel reports the active models when a pin matches nothing', async () => {
  const client = fakeClient({
    pinned: [],
    exists: [],
    active: [{ name: 'launch-v2', version: '1.0.0' }, { name: 'seed-minimal-v1', version: '1.0.0' }],
  });
  await assert.rejects(
    resolvePinnedModel(client, 'typo@9.9.9'),
    /typo@9\.9\.9 matched no row\. Active: launch-v2@1\.0\.0, seed-minimal-v1@1\.0\.0.*SCORING_MODEL_PIN/s
  );
});

test('resolvePinnedModel reports "(none)" when nothing at all is active', async () => {
  const client = fakeClient({ pinned: [], exists: [], active: [] });
  await assert.rejects(resolvePinnedModel(client, DEFAULT_MODEL_PIN), /Active: \(none\)/);
});

test('listActiveModels formats and orders rows deterministically', async () => {
  const client = fakeClient({ active: [{ name: 'a', version: '2' }, { name: 'a', version: '10' }] });
  assert.deepEqual(await listActiveModels(client), ['a@2', 'a@10']);
  assert.equal(formatModelPin({ name: 'x', version: 'y' }), 'x@y');
  assert.ok(ACTIVE_MODELS_SQL.includes('ORDER BY name ASC, version ASC'));
});
