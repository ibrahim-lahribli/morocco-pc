'use strict';

/**
 * scripts/characterize-pr6.js - freeze the Engine 4 scoring surface's behaviour
 * BEFORE the extraction moves anything (step 4B PR 6, protection L2).
 *
 * Why this exists
 *   Moving the five pure modules of src/recommendation/scoring/ (configuration,
 *   use-cases, effective-score, candidate-score, build-score) into
 *   packages/recommendation-core/src/scoring/ must not change a single
 *   validated configuration, use-case profile, effective score, candidate score,
 *   build score or contribution. The existing suites (L1) prove the contracts
 *   they cover; this script records what the ORIGINAL implementation actually
 *   returns for a fixed, explicitly supplied set of inputs, so the extracted
 *   implementation can be compared against it field by field.
 *
 * What it is NOT
 *   It is not a test and not a fixture for runtime code. It reads the engine
 *   through its `src/` modules, exactly as the pre-move tree exposes them (the
 *   scoring barrel plus the five pure modules - no loader, no `pg`, no
 *   filesystem input), and writes one JSON document. Run it ONCE, at the
 *   baseline SHA, before the first `git mv`; the committed document is the
 *   baseline, and the extraction is compared against it afterwards.
 *
 * Determinism
 *   No clock read, no randomness, no database, no environment input: every id,
 *   score and timestamp below is a literal, and `nowMs` is injected. The
 *   provenance block records the baseline SHA and its commit date (read from
 *   git, not from `Date.now()`), so re-running on the same commit produces
 *   byte-identical output. Nothing here reads a locale.
 *
 * DB-free by construction
 *   Every candidate, assessment row, build and price carrier below is built IN
 *   MEMORY from literals. Nothing here opens a connection, reads a credential
 *   or touches the filesystem for input.
 *
 * Usage
 *   node scripts/characterize-pr6.js                        # write the fixture
 *   node scripts/characterize-pr6.js --check                # compare, never write
 *   node scripts/characterize-pr6.js --check --fixture=<p>  # compare another copy
 *
 * Where --check reads the fixture from
 *   With no --fixture, --check compares against the COMMITTED fixture blob at
 *   HEAD (`git show HEAD:<path>`), not the working tree. This command is a CI
 *   gate, and a gate that reads a file the working tree can edit would agree
 *   with an uncommitted "fix" to itself. A dirty or modified working-tree copy
 *   is therefore ignored, and the output says `HEAD:<path>` so the source is
 *   never ambiguous.
 *
 *   --fixture=<path> is the deliberate exception: it names an explicit copy and
 *   is read from disk.
 *
 *   This command proves the code still reproduces the frozen behaviour. It does
 *   NOT prove the fixture's origin: when and by which commit it was introduced,
 *   and that nothing changed it since, is owned by
 *   scripts/verify-pr2-provenance.js for every manifest batch.
 *
 *   --check never creates, truncates or rewrites a file: a missing fixture is an
 *   error, not an invitation to write one.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(
  REPO_ROOT,
  'packages',
  'recommendation-core',
  'test',
  'fixtures',
  'pr6-characterization.json'
);
const FIXTURE_REL = 'packages/recommendation-core/test/fixtures/pr6-characterization.json';
const COMMAND = 'node scripts/characterize-pr6.js';

// The PRE-MOVE paths: after the extraction these are identity shims, so the
// same numbers must come back - which is exactly what --check proves.
const scoringBarrel = require('../src/recommendation/scoring');
const configurationModule = require('../src/recommendation/scoring/configuration');
const useCasesModule = require('../src/recommendation/scoring/use-cases');
const effectiveModule = require('../src/recommendation/scoring/effective-score');
const candidateModule = require('../src/recommendation/scoring/candidate-score');
const buildModule = require('../src/recommendation/scoring/build-score');

const {
  validateScoringModelConfiguration,
  SCORING_MODEL_CONFIGURATION_KEYS,
  OPTIONAL_CONFIGURATION_KEYS,
} = configurationModule;
const {
  validateUseCaseProfiles,
  listUseCases,
  USE_CASE_PROFILES_KEY,
  GPU_POLICIES,
  ARCHETYPE_STRATEGIES,
  PROFILE_FIELDS,
  REQUIRED_PROFILE_FIELDS,
} = useCasesModule;
const { selectAssessmentRow, computeEffectiveScore } = effectiveModule;
const { computeCandidateScore, computeCandidateScores } = candidateModule;
const { computeBuildScore, computeBuildScores, computeBuildScoreContributions } = buildModule;

// ---------------------------------------------------------------------------
// Literal fixture builders. Every value is supplied here; nothing is derived
// from the clock, the environment, a locale or a database.
// ---------------------------------------------------------------------------

const NOW_MS = 1763000000000;
const DAY_MS = 24 * 60 * 60 * 1000;

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const P4 = '44444444-4444-4444-8444-444444444444';

function makeConfiguration(overrides = {}) {
  return {
    version_note: 'pr6 characterization shape',
    role_weights: {
      CPU: { PERFORMANCE: 0.4, VALUE: 0.3 },
      GPU: { PERFORMANCE: 0.5, VALUE: 0.25 },
      MOTHERBOARD: { QUALITY: 1 },
    },
    type_weights: { PERFORMANCE: 0.5, VALUE: 0.25, QUALITY: 0.25 },
    neutral_baseline: 50,
    no_evidence_penalty: 10,
    unknown_compat_penalty: 5,
    confidence_multipliers: {
      CONFIRMED: 1,
      HIGH: 0.8,
      MEDIUM: 0.6,
      LOW: 0.3,
      UNVERIFIED: 0,
    },
    staleness: { max_age_days: 180, per_day_decay: 0.005 },
    candidate_caps: { top_k_per_role: 5, max_builds_per_query: 25 },
    gpu_required_use_cases: ['GAMING', 'WORKSTATION'],
    ...overrides,
  };
}

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

function row(assessmentType, score, confidence, assessedAt) {
  return Object.freeze({
    assessment_type: assessmentType,
    score,
    confidence,
    assessed_at: assessedAt,
  });
}

function makeAssessments() {
  return {
    [P1]: [row('PERFORMANCE', 80, 'CONFIRMED', NOW_MS)],
    [P2]: [
      row('VALUE', 90, 'CONFIRMED', NOW_MS),
      row('VALUE', 70, 'CONFIRMED', NOW_MS - DAY_MS),
    ],
    [P3]: [row('PERFORMANCE', 60, 'MEDIUM', NOW_MS - 30 * DAY_MS)],
    [P4]: [row('QUALITY', 75, 'HIGH', NOW_MS)],
  };
}

function candidate(productId, componentRole, variantId = null) {
  return { product_id: productId, product_variant_id: variantId, component_role: componentRole };
}

function component(role, productId, variantId = null) {
  return Object.freeze({
    component_role: role,
    product_id: productId,
    product_variant_id: variantId,
    category: 'x',
    status: 'PASS',
    price: Object.freeze({
      selected_price: 100,
      currency: 'MAD',
      store_id: 's',
      price_checked_at: '2026-11-01T00:00:00.000Z',
    }),
  });
}

function build(components, unknownPairwiseCount) {
  return Object.freeze({
    components: Object.freeze(components),
    total_price: components.length * 100,
    currency: 'MAD',
    unknown_pairwise_count: unknownPairwiseCount,
  });
}

function fullBuild(unknownPairwiseCount = 0) {
  return build([component('CPU', P1), component('MOTHERBOARD', P4)], unknownPairwiseCount);
}

function gpuBuild(unknownPairwiseCount = 0) {
  return build([component('CPU', P1), component('GPU', P2, 'variant-a')], unknownPairwiseCount);
}

// ---------------------------------------------------------------------------
// Capture helpers
// ---------------------------------------------------------------------------

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(error) {
  return {
    ok: false,
    error: {
      name: error && error.name,
      code: error && error.code,
      field: error && error.field,
      message: error && error.message,
    },
  };
}

/** Run one scenario and record its outcome. */
function capture(run) {
  try {
    return { ok: true, output: snapshot(run()) };
  } catch (error) {
    return captureError(error);
  }
}

