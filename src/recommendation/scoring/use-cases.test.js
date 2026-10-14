'use strict';

// ---------------------------------------------------------------------------
// Scoring model (Decision 37): `use_case_profiles` + `listUseCases`.
//
// Scope: the use-case profile contract, the vocabulary accessor, and the
// integration with the Decision 3(a) configuration validator (the key is
// OPTIONAL, so a legacy model stays valid byte-for-byte). The rest of the
// configuration contract is tested in configuration.test.js.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateUseCaseProfiles,
  listUseCases,
  USE_CASE_PROFILES_KEY,
  GPU_POLICIES,
} = require('./use-cases');
const { validateScoringModelConfiguration } = require('./configuration');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

function profile(overrides = {}) {
  return {
    gpu_policy: 'REQUIRED',
    spend_targets: {
      CPU: 0.17,
      GPU: 0.38,
      MOTHERBOARD: 0.1,
      RAM: 0.07,
      SSD_BOOT: 0.07,
      PSU: 0.07,
      CASE: 0.07,
      CPU_COOLER: 0.04,
    },
    ...overrides,
  };
}

function makeProfiles() {
  return {
    GAMING: profile(),
    WORKSTATION: profile({ spend_targets: { CPU: 0.24, GPU: 0.25, RAM: 0.1 } }),
    OFFICE: profile({ gpu_policy: 'IGPU_ALLOWED', spend_targets: { CPU: 0.2, GPU: 0.1 } }),
  };
}

/** A complete, valid Decision 3(a) configuration (no use_case_profiles). */
function makeConfiguration(overrides = {}) {
  return {
    version_note: 'test shape',
    role_weights: { CPU: { PERFORMANCE: 0.4 }, GPU: { PERFORMANCE: 0.5 } },
    type_weights: { PERFORMANCE: 0.5, VALUE: 0.25 },
    neutral_baseline: 50,
    no_evidence_penalty: 10,
    unknown_compat_penalty: 5,
    confidence_multipliers: { CONFIRMED: 1, HIGH: 0.8 },
    staleness: { max_age_days: 180, per_day_decay: 0.005 },
    candidate_caps: { top_k_per_role: 5, max_builds_per_query: 25 },
    gpu_required_use_cases: ['GAMING', 'WORKSTATION'],
    ...overrides,
  };
}

function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

function assertFailure(fn, code, field) {
  const error = errorOf(fn);
  assert.ok(error instanceof CandidateSelectionError, `expected a CandidateSelectionError for ${field}`);
  assert.equal(error.code, code);
  assert.equal(error.field, field);
}

// ---------------------------------------------------------------------------
// validateUseCaseProfiles
// ---------------------------------------------------------------------------

test('accepts a well-formed profile and returns a frozen deep copy', () => {
  const input = makeProfiles();
  const validated = validateUseCaseProfiles(input);

  assert.deepEqual(Object.keys(validated), ['GAMING', 'WORKSTATION', 'OFFICE']);
  assert.equal(validated.OFFICE.gpu_policy, 'IGPU_ALLOWED');
  assert.deepEqual(validated.GAMING.spend_targets, input.GAMING.spend_targets);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated.GAMING));
  assert.ok(Object.isFrozen(validated.GAMING.spend_targets));

  // The caller's object is untouched and unfrozen.
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.GAMING), false);
});

test('preserves optional role_weights overrides and archetype_objectives', () => {
  const validated = validateUseCaseProfiles({
    GAMING: profile({
      role_weights: { GPU: { PERFORMANCE: 0.6 } },
      archetype_objectives: { PERFORMANCE: 0.6, BALANCED: 0.3, VALUE: 0.1 },
    }),
  });
  assert.deepEqual(validated.GAMING.role_weights, { GPU: { PERFORMANCE: 0.6 } });
  assert.deepEqual(validated.GAMING.archetype_objectives, { PERFORMANCE: 0.6, BALANCED: 0.3, VALUE: 0.1 });
});

