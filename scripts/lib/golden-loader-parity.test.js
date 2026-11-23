'use strict';

// DB-free pins for the golden loader-parity comparator. The behavioural half
// (real loaders) is scripts/check-golden-loader-parity.js and needs a database;
// these tests fix the semantics the gate depends on:
//
//   - numbers compare at 6 decimal places, like compute.golden.test.js;
//   - a UUID is an identity, equal to any other UUID in 'mask' mode and a value
//     in 'strict' mode;
//   - UUID-keyed carriers (prices / assessments / specs) compare as multisets,
//     so a different uuid assignment is not a false failure;
//   - array order is not asserted (content comparison only);
//   - a missing fixture half or an unrun loader is UNMEASURED, never PASS and
//     never FAIL;
//   - a real value change is FAIL, with the first differing path.
//
//   node --test scripts/lib/golden-loader-parity.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const parity = require('./golden-loader-parity');

const UUID_A = '0ffb5661-95db-47e4-8c18-27b6b772a150';
const UUID_B = '17025732-419f-45ab-ac2e-02e63a3f6456';
const UUID_C = '196d2d54-7e93-4f2f-b323-17523ca88ecc';

describe('number precision', () => {
  it('treats values equal at 6 dp as equal and a 7th-place change as a difference', () => {
    const same = parity.compareComponent({
      label: 'x', actual: { score: 64.5678901 }, expected: { score: 64.5678904 }, measured: true,
    });
    assert.equal(same.status, 'PASS');

    const different = parity.compareComponent({
      label: 'x', actual: { score: 64.567890 }, expected: { score: 64.567891 }, measured: true,
    });
    assert.equal(different.status, 'FAIL');
    assert.equal(different.differences[0].path, 'score');
  });

  it('does not round the inputs in place', () => {
    const live = { score: 1.23456789 };
    parity.compareComponent({ label: 'x', actual: live, expected: { score: 1.23456789 }, measured: true });
    assert.equal(live.score, 1.23456789);
  });
});

describe('identity handling', () => {
  it("mask mode treats two different UUIDs as equal at the same path", () => {
    const result = parity.compareComponent({
      label: 'pool',
      actual: { product_id: UUID_A, component_role: 'CPU' },
      expected: { product_id: UUID_B, component_role: 'CPU' },
      measured: true,
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.identities, 1);
  });

  it('strict mode treats a different UUID as a difference', () => {
    const result = parity.compareComponent({
      label: 'pool',
      actual: { product_id: UUID_A },
      expected: { product_id: UUID_B },
      measured: true,
      identityMode: 'strict',
    });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.differences[0].path, 'product_id');
  });

  it('compares a UUID-keyed carrier as a multiset of values, not by key', () => {
    const result = parity.compareComponent({
      label: 'prices',
      actual: { ['["' + UUID_A + '",null,"CPU"]']: { price: 1800, currency: 'MAD' } },
      expected: { ['["' + UUID_B + '",null,"CPU"]']: { price: 1800, currency: 'MAD' } },
      measured: true,
    });
    assert.equal(result.status, 'PASS');
  });

  it('still fails when a carrier VALUE differs', () => {
    const result = parity.compareComponent({
      label: 'prices',
      actual: { ['["' + UUID_A + '",null,"CPU"]']: { price: 1899 } },
      expected: { ['["' + UUID_B + '",null,"CPU"]']: { price: 1800 } },
      measured: true,
    });
    assert.equal(result.status, 'FAIL');
  });

  it('does not mask a UUID embedded in an ordinary string value', () => {
    const result = parity.compareComponent({
      label: 'x',
      actual: { note: 'see ' + UUID_A },
      expected: { note: 'see ' + UUID_B },
      measured: true,
    });
    assert.equal(result.status, 'FAIL');
  });
});

