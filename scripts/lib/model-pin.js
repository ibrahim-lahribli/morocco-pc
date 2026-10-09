'use strict';

// scripts/lib/model-pin.js - choose WHICH active scoring model a run measures
// (Step-2 item 1 / OG-39).
//
// WHY THIS EXISTS
// Every guarded harness used to resolve "the" scoring model in one of two ways:
//
//   * a NAME PIN - `WHERE name = 'seed-minimal-v1' AND version = '1.0.0' AND
//     is_active = true` (measure-orchestrator.js, test-orchestrator-full-run.js,
//     verify-pool-independence.js, measure-og01-reach.js, and the count that
//     lib/og01-catalog.js derives coverage from), and
//   * a COUNT GATE - `SELECT count(*) ... WHERE is_active = true` must be
//     EXACTLY 1 (eval-scenarios.js).
//
// Both are correct while one model is active and both stop working the moment a
// SECOND model is activated beside it, which is exactly what Step 2 does to run
// the differential (seed-minimal-v1 vs launch-v2 on one branch): a name pin
// cannot express "compare the two", and the count gate fails on two. The
// tempting fix - a model-agnostic `LIMIT 1` - is the wrong one: it would let a
// run silently measure whichever row happened to sort first.
//
// A PIN BY `name@version` REPLACES BOTH WITHOUT WEAKENING EITHER GUARD:
//   * it selects among ACTIVE rows only, so an inactive model is still never
//     executed (Decision 11's eligibility flag stays load-bearing, and a pin
//     that matches only an inactive row is refused with that stated reason);
//   * it demands EXACTLY ONE match, so an ambiguous identity still fails rather
//     than being guessed;
//   * it lists the ACTIVE models when a pin matches nothing, instead of the old
//     "seed the branch first" dead end;
//   * the DEFAULT pin is `seed-minimal-v1@1.0.0`, so every pre-existing
//     invocation keeps the behaviour and output shape it had.
//
// PRECEDENCE: `--model=<name@version>` on the command line, else the
// `SCORING_MODEL_PIN` environment variable, else DEFAULT_MODEL_PIN. Use
// modelPinValue() for that precedence, modelPinFromEnv() when the caller wants
// "unset means no pin at all" rather than the legacy default (og01-catalog.js
// needs the second: unset must keep its loud exactly-one-active check).
//
// `@` is the separator and neither half may contain whitespace or a second `@`:
// a version string does not, and a pin that does is a mistake worth failing on.

const DEFAULT_MODEL_PIN = 'seed-minimal-v1@1.0.0';
const MODEL_PIN_ENV = 'SCORING_MODEL_PIN';
const MODEL_FLAG = '--model=';

/** The one SQL that resolves a pin; exported so tests can pin the contract. */
const PIN_SQL = 'SELECT id, name, version, configuration FROM scoring_model'
  + ' WHERE name = $1 AND version = $2 AND is_active = true ORDER BY id ASC';

const ACTIVE_MODELS_SQL = 'SELECT name, version FROM scoring_model WHERE is_active = true'
  + ' ORDER BY name ASC, version ASC';

/** The existence probe used only to explain a zero-match pin. */
const PIN_EXISTS_SQL = 'SELECT is_active FROM scoring_model WHERE name = $1 AND version = $2';

function fail(message) {
  throw new Error(message);
}

/** `name@version` for a row-like object. */
function formatModelPin(row) {
  return row.name + '@' + row.version;
}

/**
 * Parse and strictly validate a `name@version` pin.
 *
 * @param {string} value
 * @param {string} [source] label used in the error message
 * @returns {{name: string, version: string}}
 */
