'use strict';

// packages/recommendation-runtime/test/surface.test.js — what each exported
// namespace may contain, and the negative half of the split.
//
// test/export-surface.json pins the ROOT keys; this pins the second level and
// the boundary between the two packages (RFC §9.3): a name belongs to exactly
// one of them. The core publishes the pure members of the three mixed barrels
// (candidates, filtering, scoring); the runtime publishes their loaders (see
// docs/MIXED_BARRELS.md). If the two surfaces overlapped, a shim or an
// orchestrator could resolve the wrong implementation without a type error, so
// the overlap check is executable here rather than left to review.
//
// DB-free and dependency-free: node:test + node:assert only.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('..');
const core = require('../../recommendation-core');

// RFC §11.5: the runtime publishes these three namespaces and nothing else.
const ALLOWED_NAMESPACES = ['loaders', 'orchestrator', 'persistence'];

function namespaceKeys(namespaces) {
  const keys = new Set();
  for (const name of Object.keys(namespaces)) {
    for (const key of Object.keys(namespaces[name])) keys.add(key);
  }
  return keys;
}

describe('runtime namespaces', () => {
  it('publishes only the RFC §11.5 namespaces', () => {
    for (const name of Object.keys(runtime)) {
      assert.ok(
        ALLOWED_NAMESPACES.includes(name),
        'runner: ' + name + ' is not one of ' + ALLOWED_NAMESPACES.join(', ')
      );
    }
  });

  it('shares no public name with the core', () => {
    // The core side is asserted non-empty first, so this check cannot pass by
    // loading an empty object.
    const coreRootKeys = Object.keys(core);
    assert.ok(coreRootKeys.length > 0, 'recommendation-core must export at least one namespace');

    for (const name of Object.keys(runtime)) {
      assert.equal(coreRootKeys.includes(name), false, name + ' is a core namespace name');
    }

    const coreKeys = namespaceKeys(core);
    const runtimeKeys = namespaceKeys(runtime);
    assert.ok(coreKeys.size > 0, 'recommendation-core namespaces must export at least one member');
    const overlap = [...runtimeKeys].filter((key) => coreKeys.has(key)).sort();
    assert.deepEqual(
      overlap,
      [],
      'runtime re-exports names the core already owns: ' + overlap.join(', ') +
        '. A runtime namespace carries the SQL-side half of a split barrel only (docs/MIXED_BARRELS.md).'
    );
  });
});
