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

test('retention barrel exposes exactly the one-function public API', () => {
  assert.deepEqual(Object.keys(retention), ['retainTopKPerRole']);
  assert.equal(typeof retention.retainTopKPerRole, 'function');
  assert.equal(retention.retainTopKPerRole.length, 1);
});

test('retention barrel re-exports by identity - no wrapper, no copy', () => {
  assert.strictEqual(retention.retainTopKPerRole, retain.retainTopKPerRole);
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
    '../assembly',
    '../scoring',
    '../offers',
  ];
  for (const file of ['index.js', 'retain.js']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const token of banned) {
      assert.ok(!source.includes(token), `${file} must not contain ${token}`);
    }
  }
});

test('retain.js imports exactly the composed sources and nothing else', () => {
  const source = fs.readFileSync(path.join(__dirname, 'retain.js'), 'utf8');
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(requires, [
    '../candidates/errors',
    '../candidates/roles',
    '../candidates/select',
    '../filtering/filter',
  ]);
});