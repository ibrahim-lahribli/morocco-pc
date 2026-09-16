'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { assembleBuilds, EXPANSION_ORDER } = require('./assemble');
const { priceKey, validatePrices } = require('./prices');
const { validateEngine3Input } = require('./input');
const { ROLE_CATEGORIES, COMPONENT_ROLES } = require('../candidates/roles');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const STORE_A = '11111111-1111-4111-8111-111111111111';
const TS = '2026-09-14T00:00:00.000Z';

const CATEGORY_FOR = {
  CPU: 'CPU',
  MOTHERBOARD: 'MOTHERBOARD',
  RAM: 'MEMORY',
  GPU: 'GPU',
  PSU: 'PSU',
  CASE: 'CASE',
  CPU_COOLER: 'COOLER',
  SSD_BOOT: 'STORAGE',
  SSD_SECONDARY: 'STORAGE',
};

function verdict(role, productId, overrides = {}) {
  const defVariant = role === 'GPU' ? `${productId}-var` : null;
  return {
    product_id: productId,
    product_variant_id:
      overrides.product_variant_id !== undefined ? overrides.product_variant_id : defVariant,
    category: overrides.category !== undefined ? overrides.category : CATEGORY_FOR[role],
    component_role: role,
    status: overrides.status || 'PASS',
    reason: overrides.reason !== undefined ? overrides.reason : null,
    relationships: overrides.relationships !== undefined ? overrides.relationships : {},
  };
}

function carrierFor(verdicts, priceById = {}) {
  const raw = Object.create(null);
  for (const v of verdicts) {
    const key = priceKey(v.product_id, v.product_variant_id, v.component_role);
    const price =
      typeof priceById === 'function'
        ? priceById(v)
        : Object.prototype.hasOwnProperty.call(priceById, v.product_id)
          ? priceById[v.product_id]
          : 100;
    Object.defineProperty(raw, key, {
      value: {
        selected_price: price,
        currency: 'MAD',
        store_id: STORE_A,
        price_checked_at: TS,
      },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return validatePrices(raw);
}

function engineInput({
  results,
  budget = 100000,
  currency = 'MAD',
  useCase = 'office',
  gpuRequired = ['gaming'],
  integrated = null,
  topK = 5,
  maxBuilds = 10,
  priceById = {},
  requiredRoles = ['CPU', 'MOTHERBOARD', 'RAM', 'GPU', 'PSU', 'CASE', 'CPU_COOLER', 'SSD_BOOT'],
  prices: explicitPrices = null,
}) {
  // Default walk is OPTIONAL: grant every CPU verdict an integrated GPU flag
  // unless the caller says otherwise explicitly (null = auto, {} = REQUIRED).
  const integratedMap =
    integrated !== null
      ? integrated
      : Object.fromEntries(
          results
            .filter((v) => v && v.component_role === 'CPU' && typeof v.product_id === 'string')
            .map((v) => [v.product_id, true])
        );
  return {
    results,
    budget_amount: budget,
    currency,
    required_roles: requiredRoles,
    use_case: useCase,
    gpu_required_use_cases: gpuRequired,
    integrated_gpu_present: integratedMap,
    candidate_caps: { top_k_per_role: topK, max_builds_per_query: maxBuilds },
    prices: explicitPrices || carrierFor(results, priceById),
  };
}

/** One eligible verdict per participating role (no GPU unless asked). */
function fullSet(prefix = 'p', { gpu = false, status = 'PASS' } = {}) {
  const list = [
    verdict('CPU', `${prefix}-cpu`, { status }),
    verdict('MOTHERBOARD', `${prefix}-mb`, { status }),
    verdict('RAM', `${prefix}-ram`, { status }),
  ];
  if (gpu) list.push(verdict('GPU', `${prefix}-gpu`, { status }));
  list.push(
    verdict('PSU', `${prefix}-psu`, { status }),
    verdict('CASE', `${prefix}-case`, { status }),
    verdict('CPU_COOLER', `${prefix}-cooler`, { status }),
    verdict('SSD_BOOT', `${prefix}-ssd`, { status })
  );
  return list;
}

function rolesOf(build) {
  return build.components.map((c) => c.component_role);
}

function idsOf(build) {
  const out = {};
  for (const c of build.components) out[c.component_role] = c.product_id;
  return out;
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

test('PASS verdicts enter expansion', () => {
  const results = fullSet('a');
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'a-cpu': true } })
  );
  assert.equal(out.builds.length, 1);
  assert.deepEqual(rolesOf(out.builds[0]), [
    'CPU',
    'MOTHERBOARD',
    'RAM',
    'PSU',
    'CASE',
    'CPU_COOLER',
    'SSD_BOOT',
  ]);
});

test('UNKNOWN verdicts stay eligible with no demotion', () => {
  const results = fullSet('a', { status: 'UNKNOWN' });
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'a-cpu': true } })
  );
  assert.equal(out.builds.length, 1);
  for (const c of out.builds[0].components) {
    assert.equal(c.status, 'UNKNOWN');
  }
});

test('UNKNOWN and PASS interleave in incoming order without preference', () => {
  const uCpu = verdict('CPU', 'cpu-u', { status: 'UNKNOWN' });
  const pCpu = verdict('CPU', 'cpu-p', { status: 'PASS' });
  const rest = fullSet('a').filter((v) => v.component_role !== 'CPU');
  const results = [uCpu, pCpu, ...rest];
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'cpu-u': true, 'cpu-p': true }, maxBuilds: 10 })
  );
  assert.equal(out.builds.length, 2);
  assert.equal(out.builds[0].components[0].product_id, 'cpu-u');
  assert.equal(out.builds[0].components[0].status, 'UNKNOWN');
  assert.equal(out.builds[1].components[0].product_id, 'cpu-p');
  assert.equal(out.builds[1].components[0].status, 'PASS');
});