function parseModelPin(value, source = 'scoring-model pin') {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(source + ' must be a non-empty "name@version" string (received: ' + JSON.stringify(value) + ')');
  }
  const text = value.trim();
  const at = text.indexOf('@');
  if (at <= 0 || at === text.length - 1) {
    fail(source + ' "' + text + '" is malformed: expected exactly "name@version"');
  }
  const name = text.slice(0, at).trim();
  const version = text.slice(at + 1).trim();
  if (name === '' || version === '') {
    fail(source + ' "' + text + '" is malformed: both name and version are required');
  }
  if (version.includes('@')) {
    fail(source + ' "' + text + '" is malformed: a second "@" makes the identity ambiguous');
  }
  if (/\s/.test(text)) {
    fail(source + ' "' + text + '" is malformed: whitespace is not allowed');
  }
  return { name, version };
}

/**
 * The pin declared in the environment, or null when it is unset/blank. No
 * default is applied - that is modelPinValue()'s job.
 */
function modelPinFromEnv(env = process.env) {
  if (env === null || env === undefined) return null;
  const value = env[MODEL_PIN_ENV];
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

/**
 * The pin a run should use: an explicit flag beats the environment, which beats
 * the legacy default. A blank flag or blank env var never shadows the next
 * level down.
 */
function modelPinValue(flagValue, env = process.env) {
  if (typeof flagValue === 'string' && flagValue.trim() !== '') return flagValue.trim();
  const fromEnv = modelPinFromEnv(env);
  if (fromEnv !== null) return fromEnv;
  return DEFAULT_MODEL_PIN;
}

/**
 * Read `--model=<pin>` out of an argv array. Returns null when absent, and
 * throws when the flag is repeated (silently taking the last one would hide a
 * copy-paste mistake).
 */
function readModelPinFlag(argv) {
  if (!Array.isArray(argv)) fail('readModelPinFlag requires an argv array');
  let found = null;
  for (const arg of argv) {
    if (typeof arg !== 'string' || !arg.startsWith(MODEL_FLAG)) continue;
    if (found !== null) fail(MODEL_FLAG + ' was given more than once');
    found = arg.slice(MODEL_FLAG.length);
  }
  return found;
}

/** Every ACTIVE model as `name@version`, code-unit ordered (never localeCompare). */
async function listActiveModels(client) {
  const result = await client.query(ACTIVE_MODELS_SQL);
  return result.rows.map((row) => formatModelPin(row));
}

/**
 * Resolve a pin to its one ACTIVE scoring_model row, or throw explaining why not.
 *
 * Failure modes, all fail-closed:
 *   * malformed pin           -> parseModelPin's error;
 *   * zero matches, no row    -> "matched no row" + the active list;
 *   * zero matches, row exists but inactive -> the explicit "never executes an
 *     inactive model" refusal (a pin is a selector, not an activation switch);
 *   * more than one match     -> "ambiguous, refusing to guess".
 *
 * @param {object} client pg-compatible client exposing query(sql, params)
 * @param {string} pin `name@version`
 * @returns {Promise<{id: string, name: string, version: string, configuration: object}>}
 *   a frozen copy of the row.
 */
async function resolvePinnedModel(client, pin) {
  const { name, version } = parseModelPin(pin);
  const result = await client.query(PIN_SQL, [name, version]);
  if (result.rows.length === 1) return Object.freeze({ ...result.rows[0] });
  if (result.rows.length > 1) {
    fail('scoring-model pin ' + pin + ' matched ' + result.rows.length
      + ' active rows - the identity is ambiguous, refusing to guess');
  }
  const exists = await client.query(PIN_EXISTS_SQL, [name, version]);
  const active = await listActiveModels(client);
  const activeText = active.length === 0 ? '(none)' : active.join(', ');
  if (exists.rows.length > 0) {
    fail('scoring-model pin ' + pin + ' exists but is NOT ACTIVE: a pin selects among active models'
      + ' and never executes an inactive one (Decision 11 eligibility). Active: ' + activeText);
  }
  fail('scoring-model pin ' + pin + ' matched no row. Active: ' + activeText
    + '. Pass ' + MODEL_FLAG + '<name@version> or set ' + MODEL_PIN_ENV + '.');
}

module.exports = {
  ACTIVE_MODELS_SQL,
  DEFAULT_MODEL_PIN,
  MODEL_FLAG,
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
};
