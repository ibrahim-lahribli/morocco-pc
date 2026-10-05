'use strict';

// scripts/lib/score-vector.js — pure comparison of two build-score vectors,
// backing scripts/verify-pool-independence.js (Decision 23 criterion 3, PI-1).
//
// Pure: no database, no clock, no filesystem, no randomness. Both sides are
// passed in, so every rule is unit-testable without touching a database.
//
// WHAT PI-1 ASKS
// Decision 23 section 6 step 3: adding an unrelated product to the candidate
// pool must not change any EXISTING build's score. Its step (c) is explicit —
// "New builds may appear; existing builds' scores may not move". So the
// comparator is deliberately asymmetric: a signature present only in `after` is
// ignored, while a signature present only in `before` is drift, because a build
// that vanished is the strongest evidence the pool change reached scoring.
//
// WHY KEYED BY SIGNATURE
// Ranking is score DESC, price ASC, signature ASC (Decision 18), so a pool
// change can legitimately reorder equal-scoring builds. Comparing rows by
// position would report drift when nothing about the scores actually changed.
// The signature is the content key that survives reordering.
//
// NOT PART OF `npm run test:unit` (that glob is `src/**/*.test.js`); run the
// tests with `npm run test:scripts`.

/**
 * Capture a build's score vector from a ranked list.
 *
 * @param {Array<{signature: string, build_score: number}>} ranked ranked entries
 *   as returned by rankBuilds().
 * @returns {Map<string, number>} signature -> build_score.
 * @throws {TypeError} when `ranked` is neither an array nor nullish, when an
 *   entry has no usable signature, when a score is not a finite number, or when
 *   two entries share a signature. Each of those means the caller is feeding
 *   this something it should not, and guessing would turn a real defect into a
 *   silently wrong comparison.
 */
function captureScoreVector(ranked) {
  if (ranked === null || ranked === undefined) return new Map();
  if (!Array.isArray(ranked)) {
    throw new TypeError('captureScoreVector requires an array of ranked entries');
  }

  const vector = new Map();
  for (const entry of ranked) {
    const signature = entry && entry.signature;
    if (typeof signature !== 'string' || signature === '') {
      throw new TypeError('every ranked entry must carry a non-empty signature');
    }
    const score = entry.build_score;
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new TypeError(
        'build_score for signature "' + signature + '" must be a finite number',
      );
    }
    if (vector.has(signature)) {
      // Decision 18 makes duplicate signatures a fail-fast error in rankBuilds,
      // so reaching one here means the vector was built from something other
      // than a ranked list. Last-write-wins would hide it.
      throw new TypeError('duplicate build signature "' + signature + '" in ranked entries');
    }
    vector.set(signature, score);
  }
  return vector;
}

/**
 * Report the signatures whose score moved or vanished.
 *
 * @param {Map<string, number>} before score vector captured before the pool change.
 * @param {Map<string, number>} after score vector captured after it.
 * @returns {string[]} drifted signatures, sorted for stable output. A signature
 *   in `after` alone is ignored: new builds are permitted.
 */
function scoreVectorDrift(before, after) {
  if (!(before instanceof Map) || !(after instanceof Map)) {
    throw new TypeError('scoreVectorDrift requires two Maps');
  }

  const drifted = [];
  for (const [signature, score] of before) {
    if (!after.has(signature)) {
      drifted.push(signature);
    } else if (after.get(signature) !== score) {
      drifted.push(signature);
    }
  }
  return drifted.sort();
}

module.exports = { captureScoreVector, scoreVectorDrift };