test('REJECT verdicts never enter expansion', () => {
  const good = fullSet('a');
  const badCpu = verdict('CPU', 'cpu-bad', { status: 'REJECT' });
  const badMb = verdict('MOTHERBOARD', 'mb-bad', { status: 'REJECT' });
  const results = [...good, badCpu, badMb];
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'a-cpu': true } })
  );
  assert.equal(out.builds.length, 1);
  for (const c of out.builds[0].components) {
    assert.notEqual(c.product_id, 'cpu-bad');
    assert.notEqual(c.product_id, 'mb-bad');
    assert.ok(c.status === 'PASS' || c.status === 'UNKNOWN');
  }
});

test('all REJECT for one required role yields zero builds, still frozen', () => {
  const results = fullSet('a').map((v) =>
    v.component_role === 'PSU' ? verdict('PSU', 'psu-bad', { status: 'REJECT' }) : v
  );
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'a-cpu': true } })
  );
  assert.deepEqual(out, { builds: [] });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.builds));
});

test('zero eligible verdicts yields frozen empty output', () => {
  const out = assembleBuilds(engineInput({ results: [], prices: validatePrices(Object.create(null)) }));
  assert.deepEqual(out, { builds: [] });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.builds));
});

test('unknown verdict states throw instead of becoming eligible', () => {
  const results = fullSet('a');
  results[0] = verdict('CPU', 'a-cpu', { status: 'FAIL' });
  assert.throws(
    () => assembleBuilds(engineInput({ results, integrated: {} })),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.INVALID_CANDIDATE
  );
  const results2 = fullSet('a');
  results2[1] = verdict('MOTHERBOARD', 'a-mb', { status: 'pass' });
  assert.throws(
    () => assembleBuilds(engineInput({ results: results2, integrated: {} })),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.INVALID_CANDIDATE
  );
});

test('all eight participating roles group correctly; extras ignored', () => {
  const results = [
    ...fullSet('a', { gpu: true }),
    verdict('SSD_SECONDARY', 'sec-1'),
    verdict('SSD_SECONDARY', 'sec-2'),
  ];
  const out = assembleBuilds(
    engineInput({
      results,
      useCase: 'gaming',
      gpuRequired: ['gaming'],
      integrated: { 'a-cpu': true },
    })
  );
  assert.equal(out.builds.length, 1);
  assert.deepEqual(rolesOf(out.builds[0]), [
    'CPU',
    'MOTHERBOARD',
    'RAM',
    'GPU',
    'PSU',
    'CASE',
    'CPU_COOLER',
    'SSD_BOOT',
  ]);
});

test('incoming order inside each bucket is preserved (no ordering)', () => {
  const results = [
    verdict('CPU', 'cpu-2'),
    verdict('CPU', 'cpu-1'),
    verdict('MOTHERBOARD', 'mb-b'),
    verdict('MOTHERBOARD', 'mb-a'),
    ...fullSet('a').filter(
      (v) => v.component_role !== 'CPU' && v.component_role !== 'MOTHERBOARD'
    ),
  ];
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'cpu-2': true, 'cpu-1': true }, maxBuilds: 10 })
  );
  const seen = out.builds.map((b) => `${idsOf(b).CPU}/${idsOf(b).MOTHERBOARD}`);
  assert.deepEqual(seen.slice(0, 4), ['cpu-2/mb-b', 'cpu-2/mb-a', 'cpu-1/mb-b', 'cpu-1/mb-a']);
});

test('declaration order of the role vocabulary does not drive traversal', () => {
  assert.deepEqual([...COMPONENT_ROLES], [
    'CPU',
    'GPU',
    'MOTHERBOARD',
    'RAM',
    'SSD_BOOT',
    'SSD_SECONDARY',
    'PSU',
    'CASE',
    'CPU_COOLER',
  ]);
  assert.deepEqual([...EXPANSION_ORDER], [
    'CPU',
    'MOTHERBOARD',
    'RAM',
    'GPU',
    'PSU',
    'CASE',
    'CPU_COOLER',
    'SSD_BOOT',
  ]);
  // Shuffled verdict input still walks EXPANSION_ORDER first (CPU major).
  const results = [
    verdict('SSD_BOOT', 's1'),
    verdict('CPU_COOLER', 'c1'),
    verdict('CASE', 'k1'),
    verdict('PSU', 'p1'),
    verdict('RAM', 'r2'),
    verdict('RAM', 'r1'),
    verdict('MOTHERBOARD', 'm2'),
    verdict('MOTHERBOARD', 'm1'),
    verdict('CPU', 'cpu2'),
    verdict('CPU', 'cpu1'),
  ];
  const out = assembleBuilds(
    engineInput({ results, integrated: { cpu2: true, cpu1: true }, maxBuilds: 20 })
  );
  assert.equal(out.builds.length, 8);
  assert.deepEqual(
    out.builds.map((b) => idsOf(b).CPU),
    ['cpu2', 'cpu2', 'cpu2', 'cpu2', 'cpu1', 'cpu1', 'cpu1', 'cpu1']
  );
  assert.deepEqual(
    out.builds.map((b) => `${idsOf(b).MOTHERBOARD}/${idsOf(b).RAM}`),
    ['m2/r2', 'm2/r1', 'm1/r2', 'm1/r1', 'm2/r2', 'm2/r1', 'm1/r2', 'm1/r1']
  );
});