test('rejects a non-object map, an empty map and a non-object profile', () => {
  assertFailure(() => validateUseCaseProfiles(null), ERROR_CODES.INVALID_FIELD_VALUE, USE_CASE_PROFILES_KEY);
  assertFailure(() => validateUseCaseProfiles([]), ERROR_CODES.INVALID_FIELD_VALUE, USE_CASE_PROFILES_KEY);
  assertFailure(() => validateUseCaseProfiles({}), ERROR_CODES.INVALID_FIELD_VALUE, USE_CASE_PROFILES_KEY);
  assertFailure(
    () => validateUseCaseProfiles({ GAMING: 'nope' }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'use_case_profiles.GAMING'
  );
  assertFailure(
    () => validateUseCaseProfiles({ '': profile() }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    USE_CASE_PROFILES_KEY
  );
});

test('requires gpu_policy and spend_targets and enforces the policy vocabulary', () => {
  assertFailure(
    () => validateUseCaseProfiles({ GAMING: { spend_targets: {} } }),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'use_case_profiles.GAMING.gpu_policy'
  );
  assertFailure(
    () => validateUseCaseProfiles({ GAMING: { gpu_policy: 'REQUIRED' } }),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'use_case_profiles.GAMING.spend_targets'
  );
  assertFailure(
    () => validateUseCaseProfiles({ GAMING: profile({ gpu_policy: 'optional' }) }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'use_case_profiles.GAMING.gpu_policy'
  );
  assert.deepEqual([...GPU_POLICIES], ['REQUIRED', 'IGPU_ALLOWED']);
});

test('rejects unknown profile fields and out-of-range share values', () => {
  assertFailure(
    () => validateUseCaseProfiles({ GAMING: profile({ tier: 1 }) }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'use_case_profiles.GAMING.tier'
  );
  assertFailure(
    () => validateUseCaseProfiles({ GAMING: profile({ spend_targets: { GPU: 1.5 } }) }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'use_case_profiles.GAMING.spend_targets.GPU'
  );
  assertFailure(
    () => validateUseCaseProfiles({ GAMING: profile({ spend_targets: { GPU: -0.1 } }) }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'use_case_profiles.GAMING.spend_targets.GPU'
  );
  assertFailure(
    () => validateUseCaseProfiles({ GAMING: profile({ spend_targets: { GPU: '0.38' } }) }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'use_case_profiles.GAMING.spend_targets.GPU'
  );
});

test('spend_targets are RELATIVE WEIGHTS: a sum != 1 and a partial profile are both valid (Decision 37 item 6)', () => {
  // The authored launch-v2 GAMING shares sum to 0.97, deliberately NOT 1.
  const gaming = profile();
  const sum = Object.values(gaming.spend_targets).reduce((acc, value) => acc + value, 0);
  assert.ok(Math.abs(sum - 0.97) < 1e-9, `GAMING shares should sum to 0.97, got ${sum}`);
  const validated = validateUseCaseProfiles({ GAMING: gaming });
  assert.deepEqual(validated.GAMING.spend_targets, gaming.spend_targets);

  // A PARTIAL profile (only the roles its policy cares about) is valid - the rest
  // of the budget is unallocated headroom, not an error.
  const partial = validateUseCaseProfiles({ GAMING: profile({ spend_targets: { GPU: 0.38, CPU: 0.17 } }) });
  assert.deepEqual(partial.GAMING.spend_targets, { GPU: 0.38, CPU: 0.17 });

  // A sum ABOVE 1 is still relative, not a partition.
  const over = validateUseCaseProfiles({ GAMING: profile({ spend_targets: { GPU: 1, CPU: 1 } }) });
  assert.deepEqual(over.GAMING.spend_targets, { GPU: 1, CPU: 1 });
});

test('spend_targets: an empty or all-zero map fails fast so normalisation is well-defined', () => {
  assertFailure(
    () => validateUseCaseProfiles({ GAMING: profile({ spend_targets: {} }) }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'use_case_profiles.GAMING.spend_targets'
  );
  assertFailure(
    () => validateUseCaseProfiles({ GAMING: profile({ spend_targets: { CPU: 0, GPU: 0 } }) }),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'use_case_profiles.GAMING.spend_targets'
  );
});

// ---------------------------------------------------------------------------
// listUseCases
// ---------------------------------------------------------------------------

test('listUseCases reads use_case_profiles and ignores gpu_required_use_cases (Decision 37 acceptance)', () => {
  const configuration = makeConfiguration({
    gpu_required_use_cases: ['GAMING', 'WORKSTATION'],
    use_case_profiles: makeProfiles(),
  });
  const useCases = listUseCases(configuration);

  // OFFICE is declared by the profiles and is NOT in gpu_required_use_cases:
  // the vocabulary no longer derives from the GPU-mandate list.
  assert.deepEqual([...useCases], ['GAMING', 'WORKSTATION', 'OFFICE']);
  assert.ok(Object.isFrozen(useCases));

  // Changing ONLY the profiles changes the vocabulary; the legacy list is inert.
  const shifted = listUseCases({ ...configuration, gpu_required_use_cases: ['GAMING'] });
  assert.deepEqual([...shifted], ['GAMING', 'WORKSTATION', 'OFFICE']);
});

test('listUseCases falls back to gpu_required_use_cases for a legacy model with no profiles', () => {
  const legacy = makeConfiguration();
  assert.deepEqual([...listUseCases(legacy)], ['GAMING', 'WORKSTATION']);
  assert.deepEqual([...listUseCases(legacy)].sort(), ['GAMING', 'WORKSTATION']);
});

test('listUseCases throws INVALID_INPUT when neither source exists', () => {
  assertFailure(
    () => listUseCases({ gpu_required_use_cases: null }),
    ERROR_CODES.INVALID_INPUT,
    'configuration'
  );
  assertFailure(() => listUseCases(null), ERROR_CODES.INVALID_INPUT, 'configuration');
});

// ---------------------------------------------------------------------------
// Integration with the Decision 3(a) configuration validator
// ---------------------------------------------------------------------------

test('validateScoringModelConfiguration accepts and freezes the optional use_case_profiles key', () => {
  const validated = validateScoringModelConfiguration(
    makeConfiguration({ use_case_profiles: makeProfiles() })
  );
  assert.equal(validated[USE_CASE_PROFILES_KEY].OFFICE.gpu_policy, 'IGPU_ALLOWED');
  assert.ok(Object.isFrozen(validated[USE_CASE_PROFILES_KEY]));
  assert.ok(Object.isFrozen(validated[USE_CASE_PROFILES_KEY].GAMING.spend_targets));
  assert.deepEqual([...listUseCases(validated)], ['GAMING', 'WORKSTATION', 'OFFICE']);
});

test('a configuration without use_case_profiles stays valid and gains no key', () => {
  const validated = validateScoringModelConfiguration(makeConfiguration());
  assert.equal(
    Object.prototype.hasOwnProperty.call(validated, USE_CASE_PROFILES_KEY),
    false,
    'a legacy model must not gain a use_case_profiles key'
  );
  assert.deepEqual([...listUseCases(validated)], ['GAMING', 'WORKSTATION']);
});

test('an invalid use_case_profiles shape fails through the configuration validator with a nested path', () => {
  assertFailure(
    () => validateScoringModelConfiguration(
      makeConfiguration({ use_case_profiles: { GAMING: profile({ gpu_policy: 'MAYBE' }) } })
    ),
    ERROR_CODES.INVALID_FIELD_VALUE,
    'use_case_profiles.GAMING.gpu_policy'
  );
  assertFailure(
    () => validateScoringModelConfiguration(makeConfiguration({ use_case_profiles: {} })),
    ERROR_CODES.INVALID_FIELD_VALUE,
    USE_CASE_PROFILES_KEY
  );
});

test('use-cases.js is a pure module with no database dependency', () => {
  const source = fs.readFileSync(path.join(__dirname, 'use-cases.js'), 'utf8');
  const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(required, ['../candidates/errors']);

  const banned = ["require('pg')", '.query(', 'SELECT ', 'INSERT ', 'new Pool', 'async'];
  for (const token of banned) {
    assert.ok(!source.includes(token), `use-cases.js must not contain ${token}`);
  }
});
