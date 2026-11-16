'use strict';

/**
 * scripts/characterize-pr2.js - freeze the PR 2 surface's behaviour BEFORE the
 * extraction moves anything (step 4B PR 2, protection L2).
 *
 * Why this exists
 *   Moving candidates/, compatibility/ and the pure filtering half into
 *   packages/recommendation-core must not change a single verdict, status or
 *   ordering. Existing assertions (L1) prove the contracts they already cover;
 *   this script records what the ORIGINAL implementation actually returns for a
 *   fixed, explicitly supplied set of inputs, so the extracted implementation
 *   can be compared against it field by field.
 *
 * What it is NOT
 *   It is not a test and not a fixture for runtime code. It reads the engine
 *   through its `src/` modules, exactly as the pre-move tree exposes them, and
 *   writes one JSON document. Run it ONCE, at the baseline SHA, before the
 *   first `git mv`; the committed document is the baseline, and
 *   `packages/recommendation-core/test/characterization.test.js` compares the
 *   extracted implementation against it.
 *
 * Determinism
 *   No clock read, no randomness, no database, no filesystem input beyond this
 *   repository: every id and timestamp below is a literal. The provenance block
 *   records the baseline SHA and its commit date (read from git, not from
 *   `Date.now()`), so re-running on the same commit produces byte-identical
 *   output.
 *
 * Usage
 *   node scripts/characterize-pr2.js                        # write the fixture
 *   node scripts/characterize-pr2.js --check                # compare, never write
 *   node scripts/characterize-pr2.js --check --fixture=<p>  # compare another copy
 *
 * --fixture=<path> exists so a regression test can point --check at a
 * deliberately altered copy and prove the comparison REFUSES it, without
 * touching the committed baseline. --check never creates, truncates or rewrites
 * a file: a missing fixture is an error, not an invitation to write one.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { ROLE_CATEGORIES } = require('../src/recommendation/candidates/roles');
const {
  createCandidateSelectionInput,
  createCandidate,
  selectCandidatePool,
  CandidateSelectionError,
} = require('../src/recommendation/candidates');
const { filterCandidates } = require('../src/recommendation/filtering/filter');
const {
  buildIntegratedGpuPresentMap,
} = require('../src/recommendation/filtering/igpu-map');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(
  REPO_ROOT,
  'packages',
  'recommendation-core',
  'test',
  'fixtures',
  'pr2-characterization.json'
);

// ---------------------------------------------------------------------------
// Deterministic identifiers (hex, lexicographically orderable).
// ---------------------------------------------------------------------------

const U = (n) => 'uuuuuuuu-uuuu-uuuu-uuuu-' + String(n).padStart(12, '0');
const V = (n) => 'vvvvvvvv-vvvv-vvvy-vvvv-' + String(n).padStart(12, '0');
const P = (n) => 'pppppppp-pppp-pppp-pppp-' + String(n).padStart(12, '0');

const CPU_ID = U(1);
const MB_ID = U(2);
const RAM_ID = U(3);
const GPU_ID = U(4);
const PSU_ID = U(5);
const COOLER_ID = U(6);
const CASE_ID = U(7);
const SSD_ID = U(8);
const CPU_ID_2 = U(9);

const GPU_VARIANT_ID = V(1);
const PLATFORM_ID = P(10);
const SOCKET_ID = P(1);
const OTHER_SOCKET_ID = P(2);
const FAMILY_ID = P(30);
const RAM_MEMORY_TYPE_ID = P(20);

const DECISION_TS = '2026-09-19T09:00:00.000Z';

// ---------------------------------------------------------------------------
// Selection input (Engine 2A contract).
// ---------------------------------------------------------------------------

const SELECTION_INPUT = {
  budget_amount: 8000,
  currency: 'MAD',
  use_case: 'GAMING',
  required_roles: [
    'CPU',
    'MOTHERBOARD',
    'RAM',
    'GPU',
    'PSU',
    'CASE',
    'CPU_COOLER',
    'SSD_BOOT',
  ],
};

// ---------------------------------------------------------------------------
// Context builders: the B2-B normalized shapes exactly ('p:<id>' / 'v:<id>'
// keys, loader-shaped compat rows carrying source_table / source_id /
// support_status).
// ---------------------------------------------------------------------------

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function makeCandidate(role, productId, variantId = null) {
  return createCandidate({
    component_role: role,
    category: ROLE_CATEGORIES[role],
    product_id: productId,
    product_variant_id: variantId,
  });
}

function cpuSpec(overrides = {}) {
  return {
    socket_id: SOCKET_ID,
    product_family_id: FAMILY_ID,
    integrated_gpu_present: true,
    tdp_watts: 125,
    ...overrides,
  };
}

function motherboardSpec(overrides = {}) {
  return {
    socket_id: SOCKET_ID,
    form_factor: 'ATX',
    memory_type_id: RAM_MEMORY_TYPE_ID,
    dimm_slots: 4,
    max_memory_capacity_gb: 128,
    ...overrides,
  };
}

function ramSpec(overrides = {}) {
  return {
    memory_type_id: RAM_MEMORY_TYPE_ID,
    module_count: 2,
    capacity_per_module_gb: 8,
    ...overrides,
  };
}

function coolerSpec(overrides = {}) {
  return {
    cooling_type: 'AIR',
    cooler_requires_radiator: false,
    radiator_size_mm: null,
    radiator_position: null,
    height_mm: 155,
    max_tdp_watts: 250,
    ...overrides,
  };
}

function caseSpec(overrides = {}) {
  return {
    max_gpu_length_mm: 360,
    max_gpu_thickness_slots: 3,
    max_cpu_cooler_height_mm: 170,
    ...overrides,
  };
}

function psuSpec(overrides = {}) {
  return {
    rated_wattage: 750,
    power_connectors: { '24pin_atx': 1, eps: 1, pcie_8pin: 2, '12vhpwr': 1, sata: 4 },
    ...overrides,
  };
}

function gpuSpec(overrides = {}) {
  return {
    board_tgp_watts: 180,
    length_mm: 300,
    width_slots: 2.5,
    required_power_connectors: { pcie_8pin: 1 },
    recommended_psu_watts: 650,
    vram_capacity_gb: 8,
    ...overrides,
  };
}

function compatRow(sourceTable, sourceId, extra = {}) {
  return { source_table: sourceTable, source_id: sourceId, support_status: null, ...extra };
}

function goldenSpecs(overrides = {}) {
  return {
    ['p:' + CPU_ID]: cpuSpec(),
    ['p:' + MB_ID]: motherboardSpec(),
    ['p:' + RAM_ID]: ramSpec(),
    ['p:' + COOLER_ID]: coolerSpec(),
    ['p:' + CASE_ID]: caseSpec(),
    ['p:' + PSU_ID]: psuSpec(),
    ['v:' + GPU_VARIANT_ID]: gpuSpec(),
    ...overrides,
  };
}

function goldenCompat(overrides = {}) {
  return {
    cpu_motherboard_exact: {
      [MB_ID]: [
        compatRow('cpu_motherboard_support', 'cm-exact', {
          support_status: 'PASS',
          cpu_product_id: CPU_ID,
          min_bios_version: null,
        }),
      ],
    },
    cpu_motherboard_family: {},
    cooler_socket: {
      [COOLER_ID]: [
        compatRow('cooler_socket_support', 'cs-1', {
          support_status: 'PASS',
          socket_id: SOCKET_ID,
        }),
      ],
    },
    case_form_factor: {
      [CASE_ID]: [compatRow('case_motherboard_form_factor', 'cff-1', { form_factor: 'ATX' })],
    },
    case_radiator: {
      [CASE_ID]: [
        compatRow('case_radiator_support', 'cr-1', {
          radiator_size_mm: 240,
          position: 'TOP',
        }),
      ],
    },
    platform_memory: {
      [PLATFORM_ID]: [
        compatRow('platform_memory_support', 'pm-1', { memory_type_id: RAM_MEMORY_TYPE_ID }),
      ],
    },
    ...overrides,
  };
}

/** The golden pool, deliberately listed in NON-canonical role order. */
function goldenPool() {
  return [
    makeCandidate('SSD_BOOT', SSD_ID),
    makeCandidate('CASE', CASE_ID),
    makeCandidate('CPU', CPU_ID),
    makeCandidate('PSU', PSU_ID),
    makeCandidate('GPU', GPU_ID, GPU_VARIANT_ID),
    makeCandidate('CPU_COOLER', COOLER_ID),
    makeCandidate('MOTHERBOARD', MB_ID),
    makeCandidate('RAM', RAM_ID),
  ];
}

