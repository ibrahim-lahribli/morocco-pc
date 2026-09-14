/**
 * Engine 2D - Filtering context loader (B2-B: DB-backed population).
 *
 * Boundary: turns the Engine 2C candidate-pool result into the deterministic,
 * frozen Engine 2D context consumed by the hard-compatibility filtering stage
 * (docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md, section 2, stage 2).
 *
 *   Engine 2C candidate-pool result ({ input, pool })
 *         |  validate through the existing Engine 2 contracts
 *         |  (createCandidateSelectionInput, createCandidate, variant rules)
 *         v
 *   Engine 2D filtering context
 *     candidates         - candidate records bucketed by component_role in
 *                          canonical role order (Engine 2C identity preserved)
 *     specs              - candidate-scoped normalized specs, keyed
 *                          'p:<product_id>' / 'v:<product_variant_id>'
 *     platform_by_socket - socket -> platform id, ONLY for unambiguous
 *                          sockets (exactly one platform row); 0 or >1 rows
 *                          means no mapping (later logic reads absence as
 *                          UNKNOWN-compatible)
 *     compat             - authoritative compatibility rows loaded and
 *                          normalized for the six required relationships
 *                          (cpu_motherboard_exact, cpu_motherboard_family,
 *                          cooler_socket, case_form_factor, case_radiator,
 *                          platform_memory)
 *
 * B2-B SCOPE. This stage queries the database ONLY for products/variants
 * present in the candidate pool (never the whole catalog), normalizes the
 * PostgreSQL rows (NUMERIC -> JS number, JSONB preserved as structure,
 * connector booleans 1/0/null, NULL always preserved), and populates specs /
 * platform_by_socket / compat. It deliberately does NOT: call Engine 1
 * resolvers, compute compatibility verdicts, reject candidates, filter by
 * budget, score, assemble builds, persist, or select final components.
 *
 * Candidate contract: the Engine 2C identity
 * { product_id, product_variant_id, category, component_role } is preserved
 * exactly - each pool entry is re-validated (idempotently) through
 * createCandidate plus the Engine 2B/2C variant rules (GPU => variant-keyed,
 * non-GPU => product-keyed). No second candidate schema, no extra fields.
 *
 * Determinism: buckets are created in canonical COMPONENT_ROLES order and
 * compat keys in the fixed CONTEXT_COMPAT_KEYS order; within a bucket the
 * Engine 2C pool order is preserved (the pool itself is deterministically
 * ordered by Engine 2C: role, product_id, variant ASC, NULLS FIRST). Specs
 * and compat maps insert keys in sorted order, and every SQL query orders its
 * rows deterministically, so the same DB state always yields the same context.
 *
 * Immutability contract: the returned context is frozen, and every nested
 * object/collection this module creates is deep-frozen at creation. The
 * B2-A frozen placeholders are REPLACED with newly built frozen structures;
 * they are never mutated in place. Caller-owned candidate-pool data is never
 * mutated or referenced after validation.
 *
 * Database policy: parameterized SQL only - candidate id arrays are passed as
 * query parameters ($1::uuid[]), never interpolated into SQL text. Queries
 * are issued only when the requested id set is non-empty. PostgreSQL errors
 * propagate unchanged to the caller - never silently swallowed (same policy
 * as Engine 2B loadCandidates).
 *
 * Errors: the existing Engine 2 CandidateSelectionError / ERROR_CODES are
 * reused; no new error hierarchy.
 */

const { COMPONENT_ROLES } = require('../candidates/roles');
const { createCandidateSelectionInput } = require('../candidates/input');
const { createCandidate } = require('../candidates/candidate');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

/** GPU is variant-keyed; every other role is product-keyed (Engine 2B/2C). */
const GPU_ROLE = 'GPU';

/**
 * Compat sub-context keys, in deterministic canonical order. Each will map a
 * compatibility relationship to its loaded rows / verdict inputs once the
 * DB-backed Engine 2D stage populates them.
 */
