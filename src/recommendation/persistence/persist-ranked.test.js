'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { persistRanked } = require('./persist-ranked');
const { CandidateSelectionError } = require('../candidates/errors');
const QUERY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';
const TS1 = '2026-09-20T12:00:00.000Z';
const TS2 = '2026-09-21T08:30:00.000Z';
const SQL_CAND = 'INSERT INTO build_candidate (id, recommendation_query_id, total_price, score, compatibility_status) VALUES ($1,$2,$3,$4,$5)';
const SQL_COMP = 'INSERT INTO build_component (id, build_candidate_id, product_id, product_variant_id, component_role, selected_price, currency, store_id, price_checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)';
const SQL_RES = 'INSERT INTO recommendation_result (id, recommendation_query_id, build_candidate_id, rank, explanation) VALUES ($1,$2,$3,$4,$5)';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function makeClient() {
  return { calls: [], async query(sql, params) { this.calls.push({ sql, params }); return { rows: [] }; } };
}
function makePrice(sp, cur, sid, at) {
  return { selected_price: sp, currency: cur, store_id: sid, price_checked_at: at };
}
function makeComp(role, pid, variant, priceObj, status) {
  return { component_role: role, product_id: pid, product_variant_id: variant, category: 'IGNORED-CAT', status: status || 'PASS', price: priceObj };
}
function makeBuild8() {
  return { currency: 'ZZZ-NOT-PERSISTED', components: [
    makeComp('CPU', 'cpu-1', null, makePrice(1000, 'MAD', STORE_A, TS1)),
    makeComp('GPU', 'gpu-1', 'gpu-1-var', makePrice(2000, 'MAD', STORE_B, TS2)),
    makeComp('MOTHERBOARD', 'mb-1', null, makePrice(1500, 'MAD', STORE_A, TS1)),
    makeComp('RAM', 'ram-1', 'ram-1-var', makePrice(800, 'MAD', STORE_B, TS2)),
    makeComp('SSD_BOOT', 'ssd-1', null, makePrice(600, 'MAD', STORE_A, TS1)),
    makeComp('SSD_SECONDARY', 'ssd-2', null, makePrice(500, 'MAD', null, null)),
    makeComp('PSU', 'psu-1', null, makePrice(700, 'MAD', STORE_A, TS2)),
    makeComp('CASE', 'case-1', null, makePrice(900, 'MAD', STORE_B, TS1)) ] };
}
function makeBuild7() {
  return { currency: 'YYY-NOT-PERSISTED', components: [
    makeComp('CPU', 'cpu-2', null, makePrice(1100, 'EUR', STORE_A, TS2), 'UNKNOWN'),
    makeComp('MOTHERBOARD', 'mb-2', null, makePrice(1400, 'EUR', STORE_B, TS1)),
    makeComp('RAM', 'ram-2', 'ram-2-var', makePrice(850, 'EUR', STORE_A, TS2)),
    makeComp('SSD_BOOT', 'ssd-3', null, makePrice(650, 'EUR', null, TS1)),
    makeComp('PSU', 'psu-2', null, makePrice(750, 'EUR', STORE_B, TS2)),
    makeComp('CASE', 'case-2', null, makePrice(950, 'EUR', STORE_A, TS1)),
    makeComp('CPU_COOLER', 'cooler-2', null, makePrice(350, 'EUR', STORE_B, TS2)) ] };
}
function makeEntry(rank, build, overrides) {
  const o = overrides || {};
  return { persisted_rank: rank,
    build_score: rank === 1 ? 85.5 : 80,
    total_price: rank === 1 ? 12000 : 9000,
    compatibility_status: rank === 1 ? 'PASS' : 'UNKNOWN',
    signature: 'sig-' + rank,
    explanation: o.explanation !== undefined ? o.explanation : ('Explanation for rank ' + rank), build };
}
function snap(v) { return JSON.parse(JSON.stringify(v)); }
test('happy path exact SQL and params', async () => {
  const client = makeClient();
  const b1 = makeBuild8();
  const b2 = makeBuild7();
  const selected = [makeEntry(1, b1), makeEntry(2, b2)];
  const result = await persistRanked({ client, queryId: QUERY_ID, selected });
  const bc0 = result.build_candidate_ids[0];
  const bc1 = result.build_candidate_ids[1];
  const rr0 = result.recommendation_result_ids[0];
  const rr1 = result.recommendation_result_ids[1];
  assert.equal(client.calls.length, 19);
  assert.equal(client.calls[0].sql, SQL_CAND);
  assert.deepEqual(client.calls[0].params, [bc0, QUERY_ID, 12000, 85.5, 'PASS']);
  let k = 1;
  for (let i = 0; i < b1.components.length; i += 1) {
    const c = b1.components[i];
    assert.equal(client.calls[k].sql, SQL_COMP);
    assert.match(client.calls[k].params[0], UUID_V4_RE);
    assert.deepEqual(client.calls[k].params.slice(1), [bc0, c.product_id, c.product_variant_id, c.component_role, c.price.selected_price, c.price.currency, c.price.store_id, c.price.price_checked_at]);
    k += 1;
  }
  assert.equal(client.calls[k].sql, SQL_RES);
  assert.deepEqual(client.calls[k].params, [rr0, QUERY_ID, bc0, 1, 'Explanation for rank 1']);
  k += 1;
  assert.equal(client.calls[k].sql, SQL_CAND);
  assert.deepEqual(client.calls[k].params, [bc1, QUERY_ID, 9000, 80, 'UNKNOWN']);
  k += 1;
  for (let i = 0; i < b2.components.length; i += 1) {
    const c = b2.components[i];
    assert.equal(client.calls[k].sql, SQL_COMP);
    assert.match(client.calls[k].params[0], UUID_V4_RE);
    assert.deepEqual(client.calls[k].params.slice(1), [bc1, c.product_id, c.product_variant_id, c.component_role, c.price.selected_price, c.price.currency, c.price.store_id, c.price.price_checked_at]);
    k += 1;
  }
  assert.equal(client.calls[k].sql, SQL_RES);
  assert.deepEqual(client.calls[k].params, [rr1, QUERY_ID, bc1, 2, 'Explanation for rank 2']);
  assert.deepEqual(result.persisted_ranks, [1, 2]);
  assert.equal(result.query_id, QUERY_ID);
});
test('price from component price', async () => {
  const client = makeClient();
  const b1 = makeBuild8();
  const b2 = makeBuild7();
  await persistRanked({ client, queryId: QUERY_ID, selected: [makeEntry(1, b1), makeEntry(2, b2)] });
  const cc = client.calls.filter((c) => c.sql === SQL_COMP);
  assert.equal(cc.length, 15);
  const all = b1.components.concat(b2.components);
  for (let i = 0; i < cc.length; i += 1) {
    assert.equal(cc[i].params[5], all[i].price.selected_price);
    assert.equal(cc[i].params[6], all[i].price.currency);
    assert.equal(cc[i].params[7], all[i].price.store_id);
    assert.equal(cc[i].params[8], all[i].price.price_checked_at);
  }
  for (const call of cc) {
    assert.ok(call.params.indexOf('ZZZ-NOT-PERSISTED') === -1);
    assert.ok(call.params.indexOf('YYY-NOT-PERSISTED') === -1);
  }
});
test('explanation persisted from entry', async () => {
  const client = makeClient();
  const selected = [makeEntry(1, makeBuild8(), { explanation: 'Ranked 1: Dominant GPU' })];
  const result = await persistRanked({ client, queryId: QUERY_ID, selected });
  const rc = client.calls.filter((c) => c.sql === SQL_RES);
  assert.equal(rc.length, 1);
  assert.strictEqual(rc[0].params[4], 'Ranked 1: Dominant GPU');
  assert.equal(result.recommendation_result_ids.length, 1);
});
test('zero selected', async () => {
  const client = makeClient();
  const result = await persistRanked({ client, queryId: QUERY_ID, selected: [] });
  assert.equal(client.calls.length, 0);
  assert.deepEqual(result, { query_id: QUERY_ID, persisted_ranks: [], build_candidate_ids: [], recommendation_result_ids: [] });
});
test('invalid throws zero calls', async () => {
  const client = makeClient();
  const bad = [makeEntry(1, makeBuild8()), makeEntry(3, makeBuild7())];
  await assert.rejects(() => persistRanked({ client, queryId: QUERY_ID, selected: bad }), (e) => e instanceof CandidateSelectionError);
  assert.equal(client.calls.length, 0);
});
test('frozen no mutate', async () => {
  const client = makeClient();
  const selected = [makeEntry(1, makeBuild8()), makeEntry(2, makeBuild7())];
  const before = snap(selected);
  const result = await persistRanked({ client, queryId: QUERY_ID, selected });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.persisted_ranks));
  assert.ok(Object.isFrozen(result.build_candidate_ids));
  assert.ok(Object.isFrozen(result.recommendation_result_ids));
  assert.deepEqual(snap(selected), before);
});
test('uuids unique', async () => {
  const client = makeClient();
  const result = await persistRanked({ client, queryId: QUERY_ID, selected: [makeEntry(1, makeBuild8()), makeEntry(2, makeBuild7())] });
  const cids = client.calls.filter((c) => c.sql === SQL_COMP).map((c) => c.params[0]);
  const all = result.build_candidate_ids.concat(cids, result.recommendation_result_ids);
  assert.equal(all.length, 19);
  for (const id of all) { assert.match(id, UUID_V4_RE); }
  assert.equal(new Set(all).size, all.length);
});
test('boundary persistence only', () => {
  const source = fs.readFileSync(path.join(__dirname, 'persist-ranked.js'), 'utf8');
  assert.ok(source.includes("require('./validate-selected')"));
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(stripped.includes('client.query'));
  assert.ok(stripped.includes('$1'));
  const banned = ["require('pg')", 'new Pool', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SELECT', '../orchestrator', '../assembly', '../scoring', '../retention', '../filtering', '../candidates/', '../offers'];
  for (const t of banned) { assert.ok(!stripped.includes(t), 'no ' + t); }
  assert.ok(stripped.indexOf('../query') === -1);
  assert.ok(stripped.indexOf('Math.random') === -1);
  assert.ok(stripped.indexOf('Date.now') === -1);
});