function bucketCandidates(pool) {
  const buckets = {};
  for (const role of Object.keys(ROLE_CATEGORIES)) {
    buckets[role] = [];
  }
  for (const candidate of pool) {
    buckets[candidate.component_role].push(candidate);
  }
  return buckets;
}

function buildContext({ pool, specs = {}, platform_by_socket = {}, compat = {} }) {
  return deepFreeze({
    candidates: bucketCandidates(pool),
    specs,
    platform_by_socket,
    compat,
  });
}

// ---------------------------------------------------------------------------
// Capture helpers. Every value below is READ from the implementation; nothing
// is computed here except the input it is given.
// ---------------------------------------------------------------------------

function capturedError(fn) {
  try {
    fn();
  } catch (err) {
    return {
      name: err.name,
      code: err.code === undefined ? null : err.code,
      field: err.field === undefined ? null : err.field,
      message: err.message,
    };
  }
  throw new Error('expected the call to throw, but it returned');
}

function captureCandidates() {
  const validated = createCandidateSelectionInput(SELECTION_INPUT);
  const baseCandidate = createCandidate({
    component_role: 'CPU',
    category: 'CPU',
    product_id: CPU_ID,
  });
  const variantCandidate = createCandidate({
    component_role: 'GPU',
    category: 'GPU',
    product_id: GPU_ID,
    product_variant_id: GPU_VARIANT_ID,
  });

  const poolResult = selectCandidatePool(SELECTION_INPUT, goldenPool());
  const poolAgain = selectCandidatePool(SELECTION_INPUT, goldenPool());

  return {
    selection_input: {
      input: SELECTION_INPUT,
      validated: validated,
    },
    selection_input_rejection: {
      input: Object.assign({}, SELECTION_INPUT, { budget_amount: -1 }),
      error: capturedError(() => createCandidateSelectionInput(
        Object.assign({}, SELECTION_INPUT, { budget_amount: -1 })
      )),
    },
    candidate_base: baseCandidate,
    candidate_variant: variantCandidate,
    candidate_rejection: {
      input: { component_role: 'GPU', category: 'CPU', product_id: GPU_ID },
      error: capturedError(() => createCandidate({
        component_role: 'GPU',
        category: 'CPU',
        product_id: GPU_ID,
      })),
    },
    pool: {
      input: { selection_input: SELECTION_INPUT, candidates: goldenPool() },
      output: poolResult,
      // Determinism is asserted as data, not assumed: the two runs must agree.
      repeated_run_is_deeply_equal: JSON.stringify(poolResult) === JSON.stringify(poolAgain),
    },
    pool_empty_rejection: {
      input: { selection_input: SELECTION_INPUT, candidates: [] },
      error: capturedError(() => selectCandidatePool(SELECTION_INPUT, [])),
    },
  };
}