const CONTEXT_COMPAT_KEYS = Object.freeze([
  'cpu_motherboard_exact',
  'cpu_motherboard_family',
  'cooler_socket',
  'case_form_factor',
  'case_radiator',
  'platform_memory',
]);

function fail(code, field, message) {
  throw new CandidateSelectionError(code, message, field);
}

/**
 * Validate the Engine 2C candidate-pool result: an object { input, pool } with
 * a valid Engine 2A selection input and a non-empty candidate array.
 *
 * @param {object} poolResult { input, pool } as produced by selectCandidatePool
 */
function validateCandidatePoolResult(poolResult) {
  if (poolResult === null || typeof poolResult !== 'object' || Array.isArray(poolResult)) {
    fail(
      ERROR_CODES.INVALID_INPUT,
      'candidatePoolResult',
      'Filtering context requires an Engine 2C candidate-pool result object'
    );
  }

  // The Engine 2C result carries the validated selection input; re-validation
  // is idempotent for already-validated (frozen) inputs.
  if (poolResult.input === undefined || poolResult.input === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'input', 'Engine 2C candidate-pool result requires "input"');
  }
  createCandidateSelectionInput(poolResult.input);

  if (poolResult.pool === undefined || poolResult.pool === null) {
    fail(ERROR_CODES.MISSING_REQUIRED_FIELD, 'pool', 'Engine 2C candidate-pool result requires "pool"');
  }
  if (!Array.isArray(poolResult.pool)) {
    fail(
      ERROR_CODES.INVALID_FIELD_VALUE,
      'pool',
      'Engine 2C candidate-pool result "pool" must be an array of candidate records'
    );
  }
  if (poolResult.pool.length === 0) {
    fail(ERROR_CODES.EMPTY_CANDIDATE_POOL, 'pool', 'Filtering context requires a non-empty candidate pool');
  }
}

/** Same db contract as Engine 2B loadCandidates: pg-compatible db.query(sql, params). */
function validateDatabaseClient(db) {
  if (db === null || typeof db !== 'object' || typeof db.query !== 'function') {
    fail(ERROR_CODES.INVALID_INPUT, 'db', 'loadFilteringContext requires a database client exposing query()');
  }
}

/**
 * Engine 2B/2C variant-identity rules, re-enforced at this boundary without
 * normalization (same contract and wording as Engine 2C).
 */
function enforceVariantIdentity(candidate) {
  if (candidate.component_role === GPU_ROLE && candidate.product_variant_id === null) {
    fail(ERROR_CODES.INVALID_CANDIDATE, 'product_variant_id', 'GPU candidates must carry a non-null product_variant_id');
  }
  if (candidate.component_role !== GPU_ROLE && candidate.product_variant_id !== null) {
    fail(ERROR_CODES.INVALID_CANDIDATE, 'product_variant_id', 'Product-keyed candidate must carry a null product_variant_id');
  }
}

/**
 * Bucket the pool by component_role. Every entry is re-validated through the
 * Engine 2A candidate contract, so bucket contents are frozen candidate
 * records owned by this module. Bucket keys are created in canonical
 * COMPONENT_ROLES order; within a bucket the pool order is preserved.
 *
 * @param {Array<object>} pool non-empty Engine 2C pool
 * @returns {object} frozen { [role]: frozen candidate[] } for every role
 */
function buildRoleBuckets(pool) {
  const buckets = {};
  for (const role of COMPONENT_ROLES) {
    buckets[role] = [];
  }

  for (const raw of pool) {
    const candidate = createCandidate(raw);
    enforceVariantIdentity(candidate);
    buckets[candidate.component_role].push(candidate);
  }

  for (const role of COMPONENT_ROLES) {
    buckets[role] = Object.freeze(buckets[role]);
  }
  return Object.freeze(buckets);
}

