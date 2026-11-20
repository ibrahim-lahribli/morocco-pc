'use strict';

/**
 * scripts/characterize-pr7.js - freeze the Engine 6 explanation surface and
 * offers/as-of behaviour BEFORE the extraction moves anything (step 4B PR 7,
 * protection L2).
 *
 * Why this exists
 *   Moving the four pure modules of src/recommendation/explanation/
 *   (build-facts, explain, reasons, index) and src/recommendation/offers/as-of.js
 *   into packages/recommendation-core/src/ must not change a single explanation
 *   string, reason code, reason order or as-of parse result. The existing suites
 *   (L1) prove the contracts they cover; this script records what the ORIGINAL
 *   implementation actually returns for a fixed, explicitly supplied set of
 *   inputs, so the extracted implementation can be compared against it field by
 *   field.
 *
 * What it is NOT
 *   It is not a test and not a fixture for runtime code. It reads the engine
 *   through its `src/` modules, exactly as the pre-move tree exposes them (the
 *   explanation barrel plus the three implementation modules and as-of.js - no
 *   loader, no `pg`, no filesystem input), and writes one JSON document. Run it
 *   ONCE, at the baseline SHA, before the first `git mv`; the committed document
 *   is the baseline, and the extraction is compared against it afterwards.
 *
 * Determinism
 *   No clock read, no randomness, no database, no environment input: every id,
 *   score, price and timestamp below is a literal. `parseAsOf` is exercised only
 *   with literal timestamps, so the output is byte-stable on its baseline
 *   commit. The provenance block records the baseline SHA and its commit date
 *   (read from git, not from `Date.now()`), so re-running on the same commit
 *   produces byte-identical output. Nothing here reads a locale.
 *
 * DB-free by construction
 *   Every build, component, contribution and entry below is built IN MEMORY from
 *   literals. Nothing here opens a connection, reads a credential or touches the
 *   filesystem for input.
 *
 * Usage
 *   node scripts/characterize-pr7.js                        # write the fixture
 *   node scripts/characterize-pr7.js --check                # compare, never write
 *   node scripts/characterize-pr7.js --check --fixture=<p>  # compare another copy
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
  'pr7-characterization.json'
);
const FIXTURE_REL = 'packages/recommendation-core/test/fixtures/pr7-characterization.json';
const COMMAND = 'node scripts/characterize-pr7.js';

// The PRE-MOVE paths: after the extraction these are identity shims, so the
// same numbers must come back - which is exactly what --check proves.
const explanationBarrel = require('../src/recommendation/explanation');
const buildFactsModule = require('../src/recommendation/explanation/build-facts');
const explainModule = require('../src/recommendation/explanation/explain');
const reasonsModule = require('../src/recommendation/explanation/reasons');
const asOfModule = require('../src/recommendation/offers/as-of');

const { explainSelection } = explainModule;
const { deriveReasons, REASON_CODES, REASON_ORDER } = reasonsModule;
const { parseAsOf } = asOfModule;

// ---------------------------------------------------------------------------
// Literal fixture builders. Every value is supplied here; nothing is derived
// from the clock, the environment, a locale or a database.
// ---------------------------------------------------------------------------

const BUDGET = Object.freeze({ amount: 4000, currency: 'MAD' });
const OTHER_BUDGET = Object.freeze({ amount: 3500, currency: 'USD' });

/** The engine build's component shape: nested price, status, notes. */
function component(role, status, options = {}) {
  const price = options.price === undefined ? 100 : options.price;
  return Object.freeze({
    component_role: role,
    product_id: role + '-product',
    product_variant_id: null,
    category: 'x',
    status,
    price: Object.freeze({
      selected_price: price,
      currency: 'MAD',
      store_id: null,
      price_checked_at: null,
    }),
    compatibility_notes: Object.freeze(options.notes === undefined ? [] : options.notes),
  });
}

/**
 * The READ-PATH component shape: build_component flattened by the repository
 * join. No `status`, no `compatibility_notes`, no nested `price` object; the
 * flat `selected_price` is a STRING because build_component.selected_price is
 * NUMERIC and node-postgres does not parse NUMERIC.
 */