function frozenFlags(value) {
  if (value === null || typeof value !== 'object') {
    return { frozen: Object.isFrozen(value === undefined ? null : value) };
  }
  const flags = { frozen: Object.isFrozen(value) };
  if (Array.isArray(value)) {
    flags.container = 'array';
  } else {
    flags.container = 'object';
    flags.keys = Object.keys(value);
    flags.children_frozen = Object.keys(value).every(
      (key) => value[key] === null || typeof value[key] !== 'object' || Object.isFrozen(value[key])
    );
  }
  return flags;
}

// ---------------------------------------------------------------------------
// A. Public API and identity
// ---------------------------------------------------------------------------

function captureBarrel() {
  return {
    exports: Object.keys(scoringBarrel),
    frozen: {
      SCORING_MODEL_CONFIGURATION_KEYS: Object.isFrozen(SCORING_MODEL_CONFIGURATION_KEYS),
      OPTIONAL_CONFIGURATION_KEYS: Object.isFrozen(OPTIONAL_CONFIGURATION_KEYS),
      GPU_POLICIES: Object.isFrozen(GPU_POLICIES),
    },
    modules: {
      configuration: Object.keys(configurationModule),
      use_cases: Object.keys(useCasesModule),
      effective_score: Object.keys(effectiveModule),
      candidate_score: Object.keys(candidateModule),
      build_score: Object.keys(buildModule),
    },
  };
}