/**
 * Deterministic deep freeze: freezes the value and every plain object/array
 * it owns. Every structure here is module-owned and freshly built, so this
 * never touches caller-owned data.
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Sorted (deterministic) id list from a Set of strings. */
function sortedIds(ids) {
  return [...ids].sort();
}

/**
 * Run one parameterized query. PostgreSQL errors propagate unchanged; a
 * missing db result shape is a programming error and surfaces as-is.
 *
 * @param {object} db   pg-compatible client exposing query(sql, params)
 * @param {string} sql  parameterized SQL (no interpolated ids)
 * @param {Array} params bound parameters
 * @returns {Promise<Array<object>>} result rows
 */
async function queryRows(db, sql, params) {
  const result = await db.query(sql, params);
  return result.rows ?? [];
}

// ---------------------------------------------------------------------------
// SQL. All id scoping is parameterized ($1::uuid[]); ORDER BY guarantees a
// deterministic row order regardless of the database's physical ordering.
// ---------------------------------------------------------------------------

const CPU_SPEC_SQL = `
SELECT cs.product_id, cs.socket_id, p.product_family_id
  FROM cpu_spec cs
  JOIN product p ON p.id = cs.product_id
 WHERE cs.product_id = ANY($1::uuid[])
 ORDER BY cs.product_id ASC`;

const MOTHERBOARD_SPEC_SQL = `
SELECT product_id, socket_id, form_factor, memory_type_id
  FROM motherboard_spec
 WHERE product_id = ANY($1::uuid[])
 ORDER BY product_id ASC`;

const RAM_SPEC_SQL = `
SELECT product_id, memory_type_id
  FROM ram_spec
 WHERE product_id = ANY($1::uuid[])
 ORDER BY product_id ASC`;

const COOLER_SPEC_SQL = `
SELECT product_id, cooling_type
  FROM cooler_spec
 WHERE product_id = ANY($1::uuid[])
 ORDER BY product_id ASC`;

const CASE_SPEC_SQL = `
SELECT product_id, max_gpu_length_mm, max_gpu_thickness_slots
  FROM case_spec
 WHERE product_id = ANY($1::uuid[])
 ORDER BY product_id ASC`;

const PSU_SPEC_SQL = `
SELECT product_id, rated_wattage,
       connector_24pin_atx, connector_eps_count, connector_pcie_8pin,
       connector_12vhpwr, connector_sata
  FROM psu_spec
 WHERE product_id = ANY($1::uuid[])
 ORDER BY product_id ASC`;

const GPU_VARIANT_SPEC_SQL = `
SELECT product_variant_id, length_mm, width_slots,
       required_power_connectors, recommended_psu_watts
  FROM gpu_board_spec
 WHERE product_variant_id = ANY($1::uuid[])
 ORDER BY product_variant_id ASC`;

const CPU_MOTHERBOARD_SUPPORT_SQL = `
SELECT id, motherboard_product_id, cpu_product_id, cpu_product_family_id,
       support_status, min_bios_version
  FROM cpu_motherboard_support
 WHERE motherboard_product_id = ANY($1::uuid[])
 ORDER BY id ASC`;

const COOLER_SOCKET_SUPPORT_SQL = `
SELECT id, cooler_product_id, socket_id, support_status
  FROM cooler_socket_support
 WHERE cooler_product_id = ANY($1::uuid[])
 ORDER BY id ASC`;

const CASE_FORM_FACTOR_SQL = `
SELECT id, case_product_id, form_factor
  FROM case_motherboard_form_factor
 WHERE case_product_id = ANY($1::uuid[])
 ORDER BY id ASC`;

const CASE_RADIATOR_SUPPORT_SQL = `
SELECT id, case_product_id, radiator_size_mm, position
  FROM case_radiator_support
 WHERE case_product_id = ANY($1::uuid[])
 ORDER BY id ASC`;

