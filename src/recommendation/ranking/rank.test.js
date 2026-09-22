'use strict';

// ---------------------------------------------------------------------------
// Decision 18 (2026-09-21) - Engine 5a ranking (src/recommendation/ranking/).
//
// Scope: rankBuilds({ builds }) -> deeply frozen { ranked, top_n }.
// - Sort: build_score DESC, then total_price ASC, then signature ASC (18.2)
// - round2 (half-up shortest-decimal) BEFORE comparing (18.3)
// - signature: ROLE:product_id:variant_or_empty over EXPANSION_ORDER;
//   omitted GPU -> `GPU::`; code-unit compare, NEVER localeCompare (18.4)
// - compatibility_status: G1 - PASS only when all PASS and count==0 (18.5)
// - contiguous ranks 1..n, no equal ranks (18.7 addendum)
// - zero builds -> frozen { ranked: [], top_n: [] } (valid, not an error)
// - no input mutation; freeze all output; build by reference
// - explanation is null on every entry (18.7 / Decision 19.5)
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rankBuilds, TOP_N_PERSISTED, round2, buildSignature, deriveStatus } = require('./rank');
const { EXPANSION_ORDER } = require('../assembly');
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

/** Full 8-role build (GPU included). Single overrides object. */
function fullBuild(overrides = {}) {
  const comps = [
    component('CPU', overrides.CPU !== undefined ? overrides.CPU : CPU),
    component('MOTHERBOARD', overrides.MOTHERBOARD !== undefined ? overrides.MOTHERBOARD : MB),
    component('RAM', overrides.RAM !== undefined ? overrides.RAM : RAM),
    component('GPU', overrides.GPU !== undefined ? overrides.GPU : GPU),
    component('PSU', overrides.PSU !== undefined ? overrides.PSU : PSU),
    component('CASE', overrides.CASE !== undefined ? overrides.CASE : CASE),
    component('CPU_COOLER', overrides.COOLER !== undefined ? overrides.COOLER : COOLER),
    component('SSD_BOOT', overrides.SSD_BOOT !== undefined ? overrides.SSD_BOOT : SSD),
  ];
  return deepFreeze({
    components: comps,
    build_score: overrides.build_score !== undefined ? overrides.build_score : 50,
    total_price: overrides.total_price !== undefined ? overrides.total_price : 100,
    currency: overrides.currency !== undefined ? overrides.currency : 'MAD',
    unknown_pairwise_count:
      overrides.unknown_pairwise_count !== undefined ? overrides.unknown_pairwise_count : 0,
  });
}

function rejectionOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------
// round2 (Decision 18.3): half-up on the shortest decimal representation.
// ---------------------------------------------------------------------------
test('round2: 1.005 -> 1.01, 2.675 -> 2.68 (binary-float-safe)', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
});

test('round2: 0.5 -> 0.5, 0.005 -> 0.01, integers unchanged', () => {
  assert.equal(round2(0.5), 0.5);
  assert.equal(round2(0.005), 0.01);
  assert.equal(round2(5), 5);
  assert.equal(round2(0), 0);
  assert.equal(round2(100), 100);
});

test('round2: 87.4999 -> 87.5, 87.494 -> 87.49, 87.495 -> 87.5, 87.4949 -> 87.49', () => {
  assert.equal(round2(87.4999), 87.5);
  assert.equal(round2(87.494), 87.49);
  assert.equal(round2(87.495), 87.5);
  assert.equal(round2(87.4949), 87.49);
});

test('round2: rejects non-finite / non-number with INVALID_FIELD_VALUE', () => {
  for (const value of [NaN, Infinity, -Infinity, '87', null, undefined, {}]) {
    const err = rejectionOf(() => round2(value));
    assert.ok(err instanceof CandidateSelectionError, 'round2(' + value + ') must throw');
    assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  }
});

// ---------------------------------------------------------------------------
// Signature (Decision 18.4): ROLE:product_id:variant_or_empty over
// EXPANSION_ORDER; omitted GPU -> `GPU::`; comparison by code unit only.
// ---------------------------------------------------------------------------
test('signature: null variant vs non-null variant produce different segments', () => {
  const sigNull = buildSignature([component('MOTHERBOARD', 'mb-a'), component('CPU', CPU)]);
  const sigVar = buildSignature([
    component('MOTHERBOARD', 'mb-a', { product_variant_id: 'mb-a-v1' }),
    component('CPU', CPU),
  ]);
  assert.notEqual(sigNull, sigVar);
});

