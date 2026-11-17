'use strict';

/**
 * scripts/characterize-pr3.js - freeze the Engine 3 assembly surface's behaviour
 * BEFORE the extraction moves anything (step 4B PR 3, protection L2).
 *
 * Why this exists
 *   Moving src/recommendation/assembly/ into
 *   packages/recommendation-core/src/assembly/ must not change a single build,
 *   price key, GPU-policy decision or pairwise verdict. The existing assertions
 *   (L1) prove the contracts they already cover; this script records what the
 *   ORIGINAL implementation actually returns for a fixed, explicitly supplied
 *   set of inputs, so the extracted implementation can be compared against it
 *   field by field.
 *
 * What it is NOT
 *   It is not a test and not a fixture for runtime code. It reads the engine
 *   through its `src/` modules, exactly as the pre-move tree exposes them (the
 *   assembly barrel and the pure candidate/filtering contracts - no loader, no
 *   `pg`, no filesystem input), and writes one JSON document. Run it ONCE, at
 *   the baseline SHA, before the first `git mv`; the committed document is the
 *   baseline, and the extraction is compared against it afterwards.
 *
 * Determinism
 *   No clock read, no randomness, no database, no environment input: every id,
 *   price and timestamp below is a literal. The provenance block records the
 *   baseline SHA and its commit date (read from git, not from `Date.now()`), so
 *   re-running on the same commit produces byte-identical output.
 *
 * DB-free by construction
 *   The Engine 2 sources the pipeline needs (`candidatePoolResult`,
 *   `filteringContext`, `filterResult`, `scoringModel`, `prices`) are BUILT
 *   IN MEMORY from the pure candidate/filtering contracts and a hand-written
 *   frozen context. Nothing here opens a connection or reads a credential.
 *
 * Usage
 *   node scripts/characterize-pr3.js                        # write the fixture
 *   node scripts/characterize-pr3.js --check                # compare, never write
 *   node scripts/characterize-pr3.js --check --fixture=<p>  # compare another copy
 *
 * Where --check reads the fixture from
 *   With no --fixture, --check compares against the COMMITTED fixture blob at
 *   HEAD (`git show HEAD:<path>`), not the working tree. This command is a CI
 *   gate, and a gate that reads a file the working tree can edit would agree
 *   with an uncommitted "fix" to itself.
 *
 *   --check never creates, truncates or rewrites a file: a missing fixture is an
 *   error, not an invitation to write one. It proves the current code still
 *   reproduces the frozen behaviour; it does NOT prove the fixture's origin -
 *   scripts/verify-pr2-provenance.js owns that claim for every manifest batch.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const assembly = require('../src/recommendation/assembly');
const { createCandidate, selectCandidatePool } = require('../src/recommendation/candidates');
const { filterCandidates } = require('../src/recommendation/filtering/filter');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(
  REPO_ROOT,
  'packages',
  'recommendation-core',
  'test',
  'fixtures',
  'pr3-characterization.json'
);

/** The fixture path as a Git path, for `HEAD:<path>`. */
const FIXTURE_REL = path.relative(REPO_ROOT, OUT_FILE).split(path.sep).join('/');

/**
 * The committed bytes of a repository path at HEAD, or null when HEAD has no
 * such blob. Read through Git so the working tree cannot contribute.
 */
