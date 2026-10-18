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
// P1 Sprint 2: the three writers are ONE multi-row INSERT each, so a pass issues
// three statements for any number of builds. `SELECT * FROM UNNEST(...)` is the
// row source - it unpacks the parameter arrays in the order they are passed and
// reads no table (see the boundary test at the bottom).
const SQL_CAND = 'INSERT INTO build_candidate (id, recommendation_query_id, total_price, score, compatibility_status) SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::numeric[], $4::numeric[], $5::compatibility_status[])';
const SQL_COMP = 'INSERT INTO build_component (id, build_candidate_id, product_id, product_variant_id, component_role, selected_price, currency, store_id, price_checked_at, offer_class, store_offer_id) SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::component_role[], $6::numeric[], $7::text[], $8::uuid[], $9::timestamptz[], $10::text[], $11::uuid[])';
const OFFER_ID = '33333333-3333-4333-8333-333333333333';
const SQL_RES = 'INSERT INTO recommendation_result (id, recommendation_query_id, build_candidate_id, rank, explanation) SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::uuid[], $4::integer[], $5::text[])';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function makeClient() {
  return { calls: [], async query(sql, params) { this.calls.push({ sql, params }); return { rows: [] }; } };
}
function makePrice(sp, cur, sid, at) {
  return {
    selected_price: sp,
    currency: cur,
    store_id: sid,
    price_checked_at: at,
    offer_id: OFFER_ID,
    offer_class: 'SEED_UNVERIFIED',
  };
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
function makeBuild6() {
  return { currency: 'XXX-NOT-PERSISTED', components: [
    makeComp('CPU', 'cpu-3', null, makePrice(1200, 'MAD', STORE_A, TS1)),
    makeComp('GPU', 'gpu-3', 'gpu-3-var', makePrice(2500, 'MAD', STORE_B, TS1)),
    makeComp('MOTHERBOARD', 'mb-3', null, makePrice(1600, 'MAD', STORE_A, TS2)),
    makeComp('RAM', 'ram-3', null, makePrice(900, 'MAD', STORE_B, TS1)),
    makeComp('SSD_BOOT', 'ssd-4', null, makePrice(700, 'MAD', STORE_A, TS2)),
    makeComp('PSU', 'psu-3', null, makePrice(800, 'MAD', STORE_B, TS1)) ] };
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
function callsOf(client, sql) { return client.calls.filter((c) => c.sql === sql); }
test('a 3-build pass issues exactly three INSERTs, with 3 / 22 / 3 rows', async () => {
  const client = makeClient();
  const b1 = makeBuild8();
  const b2 = makeBuild8();
  const b3 = makeBuild6();
  const selected = [makeEntry(1, b1), makeEntry(2, b2), makeEntry(3, b3)];
  const result = await persistRanked({ client, queryId: QUERY_ID, selected });
  // The whole point of P1 Sprint 2: three statements, not one per row.
  assert.equal(client.calls.length, 3);
  assert.equal(client.calls.filter((c) => c.sql.startsWith('INSERT INTO')).length, 3);
  const cand = client.calls[0];
  const comp = client.calls[1];
  const res = client.calls[2];
  assert.equal(cand.sql, SQL_CAND);
  assert.equal(comp.sql, SQL_COMP);
  assert.equal(res.sql, SQL_RES);
  // One parameter per COLUMN, one array element per ROW - and the counts are
  // the row counts: 3 builds, 22 components (8 + 8 + 6), 3 results.
  assert.equal(cand.params.length, 5);
  assert.equal(comp.params.length, 11);
  assert.equal(res.params.length, 5);
  for (const params of [cand.params, comp.params, res.params]) {
    for (const array of params) {
      assert.ok(Array.isArray(array), 'every parameter is an array');
    }
  }
  assert.equal(cand.params[0].length, 3);
  assert.equal(comp.params[0].length, 22);
  assert.equal(res.params[0].length, 3);
  for (const params of [cand.params, comp.params, res.params]) {
    for (const array of params) { assert.equal(array.length, params[0].length, 'arrays are the same length (UNNEST zips them)'); }
  }
  // Order is preserved: build_candidate in input order, then components in
  // entry order and zipped from the same arrays.
  assert.deepEqual(cand.params[1], [QUERY_ID, QUERY_ID, QUERY_ID]);
  assert.deepEqual(cand.params[2], [12000, 9000, 9000]);
  assert.deepEqual(cand.params[3], [85.5, 80, 80]);
  assert.deepEqual(cand.params[4], ['PASS', 'UNKNOWN', 'UNKNOWN']);
  assert.deepEqual(cand.params[0], result.build_candidate_ids);
  assert.deepEqual(res.params[3], [1, 2, 3]);
  assert.deepEqual(res.params[4], ['Explanation for rank 1', 'Explanation for rank 2', 'Explanation for rank 3']);
  assert.deepEqual(res.params[0], result.recommendation_result_ids);
  const all = b1.components.concat(b2.components, b3.components);
  assert.deepEqual(comp.params[2], all.map((c) => c.product_id));
  assert.deepEqual(comp.params[4], all.map((c) => c.component_role));
  assert.deepEqual(comp.params[5], all.map((c) => c.price.selected_price));
  assert.deepEqual(comp.params[6], all.map((c) => c.price.currency));
  assert.deepEqual(comp.params[9], all.map((c) => c.price.offer_class));
  assert.deepEqual(comp.params[10], all.map((c) => c.price.offer_id));
  // Every build_candidate id is shared by exactly its own components.
  assert.deepEqual(comp.params[1], new Array(8).fill(result.build_candidate_ids[0]).concat(
    new Array(8).fill(result.build_candidate_ids[1]),
    new Array(6).fill(result.build_candidate_ids[2])
  ));
  assert.deepEqual(result.persisted_ranks, [1, 2, 3]);
  assert.equal(result.query_id, QUERY_ID);
});
test('price from component price', async () => {
  const client = makeClient();
  const b1 = makeBuild8();
  const b2 = makeBuild7();
  await persistRanked({ client, queryId: QUERY_ID, selected: [makeEntry(1, b1), makeEntry(2, b2)] });
  const cc = callsOf(client, SQL_COMP);
  assert.equal(cc.length, 1);
  const all = b1.components.concat(b2.components);
  assert.equal(cc[0].params[0].length, 15);
  for (let i = 0; i < all.length; i += 1) {
    assert.equal(cc[0].params[5][i], all[i].price.selected_price);
    assert.equal(cc[0].params[6][i], all[i].price.currency);
    assert.equal(cc[0].params[7][i], all[i].price.store_id);
    assert.equal(cc[0].params[8][i], all[i].price.price_checked_at);
  }
  for (const array of cc[0].params) {
    for (const value of array) {
      assert.notEqual(value, 'ZZZ-NOT-PERSISTED');
      assert.notEqual(value, 'YYY-NOT-PERSISTED');
    }
  }
});
test('explanation persisted from entry', async () => {
  const client = makeClient();
  const selected = [makeEntry(1, makeBuild8(), { explanation: 'Ranked 1: Dominant GPU' })];
  const result = await persistRanked({ client, queryId: QUERY_ID, selected });
  const rc = callsOf(client, SQL_RES);
  assert.equal(rc.length, 1);
  assert.equal(rc[0].params[4][0], 'Ranked 1: Dominant GPU');
  assert.equal(result.recommendation_result_ids.length, 1);
});
test('a NULL product_variant_id is a null array element, never the string "null"', async () => {
  const client = makeClient();
  await persistRanked({ client, queryId: QUERY_ID, selected: [makeEntry(1, makeBuild6())] });
  const comp = callsOf(client, SQL_COMP)[0];
  const variants = comp.params[3];
  assert.equal(variants[0], null);
  for (const value of variants) {
    assert.notEqual(value, 'null');
    assert.notEqual(value, '');
  }
  // The same rule for the two price columns that are legitimately absent
  // (makeBuild8's SSD_SECONDARY has neither store nor checked-at).
  const b8 = makeBuild8();
  const client2 = makeClient();
  await persistRanked({ client: client2, queryId: QUERY_ID, selected: [makeEntry(1, b8)] });
  const comp2 = callsOf(client2, SQL_COMP)[0];
  assert.equal(comp2.params[7][5], null);
  assert.equal(comp2.params[8][5], null);
});
test('the three statements are issued even for a single build (no per-row fallback)', async () => {
  const client = makeClient();
  await persistRanked({ client, queryId: QUERY_ID, selected: [makeEntry(1, makeBuild7())] });
  assert.equal(client.calls.length, 3);
  assert.deepEqual(client.calls.map((c) => c.sql), [SQL_CAND, SQL_COMP, SQL_RES]);
  assert.equal(callsOf(client, SQL_COMP)[0].params[0].length, 7);
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
  const cids = callsOf(client, SQL_COMP)[0].params[0];
  const all = result.build_candidate_ids.concat(cids, result.recommendation_result_ids);
  assert.equal(all.length, 19);
  for (const id of all) { assert.match(id, UUID_V4_RE); }
  assert.equal(new Set(all).size, all.length);
});
test('the returned ids are the ids the database was given', async () => {
  const client = makeClient();
  const result = await persistRanked({ client, queryId: QUERY_ID, selected: [makeEntry(1, makeBuild8()), makeEntry(2, makeBuild7())] });
  const cand = callsOf(client, SQL_CAND)[0];
  const res = callsOf(client, SQL_RES)[0];
  assert.deepEqual(cand.params[0], result.build_candidate_ids);
  assert.deepEqual(res.params[0], result.recommendation_result_ids);
  // Every component id in the component arrays is one the writer generated and
  // returned nowhere else - the parameter and the fixture must not diverge.
  const compIds = callsOf(client, SQL_COMP)[0].params[0];
  assert.equal(compIds.length, 15);
  for (const id of compIds) { assert.match(id, UUID_V4_RE); }
});
test('boundary persistence only', () => {
  const source = fs.readFileSync(path.join(__dirname, 'persist-ranked.js'), 'utf8');
  assert.ok(source.includes("require('./validate-selected')"));
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(stripped.includes('client.query'));
  assert.ok(stripped.includes('$1'));
  // P1 Sprint 2: the ONE permitted SELECT is the multi-row insert's row source
  // (`SELECT * FROM UNNEST(...)`), which unpacks parameter arrays and reads no
  // table. Strip exactly that construct, then hold the rest of the ban.
  const withoutRowSource = stripped.replace(/SELECT \* FROM UNNEST\([^)]*\)/g, ' ');
  assert.ok(!withoutRowSource.includes('SELECT'), 'no SELECT outside the UNNEST row source');
  const banned = ["require('pg')", 'new Pool', 'BEGIN', 'COMMIT', 'ROLLBACK', '../orchestrator', '../assembly', '../scoring', '../retention', '../filtering', '../candidates/', '../offers'];
  for (const t of banned) { assert.ok(!withoutRowSource.includes(t), 'no ' + t); }
  assert.ok(withoutRowSource.indexOf('../query') === -1);
  assert.ok(withoutRowSource.indexOf('Math.random') === -1);
  assert.ok(withoutRowSource.indexOf('Date.now') === -1);
});
