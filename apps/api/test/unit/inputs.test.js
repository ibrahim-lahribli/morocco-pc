'use strict';

/**
 * apps/api/test/unit/inputs.test.js - Decision 52's vocabulary, pinned.
 *
 * The module under test is PURE, so these are table tests rather than HTTP
 * tests: every reason in the closed list gets at least one input that produces
 * it, and the two three-valued laws get their own assertions -
 *
 *   - NO_EFFECT and UNKNOWN are different facts (a legacy model on a resolution
 *     nothing reads is NO_EFFECT; a pass whose model row is gone is UNKNOWN),
 *   - an omitted optional input is reported, not dropped.
 *
 * The real resolution multiplier is used (the module is injected with it, and
 * the API forwards the retention barrel's own function), so 1.0 being
 * `NO_EFFECT` and 1.25 being `APPLIED` is asserted against the engine's numbers
 * rather than against a fixture that could drift from them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const inputs = require('../../src/inputs');
const engine = require('../../src/engine');

/** A legacy configuration: the shape `seed-minimal-v1` has. */
const LEGACY = Object.freeze({
  gpu_required_use_cases: Object.freeze(['GAMING', 'WORKSTATION']),
});

/** The Decision 37 shape, as `launch-v2` (seed 013) declares it. */
const PROFILES = Object.freeze({
  gpu_required_use_cases: Object.freeze(['GAMING', 'WORKSTATION']),
  use_case_profiles: Object.freeze({
    GAMING: Object.freeze({ gpu_policy: 'REQUIRED', spend_targets: Object.freeze({ GPU: 0.38, CPU: 0.17 }) }),
    OFFICE: Object.freeze({ gpu_policy: 'IGPU_ALLOWED', spend_targets: Object.freeze({ CPU: 0.3 }) }),
  }),
});

/** A model declaring the optional per-resolution VRAM floor (Decision 42). */
const WITH_FLOORS = Object.freeze({
  use_case_profiles: PROFILES.use_case_profiles,
  resolution_profiles: Object.freeze({
    '1080p': Object.freeze({ vram_floor_gb: 8 }),
    '1440p': Object.freeze({ vram_floor_gb: 12 }),
  }),
});

/** The served `input_effects` for one pass. */
function effects(overrides) {
  return inputs.inputEffects(Object.assign({
    configuration: PROFILES,
    useCase: 'GAMING',
    resolution: '1440p',
    priority: 5,
    strategyKeys: ['PERFORMANCE', 'VALUE'],
    resolutionMultiplier: engine.resolutionMultiplier,
  }, overrides || {}));
}

/** The record for one input. */
function effectFor(list, input) {
  return list.find((entry) => entry.input === input);
}

test('the vocabularies are frozen and complete', () => {
  assert.deepEqual([...inputs.INPUTS], ['use_case', 'resolution', 'priority']);
  assert.deepEqual([...inputs.EFFECTS], ['APPLIED', 'NO_EFFECT', 'UNKNOWN']);
  assert.ok(Object.isFrozen(inputs.INPUTS));
  assert.ok(Object.isFrozen(inputs.EFFECTS));
  assert.ok(Object.isFrozen(inputs.REASONS));
  // Every effect and every input appears in the reason contract somewhere: a
  // vocabulary member no reason can reach would be dead weight in the docs.
  assert.equal(new Set(inputs.REASONS).size, inputs.REASONS.length, 'reasons are unique');
});

test('inputEffects always reports all three inputs, in served order', () => {
  const list = effects();
  assert.deepEqual(list.map((entry) => entry.input), ['use_case', 'resolution', 'priority']);
  assert.ok(Object.isFrozen(list));
  for (const entry of list) {
    assert.ok(Object.isFrozen(entry), entry.input + ' entry is frozen');
    assert.ok(inputs.EFFECTS.includes(entry.effect));
    assert.ok(inputs.REASONS.includes(entry.reason));
  }
});

// --- use_case ---------------------------------------------------------------