function committedFixture(relative) {
  try {
    return execFileSync('git', ['show', 'HEAD:' + relative], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (_err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deterministic literals (hex ids stay orderable; no clock is read).
// ---------------------------------------------------------------------------

const U = (n) => 'uuuuuuuu-uuuu-uuuu-uuuu-' + String(n).padStart(12, '0');
const V = (n) => 'vvvvvvvv-vvvv-vvvv-vvvv-' + String(n).padStart(12, '0');
const P = (n) => 'pppppppp-pppp-pppp-pppp-' + String(n).padStart(12, '0');

const TS = '2026-11-17T00:00:00.000Z';
const STORE = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a';
const OFFER = '33333333-3333-4333-8333-333333333333';
const CURRENCY = 'MAD';

const CATEGORY_FOR = {
  CPU: 'CPU',
  MOTHERBOARD: 'MOTHERBOARD',
  RAM: 'MEMORY',
  GPU: 'GPU',
  PSU: 'PSU',
  CASE: 'CASE',
  CPU_COOLER: 'COOLER',
  SSD_BOOT: 'STORAGE',
};

const PRICE = {
  CPU: 300,
  MOTHERBOARD: 150,
  RAM: 100,
  GPU: 500,
  PSU: 120,
  CASE: 90,
  CPU_COOLER: 60,
  SSD_BOOT: 80,
};

const REQUIRED_ROLES = [
  'CPU',
  'MOTHERBOARD',
  'RAM',
  'GPU',
  'PSU',
  'CASE',
  'CPU_COOLER',
  'SSD_BOOT',
];

/** One Engine 2D candidate verdict, exactly the shape the filter emits. */
function verdict(role, productId, overrides = {}) {
  const defaultVariant = role === 'GPU' ? productId + '-var' : null;
  return {
    product_id: productId,
    product_variant_id:
      overrides.product_variant_id !== undefined ? overrides.product_variant_id : defaultVariant,
    category: overrides.category !== undefined ? overrides.category : CATEGORY_FOR[role],
    component_role: role,
    status: overrides.status || 'PASS',
    reason: overrides.reason !== undefined ? overrides.reason : null,
    relationships: overrides.relationships !== undefined ? overrides.relationships : {},
    unknown_pairwise_count:
      overrides.unknown_pairwise_count !== undefined ? overrides.unknown_pairwise_count : 0,
  };
}

/** The Step 2 price carrier built from the verdicts, validated by prices.js. */
function carrierFor(verdicts, priceById = {}) {
  const raw = Object.create(null);
  for (const entry of verdicts) {
    const key = assembly.priceKey(entry.product_id, entry.product_variant_id, entry.component_role);
    const price = Object.prototype.hasOwnProperty.call(priceById, entry.product_id)
      ? priceById[entry.product_id]
      : PRICE[entry.component_role];
    Object.defineProperty(raw, key, {
      value: {
        selected_price: price,
        currency: CURRENCY,
        store_id: STORE,
        price_checked_at: TS,
        offer_id: OFFER,
        offer_class: 'SEED_UNVERIFIED',
      },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return assembly.validatePrices(raw);
}

/** Minimal frozen Engine 2D context: every pair evaluator reads UNKNOWN. */
function emptyFilteringContext() {
  return Object.freeze({
    candidates: Object.freeze({}),
    specs: Object.freeze({}),
    platform_by_socket: Object.freeze({}),
    compat: Object.freeze({}),
  });
}

/** The ten-field Engine 3 input contract, assembled from literals. */
function engineInput({
  results,
  budget = 100000,
  useCase = 'office',
  gpuRequired = ['gaming'],
  integrated = null,
  topK = 5,
  maxBuilds = 10,
  filteringContext = null,
  gpuPolicy = null,
  vramFloorGb = null,
}) {
  const integratedMap =
    integrated !== null
      ? integrated
      : Object.fromEntries(
          results
            .filter((entry) => entry && entry.component_role === 'CPU')
            .map((entry) => [entry.product_id, true])
        );
  return {
    results,
    budget_amount: budget,
    currency: CURRENCY,
    required_roles: REQUIRED_ROLES.slice(),
    use_case: useCase,
    gpu_required_use_cases: gpuRequired,
    integrated_gpu_present: integratedMap,
    candidate_caps: { top_k_per_role: topK, max_builds_per_query: maxBuilds },
    prices: carrierFor(results),
    filtering_context: filteringContext === null ? emptyFilteringContext() : filteringContext,
    ...(gpuPolicy === null ? {} : { gpu_policy: gpuPolicy }),
    ...(vramFloorGb === null ? {} : { vram_floor_gb: vramFloorGb }),
  };
}

/** One eligible verdict per participating role. */
function fullSet(prefix, { gpu = true, status = 'PASS' } = {}) {
  const list = [
    verdict('CPU', prefix + '-cpu', { status }),
    verdict('MOTHERBOARD', prefix + '-mb', { status }),
    verdict('RAM', prefix + '-ram', { status }),
  ];
  if (gpu) list.push(verdict('GPU', prefix + '-gpu', { status }));
  list.push(
    verdict('PSU', prefix + '-psu', { status }),
    verdict('CASE', prefix + '-case', { status }),
    verdict('CPU_COOLER', prefix + '-cooler', { status }),
    verdict('SSD_BOOT', prefix + '-ssd', { status })
  );
  return list;
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

/** The verdict of a call that must fail: code, field and message, nothing else. */
function captureError(run) {
  try {
    run();
  } catch (err) {
    return {
      threw: true,
      name: err && err.name ? err.name : null,
      code: err && err.code !== undefined ? err.code : null,
      field: err && err.field !== undefined ? err.field : null,
      message: err && err.message ? err.message : String(err),
    };
  }
  return { threw: false };
}

/** A build reduced to the facts an extraction could plausibly disturb. */
function summarizeBuilds(result) {
  return {
    build_count: result.builds.length,
    builds: result.builds.map((build) => ({
      components: build.components.map((component) => ({
        component_role: component.component_role,
        product_id: component.product_id,
        product_variant_id: component.product_variant_id,
        category: component.category,
        status: component.status,
        selected_price: component.price.selected_price,
        currency: component.price.currency,
        offer_class: component.price.offer_class,
        compatibility_note_count: component.compatibility_notes.length,
      })),
      total_price: build.total_price,
      currency: build.currency,
      unknown_pairwise_count: build.unknown_pairwise_count,
    })),
  };
}

// ---------------------------------------------------------------------------
// 1. Step 1 - the Engine 3 input contract.
// ---------------------------------------------------------------------------

function captureEngine3Input() {
  const valid = engineInput({ results: fullSet('a'), integrated: { 'a-cpu': true } });
  const withPolicy = engineInput({
    results: fullSet('a'),
    integrated: { 'a-cpu': true },
    gpuPolicy: 'IGPU_ALLOWED',
    vramFloorGb: 8,
  });

  return {
    valid: {
      input: snapshot(valid),
      validated: snapshot(assembly.validateEngine3Input(valid)),
      frozen: Object.isFrozen(assembly.validateEngine3Input(valid)),
    },
    valid_with_policy_and_floor: {
      input: snapshot(withPolicy),
      validated: snapshot(assembly.validateEngine3Input(withPolicy)),
    },
    errors: [
      { case: 'missing required field', error: captureError(() => assembly.validateEngine3Input({})) },
      {
        case: 'non-positive budget',
        error: captureError(() =>
          assembly.validateEngine3Input(engineInput({ results: fullSet('a'), budget: 0 }))
        ),
      },
      {
        case: 'unknown component role',
        error: captureError(() => {
          const input = engineInput({ results: fullSet('a') });
          return assembly.validateEngine3Input({ ...input, required_roles: ['CPU', 'NOPE'] });
        }),
      },
      {
        case: 'unknown top-level field',
        error: captureError(() => {
          const input = engineInput({ results: fullSet('a') });
          return assembly.validateEngine3Input({ ...input, unexpected: 1 });
        }),
      },
      {
        case: 'unknown gpu_policy value',
        error: captureError(() => {
          const input = engineInput({ results: fullSet('a') });
          return assembly.validateEngine3Input({ ...input, gpu_policy: 'BOGUS' });
        }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 2. Step 2 - the price carrier.
// ---------------------------------------------------------------------------

function capturePrices() {
  const verdicts = fullSet('a');
  const carrier = carrierFor(verdicts);
  const unknown = verdict('PSU', 'a-psu-not-priced');

  return {
    keys: [
      assembly.priceKey(U(1), null, 'CPU'),
      assembly.priceKey(U(2), V(1), 'GPU'),
      assembly.priceKey(U(3), undefined, 'RAM'),
    ],
    carrier_keys: Object.keys(carrier),
    carrier: snapshot(carrier),
    lookups: [
      {
        candidate: snapshot(verdict('CPU', 'a-cpu')),
        entry: snapshot(assembly.lookupPrice(carrier, verdict('CPU', 'a-cpu'))),
      },
      {
        candidate: snapshot(verdict('GPU', 'a-gpu')),
        entry: snapshot(assembly.lookupPrice(carrier, verdict('GPU', 'a-gpu'))),
      },
    ],
    errors: [
      {
        case: 'missing carrier entry',
        error: captureError(() => assembly.lookupPrice(carrier, unknown)),
      },
      {
        case: 'null carrier',
        error: captureError(() => assembly.validatePrices(null)),
      },
      {
        case: 'non-positive selected price',
        error: captureError(() =>
          assembly.validatePrices({
            [assembly.priceKey(U(9), null, 'CPU')]: {
              selected_price: 0,
              currency: CURRENCY,
              store_id: STORE,
              price_checked_at: TS,
              offer_id: OFFER,
              offer_class: 'SEED_UNVERIFIED',
            },
          })
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 3. Step 3 - the GPU policy.
// ---------------------------------------------------------------------------

function captureGpuPolicy() {
  const cases = [
    {
      case: 'declared REQUIRED wins over an iGPU',
      input: {
        use_case: 'office',
        gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { cpu: true },
        selectedCpuProductId: 'cpu',
        gpuPolicy: 'REQUIRED',
      },
    },
    {
      case: 'declared IGPU_ALLOWED on an iGPU CPU',
      input: {
        use_case: 'gaming',
        gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { cpu: true },
        selectedCpuProductId: 'cpu',
        gpuPolicy: 'IGPU_ALLOWED',
      },
    },
    {
      case: 'declared IGPU_ALLOWED on a CPU without an iGPU',
      input: {
        use_case: 'office',
        gpu_required_use_cases: [],
        integrated_gpu_present: { cpu: false },
        selectedCpuProductId: 'cpu',
        gpuPolicy: 'IGPU_ALLOWED',
      },
    },
    {
      case: 'legacy rule 1: the use case requires a GPU',
      input: {
        use_case: 'gaming',
        gpu_required_use_cases: ['gaming', 'rendering'],
        integrated_gpu_present: { cpu: true },
        selectedCpuProductId: 'cpu',
        gpuPolicy: null,
      },
    },
    {
      case: 'legacy rule 2: an iGPU makes the GPU optional',
      input: {
        use_case: 'office',
        gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { cpu: true },
        selectedCpuProductId: 'cpu',
        gpuPolicy: null,
      },
    },
    {
      case: 'legacy: no iGPU, no required use case',
      input: {
        use_case: 'office',
        gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { cpu: null },
        selectedCpuProductId: 'cpu',
        gpuPolicy: null,
      },
    },
  ];

  return cases.map((entry) => ({
    case: entry.case,
    input: snapshot(entry.input),
    decision: assembly.resolveGpuRequirement(entry.input),
  }));
}

// ---------------------------------------------------------------------------
// 4. Step 4 - the DFS assembly.
// ---------------------------------------------------------------------------

function captureAssembly() {
  const scenarios = [
    {
      case: 'legacy OPTIONAL: discrete GPU first, omit path second',
      input: engineInput({ results: fullSet('a'), integrated: { 'a-cpu': true } }),
    },
    {
      case: 'declared IGPU_ALLOWED: the omit path is the only path',
      input: engineInput({
        results: fullSet('a'),
        integrated: { 'a-cpu': true },
        gpuPolicy: 'IGPU_ALLOWED',
      }),
    },
    {
      case: 'declared REQUIRED: the omit path is closed',
      input: engineInput({
        results: fullSet('a'),
        integrated: { 'a-cpu': true },
        gpuPolicy: 'REQUIRED',
      }),
    },
    {
      case: 'budget below the cheapest build',
      input: engineInput({ results: fullSet('a'), integrated: { 'a-cpu': true }, budget: 500 }),
    },
    {
      case: 'UNKNOWN verdicts stay eligible',
      input: engineInput({
        results: fullSet('a', { status: 'UNKNOWN' }),
        integrated: { 'a-cpu': true },
      }),
    },
    {
      case: 'two CPUs, max_builds_per_query halts the walk',
      input: engineInput({
        results: [...fullSet('a'), ...fullSet('b')],
        integrated: { 'a-cpu': true, 'b-cpu': true },
        maxBuilds: 3,
      }),
    },
    {
      case: 'REJECT verdicts are not traversed',
      input: engineInput({
        results: fullSet('a').map((entry) =>
          entry.component_role === 'PSU' ? verdict('PSU', 'a-psu', { status: 'REJECT' }) : entry
        ),
        integrated: { 'a-cpu': true },
      }),
    },
  ];

  return scenarios.map((entry) => ({
    case: entry.case,
    output: summarizeBuilds(assembly.assembleBuilds(entry.input)),
  }));
}

// ---------------------------------------------------------------------------
// 5. Decision 55/56 - the read-only whole-build and swap verdicts.
// ---------------------------------------------------------------------------

function pickedMap(verdicts) {
  const picked = {};
  for (const entry of verdicts) picked[entry.component_role] = entry;
  return picked;
}

function captureEvaluation() {
  const context = emptyFilteringContext();
  const picked = pickedMap(fullSet('a'));

  return {
    build: snapshot(assembly.evaluateBuild({ picked, filteringContext: context })),
    replacement: snapshot(
      assembly.evaluateBuildReplacement({
        picked,
        filteringContext: context,
        role: 'PSU',
        candidate: verdict('PSU', 'a-psu-replacement'),
      })
    ),
    errors: [
      {
        case: 'replacement role mismatch',
        error: captureError(() =>
          assembly.evaluateBuildReplacement({
            picked,
            filteringContext: context,
            role: 'PSU',
            candidate: verdict('CASE', 'a-case-2'),
          })
        ),
      },
      {
        case: 'replacement is a REJECT verdict',
        error: captureError(() =>
          assembly.evaluateBuildReplacement({
            picked,
            filteringContext: context,
            role: 'PSU',
            candidate: verdict('PSU', 'a-psu-reject', { status: 'REJECT' }),
          })
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 6. The composition entry point, over IN-MEMORY Engine 2 sources.
// ---------------------------------------------------------------------------

/**
 * A frozen Engine 2D context built without a loader: one candidate per role,
 * every compatibility map empty (so every pair reads UNKNOWN), and a CPU spec
 * entry declaring an integrated GPU. Same shape context-loader.js produces.
 */
function buildableContext() {
  const candidates = [
    createCandidate({ product_id: U(1), product_variant_id: null, category: 'CPU', component_role: 'CPU' }),
    createCandidate({ product_id: U(2), product_variant_id: null, category: 'MOTHERBOARD', component_role: 'MOTHERBOARD' }),
    createCandidate({ product_id: U(3), product_variant_id: null, category: 'MEMORY', component_role: 'RAM' }),
    createCandidate({ product_id: U(4), product_variant_id: V(1), category: 'GPU', component_role: 'GPU' }),
    createCandidate({ product_id: U(5), product_variant_id: null, category: 'PSU', component_role: 'PSU' }),
    createCandidate({ product_id: U(6), product_variant_id: null, category: 'CASE', component_role: 'CASE' }),
    createCandidate({ product_id: U(7), product_variant_id: null, category: 'COOLER', component_role: 'CPU_COOLER' }),
    createCandidate({ product_id: U(8), product_variant_id: null, category: 'STORAGE', component_role: 'SSD_BOOT' }),
  ];

  const buckets = {};
  for (const candidate of candidates) {
    if (!buckets[candidate.component_role]) buckets[candidate.component_role] = [];
    buckets[candidate.component_role].push(candidate);
  }

  return Object.freeze({
    candidates: Object.freeze(
      Object.fromEntries(Object.entries(buckets).map(([role, list]) => [role, Object.freeze(list)]))
    ),
    specs: Object.freeze({ ['p:' + U(1)]: Object.freeze({ integrated_gpu_present: true }) }),
    platform_by_socket: Object.freeze({}),
    compat: Object.freeze({}),
  });
}

function capturePipeline() {
  const filteringContext = buildableContext();
  const selectionInput = {
    budget_amount: 100000,
    currency: CURRENCY,
    use_case: 'office',
    required_roles: REQUIRED_ROLES.slice(),
  };
  const candidates = [];
  for (const list of Object.values(filteringContext.candidates)) candidates.push(...list);
  const candidatePoolResult = selectCandidatePool(selectionInput, candidates);
  const filterResult = filterCandidates(filteringContext);
  const scoringModel = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'baseline',
    version: 1,
    configuration: {
      gpu_required_use_cases: ['gaming'],
      candidate_caps: { top_k_per_role: 5, max_builds_per_query: 4 },
    },
  };
  const prices = carrierFor(filterResult.results, {
    [U(1)]: PRICE.CPU,
    [U(2)]: PRICE.MOTHERBOARD,
    [U(3)]: PRICE.RAM,
    [U(4)]: PRICE.GPU,
    [U(5)]: PRICE.PSU,
    [U(6)]: PRICE.CASE,
    [U(7)]: PRICE.CPU_COOLER,
    [U(8)]: PRICE.SSD_BOOT,
  });

  const sources = {
    candidatePoolResult,
    filteringContext,
    filterResult,
    scoringModel,
    prices,
  };

  return {
    sources: {
      candidate_pool: {
        input: snapshot(candidatePoolResult.input),
        pool_size: candidatePoolResult.pool.length,
        pool_ids: candidatePoolResult.pool.map((entry) => [
          entry.component_role,
          entry.product_id,
          entry.product_variant_id,
        ]),
      },
      filter_result: {
        result_count: filterResult.results.length,
        results: filterResult.results.map((entry) => ({
          component_role: entry.component_role,
          product_id: entry.product_id,
          product_variant_id: entry.product_variant_id,
          category: entry.category,
          status: entry.status,
          reason: entry.reason,
          unknown_pairwise_count: entry.unknown_pairwise_count,
        })),
      },
      price_keys: Object.keys(prices),
    },
    gpu_inputs: snapshot(assembly.buildGpuInputs({ candidatePoolResult, filteringContext, scoringModel })),
    builds: summarizeBuilds(assembly.assembleBuildsForRecommendation(sources)),
    errors: [
      {
        case: 'missing sources',
        error: captureError(() => assembly.assembleBuildsForRecommendation(null)),
      },
      {
        case: 'missing filteringContext source',
        error: captureError(() =>
          assembly.assembleBuildsForRecommendation({ ...sources, filteringContext: null })
        ),
      },
      {
        case: 'GPU-input loading without a scoring model',
        error: captureError(() =>
          assembly.buildGpuInputs({ candidatePoolResult, filteringContext, scoringModel: null })
        ),
      },
    ],
  };
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
    command: 'node scripts/characterize-pr3.js',
    origin:
      'Captured from the PRE-MOVE implementation under src/recommendation/assembly/ ' +
      'before any module moved into packages/recommendation-core. The committed ' +
      'document is the baseline: do not regenerate it from the extracted code, ' +
      'because a fixture produced by the implementation under test proves nothing.',
  };
}

function buildDocument() {
  return {
    kind: 'pr3-characterization',
    description:
      'Frozen input/output pairs for the PR 3 extraction surface: the Engine 3 ' +
      'input contract, the price carrier, the GPU policy, the DFS build assembly, ' +
      'the read-only build/swap verdicts and the composition entry point over ' +
      'in-memory Engine 2 sources. DB-free: every source object is built from ' +
      'literals and the pure candidate/filtering contracts.',
    timestamp_policy:
      'No ambient clock is read while capturing: every id and timestamp is an ' +
      'input literal, so the document is byte-stable on its baseline commit.',
    provenance: provenance(),
    engine3_input: captureEngine3Input(),
    prices: capturePrices(),
    gpu_policy: captureGpuPolicy(),
    assembly: captureAssembly(),
    evaluation: captureEvaluation(),
    pipeline: capturePipeline(),
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
    process.stderr.write('characterize-pr3: ' + options.errors.join('\n  ') + '\n');
    process.stderr.write('usage: node scripts/characterize-pr3.js [--check] [--fixture=<path>]\n');
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
    //
    // The default fixture is the COMMITTED one at HEAD: this is a repository
    // gate, and an uncommitted working-tree edit must not be able to satisfy it.
    const fromCommit = outFile === OUT_FILE;
    const source = fromCommit ? 'HEAD:' + FIXTURE_REL : displayPath(outFile);
    let text;
    if (fromCommit) {
      text = committedFixture(FIXTURE_REL);
      if (text === null) {
        process.stderr.write(
          'characterize-pr3: no committed fixture at ' + source +
          '; --check compares the committed baseline and never writes one\n'
        );
        return 1;
      }
    } else {
      if (!fs.existsSync(outFile)) {
        process.stderr.write(
          'characterize-pr3: no fixture at ' + source +
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
      process.stderr.write('characterize-pr3: ' + source + ' is not valid JSON: ' + err.message + '\n');
      return 1;
    }
    const captured = (doc) => {
      const { provenance: _provenance, ...behaviour } = doc;
      return JSON.stringify(behaviour, null, 2);
    };
    if (captured(existing) !== captured(document)) {
      process.stderr.write(
        'characterize-pr3: the captured behaviour no longer matches the pre-move baseline (' +
        source + ')\n'
      );
      return 1;
    }
    // Behaviour only. Where the fixture came from is proven by
    // scripts/verify-pr2-provenance.js, which this line must not imply.
    process.stdout.write(
      'characterize-pr3: OK - behaviour matches the pre-move baseline (' + source + '); ' +
      'fixture origin is not checked here (see verify-pr2-provenance)\n'
    );
    return 0;
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, serialized);
  process.stdout.write(
    'characterize-pr3: wrote ' + displayPath(outFile) + ' (' + serialized.length + ' bytes)\n'
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
