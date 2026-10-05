'use strict';

// scripts/lib/schema-diff.test.js — tests for the pure schema comparison used
// by scripts/verify-migrations-replay.js.
//
// Uses node:test + node:assert/strict only. Tests compareSchemaSnapshot()
// (both snapshots passed as parameters; no file or DB access). NOT part of
// `npm run test:unit` (that glob is `src/**/*.test.js`); run with:
//   npm run test:scripts

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { compareSchemaSnapshot } = require('./schema-diff');

describe('compareSchemaSnapshot', () => {
  it('reports no drift when both sides are identical', () => {
    const snap = { columns: ['a.b :: text :: text :: nullable'], checks: ['a.c1 :: CHECK ((x > 0))'] };
    assert.equal(compareSchemaSnapshot(snap, snap).hasDrift, false);
  });

  // This is the C-30 lesson. The first replay pass compared object NAMES, so
  // a CHECK that kept its name but changed body would have been reported as
  // faithful. The comparison must be by definition.
  it('a same-named CHECK with a different body is drift', () => {
    const fresh = { checks: ['a.c1 :: CHECK ((x > 0))'] };
    const live = { checks: ['a.c1 :: CHECK ((x >= 0))'] };
    const r = compareSchemaSnapshot(fresh, live);
    assert.equal(r.hasDrift, true);
    assert.deepEqual(r.byClass.checks.onlyLive, ['a.c1 :: CHECK ((x >= 0))']);
    assert.deepEqual(r.byClass.checks.onlyFresh, ['a.c1 :: CHECK ((x > 0))']);
  });

  it('an index present live but not fresh is live-only drift', () => {
    const r = compareSchemaSnapshot(
      { indexes: [] },
      { indexes: ['CREATE INDEX i ON t USING btree (a)'] },
    );
    assert.deepEqual(r.byClass.indexes.onlyLive, ['CREATE INDEX i ON t USING btree (a)']);
    assert.deepEqual(r.byClass.indexes.onlyFresh, []);
    assert.equal(r.hasDrift, true);
  });

  it('a column whose type differs is drift', () => {
    const r = compareSchemaSnapshot(
      { columns: ['t.c :: text :: text :: nullable'] },
      { columns: ['t.c :: integer :: int4 :: nullable'] },
    );
    assert.equal(r.hasDrift, true);
    assert.deepEqual(r.byClass.columns.onlyLive, ['t.c :: integer :: int4 :: nullable']);
  });

  it('class ordering does not affect the verdict', () => {
    const fresh = { columns: ['x', 'y'], indexes: ['i1'] };
    const live = { columns: ['y', 'x'], indexes: ['i1'] };
    assert.equal(compareSchemaSnapshot(fresh, live).hasDrift, false);
  });

  // A missing key must be treated as an EMPTY class, not as agreement. If it
  // were treated as "both sides fine", every item on the present side would be
  // silently dropped and a whole class of drift would go unreported.
  it('a class present on one side only surfaces as drift, not silently ignored', () => {
    const only = { fks: ['a.fk1 :: FOREIGN KEY (x) REFERENCES t(y)'] };
    const r = compareSchemaSnapshot(only, {});
    assert.equal(r.hasDrift, true);
    assert.deepEqual(r.byClass.fks.onlyFresh, ['a.fk1 :: FOREIGN KEY (x) REFERENCES t(y)']);
    assert.deepEqual(r.byClass.fks.onlyLive, []);
  });

  it('an empty class on both sides is not drift', () => {
    assert.equal(compareSchemaSnapshot({ fks: [] }, {}).hasDrift, false);
  });

  it('an empty snapshot on both sides is not drift', () => {
    assert.equal(compareSchemaSnapshot({}, {}).hasDrift, false);
  });
});