// platform.socket_id is deliberately NOT unique in the schema; every matching
// row is fetched so ambiguity can be detected instead of silently choosing.
const PLATFORM_BY_SOCKET_SQL = `
SELECT id, socket_id
  FROM platform
 WHERE socket_id = ANY($1::uuid[])
 ORDER BY id ASC`;

const PLATFORM_MEMORY_SUPPORT_SQL = `
SELECT platform_id, memory_type_id
  FROM platform_memory_support
 WHERE platform_id = ANY($1::uuid[])
 ORDER BY platform_id ASC, memory_type_id ASC`;

// ---------------------------------------------------------------------------
// Spec normalization. Canonical keys only; NULL is preserved exactly as
// PostgreSQL returned it (NULL is never converted to 0 or false).
// ---------------------------------------------------------------------------

/** Canonical psu_spec connector column -> normalized connector key. */
const PSU_CONNECTOR_KEYS = Object.freeze({
  connector_24pin_atx: '24pin_atx',
  connector_eps_count: 'eps',
  connector_pcie_8pin: 'pcie_8pin',
  connector_12vhpwr: '12vhpwr',
  connector_sata: 'sata',
});

const PSU_CONNECTOR_COLUMNS = Object.freeze(Object.keys(PSU_CONNECTOR_KEYS));

/**
 * Normalize raw cooler_spec.cooling_type into cooler_requires_radiator:
 *   AIR/PASSIVE -> false, LIQUID -> true, HYBRID/null -> null.
 */
function deriveCoolerRequiresRadiator(coolingType) {
  if (coolingType === 'AIR' || coolingType === 'PASSIVE') return false;
  if (coolingType === 'LIQUID') return true;
  return null; // HYBRID and NULL both stay unknown
}

/** Normalize psu_spec connector columns into the canonical counts map. */
function normalizePsuConnectors(row) {
  const connectors = {};
  for (const column of PSU_CONNECTOR_COLUMNS) {
    const key = PSU_CONNECTOR_KEYS[column];
    const value = row[column];
    if (column === 'connector_24pin_atx') {
      // BOOLEAN: true -> 1, false -> 0, NULL stays NULL.
      connectors[key] = value === null || value === undefined ? null : (value ? 1 : 0);
    } else {
      // INTEGER counts: preserved as-is, NULL stays NULL.
      connectors[key] = value === undefined ? null : value;
    }
  }
  return connectors;
}

/** Build the normalized spec entry ('p:<product_id>') for one spec row. */
function normalizeSpecForRole(role, row) {
  switch (role) {
    case 'CPU':
      return {
        socket_id: row.socket_id ?? null,
        product_family_id: row.product_family_id ?? null,
      };
    case 'MOTHERBOARD':
      return {
        socket_id: row.socket_id ?? null,
        form_factor: row.form_factor ?? null,
        memory_type_id: row.memory_type_id ?? null,
      };
    case 'RAM':
      return { memory_type_id: row.memory_type_id ?? null };
    case 'CPU_COOLER':
      return {
        cooling_type: row.cooling_type ?? null,
        cooler_requires_radiator: deriveCoolerRequiresRadiator(row.cooling_type ?? null),
        // The schema provides no authoritative values; never invent them.
        radiator_size_mm: null,
        radiator_position: null,
      };
    case 'CASE':
      return {
        max_gpu_length_mm: row.max_gpu_length_mm ?? null,
        max_gpu_thickness_slots: row.max_gpu_thickness_slots ?? null,
      };
    case 'PSU':
      return {
        rated_wattage: row.rated_wattage ?? null,
        power_connectors: normalizePsuConnectors(row),
      };
    default:
      // SSD roles: no SSD relationship exists in the Engine 2D contract.
      return null;
  }
}

