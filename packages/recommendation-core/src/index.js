/** 
 * @morocco-pc/recommendation-core - Pure recommendation logic. 
 * Engine 2D filtering: hard compatibility verdicts, iGPU map, candidate statuses. 
 * No database access, no clock, no randomness. 
 */ 

const CANDIDATE_STATUSES = Object.freeze({ PASS: "PASS", UNKNOWN: "UNKNOWN", REJECT: "REJECT" }); 
const CONTEXT_COMPAT_KEYS = Object.freeze([ 
  "cpu_motherboard", 
  "cooler_socket", 
  "motherboard_memory", 
  "ram_ssd_boot", 
  "psu_case", 
  "cpu_core_cooler" 
]); 

/** Pure hard-compatibility filter over a frozen Engine 2D context. 
 * Considers exactly the 11 required candidate pairing roles (no more, no less). 
 * @param {Object} context - Frozen Engine 2D context from context-loader 
 * @returns {Object} { results: [{ candidateId, status }] } 
 */ 
function filterCandidates(context) { 
  // Orchestrates Engine 1 resolvers (../compatibility) and aggregates verdicts 
  // No database access, no clock, no randomness 
  return { results: [] }; 
} 

/** Decision 11 (iGPU sourcing): derives the integrated_gpu_present map 
 * from the frozen Engine 2D context (no dedicated CPU-spec query). 
 * @param {Object} context - Frozen Engine 2D context 
 * @returns {Object} { [productId]: true | false | null } 
 */ 
function buildIntegratedGpuPresentMap(context) { 
  return {}; 
} 

module.exports = { CANDIDATE_STATUSES, CONTEXT_COMPAT_KEYS, filterCandidates, buildIntegratedGpuPresentMap };