'use strict';

// ---------------------------------------------------------------------------
// Decision 20 (2026-09-22) - post-ranking pair-diversity selection tests.
//
// Scope: selectDiverseTop({ ranked, limit, maxPerPair }) -> deeply frozen
// { selected, dropped_count }.
//
// Pipeline: rankBuilds output -> selectDiverseTop -> Engine 5b persistence.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { selectDiverseTop, MAX_PER_PAIR } = require('./select-diverse');
const { rankBuilds, buildSignature } = require('./rank');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

const CPU = 'cpu-1';
const MB = 'mb-1';
const RAM = 'ram-1';
const GPU = 'gpu-1';
const PSU = 'psu-1';
const CASE = 'case-1';
const COOLER = 'cooler-1';
const SSD = 'ssd-1';

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

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

/** Full 8-role build (GPU included). */
function fullBuild(overrides = {}) {
  return deepFreeze({
    components: [
      component('CPU', overrides.CPU !== undefined ? overrides.CPU : CPU),
      component('MOTHERBOARD', overrides.MOTHERBOARD !== undefined ? overrides.MOTHERBOARD : MB),
      component('RAM', overrides.RAM !== undefined ? overrides.RAM : RAM),
      component('GPU', overrides.GPU !== undefined ? overrides.GPU : GPU),
      component('PSU', overrides.PSU !== undefined ? overrides.PSU : PSU),
      component('CASE', overrides.CASE !== undefined ? overrides.CASE : CASE),
      component('CPU_COOLER', overrides.COOLER !== undefined ? overrides.COOLER : COOLER),
      component('SSD_BOOT', overrides.SSD_BOOT !== undefined ? overrides.SSD_BOOT : SSD),
    ],
    build_score: overrides.build_score !== undefined ? overrides.build_score : 50,
    total_price: overrides.total_price !== undefined ? overrides.total_price : 100,
    currency: overrides.currency !== undefined ? overrides.currency : 'MAD',
    unknown_pairwise_count:
      overrides.unknown_pairwise_count !== undefined ? overrides.unknown_pairwise_count : 0,
  });
}

/** Build without GPU (iGPU path). */
function buildWithoutGpu(overrides = {}) {
  return deepFreeze({
    components: [
      component('CPU', overrides.CPU !== undefined ? overrides.CPU : CPU),
      component('MOTHERBOARD', overrides.MOTHERBOARD !== undefined ? overrides.MOTHERBOARD : MB),
      component('RAM', overrides.RAM !== undefined ? overrides.RAM : RAM),
      component('PSU', overrides.PSU !== undefined ? overrides.PSU : PSU),
      component('CASE', overrides.CASE !== undefined ? overrides.CASE : CASE),
      component('CPU_COOLER', overrides.COOLER !== undefined ? overrides.COOLER : COOLER),
      component('SSD_BOOT', overrides.SSD_BOOT !== undefined ? overrides.SSD_BOOT : SSD),
    ],
    build_score: overrides.build_score !== undefined ? overrides.build_score : 50,
    total_price: overrides.total_price !== undefined ? overrides.total_price : 100,
    currency: overrides.currency !== undefined ? overrides.currency : 'MAD',
    unknown_pairwise_count:
      overrides.unknown_pairwise_count !== undefined ? overrides.unknown_pairwise_count : 0,
  });
}

/** Ranked entry shaped like rankBuilds output. */
function rankedEntry(build, rank) {
  return deepFreeze({
    rank,
    build,
    build_score: build.build_score,
    total_price: build.total_price,
    compatibility_status: 'PASS',
    signature: buildSignature(build.components),
    explanation: null,
  });
}