test('complete builds carry exactly one verdict per singular role', () => {
  const results = fullSet('a', { gpu: true });
  const out = assembleBuilds(
    engineInput({
      results,
      useCase: 'gaming',
      gpuRequired: ['gaming'],
      integrated: { 'a-cpu': false },
    })
  );
  assert.equal(out.builds.length, 1);
  const build = out.builds[0];
  assert.equal(build.components.length, 8);
  const counts = {};
  for (const c of build.components) counts[c.component_role] = (counts[c.component_role] || 0) + 1;
  assert.deepEqual(counts, {
    CPU: 1,
    MOTHERBOARD: 1,
    RAM: 1,
    GPU: 1,
    PSU: 1,
    CASE: 1,
    CPU_COOLER: 1,
    SSD_BOOT: 1,
  });
  assert.ok(!('SSD_SECONDARY' in counts));
});

test('omit-GPU builds carry seven components and keep non-GPU order', () => {
  const results = fullSet('a');
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'a-cpu': true } })
  );
  assert.equal(out.builds.length, 1);
  assert.equal(out.builds[0].components.length, 7);
  assert.deepEqual(rolesOf(out.builds[0]), [
    'CPU',
    'MOTHERBOARD',
    'RAM',
    'PSU',
    'CASE',
    'CPU_COOLER',
    'SSD_BOOT',
  ]);
});

test('single RAM entry stays one opaque component; incomplete paths vanish', () => {
  const results = [
    verdict('CPU', 'cpu-1'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('RAM', 'ram-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    // SSD_BOOT absent on purpose: no complete build may appear.
  ];
  const out = assembleBuilds(engineInput({ results, integrated: {} }));
  assert.deepEqual(out, { builds: [] });
});

test('REQUIRED walks every GPU verdict with no omit path', () => {
  const results = [
    ...fullSet('a'),
    verdict('GPU', 'gpu-a'),
    verdict('GPU', 'gpu-b'),
  ];
  const out = assembleBuilds(
    engineInput({
      results,
      useCase: 'gaming',
      gpuRequired: ['gaming'],
      integrated: { 'a-cpu': true },
    })
  );
  assert.equal(out.builds.length, 2);
  assert.equal(idsOf(out.builds[0]).GPU, 'gpu-a');
  assert.equal(idsOf(out.builds[1]).GPU, 'gpu-b');
  for (const b of out.builds) assert.equal(b.components.length, 8);
});

test('REQUIRED with an empty GPU bucket yields zero builds for the branch', () => {
  const results = fullSet('a');
  const out = assembleBuilds(
    engineInput({
      results,
      useCase: 'gaming',
      gpuRequired: ['gaming'],
      integrated: { 'a-cpu': false },
    })
  );
  assert.deepEqual(out, { builds: [] });
});

test('REQUIRED with mixed CPUs walks GPU paths for every CPU branch', () => {
  const results = [
    verdict('CPU', 'cpu-1'),
    verdict('CPU', 'cpu-2'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('RAM', 'ram-1'),
    verdict('GPU', 'gpu-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  // The GPU bucket is global, so REQUIRED walks the GPU path under each CPU;
  // the key assertion is that no omit path is ever emitted.
  const out = assembleBuilds(
    engineInput({
      results,
      useCase: 'gaming',
      gpuRequired: ['gaming'],
      integrated: {},
      maxBuilds: 10,
    })
  );
  assert.equal(out.builds.length, 2);
  for (const b of out.builds) {
    assert.ok(idsOf(b).GPU === 'gpu-1');
    assert.equal(b.components.length, 8);
  }
});

test('OPTIONAL walks GPU verdicts first, then exactly one omit path', () => {
  const results = [
    ...fullSet('a'),
    verdict('GPU', 'gpu-a'),
    verdict('GPU', 'gpu-b'),
  ];
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'a-cpu': true }, maxBuilds: 10 })
  );
  assert.equal(out.builds.length, 3);
  assert.equal(idsOf(out.builds[0]).GPU, 'gpu-a');
  assert.equal(idsOf(out.builds[1]).GPU, 'gpu-b');
  assert.ok(!('GPU' in idsOf(out.builds[2])));
  assert.equal(out.builds[2].components.length, 7);
  assert.deepEqual(rolesOf(out.builds[2]), [
    'CPU',
    'MOTHERBOARD',
    'RAM',
    'PSU',
    'CASE',
    'CPU_COOLER',
    'SSD_BOOT',
  ]);
});

test('OPTIONAL omit path can still complete when it fits the limit', () => {
  const results = fullSet('a');
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'a-cpu': true }, budget: 700 })
  );
  assert.equal(out.builds.length, 1);
  assert.ok(!('GPU' in idsOf(out.builds[0])));
});

test('required use-case plus integrated GPU still walks REQUIRED (Step 3 precedence)', () => {
  const results = [...fullSet('a'), verdict('GPU', 'gpu-a')];
  const out = assembleBuilds(
    engineInput({
      results,
      useCase: 'gaming',
      gpuRequired: ['gaming'],
      integrated: { 'a-cpu': true },
      maxBuilds: 10,
    })
  );
  assert.equal(out.builds.length, 1);
  assert.equal(idsOf(out.builds[0]).GPU, 'gpu-a');
});

