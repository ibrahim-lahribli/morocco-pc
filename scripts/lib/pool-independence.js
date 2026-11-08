'use strict';

// scripts/lib/pool-independence.js - the PURE verdict half of the PI-1 gate
// (Decision 23 criterion 3). `scripts/verify-pool-independence.js` owns the DB
// work; this module owns "what the numbers mean", so every branch is testable
// without a database.
//
// WHY THIS EXISTS
// The gate used to answer PASS whenever nothing drifted - including when there
// was nothing to drift. Measured 2026-11-08 on the TEST branch, it compared 0
// builds with 0 builds at BOTH pins (`GAMING: 0 ranked build(s)`, same for
// OFFICE) and printed `RESULT: PASS`, because the snapshot it drives has
// `allow_unverified_seed_offers` off and that branch carries only 2 VERIFIED
// offers: its seed catalogue is invisible to the run. A gate that reports PASS
// over an empty comparison asserts pool independence about nothing, which is
// the failure mode the register warns about for every other gate
// (`check-offer-provenance` / `check-catalog-identity` both print INCONCLUSIVE
// rather than PASS over an empty scope).
//
// RULES
//   FAIL          - some profile saw at least one pre-existing build_score move
//                   (or a build disappear). This is the real signal and it wins
//                   over everything else, even if other profiles were empty.
//   INCONCLUSIVE  - NO profile produced a single pre-existing build, so nothing
//                   could have moved. Exit 0 (the repo's convention for
//                   INCONCLUSIVE: `--fail-days`, provenance, catalogue
//                   identity), but NEVER the string PASS.
//   PASS          - at least one profile compared real builds and none drifted.
//                   A profile that assembled nothing is reported as inconclusive
//                   beside the PASS so a partial run is not read as a full one.

const VERDICTS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
});

// INCONCLUSIVE exits 0 by repo convention; it is a statement about the
// MEASUREMENT, not a pass claim.
const EXIT_CODES = Object.freeze({
  PASS: 0,
  INCONCLUSIVE: 0,
  FAIL: 1,
});

/**
 * Classify one measured profile.
 *
 * @param {{ label: string, beforeSize: number, driftCount: number }} profile
 *   `beforeSize` is the number of ranked builds captured BEFORE the probe was
 *   added (i.e. how many builds could possibly drift); `driftCount` is how many
 *   of them moved afterwards.
 * @returns {{ label: string, verdict: string, conclusive: boolean }}
 */
function classifyProfile(profile) {
  if (!profile || typeof profile.label !== 'string' || profile.label.length === 0) {
    throw new Error('pool-independence: a profile needs a non-empty label');
  }
  const beforeSize = profile.beforeSize;
  const driftCount = profile.driftCount;
  if (!Number.isInteger(beforeSize) || beforeSize < 0) {
    throw new Error('pool-independence: ' + profile.label + ' has an invalid beforeSize '
      + JSON.stringify(beforeSize));
  }
  if (!Number.isInteger(driftCount) || driftCount < 0) {
    throw new Error('pool-independence: ' + profile.label + ' has an invalid driftCount '
      + JSON.stringify(driftCount));
  }
  if (driftCount > 0) {
    // A drifted build is a contradicted invariant, whatever else was empty.
    return { label: profile.label, verdict: VERDICTS.FAIL, conclusive: true };
  }
  if (beforeSize === 0) {
    return { label: profile.label, verdict: VERDICTS.INCONCLUSIVE, conclusive: false };
  }
  return { label: profile.label, verdict: VERDICTS.PASS, conclusive: true };
}

/**
 * Classify a whole run.
 *
 * @param {Array<{ label: string, beforeSize: number, driftCount: number }>} profiles
 * @returns {{ verdict: string, exitCode: number, failed: string[],
 *   conclusive: string[], inconclusive: string[] }}
 */
function classifyRun(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    // No profile at all is the emptiest comparison there is. It must never PASS.
    return {
      verdict: VERDICTS.INCONCLUSIVE,
      exitCode: EXIT_CODES.INCONCLUSIVE,
      failed: [],
      conclusive: [],
      inconclusive: [],
    };
  }
  const classified = profiles.map(classifyProfile);
  const failed = classified.filter((p) => p.verdict === VERDICTS.FAIL).map((p) => p.label);
  const conclusive = classified.filter((p) => p.conclusive).map((p) => p.label);
  const inconclusive = classified
    .filter((p) => p.verdict === VERDICTS.INCONCLUSIVE)
    .map((p) => p.label);

  if (failed.length > 0) {
    return { verdict: VERDICTS.FAIL, exitCode: EXIT_CODES.FAIL, failed, conclusive, inconclusive };
  }
  if (conclusive.length === 0) {
    return {
      verdict: VERDICTS.INCONCLUSIVE,
      exitCode: EXIT_CODES.INCONCLUSIVE,
      failed,
      conclusive,
      inconclusive,
    };
  }
  return { verdict: VERDICTS.PASS, exitCode: EXIT_CODES.PASS, failed, conclusive, inconclusive };
}

module.exports = {
  VERDICTS,
  EXIT_CODES,
  classifyProfile,
  classifyRun,
};