test('signature: omitted GPU contributes an empty GPU:: slot', () => {
  const sig = buildSignature([component('CPU', CPU), component('MOTHERBOARD', MB)]);
  const parts = sig.split('|');
  assert.equal(parts.length, EXPANSION_ORDER.length);
  assert.equal(parts[3], 'GPU::'); // 4th segment = GPU, omitted
});

test('signature: segment count equals EXPANSION_ORDER for a full build', () => {
  assert.equal(buildSignature(fullBuild({}).components).split('|').length, EXPANSION_ORDER.length);
});

test('signature: distinct products produce distinct signatures', () => {
  const a = buildSignature([component('CPU', 'c1'), component('MOTHERBOARD', 'm1')]);
  const b = buildSignature([component('CPU', 'c2'), component('MOTHERBOARD', 'm1')]);
  assert.notEqual(a, b);
});

test('signature: comparison is by code unit, NOT localeCompare', () => {
  // 'a' (0x61) vs 'Z' (0x5A): code unit says 'Z' < 'a'; default localeCompare
  // (sensitivity varies by platform) can disagree. Two GPU signatures differing
  // only by these letters exercise the divergence.
  const withLower = buildSignature([component('GPU', 'gpu-a')]);
  const withUpper = buildSignature([component('GPU', 'Z')]);
  // Code unit: 'g'==103 > 'Z'==90 at the differing position -> withUpper first.
  assert.ok(withUpper < withLower);
    // localeCompare result must differ from a pure code-unit ordering under
  // default sfx+case-insensitive collation (proves the impl does NOT rely on it).
  assert.notEqual(withUpper.localeCompare(withLower), withUpper < withLower ? -1 : 1);
});

// ---------------------------------------------------------------------------
// deriveStatus (Decision 18.5, G1).
// ---------------------------------------------------------------------------
test('deriveStatus: all PASS + count 0 -> PASS', () => {
  assert.equal(deriveStatus(fullBuild({}).components, 0), 'PASS');
});

test('deriveStatus: unknown_pairwise_count > 0 -> UNKNOWN', () => {
  assert.equal(deriveStatus(fullBuild({}).components, 1), 'UNKNOWN');
  assert.equal(deriveStatus(fullBuild({}).components, 5), 'UNKNOWN');
});

test('deriveStatus: any UNKNOWN component -> UNKNOWN', () => {
  assert.equal(
    deriveStatus(
      [component('CPU', 'c1'), component('MOTHERBOARD', 'm1', { status: 'UNKNOWN' })],
      0
    ),
    'UNKNOWN'
  );
});

test('deriveStatus: only ever PASS or UNKNOWN', () => {
  assert.equal(deriveStatus(fullBuild({}).components, 0), 'PASS');
  assert.equal(deriveStatus(fullBuild({}).components, 9), 'UNKNOWN');
});

// ---------------------------------------------------------------------------
// Sort (Decision 18.2): score DESC, then price ASC, then signature ASC.
// ---------------------------------------------------------------------------
test('sort: build_score DESC determines order', () => {
  const builds = [
    fullBuild({ CPU: 'cpu-lo', build_score: 40, total_price: 50 }),
    fullBuild({ CPU: 'cpu-hi', build_score: 90, total_price: 50 }),
    fullBuild({ CPU: 'cpu-mid', build_score: 70, total_price: 50 }),
  ];
  const ranked = rankBuilds({ builds }).ranked;
  assert.deepEqual(ranked.map((e) => e.build.components[0].product_id), ['cpu-hi', 'cpu-mid', 'cpu-lo']);
  assert.deepEqual(ranked.map((e) => e.rank), [1, 2, 3]);
});