test('GPU verdict choice follows the active CPU product id', () => {
  const results = [
    verdict('CPU', 'cpu-igpu'),
    verdict('CPU', 'cpu-dgpu'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('RAM', 'ram-1'),
    verdict('GPU', 'gpu-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  const out = assembleBuilds(
    engineInput({
      results,
      integrated: { 'cpu-igpu': true },
      maxBuilds: 10,
    })
  );
  // cpu-igpu branch: gpu-1 then omit; cpu-dgpu branch: gpu-1 only.
  assert.equal(out.builds.length, 3);
  assert.deepEqual(
    out.builds.map((b) => `${idsOf(b).CPU}/${idsOf(b).GPU || 'omit'}`),
    ['cpu-igpu/gpu-1', 'cpu-igpu/omit', 'cpu-dgpu/gpu-1']
  );
});

test('variant identity violations throw before expansion', () => {
  const badGpu = fullSet('a', { gpu: true });
  badGpu.find((v) => v.component_role === 'GPU').product_variant_id = null;
  assert.throws(
    () =>
      assembleBuilds(
        engineInput({
          results: badGpu,
          useCase: 'gaming',
          gpuRequired: ['gaming'],
          integrated: {},
        })
      ),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.INVALID_CANDIDATE
  );
  const badCpu = fullSet('a');
  badCpu.find((v) => v.component_role === 'CPU').product_variant_id = 'var-x';
  assert.throws(
    () => assembleBuilds(engineInput({ results: badCpu })),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.INVALID_CANDIDATE
  );
});

test('role/category mismatch throws', () => {
  const results = fullSet('a');
  results.find((v) => v.component_role === 'RAM').category = 'CPU';
  assert.throws(
    () => assembleBuilds(engineInput({ results })),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.ROLE_CATEGORY_MISMATCH
  );
});

test('unknown roles throw; missing verdict fields throw', () => {
  const badRole = fullSet('a');
  badRole[0] = { ...badRole[0], component_role: 'COOLER_X' };
  assert.throws(
    () => assembleBuilds(engineInput({ results: badRole })),
    (e) =>
      e instanceof CandidateSelectionError &&
      (e.code === ERROR_CODES.INVALID_COMPONENT_ROLE || e.code === ERROR_CODES.INVALID_CANDIDATE)
  );
  const missingField = fullSet('a').map((v) => ({ ...v }));
  delete missingField[0].product_id;
  assert.throws(
    () => assembleBuilds(engineInput({ results: missingField })),
    (e) =>
      e instanceof CandidateSelectionError &&
      e.code === ERROR_CODES.MISSING_REQUIRED_FIELD
  );
});

test('exact DFS discovery order across every role', () => {
  const results = [
    verdict('CPU', 'cpu-1'),
    verdict('CPU', 'cpu-2'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('MOTHERBOARD', 'mb-2'),
    verdict('RAM', 'ram-1'),
    verdict('RAM', 'ram-2'),
    verdict('GPU', 'gpu-1'),
    verdict('PSU', 'psu-1'),
    verdict('PSU', 'psu-2'),
    verdict('CASE', 'case-1'),
    verdict('CASE', 'case-2'),
    verdict('CPU_COOLER', 'cool-1'),
    verdict('CPU_COOLER', 'cool-2'),
    verdict('SSD_BOOT', 'ssd-1'),
    verdict('SSD_BOOT', 'ssd-2'),
  ];
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'cpu-1': true, 'cpu-2': true }, maxBuilds: 300 })
  );
  // 2*2*2*(1 gpu + 1 omit)*2*2*2*2 = 256 builds; check the head sequence.
  assert.equal(out.builds.length, 256);
  const sig = (b) =>
    [
      idsOf(b).CPU,
      idsOf(b).MOTHERBOARD,
      idsOf(b).RAM,
      idsOf(b).GPU || 'omit',
      idsOf(b).PSU,
      idsOf(b).CASE,
      idsOf(b).CPU_COOLER,
      idsOf(b).SSD_BOOT,
    ].join('|');
  assert.equal(
    sig(out.builds[0]),
    'cpu-1|mb-1|ram-1|gpu-1|psu-1|case-1|cool-1|ssd-1'
  );
  assert.equal(
    sig(out.builds[1]),
    'cpu-1|mb-1|ram-1|gpu-1|psu-1|case-1|cool-1|ssd-2'
  );
  assert.equal(
    sig(out.builds[2]),
    'cpu-1|mb-1|ram-1|gpu-1|psu-1|case-1|cool-2|ssd-1'
  );
  // GPU branch fully precedes the omit branch for the same prefix.
  const prefix = out.builds
    .map((b) => `${idsOf(b).CPU}/${idsOf(b).MOTHERBOARD}/${idsOf(b).RAM}`)
    .indexOf('cpu-1/mb-1/ram-1');
  assert.equal(prefix, 0);
  const firstOmit = out.builds.findIndex(
    (b) =>
      idsOf(b).CPU === 'cpu-1' &&
      idsOf(b).MOTHERBOARD === 'mb-1' &&
      idsOf(b).RAM === 'ram-1' &&
      !('GPU' in idsOf(b))
  );
  assert.equal(firstOmit, 16);
  assert.equal(sig(out.builds[firstOmit]), 'cpu-1|mb-1|ram-1|omit|psu-1|case-1|cool-1|ssd-1');
});

test('budget equality at the final role still completes', () => {
  const results = fullSet('a');
  const priceById = {
    'a-cpu': 100,
    'a-mb': 100,
    'a-ram': 100,
    'a-psu': 100,
    'a-case': 100,
    'a-cooler': 100,
    'a-ssd': 100,
  };
  const out = assembleBuilds(
    engineInput({ results, budget: 700, integrated: { 'a-cpu': true }, priceById })
  );
  assert.equal(out.builds.length, 1);
  assert.equal(out.builds[0].total_price, 700);
});

