'use strict';

/**
 * scripts/characterize-pr4.js - freeze the Engine 5a ranking surface's behaviour
 * BEFORE the extraction moves anything (step 4B PR 4, protection L2).
 *
 * Why this exists
 *   Moving src/recommendation/ranking/ into
 *   packages/recommendation-core/src/ranking/ must not change a single rank,
 *   tie-break, diversity verdict or archetype choice. The existing assertions
 *   (L1) prove the contracts they already cover; this script records what the
 *   ORIGINAL implementation actually returns for a fixed, explicitly supplied
 *   set of inputs, so the extracted implementation can be compared against it
 *   field by field.
 *
 * What it is NOT
 *   It is not a test and not a fixture for runtime code. It reads the engine
 *   through its `src/` modules, exactly as the pre-move tree exposes them (the
 *   ranking barrel plus the three stage modules - no loader, no `pg`, no
 *   filesystem input), and writes one JSON document. Run it ONCE, at the
 *   baseline SHA, before the first `git mv`; the committed document is the
 *   baseline, and the extraction is compared against it afterwards.
 *
 * Determinism
 *   No clock read, no randomness, no database, no environment input: every id,
 *   score and price below is a literal. The provenance block records the
 *   baseline SHA and its commit date (read from git, not from `Date.now()`), so
 *   re-running on the same commit produces byte-identical output. Nothing here
 *   compares strings with `localeCompare`: the fixture pins code-unit ordering,
 *   which is the contract Decision 18.4 actually states.
 *
 * DB-free by construction
 *   The ranking stage takes already-assembled, already-scored builds. Every
 *   build below is built IN MEMORY from literals. Nothing here opens a
 *   connection, reads a credential or touches the filesystem for input.
 *
 * Usage
 *   node scripts/characterize-pr4.js                        # write the fixture
 *   node scripts/characterize-pr4.js --check                # compare, never write
 *   node scripts/characterize-pr4.js --check --fixture=<p>  # compare another copy
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

const ranking = require('../src/recommendation/ranking');
const rank = require('../src/recommendation/ranking/rank');
const diverse = require('../src/recommendation/ranking/select-diverse');
const archetypes = require('../src/recommendation/ranking/select-archetypes');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(
  REPO_ROOT,
  'packages',
  'recommendation-core',
  'test',
  'fixtures',
  'pr4-characterization.json'
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
// Deterministic literals.
// ---------------------------------------------------------------------------

const CURRENCY = 'MAD';

const DEFAULT_ROLE_PRODUCT = Object.freeze({
  CPU: 'cpu-1',
  MOTHERBOARD: 'mb-1',
  RAM: 'ram-1',
  GPU: 'gpu-1',
  PSU: 'psu-1',
  CASE: 'case-1',
  CPU_COOLER: 'cooler-1',
  SSD_BOOT: 'ssd-1',
});

const BUILD_ROLES = Object.keys(DEFAULT_ROLE_PRODUCT);

// ---------------------------------------------------------------------------
// Build/entry constructors. Inputs only: every value they carry is a literal.
// ---------------------------------------------------------------------------

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

/** One Engine 3 component, exactly the shape ranking validates. */
function component(role, productId, overrides = {}) {
  const record = {
    component_role: role,
    product_id: productId,
    product_variant_id:
      overrides.product_variant_id !== undefined
        ? overrides.product_variant_id
        : role === 'GPU'
          ? productId + '-var'
          : null,
    status: overrides.status !== undefined ? overrides.status : 'PASS',
  };
  if (overrides.category !== undefined) record.category = overrides.category;
  return deepFreeze(record);
}

/**
 * A frozen Engine 3 build with all eight roles. `component_status` is a
 * per-role status map; `status` applies to every role. Absent fields fall back
 * to the literals in DEFAULT_ROLE_PRODUCT.
 */
function fullBuild(overrides = {}) {
  const statusByRole = overrides.component_status || {};
  const components = BUILD_ROLES.map((role) =>
    component(role, overrides[role] !== undefined ? overrides[role] : DEFAULT_ROLE_PRODUCT[role], {
      status: statusByRole[role] !== undefined ? statusByRole[role] : overrides.status,
    })
  );
  return deepFreeze({
    components,
    build_score: overrides.build_score !== undefined ? overrides.build_score : 50,
    total_price: overrides.total_price !== undefined ? overrides.total_price : 100,
    currency: overrides.currency !== undefined ? overrides.currency : CURRENCY,
    unknown_pairwise_count:
      overrides.unknown_pairwise_count !== undefined ? overrides.unknown_pairwise_count : 0,
  });
}

/** The iGPU path: the same build with the GPU role omitted. */
function buildWithoutGpu(overrides = {}) {
  const components = BUILD_ROLES.filter((role) => role !== 'GPU').map((role) =>
    component(role, overrides[role] !== undefined ? overrides[role] : DEFAULT_ROLE_PRODUCT[role])
  );
  return deepFreeze({
    components,
    build_score: overrides.build_score !== undefined ? overrides.build_score : 50,
    total_price: overrides.total_price !== undefined ? overrides.total_price : 100,
    currency: overrides.currency !== undefined ? overrides.currency : CURRENCY,
    unknown_pairwise_count:
      overrides.unknown_pairwise_count !== undefined ? overrides.unknown_pairwise_count : 0,
  });
}

/**
 * A minimal build for validation cases. A key passed as `undefined` is ABSENT
 * from the object rather than present-and-undefined, which is the distinction
 * the contract's MISSING_REQUIRED_FIELD actually tests.
 */
function rawBuild(overrides = {}) {
  const record = {
    components: [component('CPU', 'cpu-1'), component('MOTHERBOARD', 'mb-1')],
    build_score: 50,
    total_price: 100,
    currency: CURRENCY,
    unknown_pairwise_count: 0,
  };
  for (const key of Object.keys(overrides)) {
    if (overrides[key] === undefined) delete record[key];
    else record[key] = overrides[key];
  }
  return deepFreeze(record);
}

/** A ranked entry shaped exactly like rankBuilds output (Decision 18). */
function rankedEntry(build, rankValue) {
  return deepFreeze({
    rank: rankValue,
    build,
    build_score: build.build_score,
    total_price: build.total_price,
    compatibility_status: 'PASS',
    signature: rank.buildSignature(build.components),
    explanation: null,
  });
}

