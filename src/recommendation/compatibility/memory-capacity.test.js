'use strict';

// Unit tests for the OG-12 resolver (rule 9, total RAM capacity vs the
// motherboard's max_memory_capacity_gb, E8 / Decision 45). HARD: a kit above
// the board's addressable maximum is a definitive REJECT. The capacity is
// DERIVED (module_count * capacity_per_module_gb), so all three operands must
// be known - any NULL is UNKNOWN, never a pass and never "unlimited".

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveRamMotherboardCapacity } = require('./memory-capacity');
const { REASON_CODES } = require('./reason-codes');
const { FINAL_STATUSES } = require('./statuses');

const RAM = 'ram-1';
const MB = 'mb-1';

function base(overrides = {}) {
  return {
    ram_product_id: RAM,
    motherboard_product_id: MB,
    ram_module_count: 2,
    ram_capacity_per_module_gb: 8,
    motherboard_max_memory_capacity_gb: 128,
    ...overrides,
  };
}

test('OG-12: a kit below the board ceiling PASSes, with headroom in evidence', () => {
  const r = resolveRamMotherboardCapacity(base());
  assert.equal(r.status, FINAL_STATUSES.PASS);
  assert.equal(r.reason, null);
  assert.equal(r.evidence[0].kit_total_gb, 16);
  assert.equal(r.evidence[0].motherboard_max_memory_capacity_gb, 128);
  assert.equal(r.evidence[0].headroom_gb, 112);
});

test('OG-12: the boundary is INCLUSIVE - a kit exactly at the board ceiling is valid', () => {
  const r = resolveRamMotherboardCapacity(
    base({ ram_module_count: 4, ram_capacity_per_module_gb: 8, motherboard_max_memory_capacity_gb: 32 })
  );
  assert.equal(r.status, FINAL_STATUSES.PASS);
  assert.equal(r.evidence[0].headroom_gb, 0);
});

test('OG-12: the total is DERIVED - 4 x 16 GB over a 32 GB board FAILs with RAM_CAPACITY_EXCEEDED', () => {
  const r = resolveRamMotherboardCapacity(
    base({ ram_module_count: 4, ram_capacity_per_module_gb: 16, motherboard_max_memory_capacity_gb: 32 })
  );
  assert.equal(r.status, FINAL_STATUSES.FAIL);
  assert.equal(r.reason, REASON_CODES.RAM_CAPACITY_EXCEEDED);
  assert.equal(r.evidence[0].kit_total_gb, 64);
  assert.equal(r.evidence[0].over_by_gb, 32);
});

test('OG-12: one gigabyte over the ceiling FAILs', () => {
  const r = resolveRamMotherboardCapacity(
    base({ ram_module_count: 1, ram_capacity_per_module_gb: 33, motherboard_max_memory_capacity_gb: 32 })
  );
  assert.equal(r.status, FINAL_STATUSES.FAIL);
  assert.equal(r.reason, REASON_CODES.RAM_CAPACITY_EXCEEDED);
});

test('OG-12: a NULL board maximum is UNKNOWN, never "unlimited"', () => {
  const r = resolveRamMotherboardCapacity(base({ motherboard_max_memory_capacity_gb: null }));
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.RAM_CAPACITY_UNKNOWN);
  assert.equal(r.evidence[0].motherboard_max_memory_capacity_gb, null);
});

test('OG-12: a NULL module_count or capacity_per_module_gb is UNKNOWN (the total cannot be derived)', () => {
  for (const key of ['ram_module_count', 'ram_capacity_per_module_gb']) {
    const r = resolveRamMotherboardCapacity(base({ [key]: null }));
    assert.equal(r.status, FINAL_STATUSES.UNKNOWN, key);
    assert.equal(r.reason, REASON_CODES.RAM_CAPACITY_UNKNOWN, key);
  }
});

test('OG-12: non-finite operands are UNKNOWN, never compared', () => {
  for (const bad of [NaN, Infinity, '32', undefined, {}]) {
    const r = resolveRamMotherboardCapacity(base({ motherboard_max_memory_capacity_gb: bad }));
    assert.equal(r.status, FINAL_STATUSES.UNKNOWN, String(bad));
    assert.equal(r.reason, REASON_CODES.RAM_CAPACITY_UNKNOWN, String(bad));
  }
});

test('OG-12: a non-object input throws', () => {
  assert.throws(() => resolveRamMotherboardCapacity(null), TypeError);
  assert.throws(() => resolveRamMotherboardCapacity(42), TypeError);
});