/** Normalize gpu_board_spec (NUMERIC/JSONB) into the 'v:<id>' spec entry. */
function normalizeGpuSpec(row) {
  return {
    length_mm: row.length_mm ?? null,
    // NUMERIC(4,2) arrives as a string via pg; it must be a JS number.
    width_slots: row.width_slots === null || row.width_slots === undefined
      ? null
      : Number(row.width_slots),
    // JSONB: preserve the structure; never stringify.
    required_power_connectors: row.required_power_connectors ?? null,
    recommended_psu_watts: row.recommended_psu_watts ?? null,
  };
}

// ---------------------------------------------------------------------------
// Context population.
// ---------------------------------------------------------------------------

/** Map role -> the candidate product ids whose spec table must be queried. */
function collectProductIdsByRole(candidates) {
  const idsByRole = {};
  for (const role of COMPONENT_ROLES) {
    if (role === GPU_ROLE) continue;
    idsByRole[role] = new Set(candidates[role].map((c) => c.product_id));
  }
  return idsByRole;
}

/**
 * Load and normalize specs for every product/variant in the pool. Only
 * candidate ids are queried (never the whole catalog); keys are inserted in
 * sorted order so the same DB state always yields the same map shape.
 */
async function loadSpecs(db, candidates) {
  const specs = {};

  const idsByRole = collectProductIdsByRole(candidates);
  const specQueries = {
    CPU: { sql: CPU_SPEC_SQL, normalize: (row) => normalizeSpecForRole('CPU', row) },
    MOTHERBOARD: { sql: MOTHERBOARD_SPEC_SQL, normalize: (row) => normalizeSpecForRole('MOTHERBOARD', row) },
    RAM: { sql: RAM_SPEC_SQL, normalize: (row) => normalizeSpecForRole('RAM', row) },
    CPU_COOLER: { sql: COOLER_SPEC_SQL, normalize: (row) => normalizeSpecForRole('CPU_COOLER', row) },
    CASE: { sql: CASE_SPEC_SQL, normalize: (row) => normalizeSpecForRole('CASE', row) },
    PSU: { sql: PSU_SPEC_SQL, normalize: (row) => normalizeSpecForRole('PSU', row) },
  };

  for (const role of COMPONENT_ROLES) {
    if (role === GPU_ROLE) continue;
    const query = specQueries[role];
    if (!query) continue; // SSD roles have no spec requirement in this contract

    const ids = sortedIds(idsByRole[role]);
    if (ids.length === 0) continue; // nothing to load for this role

    const rows = await queryRows(db, query.sql, [ids]);
    for (const row of rows) {
      const normalized = query.normalize(row);
      if (normalized !== null) {
        specs[`p:${row.product_id}`] = normalized;
      }
    }
  }

  const variantIds = sortedIds(new Set(candidates.GPU.map((c) => c.product_variant_id)));
  if (variantIds.length > 0) {
    const rows = await queryRows(db, GPU_VARIANT_SPEC_SQL, [variantIds]);
    for (const row of rows) {
      specs[`v:${row.product_variant_id}`] = normalizeGpuSpec(row);
    }
  }

  const ordered = {};
  for (const key of Object.keys(specs).sort()) {
    ordered[key] = deepFreeze(specs[key]);
  }
  return deepFreeze(ordered);
}

/**
 * Collect the socket ids of candidate CPU / motherboard spec entries. Spec
 * rows are only loaded for candidate products, so every socket id here is
 * candidate-scoped by construction; the explicit product-id check keeps the
 * scoping local and auditable.
 */
function collectCandidateSocketIds(specs, candidates) {
  const cpuIds = new Set(candidates.CPU.map((c) => c.product_id));
  const motherboardIds = new Set(candidates.MOTHERBOARD.map((c) => c.product_id));

  const socketIds = new Set();
  for (const key of Object.keys(specs)) {
    if (!key.startsWith('p:')) continue;
    const productId = key.slice(2);
    if (!cpuIds.has(productId) && !motherboardIds.has(productId)) continue;
    const socketId = specs[key].socket_id;
    if (socketId !== null && socketId !== undefined) {
      socketIds.add(socketId);
    }
  }
  return socketIds;
}

