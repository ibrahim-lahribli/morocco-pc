/**
 * Engine 3 - build assembly - COMPATIBILITY SHIM (step 4B PR 3).
 *
 * The implementation moved to
 * packages/recommendation-core/src/assembly/assemble.js. Re-exported by
 * identity so the DFS walk, EXPANSION_ORDER and the Decision 55/56 read-only
 * verdicts stay the SAME function instances every consumer already calls
 * (retention/budget-floor, ranking, scoring/build-score, orchestrator).
 */
module.exports = require('../../../packages/recommendation-core/src/assembly/assemble');
