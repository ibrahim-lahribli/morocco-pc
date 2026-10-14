'use strict';

// Unit tests for the OG-11 resolver (rule 8, RAM module_count vs motherboard
// dimm_slots, E8 / Decision 45). Unlike OG-09 this rule is HARD: an over-slot
// kit cannot be installed, so it FAILs and the candidate is REJECTed. The
// other behaviours pinned here: a NULL operand is UNKNOWN (never a pass, never
// "unlimited"), and the boundary is inclusive.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveRamMotherboardSlots } = require('./memory-slots');
const { REASON_CODES } = require('./reason-codes');
const { FINAL_STATUSES } = require('./statuses');

const RAM = 'ram-1';
const MB = 'mb-1';

function base(overrides = {}) {
  return {
    ram_product_id: RAM,
    motherboard_product_id: MB,
    ram_module_count: 2,
    motherboard_dimm_slots: 4,
    ...overrides,
  };
}

test('OG-11: a kit using fewer slots than the board has PASSes, with spare slots in evidence', () => {
  const r = resolveRamMotherboardSlots(base());
  assert.equal(r.status, FINAL_STATUSES.PASS);
  assert.equal(r.reason, null);
  assert.equal(r.evidence[0].ram_module_count, 2);
  assert.equal(r.evidence[0].motherboard_dimm_slots, 4);
  assert.equal(r.evidence[0].spare_slots, 2);
});

test('OG-11: the boundary is INCLUSIVE - a kit filling every slot exactly is valid', () => {
  const r = resolveRamMotherboardSlots(base({ ram_module_count: 4, motherboard_dimm_slots: 4 }));
  assert.equal(r.status, FINAL_STATUSES.PASS);
  assert.equal(r.evidence[0].spare_slots, 0);
});

test('OG-11: one module over the slot count FAILs with RAM_SLOTS_EXCEEDED', () => {
  const r = resolveRamMotherboardSlots(base({ ram_module_count: 5, motherboard_dimm_slots: 4 }));
  assert.equal(r.status, FINAL_STATUSES.FAIL);
  assert.equal(r.reason, REASON_CODES.RAM_SLOTS_EXCEEDED);
  assert.equal(r.evidence[0].over_by_slots, 1);
});

test('OG-11: a 4-module kit on a 2-slot board FAILs (the architecture section 6 case)', () => {
  const r = resolveRamMotherboardSlots(base({ ram_module_count: 4, motherboard_dimm_slots: 2 }));
  assert.equal(r.status, FINAL_STATUSES.FAIL);
  assert.equal(r.reason, REASON_CODES.RAM_SLOTS_EXCEEDED);
  assert.equal(r.evidence[0].over_by_slots, 2);
});

test('OG-11: a NULL module_count is UNKNOWN, never a PASS', () => {
  const r = resolveRamMotherboardSlots(base({ ram_module_count: null }));
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.RAM_SLOTS_UNKNOWN);
  assert.equal(r.evidence[0].ram_module_count, null);
});

test('OG-11: a NULL dimm_slots is UNKNOWN, never "unlimited"', () => {
  const r = resolveRamMotherboardSlots(base({ motherboard_dimm_slots: null }));
  assert.equal(r.status, FINAL_STATUSES.UNKNOWN);
  assert.equal(r.reason, REASON_CODES.RAM_SLOTS_UNKNOWN);
});

test('OG-11: non-finite operands are UNKNOWN, never compared', () => {
  for (const bad of [NaN, Infinity, '4', undefined, {}]) {
    const r = resolveRamMotherboardSlots(base({ motherboard_dimm_slots: bad }));
    assert.equal(r.status, FINAL_STATUSES.UNKNOWN, String(bad));
    assert.equal(r.reason, REASON_CODES.RAM_SLOTS_UNKNOWN, String(bad));
  }
});

test('OG-11: a non-object input throws', () => {
  assert.throws(() => resolveRamMotherboardSlots(null), TypeError);
  assert.throws(() => resolveRamMotherboardSlots(42), TypeError);
});