test('sort: equal rounded score falls to total_price ASC', () => {
  const builds = [
    fullBuild({ CPU: 'cpu-b', build_score: 50, total_price: 300 }),
    fullBuild({ CPU: 'cpu-a', build_score: 50, total_price: 200 }),
    fullBuild({ CPU: 'cpu-c', build_score: 50, total_price: 400 }),
  ];
  const ranked = rankBuilds({ builds }).ranked;
  assert.deepEqual(ranked.map((e) => e.build.components[0].product_id), ['cpu-a', 'cpu-b', 'cpu-c']);
});

test('sort: equal score and price falls to signature ASC (code unit)', () => {
  const builds = [
    fullBuild({ CPU: 'cpu-b', build_score: 50, total_price: 100 }),
    fullBuild({ CPU: 'cpu-a', build_score: 50, total_price: 100 }),
  ];
  const ranked = rankBuilds({ builds }).ranked;
  assert.equal(ranked[0].build.components[0].product_id, 'cpu-a');
  assert.equal(ranked[1].build.components[0].product_id, 'cpu-b');
});

// ---------------------------------------------------------------------------
// Round-then-compare (Decision 18.3): 87.494 and 87.4949 both round to 87.49
// and tie on score, falling to price. 87.495 -> 87.5 orders above them.
// ---------------------------------------------------------------------------
test('87.494 and 87.4949 tie on score, fall to price', () => {
  const builds = [
    fullBuild({ CPU: 'cpu-c', build_score: 87.494, total_price: 300 }),
    fullBuild({ CPU: 'cpu-a', build_score: 87.4949, total_price: 200 }),
  ];
  const ranked = rankBuilds({ builds }).ranked;
  assert.equal(ranked[0].build_score, 87.49);
  assert.equal(ranked[1].build_score, 87.49);
  assert.equal(ranked[0].build.components[0].product_id, 'cpu-a');
  assert.equal(ranked[1].build.components[0].product_id, 'cpu-c');
});

test('87.495 -> 87.5 orders above 87.494', () => {
  const builds = [
    fullBuild({ CPU: 'cpu-low', build_score: 87.494, total_price: 999 }),
    fullBuild({ CPU: 'cpu-high', build_score: 87.495, total_price: 1 }),
  ];
  const ranked = rankBuilds({ builds }).ranked;
  assert.equal(ranked[0].build_score, 87.5);
  assert.equal(ranked[1].build_score, 87.49);
  assert.equal(ranked[0].build.components[0].product_id, 'cpu-high');
  assert.equal(ranked[1].build.components[0].product_id, 'cpu-low');
});

test('rounded values are carried on the ranked entries', () => {
  const ranked = rankBuilds({
    builds: [fullBuild({ CPU: 'cpu-x', build_score: 87.495, total_price: 19.999 })],
  }).ranked;
  assert.equal(ranked[0].build_score, 87.5);
  assert.equal(ranked[0].total_price, 20);
});

// ---------------------------------------------------------------------------
// Determinism: shuffling input builds yields identical ranked order + ranks.
// ---------------------------------------------------------------------------
test('permutations yield identical ranked order and ranks', () => {
  const base = [
    fullBuild({ CPU: 'A', build_score: 90, total_price: 300 }),
    fullBuild({ CPU: 'B', build_score: 80, total_price: 100 }),
    fullBuild({ CPU: 'C', build_score: 80, total_price: 200 }),
    fullBuild({ CPU: 'D', build_score: 70, total_price: 150 }),
    fullBuild({ CPU: 'E', build_score: 60, total_price: 999 }),
  ];
  const reference = rankBuilds({ builds: base });
  const refOrder = reference.ranked.map((e) => e.build.components[0].product_id);
  const refRanks = reference.ranked.map((e) => e.rank);

  for (const perm of [
    [4, 3, 2, 1, 0],
    [0, 4, 1, 3, 2],
    [2, 1, 0, 4, 3],
    [3, 0, 4, 1, 2],
  ]) {
    const shuffled = perm.map((i) => base[i]);
    const result = rankBuilds({ builds: shuffled });
    assert.deepEqual(
      result.ranked.map((e) => e.build.components[0].product_id),
      refOrder
    );
        assert.deepEqual(result.ranked.map((e) => e.rank), refRanks);
  }
});