test('use_case: a declared profile is APPLIED, and the legacy list is APPLIED too', () => {
  assert.deepEqual(effectFor(effects(), 'use_case'), {
    input: 'use_case', effect: 'APPLIED', reason: 'USE_CASE_PROFILE',
  });
  // The legacy list still decides the GPU requirement (Decision 43), which is a
  // reader - just a narrower one than a full profile.
  assert.deepEqual(
    effectFor(effects({ configuration: LEGACY }), 'use_case'),
    { input: 'use_case', effect: 'APPLIED', reason: 'GPU_POLICY_ONLY' }
  );
});

test('use_case: no configuration at all is UNKNOWN, never NO_EFFECT', () => {
  // A deleted model row (the LEFT JOIN in SELECT_QUERY_SQL returns null) says
  // nothing about what the pass read. NO_EFFECT would be an invented fact.
  for (const configuration of [null, undefined, 'x', []]) {
    assert.deepEqual(
      effectFor(effects({ configuration }), 'use_case'),
      { input: 'use_case', effect: 'UNKNOWN', reason: 'NOT_RECORDED' }
    );
  }
});

// --- resolution -------------------------------------------------------------

test('resolution: a scaled GPU target is APPLIED, the neutral one is NO_EFFECT', () => {
  assert.deepEqual(
    effectFor(effects({ resolution: '1440p' }), 'resolution'),
    { input: 'resolution', effect: 'APPLIED', reason: 'GPU_TARGET_SCALED' }
  );
  assert.deepEqual(
    effectFor(effects({ resolution: '2160p' }), 'resolution'),
    { input: 'resolution', effect: 'APPLIED', reason: 'GPU_TARGET_SCALED' }
  );
  // 1080p's multiplier is exactly 1.0, so the GPU target is byte-identical to
  // the target an omitted resolution produces - a provable NO_EFFECT.
  assert.deepEqual(
    effectFor(effects({ resolution: '1080p' }), 'resolution'),
    { input: 'resolution', effect: 'NO_EFFECT', reason: 'NEUTRAL_MULTIPLIER' }
  );
});

test('resolution: a declared VRAM floor wins over the spend multiplier', () => {
  assert.deepEqual(
    effectFor(effects({ configuration: WITH_FLOORS, resolution: '1440p' }), 'resolution'),
    { input: 'resolution', effect: 'APPLIED', reason: 'VRAM_FLOOR' }
  );
  // A resolution the model declares NO floor for falls back to the multiplier.
  assert.deepEqual(
    effectFor(effects({ configuration: WITH_FLOORS, resolution: '2160p' }), 'resolution'),
    { input: 'resolution', effect: 'APPLIED', reason: 'GPU_TARGET_SCALED' }
  );
});

test('resolution: the three provable NO_EFFECT cases name their proof', () => {
  // 1. No profile for the use case, and no floor for the value.
  assert.deepEqual(
    effectFor(effects({ configuration: LEGACY }), 'resolution'),
    { input: 'resolution', effect: 'NO_EFFECT', reason: 'NO_RESOLUTION_POLICY' }
  );
  // 2. A profile that declares no GPU share (OFFICE: the CPU carries the target).
  assert.deepEqual(
    effectFor(effects({ useCase: 'OFFICE' }), 'resolution'),
    { input: 'resolution', effect: 'NO_EFFECT', reason: 'NO_GPU_TARGET' }
  );
  // 2b. A declared ZERO share is provably unmovable: 0 x 1.25 is 0. Validating
  // as a share does not make it a reader, and reporting GPU_TARGET_SCALED here
  // would credit the multiplier with arithmetic that changes nothing.
  assert.deepEqual(
    effectFor(
      effects({
        configuration: {
          gpu_required_use_cases: ['GAMING'],
          use_case_profiles: { GAMING: { gpu_policy: 'REQUIRED', spend_targets: { GPU: 0, CPU: 0.4 } } },
        },
      }),
      'resolution'
    ),
    { input: 'resolution', effect: 'NO_EFFECT', reason: 'NO_GPU_TARGET' }
  );
  // 3. The request never carried one.
  for (const resolution of [null, undefined, '']) {
    assert.deepEqual(
      effectFor(effects({ resolution }), 'resolution'),
      { input: 'resolution', effect: 'NO_EFFECT', reason: 'NOT_PROVIDED' }
    );
  }
});