function captureFiltering() {
  const cases = [];

  // 1. Fully compatible pool: every candidate PASSes.
  cases.push({
    name: 'all-compatible',
    context: buildContext({
      pool: goldenPool(),
      specs: goldenSpecs(),
      platform_by_socket: { [SOCKET_ID]: PLATFORM_ID },
      compat: goldenCompat(),
    }),
  });

  // 2. Motherboard on a different socket: cpu_motherboard FAILs both ways, so
  //    CPU and MOTHERBOARD are REJECTed and carry a decisive partner.
  const mismatchSpecs = goldenSpecs();
  mismatchSpecs['p:' + MB_ID] = motherboardSpec({ socket_id: OTHER_SOCKET_ID });
  cases.push({
    name: 'socket-mismatch',
    context: buildContext({
      pool: goldenPool(),
      specs: mismatchSpecs,
      platform_by_socket: { [SOCKET_ID]: PLATFORM_ID },
      compat: goldenCompat(),
    }),
  });

  // 3. Null CPU socket: unresolved data stays UNKNOWN, never FAIL.
  const nullSocketSpecs = goldenSpecs();
  nullSocketSpecs['p:' + CPU_ID] = cpuSpec({ socket_id: null });
  cases.push({
    name: 'null-cpu-socket',
    context: buildContext({
      pool: goldenPool(),
      specs: nullSocketSpecs,
      platform_by_socket: { [SOCKET_ID]: PLATFORM_ID },
      compat: goldenCompat(),
    }),
  });

  // 4. Absent partner roles: zero partners is UNKNOWN, never a FAIL.
  cases.push({
    name: 'absent-partners',
    context: buildContext({
      pool: [makeCandidate('CPU', CPU_ID), makeCandidate('SSD_BOOT', SSD_ID)],
      specs: { ['p:' + CPU_ID]: cpuSpec({ socket_id: null }) },
      platform_by_socket: {},
      compat: {},
    }),
  });

  // 5. Over-slot RAM kit: the HARD OG-11 rule REJECTs the RAM candidate.
  const overSlotSpecs = goldenSpecs();
  overSlotSpecs['p:' + RAM_ID] = ramSpec({ module_count: 8 });
  cases.push({
    name: 'over-slot-ram',
    context: buildContext({
      pool: goldenPool(),
      specs: overSlotSpecs,
      platform_by_socket: { [SOCKET_ID]: PLATFORM_ID },
      compat: goldenCompat(),
    }),
  });

  return cases.map((entry) => ({
    name: entry.name,
    context: entry.context,
    output: filterCandidates(entry.context),
  }));
}