describe('row-audit clocks', () => {
  it('compares created_at/updated_at for presence, not seed time, in mask mode', () => {
    const result = parity.compareComponent({
      label: 'scoringModel',
      actual: { name: 'launch-v2', created_at: '2026-11-22T01:00:00.000Z', updated_at: '2026-11-22T01:00:00.000Z' },
      expected: { name: 'launch-v2', created_at: '2026-10-08T20:00:00.000Z', updated_at: '2026-10-08T20:00:00.000Z' },
      measured: true,
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.clocks, 2);
  });

  it('still fails when the audit clock is missing from one side', () => {
    const result = parity.compareComponent({
      label: 'scoringModel',
      actual: { name: 'launch-v2' },
      expected: { name: 'launch-v2', created_at: '2026-10-08T20:00:00.000Z' },
      measured: true,
    });
    assert.equal(result.status, 'FAIL');
  });

  it('does not mask value-bearing timestamps', () => {
    const result = parity.compareComponent({
      label: 'assessments',
      actual: { assessed_at: 1790819858106 },
      expected: { assessed_at: 1790819858999 },
      measured: true,
    });
    assert.equal(result.status, 'FAIL');
  });

  it('compares audit clocks as values in strict mode', () => {
    const result = parity.compareComponent({
      label: 'scoringModel',
      actual: { created_at: '2026-11-22T01:00:00.000Z' },
      expected: { created_at: '2026-10-08T20:00:00.000Z' },
      measured: true,
      identityMode: 'strict',
    });
    assert.equal(result.status, 'FAIL');
  });
});

describe('dates', () => {
  it('compares a Date from a loader with the fixture ISO string', () => {
    const result = parity.compareComponent({
      label: 'scoringModel',
      actual: { created_at: new Date('2026-10-08T20:00:00.000Z') },
      expected: { created_at: '2026-10-08T20:00:00.000Z' },
      measured: true,
      identityMode: 'strict',
    });
    assert.equal(result.status, 'PASS');
  });

  it('detects a genuinely different Date on a value-bearing key', () => {
    const result = parity.compareComponent({
      label: 'prices',
      actual: { price_checked_at: new Date('2026-11-22T00:00:00.000Z') },
      expected: { price_checked_at: '2026-10-08T20:00:00.000Z' },
      measured: true,
    });
    assert.equal(result.status, 'FAIL');
  });
});

describe('order', () => {
  it('compares arrays of objects by content, not position', () => {
    const result = parity.compareComponent({
      label: 'pool',
      actual: [{ product_id: UUID_A, component_role: 'CPU' }, { product_id: UUID_B, component_role: 'GPU' }],
      expected: [{ product_id: UUID_C, component_role: 'GPU' }, { product_id: UUID_B, component_role: 'CPU' }],
      measured: true,
    });
    assert.equal(result.status, 'PASS');
  });

  it('still detects a missing array member', () => {
    const result = parity.compareComponent({
      label: 'pool',
      actual: [{ product_id: UUID_A, component_role: 'CPU' }],
      expected: [{ product_id: UUID_B, component_role: 'CPU' }, { product_id: UUID_C, component_role: 'CPU' }],
      measured: true,
    });
    assert.equal(result.status, 'FAIL');
  });
});

describe('dispositions', () => {
  it('reports an unrun loader as UNMEASURED, never PASS or FAIL', () => {
    const result = parity.compareComponent({
      label: 'query', actual: null, expected: { input: {} }, measured: false, reason: 'no query row',
    });
    assert.equal(result.status, 'UNMEASURED');
    assert.equal(result.reason, 'no query row');
  });

  it('reports a missing fixture half as UNMEASURED', () => {
    const result = parity.compareComponent({
      label: 'assessments', actual: {}, expected: undefined, measured: true,
    });
    assert.equal(result.status, 'UNMEASURED');
    assert.match(result.reason, /no committed fixture half/);
  });

  it('a scenario is UNMEASURED only when every component is', () => {
    const allUnmeasured = parity.compareScenario({
      fixture: {},
      live: {},
      unmeasuredReasons: { query: 'no row' },
    });
    assert.equal(allUnmeasured.status, 'UNMEASURED');

    const partial = parity.compareScenario({
      fixture: { scoringModel: { name: 'launch-v2' } },
      live: { scoringModel: { name: 'launch-v2' } },
    });
    assert.equal(partial.status, 'PASS');
    assert.equal(partial.components.find((c) => c.label === 'query').status, 'UNMEASURED');
  });

  it('a scenario FAILs when any component FAILs', () => {
    const result = parity.compareScenario({
      fixture: { scoringModel: { name: 'launch-v2' }, assessments: {} },
      live: { scoringModel: { name: 'seed-minimal-v1' }, assessments: {} },
    });
    assert.equal(result.status, 'FAIL');
  });

  it('covers exactly the six loader halves the fixture carries', () => {
    assert.deepEqual(parity.COMPONENT_LABELS.slice().sort(),
      ['assessments', 'candidatePoolResult', 'filterResult', 'filteringContext', 'query', 'scoringModel']);
  });
});