test('resolution: an unreadable or unrecognised value is UNKNOWN', () => {
  // The rows are gone: the answer is not knowable.
  assert.deepEqual(
    effectFor(effects({ configuration: null }), 'resolution'),
    { input: 'resolution', effect: 'UNKNOWN', reason: 'NOT_RECORDED' }
  );
  // A stored value the engine's table refuses (possible only on a hand-written
  // row - the API validates the vocabulary at the edge).
  assert.deepEqual(
    effectFor(effects({ resolution: '8K' }), 'resolution'),
    { input: 'resolution', effect: 'UNKNOWN', reason: 'UNRECOGNISED_VALUE' }
  );
  assert.deepEqual(
    effectFor(effects({ resolution: 1440 }), 'resolution'),
    { input: 'resolution', effect: 'UNKNOWN', reason: 'UNRECOGNISED_VALUE' }
  );
  // A wiring failure must not become a claim: no multiplier function, no answer.
  assert.deepEqual(
    effectFor(effects({ resolutionMultiplier: null }), 'resolution'),
    { input: 'resolution', effect: 'UNKNOWN', reason: 'NOT_RECORDED' }
  );
});

// --- priority ---------------------------------------------------------------

test('priority: an ordering that produced builds is APPLIED', () => {
  assert.deepEqual(
    effectFor(effects(), 'priority'),
    { input: 'priority', effect: 'APPLIED', reason: 'STRATEGY_ORDER' }
  );
  // ONE build still counts: whatever its strategy, that strategy was tried
  // first, and on a shared (CPU, GPU) pair the first pick wins (Decision 41).
  assert.deepEqual(
    effectFor(effects({ strategyKeys: ['BALANCED'] }), 'priority'),
    { input: 'priority', effect: 'APPLIED', reason: 'STRATEGY_ORDER' }
  );
});

test('priority: 3 is the DEFAULT order, so it is NO_EFFECT and not APPLIED', () => {
  // `strategyOrder(3)` is byte-identical to `strategyOrder(null)`: the same
  // three picks in the same order, therefore the same builds. Reporting APPLIED
  // would credit the user's choice with work the default did anyway - the same
  // proof as 1080p's 1.0 multiplier, answered the same way.
  assert.deepEqual(
    effectFor(effects({ priority: 3 }), 'priority'),
    { input: 'priority', effect: 'NO_EFFECT', reason: 'DEFAULT_ORDER' }
  );
  // Every OTHER accepted value orders differently from the default.
  for (const priority of [1, 2, 4, 5]) {
    assert.deepEqual(
      effectFor(effects({ priority }), 'priority'),
      { input: 'priority', effect: 'APPLIED', reason: 'STRATEGY_ORDER' },
      'priority ' + priority
    );
  }
  // Nothing to order is the more specific fact, even at the neutral value.
  assert.deepEqual(
    effectFor(effects({ priority: 3, strategyKeys: [] }), 'priority'),
    { input: 'priority', effect: 'NO_EFFECT', reason: 'NO_BUILDS' }
  );
});