function captureIgpuMap() {
  const cases = [
    { name: 'present-true', spec: cpuSpec({ integrated_gpu_present: true }), hasSpec: true },
    { name: 'present-false', spec: cpuSpec({ integrated_gpu_present: false }), hasSpec: true },
    { name: 'present-null', spec: cpuSpec({ integrated_gpu_present: null }), hasSpec: true },
    { name: 'missing-spec-row', spec: null, hasSpec: false },
  ];

  return cases.map((entry) => {
    const specs = {};
    if (entry.hasSpec) specs['p:' + CPU_ID] = entry.spec;
    const context = buildContext({
      pool: [makeCandidate('CPU', CPU_ID), makeCandidate('CPU', CPU_ID_2)],
      specs,
      platform_by_socket: {},
      compat: {},
    });
    return {
      name: entry.name,
      context,
      output: buildIntegratedGpuPresentMap(context),
    };
  });
}

// ---------------------------------------------------------------------------
// Provenance.
// ---------------------------------------------------------------------------

function gitOutput(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function provenance() {
  return {
    baseline_sha: gitOutput(['rev-parse', 'HEAD']),
    baseline_commit_date: gitOutput(['log', '-1', '--format=%cI']),
    node_version: process.version,
    command: 'node scripts/characterize-pr2.js',
    origin:
      'Captured from the PRE-MOVE implementation under src/recommendation/** ' +
      'before any module moved into packages/recommendation-core. The committed ' +
      'document is the baseline: do not regenerate it from the extracted code, ' +
      'because a fixture produced by the implementation under test proves nothing.',
  };
}

function buildDocument() {
  return {
    kind: 'pr2-characterization',
    description:
      'Frozen input/output pairs for the PR 2 extraction surface: candidate ' +
      'contracts and pool selection, hard-compatibility filtering, and the ' +
      'integrated-GPU handoff. Compared field by field by ' +
      'packages/recommendation-core/test/characterization.test.js.',
    timestamp_policy:
      'No ambient clock is read while capturing: every id and timestamp is an ' +
      'input literal, so the document is byte-stable on its baseline commit.',
    provenance: provenance(),
    candidates: captureCandidates(),
    filtering: captureFiltering(),
    igpu_map: captureIgpuMap(),
  };
}

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
    process.stderr.write('characterize-pr2: ' + options.errors.join('\n  ') + '\n');
    process.stderr.write('usage: node scripts/characterize-pr2.js [--check] [--fixture=<path>]\n');
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
    if (!fs.existsSync(outFile)) {
      process.stderr.write(
        'characterize-pr2: no fixture at ' + displayPath(outFile) +
        '; --check compares an existing baseline and never writes one\n'
      );
      return 1;
    }
    let existing;
    try {
      existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    } catch (err) {
      process.stderr.write('characterize-pr2: ' + displayPath(outFile) + ' is not valid JSON: ' + err.message + '\n');
      return 1;
    }
    const captured = (doc) => {
      const { provenance: _provenance, ...behaviour } = doc;
      return JSON.stringify(behaviour, null, 2);
    };
    if (captured(existing) !== captured(document)) {
      process.stderr.write(
        'characterize-pr2: the captured behaviour no longer matches the pre-move baseline (' +
        displayPath(outFile) + ')\n'
      );
      return 1;
    }
    process.stdout.write('characterize-pr2: OK - behaviour matches the pre-move baseline (' + displayPath(outFile) + ')\n');
    return 0;
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, serialized);
  process.stdout.write(
    'characterize-pr2: wrote ' + displayPath(outFile) + ' (' + serialized.length + ' bytes)\n'
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