// ---------------------------------------------------------------------------
// B. Decision 3(a) configuration validator
// ---------------------------------------------------------------------------

function captureConfiguration() {
  const valid = makeConfiguration();

  const missingRoleWeights = makeConfiguration();
  delete missingRoleWeights.role_weights;
  const missingStaleness = makeConfiguration();
  delete missingStaleness.staleness;

  const cases = [
    ['valid-full', () => valid],
    ['missing-role-weights', () => missingRoleWeights],
    ['missing-staleness', () => missingStaleness],
    ['null-configuration', () => null],
    ['array-configuration', () => []],
    ['non-numeric-neutral-baseline', () => makeConfiguration({ neutral_baseline: 'fifty' })],
    ['non-finite-per-day-decay', () => makeConfiguration({ staleness: { max_age_days: 180, per_day_decay: 'x' } })],
    ['zero-top-k', () => makeConfiguration({ candidate_caps: { top_k_per_role: 0, max_builds_per_query: 25 } })],
    ['fractional-top-k', () => makeConfiguration({ candidate_caps: { top_k_per_role: 2.5, max_builds_per_query: 25 } })],
    ['empty-confidence-multipliers', () => makeConfiguration({ confidence_multipliers: {} })],
    ['empty-gpu-required-use-cases', () => makeConfiguration({ gpu_required_use_cases: [] })],
    ['with-use-case-profiles', () => makeConfiguration({ [USE_CASE_PROFILES_KEY]: makeProfiles() })],
    ['invalid-use-case-profiles', () => makeConfiguration({ [USE_CASE_PROFILES_KEY]: {} })],
  ];

  const results = {};
  for (const [id, make] of cases) {
    results[id] = capture(() => validateScoringModelConfiguration(make()));
  }

  const validated = validateScoringModelConfiguration(valid);
  return {
    keys: Object.keys(validated),
    optional_keys: snapshot(OPTIONAL_CONFIGURATION_KEYS),
    idempotent: capture(() => {
      const twice = validateScoringModelConfiguration(validated);
      return JSON.stringify(twice) === JSON.stringify(validated);
    }),
    cases: results,
  };
}

// ---------------------------------------------------------------------------
// C. Decision 37 use-case profiles
// ---------------------------------------------------------------------------

function captureUseCases() {
  const profiles = makeProfiles();
  const invalid = [
    ['null-profiles', null],
    ['empty-profiles', {}],
    ['bad-gpu-policy', { GAMING: profile({ gpu_policy: 'SOMETIMES' }) }],
    ['blank-name', { ' ': profile() }],
    ['missing-spend-targets', { GAMING: { gpu_policy: 'REQUIRED' } }],
  ];

  const cases = {};
  for (const [id, value] of invalid) {
    cases[id] = capture(() => validateUseCaseProfiles(value));
  }

  return {
    keys: {
      use_case_profiles: USE_CASE_PROFILES_KEY,
      profile_fields: snapshot(PROFILE_FIELDS),
      required_profile_fields: snapshot(REQUIRED_PROFILE_FIELDS),
    },
    gpu_policies: snapshot(GPU_POLICIES),
    archetype_strategies: snapshot(ARCHETYPE_STRATEGIES),
    valid_profiles: capture(() => validateUseCaseProfiles(profiles)),
    list_with_profiles: capture(() => {
      const listed = listUseCases(makeConfiguration({ [USE_CASE_PROFILES_KEY]: profiles }));
      return { values: snapshot(listed), frozen: Object.isFrozen(listed) };
    }),
    list_legacy: capture(() => {
      const listed = listUseCases(makeConfiguration());
      return { values: snapshot(listed), frozen: Object.isFrozen(listed) };
    }),
    list_without_either: capture(() => {
      const legacyLess = makeConfiguration();
      delete legacyLess.gpu_required_use_cases;
      return listUseCases(legacyLess);
    }),
    invalid: cases,
  };
}

