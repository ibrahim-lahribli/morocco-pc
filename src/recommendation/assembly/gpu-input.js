/**
 * Engine 3 - GPU-input loading - COMPATIBILITY SHIM (step 4B PR 3).
 *
 * The implementation moved to
 * packages/recommendation-core/src/assembly/gpu-input.js, where the Decision 11
 * iGPU handoff (../filtering/igpu-map) it depends on already lives. Re-exported
 * by identity so the pipeline keeps calling the same function.
 */
module.exports = require('../../../packages/recommendation-core/src/assembly/gpu-input');
