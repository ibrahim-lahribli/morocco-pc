'use strict';

// scripts/lib/schema-diff.js — pure comparison of two schema snapshots.
//
// Used by scripts/verify-migrations-replay.js to decide whether replaying the
// migration tree into an empty database reproduces the live schema. Pure: no
// database, no clock, no filesystem, no randomness. Both sides are passed in,
// so every rule here is unit-testable without a database.
//
// WHY THIS COMPARES DEFINITIONS, NOT NAMES
//
// The first replay of migration 001->015 (2026-10-05, docs/OPEN_GAPS.md C-30)
// compared object NAMES across six classes and reported zero drift. That
// result was too weak to trust: a CHECK constraint that keeps its name while
// its body changes -- `CHECK ((x > 0))` becoming `CHECK ((x >= 0))` -- would
// have been reported as faithful, and the same applies to an index whose
// columns, method or predicate changed. So the snapshot strings the caller
// passes in must embed the definition, not just the identifier: for
// constraints and indexes that means pg_get_constraintdef() and indexdef, and
// for columns it means type, nullability and default rather than column name.
// The tests in schema-diff.test.js pin that difference, and callers are
// responsible for building snapshots that honour this contract.
//
// NOT PART OF `npm run test:unit` (that glob is `src/**/*.test.js`); run the
// tests with `npm run test:scripts`.

/**
 * Compare two schema snapshots class by class.
 *
 * @param {Record<string, string[]>} fresh snapshot produced by replaying the
 *   migration tree into an empty database.
 * @param {Record<string, string[]>} live snapshot taken from the live database.
 * @returns {{hasDrift: boolean, byClass: Record<string, {onlyFresh: string[], onlyLive: string[]}>}}
 *   `byClass` has one entry for every class appearing on EITHER side -- a class
 *   missing from one snapshot is treated as an empty array, never as agreement.
 */
function compareSchemaSnapshot(fresh, live) {
  const freshSide = fresh || {};
  const liveSide = live || {};

  // Union of class names: a class present on only one side is drift, so it must
  // appear in the result rather than being dropped by whichever side was absent.
  const classes = new Set([
    ...Object.keys(freshSide),
    ...Object.keys(liveSide),
  ]);

  const byClass = {};
  let hasDrift = false;

  for (const name of classes) {
    const freshItems = Array.isArray(freshSide[name]) ? freshSide[name] : [];
    const liveItems = Array.isArray(liveSide[name]) ? liveSide[name] : [];

    // Membership, not order: the two snapshots are built by separate queries
    // whose row order is not meaningful, so sorting or zipping would invent
    // drift that does not exist.
    const liveSet = new Set(liveItems);
    const freshSet = new Set(freshItems);

    const onlyFresh = freshItems.filter((item) => !liveSet.has(item));
    const onlyLive = liveItems.filter((item) => !freshSet.has(item));

    byClass[name] = { onlyFresh, onlyLive };
    if (onlyFresh.length > 0 || onlyLive.length > 0) hasDrift = true;
  }

  return { hasDrift, byClass };
}

module.exports = { compareSchemaSnapshot };
