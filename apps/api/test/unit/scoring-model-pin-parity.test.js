'use strict';

/**
 * apps/api/test/unit/scoring-model-pin-parity.test.js - the API and the harness
 * must parse `name@version` the SAME way (Decision 62).
 *
 * WHY THIS EXISTS
 * The pin grammar lives TWICE: `apps/api/src/scoring-model-pin.js` for the served
 * process and `scripts/lib/model-pin.js` for the comparison harnesses (Decision
 * 39). Decision 62 rejected requiring `scripts/` FROM THE API on purpose - the
 * harness surface must not ride into a deploy - so the duplication is a decision,
 * not an oversight. What that decision leaves unguarded is DRIFT: two copies of a
 * parser that quietly stop agreeing, so `--model=launch-v2@2.4.0` measures one
 * model while a deployment pinned to the same string serves another, or refuses a
 * value the harness accepts.
 *
 * This file is the guard: ONE table of inputs, both parsers, agreement on both the
 * accept/refuse decision and the parsed halves. Requiring `scripts/lib/model-pin`
 * from a TEST is allowed - Decision 62's rejection is about `apps/api/src/**`, the
 * code that gets deployed, not about test code.
 *
 * The table is deliberately adversarial: a plausible-looking wrong value is worse
 * than an obviously wrong one, because the plausible one is what an operator
 * pastes into a deploy.
 */

const test = require('node:test');
const assert = require('node:assert');

const apiPin = require('../../src/scoring-model-pin');
const harnessPin = require('../../../../scripts/lib/model-pin');

/**
 * Every input the two parsers must agree on. Leading/trailing whitespace is
 * accepted (both trim); INTERNAL whitespace, a missing half and a second `@` are
 * refused (both), because each has a plausible reading worth refusing rather than
 * guessing at.
 */
const TABLE = [
  'launch-v2@2.4.0',
  'seed-minimal-v1@1.0.0',
  'v1@0.0.0-rc.1',
  'a@b',
  '  launch-v2@2.4.0  ',
  'launch-v2',
  '@2.4.0',
  'launch-v2@',
  'launch-v2@1@0',
  'launch v2@2.4.0',
  'launch-v2 @2.4.0',
  '',
  '   ',
];

test('both parsers accept and refuse the same strings, and agree on the halves', () => {
  for (const value of TABLE) {
    let api = null;
    let harness = null;
    let apiError = null;
    let harnessError = null;

    try { api = apiPin.parseModelPin(value); } catch (error) { apiError = error; }
    try { harness = harnessPin.parseModelPin(value); } catch (error) { harnessError = error; }

    assert.equal(
      Boolean(apiError),
      Boolean(harnessError),
      JSON.stringify(value) + ' is accepted by one parser and refused by the other'
    );
    if (api === null) continue;

    assert.equal(api.name, harness.name, JSON.stringify(value) + ': names disagree');
    assert.equal(api.version, harness.version, JSON.stringify(value) + ': versions disagree');
    assert.equal(
      api.text,
      harness.name + '@' + harness.version,
      JSON.stringify(value) + ': the canonical text disagrees with the parsed halves'
    );
  }
});

test('both sides treat a BLANK value as unset, never as a malformed pin', () => {
  assert.equal(apiPin.normalizeModelPin(''), null);
  assert.equal(apiPin.normalizeModelPin('   '), null);
  assert.equal(harnessPin.modelPinFromEnv({ SCORING_MODEL_PIN: '' }), null);
  assert.equal(harnessPin.modelPinFromEnv({ SCORING_MODEL_PIN: '   ' }), null);
});
