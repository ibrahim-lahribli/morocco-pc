/**
 * Engine 6 - explanation generation (Decision 22 items 2 + 4) public surface.
 *
 * Boundary-only barrel: re-exports the pure explainer and the E7 structured
 * reason codes without wrappers, logic, orchestration or additional contracts.
 *
 *   explainSelection({ selected, builds, contributions, budget }) -> frozen
 *     array of NEW selected-entry copies carrying real `explanation` strings.
 *     The back-compat prose surface.
 *
 *   deriveReasons({ build, contributions, profile, budget, inputs, strategy,
 *     catalogReasonCodes }) -> deeply frozen array of frozen { code, value }
 *     records, in REASON_ORDER (E7). The machine-readable surface: additive to
 *     the prose, never a replacement for it.
 *   REASON_CODES -> the frozen E7 code vocabulary
 *   REASON_ORDER -> that vocabulary's canonical output order
 *
 * Both are pure and DB-free (no SQL, no clock, no randomness, no input
 * mutation). See ./reasons.js for the read-path availability table that
 * explains which codes a persisted build can and cannot reconstruct.
 *
 * NOT owned here: the persistence binding / required-non-empty rule (Decision 22
 * item 5) and the composition seam (../orchestrator/full-run.js, item 3).
 */
'use strict';

const { explainSelection } = require('./explain');
const { deriveReasons, REASON_CODES, REASON_ORDER } = require('./reasons');

module.exports = { explainSelection, deriveReasons, REASON_CODES, REASON_ORDER };
