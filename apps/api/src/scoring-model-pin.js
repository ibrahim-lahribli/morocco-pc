'use strict';

/**
 * apps/api/src/scoring-model-pin.js - which scoring model this deployment serves.
 *
 * WHY THIS EXISTS
 * The API used to answer "which model?" with ONE implicit rule: the newest
 * `is_active` row (`repository.js` SELECT_ACTIVE_SCORING_MODEL_SQL). That is
 * correct for a database with a single active model and silently wrong for the
 * shape this repo actually has - six `launch-v2` versions active at once - so
 * what an environment SERVES became a property of its seed-set rather than of
 * any decision. Measured 2026-11-01: applying seed 027 replayed every seed file
 * onto the shared database, which activated five more versions and moved the
 * deployed demo origin from `seed-minimal-v1@1.0.0` to `launch-v2@2.4.0` with
 * no code change and no error (OG-54).
 *
 * `SCORING_MODEL_PIN=name@version` makes that an explicit deploy-time setting.
 * It is the SAME grammar and the same refusals as `scripts/lib/model-pin.js`,
 * which the comparison harnesses already use (Decision 39: a pin is a SELECTOR,
 * never an activation). Reusing the vocabulary means one mental model for a
 * harness run and a deployment.
 *
 * FAIL CLOSED
 * A malformed value is refused while the app is being BUILT, so a typo fails a
 * deploy rather than answering plausible 200s. A well-formed pin that matches no
 * row, or only an INACTIVE row, is refused per request as
 * `SCORING_MODEL_UNAVAILABLE` (503) - never a fallback to the newest active row,
 * because that fallback is exactly the silence this setting exists to remove.
 *
 * UNSET MEANS TODAY'S BEHAVIOUR. With no pin the API keeps choosing the newest
 * active row, so every existing test, local run and deployment is unchanged; a
 * deployment that wants the guarantee sets the variable.
 */

const MODEL_PIN_ENV = 'SCORING_MODEL_PIN';

function fail(message) {
  throw new Error(message);
}

/**
 * Parse and strictly validate a `name@version` pin.
 *
 * The rules are deliberately identical to `scripts/lib/model-pin.js`
 * `parseModelPin`: one `@`, both halves non-empty, no whitespace anywhere. A
 * version string never contains `@` or a space, so a pin that does is a mistake
 * worth refusing instead of interpreting.
 *
 * @param {string} value
 * @param {string} [source] label used in the error message
 * @returns {{name: string, version: string, text: string}} frozen
 */
function parseModelPin(value, source = 'SCORING_MODEL_PIN') {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(source + ' must be a non-empty "name@version" string (received: ' + JSON.stringify(value) + ')');
  }
  const text = value.trim();
  const at = text.indexOf('@');
  if (at <= 0 || at === text.length - 1) {
    fail(source + ' "' + text + '" is malformed: expected exactly "name@version"');
  }
  if (/\s/.test(text)) {
    fail(source + ' "' + text + '" is malformed: whitespace is not allowed');
  }
  const name = text.slice(0, at);
  const version = text.slice(at + 1);
  if (version.includes('@')) {
    fail(source + ' "' + text + '" is malformed: a second "@" makes the identity ambiguous');
  }
  return Object.freeze({ name, version, text: name + '@' + version });
}

/**
 * Normalise a raw pin value: `null` when it is absent or blank, otherwise the
 * canonical `name@version` text. Throws on a malformed value - callers use this
 * at startup, where throwing is the point.
 *
 * @param {string|null|undefined} value
 * @param {string} [source]
 * @returns {string|null}
 */
function normalizeModelPin(value, source = MODEL_PIN_ENV) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return parseModelPin(value, source).text;
}

/**
 * The pin declared in the environment, already normalised: `null` when unset or
 * blank. A malformed value throws, so an invalid deployment configuration never
 * reaches `listen`.
 *
 * @param {object} [env]
 * @returns {string|null}
 */
function readModelPin(env = process.env) {
  if (env === null || env === undefined) return null;
  return normalizeModelPin(env[MODEL_PIN_ENV]);
}

/**
 * How the served model was chosen, for a startup log line. Null is not an error:
 * it says the deployment relies on the implicit newest-active-row rule, which is
 * the pre-existing behaviour and worth stating out loud in a log.
 *
 * @param {string|null} pin
 * @returns {string}
 */
function describeSelection(pin) {
  return pin === null ? 'newest active row (no SCORING_MODEL_PIN set)' : pin;
}

module.exports = {
  MODEL_PIN_ENV,
  describeSelection,
  normalizeModelPin,
  parseModelPin,
  readModelPin,
};