function readPathComponent(role, selectedPrice) {
  return Object.freeze({
    component_role: role,
    product_id: role + '-product',
    product_variant_id: null,
    selected_price: selectedPrice.toFixed(2),
    offer_class: 'STANDARD',
    store_offer_id: null,
  });
}

function makeBuild(components, options = {}) {
  return Object.freeze({
    components: Object.freeze(components),
    total_price: options.total_price === undefined ? 3000 : options.total_price,
    currency: options.currency === undefined ? 'MAD' : options.currency,
    unknown_pairwise_count: 0,
  });
}

function makeEntry(build, overrides = {}) {
  return Object.freeze({
    persisted_rank: 1,
    build_score: 87.5,
    total_price: build.total_price,
    compatibility_status: 'PASS',
    signature: 'CPU:11111111-1111-4111-8111-111111111111|GPU::',
    explanation: null,
    build,
    ...overrides,
  });
}

const CONTRIBUTIONS = Object.freeze([
  Object.freeze({ role: 'CPU', type: 'PERFORMANCE', effective_score: 80, weight: 0.2 }),
  Object.freeze({ role: 'CPU', type: 'VALUE', effective_score: 40, weight: 0.075 }),
  Object.freeze({ role: 'MOTHERBOARD', type: 'QUALITY', effective_score: 60, weight: 0.25 }),
]);

const TIED_CONTRIBUTIONS = Object.freeze([
  Object.freeze({ role: 'CPU', type: 'PERFORMANCE', effective_score: 50, weight: 0.2 }),
  Object.freeze({ role: 'MOTHERBOARD', type: 'QUALITY', effective_score: 40, weight: 0.25 }),
]);

const BIOS_NOTE = Object.freeze({ source_status: 'CONDITIONAL', min_bios_version: '1.2.3' });
const BIOS_NOTE_ALT = Object.freeze({ source_status: 'CONDITIONAL', min_bios_version: '2.0.0' });
const NON_CONDITIONAL_NOTE = Object.freeze({ source_status: 'VERIFIED', min_bios_version: '9.9.9' });

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

// ---------------------------------------------------------------------------
// A. Public API and identity
// ---------------------------------------------------------------------------

function captureBarrel() {
  return {
    exports: Object.keys(explanationBarrel),
    frozen: {
      REASON_CODES: Object.isFrozen(REASON_CODES),
      REASON_ORDER: Object.isFrozen(REASON_ORDER),
      REASON_ORDER_VALUE: REASON_ORDER.slice(),
      barrel: Object.isFrozen(explanationBarrel),
    },
    modules: {
      build_facts: Object.keys(buildFactsModule),
      explain: Object.keys(explainModule),
      reasons: Object.keys(reasonsModule),
    },
  };
}

// ---------------------------------------------------------------------------
// B. Decision 22 - the fixed explanation string
// ---------------------------------------------------------------------------