/**
 * Build the socket -> platform map from already-loaded platform rows.
 * platform.socket_id is NOT unique in the schema:
 *   exactly one row for a socket -> map socket -> platform id
 *   zero rows                    -> no mapping (absence reads as UNKNOWN)
 *   more than one row            -> no mapping (never silently choose one)
 */
function buildPlatformMapFromRows(rows) {
  const counts = {};
  const firstPlatformId = {};
  for (const row of rows) {
    const socketId = row.socket_id;
    if (socketId === null || socketId === undefined) continue;
    counts[socketId] = (counts[socketId] ?? 0) + 1;
    firstPlatformId[socketId] = row.id;
  }

  const mapping = {};
  for (const socketId of Object.keys(counts).sort()) {
    if (counts[socketId] === 1) {
      mapping[socketId] = firstPlatformId[socketId];
    }
  }
  return deepFreeze(mapping);
}

/**
 * Resolve the platform_by_socket mapping for the candidate sockets.
 *
 * @param {object} db pg-compatible client
 * @param {object} specs populated specs map
 * @param {object} candidates role buckets
 */
async function loadPlatformMapping(db, specs, candidates) {
  const socketIds = collectCandidateSocketIds(specs, candidates);
  if (socketIds.size === 0) {
    return deepFreeze({});
  }

  const rows = await queryRows(db, PLATFORM_BY_SOCKET_SQL, [sortedIds(socketIds)]);
  return buildPlatformMapFromRows(rows);
}

/**
 * Normalized compatibility row carried into the context. Every row preserves
 * source_table / source_id and the support_status where the underlying table
 * provides one (presence-only tables carry support_status: null, which the
 * presence-based resolvers treat the same as an absent status).
 */
function normalizeCompatRow(sourceTable, row, extra = {}) {
  return deepFreeze({
    source_table: sourceTable,
    source_id: row.id === undefined ? null : row.id,
    support_status: row.support_status === undefined ? null : row.support_status,
    ...extra,
  });
}

/**
 * Group compatibility rows by their owner id (motherboard / cooler / case
 * product or platform). Keys and rows are built deterministically.
 */
function groupCompatRows(rows, ownerField, sourceTable, extraFields = []) {
  const grouped = {};
  for (const row of rows) {
    const ownerId = row[ownerField];
    if (ownerId === null || ownerId === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(grouped, ownerId)) {
      grouped[ownerId] = [];
    }
    const extra = {};
    for (const field of extraFields) {
      extra[field] = row[field] === undefined ? null : row[field];
    }
    grouped[ownerId].push(normalizeCompatRow(sourceTable, row, extra));
  }

  const ordered = {};
  for (const ownerId of Object.keys(grouped).sort()) {
    ordered[ownerId] = deepFreeze(grouped[ownerId]);
  }
  return ordered;
}

/**
 * Load the six required compatibility buckets. Only rows whose owner
 * (candidate motherboard / cooler / case or a mapped candidate platform) is
 * part of the candidate pool are queried, so no unrelated catalog
 * compatibility data enters the context. No verdicts are calculated here.
 */