// ---------------------------------------------------------------------------
// D. Decision 13 STEP 1 - effective score
// ---------------------------------------------------------------------------

function captureEffectiveScore() {
  const configuration = makeConfiguration();
  const rows = makeAssessments()[P1];

  const selection = {
    'first-matching-row-wins': capture(() => selectAssessmentRow(rows, 'PERFORMANCE')),
    'missing-type-yields-null': capture(() => selectAssessmentRow(rows, 'VALUE')),
    'null-rows-yield-null': capture(() => selectAssessmentRow(null, 'PERFORMANCE')),
    'invalid-type-fails': capture(() => selectAssessmentRow(rows, '')),
  };

  // No default value here on purpose: a default would turn the explicit
  // `undefined` of the missing-nowMs scenario back into NOW_MS and the capture
  // would silently record a success instead of the fail-closed error.
  const at = (assessment, nowMs, config = configuration) =>
    capture(() => computeEffectiveScore({ assessment, configuration: config, nowMs }));

  return {
    selection,
    scores: {
      'fresh-confirmed': at({ score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS }, NOW_MS),
      'no-row': at(null, NOW_MS),
      'null-score': at({ score: null, confidence: 'CONFIRMED', assessed_at: NOW_MS }, NOW_MS),
      'exactly-max-age-days': at(
        { score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS - 180 * DAY_MS },
        NOW_MS
      ),
      'one-day-younger-than-max': at(
        { score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS - 179 * DAY_MS },
        NOW_MS
      ),
      'future-assessed-at-clamps-age': at(
        { score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS + 5 * DAY_MS },
        NOW_MS
      ),
      'medium-confidence': at({ score: 90, confidence: 'MEDIUM', assessed_at: NOW_MS }, NOW_MS),
      'unverified-confidence': at({ score: 90, confidence: 'UNVERIFIED', assessed_at: NOW_MS }, NOW_MS),
      'unknown-confidence-fails': at({ score: 90, confidence: 'SPECULATIVE', assessed_at: NOW_MS }, NOW_MS),
      'missing-now-ms-fails': at({ score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS }, undefined),
      'null-now-ms-fails': at({ score: 80, confidence: 'CONFIRMED', assessed_at: NOW_MS }, null),
      'no-evidence-clamped-at-zero': at(
        null,
        NOW_MS,
        makeConfiguration({ no_evidence_penalty: 60 })
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// E. Decision 13 STEP 2 - candidate score
// ---------------------------------------------------------------------------

function captureCandidateScore() {
  const configuration = makeConfiguration();
  const assessments = makeAssessments();

  const candidates = [
    candidate(P1, 'CPU'),
    candidate(P2, 'GPU', 'variant-a'),
    candidate(P3, 'CPU'),
    candidate(P4, 'MOTHERBOARD'),
  ];

  const batch = capture(() => computeCandidateScores({ candidates, assessments, configuration, nowMs: NOW_MS }));

  return {
    single: {
      'cpu-performance-only': capture(() =>
        computeCandidateScore({ candidate: candidate(P1, 'CPU'), assessments, configuration, nowMs: NOW_MS })
      ),
      'gpu-newest-value-row-wins': capture(() =>
        computeCandidateScore({
          candidate: candidate(P2, 'GPU', 'variant-a'),
          assessments,
          configuration,
          nowMs: NOW_MS,
        })
      ),
      'role-missing-from-weights-fails': capture(() =>
        computeCandidateScore({ candidate: candidate(P1, 'RAM'), assessments, configuration, nowMs: NOW_MS })
      ),
      'invalid-role-fails': capture(() =>
        computeCandidateScore({ candidate: candidate(P1, 'NOT_A_ROLE'), assessments, configuration, nowMs: NOW_MS })
      ),
    },
    batch,
    batch_frozen: capture(() => {
      const output = computeCandidateScores({ candidates, assessments, configuration, nowMs: NOW_MS });
      return {
        container: Object.isFrozen(output),
        scores_array: Object.isFrozen(output.scores),
        entries: output.scores.every((entry) => Object.isFrozen(entry)),
      };
    }),
    empty_batch: capture(() => computeCandidateScores({ candidates: [], assessments, configuration, nowMs: NOW_MS })),
    non_array_candidates_fails: capture(() =>
      computeCandidateScores({ candidates: null, assessments, configuration, nowMs: NOW_MS })
    ),
  };
}

// ---------------------------------------------------------------------------
// F. Decision 13 STEP 3 - build score
// ---------------------------------------------------------------------------

function captureBuildScore() {
  const configuration = makeConfiguration();
  const assessments = makeAssessments();
  const builds = [fullBuild(0), gpuBuild(2)];

  return {
    single: {
      'full-build-no-unknown': capture(() =>
        computeBuildScore({
          build: fullBuild(0),
          assessments,
          configuration,
          nowMs: NOW_MS,
          unknownPairwiseCount: 0,
        })
      ),
      'full-build-two-unknown': capture(() =>
        computeBuildScore({
          build: fullBuild(0),
          assessments,
          configuration,
          nowMs: NOW_MS,
          unknownPairwiseCount: 2,
        })
      ),
      'gpu-build-two-unknown': capture(() =>
        computeBuildScore({
          build: gpuBuild(2),
          assessments,
          configuration,
          nowMs: NOW_MS,
          unknownPairwiseCount: 2,
        })
      ),
      'missing-count-fails': capture(() =>
        computeBuildScore({ build: fullBuild(0), assessments, configuration, nowMs: NOW_MS })
      ),
      'negative-count-fails': capture(() =>
        computeBuildScore({
          build: fullBuild(0),
          assessments,
          configuration,
          nowMs: NOW_MS,
          unknownPairwiseCount: -1,
        })
      ),
      'unweighted-role-fails': capture(() =>
        computeBuildScore({
          build: build([component('CPU', P1), component('PSU', P2)]),
          assessments,
          configuration,
          nowMs: NOW_MS,
          unknownPairwiseCount: 0,
        })
      ),
      'empty-components-fails': capture(() =>
        computeBuildScore({
          build: build([]),
          assessments,
          configuration,
          nowMs: NOW_MS,
          unknownPairwiseCount: 0,
        })
      ),
    },
    batch: {
      'counts-from-builds': capture(() =>
        computeBuildScores({ builds, assessments, configuration, nowMs: NOW_MS })
      ),
      'injected-counts-win': capture(() =>
        computeBuildScores({ builds, assessments, configuration, nowMs: NOW_MS, unknownPairwiseCounts: [1, 0] })
      ),
      'empty-batch': capture(() => computeBuildScores({ builds: [], assessments, configuration, nowMs: NOW_MS })),
    },
    contributions: capture(() =>
      computeBuildScoreContributions({ builds, assessments, configuration, nowMs: NOW_MS })
    ),
    batch_frozen: capture(() => {
      const output = computeBuildScores({ builds, assessments, configuration, nowMs: NOW_MS });
      return {
        container: Object.isFrozen(output),
        scores_array: Object.isFrozen(output.scores),
        entries: output.scores.every((entry) => Object.isFrozen(entry)),
      };
    }),
    contributions_frozen: capture(() => {
      const output = computeBuildScoreContributions({ builds, assessments, configuration, nowMs: NOW_MS });
      return {
        container: Object.isFrozen(output),
        contributions_array: Object.isFrozen(output.contributions),
        per_build: output.contributions.every((entries) => Object.isFrozen(entries)),
      };
    }),
    configuration_summary: frozenFlags(configuration),
  };
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

function gitOutput(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function committedFixture(relativePath) {
  try {
    return execFileSync('git', ['show', 'HEAD:' + relativePath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (_error) {
    return null;
  }
}

function buildDocument() {
  return {
    kind: 'pr6-characterization',
    description:
      'Frozen input/output pairs for the step 4B PR 6 extraction surface: the scoring barrel contract, ' +
      'the Decision 3(a) configuration validator, the Decision 37 use-case profile validator and ' +
      'listUseCases, Decision 13 STEP 1 effective scores, STEP 2 candidate scores and STEP 3 build ' +
      'scores plus contributions. DB-free: every id, score and timestamp is a literal.',
    timestamp_policy:
      'No ambient clock is read while capturing: every id, score and timestamp is an input literal and ' +
      'nowMs is injected, so the document is byte-stable on its baseline commit. String order is ' +
      'recorded by code unit; nothing here reads a locale.',
    provenance: {
      baseline_sha: gitOutput(['rev-parse', 'HEAD']),
      baseline_commit_date: gitOutput(['log', '-1', '--format=%cI']),
      node_version: process.version,
      command: COMMAND,
      origin:
        'Captured from the PRE-MOVE implementation under src/recommendation/scoring/ before any module ' +
        'moved into packages/recommendation-core. The committed document is the baseline: do not ' +
        'regenerate it from the extracted code, because a fixture produced by the implementation under ' +
        'test proves nothing.',
    },
    barrel: captureBarrel(),
    configuration: captureConfiguration(),
    use_cases: captureUseCases(),
    effective_score: captureEffectiveScore(),
    candidate_score: captureCandidateScore(),
    build_score: captureBuildScore(),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { check: false, fixture: OUT_FILE, errors: [] };
  for (const arg of argv) {
    if (arg === '--check') {
      options.check = true;
    } else if (arg.startsWith('--fixture=')) {
      const value = arg.slice('--fixture='.length);
      if (value.length === 0) options.errors.push('--fixture= needs a path');
      else options.fixture = path.resolve(process.cwd(), value);
    } else {
      options.errors.push('unknown argument ' + JSON.stringify(arg));
    }
  }
  return options;
}

function displayPath(file) {
  const relative = path.relative(REPO_ROOT, file);
  return (relative.length === 0 ? file : relative).split(path.sep).join('/');
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.errors.length > 0) {
    process.stderr.write('characterize-pr6: ' + options.errors.join('\n  ') + '\n');
    process.stderr.write('usage: ' + COMMAND + ' [--check] [--fixture=<path>]\n');
    return 2;
  }

  const check = options.check;
  const outFile = options.fixture;
  const document = buildDocument();
  const serialized = JSON.stringify(document, null, 2) + '\n';

  if (check) {
    // The provenance block names the PRE-MOVE commit, so it is expected to
    // differ once the extraction is committed. Only the captured behaviour is
    // compared: that is what must not change.
    const fromCommit = outFile === OUT_FILE;
    const source = fromCommit ? 'HEAD:' + FIXTURE_REL : displayPath(outFile);
    let text;
    if (fromCommit) {
      text = committedFixture(FIXTURE_REL);
      if (text === null) {
        process.stderr.write(
          'characterize-pr6: no committed fixture at ' + source +
          '; --check compares the committed baseline and never writes one\n'
        );
        return 1;
      }
    } else {
      if (!fs.existsSync(outFile)) {
        process.stderr.write(
          'characterize-pr6: no fixture at ' + source +
          '; --check compares an existing baseline and never writes one\n'
        );
        return 1;
      }
      text = fs.readFileSync(outFile, 'utf8');
    }
    let existing;
    try {
      existing = JSON.parse(text);
    } catch (err) {
      process.stderr.write('characterize-pr6: ' + source + ' is not valid JSON: ' + err.message + '\n');
      return 1;
    }
    const captured = (doc) => {
      const { provenance: _provenance, ...behaviour } = doc;
      return JSON.stringify(behaviour, null, 2);
    };
    if (captured(existing) !== captured(document)) {
      process.stderr.write(
        'characterize-pr6: the captured behaviour no longer matches the pre-move baseline (' + source + ')\n'
      );
      return 1;
    }
    process.stdout.write(
      'characterize-pr6: OK - the current implementation reproduces the frozen scoring behaviour (' +
      source + '). Fixture origin is proven by scripts/verify-pr2-provenance.js, not here.\n'
    );
    return 0;
  }

  fs.writeFileSync(outFile, serialized);
  process.stdout.write(
    'characterize-pr6: wrote ' + displayPath(outFile) + ' (' + serialized.length + ' bytes) at ' +
    document.provenance.baseline_sha + '\n'
  );
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { buildDocument, main };