test('over-budget choice prunes only its own branch; siblings walk on', () => {
  const results = [
    verdict('CPU', 'cpu-cheap'),
    verdict('CPU', 'cpu-dear'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('RAM', 'ram-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  const priceById = (v) => {
    if (v.product_id === 'cpu-dear') return 9000;
    return 100;
  };
  const out = assembleBuilds(
    engineInput({
      results,
      budget: 1000,
      integrated: { 'cpu-cheap': true, 'cpu-dear': true },
      priceById,
      maxBuilds: 10,
    })
  );
  assert.equal(out.builds.length, 1);
  assert.equal(idsOf(out.builds[0]).CPU, 'cpu-cheap');
});

test('cheaper later verdict is still considered (no ordering by price)', () => {
  const results = [
    verdict('CPU', 'cpu-dear'),
    verdict('CPU', 'cpu-cheap'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('RAM', 'ram-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  const priceById = (v) => (v.product_id === 'cpu-dear' ? 9000 : 100);
  const out = assembleBuilds(
    engineInput({ results, budget: 1000, integrated: { 'cpu-cheap': true, 'cpu-dear': true }, priceById, maxBuilds: 10 })
  );
  assert.equal(out.builds.length, 1);
  assert.equal(idsOf(out.builds[0]).CPU, 'cpu-cheap');
});

test('mid-path prune: no look-ahead, immediate add-and-check', () => {
  // Motherboard is dear: every path through mb-dear dies at depth 1 while
  // mb-cheap paths complete, proving the add happens at choice time and
  // sibling paths are unaffected.
  const results = [
    verdict('CPU', 'cpu-1'),
    verdict('MOTHERBOARD', 'mb-dear'),
    verdict('MOTHERBOARD', 'mb-cheap'),
    verdict('RAM', 'ram-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  const priceById = (v) => {
    if (v.product_id === 'mb-dear') return 9000;
    return 100;
  };
  const out = assembleBuilds(
    engineInput({ results, budget: 1000, integrated: { 'cpu-1': true }, priceById, maxBuilds: 10 })
  );
  assert.equal(out.builds.length, 1);
  assert.equal(idsOf(out.builds[0]).MOTHERBOARD, 'mb-cheap');
});

test('all paths past the limit yield zero builds', () => {
  const results = fullSet('a');
  const out = assembleBuilds(
    engineInput({ results, budget: 10, integrated: { 'a-cpu': true } })
  );
  assert.deepEqual(out, { builds: [] });
});

test('cap of 1 returns exactly the first discovered build', () => {
  const results = [
    verdict('CPU', 'cpu-1'),
    verdict('CPU', 'cpu-2'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('RAM', 'ram-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  const full = assembleBuilds(
    engineInput({ results, integrated: { 'cpu-1': true, 'cpu-2': true }, maxBuilds: 10 })
  );
  assert.equal(full.builds.length, 2);
  const capped = assembleBuilds(
    engineInput({ results, integrated: { 'cpu-1': true, 'cpu-2': true }, maxBuilds: 1 })
  );
  assert.equal(capped.builds.length, 1);
  assert.deepEqual(snapshot(capped.builds[0]), snapshot(full.builds[0]));
});

test('cap of N returns exactly the first N discovered builds', () => {
  const results = [
    verdict('CPU', 'cpu-1'),
    verdict('CPU', 'cpu-2'),
    verdict('CPU', 'cpu-3'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('RAM', 'ram-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  const full = assembleBuilds(
    engineInput({ results, integrated: { 'cpu-1': true, 'cpu-2': true, 'cpu-3': true }, maxBuilds: 10 })
  );
  assert.equal(full.builds.length, 3);
  const capped = assembleBuilds(
    engineInput({ results, integrated: { 'cpu-1': true, 'cpu-2': true, 'cpu-3': true }, maxBuilds: 2 })
  );
  assert.equal(capped.builds.length, 2);
  assert.deepEqual(snapshot(capped.builds), snapshot(full.builds.slice(0, 2)));
});

test('the cap halts the walk: later paths stay unexplored', () => {
  const results = [
    verdict('CPU', 'cpu-1'),
    verdict('CPU', 'cpu-2'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('RAM', 'ram-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  // Carrier deliberately lacks every cpu-2 key: any lookup past the cap
  // would throw INVALID_CANDIDATE. Cap 1 must succeed without touching it.
  const raw = Object.create(null);
  for (const v of results) {
    if (v.product_id === 'cpu-2') continue;
    Object.defineProperty(raw, priceKey(v.product_id, v.product_variant_id, v.component_role), {
      value: { selected_price: 100, currency: 'MAD', store_id: STORE_A, price_checked_at: TS },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const prices = validatePrices(raw);
  const capped = assembleBuilds(
    engineInput({ results, integrated: { 'cpu-1': true, 'cpu-2': true }, maxBuilds: 1, prices })
  );
  assert.equal(capped.builds.length, 1);
  assert.equal(idsOf(capped.builds[0]).CPU, 'cpu-1');
  assert.throws(
    () =>
      assembleBuilds(
        engineInput({ results, integrated: { 'cpu-1': true, 'cpu-2': true }, maxBuilds: 10, prices })
      ),
    (e) => e instanceof CandidateSelectionError && e.code === ERROR_CODES.INVALID_CANDIDATE
  );
});

test('per-role cap is ignored: full buckets still walk with top_k_per_role = 1', () => {
  const results = [
    verdict('CPU', 'cpu-1'),
    verdict('CPU', 'cpu-2'),
    verdict('CPU', 'cpu-3'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('RAM', 'ram-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'cpu-1': true, 'cpu-2': true, 'cpu-3': true }, topK: 1, maxBuilds: 10 })
  );
  assert.equal(out.builds.length, 3);
  assert.deepEqual(
    out.builds.map((b) => idsOf(b).CPU),
    ['cpu-1', 'cpu-2', 'cpu-3']
  );
});

test('builds and components carry exactly the documented keys', () => {
  const results = [...fullSet('a'), verdict('GPU', 'gpu-a')];
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'a-cpu': true } })
  );
  const withGpu = out.builds.find((b) => idsOf(b).GPU === 'gpu-a');
  assert.deepEqual(Object.keys(withGpu).sort(), ['components', 'currency', 'total_price']);
  assert.deepEqual(Object.keys(withGpu), ['components', 'total_price', 'currency']);
  for (const c of withGpu.components) {
    assert.deepEqual(Object.keys(c).sort(), [
      'category',
      'component_role',
      'price',
      'product_id',
      'product_variant_id',
      'status',
    ]);
    assert.deepEqual(Object.keys(c), [
      'component_role',
      'product_id',
      'product_variant_id',
      'category',
      'status',
      'price',
    ]);
  }
  assert.ok(!('reason' in withGpu.components[0]));
  assert.ok(!('relationships' in withGpu.components[0]));
  assert.ok(!('SSD_SECONDARY' in idsOf(withGpu)));
});

test('component price is the exact frozen carrier object (identity, not copy)', () => {
  const results = [...fullSet('a'), verdict('GPU', 'gpu-a')];
  const input = engineInput({ results, integrated: { 'a-cpu': true } });
  const out = assembleBuilds(input);
  const withGpu = out.builds.find((b) => idsOf(b).GPU === 'gpu-a');
  assert.ok(withGpu);
  for (const c of withGpu.components) {
    const key = priceKey(c.product_id, c.product_variant_id, c.component_role);
    assert.equal(c.price, input.prices[key]);
  }
  // Verdicts and carrier hold no emitted-component aliases back.
});

test('total price is the exact arithmetic sum; currency passes through', () => {
  const results = [...fullSet('a'), verdict('GPU', 'gpu-a')];
  const priceById = {
    'a-cpu': 1000,
    'a-mb': 800,
    'a-ram': 400,
    'gpu-a': 2500,
    'a-psu': 600,
    'a-case': 500,
    'a-cooler': 300,
    'a-ssd': 450,
  };
  const out = assembleBuilds(
    engineInput({
      results,
      integrated: { 'a-cpu': true },
      priceById,
      currency: 'EUR',
    })
  );
  assert.equal(out.builds.length, 2);
  const withGpu = out.builds.find((b) => idsOf(b).GPU === 'gpu-a');
  assert.equal(withGpu.total_price, 1000 + 800 + 400 + 2500 + 600 + 500 + 300 + 450);
  assert.equal(withGpu.currency, 'EUR');
  const omit = out.builds.find((b) => !('GPU' in idsOf(b)));
  assert.equal(omit.total_price, 1000 + 800 + 400 + 600 + 500 + 300 + 450);
  assert.equal(omit.currency, 'EUR');
});

test('no rounding, no coercion: sums stay numeric', () => {
  const results = fullSet('a');
  const priceById = {
    'a-cpu': 199.99,
    'a-mb': 100.01,
    'a-ram': 50,
    'a-psu': 50,
    'a-case': 50,
    'a-cooler': 50,
    'a-ssd': 50,
  };
  const out = assembleBuilds(
    engineInput({ results, budget: 100000, integrated: { 'a-cpu': true }, priceById })
  );
  assert.equal(typeof out.builds[0].total_price, 'number');
  assert.equal(out.builds[0].total_price, 199.99 + 100.01 + 50 + 50 + 50 + 50 + 50);
});

test('empty results return a frozen empty envelope', () => {
  const input = engineInput({ results: [], prices: validatePrices(Object.create(null)) });
  const out = assembleBuilds(input);
  assert.deepEqual(out, { builds: [] });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.builds));
  assert.deepEqual(Object.keys(out), ['builds']);
});

test('same frozen input twice yields deeply equal output', () => {
  const results = [
    verdict('CPU', 'cpu-1'),
    verdict('CPU', 'cpu-2'),
    verdict('MOTHERBOARD', 'mb-1'),
    verdict('RAM', 'ram-1'),
    verdict('GPU', 'gpu-1'),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  const first = engineInput({ results, maxBuilds: 10 });
  const second = engineInput({ results, maxBuilds: 10 });
  const a = assembleBuilds(first);
  const b = assembleBuilds(second);
  assert.deepEqual(snapshot(a), snapshot(b));
  assert.deepEqual(
    a.builds.map((x) => idsOf(x)),
    b.builds.map((x) => idsOf(x))
  );
});

test('inputs stay untouched: verdicts, buckets, prices and caps are read-only', () => {
  const results = [...fullSet('a'), verdict('GPU', 'gpu-a')];
  const input = engineInput({ results, integrated: { 'a-cpu': true }, maxBuilds: 10 });
  const beforeInput = snapshot(input);
  const beforeResults = snapshot(results);
  const gpuKey = priceKey('gpu-a', 'gpu-a-var', 'GPU');
  const beforePrice = snapshot(input.prices[gpuKey]);
  const out = assembleBuilds(input);
  assert.deepEqual(snapshot(input), beforeInput);
  assert.deepEqual(snapshot(results), beforeResults);
  assert.deepEqual(snapshot(input.prices[gpuKey]), beforePrice);
  assert.ok(Object.isFrozen(input.prices[gpuKey]));
});

test('every emitted layer is frozen: envelope, builds, components, prices', () => {
  const results = [...fullSet('a'), verdict('GPU', 'gpu-a')];
  const out = assembleBuilds(
    engineInput({ results, integrated: { 'a-cpu': true } })
  );
  assert.ok(out.builds.length >= 2);
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.builds));
  for (const b of out.builds) {
    assert.ok(Object.isFrozen(b));
    assert.ok(Object.isFrozen(b.components));
    for (const c of b.components) {
      assert.ok(Object.isFrozen(c));
      assert.ok(Object.isFrozen(c.price));
    }
  }
});

test('frozen verdict input still walks (idempotent consumption)', () => {
  const results = fullSet('a');
  const frozen = Object.freeze(results.map((v) => Object.freeze({ ...v, relationships: Object.freeze({ ...v.relationships }) })));
  const out = assembleBuilds(
    engineInput({ results: frozen, integrated: { 'a-cpu': true } })
  );
  assert.equal(out.builds.length, 1);
});

test('reason and relationships never steer or leak into expansion', () => {
  const results = [
    verdict('CPU', 'cpu-1', { reason: 'SOME_CODE', relationships: { cpu_motherboard: 'PASS' } }),
    verdict('MOTHERBOARD', 'mb-1', { relationships: { cpu_motherboard: 'UNKNOWN' } }),
    verdict('RAM', 'ram-1', { status: 'UNKNOWN', reason: 'OTHER_CODE' }),
    verdict('PSU', 'psu-1'),
    verdict('CASE', 'case-1'),
    verdict('CPU_COOLER', 'cooler-1'),
    verdict('SSD_BOOT', 'ssd-1'),
  ];
  const out = assembleBuilds(engineInput({ results, integrated: { 'cpu-1': true } }));
  assert.equal(out.builds.length, 1);
  for (const c of out.builds[0].components) {
    assert.ok(!('reason' in c));
    assert.ok(!('relationships' in c));
  }
  assert.equal(idsOf(out.builds[0]).RAM, 'ram-1');
});

test('public surface is exactly assembleBuilds with one parameter', () => {
  const api = require('./assemble');
  assert.deepEqual(Object.keys(api).sort(), ['EXPANSION_ORDER', 'assembleBuilds']);
  assert.equal(typeof assembleBuilds, 'function');
  assert.equal(assembleBuilds.length, 1);
  assert.deepEqual([...EXPANSION_ORDER], [
    'CPU',
    'MOTHERBOARD',
    'RAM',
    'GPU',
    'PSU',
    'CASE',
    'CPU_COOLER',
    'SSD_BOOT',
  ]);
  assert.ok(Object.isFrozen(EXPANSION_ORDER));
});

test('expansion order pins the vocabulary mapping, not a copy of it', () => {
  for (const role of EXPANSION_ORDER) {
    assert.equal(CATEGORY_FOR[role], ROLE_CATEGORIES[role]);
  }
});

const ASSEMBLE_SOURCE = fs.readFileSync(path.join(__dirname, 'assemble.js'), 'utf8');

test('assemble.js keeps its source boundary', () => {
  const forbidden = [
    'new Pool',
    '.query(',
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'store_offer',
    'top_k_per_role',
    'freshness',
    'penalty',
    'compatibility/',
    'filtering/',
    'context-loader',
    'COMPONENT_ROLES',
    'Math.random',
    'Date.now',
  ];
  for (const needle of forbidden) {
    assert.equal(ASSEMBLE_SOURCE.includes(needle), false, `must not contain ${needle}`);
  }
  assert.equal(/require\(['"]pg['"]\)/.test(ASSEMBLE_SOURCE), false, 'must not contain pg require');
  assert.equal(/\branking\b/i.test(ASSEMBLE_SOURCE), false, 'must not contain ranking');
  assert.equal(/\bscore\b/i.test(ASSEMBLE_SOURCE), false, 'must not contain score');
  assert.equal(/\brank\b/i.test(ASSEMBLE_SOURCE), false, 'must not contain rank');
});

test('assemble.js uses only the four allowed engine requires', () => {
  const requires = [...ASSEMBLE_SOURCE.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, [
    '../candidates/roles',
    '../candidates/errors',
    './prices',
    './gpu-policy',
  ]);
  assert.equal(ASSEMBLE_SOURCE.includes('async('), false);
  assert.equal(ASSEMBLE_SOURCE.includes('await('), false);
  const exportsFound = [...ASSEMBLE_SOURCE.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)].map((m) =>
    m[1].replace(/\s/g, '')
  );
  assert.deepEqual(exportsFound, ['assembleBuilds,EXPANSION_ORDER']);
});

// ---------------------------------------------------------------------------
// Cross-module composition (Step 5 audit): Step 1 -> Step 2 -> Step 4
// ---------------------------------------------------------------------------

test('full pipeline composes: Step 1 frozen input + Step 2 carrier + Step 4 assembly', () => {
  const results = [...fullSet('a'), verdict('GPU', 'gpu-a')];
  const rawCarrier = Object.create(null);
  for (const v of results) {
    Object.defineProperty(rawCarrier, priceKey(v.product_id, v.product_variant_id, v.component_role), {
      value: { selected_price: 100, currency: 'MAD', store_id: STORE_A, price_checked_at: TS },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const rawInput = engineInput({
    results,
    integrated: { 'a-cpu': true },
    // Arbitrary order on purpose: required_roles must never drive traversal.
    requiredRoles: ['SSD_BOOT', 'PSU', 'RAM', 'CPU_COOLER', 'CASE', 'CPU', 'MOTHERBOARD', 'GPU'],
    prices: rawCarrier,
  });

  // Step 1 preserves the raw carrier by reference: no copy, no freeze, no normalization.
  const validated = validateEngine3Input(rawInput);
  assert.equal(validated.prices, rawInput.prices);
  assert.equal(Object.isFrozen(validated.prices), false);

  // Step 2 validates the preserved carrier; Step 4 consumes the re-injected result.
  const prices = validatePrices(rawInput.prices);
  const out = assembleBuilds({ ...validated, prices });

  // OPTIONAL GPU: the GPU build first, then exactly one omit build.
  assert.equal(out.builds.length, 2);
  assert.equal(idsOf(out.builds[0]).GPU, 'gpu-a');
  assert.equal(idsOf(out.builds[1]).GPU, undefined);
  assert.deepEqual(rolesOf(out.builds[0]), [...EXPANSION_ORDER]);
  assert.deepEqual(rolesOf(out.builds[1]), EXPANSION_ORDER.filter((role) => role !== 'GPU'));

  // Price identity across the composition: exact frozen carrier entries.
  assert.equal(out.builds[0].total_price, 800);
  assert.equal(out.builds[1].total_price, 700);
  for (const build of out.builds) {
    for (const c of build.components) {
      assert.equal(c.price, prices[priceKey(c.product_id, c.product_variant_id, c.component_role)]);
      assert.equal(c.price.currency, build.currency);
      assert.ok(Object.isFrozen(c.price));
    }
  }
  assert.ok(Object.isFrozen(out));
  for (const build of out.builds) {
    assert.ok(Object.isFrozen(build));
    assert.ok(Object.isFrozen(build.components));
  }
});

test('full pipeline immutability: the complete composition never mutates caller-owned data', () => {
  const results = [...fullSet('a'), verdict('GPU', 'gpu-a')];
  const gpuRequired = ['gaming', '3d-rendering'];
  const integrated = { 'a-cpu': true, 'cpu-x': false };
  const caps = { top_k_per_role: 3, max_builds_per_query: 10 };
  const requiredRoles = ['RAM', 'SSD_BOOT', 'CPU'];
  const rawCarrier = Object.create(null);
  for (const v of results) {
    Object.defineProperty(rawCarrier, priceKey(v.product_id, v.product_variant_id, v.component_role), {
      value: { selected_price: 100, currency: 'MAD', store_id: STORE_A, price_checked_at: TS },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const rawInput = {
    results,
    budget_amount: 100000,
    currency: 'MAD',
    required_roles: requiredRoles,
    use_case: 'office',
    gpu_required_use_cases: gpuRequired,
    integrated_gpu_present: integrated,
    candidate_caps: caps,
    prices: rawCarrier,
  };

  const before = snapshot(rawInput);
  const cpuKey = priceKey('a-cpu', null, 'CPU');
  const gpuKey = priceKey('gpu-a', 'gpu-a-var', 'GPU');
  const beforeCpuEntry = snapshot(rawCarrier[cpuKey]);

  const validated = validateEngine3Input(rawInput); // Step 1
  const prices = validatePrices(rawInput.prices); // Step 2
  const out = assembleBuilds({ ...validated, prices }); // Step 4

  assert.equal(out.builds.length, 2);

  // Caller-owned structures still match their pre-run snapshots...
  assert.deepEqual(snapshot(rawInput), before);
  assert.deepEqual(snapshot(rawCarrier[cpuKey]), beforeCpuEntry);
  // ...and none of them was frozen along the way.
  for (const target of [
    rawInput,
    results,
    ...results,
    gpuRequired,
    integrated,
    caps,
    requiredRoles,
    rawCarrier,
  ]) {
    assert.equal(Object.isFrozen(target), false, 'caller-owned data must stay unfrozen');
  }
  assert.equal(Object.isFrozen(rawCarrier[gpuKey]), false);

  // The emitted hierarchy is frozen, and prices are the frozen carrier entries.
  assert.ok(Object.isFrozen(out));
  for (const build of out.builds) {
    assert.ok(Object.isFrozen(build));
    assert.ok(Object.isFrozen(build.components));
    for (const c of build.components) {
      assert.ok(Object.isFrozen(c));
      assert.ok(Object.isFrozen(c.price));
      assert.equal(c.price, prices[priceKey(c.product_id, c.product_variant_id, c.component_role)]);
    }
  }
});

test('full pipeline determinism: repeated composition from identical input is deeply equal', () => {
  const results = [...fullSet('a', { gpu: true }), verdict('GPU', 'gpu-a')];
  const rawInput = engineInput({ results, integrated: { 'a-cpu': true }, maxBuilds: 10 });
  const before = snapshot(rawInput);

  // The frozen Step 1 output is consumed by Step 4 directly: its frozen copies
  // of results / caps / GPU inputs are what assembly reads.
  const run = () => {
    const validated = validateEngine3Input(rawInput);
    assert.ok(Object.isFrozen(validated));
    return snapshot(assembleBuilds(validated));
  };

  const first = run();
  const second = run();
  assert.deepEqual(second, first);
  assert.deepEqual(snapshot(rawInput), before);

  // Identical ordering run over run, including the omit build's position.
  const ids = (out) => out.builds.map((b) => b.components.map((c) => c.product_id));
  const a = assembleBuilds(validateEngine3Input(rawInput));
  const b = assembleBuilds(validateEngine3Input(rawInput));
  assert.deepEqual(ids(b), ids(a));
});