async function loadCompatContext(db, candidates, platform_by_socket) {
  const compat = {};
  for (const key of CONTEXT_COMPAT_KEYS) {
    compat[key] = {};
  }

  // cpu_motherboard_exact / cpu_motherboard_family, split by specificity.
  // Exactly one of cpu_product_id / cpu_product_family_id is set per row
  // (schema constraint chk_cpu_motherboard_specificity).
  const motherboardIds = sortedIds(new Set(candidates.MOTHERBOARD.map((c) => c.product_id)));
  if (motherboardIds.length > 0) {
    const rows = await queryRows(db, CPU_MOTHERBOARD_SUPPORT_SQL, [motherboardIds]);
    compat.cpu_motherboard_exact = groupCompatRows(
      rows.filter((row) => row.cpu_product_id != null),
      'motherboard_product_id', 'cpu_motherboard_support',
      ['cpu_product_id', 'min_bios_version']
    );
    compat.cpu_motherboard_family = groupCompatRows(
      rows.filter((row) => row.cpu_product_family_id != null),
      'motherboard_product_id', 'cpu_motherboard_support',
      ['cpu_product_family_id', 'min_bios_version']
    );
  }

  const coolerIds = sortedIds(new Set(candidates.CPU_COOLER.map((c) => c.product_id)));
  if (coolerIds.length > 0) {
    const rows = await queryRows(db, COOLER_SOCKET_SUPPORT_SQL, [coolerIds]);
    compat.cooler_socket = groupCompatRows(
      rows, 'cooler_product_id', 'cooler_socket_support', ['socket_id']
    );
  }

  const caseIds = sortedIds(new Set(candidates.CASE.map((c) => c.product_id)));
  if (caseIds.length > 0) {
    const formFactorRows = await queryRows(db, CASE_FORM_FACTOR_SQL, [caseIds]);
    compat.case_form_factor = groupCompatRows(
      formFactorRows, 'case_product_id', 'case_motherboard_form_factor', ['form_factor']
    );

    const radiatorRows = await queryRows(db, CASE_RADIATOR_SUPPORT_SQL, [caseIds]);
    compat.case_radiator = groupCompatRows(
      radiatorRows, 'case_product_id', 'case_radiator_support',
      ['radiator_size_mm', 'position']
    );
  }

  // platform_memory: scoped to the platforms resolvable from candidate
  // sockets via platform_by_socket. Ambiguous or unmapped sockets provide no
  // platform id and therefore no memory rows (later logic reads that as
  // UNKNOWN-compatible absence).
  const platformIds = sortedIds(new Set(Object.values(platform_by_socket)));
  if (platformIds.length > 0) {
    const rows = await queryRows(db, PLATFORM_MEMORY_SUPPORT_SQL, [platformIds]);
    compat.platform_memory = groupCompatRows(
      rows, 'platform_id', 'platform_memory_support', ['memory_type_id']
    );
  }

  const ordered = {};
  for (const key of CONTEXT_COMPAT_KEYS) {
    ordered[key] = deepFreeze(compat[key]);
  }
  return deepFreeze(ordered);
}

/**
 * Load the Engine 2D filtering context for an Engine 2C candidate-pool result.
 *
 * B2-B behavior: validates both arguments, buckets the pool by role, queries
 * the database ONLY for the candidate products/variants, normalizes specs /
 * platform mapping / compatibility rows, and returns the frozen deterministic
 * context. It deliberately does NOT compute compatibility verdicts, reject
 * candidates, filter by budget, score, assemble builds, or persist anything.
 *
 * @param {object} candidatePoolResult  Engine 2C result { input, pool }
 * @param {object} db  pg-compatible client exposing db.query(sql, params)
 * @returns {Promise<object>} frozen { candidates, specs, platform_by_socket, compat }
 */
async function loadFilteringContext(candidatePoolResult, db) {
  validateCandidatePoolResult(candidatePoolResult);
  validateDatabaseClient(db);

  const candidates = buildRoleBuckets(candidatePoolResult.pool);

  // DB-backed population. The B2-A frozen placeholders are REPLACED with
  // newly built frozen structures - never mutated in place. PostgreSQL
  // errors propagate to the caller unchanged.
  const specs = await loadSpecs(db, candidates);
  const platform_by_socket = await loadPlatformMapping(db, specs, candidates);
  const compat = await loadCompatContext(db, candidates, platform_by_socket);

  return Object.freeze({
    candidates,
    specs,
    platform_by_socket,
    compat: Object.freeze(compat),
  });
}

module.exports = { loadFilteringContext, CONTEXT_COMPAT_KEYS };
