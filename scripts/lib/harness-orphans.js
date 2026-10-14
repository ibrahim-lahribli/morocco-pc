'use strict';

// scripts/lib/harness-orphans.js - pure marker + orphan-selection logic (E0e).
//
// No DB access, no I/O, no clock: the impure caller (scripts/eval-scenarios.js)
// supplies rows read from the branch and performs the deletes this module
// selects. Keeping it pure is what makes the selection DB-free testable.
//
// Why this exists: a killed harness run (tool timeout, SIGKILL, a dropped
// connection) commits its recommendation_query rows but never reaches the
// harness `finally`, leaving rows nobody can attribute to a run. Measured on
// test-engine 2026-10-08: 60 such rows in 3 clusters of 20. So every row the
// harness inserts is linked to a recommendation_profile whose NAME carries a
// unique run id. A later run can then recognise - and delete - ONLY rows the
// harness itself wrote.
//
// Safety invariant, tested below: nothing outside HARNESS_PROFILE_PREFIX is
// ever selected. A query is deletable iff its recommendation_profile_id is a
// profile whose name starts with the prefix. NULL profiles, unknown profile
// ids, and non-prefixed names are unmarked and must never be deleted.

const HARNESS_PROFILE_PREFIX = 'golden-eval-';

/** Build the marker profile name for one run. */
function harnessProfileName(runId) {
  if (typeof runId !== 'string' || runId.trim() === '') {
    throw new Error('harnessProfileName requires a non-empty run id');
  }
  return HARNESS_PROFILE_PREFIX + runId;
}

/** True only for a non-empty name that carries the harness prefix. */
function isHarnessProfileName(name) {
  return typeof name === 'string'
    && name.length > HARNESS_PROFILE_PREFIX.length
    && name.startsWith(HARNESS_PROFILE_PREFIX);
}

/**
 * Split profile rows into harness-owned and everything else. The `foreign`
 * bucket is returned for reporting only - it is never a delete target.
 */
function partitionProfiles(profiles) {
  const harness = [];
  const foreign = [];
  for (const row of profiles) {
    (isHarnessProfileName(row && row.name) ? harness : foreign).push(row);
  }
  return { harness, foreign };
}

/** Ids of harness-owned profiles - the only profile ids a delete may target. */
function harnessProfileIds(profiles) {
  return partitionProfiles(profiles).harness.map((row) => String(row.id));
}

/**
 * Classify every recommendation_query row. A row is `marked` iff it points at a
 * harness-owned profile id; a NULL/missing profile, or a profile outside the
 * harness prefix, is `unmarked`.
 */
function classifyQueries(queries, ownedProfileIds) {
  const owned = new Set((ownedProfileIds || []).map((id) => String(id)));
  const marked = [];
  const unmarked = [];
  for (const row of queries) {
    const profileId = row ? row.recommendation_profile_id : null;
    if (profileId !== null && profileId !== undefined && owned.has(String(profileId))) {
      marked.push(row);
    } else {
      unmarked.push(row);
    }
  }
  return { marked, unmarked };
}

/** Ids of the queries a harness cleanup may delete: marked rows only. */
function orphanQueryIds(queries, ownedProfileIds) {
  return classifyQueries(queries, ownedProfileIds).marked.map((row) => String(row.id));
}

module.exports = {
  HARNESS_PROFILE_PREFIX,
  harnessProfileName,
  isHarnessProfileName,
  partitionProfiles,
  harnessProfileIds,
  classifyQueries,
  orphanQueryIds,
};
