'use strict';

// ---------------------------------------------------------------------------
// Decision 12 (src/recommendation/retention/): barrel-contract test.
//
// This file proves ONLY the boundary decision: retention/index.js is the
// canonical public surface and re-exports the pure retention function by
// identity without duplicating logic. Retention semantics (Rules 2-5,
// ordering, capping, freezing) are NOT re-tested here (see retain.test.js).
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const retention = require('./index');
const retain = require('./retain');
const budgetFloor = require('./budget-floor');

test('retention barrel exposes exactly its two-function public API', () => {
  assert.deepEqual(Object.keys(retention), [
    'retainTopKPerRole',
    'BUDGET_FLOOR_ROLES',
    'computeBudgetFloor',
  ]);
  assert.equal(typeof retention.retainTopKPerRole, 'function');
  assert.equal(retention.retainTopKPerRole.length, 1);
  assert.equal(typeof retention.computeBudgetFloor, 'function');
  assert.equal(retention.computeBudgetFloor.length, 1);
  assert.ok(Array.isArray(retention.BUDGET_FLOOR_ROLES));
  assert.ok(Object.isFrozen(retention.BUDGET_FLOOR_ROLES));
});

test('retention barrel re-exports by identity - no wrapper, no copy', () => {
  assert.strictEqual(retention.retainTopKPerRole, retain.retainTopKPerRole);
  assert.strictEqual(retention.computeBudgetFloor, budgetFloor.computeBudgetFloor);
  assert.strictEqual(retention.BUDGET_FLOOR_ROLES, budgetFloor.BUDGET_FLOOR_ROLES);
});

test('retention keeps its source boundary (pure composition, no DB, no SQL)', () => {
  const banned = [
    "require('pg')",
    "require('node:pg')",
    'new Pool',
    '.query(',
    'SELECT ',
    'INSERT ',
    'UPDATE ',
    'DELETE ',
    '../compatibility',
    '../scoring',
    '../offers',
    // Decision 27 item 3 permits exactly one Engine 3 import, priceKey from
    // ../assembly/prices, so the price-carrier key format keeps a single owner.
    // The ban is not lifted - it is AIMED: the assembler and everything else
    // behind that barrel stay forbidden by name, as does reaching upward.
    '../assembly/assemble',
    '../assembly/pipeline',
    '../assembly/gpu-policy',
    '../assembly/input',
    '../assembly/index',
    '../orchestrator',
    '../persistence',
  ];
  // Scanned with comments stripped, because Decision 27's boundary comment
  // has to NAME the forbidden specifiers in order to explain the ban, and a raw
  // substring scan would fail the documentation for documenting itself. The
  // complementary check below pins the real direction - the exact require list -
  // so stripping comments cannot hide an actual import.
  for (const file of ['index.js', 'retain.js', 'budget-floor.js']) {
    const source = stripComments(fs.readFileSync(path.join(__dirname, file), 'utf8'));
    for (const token of banned) {
      assert.ok(!source.includes(token), `${file} must not contain ${token}`);
    }
  }
  // ...and the prose really does carry the ban, so the comment cannot silently
  // stop naming what it forbids.
  const retainHeader = fs.readFileSync(path.join(__dirname, 'retain.js'), 'utf8');
  for (const token of ['../assembly/assemble', '../orchestrator', '../persistence']) {
    assert.ok(retainHeader.includes(token), `retain.js must document the ban on ${token}`);
  }
});

/** Comments removed, code kept - the same helper orchestrator/run.test.js uses. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('retain.js imports exactly the composed sources and nothing else', () => {
  const source = fs.readFileSync(path.join(__dirname, 'retain.js'), 'utf8');
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)]
    .map((match) => match[1])
    .sort();
  // Sorted: '../assembly/prices' is the single permitted Engine 3 import
  // (Decision 27 item 3) and is the only addition to the pre-Decision-27 set.
  assert.deepEqual(requires, [
    '../assembly/prices',
    '../candidates/errors',
    '../candidates/roles',
    '../candidates/select',
    '../filtering/filter',
  ]);
});