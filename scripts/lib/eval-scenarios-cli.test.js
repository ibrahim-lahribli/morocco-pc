'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, preflight, renderBaseline, renderVolatile } = require('../eval-scenarios');

test('preflight rejects zero or multiple active models before loading one', async () => {
  for (const n of [0, 2]) {
    const calls = [];
    const db = { async query(sql) {
      calls.push(sql);
      if (sql === 'SELECT 1 AS ok') return { rows: [{ ok: 1 }] };
      assert.equal(sql, 'SELECT count(*)::int AS n FROM scoring_model WHERE is_active = true');
      return { rows: [{ n }] };
    } };
    await assert.rejects(preflight(db), new RegExp('found ' + n));
    assert.equal(calls.length, 2);
  }
});

test('preflight accepts exactly one active model and formats freshness as ISO', async () => {
  const responses = [
    [{ ok: 1 }], [{ n: 1 }], [{ id: 'model', name: 'seed', version: '1' }],
    [{ products: 100, offers: 101, assessments: 280 }],
    [{ oldest: new Date('2026-10-04T04:27:18Z'), fresh: 101, total: 101 }],
  ];
  const db = { async query(sql) {
    assert.ok(!sql.includes('LIMIT 1'));
    return { rows: responses.shift() };
  } };
  const meta = await preflight(db);
  assert.equal(meta.freshness.oldest, '2026-10-04T04:27:18.000Z');
  assert.equal(meta.scoringModel.id, 'model');
  assert.equal(responses.length, 0);
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

test('CLI exposes sidecar path and opt-out', () => {
  assert.equal(parseArgs(['node', 'cli', '--volatile=custom.json']).volatile, 'custom.json');
  assert.equal(parseArgs(['node', 'cli', '--no-volatile']).volatile, false);
});