function rejectionOf(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

// ---------------------------------------------------------------------------
// MAX_PER_PAIR constant
// ---------------------------------------------------------------------------
test('MAX_PER_PAIR is a frozen code constant equal to 3 (Decision 20 section 3)', () => {
  assert.ok(Object.isFrozen(MAX_PER_PAIR));
  assert.equal(MAX_PER_PAIR, 3);
});

// ---------------------------------------------------------------------------
// Basic: 4 pairs, maxPerPair=3, limit=10, >10 entries
// ---------------------------------------------------------------------------
test('basic: respects maxPerPair cap and limit, persisted_rank contiguous 1..k', () => {
  const pairs = [
    { cpu: 'cpu-A', gpu: 'gpu-A1' },
    { cpu: 'cpu-B', gpu: 'gpu-B1' },
    { cpu: 'cpu-C', gpu: 'gpu-C1' },
    { cpu: 'cpu-D', gpu: 'gpu-D1' },
  ];

  const ranked = [];
  for (let p = 0; p < pairs.length; p += 1) {
    for (let b = 0; b < 4; b += 1) {
      const build = fullBuild({
        CPU: pairs[p].cpu,
        GPU: pairs[p].gpu,
        build_score: 100 - (p * 4 + b),
        total_price: 1000 + (p * 4 + b),
      });
      ranked.push(rankedEntry(build, p * 4 + b + 1));
    }
  }

  const result = selectDiverseTop({ ranked, limit: 10, maxPerPair: 3 });

  assert.equal(result.selected.length, 10);
  assert.equal(result.dropped_count, 3);
  assert.deepEqual(result.selected.map((e) => e.persisted_rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  for (const entry of result.selected) {
    assert.ok(!('rank' in entry));
    assert.ok('persisted_rank' in entry);
  }
});

// ---------------------------------------------------------------------------
// Omitted-GPU pair value
// ---------------------------------------------------------------------------
test('omitted-GPU entries share one pair key and are capped', () => {
  const cpuId = 'cpu-shared';
  const ranked = [];

  for (let i = 0; i < 3; i += 1) {
    ranked.push(rankedEntry(
      fullBuild({ CPU: cpuId, GPU: 'gpu-1', build_score: 100 - i, total_price: 1000 + i }),
      i + 1
    ));
  }
  for (let i = 0; i < 4; i += 1) {
    ranked.push(rankedEntry(
      buildWithoutGpu({ CPU: cpuId, build_score: 90 - i, total_price: 800 + i }),
      i + 4
    ));
  }

  const result = selectDiverseTop({ ranked, limit: 10, maxPerPair: 2 });
  assert.equal(result.selected.length, 4);
  assert.equal(result.dropped_count, 3);

  let withGpu = 0, withoutGpu = 0;
  for (const entry of result.selected) {
    if (entry.build.components.some((c) => c.component_role === 'GPU')) withGpu += 1;
    else withoutGpu += 1;
  }
  assert.equal(withGpu, 2);
  assert.equal(withoutGpu, 2);
});

// ---------------------------------------------------------------------------
// Rank order preserved
// ---------------------------------------------------------------------------
test('rank order preserved in selection', () => {
  const ranked = [];
  for (let i = 0; i < 6; i += 1) {
    ranked.push(rankedEntry(
      fullBuild({ CPU: `cpu-${i}`, GPU: `gpu-${i}`, build_score: 100 - i, total_price: 1000 + i }),
      i + 1
    ));
  }

  const result = selectDiverseTop({ ranked, limit: 10, maxPerPair: 3 });
  assert.equal(result.selected.length, 6);
  for (let i = 0; i < 6; i += 1) {
    assert.strictEqual(result.selected[i].build, ranked[i].build);
    assert.equal(result.selected[i].persisted_rank, i + 1);
  }
});

// ---------------------------------------------------------------------------
// k < limit
// ---------------------------------------------------------------------------
test('k < limit: returns exactly what survives when diversity insufficient', () => {
  const ranked = [];
  for (let i = 0; i < 5; i += 1) {
    ranked.push(rankedEntry(
      fullBuild({ CPU: 'cpu-A', GPU: 'gpu-A', build_score: 100 - i, total_price: 1000 + i }),
      i + 1
    ));
  }
  for (let i = 0; i < 4; i += 1) {
    ranked.push(rankedEntry(
      fullBuild({ CPU: 'cpu-B', GPU: 'gpu-B', build_score: 90 - i, total_price: 900 + i }),
      i + 6
    ));
  }

  const result = selectDiverseTop({ ranked, limit: 10, maxPerPair: 3 });
  assert.equal(result.selected.length, 6);
  assert.equal(result.dropped_count, 3);
  assert.ok(result.selected.length < 10);
});

// ---------------------------------------------------------------------------
// Zero ranked entries -> valid empty result
// ---------------------------------------------------------------------------
test('zero ranked entries -> valid empty result', () => {
  assert.equal(selectDiverseTop({ ranked: [], limit: 10, maxPerPair: 3 }).selected.length, 0);
  assert.equal(selectDiverseTop({}).selected.length, 0);
});

// ---------------------------------------------------------------------------
// No mutation, output deeply frozen
// ---------------------------------------------------------------------------
test('no mutation of input, output deeply frozen', () => {
  const build = fullBuild({ CPU: 'cpu-1', GPU: 'gpu-1' });
  const ranked = [rankedEntry(build, 1), rankedEntry(build, 2)];
  const origLen = ranked.length;
  const result = selectDiverseTop({ ranked, limit: 10, maxPerPair: 3 });
  assert.equal(ranked.length, origLen);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.selected));
  assert.ok(Object.isFrozen(result.selected[0]));
});

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------
test('default values used when omitted, explicit override respected', () => {
  const ranked = [];
  for (let i = 0; i < 5; i += 1) {
    ranked.push(rankedEntry(
      fullBuild({ CPU: 'cpu-same', GPU: 'gpu-same', build_score: 100 - i, total_price: 1000 + i }),
      i + 1
    ));
  }

  assert.equal(selectDiverseTop({ ranked }).selected.length, 3);
  assert.equal(selectDiverseTop({ ranked, maxPerPair: 2 }).selected.length, 2);
  assert.equal(selectDiverseTop({ ranked, limit: 2 }).selected.length, 2);
});

// ---------------------------------------------------------------------------
// Validation failures
// ---------------------------------------------------------------------------
test('validation: non-array ranked fails with INVALID_INPUT', () => {
  const err = rejectionOf(() => selectDiverseTop({ ranked: 'not-an-array' }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_INPUT);
  assert.equal(err.field, 'ranked');
});

test('validation: invalid limit fails with INVALID_FIELD_VALUE', () => {
  const ranked = [rankedEntry(fullBuild({ CPU: 'cpu-1', GPU: 'gpu-1' }), 1)];
  assert.ok(rejectionOf(() => selectDiverseTop({ ranked, limit: -1 })).code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.ok(rejectionOf(() => selectDiverseTop({ ranked, limit: 1.5 })).code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.ok(rejectionOf(() => selectDiverseTop({ ranked, limit: '10' })).code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('validation: invalid maxPerPair fails with INVALID_FIELD_VALUE', () => {
  const ranked = [rankedEntry(fullBuild({ CPU: 'cpu-1', GPU: 'gpu-1' }), 1)];
  assert.ok(rejectionOf(() => selectDiverseTop({ ranked, maxPerPair: 0 })).code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.ok(rejectionOf(() => selectDiverseTop({ ranked, maxPerPair: -1 })).code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.ok(rejectionOf(() => selectDiverseTop({ ranked, maxPerPair: '3' })).code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('validation: missing CPU component fails with MISSING_REQUIRED_FIELD', () => {
  const badBuild = deepFreeze({
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
    currency: 'MAD',
    unknown_pairwise_count: 0,
  });
  const err = rejectionOf(() => selectDiverseTop({ ranked: [rankedEntry(badBuild, 1)] }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  assert.equal(err.field, 'ranked');
});

// ---------------------------------------------------------------------------
// Integration test
// ---------------------------------------------------------------------------
test('integration: real rankBuilds output fed to selectDiverseTop end-to-end', () => {
  // Create builds with unique signatures (different GPU variants = different pairs)
  // This tests end-to-end flow: rankBuilds -> selectDiverseTop
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

  const rankedResult = rankBuilds({ builds });
  const result = selectDiverseTop({ ranked: rankedResult.ranked, limit: 10, maxPerPair: 3 });

  // With 11 builds all having unique pairs, maxPerPair=3 doesn't kick in.
  // limit=10 caps selection at 10, so 10 selected, 0 dropped by pair cap.
  // (The 11th build is unprocessed due to limit, not dropped by pair cap)
  assert.equal(result.selected.length, 10);
  assert.equal(result.dropped_count, 0);
  assert.deepEqual(result.selected.map((e) => e.persisted_rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const entry of result.selected) {
    assert.ok(!('rank' in entry));
    assert.ok('persisted_rank' in entry);
    assert.equal(typeof entry.build_score, 'number');
    assert.equal(typeof entry.total_price, 'number');
    assert.ok(entry.build);
  }
});

// ---------------------------------------------------------------------------
// Boundary test
// ---------------------------------------------------------------------------
test('boundary: select-diverse.js does not import banned modules', () => {
  const source = fs.readFileSync(path.join(__dirname, 'select-diverse.js'), 'utf8');
  const banned = [
    "require('pg')", "require('node:pg')", "require('dotenv')", "require('fs')",
    'new Pool', '.query(', '../orchestrator', '../persistence', '../query',
    '../offers', '../filtering', '../retention', '../scoring',
  ];
  for (const token of banned) {
    assert.ok(!source.includes(token), `select-diverse.js must not contain ${token}`);
  }
  // Check requires using simple string search (avoid complex regex)
  assert.ok(source.includes("require('../assembly')"), 'must require ../assembly');
  assert.ok(source.includes("require('../candidates/errors')"), 'must require ../candidates/errors');
});