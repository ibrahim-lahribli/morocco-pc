'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveGpuRequirement } = require('./gpu-policy');

function makeArgs(overrides = {}) {
  return {
    use_case: 'gaming',
    gpu_required_use_cases: ['gaming'],
    integrated_gpu_present: { 'cpu-1': true },
    selectedCpuProductId: 'cpu-1',
    ...overrides,
  };
}

test('matching use case returns REQUIRED', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'gaming', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': false }, selectedCpuProductId: 'cpu-1' })
    ),
    'REQUIRED'
  );
});

test('matching use case returns REQUIRED despite integrated GPU true', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'gaming', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'REQUIRED'
  );
});

test('multiple use cases with one matching returns REQUIRED', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'video-editing',
        gpu_required_use_cases: ['gaming', 'video-editing', '3d-rendering'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'REQUIRED'
  );
});

test('no matching use case continues to integrated GPU rule', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'office', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'OPTIONAL'
  );
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'office', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': false }, selectedCpuProductId: 'cpu-1' })
    ),
    'REQUIRED'
  );
});

test('"gaming" vs "Gaming" does not match Rule 1', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'Gaming', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'OPTIONAL'
  );
});

test('"gaming" vs " gaming" does not match Rule 1', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'gaming', gpu_required_use_cases: [' gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'OPTIONAL'
  );
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: ' gaming', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'OPTIONAL'
  );
});

test('"gaming" vs "gaming " does not match Rule 1', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'gaming ', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'OPTIONAL'
  );
});

test('exact duplicate entries still match', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'gaming', gpu_required_use_cases: ['gaming', 'gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'REQUIRED'
  );
});

test('exact string identity behavior', () => {
  for (const near of ['Gaming', ' gaming', 'gaming ', 'GAMING', 'gaming\n']) {
    assert.equal(
      resolveGpuRequirement(
        makeArgs({ use_case: near, gpu_required_use_cases: ['gaming'],
          integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
      ),
      'OPTIONAL',
      `expected no Rule 1 match for ${JSON.stringify(near)}`
    );
  }
});

test('substring does not match Rule 1', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'gam', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'OPTIONAL'
  );
});
test('integrated GPU true returns OPTIONAL', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'office', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'OPTIONAL'
  );
});

test('integrated GPU false/null/missing/undefined return REQUIRED', () => {
  const cases = [
    [{ 'cpu-1': false }, 'cpu-1'],
    [{ 'cpu-1': null }, 'cpu-1'],
    [{}, 'cpu-1'],
    [{ 'cpu-1': undefined }, 'cpu-1'],
  ];
  for (const [map, id] of cases) {
    assert.equal(
      resolveGpuRequirement(
        makeArgs({ use_case: 'office', gpu_required_use_cases: ['gaming'],
          integrated_gpu_present: map, selectedCpuProductId: id })
      ),
      'REQUIRED',
      `expected REQUIRED for ${JSON.stringify(map)}`
    );
  }
});

test('direct non-boolean truthy values do not qualify', () => {
  for (const truthy of [1, 'true', {}]) {
    assert.equal(
      resolveGpuRequirement({ use_case: 'office', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': truthy }, selectedCpuProductId: 'cpu-1' }),
      'REQUIRED',
      `expected REQUIRED for truthy ${String(truthy)}`
    );
  }
});

test('fallback matrix', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'office', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: {}, selectedCpuProductId: 'cpu-9' })
    ),
    'REQUIRED'
  );
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'office', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': false }, selectedCpuProductId: 'cpu-1' })
    ),
    'REQUIRED'
  );
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'office', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': null }, selectedCpuProductId: 'cpu-1' })
    ),
    'REQUIRED'
  );
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'office', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'OPTIONAL'
  );
});

test('precedence: required use case plus iGPU true equals REQUIRED', () => {
  assert.equal(
    resolveGpuRequirement(
      makeArgs({ use_case: 'gaming', gpu_required_use_cases: ['gaming'],
        integrated_gpu_present: { 'cpu-1': true }, selectedCpuProductId: 'cpu-1' })
    ),
    'REQUIRED'
  );
});