// ---------------------------------------------------------------------------
// top_n: first min(n, TOP_N_PERSISTED) entries; zero builds -> frozen empties.
// ---------------------------------------------------------------------------
test('zero builds -> frozen { ranked: [], top_n: [] }', () => {
  const result = rankBuilds({ builds: [] });
  assert.deepEqual(result, { ranked: [], top_n: [] });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.ranked));
  assert.ok(Object.isFrozen(result.top_n));
});

test('single build ranks 1', () => {
  const r = rankBuilds({ builds: [fullBuild({})] });
  assert.equal(r.ranked.length, 1);
  assert.equal(r.top_n.length, 1);
  assert.equal(r.ranked[0].rank, 1);
});

test('9 builds -> ranked 9, top_n 9', () => {
  const builds = Array.from({ length: 9 }, (_, i) =>
    fullBuild({ CPU: 'cpu-' + i, build_score: 90 - i, total_price: 100 + i })
  );
  const r = rankBuilds({ builds });
  assert.equal(r.ranked.length, 9);
  assert.equal(r.top_n.length, 9);
});

test('10 builds -> top_n capped at TOP_N_PERSISTED', () => {
  const builds = Array.from({ length: 10 }, (_, i) =>
    fullBuild({ CPU: 'cpu-' + i, build_score: 90 - i, total_price: 100 + i })
  );
  const r = rankBuilds({ builds });
  assert.equal(r.ranked.length, 10);
  assert.equal(r.top_n.length, TOP_N_PERSISTED);
});

test('11 builds -> ranked 11, top_n capped at TOP_N_PERSISTED', () => {
  const builds = Array.from({ length: 11 }, (_, i) =>
    fullBuild({ CPU: 'cpu-' + i, build_score: 90 - i, total_price: 100 + i })
  );
  const r = rankBuilds({ builds });
  assert.equal(r.ranked.length, 11);
  assert.equal(r.top_n.length, TOP_N_PERSISTED);
});

test('25 builds -> ranked 25, top_n capped at TOP_N_PERSISTED', () => {
  const builds = Array.from({ length: 25 }, (_, i) =>
    fullBuild({ CPU: 'cpu-' + i, build_score: 90 - i, total_price: 100 + i })
  );
  const r = rankBuilds({ builds });
  assert.equal(r.ranked.length, 25);
  assert.equal(r.top_n.length, TOP_N_PERSISTED);
});

test('scores ascending: top_n holds the highest-scoring builds', () => {
  const builds = Array.from({ length: 25 }, (_, i) =>
    fullBuild({ CPU: 'cpu-' + i, build_score: 1 + i, total_price: 100 + i })
  );
    const r = rankBuilds({ builds });
  assert.deepEqual(
    r.top_n.map((e) => e.build.components[0].product_id),
    Array.from({ length: TOP_N_PERSISTED }, (_, i) => 'cpu-' + (24 - i))
  );
});

// ---------------------------------------------------------------------------
// Input immutability + output freezing + entry shape.
// ---------------------------------------------------------------------------
test('does not mutate caller-owned input builds or arrays', () => {
  const builds = [
    fullBuild({ CPU: 'cpu-1', build_score: 90, total_price: 300 }),
    fullBuild({ CPU: 'cpu-2', build_score: 80, total_price: 200 }),
  ];
  const snapshot = builds.map((b) => JSON.parse(JSON.stringify(b)));
  rankBuilds({ builds });
  assert.deepEqual(builds, snapshot);
});

test('every ranked entry is deeply frozen and carries the original build by reference', () => {
  const builds = [fullBuild({ CPU: 'cpu-ref', build_score: 90, total_price: 300 })];
  const ranked = rankBuilds({ builds }).ranked;
  assert.ok(Object.isFrozen(ranked[0]));
  assert.ok(Object.isFrozen(ranked[0].build));
  assert.strictEqual(ranked[0].build, builds[0]);
});

test('ranked entries have exactly the contract keys, in order', () => {
  const entry = rankBuilds({ builds: [fullBuild({})] }).ranked[0];
  assert.deepEqual(Object.keys(entry), [
    'rank',
    'build',
    'build_score',
    'total_price',
    'compatibility_status',
    'signature',
    'explanation',
  ]);
});

