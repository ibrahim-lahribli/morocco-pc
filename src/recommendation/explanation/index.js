/**
 * Engine 6 - explanation generation (Decision 22 items 2 + 4) public surface.
 *
 * Boundary-only barrel: re-exports the pure explainer without wrappers, logic,
 * orchestration or additional contracts.
 *
 *   explainSelection({ selected, builds, contributions, budget }) -> frozen
 *     array of NEW selected-entry copies carrying real `explanation` strings.
 *
 * NOT owned here: the persistence binding / required-non-empty rule (Decision 22
 * item 5) and the composition seam (../orchestrator/full-run.js, item 3).
 */
'use strict';

const { explainSelection } = require('./explain');

module.exports = { explainSelection };