test('does not mutate inputs', () => {
  const required = ['gaming', 'video-editing'];
  const integrated = { 'cpu-1': true, 'cpu-2': false };
  const args = { use_case: 'gaming', gpu_required_use_cases: required,
    integrated_gpu_present: integrated, selectedCpuProductId: 'cpu-1' };
  const result = resolveGpuRequirement(args);
  assert.equal(result, 'REQUIRED');
  assert.deepEqual(required, ['gaming', 'video-editing']);
  assert.deepEqual(integrated, { 'cpu-1': true, 'cpu-2': false });
  assert.deepEqual(Object.keys(args).sort(),
    ['gpu_required_use_cases', 'integrated_gpu_present', 'selectedCpuProductId', 'use_case']);
});

test('does not mutate on the OPTIONAL path and is deterministic', () => {
  const required = ['gaming'];
  const integrated = { 'cpu-1': true };
  const args = { use_case: 'office', gpu_required_use_cases: required,
    integrated_gpu_present: integrated, selectedCpuProductId: 'cpu-1' };
  assert.equal(resolveGpuRequirement(args), 'OPTIONAL');
  assert.equal(resolveGpuRequirement(args), 'OPTIONAL');
  assert.deepEqual(required, ['gaming']);
  assert.deepEqual(integrated, { 'cpu-1': true });
});

test('exports exactly resolveGpuRequirement with arity 1', () => {
  const moduleApi = require('./gpu-policy');
  assert.deepEqual(Object.keys(moduleApi).sort(), ['resolveGpuRequirement']);
  assert.equal(typeof moduleApi.resolveGpuRequirement, 'function');
  assert.equal(moduleApi.resolveGpuRequirement.length, 1);
});

test('gpu-policy.js contains no out-of-scope boundary crossings', () => {
  const source = fs.readFileSync(path.join(__dirname, 'gpu-policy.js'), 'utf8');
  const forbidden = ["require('pg')", 'new Pool', '.query(', 'SELECT ', 'INSERT ',
    '../filtering', '../compatibility', '../candidates', 'lookupPrice',
    'priceKey', 'validatePrices', 'assemble', 'top_k_per_role',
    'score', 'rank', 'penalt', 'MOTHERBOARD'];
  for (const needle of forbidden) {
    assert.equal(source.includes(needle), false, `must not contain "${needle}"`);
  }
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, []);
  assert.equal(source.includes('async '), false);
  assert.equal(source.includes('await '), false);
  assert.equal(source.includes('Math.random'), false);
  assert.equal(source.includes('Date.now'), false);
  const exports_ = [...source.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)]
    .map((m) => m[1].replace(/\s/g, ''));
  assert.deepEqual(exports_, ['resolveGpuRequirement']);
});

// ---------------------------------------------------------------------------
// E6 (Decision 43): Rule 0 - a DECLARED per-use-case profile policy wins
// over the legacy gpu_required_use_cases list.
// ---------------------------------------------------------------------------

test('E6 Rule 0: a declared IGPU_ALLOWED policy wins over the legacy REQUIRED list', () => {
  assert.equal(
    resolveGpuRequirement(makeArgs({
      use_case: 'GAMING',
      gpu_required_use_cases: ['GAMING'],
      integrated_gpu_present: { 'cpu-1': true },
      gpuPolicy: 'IGPU_ALLOWED',
    })),
    'OPTIONAL'
  );
});

test('E6 Rule 0: declared IGPU_ALLOWED on a CPU without an iGPU stays REQUIRED', () => {
  for (const flag of [false, null, undefined]) {
    const present = flag === undefined ? {} : { 'cpu-1': flag };
    assert.equal(
      resolveGpuRequirement(makeArgs({ integrated_gpu_present: present, gpuPolicy: 'IGPU_ALLOWED' })),
      'REQUIRED'
    );
  }
});

test('E6 Rule 0: a declared REQUIRED policy wins over the iGPU flag', () => {
  assert.equal(
    resolveGpuRequirement(makeArgs({ use_case: 'OFFICE', gpu_required_use_cases: [], gpuPolicy: 'REQUIRED' })),
    'REQUIRED'
  );
});

test('E6 Rule 0: no declared policy keeps the legacy rules unchanged', () => {
  // Legacy rule 2: an iGPU CPU in a use case outside the required list ->.
  assert.equal(
    resolveGpuRequirement(makeArgs({ use_case: 'OFFICE', gpu_required_use_cases: [] })),
    'OPTIONAL'
  );
});