test('explanation is null on every entry', () => {
  const builds = Array.from({ length: 5 }, (_, i) =>
    fullBuild({ CPU: 'cpu-' + i, build_score: 50 + i, total_price: 100 + i })
  );
  for (const entry of rankBuilds({ builds }).ranked) {
    assert.equal(entry.explanation, null);
  }
});

test('output is deeply frozen: top_n entries frozen too', () => {
  const builds = Array.from({ length: 12 }, (_, i) =>
    fullBuild({ CPU: 'cpu-' + i, build_score: 90 - i, total_price: 100 + i })
  );
  const r = rankBuilds({ builds });
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.ranked));
  assert.ok(Object.isFrozen(r.top_n));
  for (const entry of r.top_n) {
    assert.ok(Object.isFrozen(entry));
  }
});

// ---------------------------------------------------------------------------
// Duplicate signatures -> fail fast (rank must not be input-order-dependent).
// ---------------------------------------------------------------------------
test('duplicate signatures fail fast (INVALID_FIELD_VALUE, field "builds")', () => {
  const builds = [
    fullBuild({ CPU: 'cpu-same', build_score: 90, total_price: 100 }),
    fullBuild({ CPU: 'cpu-same', build_score: 80, total_price: 200 }),
  ];
  const err = rejectionOf(() => rankBuilds({ builds }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  assert.equal(err.field, 'builds');
});

test('duplicate signatures different scores still fail fast', () => {
  const builds = [fullBuild({ build_score: 90 }), fullBuild({ build_score: 10 })];
  assert.throws(() => rankBuilds({ builds }), CandidateSelectionError);
});

// ---------------------------------------------------------------------------
// Validation fail-fast paths (Decision 18 Rule 1).
// ---------------------------------------------------------------------------
test('non-array builds -> INVALID_INPUT', () => {
  const err = rejectionOf(() => rankBuilds({ builds: {} }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_INPUT);
});

test('missing required build fields -> MISSING_REQUIRED_FIELD', () => {
  const err = rejectionOf(() => rankBuilds({ builds: [{}] }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
});

test('build_score out of [0,100] fails', () => {
  for (const score of [-1, 100.1, NaN, Infinity, '50']) {
    const err = rejectionOf(() => rankBuilds({ builds: [fullBuild({ build_score: score })] }));
    assert.ok(err instanceof CandidateSelectionError, 'score ' + score + ' must fail');
    assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  }
});

test('build_score boundaries 0 and 100 are accepted', () => {
  assert.equal(rejectionOf(() => rankBuilds({ builds: [fullBuild({ build_score: 0 })] })), null);
  assert.equal(rejectionOf(() => rankBuilds({ builds: [fullBuild({ build_score: 100 })] })), null);
});

test('non-positive / non-finite total_price fails', () => {
  for (const price of [0, -1, NaN, Infinity, '100']) {
    const err = rejectionOf(() => rankBuilds({ builds: [fullBuild({ total_price: price })] }));
    assert.ok(err instanceof CandidateSelectionError, 'price ' + price + ' must fail');
    assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  }
});

test('currency must match /^[A-Z]{3}$/; absent currency -> MISSING_REQUIRED_FIELD', () => {
  for (const currency of ['mad', 'MAD1', 'M', 'mad ', 'US', 100]) {
    const err = rejectionOf(() => rankBuilds({ builds: [fullBuild({ currency })] }));
    assert.ok(err instanceof CandidateSelectionError, 'currency ' + currency + ' must fail');
    assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  }
  const absent = deepFreeze({
    components: [component('CPU', CPU)],
    build_score: 50,
    total_price: 100,
    unknown_pairwise_count: 0,
  });
  const err = rejectionOf(() => rankBuilds({ builds: [absent] }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
});

test('unknown_pairwise_count must be a non-negative integer; absent -> MISSING_REQUIRED_FIELD', () => {
  for (const count of [-1, 1.5, '0', NaN]) {
    const err = rejectionOf(() => rankBuilds({ builds: [fullBuild({ unknown_pairwise_count: count })] }));
    assert.ok(err instanceof CandidateSelectionError, 'count ' + count + ' must fail');
    assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
  }
  for (const count of [null, undefined]) {
    const raw = {
      components: [component('CPU', CPU)],
      build_score: 50,
      total_price: 100,
      currency: 'MAD',
    };
    if (count !== undefined) raw.unknown_pairwise_count = count;
    const err = rejectionOf(() => rankBuilds({ builds: [deepFreeze(raw)] }));
    assert.ok(err instanceof CandidateSelectionError);
    assert.equal(err.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
  }
});

test('empty components array fails', () => {
  const build = deepFreeze({
    components: [],
    build_score: 50,
    total_price: 100,
    currency: 'MAD',
    unknown_pairwise_count: 0,
  });
  const err = rejectionOf(() => rankBuilds({ builds: [build] }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('duplicate role within a build fails', () => {
  const build = deepFreeze({
    components: [component('CPU', 'c1'), component('CPU', 'c2'), component('MOTHERBOARD', MB)],
    build_score: 50,
    total_price: 100,
    currency: 'MAD',
    unknown_pairwise_count: 0,
  });
  const err = rejectionOf(() => rankBuilds({ builds: [build] }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('unknown component role fails', () => {
  const build = deepFreeze({
    components: [component('SSD_SECONDARY', 'sec')],
    build_score: 50,
    total_price: 100,
    currency: 'MAD',
    unknown_pairwise_count: 0,
  });
  const err = rejectionOf(() => rankBuilds({ builds: [build] }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('empty product_id fails', () => {
  const build = deepFreeze({
    components: [component('CPU', '', { product_variant_id: null })],
    build_score: 50,
    total_price: 100,
    currency: 'MAD',
    unknown_pairwise_count: 0,
  });
  const err = rejectionOf(() => rankBuilds({ builds: [build] }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('non-string/non-null product_variant_id fails', () => {
  const build = deepFreeze({
    components: [component('CPU', CPU, { product_variant_id: 5 })],
    build_score: 50,
    total_price: 100,
    currency: 'MAD',
    unknown_pairwise_count: 0,
  });
  const err = rejectionOf(() => rankBuilds({ builds: [build] }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

test('invalid component status fails', () => {
  const build = deepFreeze({
    components: [component('CPU', CPU, { status: 'FAIL' })],
    build_score: 50,
    total_price: 100,
    currency: 'MAD',
    unknown_pairwise_count: 0,
  });
  const err = rejectionOf(() => rankBuilds({ builds: [build] }));
  assert.ok(err instanceof CandidateSelectionError);
  assert.equal(err.code, ERROR_CODES.INVALID_FIELD_VALUE);
});

// ---------------------------------------------------------------------------
// Boundary: ranking/ must not require pg, fs, dotenv, scripts, or any other
// engine module - only the assembly public barrel (for EXPANSION_ORDER).
// Mirrors the assemble.test.js needle technique.
// ---------------------------------------------------------------------------
test('rank.js requires only assembly barrel + candidates/errors', () => {
  const source = fs.readFileSync(path.join(__dirname, 'rank.js'), 'utf8');
  const requires = [...source.matchAll(/require\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(requires, ['../assembly', '../candidates/errors']);
});

test('rank.js does not reach for pg / fs / dotenv / other engines', () => {
  // Strip comments so policy words in prose cannot self-match (DEVELOPMENT
  // NOTES, 2026-09-21: comment-stripping before substring bans).
  const source = fs
    .readFileSync(path.join(__dirname, 'rank.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\\n]*/g, '$1');
  const banned = [
    "require('pg')",
    "require('node:pg')",
    "require('dotenv')",
    "require('fs')",
    'new Pool',
    '.query(',
    'INSERT',
    'UPDATE ',
    'DELETE ',
    'COMMIT',
    'localeCompare',
  ];
  for (const token of banned) {
    assert.ok(!source.includes(token), 'rank.js must not contain ' + token);
  }
  for (const needle of [
    '../orchestrator',
    '../persistence',
    '../query',
    '../offers',
    '../filtering',
    '../retention',
    '../scoring',
    '../candidates/roles',
    '../candidates/input',
  ]) {
    assert.ok(!source.includes(needle), 'rank.js must not reference ' + needle);
  }
});

// ---------------------------------------------------------------------------
// Integration-style test: hand-built builds shaped exactly like orchestrator
// output (frozen Engine 3 build spread with build_score, as withBuildScore).
// ---------------------------------------------------------------------------
test('integration: orchestrator-shaped frozen builds rank end-to-end', () => {
  // Mirrors orchestrator/run.js withBuildScore: {...build, build_score}.
  const mkBuild = (ids, score, price) => ({
    ...deepFreeze({
      components: [
        component('CPU', ids.CPU),
        component('MOTHERBOARD', ids.MB),
        component('RAM', ids.RAM),
        component('GPU', ids.GPU),
        component('PSU', ids.PSU),
        component('CASE', ids.C),
        component('CPU_COOLER', ids.CL),
        component('SSD_BOOT', ids.SSD),
      ],
      total_price: price,
      currency: 'MAD',
      unknown_pairwise_count: 0,
    }),
    build_score: score,
  });

  const builds = [
    mkBuild(
      { CPU: 'X', MB: 'mX', RAM: 'rX', GPU: 'gX', PSU: 'pX', C: 'cX', CL: 'lX', SSD: 'sX' },
      95,
      7500
    ),
    mkBuild(
      { CPU: 'Y', MB: 'mY', RAM: 'rY', GPU: 'gY', PSU: 'pY', C: 'cY', CL: 'lY', SSD: 'sY' },
      95,
      7000
    ),
    mkBuild(
      { CPU: 'Z', MB: 'mZ', RAM: 'rZ', GPU: 'gZ', PSU: 'pZ', C: 'cZ', CL: 'lZ', SSD: 'sZ' },
      88,
      6000
    ),
  ];

  const r = rankBuilds({ builds });
  assert.equal(r.ranked.length, 3);
  assert.equal(r.top_n.length, 3);

  // Rank 1: score 95, price 7000 -> cpu-Y.
  assert.equal(r.ranked[0].rank, 1);
  assert.equal(r.ranked[0].build_score, 95);
  assert.equal(r.ranked[0].total_price, 7000);
  assert.equal(r.ranked[0].compatibility_status, 'PASS');
  assert.equal(r.ranked[0].explanation, null);
  assert.strictEqual(r.ranked[0].build, builds[1]);

  // Rank 2: score 95, price 7500 -> cpu-X.
  assert.equal(r.ranked[1].rank, 2);
  assert.equal(r.ranked[1].build_score, 95);
  assert.strictEqual(r.ranked[1].build, builds[0]);

  // Rank 3: score 88 -> cpu-Z.
  assert.equal(r.ranked[2].rank, 3);
  assert.equal(r.ranked[2].build_score, 88);
  assert.strictEqual(r.ranked[2].build, builds[2]);

  assert.deepEqual(r.ranked.map((e) => e.rank), [1, 2, 3]);
});

test('integration: omitted-GPU (iGPU) build ranks with empty GPU:: slot first', () => {
  const shared = { CPU: 'c', MB: 'm', RAM: 'r', PSU: 'p', C: 'ca', CL: 'cl', SSD: 's' };
  const mk = (gpu) => ({
    ...deepFreeze({
      components: [
        component('CPU', shared.CPU),
        component('MOTHERBOARD', shared.MB),
        component('RAM', shared.RAM),
        ...(gpu ? [component('GPU', gpu)] : []),
        component('PSU', shared.PSU),
        component('CASE', shared.C),
        component('CPU_COOLER', shared.CL),
        component('SSD_BOOT', shared.SSD),
      ],
      total_price: 100,
      currency: 'MAD',
      unknown_pairwise_count: 0,
    }),
    build_score: 50,
  });

  const withGpu = mk('gpu-1');
  const withoutGpu = mk(null);
  const r = rankBuilds({ builds: [withGpu, withoutGpu] });
  // Same score, same price -> signature ASC; `GPU::` (omit) sorts first.
  assert.strictEqual(r.ranked[0].build, withoutGpu);
  assert.strictEqual(r.ranked[1].build, withGpu);
  assert.ok(r.ranked[0].signature < r.ranked[1].signature);
});





