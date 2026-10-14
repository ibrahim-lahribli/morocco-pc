'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, preflight, renderBaseline, renderVolatile } = require('../eval-scenarios');
const modelPin = require('./model-pin');

test('preflight resolves the DEFAULT pin with bound parameters and never takes an arbitrary row', async () => {
  const calls = [];
  const responses = [
    [{ ok: 1 }],
    [{ id: 'model', name: 'seed-minimal-v1', version: '1.0.0', configuration: {} }],
    [{ products: 100, offers: 101, assessments: 280 }],
    [{ oldest: new Date('2026-10-04T04:27:18Z'), fresh: 101, total: 101 }],
  ];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    assert.ok(!sql.includes('LIMIT 1'), 'the pin must never resolve by taking one arbitrary row');
    return { rows: responses.shift() };
  } };
  const meta = await preflight(db);
  assert.equal(meta.scoringModel.id, 'model');
  assert.equal(meta.scoringModel.name, 'seed-minimal-v1');
  assert.deepEqual(calls[1].params, ['seed-minimal-v1', '1.0.0'],
    'the legacy identity is bound as a parameter, not interpolated');
  assert.equal(meta.freshness.oldest, '2026-10-04T04:27:18.000Z');
  assert.equal(responses.length, 0, 'no query beyond the four the preflight needs');
});

test('preflight accepts an explicit pin, so a two-active-model branch is measurable', async () => {
  const calls = [];
  const responses = [
    [{ ok: 1 }],
    [{ id: 'v2', name: 'launch-v2', version: '1.0.0', configuration: {} }],
    [{ products: 100, offers: 101, assessments: 280 }],
    [{ oldest: new Date('2026-10-04T04:27:18Z'), fresh: 101, total: 101 }],
  ];
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: responses.shift() }; } };
  const meta = await preflight(db, 'launch-v2@1.0.0');
  assert.equal(meta.scoringModel.name, 'launch-v2');
  assert.equal(meta.scoringModel.version, '1.0.0');
  assert.deepEqual(calls[1].params, ['launch-v2', '1.0.0']);
});

test('preflight fails closed on an ambiguous, inactive or unmatched pin, before any catalog query', async () => {
  const cases = [
    ['ambiguous', [{ id: 'a', name: 'x', version: '1' }, { id: 'b', name: 'x', version: '1' }], [], [],
      /ambiguous, refusing to guess/],
    ['inactive', [], [{ is_active: false }], [{ name: 'seed-minimal-v1', version: '1.0.0' }],
      /exists but is NOT ACTIVE.*seed-minimal-v1@1\.0\.0/s],
    ['unmatched', [], [], [{ name: 'seed-minimal-v1', version: '1.0.0' }],
      /matched no row\. Active: seed-minimal-v1@1\.0\.0/],
  ];
  for (const [label, pinned, exists, active, pattern] of cases) {
    const seen = [];
    const db = { async query(sql) {
      seen.push(sql);
      if (sql === 'SELECT 1 AS ok') return { rows: [{ ok: 1 }] };
      if (sql === modelPin.PIN_SQL) return { rows: pinned };
      if (sql === modelPin.PIN_EXISTS_SQL) return { rows: exists };
      if (sql === modelPin.ACTIVE_MODELS_SQL) return { rows: active };
      throw new Error(label + ': the pin must fail before any catalog query, but got ' + sql);
    } };
    await assert.rejects(preflight(db, 'x@1'), pattern, label);
  }
});

test('CLI exposes the model pin alongside the sidecar path and opt-out', () => {
  assert.equal(parseArgs(['node', 'cli', '--volatile=custom.json']).volatile, 'custom.json');
  assert.equal(parseArgs(['node', 'cli', '--no-volatile']).volatile, false);
  assert.equal(parseArgs(['node', 'cli']).model, null);
  assert.equal(parseArgs(['node', 'cli', '--model=launch-v2@1.0.0']).model, 'launch-v2@1.0.0');
});

test('baseline ignores volatile rows while sidecar preserves full evidence and ISO timestamps', () => {
  const row = { assertion: 'A8', scenario_ids: ['S09'], status: 'PASS', disposition: 'PASS',
    measured: { ranked_count: 25, max_score_delta: 0.00001 }, expected: 'identical', detail: '' };
  const stable = { assertion: 'A2', scenario_ids: ['S03'], status: 'PASS', disposition: 'PASS', measured: 3, expected: 'growth' };
  const args = {
    meta: { date: '2026-10-08', branch: 'agent/engine', scoringModel: { name: 'seed', version: '1', id: 'model' },
      counts: { products: 100, offers: 101, assessments: 280 }, freshness: { oldest: '2026-10-04T04:27:18.000Z', fresh: 101, total: 101 } },
    suite: {}, selected: [], artifacts: new Map(), results: [stable, row], fullRuns: [], pi1: null,
  };
  const first = renderBaseline(args);
  const changed = { ...row, status: 'FAIL', disposition: 'EXPECTED-RED', measured: { max_score_delta: 0.00002 }, detail: 'signature order changed' };
  const second = renderBaseline({ ...args, results: [stable, changed],
    meta: { ...args.meta, freshness: { oldest: '2026-10-05T00:00:00.000Z', fresh: 0, total: 101 } } });
  assert.equal(first, second);
  assert.ok(!first.includes('max_score_delta'));
  assert.ok(!first.includes('04:27:18'));
  const sidecar = renderVolatile({ freshness: args.meta.freshness, results: [stable, changed], pi1: null });
  assert.deepEqual(sidecar.results, [changed]);
  assert.deepEqual(sidecar.a8_rows.S09, changed);
  assert.equal(sidecar.offer_freshness.oldest_iso, '2026-10-04T04:27:18.000Z');
  assert.equal(new Date(sidecar.generated_at).toISOString(), sidecar.generated_at);
});

test('baseline renders identities, prices, total and GPU share for every row, including no-build rows', () => {
  const best = { cpu_name: 'CPU | name', cpu_price: 400, gpu_name: 'GPU name', gpu_price: 300,
    cooler_name: 'Cooler name', cooler_price: 200, total_price: 1000 };
  const artifact = { best, build_count: 1, ranked_count: 1, selected: [], selected_pair_count: 0,
    best_gpu_price_share: 0.3, best_cpu_ram_share: 0.5 };
  const text = renderBaseline({ meta: { date: '2026-10-08', branch: 'agent/engine',
    scoringModel: { name: 'seed', version: '1', id: 'model' }, counts: {} }, suite: {},
    selected: [{ id: 'S1', budget: 12000 }, { id: 'S0', budget: 1 }],
    artifacts: new Map([['S1', artifact], ['S0', { ...artifact, best: null, build_count: 0, ranked_count: 0,
      best_gpu_price_share: null, best_cpu_ram_share: null }]]), results: [], fullRuns: [], pi1: null });
  assert.ok(text.includes('| S1 | 1 | 1 | CPU &#124; name | 400 | GPU name | 300 | Cooler name | 200 | 1000 | 0.3 |'));
  assert.ok(text.includes('| S0 | 0 | 0 | - | - | - | - | - | - | - | - |'));
});