function captureExplain() {
  const passBuild = makeBuild([component('CPU', 'PASS'), component('MOTHERBOARD', 'PASS')]);
  const passEntry = makeEntry(passBuild);

  const unknownBuild = makeBuild([
    component('CPU', 'PASS'),
    component('GPU', 'UNKNOWN'),
    component('MOTHERBOARD', 'UNKNOWN'),
  ]);
  const unknownEntry = makeEntry(unknownBuild, { compatibility_status: 'UNKNOWN' });

  const conditionalBuild = makeBuild([
    component('CPU', 'PASS'),
    component('MOTHERBOARD', 'PASS', { notes: [BIOS_NOTE, NON_CONDITIONAL_NOTE] }),
    component('GPU', 'PASS', { notes: [BIOS_NOTE_ALT, BIOS_NOTE] }),
  ]);
  const conditionalEntry = makeEntry(conditionalBuild, { persisted_rank: 2, build_score: 71 });

  const secondBuild = makeBuild([component('CPU', 'PASS')], { total_price: 1200 });
  const multiEntries = [passEntry, makeEntry(secondBuild, { persisted_rank: 3 })];

  return {
    'pass-two-components': capture(() =>
      explainSelection({
        selected: [passEntry],
        builds: [passBuild],
        contributions: [CONTRIBUTIONS],
        budget: BUDGET,
      })
    ),
    'unknown-status-and-roles': capture(() =>
      explainSelection({
        selected: [unknownEntry],
        builds: [unknownBuild],
        contributions: [[]],
        budget: BUDGET,
      })
    ),
    'bios-conditional-dedup': capture(() =>
      explainSelection({
        selected: [conditionalEntry],
        builds: [conditionalBuild],
        contributions: [CONTRIBUTIONS],
        budget: BUDGET,
      })
    ),
    'dominant-tie-first-wins': capture(() =>
      explainSelection({
        selected: [passEntry],
        builds: [passBuild],
        contributions: [TIED_CONTRIBUTIONS],
        budget: BUDGET,
      })
    ),
    'empty-selection': capture(() =>
      explainSelection({ selected: [], builds: [], contributions: [], budget: BUDGET })
    ),
    'multi-entry-order': capture(() =>
      explainSelection({
        selected: multiEntries,
        builds: [passBuild, secondBuild],
        contributions: [CONTRIBUTIONS, []],
        budget: OTHER_BUDGET,
      })
    ),
    'output-frozen': capture(() => {
      const explained = explainSelection({
        selected: [passEntry],
        builds: [passBuild],
        contributions: [CONTRIBUTIONS],
        budget: BUDGET,
      });
      return {
        container: Object.isFrozen(explained),
        entries: explained.every((item) => Object.isFrozen(item)),
        input_explanation_untouched: passEntry.explanation,
      };
    }),
    errors: {
      'selected-not-array': capture(() =>
        explainSelection({ selected: null, builds: [], contributions: [], budget: BUDGET })
      ),
      'misaligned-contributions': capture(() =>
        explainSelection({ selected: [], builds: [passBuild], contributions: [], budget: BUDGET })
      ),
      'build-not-in-builds': capture(() =>
        explainSelection({
          selected: [passEntry],
          builds: [secondBuild],
          contributions: [CONTRIBUTIONS],
          budget: BUDGET,
        })
      ),
      'budget-missing-amount': capture(() =>
        explainSelection({
          selected: [passEntry],
          builds: [passBuild],
          contributions: [CONTRIBUTIONS],
          budget: { currency: 'MAD' },
        })
      ),
      'budget-invalid-currency': capture(() =>
        explainSelection({
          selected: [passEntry],
          builds: [passBuild],
          contributions: [CONTRIBUTIONS],
          budget: { amount: 4000, currency: 'dirham' },
        })
      ),
      'entry-bad-rank': capture(() =>
        explainSelection({
          selected: [makeEntry(passBuild, { persisted_rank: 0 })],
          builds: [passBuild],
          contributions: [CONTRIBUTIONS],
          budget: BUDGET,
        })
      ),
      'entry-bad-score': capture(() =>
        explainSelection({
          selected: [makeEntry(passBuild, { build_score: 140 })],
          builds: [passBuild],
          contributions: [CONTRIBUTIONS],
          budget: BUDGET,
        })
      ),
      'entry-invalid-status': capture(() =>
        explainSelection({
          selected: [makeEntry(passBuild, { compatibility_status: 'MAYBE' })],
          builds: [passBuild],
          contributions: [CONTRIBUTIONS],
          budget: BUDGET,
        })
      ),
      'component-status-out-of-vocabulary': capture(() =>
        explainSelection({
          selected: [makeEntry(makeBuild([component('CPU', 'FAIL')]))],
          builds: [makeBuild([component('CPU', 'FAIL')])],
          contributions: [CONTRIBUTIONS],
          budget: BUDGET,
        })
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// C. E7 - structured reason codes
// ---------------------------------------------------------------------------

function captureReasons() {
  const gpuBuild = makeBuild([
    component('CPU', 'PASS'),
    component('GPU', 'PASS', { price: 2000 }),
    component('MOTHERBOARD', 'UNKNOWN', { notes: [BIOS_NOTE] }),
  ]);

  const readPathBuild = makeBuild(
    [
      readPathComponent('CPU', 1000),
      readPathComponent('GPU', 1500),
      readPathComponent('MOTHERBOARD', 500),
    ],
    { total_price: '3000.00' }
  );

  const igpuBuild = makeBuild([component('CPU', 'PASS'), component('MOTHERBOARD', 'PASS')]);

  const fullArgs = {
    build: gpuBuild,
    contributions: CONTRIBUTIONS,
    profile: Object.freeze({ gpu_policy: 'REQUIRED' }),
    budget: BUDGET,
    inputs: Object.freeze({ use_case: 'GAMING', resolution: '1440p', priority: 3 }),
    strategy: 'BALANCED',
    catalogReasonCodes: ['NO_VALUE_CANDIDATE', 'NO_VALUE_CANDIDATE'],
  };

  return {
    'full-surface': capture(() => deriveReasons(fullArgs)),
    'read-path-three-codes': capture(() =>
      deriveReasons({
        build: readPathBuild,
        budget: Object.freeze({ amount: '4000.00', currency: 'MAD' }),
      })
    ),
    'igpu-null-gpu-share': capture(() => deriveReasons({ build: igpuBuild, budget: BUDGET })),
    'no-optional-inputs': capture(() => deriveReasons({ build: igpuBuild, budget: BUDGET })),
    'empty-contributions': capture(() =>
      deriveReasons({ build: igpuBuild, budget: BUDGET, contributions: [] })
    ),
    'profile-without-policy': capture(() =>
      deriveReasons({
        build: igpuBuild,
        budget: BUDGET,
        inputs: Object.freeze({ use_case: 'OFFICE' }),
        profile: Object.freeze({}),
      })
    ),
    'output-frozen': capture(() => {
      const reasons = deriveReasons(fullArgs);
      return {
        container: Object.isFrozen(reasons),
        entries: reasons.every((reason) => Object.isFrozen(reason)),
        array_values: reasons
          .filter((reason) => Array.isArray(reason.value))
          .every((reason) => Object.isFrozen(reason.value)),
        order: reasons.map((reason) => reason.code),
      };
    }),
    errors: {
      'non-object-args': capture(() => deriveReasons(null)),
      'missing-build': capture(() => deriveReasons({ budget: BUDGET })),
      'null-total-price': capture(() =>
        deriveReasons({ build: makeBuild([component('CPU', 'PASS')], { total_price: null }), budget: BUDGET })
      ),
      'invalid-strategy': capture(() =>
        deriveReasons({ build: igpuBuild, budget: BUDGET, strategy: 'CHEAPEST' })
      ),
      'invalid-priority': capture(() =>
        deriveReasons({
          build: igpuBuild,
          budget: BUDGET,
          inputs: Object.freeze({ use_case: 'GAMING', priority: 6 }),
        })
      ),
      'invalid-catalog-code': capture(() =>
        deriveReasons({ build: igpuBuild, budget: BUDGET, catalogReasonCodes: ['NOT_A_CODE'] })
      ),
      'invalid-gpu-policy': capture(() =>
        deriveReasons({
          build: igpuBuild,
          budget: BUDGET,
          profile: Object.freeze({ gpu_policy: 'OPTIONAL' }),
        })
      ),
      'invalid-budget-currency': capture(() =>
        deriveReasons({ build: igpuBuild, budget: Object.freeze({ amount: 4000, currency: 'MAD ' }) })
      ),
      'gpu-without-price': capture(() =>
        deriveReasons({
          build: makeBuild([component('CPU', 'PASS'), Object.freeze({ component_role: 'GPU' })]),
          budget: BUDGET,
        })
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// D. Decision 38 - offers/as-of timestamp parsing
// ---------------------------------------------------------------------------

function captureAsOf() {
  const accepted = [
    ['undefined-option', {}],
    ['null-options', null],
    ['zulu', { asOf: '2026-11-01T00:00:00Z' }],
    ['offset', { asOf: '2026-11-01T00:00:00+01:00' }],
    ['milliseconds', { asOf: '2026-11-01T00:00:00.123Z' }],
    ['one-digit-fraction', { asOf: '2026-11-01T00:00:00.5Z' }],
    ['leap-day', { asOf: '2024-02-29T23:59:59Z' }],
  ];

  const rejected = [
    ['date-only', { asOf: '2026-11-01' }],
    ['no-timezone', { asOf: '2026-11-01T00:00:00' }],
    ['minute-precision', { asOf: '2026-11-01T00:00Z' }],
    ['space-separator', { asOf: '2026-11-01 00:00:00Z' }],
    ['impossible-february', { asOf: '2026-02-30T00:00:00Z' }],
    ['nan-string', { asOf: 'not-a-date' }],
    ['numeric-value', { asOf: 1763000000000 }],
  ];

  const results = { accepted: {}, rejected: {} };
  for (const [id, options] of accepted) {
    results.accepted[id] = capture(() => parseAsOf(options));
  }
  for (const [id, options] of rejected) {
    results.rejected[id] = capture(() => parseAsOf(options));
  }
  return results;
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
    kind: 'pr7-characterization',
    description:
      'Frozen input/output pairs for the step 4B PR 7 extraction surface: the Engine 6 explanation ' +
      'barrel and its three implementation modules (build-facts, explain, reasons) plus offers/as-of. ' +
      'Covers the fixed Decision 22 template, the mandatory BIOS and UNKNOWN clauses, dominance ' +
      'selection and its tie order, the eight E7 reason codes and their canonical order, the read-path ' +
      'availability table and the Decision 38 as-of matrix. DB-free: every id, score and timestamp is a literal.',
    timestamp_policy:
      'No ambient clock is read while capturing: every id, score, price and timestamp is an input ' +
      'literal, so the document is byte-stable on its baseline commit. String order is recorded by ' +
      'code unit; nothing here reads a locale.',
    provenance: {
      baseline_sha: gitOutput(['rev-parse', 'HEAD']),
      baseline_commit_date: gitOutput(['log', '-1', '--format=%cI']),
      node_version: process.version,
      command: COMMAND,
      origin:
        'Captured from the PRE-MOVE implementation under src/recommendation/explanation/ and ' +
        'src/recommendation/offers/as-of.js before any module moved into packages/recommendation-core. ' +
        'The committed document is the baseline: do not regenerate it from the extracted code, because ' +
        'a fixture produced by the implementation under test proves nothing.',
    },
    barrel: captureBarrel(),
    explain: captureExplain(),
    reasons: captureReasons(),
    as_of: captureAsOf(),
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
    process.stderr.write('characterize-pr7: ' + options.errors.join('\n  ') + '\n');
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
          'characterize-pr7: no committed fixture at ' + source +
          '; --check compares the committed baseline and never writes one\n'
        );
        return 1;
      }
    } else {
      if (!fs.existsSync(outFile)) {
        process.stderr.write(
          'characterize-pr7: no fixture at ' + source +
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
      process.stderr.write('characterize-pr7: ' + source + ' is not valid JSON: ' + err.message + '\n');
      return 1;
    }
    const captured = (doc) => {
      const { provenance: _provenance, ...behaviour } = doc;
      return JSON.stringify(behaviour, null, 2);
    };
    if (captured(existing) !== captured(document)) {
      process.stderr.write(
        'characterize-pr7: the captured behaviour no longer matches the pre-move baseline (' + source + ')\n'
      );
      return 1;
    }
    process.stdout.write(
      'characterize-pr7: OK - the current implementation reproduces the frozen explanation and as-of ' +
      'behaviour (' + source + '). Fixture origin is proven by scripts/verify-pr2-provenance.js, not here.\n'
    );
    return 0;
  }

  fs.writeFileSync(outFile, serialized);
  process.stdout.write(
    'characterize-pr7: wrote ' + displayPath(outFile) + ' (' + serialized.length + ' bytes) at ' +
    document.provenance.baseline_sha + '\n'
  );
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { buildDocument, main };