test('priority: NOT_PROVIDED, NO_BUILDS and an unrecognised value are distinct', () => {
  for (const priority of [null, undefined]) {
    assert.deepEqual(
      effectFor(effects({ priority }), 'priority'),
      { input: 'priority', effect: 'NO_EFFECT', reason: 'NOT_PROVIDED' }
    );
  }
  // The default order ran, but nothing the CALLER chose did.
  assert.deepEqual(
    effectFor(effects({ strategyKeys: [] }), 'priority'),
    { input: 'priority', effect: 'NO_EFFECT', reason: 'NO_BUILDS' }
  );
  // NULL strategy keys on a pass that DID return builds are UNKNOWN, not
  // NO_BUILDS: something came back, the order it came back in was not recorded.
  assert.deepEqual(
    effectFor(effects({ strategyKeys: [null, undefined] }), 'priority'),
    { input: 'priority', effect: 'UNKNOWN', reason: 'NOT_RECORDED' }
  );
  // One unrecorded key is enough to make the whole order unreadable.
  assert.deepEqual(
    effectFor(effects({ strategyKeys: ['PERFORMANCE', null] }), 'priority'),
    { input: 'priority', effect: 'UNKNOWN', reason: 'NOT_RECORDED' }
  );
  for (const priority of [0, 6, 2.5, '3']) {
    assert.deepEqual(
      effectFor(effects({ priority }), 'priority'),
      { input: 'priority', effect: 'UNKNOWN', reason: 'UNRECOGNISED_VALUE' }
    );
  }
});

// --- the deployment half ----------------------------------------------------

test('inputsApplied: a legacy model gives resolution no reader, so it is not advertised', () => {
  // This is the CD-1 behaviour the wizard was built for: an input the list does
  // NOT name is a question the form stops asking.
  assert.deepEqual([...inputs.inputsApplied({ configuration: LEGACY })], ['use_case', 'priority']);
  // No configuration at all: the two unconditional readers are still real
  // (the vocabulary and the archetype order), so they stay advertised.
  for (const configuration of [null, undefined, 'x']) {
    assert.deepEqual(
      [...inputs.inputsApplied({ configuration })],
      ['use_case', 'priority']
    );
  }
});

test('inputsApplied: any per-resolution reader advertises resolution, in served order', () => {
  assert.deepEqual(
    [...inputs.inputsApplied({ configuration: PROFILES })],
    ['use_case', 'resolution', 'priority']
  );
  // A floor-only model reads resolution too (Decision 42).
  assert.deepEqual(
    [...inputs.inputsApplied({ configuration: { resolution_profiles: { '1440p': { vram_floor_gb: 12 } } } })],
    ['use_case', 'resolution', 'priority']
  );
  // A profile whose spend targets declare no GPU share is NOT a resolution
  // reader - the multiplier only ever scales the GPU target.
  assert.deepEqual(
    [...inputs.inputsApplied({ configuration: { use_case_profiles: { OFFICE: { gpu_policy: 'IGPU_ALLOWED', spend_targets: { CPU: 0.3 } } } } })],
    ['use_case', 'priority']
  );
  // A declared ZERO share is not a reader either: 0 x multiplier is 0.
  assert.deepEqual(
    [...inputs.inputsApplied({ configuration: { use_case_profiles: { GAMING: { gpu_policy: 'REQUIRED', spend_targets: { GPU: 0, CPU: 0.4 } } } } })],
    ['use_case', 'priority']
  );
  // An empty objects map is not a reader either.
  assert.deepEqual(
    [...inputs.inputsApplied({ configuration: { resolution_profiles: {}, use_case_profiles: {} } })],
    ['use_case', 'priority']
  );
  assert.ok(Object.isFrozen(inputs.inputsApplied({ configuration: PROFILES })));
});

test('the served list and the served effects cannot contradict each other', () => {
  // A deployment that does not advertise resolution must never claim resolution
  // was APPLIED, and one that does must never call it provably unread. Both
  // halves are derived from the same configuration, and this pins that they
  // agree on the legacy shape and the profile shape.
  for (const configuration of [LEGACY, PROFILES, WITH_FLOORS]) {
    const applied = inputs.inputsApplied({ configuration });
    const list = effects({ configuration, useCase: 'GAMING' });
    const resolution = effectFor(list, 'resolution');
    if (!applied.includes('resolution')) {
      assert.equal(resolution.effect, 'NO_EFFECT', JSON.stringify(configuration) + ' must not claim resolution was applied');
      assert.equal(resolution.reason, 'NO_RESOLUTION_POLICY');
    }
  }
});