// ---------------------------------------------------------------------------
// Projections. Only the facts an extraction could plausibly disturb, so the
// document is byte-stable and a diff is readable.
// ---------------------------------------------------------------------------

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

/** The (CPU product_id, GPU variant-or-OMITTED) identity both selectors key on. */
function pairOf(entry) {
  const byRole = Object.create(null);
  for (const entryComponent of entry.build.components) {
    byRole[entryComponent.component_role] = entryComponent;
  }
  const cpu = byRole.CPU;
  const gpu = byRole.GPU;
  return {
    cpu: cpu === undefined ? null : cpu.product_id,
    gpu:
      gpu === undefined
        ? 'OMITTED'
        : gpu.product_variant_id === null || gpu.product_variant_id === undefined
          ? ''
          : gpu.product_variant_id,
  };
}

function summarizeBuild(build) {
  return {
    build_score: build.build_score,
    total_price: build.total_price,
    currency: build.currency,
    unknown_pairwise_count: build.unknown_pairwise_count,
    components: build.components.map((entry) => ({
      component_role: entry.component_role,
      product_id: entry.product_id,
      product_variant_id: entry.product_variant_id,
      status: entry.status,
    })),
  };
}

function summarizeRankedEntry(entry) {
  return {
    rank: entry.rank,
    build_score: entry.build_score,
    total_price: entry.total_price,
    compatibility_status: entry.compatibility_status,
    signature: entry.signature,
    explanation: entry.explanation,
    pair: pairOf(entry),
  };
}

function summarizeRankedResult(result) {
  return {
    ranked: result.ranked.map(summarizeRankedEntry),
    top_n: result.top_n.map(summarizeRankedEntry),
    ranked_length: result.ranked.length,
    top_n_length: result.top_n.length,
  };
}

function summarizeSelection(result) {
  return {
    selected: result.selected.map((entry) => ({
      persisted_rank: entry.persisted_rank,
      build_score: entry.build_score,
      total_price: entry.total_price,
      compatibility_status: entry.compatibility_status,
      signature: entry.signature,
      explanation: entry.explanation,
      pair: pairOf(entry),
    })),
    dropped_count: result.dropped_count,
  };
}

function summarizeArchetypes(result) {
  return {
    archetypes: result.archetypes.map((entry) => ({
      strategy_key: entry.strategy_key,
      persisted_rank: entry.persisted_rank,
      build_score: entry.build_score,
      total_price: entry.total_price,
      compatibility_status: entry.compatibility_status,
      signature: entry.signature,
      explanation: entry.explanation,
      pair: pairOf(entry),
    })),
    reason_codes: result.reason_codes.slice(),
  };
}

/** The verdict of a call that must fail: name, code, field and message only. */
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

// ---------------------------------------------------------------------------
// 1. The barrel contract (index.js).
// ---------------------------------------------------------------------------

function captureBarrel() {
  return {
    exports: Object.keys(ranking),
    constants: {
      TOP_N_PERSISTED: ranking.TOP_N_PERSISTED,
      MAX_PER_PAIR: ranking.MAX_PER_PAIR,
      PERFORMANCE_FLOOR: ranking.PERFORMANCE_FLOOR,
      STRATEGIES: snapshot(ranking.STRATEGIES),
      REASON_CODES: snapshot(ranking.REASON_CODES),
    },
    arity: {
      rankBuilds: ranking.rankBuilds.length,
      selectDiverseTop: ranking.selectDiverseTop.length,
      selectArchetypes: ranking.selectArchetypes.length,
    },
    frozen: {
      TOP_N_PERSISTED: Object.isFrozen(ranking.TOP_N_PERSISTED),
      MAX_PER_PAIR: Object.isFrozen(ranking.MAX_PER_PAIR),
      STRATEGIES: Object.isFrozen(ranking.STRATEGIES),
      REASON_CODES: Object.isFrozen(ranking.REASON_CODES),
    },
    // Identity re-export: the barrel must not wrap or copy the stage modules.
    reexported_by_identity: {
      rankBuilds: ranking.rankBuilds === rank.rankBuilds,
      TOP_N_PERSISTED: ranking.TOP_N_PERSISTED === rank.TOP_N_PERSISTED,
      selectDiverseTop: ranking.selectDiverseTop === diverse.selectDiverseTop,
      MAX_PER_PAIR: ranking.MAX_PER_PAIR === diverse.MAX_PER_PAIR,
      selectArchetypes: ranking.selectArchetypes === archetypes.selectArchetypes,
      PERFORMANCE_FLOOR: ranking.PERFORMANCE_FLOOR === archetypes.PERFORMANCE_FLOOR,
      STRATEGIES: ranking.STRATEGIES === archetypes.STRATEGIES,
      REASON_CODES: ranking.REASON_CODES === archetypes.REASON_CODES,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. round2 (Decision 18.3): half-up on the shortest decimal representation.
// ---------------------------------------------------------------------------

function captureRound2() {
  const cases = [
    { case: 'binary-float boundary 1.005', value: 1.005 },
    { case: 'binary-float boundary 2.675', value: 2.675 },
    { case: '0.5 stays 0.5', value: 0.5 },
    { case: '0.005 rounds up', value: 0.005 },
    { case: 'integer unchanged', value: 5 },
    { case: 'zero unchanged', value: 0 },
    { case: 'hundred unchanged', value: 100 },
    { case: '87.4999 rounds up', value: 87.4999 },
    { case: '87.494 rounds down', value: 87.494 },
    { case: '87.495 half-up', value: 87.495 },
    { case: '87.4949 rounds down', value: 87.4949 },
    { case: '19.999 rounds to 20', value: 19.999 },
    { case: 'negative half-up', value: -1.005 },
  ];
  return {
    cases: cases.map((entry) => ({ case: entry.case, input: entry.value, output: rank.round2(entry.value) })),
    errors: [
      { case: 'NaN', error: captureError(() => rank.round2(NaN)) },
      { case: 'Infinity', error: captureError(() => rank.round2(Infinity)) },
      { case: 'string', error: captureError(() => rank.round2('87')) },
      { case: 'null', error: captureError(() => rank.round2(null)) },
      { case: 'undefined', error: captureError(() => rank.round2(undefined)) },
      { case: 'object', error: captureError(() => rank.round2({})) },
    ],
  };
}

// ---------------------------------------------------------------------------
// 3. buildSignature (Decision 18.4) and deriveStatus (Decision 18.5).
// ---------------------------------------------------------------------------

function captureSignature() {
  const fullSignature = rank.buildSignature(fullBuild({ CPU: 'cpu-sig', GPU: 'gpu-sig' }).components);
  const omitted = rank.buildSignature(buildWithoutGpu({ CPU: 'cpu-sig' }).components);
  const nullVariant = rank.buildSignature([
    component('MOTHERBOARD', 'mb-a'),
    component('CPU', 'cpu-sig'),
  ]);
  const setVariant = rank.buildSignature([
    component('MOTHERBOARD', 'mb-a', { product_variant_id: 'mb-a-v1' }),
    component('CPU', 'cpu-sig'),
  ]);
  const upper = rank.buildSignature([component('CPU', 'cpu-sig'), component('GPU', 'Z')]);
  const lower = rank.buildSignature([component('CPU', 'cpu-sig'), component('GPU', 'gpu-a')]);

  return {
    full_build: fullSignature,
    full_build_segment_count: fullSignature.split('|').length,
    omitted_gpu: omitted,
    omitted_gpu_segments: omitted.split('|'),
    null_variant: nullVariant,
    set_variant: setVariant,
    null_and_set_variant_differ: nullVariant !== setVariant,
    // Code-unit comparison only: 'Z' (0x5A) sorts before 'g' (0x67).
    upper_case_gpu: upper,
    lower_case_gpu: lower,
    upper_sorts_before_lower: upper < lower,
    distinct_cpu_products_differ: rank.buildSignature([
      component('CPU', 'c1'),
      component('MOTHERBOARD', 'm1'),
    ]) !== rank.buildSignature([component('CPU', 'c2'), component('MOTHERBOARD', 'm1')]),
  };
}

function captureDeriveStatus() {
  const cases = [
    {
      case: 'all PASS and zero unknown pairwise',
      components: fullBuild({}).components,
      unknown_pairwise_count: 0,
    },
    {
      case: 'one unknown pairwise',
      components: fullBuild({}).components,
      unknown_pairwise_count: 1,
    },
    {
      case: 'five unknown pairwise',
      components: fullBuild({}).components,
      unknown_pairwise_count: 5,
    },
    {
      case: 'one UNKNOWN component, zero pairwise',
      components: fullBuild({ component_status: { MOTHERBOARD: 'UNKNOWN' } }).components,
      unknown_pairwise_count: 0,
    },
    {
      case: 'UNKNOWN component and unknown pairwise',
      components: fullBuild({ component_status: { GPU: 'UNKNOWN' } }).components,
      unknown_pairwise_count: 2,
    },
  ];
  return cases.map((entry) => ({
    case: entry.case,
    status: rank.deriveStatus(entry.components, entry.unknown_pairwise_count),
  }));
}

// ---------------------------------------------------------------------------
// 4. rankBuilds: ordering, tie-breaks, rounding and the top-N cap.
// ---------------------------------------------------------------------------

function captureRankScenarios() {
  const scenarios = [];
  const add = (label, builds, extra = {}) => {
    scenarios.push({
      case: label,
      input: builds.map(summarizeBuild),
      ...extra,
      output: summarizeRankedResult(rank.rankBuilds({ builds })),
    });
  };

  add('build_score DESC determines order', [
    fullBuild({ CPU: 'cpu-lo', GPU: 'gpu-lo', build_score: 40, total_price: 50 }),
    fullBuild({ CPU: 'cpu-hi', GPU: 'gpu-hi', build_score: 90, total_price: 50 }),
    fullBuild({ CPU: 'cpu-mid', GPU: 'gpu-mid', build_score: 70, total_price: 50 }),
  ]);

  add('equal rounded score falls to total_price ASC', [
    fullBuild({ CPU: 'cpu-b', GPU: 'gpu-b', build_score: 50, total_price: 300 }),
    fullBuild({ CPU: 'cpu-a', GPU: 'gpu-a', build_score: 50, total_price: 200 }),
    fullBuild({ CPU: 'cpu-c', GPU: 'gpu-c', build_score: 50, total_price: 400 }),
  ]);

  add('equal score and price falls to signature ASC', [
    fullBuild({ CPU: 'cpu-b', GPU: 'gpu-b', build_score: 50, total_price: 100 }),
    fullBuild({ CPU: 'cpu-a', GPU: 'gpu-a', build_score: 50, total_price: 100 }),
  ]);

  add('87.494 and 87.4949 both round to 87.49 and tie on price', [
    fullBuild({ CPU: 'cpu-c', GPU: 'gpu-c', build_score: 87.494, total_price: 300 }),
    fullBuild({ CPU: 'cpu-a', GPU: 'gpu-a', build_score: 87.4949, total_price: 200 }),
  ]);

  add('87.495 rounds to 87.5 and orders above 87.494 regardless of price', [
    fullBuild({ CPU: 'cpu-low', GPU: 'gpu-low', build_score: 87.494, total_price: 999 }),
    fullBuild({ CPU: 'cpu-high', GPU: 'gpu-high', build_score: 87.495, total_price: 1 }),
  ]);

  add('rounded values are carried on the ranked entries', [
    fullBuild({ CPU: 'cpu-x', GPU: 'gpu-x', build_score: 87.495, total_price: 19.999 }),
  ]);

  add('omitted GPU keeps an empty GPU:: slot and sorts first on a tie', [
    fullBuild({ CPU: 'cpu-same', GPU: 'gpu-1', build_score: 50, total_price: 100 }),
    buildWithoutGpu({ CPU: 'cpu-same', build_score: 50, total_price: 100 }),
  ]);

  add('upper-case GPU id sorts before a lower-case one by code unit', [
    fullBuild({ CPU: 'cpu-same', GPU: 'gpu-a', build_score: 50, total_price: 100 }),
    fullBuild({ CPU: 'cpu-same', GPU: 'Z', build_score: 50, total_price: 100 }),
  ]);

  add('integration: orchestrator-shaped builds rank end-to-end', [
    fullBuild({
      CPU: 'cpu-X',
      MOTHERBOARD: 'mb-X',
      RAM: 'ram-X',
      GPU: 'gpu-X',
      PSU: 'psu-X',
      CASE: 'case-X',
      CPU_COOLER: 'cooler-X',
      SSD_BOOT: 'ssd-X',
      build_score: 95,
      total_price: 7500,
    }),
    fullBuild({
      CPU: 'cpu-Y',
      MOTHERBOARD: 'mb-Y',
      RAM: 'ram-Y',
      GPU: 'gpu-Y',
      PSU: 'psu-Y',
      CASE: 'case-Y',
      CPU_COOLER: 'cooler-Y',
      SSD_BOOT: 'ssd-Y',
      build_score: 95,
      total_price: 7000,
    }),
    fullBuild({
      CPU: 'cpu-Z',
      MOTHERBOARD: 'mb-Z',
      RAM: 'ram-Z',
      GPU: 'gpu-Z',
      PSU: 'psu-Z',
      CASE: 'case-Z',
      CPU_COOLER: 'cooler-Z',
      SSD_BOOT: 'ssd-Z',
      build_score: 88,
      total_price: 6000,
    }),
  ]);

  return scenarios;
}

function captureTopN() {
  const make = (count) =>
    Array.from({ length: count }, (_, index) =>
      fullBuild({
        CPU: 'cpu-' + index,
        GPU: 'gpu-' + index,
        build_score: 90 - index,
        total_price: 100 + index,
      })
    );

  const caps = [0, 1, 9, 10, 11, 25].map((count) => {
    const result = rank.rankBuilds({ builds: make(count) });
    return {
      builds: count,
      ranked_length: result.ranked.length,
      top_n_length: result.top_n.length,
      top_n_ranks: result.top_n.map((entry) => entry.rank),
    };
  });

  const ascending = Array.from({ length: 25 }, (_, index) =>
    fullBuild({
      CPU: 'cpu-' + index,
      GPU: 'gpu-' + index,
      build_score: 1 + index,
      total_price: 100 + index,
    })
  );
  const ascendingResult = rank.rankBuilds({ builds: ascending });

  return {
    caps,
    ascending_scores_top_n_cpus: ascendingResult.top_n.map((entry) => pairOf(entry).cpu),
    empty_result: summarizeRankedResult(rank.rankBuilds({ builds: [] })),
    empty_result_frozen: {
      result: Object.isFrozen(rank.rankBuilds({ builds: [] })),
      ranked: Object.isFrozen(rank.rankBuilds({ builds: [] }).ranked),
      top_n: Object.isFrozen(rank.rankBuilds({ builds: [] }).top_n),
    },
  };
}

function captureRankDeterminism() {
  const base = [
    fullBuild({ CPU: 'cpu-A', GPU: 'gpu-A', build_score: 90, total_price: 300 }),
    fullBuild({ CPU: 'cpu-B', GPU: 'gpu-B', build_score: 80, total_price: 100 }),
    fullBuild({ CPU: 'cpu-C', GPU: 'gpu-C', build_score: 80, total_price: 200 }),
    fullBuild({ CPU: 'cpu-D', GPU: 'gpu-D', build_score: 70, total_price: 150 }),
    fullBuild({ CPU: 'cpu-E', GPU: 'gpu-E', build_score: 60, total_price: 999 }),
  ];
  const project = (result) =>
    result.ranked.map((entry) => ({ rank: entry.rank, cpu: pairOf(entry).cpu }));
  const reference = project(rank.rankBuilds({ builds: base }));

  const permutations = [
    [4, 3, 2, 1, 0],
    [0, 4, 1, 3, 2],
    [2, 1, 0, 4, 3],
    [3, 0, 4, 1, 2],
  ].map((order) => ({
    order,
    output: project(rank.rankBuilds({ builds: order.map((index) => base[index]) })),
  }));

  return {
    reference,
    permutations,
    all_match_reference: permutations.every(
      (entry) => JSON.stringify(entry.output) === JSON.stringify(reference)
    ),
  };
}

function captureRankShape() {
  const builds = [fullBuild({ CPU: 'cpu-ref', GPU: 'gpu-ref', build_score: 90, total_price: 300 })];
  const result = rank.rankBuilds({ builds });
  const twelve = Array.from({ length: 12 }, (_, index) =>
    fullBuild({
      CPU: 'cpu-' + index,
      GPU: 'gpu-' + index,
      build_score: 90 - index,
      total_price: 100 + index,
    })
  );
  const large = rank.rankBuilds({ builds: twelve });

  return {
    entry_keys: Object.keys(result.ranked[0]),
    explanation_is_null: result.ranked[0].explanation === null,
    build_is_input_reference: result.ranked[0].build === builds[0],
    frozen: {
      result: Object.isFrozen(result),
      ranked: Object.isFrozen(result.ranked),
      top_n: Object.isFrozen(result.top_n),
      entry: Object.isFrozen(result.ranked[0]),
      top_n_entry: Object.isFrozen(large.top_n[0]),
    },
  };
}

function captureRankImmutability() {
  const builds = [
    fullBuild({ CPU: 'cpu-1', GPU: 'gpu-1', build_score: 90, total_price: 300 }),
    fullBuild({ CPU: 'cpu-2', GPU: 'gpu-2', build_score: 80, total_price: 200 }),
  ];
  const before = builds.map(summarizeBuild);
  rank.rankBuilds({ builds });
  const after = builds.map(summarizeBuild);
  return { before, after, unchanged: JSON.stringify(before) === JSON.stringify(after) };
}

function captureRankErrors() {
  return [
    {
      case: 'non-array builds',
      error: captureError(() => rank.rankBuilds({ builds: {} })),
    },
    {
      case: 'missing required build fields',
      error: captureError(() => rank.rankBuilds({ builds: [{}] })),
    },
    {
      case: 'duplicate build signature',
      error: captureError(() =>
        rank.rankBuilds({
          builds: [
            fullBuild({ CPU: 'cpu-same', GPU: 'gpu-same', build_score: 90, total_price: 100 }),
            fullBuild({ CPU: 'cpu-same', GPU: 'gpu-same', build_score: 80, total_price: 200 }),
          ],
        })
      ),
    },
    {
      case: 'build_score below range',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ build_score: -1 })] })),
    },
    {
      case: 'build_score above range',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ build_score: 100.1 })] })),
    },
    {
      case: 'build_score NaN',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ build_score: NaN })] })),
    },
    {
      case: 'build_score string',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ build_score: '50' })] })),
    },
    {
      case: 'build_score boundary 0 accepted',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ build_score: 0 })] })),
    },
    {
      case: 'build_score boundary 100 accepted',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ build_score: 100 })] })),
    },
    {
      case: 'total_price zero',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ total_price: 0 })] })),
    },
    {
      case: 'total_price negative',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ total_price: -1 })] })),
    },
    {
      case: 'total_price Infinity',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ total_price: Infinity })] })),
    },
    {
      case: 'currency lower case',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ currency: 'mad' })] })),
    },
    {
      case: 'currency four letters',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ currency: 'MAD1' })] })),
    },
    {
      case: 'currency too short',
      error: captureError(() => rank.rankBuilds({ builds: [fullBuild({ currency: 'M' })] })),
    },
    {
      case: 'currency absent',
      error: captureError(() => rank.rankBuilds({ builds: [rawBuild({ currency: undefined })] })),
    },
    {
      case: 'unknown_pairwise_count negative',
      error: captureError(() =>
        rank.rankBuilds({ builds: [fullBuild({ unknown_pairwise_count: -1 })] })
      ),
    },
    {
      case: 'unknown_pairwise_count fractional',
      error: captureError(() =>
        rank.rankBuilds({ builds: [fullBuild({ unknown_pairwise_count: 1.5 })] })
      ),
    },
    {
      case: 'unknown_pairwise_count absent',
      error: captureError(() =>
        rank.rankBuilds({ builds: [rawBuild({ unknown_pairwise_count: undefined })] })
      ),
    },
    {
      case: 'unknown_pairwise_count null',
      error: captureError(() =>
        rank.rankBuilds({ builds: [rawBuild({ unknown_pairwise_count: null })] })
      ),
    },
    {
      case: 'empty components array',
      error: captureError(() => rank.rankBuilds({ builds: [rawBuild({ components: [] })] })),
    },
    {
      case: 'duplicate component role',
      error: captureError(() =>
        rank.rankBuilds({
          builds: [
            rawBuild({
              components: [
                component('CPU', 'c1'),
                component('CPU', 'c2'),
                component('MOTHERBOARD', 'mb-1'),
              ],
            }),
          ],
        })
      ),
    },
    {
      case: 'unknown component role',
      error: captureError(() =>
        rank.rankBuilds({
          builds: [rawBuild({ components: [component('SSD_SECONDARY', 'sec')] })],
        })
      ),
    },
    {
      case: 'empty product_id',
      error: captureError(() =>
        rank.rankBuilds({
          builds: [rawBuild({ components: [component('CPU', '', { product_variant_id: null })] })],
        })
      ),
    },
    {
      case: 'non-string product_variant_id',
      error: captureError(() =>
        rank.rankBuilds({
          builds: [rawBuild({ components: [component('CPU', 'cpu-1', { product_variant_id: 5 })] })],
        })
      ),
    },
    {
      case: 'invalid component status',
      error: captureError(() =>
        rank.rankBuilds({
          builds: [rawBuild({ components: [component('CPU', 'cpu-1', { status: 'FAIL' })] })],
        })
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// 5. selectDiverseTop (Decision 20): the legacy pair-cap walk.
// ---------------------------------------------------------------------------

function captureDiverse() {
  const scenarios = [];
  const add = (label, args, extra = {}) => {
    scenarios.push({ case: label, ...extra, output: summarizeSelection(diverse.selectDiverseTop(args)) });
  };

  // 4 pairs x 4 builds; maxPerPair=3 and limit=10 both bite.
  const basicPairs = [
    ['cpu-A', 'gpu-A1'],
    ['cpu-B', 'gpu-B1'],
    ['cpu-C', 'gpu-C1'],
    ['cpu-D', 'gpu-D1'],
  ];
  const basicRanked = [];
  for (let p = 0; p < basicPairs.length; p += 1) {
    for (let b = 0; b < 4; b += 1) {
      const index = p * 4 + b;
      basicRanked.push(
        rankedEntry(
          fullBuild({
            CPU: basicPairs[p][0],
            GPU: basicPairs[p][1],
            build_score: 100 - index,
            total_price: 1000 + index,
          }),
          index + 1
        )
      );
    }
  }
  add('per-pair cap and limit', { ranked: basicRanked, limit: 10, maxPerPair: 3 }, { ranked_length: basicRanked.length });

  // Omitted-GPU entries share the 'OMITTED' pair value.
  const omittedRanked = [];
  for (let i = 0; i < 3; i += 1) {
    omittedRanked.push(
      rankedEntry(
        fullBuild({ CPU: 'cpu-shared', GPU: 'gpu-1', build_score: 100 - i, total_price: 1000 + i }),
        i + 1
      )
    );
  }
  for (let i = 0; i < 4; i += 1) {
    omittedRanked.push(
      rankedEntry(
        buildWithoutGpu({ CPU: 'cpu-shared', build_score: 90 - i, total_price: 800 + i }),
        i + 4
      )
    );
  }
  add(
    'omitted-GPU entries share one pair key and are capped',
    { ranked: omittedRanked, limit: 10, maxPerPair: 2 },
    { ranked_length: omittedRanked.length }
  );

  const orderRanked = Array.from({ length: 6 }, (_, index) =>
    rankedEntry(
      fullBuild({
        CPU: 'cpu-' + index,
        GPU: 'gpu-' + index,
        build_score: 100 - index,
        total_price: 1000 + index,
      }),
      index + 1
    )
  );
  add('rank order preserved in selection', { ranked: orderRanked, limit: 10, maxPerPair: 3 });

  const kLessThanLimitRanked = [];
  for (let i = 0; i < 5; i += 1) {
    kLessThanLimitRanked.push(
      rankedEntry(
        fullBuild({ CPU: 'cpu-A', GPU: 'gpu-A', build_score: 100 - i, total_price: 1000 + i }),
        i + 1
      )
    );
  }
  for (let i = 0; i < 4; i += 1) {
    kLessThanLimitRanked.push(
      rankedEntry(
        fullBuild({ CPU: 'cpu-B', GPU: 'gpu-B', build_score: 90 - i, total_price: 900 + i }),
        i + 6
      )
    );
  }
  add('k < limit when diversity is insufficient', {
    ranked: kLessThanLimitRanked,
    limit: 10,
    maxPerPair: 3,
  });

  const defaultRanked = Array.from({ length: 5 }, (_, index) =>
    rankedEntry(
      fullBuild({
        CPU: 'cpu-same',
        GPU: 'gpu-same',
        build_score: 100 - index,
        total_price: 1000 + index,
      }),
      index + 1
    )
  );
  add('defaults: maxPerPair 3', { ranked: defaultRanked });
  add('explicit maxPerPair 2', { ranked: defaultRanked, maxPerPair: 2 });
  add('explicit limit 2', { ranked: defaultRanked, limit: 2 });

  add('empty ranked array', { ranked: [], limit: 10, maxPerPair: 3 });
  add('absent arguments', {});

  const result = diverse.selectDiverseTop({ ranked: defaultRanked });
  return {
    scenarios,
    frozen: {
      result: Object.isFrozen(result),
      selected: Object.isFrozen(result.selected),
      entry: Object.isFrozen(result.selected[0]),
    },
    errors: [
      { case: 'non-array ranked', error: captureError(() => diverse.selectDiverseTop({ ranked: 'not-an-array' })) },
      { case: 'limit negative', error: captureError(() => diverse.selectDiverseTop({ ranked: defaultRanked, limit: -1 })) },
      { case: 'limit fractional', error: captureError(() => diverse.selectDiverseTop({ ranked: defaultRanked, limit: 1.5 })) },
      { case: 'limit string', error: captureError(() => diverse.selectDiverseTop({ ranked: defaultRanked, limit: '10' })) },
      { case: 'maxPerPair zero', error: captureError(() => diverse.selectDiverseTop({ ranked: defaultRanked, maxPerPair: 0 })) },
      { case: 'maxPerPair negative', error: captureError(() => diverse.selectDiverseTop({ ranked: defaultRanked, maxPerPair: -1 })) },
      { case: 'maxPerPair string', error: captureError(() => diverse.selectDiverseTop({ ranked: defaultRanked, maxPerPair: '3' })) },
      {
        case: 'ranked entry without a CPU component',
        error: captureError(() =>
          diverse.selectDiverseTop({
            ranked: [
              rankedEntry(
                deepFreeze({
                  components: [
                    component('MOTHERBOARD', 'mb-1'),
                    component('RAM', 'ram-1'),
                    component('GPU', 'gpu-1'),
                    component('PSU', 'psu-1'),
                    component('CASE', 'case-1'),
                    component('CPU_COOLER', 'cooler-1'),
                    component('SSD_BOOT', 'ssd-1'),
                  ],
                  build_score: 50,
                  total_price: 100,
                  currency: CURRENCY,
                  unknown_pairwise_count: 0,
                }),
                1
              ),
            ],
          })
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 6. selectArchetypes (E4 / Decision 41, Decision 58): strategy selection.
// ---------------------------------------------------------------------------

const ARCHETYPE_RANKED = () => [
  rankedEntry(fullBuild({ CPU: 'cpu-A', GPU: 'gpu-A1', build_score: 100, total_price: 1000 }), 1),
  rankedEntry(fullBuild({ CPU: 'cpu-B', GPU: 'gpu-B1', build_score: 90, total_price: 950 }), 2),
  rankedEntry(fullBuild({ CPU: 'cpu-C', GPU: 'gpu-C1', build_score: 80, total_price: 900 }), 3),
  rankedEntry(fullBuild({ CPU: 'cpu-D', GPU: 'gpu-D1', build_score: 70, total_price: 1200 }), 4),
];

const MONEY = (amount) => ({ amount, currency: CURRENCY });

function describeArchetypeArgs(args) {
  return {
    budget: args.budget === undefined ? 'ABSENT' : snapshot(args.budget),
    priority: args.priority === undefined ? 'ABSENT' : args.priority,
    archetype_objectives:
      args.archetypeObjectives === undefined ? 'ABSENT' : snapshot(args.archetypeObjectives),
  };
}

function captureArchetypePriorities() {
  const cases = [
    { case: 'priority ABSENT', args: { budget: MONEY(1000) } },
    { case: 'priority null', args: { budget: MONEY(1000), priority: null } },
    { case: 'priority 1', args: { budget: MONEY(1000), priority: 1 } },
    { case: 'priority 2', args: { budget: MONEY(1000), priority: 2 } },
    { case: 'priority 3', args: { budget: MONEY(1000), priority: 3 } },
    { case: 'priority 4', args: { budget: MONEY(1000), priority: 4 } },
    { case: 'priority 5', args: { budget: MONEY(1000), priority: 5 } },
  ];
  return cases.map((entry) => ({
    case: entry.case,
    input: describeArchetypeArgs(entry.args),
    output: summarizeArchetypes(
      archetypes.selectArchetypes({ ranked: ARCHETYPE_RANKED(), ...entry.args })
    ),
  }));
}

function captureArchetypeStrategies() {
  const floorRanked = [
    rankedEntry(fullBuild({ CPU: 'cpu-below', GPU: 'gpu-below', build_score: 90, total_price: 840 }), 1),
    rankedEntry(fullBuild({ CPU: 'cpu-at', GPU: 'gpu-at', build_score: 70, total_price: 850 }), 2),
    rankedEntry(fullBuild({ CPU: 'cpu-above', GPU: 'gpu-above', build_score: 50, total_price: 1200 }), 3),
  ];

  const valueTiePrice = [
    rankedEntry(fullBuild({ CPU: 'cpu-a', GPU: 'gpu-a', build_score: 100, total_price: 2000 }), 1),
    rankedEntry(fullBuild({ CPU: 'cpu-b', GPU: 'gpu-b', build_score: 50, total_price: 1000 }), 2),
  ];

  const valueTieSignature = [
    rankedEntry(fullBuild({ CPU: 'cpu-b', GPU: 'gpu-b', build_score: 50, total_price: 1000 }), 1),
    rankedEntry(fullBuild({ CPU: 'cpu-a', GPU: 'gpu-a', build_score: 50, total_price: 1000 }), 2),
  ];

  // cpu-X1 and cpu-X2 share a (CPU, GPU) pair; cpu-Y and cpu-Z are distinct.
  const pairRanked = [
    rankedEntry(fullBuild({ CPU: 'cpu-X', GPU: 'gpu-X', MOTHERBOARD: 'mb-1', build_score: 100, total_price: 1000 }), 1),
    rankedEntry(fullBuild({ CPU: 'cpu-X', GPU: 'gpu-X', MOTHERBOARD: 'mb-2', build_score: 90, total_price: 950 }), 2),
    rankedEntry(fullBuild({ CPU: 'cpu-Y', GPU: 'gpu-Y', build_score: 80, total_price: 900 }), 3),
    rankedEntry(fullBuild({ CPU: 'cpu-Z', GPU: 'gpu-Z', build_score: 70, total_price: 1200 }), 4),
  ];

  const single = [
    rankedEntry(fullBuild({ CPU: 'cpu-only', GPU: 'gpu-only', build_score: 80, total_price: 900 }), 1),
  ];

  const cases = [
    {
      case: 'PERFORMANCE floor: 0.84 excluded, exactly 0.85 eligible',
      ranked: floorRanked,
      args: { budget: MONEY(1000), priority: 4 },
      spend_shares: floorRanked.map((entry) => ({
        cpu: pairOf(entry).cpu,
        spend_share: entry.total_price / 1000,
      })),
    },
    {
      case: 'BALANCED picks the highest score overall',
      ranked: ARCHETYPE_RANKED(),
      args: { budget: MONEY(1000), priority: 3 },
    },
    {
      case: 'VALUE ties on score per MAD and prefers the cheaper build',
      ranked: valueTiePrice,
      args: { budget: MONEY(1000), priority: 1 },
    },
    {
      case: 'VALUE ties on score per MAD and price, then signature ASC',
      ranked: valueTieSignature,
      args: { budget: MONEY(1000), priority: 1 },
    },
    {
      case: 'one strategy per (CPU, GPU) pair: a claimed pair is skipped',
      ranked: pairRanked,
      args: { budget: MONEY(1000) },
    },
    {
      case: 'degradation: a single build yields one archetype and two reason codes',
      ranked: single,
      args: { budget: MONEY(1000) },
    },
    {
      case: 'degradation: empty ranked yields EMPTY_RANKED',
      ranked: [],
      args: { budget: MONEY(1000) },
    },
  ];

  return cases.map((entry) => ({
    case: entry.case,
    input: describeArchetypeArgs(entry.args),
    ...(entry.spend_shares === undefined ? {} : { spend_shares: entry.spend_shares }),
    output: summarizeArchetypes(
      archetypes.selectArchetypes({ ranked: entry.ranked, ...entry.args })
    ),
  }));
}

function captureArchetypeObjectives() {
  const cases = [
    {
      case: 'objectives reorder under neutral priority null',
      args: { budget: MONEY(1000), priority: null, archetypeObjectives: { VALUE: 1 } },
    },
    {
      case: 'objectives reorder under neutral priority 3',
      args: { budget: MONEY(1000), priority: 3, archetypeObjectives: { PERFORMANCE: 2, BALANCED: 1 } },
    },
    {
      case: 'explicit priority 4 outranks the objectives',
      args: { budget: MONEY(1000), priority: 4, archetypeObjectives: { VALUE: 1 } },
    },
    {
      case: 'explicit priority 1 outranks the objectives',
      args: { budget: MONEY(1000), priority: 1, archetypeObjectives: { PERFORMANCE: 5 } },
    },
    {
      case: 'equal weights fall back to the base order position',
      args: {
        budget: MONEY(1000),
        priority: 3,
        archetypeObjectives: { VALUE: 1, BALANCED: 1, PERFORMANCE: 1 },
      },
    },
    {
      case: 'partial objectives treat an absent strategy as weight 0',
      args: { budget: MONEY(1000), priority: null, archetypeObjectives: { VALUE: 0.5 } },
    },
  ];

  return cases.map((entry) => ({
    case: entry.case,
    input: describeArchetypeArgs(entry.args),
    output: summarizeArchetypes(
      archetypes.selectArchetypes({ ranked: ARCHETYPE_RANKED(), ...entry.args })
    ),
  }));
}

function captureArchetypeShape() {
  const result = archetypes.selectArchetypes({ ranked: ARCHETYPE_RANKED(), budget: MONEY(1000) });
  return {
    archetype_keys: Object.keys(result.archetypes[0]),
    frozen: {
      result: Object.isFrozen(result),
      archetypes: Object.isFrozen(result.archetypes),
      entry: Object.isFrozen(result.archetypes[0]),
      reason_codes: Object.isFrozen(result.reason_codes),
    },
    persisted_ranks: result.archetypes.map((entry) => entry.persisted_rank),
  };
}

function captureArchetypeErrors() {
  const ranked = ARCHETYPE_RANKED();
  return [
    { case: 'budget absent', error: captureError(() => archetypes.selectArchetypes({ ranked })) },
    { case: 'budget null', error: captureError(() => archetypes.selectArchetypes({ ranked, budget: null })) },
    {
      case: 'budget.amount zero',
      error: captureError(() => archetypes.selectArchetypes({ ranked, budget: MONEY(0) })),
    },
    {
      case: 'budget.amount negative',
      error: captureError(() => archetypes.selectArchetypes({ ranked, budget: MONEY(-1) })),
    },
    {
      case: 'budget.amount string',
      error: captureError(() => archetypes.selectArchetypes({ ranked, budget: MONEY('1000') })),
    },
    { case: 'budget without an amount', error: captureError(() => archetypes.selectArchetypes({ ranked, budget: {} })) },
    {
      case: 'ranked non-array',
      error: captureError(() => archetypes.selectArchetypes({ ranked: 'not-an-array', budget: MONEY(1000) })),
    },
    {
      case: 'priority 0',
      error: captureError(() => archetypes.selectArchetypes({ ranked, budget: MONEY(1000), priority: 0 })),
    },
    {
      case: 'priority 6',
      error: captureError(() => archetypes.selectArchetypes({ ranked, budget: MONEY(1000), priority: 6 })),
    },
    {
      case: 'priority fractional',
      error: captureError(() => archetypes.selectArchetypes({ ranked, budget: MONEY(1000), priority: 1.5 })),
    },
    {
      case: 'priority string',
      error: captureError(() => archetypes.selectArchetypes({ ranked, budget: MONEY(1000), priority: '3' })),
    },
    {
      case: 'unknown objective strategy',
      error: captureError(() =>
        archetypes.selectArchetypes({ ranked, budget: MONEY(1000), archetypeObjectives: { ULTRABOOK: 1 } })
      ),
    },
    {
      case: 'negative objective weight',
      error: captureError(() =>
        archetypes.selectArchetypes({ ranked, budget: MONEY(1000), archetypeObjectives: { VALUE: -1 } })
      ),
    },
    {
      case: 'zero-sum objectives',
      error: captureError(() =>
        archetypes.selectArchetypes({ ranked, budget: MONEY(1000), archetypeObjectives: {} })
      ),
    },
    {
      case: 'objectives as an array',
      error: captureError(() =>
        archetypes.selectArchetypes({ ranked, budget: MONEY(1000), archetypeObjectives: [] })
      ),
    },
    {
      case: 'objective weight NaN',
      error: captureError(() =>
        archetypes.selectArchetypes({ ranked, budget: MONEY(1000), archetypeObjectives: { VALUE: NaN } })
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// 7. The composed pipeline over one fixed 11-build set.
// ---------------------------------------------------------------------------

function capturePipeline() {
  const builds = [
    fullBuild({ CPU: 'cpu-A', GPU: 'gpu-A1', build_score: 90, total_price: 1000 }),
    fullBuild({ CPU: 'cpu-A', GPU: 'gpu-A2', build_score: 85, total_price: 950 }),
    fullBuild({ CPU: 'cpu-A', GPU: 'gpu-A3', build_score: 80, total_price: 900 }),
    fullBuild({ CPU: 'cpu-B', GPU: 'gpu-B1', build_score: 88, total_price: 1100 }),
    fullBuild({ CPU: 'cpu-B', GPU: 'gpu-B2', build_score: 82, total_price: 1050 }),
    fullBuild({ CPU: 'cpu-B', GPU: 'gpu-B3', build_score: 78, total_price: 1000 }),
    fullBuild({ CPU: 'cpu-C', GPU: 'gpu-C1', build_score: 86, total_price: 1200 }),
    fullBuild({ CPU: 'cpu-C', GPU: 'gpu-C2', build_score: 81, total_price: 1150 }),
    fullBuild({ CPU: 'cpu-C', GPU: 'gpu-C3', build_score: 76, total_price: 1100 }),
    fullBuild({ CPU: 'cpu-D', GPU: 'gpu-D1', build_score: 70, total_price: 800 }),
    fullBuild({ CPU: 'cpu-D', GPU: 'gpu-D2', build_score: 65, total_price: 750 }),
  ];
  const ranked = rank.rankBuilds({ builds });

  return {
    input_builds: builds.map(summarizeBuild),
    ranked: summarizeRankedResult(ranked),
    diverse: summarizeSelection(
      diverse.selectDiverseTop({ ranked: ranked.ranked, limit: 10, maxPerPair: 3 })
    ),
    archetypes: summarizeArchetypes(
      archetypes.selectArchetypes({ ranked: ranked.ranked, budget: MONEY(1000), priority: null })
    ),
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
    command: 'node scripts/characterize-pr4.js',
    origin:
      'Captured from the PRE-MOVE implementation under src/recommendation/ranking/ ' +
      'before any module moved into packages/recommendation-core. The committed ' +
      'document is the baseline: do not regenerate it from the extracted code, ' +
      'because a fixture produced by the implementation under test proves nothing.',
  };
}

function buildDocument() {
  return {
    kind: 'pr4-characterization',
    description:
      'Frozen input/output pairs for the PR 4 extraction surface: the ranking ' +
      'barrel contract, round2 and the build signature, the derived ' +
      'compatibility status, rankBuilds ordering and its top-N cap, ' +
      'selectDiverseTop pair-cap selection and selectArchetypes strategy ' +
      'selection (including Decision 58 objectives), plus one composed ' +
      'pipeline over a fixed 11-build set. DB-free: every build is assembled ' +
      'from literals.',
    timestamp_policy:
      'No ambient clock is read while capturing: every id, score and price is ' +
      'an input literal, so the document is byte-stable on its baseline commit. ' +
      'String order is recorded by code unit; nothing here reads a locale.',
    provenance: provenance(),
    barrel: captureBarrel(),
    round2: captureRound2(),
    signature: captureSignature(),
    derive_status: captureDeriveStatus(),
    rank: {
      scenarios: captureRankScenarios(),
      top_n: captureTopN(),
      determinism: captureRankDeterminism(),
      shape: captureRankShape(),
      immutability: captureRankImmutability(),
      errors: captureRankErrors(),
    },
    diverse: captureDiverse(),
    archetypes: {
      priorities: captureArchetypePriorities(),
      strategies: captureArchetypeStrategies(),
      objectives: captureArchetypeObjectives(),
      shape: captureArchetypeShape(),
      errors: captureArchetypeErrors(),
    },
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
    process.stderr.write('characterize-pr4: ' + options.errors.join('\n  ') + '\n');
    process.stderr.write('usage: node scripts/characterize-pr4.js [--check] [--fixture=<path>]\n');
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
          'characterize-pr4: no committed fixture at ' + source +
          '; --check compares the committed baseline and never writes one\n'
        );
        return 1;
      }
    } else {
      if (!fs.existsSync(outFile)) {
        process.stderr.write(
          'characterize-pr4: no fixture at ' + source +
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
      process.stderr.write('characterize-pr4: ' + source + ' is not valid JSON: ' + err.message + '\n');
      return 1;
    }
    const captured = (doc) => {
      const { provenance: _provenance, ...behaviour } = doc;
      return JSON.stringify(behaviour, null, 2);
    };
    if (captured(existing) !== captured(document)) {
      process.stderr.write(
        'characterize-pr4: the captured behaviour no longer matches the pre-move baseline (' +
        source + ')\n'
      );
      return 1;
    }
    // Behaviour only. Where the fixture came from is proven by
    // scripts/verify-pr2-provenance.js, which this line must not imply.
    process.stdout.write(
      'characterize-pr4: OK - behaviour matches the pre-move baseline (' + source + '); ' +
      'fixture origin is not checked here (see verify-pr2-provenance)\n'
    );
    return 0;
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, serialized);
  process.stdout.write(
    'characterize-pr4: wrote ' + displayPath(outFile) + ' (' + serialized.length + ' bytes)\n'
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
