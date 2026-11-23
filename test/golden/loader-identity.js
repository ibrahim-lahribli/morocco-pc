'use strict';

// test/golden/loader-identity.js — cross-database identity for the frozen
// loader fixtures.
//
// The fixtures were captured on the TEST branch and carry only that branch's
// random UUIDs; a fresh ephemeral database has different random UUIDs for the
// same seed rows. There is therefore no id join available across the two
// databases, and no name is present on the fixture side at all.
//
// This module supplies the two comparisons that ARE possible:
//
//   1. A content fingerprint per candidate:
//        [component_role, category, spec with every UUID removed,
//         sorted (assessment_type, score, confidence)]
//      used to pair fixture candidates with seeded candidates. The fingerprint
//      is a MULTISET key: 112 of the 114 pool candidates are unique (measured
//      on the committed fixtures); exactly two pairs collide because their
//      specs AND assessments are identical (a CASE pair and a COOLER pair).
//      Colliding groups are compared as unordered classes; everything else is
//      1:1 and is reported by the database's natural key.
//
//   2. Membership signatures for the dimension UUIDs that the fixtures cannot
//      name (socket, memory_type, product_family, platform). A dimension is
//      canonicalised to `kind[sorted owner labels]`; the owner labels are the
//      paired candidate natural keys. The signature is derived from the
//      candidate specs (or, for platform, from its memory-support rows), so it
//      needs no database names on the fixture side.
//
// Natural keys: product.name (not unique by schema, asserted unique among the
// referenced products) and `product.name / product_variant.sku` (sku is
// unique; product_variant has no name column).

const assert = require('node:assert/strict');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roles whose candidates must carry a context spec (SSD_* carry none). */
const SPEC_BEARING_ROLES = Object.freeze([
  'CPU',
  'GPU',
  'MOTHERBOARD',
  'RAM',
  'PSU',
  'CASE',
  'CPU_COOLER',
]);

/** Spec field -> dimension kind whose ownership signature replaces the UUID. */
const DIMENSION_FIELDS = Object.freeze({
  socket_id: 'socket',
  memory_type_id: 'memory_type',
  product_family_id: 'family',
});

const COMPAT_KEYS = Object.freeze([
  'cpu_motherboard_exact',
  'cpu_motherboard_family',
  'cooler_socket',
  'case_form_factor',
  'case_radiator',
  'platform_memory',
  'motherboard_memory',
]);

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Key-order-independent serialization (arrays keep their order). */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}

/**
 * Replace every UUID string with a field-name placeholder so the fingerprint is
 * stable across databases. Returns undefined for a value that IS a UUID (the
 * object key/element is then dropped).
 */
function stripUuids(value) {
  if (typeof value === 'string') return isUuid(value) ? undefined : value;
  if (Array.isArray(value)) {
    return value.map(stripUuids).filter((v) => v !== undefined);
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const stripped = stripUuids(inner);
      if (stripped !== undefined) out[key] = stripped;
    }
    return out;
  }
  return value;
}

function keyOf(candidate) {
  const variant = candidate.product_variant_id === null || candidate.product_variant_id === undefined
    ? ''
    : String(candidate.product_variant_id);
  return String(candidate.product_id) + '|' + variant;
}

function specKey(candidate) {
  return candidate.product_variant_id === null || candidate.product_variant_id === undefined
    ? 'p:' + candidate.product_id
    : 'v:' + candidate.product_variant_id;
}

/** Product natural key plus the variant sku when the candidate is variant-keyed. */
function naturalKey(candidate, catalog) {
  const productId = String(candidate.product_id);
  const name = catalog.productName.get(productId);
  assert.ok(name !== undefined, 'no product.name for product ' + productId);
  if (candidate.product_variant_id === null || candidate.product_variant_id === undefined) {
    return name;
  }
  const variantId = String(candidate.product_variant_id);
  const sku = catalog.variantSku.get(variantId);
  assert.ok(sku !== undefined, 'no product_variant.sku for variant ' + variantId);
  return name + ' / ' + sku;
}

function assessmentsFor(candidate, assessments) {
  const rows = assessments[String(candidate.product_id)] || [];
  return rows
    .map((row) => [row.assessment_type, row.score, row.confidence])
    .sort((a, b) => {
      const sa = stable(a);
      const sb = stable(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
}

function fingerprintOf(candidate, specs, assessments) {
  const spec = specs[specKey(candidate)];
  if (spec === undefined) {
    assert.equal(SPEC_BEARING_ROLES.includes(candidate.component_role), false,
      'missing ' + candidate.component_role + ' spec for ' + specKey(candidate));
    return stable([candidate.component_role, candidate.category, null, assessmentsFor(candidate, assessments)]);
  }
  return stable([
    candidate.component_role,
    candidate.category,
    stripUuids(spec),
    assessmentsFor(candidate, assessments),
  ]);
}

/**
 * Build the cross-database identity map from one captured scenario.
 *
 * @param {object} input
 *   fixtureCandidates, fixtureSpecs, fixtureAssessments
 *   dbCandidates, dbSpecs, dbAssessments
 *   catalog  {productName, variantSku, productCategory, storeName, ...}
 * @returns {{
 *   fixtureLabel: Map<string,string>, dbLabel: Map<string,string>,
 *   fixtureProductLabel: Map<string,string>, dbProductLabel: Map<string,string>,
 *   labelRole: Map<string,string>, uniqueLabels: Set<string>,
 *   pairs: Array<object>, classes: Array<object>}}
 */
function buildIdentity(input) {
  const {
    fixtureCandidates,
    fixtureSpecs,
    fixtureAssessments,
    dbCandidates,
    dbSpecs,
    dbAssessments,
    catalog,
  } = input;

  const group = (candidates, specs, assessments) => {
    const map = new Map();
    for (const candidate of candidates) {
      const fp = fingerprintOf(candidate, specs, assessments);
      if (!map.has(fp)) map.set(fp, []);
      map.get(fp).push(candidate);
    }
    return map;
  };

  const fixtureGroups = group(fixtureCandidates, fixtureSpecs, fixtureAssessments);
  const dbGroups = group(dbCandidates, dbSpecs, dbAssessments);

  const fixtureKeys = [...fixtureGroups.keys()].sort();
  const dbKeys = [...dbGroups.keys()].sort();
  assert.deepEqual(dbKeys, fixtureKeys,
    'candidate content fingerprints differ between the fixture and the seeded database');

  for (const fp of fixtureKeys) {
    assert.equal(dbGroups.get(fp).length, fixtureGroups.get(fp).length,
      'fingerprint class size differs: ' + fp.slice(0, 180));
  }

  // Natural keys must be unique among the referenced rows; otherwise a label
  // would silently stand for two different products.
  const referencedProducts = new Map();
  const referencedSkus = new Map();
  for (const candidate of dbCandidates) {
    const productId = String(candidate.product_id);
    if (!referencedProducts.has(productId)) {
      const name = catalog.productName.get(productId);
      assert.ok(name !== undefined, 'no product.name for product ' + productId);
      referencedProducts.set(productId, name);
    }
    if (candidate.product_variant_id !== null && candidate.product_variant_id !== undefined) {
      const variantId = String(candidate.product_variant_id);
      if (!referencedSkus.has(variantId)) {
        const sku = catalog.variantSku.get(variantId);
        assert.ok(sku !== undefined, 'no product_variant.sku for variant ' + variantId);
        referencedSkus.set(variantId, sku);
      }
    }
  }
  const seenProductNames = new Set();
  for (const [productId, name] of referencedProducts) {
    assert.equal(seenProductNames.has(name), false,
      'product.name "' + name + '" is not unique among the referenced products (' + productId + ')');
    seenProductNames.add(name);
  }
  const seenSkus = new Set();
  for (const [variantId, sku] of referencedSkus) {
    assert.equal(seenSkus.has(sku), false,
      'product_variant.sku "' + sku + '" is not unique (' + variantId + ')');
    seenSkus.add(sku);
  }
  const storeNames = [...catalog.storeName.values()];
  assert.equal(new Set(storeNames).size, storeNames.length, 'store.name must be unique');

  const fixtureLabel = new Map();
  const dbLabel = new Map();
  const fixtureProductLabel = new Map();
  const dbProductLabel = new Map();
  const labelRole = new Map();
  const uniqueLabels = new Set();
  const pairs = [];
  const classes = [];

  for (const fp of fixtureKeys) {
    const fcs = fixtureGroups.get(fp);
    const dcs = dbGroups.get(fp);
    if (fcs.length === 1) {
      const label = naturalKey(dcs[0], catalog);
      assert.equal(uniqueLabels.has(label), false,
        'two distinct candidates share the natural key "' + label + '"');
      uniqueLabels.add(label);
      pairs.push({ label, fixture: fcs[0], db: dcs[0], fingerprint: fp });
      fixtureLabel.set(keyOf(fcs[0]), label);
      dbLabel.set(keyOf(dcs[0]), label);
      labelRole.set(label, dcs[0].component_role);
      const productName = catalog.productName.get(String(dcs[0].product_id));
      fixtureProductLabel.set(String(fcs[0].product_id), productName);
      dbProductLabel.set(String(dcs[0].product_id), productName);
    } else {
      const names = dcs.map((c) => naturalKey(c, catalog)).sort();
      const label = 'CLASS(' + dcs[0].component_role + ':' + dcs[0].category + ')[' + names.join('; ') + ']';
      classes.push({ label, fixture: fcs, db: dcs, fingerprint: fp });
      labelRole.set(label, dcs[0].component_role);
      for (const c of fcs) {
        fixtureLabel.set(keyOf(c), label);
        fixtureProductLabel.set(String(c.product_id), label);
      }
      for (const c of dcs) {
        dbLabel.set(keyOf(c), label);
        dbProductLabel.set(String(c.product_id), label);
      }
    }
  }

  return {
    fixtureLabel,
    dbLabel,
    fixtureProductLabel,
    dbProductLabel,
    labelRole,
    uniqueLabels,
    pairs,
    classes,
  };
}

/**
 * Membership signatures for the dimension UUIDs, from the candidate specs.
 * A dimension referenced by a CPU and a motherboard is owned by both labels.
 */
function buildDimensionSignatures(candidates, specs, labelFor) {
  const owners = { socket: new Map(), memory_type: new Map(), family: new Map() };
  for (const candidate of candidates) {
    const spec = specs[specKey(candidate)];
    if (spec === undefined) continue;
    const label = labelFor(candidate);
    for (const [field, kind] of Object.entries(DIMENSION_FIELDS)) {
      const id = spec[field];
      if (id === undefined || id === null) continue;
      if (!owners[kind].has(id)) owners[kind].set(id, new Set());
      owners[kind].get(id).add(label);
    }
  }
  const sig = (kind, id) => {
    const set = owners[kind].get(id);
    return kind + '[' + (set === undefined ? '' : [...set].sort().join(',')) + ']';
  };
  return {
    socketSig: (id) => sig('socket', id),
    memorySig: (id) => sig('memory_type', id),
    familySig: (id) => sig('family', id),
  };
}

/**
 * Platform signatures from the platform_memory_support rows: a platform is
 * `platform[sorted memory-type signatures]`. A platform with no rows is
 * `platform[]` - stable, because both sides then know nothing about it.
 */
function buildPlatformSignatures(platformMemory, memorySig) {
  const byPlatform = new Map();
  for (const [platformId, rows] of Object.entries(platformMemory || {})) {
    const types = [...new Set(rows
      .map((row) => row.memory_type_id)
      .filter((id) => id !== null && id !== undefined))].map(memorySig).sort();
    byPlatform.set(platformId, 'platform[' + types.join(',') + ']');
  }
  return (platformId) => byPlatform.get(platformId) || 'platform[]';
}

/**
 * Canonicalise one candidate spec: the three dimension UUIDs become membership
 * signatures; any other UUID is a schema change this test must not absorb.
 */
function canonicalSpec(spec, sigs) {
  const walk = (value, field) => {
    if (typeof value === 'string') {
      if (Object.prototype.hasOwnProperty.call(DIMENSION_FIELDS, field)) {
        const kind = DIMENSION_FIELDS[field];
        if (kind === 'socket') return sigs.socketSig(value);
        if (kind === 'memory_type') return sigs.memorySig(value);
        return sigs.familySig(value);
      }
      if (isUuid(value)) throw new Error('unexpected UUID in spec field "' + field + '"');
      return value;
    }
    if (Array.isArray(value)) return value.map((inner) => walk(inner, field));
    if (value !== null && typeof value === 'object') {
      const out = {};
      for (const [key, inner] of Object.entries(value)) out[key] = walk(inner, key);
      return out;
    }
    return value;
  };
  return walk(spec, '');
}

/**
 * Canonicalise a compatibility sub-context: owner keys and row references are
 * replaced by labels/signatures, source_id is dropped (the fixture's row ids
 * are TEST surrogates), and each owner's rows are sorted. The comparison is
 * therefore a per-owner multiset, not an order.
 */
function canonicalCompat(compat, opts) {
  const { productLabelFor, socketSig, memorySig, familySig, platformSig } = opts;
  const out = new Map();
  for (const key of COMPAT_KEYS) {
    const owners = compat[key] || {};
    for (const [ownerId, rows] of Object.entries(owners)) {
      const ownerLabel = key === 'platform_memory' ? platformSig(ownerId) : productLabelFor(ownerId);
      if (!out.has(ownerLabel)) out.set(ownerLabel, []);
      for (const row of rows) {
        const canonical = {};
        for (const [field, value] of Object.entries(row)) {
          if (field === 'source_id') continue;
          if (field === 'cpu_product_id' || field === 'partner_product_id'
            || field === 'cooler_product_id' || field === 'case_product_id'
            || field === 'motherboard_product_id') {
            canonical[field] = productLabelFor(value);
          } else if (field === 'cpu_product_family_id') {
            canonical[field] = familySig(value);
          } else if (field === 'socket_id') {
            canonical[field] = socketSig(value);
          } else if (field === 'memory_type_id') {
            canonical[field] = memorySig(value);
          } else if (field === 'platform_id') {
            canonical[field] = platformSig(value);
          } else {
            if (isUuid(value)) throw new Error('unexpected UUID in compat field "' + field + '"');
            canonical[field] = value;
          }
        }
        out.get(ownerLabel).push(canonical);
      }
    }
  }
  for (const [owner, rows] of out) {
    rows.sort((a, b) => {
      const sa = stable(a);
      const sb = stable(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    out.set(owner, rows);
  }
  return out;
}

/** Canonical platform_by_socket: sorted (socket signature, platform signature). */
function canonicalPlatformBySocket(map, socketSig, platformSig) {
  return Object.entries(map || {})
    .map(([socketId, platformId]) => [socketSig(socketId), platformSig(platformId)])
    .sort((a, b) => {
      const sa = stable(a);
      const sb = stable(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
}

/** Query input: identity fields are database-local and canonicalised. */
function canonicalQuery(query, modelKey) {
  return {
    query_id: '<ID>',
    scoring_model_id: modelKey,
    input: query.input,
    resolution: query.resolution,
    priority: query.priority,
  };
}

/** Scoring model: exactly the two seed-time timestamps are excluded. */
function canonicalModel(model, modelKey) {
  const out = {};
  for (const [key, value] of Object.entries(model)) {
    if (key === 'created_at' || key === 'updated_at') continue;
    out[key] = key === 'id' ? modelKey : value;
  }
  return out;
}

const PRICE_FIELDS = Object.freeze([
  'selected_price',
  'currency',
  'store_id',
  'price_checked_at',
  'offer_id',
  'offer_class',
]);

/**
 * Price carrier: compare the money, currency, decision timestamp and class;
 * the offer/store ids are surrogates. `price_checked_at` is a Date live and an
 * ISO string in the fixture, so both are normalized.
 */
function canonicalPrice(entry) {
  assert.deepEqual(Object.keys(entry).sort(), [...PRICE_FIELDS].sort(),
    'price entry fields changed (a new field such as availability must be argued, not absorbed)');
  assert.ok(isUuid(entry.offer_id), 'price offer_id is not a UUID: ' + entry.offer_id);
  assert.ok(isUuid(entry.store_id), 'price store_id is not a UUID: ' + entry.store_id);
  return {
    selected_price: Number(entry.selected_price),
    currency: entry.currency,
    price_checked_at: new Date(entry.price_checked_at).toISOString(),
    offer_class: entry.offer_class,
  };
}

function labelForCandidateIds(productId, variantId, labelMap) {
  if (productId === null || productId === undefined) return null;
  const variant = variantId === null || variantId === undefined ? '' : String(variantId);
  const key = String(productId) + '|' + variant;
  const label = labelMap.get(key);
  assert.ok(label !== undefined, 'filter partner ' + key + ' is not in the candidate pool');
  return label;
}

function canonicalNote(note, labelMap) {
  const out = {};
  for (const [field, value] of Object.entries(note)) {
    if (field === 'source_id') continue;
    if (field === 'partner_product_id' || field === 'partner_product_variant_id') {
      if (field === 'partner_product_id') {
        out.partner = labelForCandidateIds(value, note.partner_product_variant_id, labelMap);
      }
      continue;
    }
    if (isUuid(value)) throw new Error('unexpected UUID in compatibility note field "' + field + '"');
    out[field] = value;
  }
  return out;
}

/** Filter result: identity is the label; every content field is compared. */
function canonicalFilterResult(result, labelMap) {
  const partner = result.partner_product_id === null || result.partner_product_id === undefined
    ? null
    : labelForCandidateIds(result.partner_product_id, result.partner_product_variant_id, labelMap);
  const notes = (result.compatibility_notes || []).map((note) => canonicalNote(note, labelMap));
  notes.sort((a, b) => {
    const sa = stable(a);
    const sb = stable(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return {
    status: result.status,
    reason: result.reason,
    relationships: result.relationships,
    unknown_pairwise_count: result.unknown_pairwise_count,
    partner,
    notes,
  };
}

/**
 * Assessment rows: the seed-time assessed_at is the ONLY excluded field, named
 * as such. The row's key set is asserted first, so a field added later fails
 * loudly instead of being dropped by a whitelist (a wildcard exclusion).
 */
const ASSESSMENT_ROW_FIELDS = Object.freeze([
  'assessment_type',
  'score',
  'confidence',
  'assessed_at',
]);

function canonicalAssessmentRows(rows) {
  return rows.map((row) => {
    assert.deepEqual(Object.keys(row).sort(), [...ASSESSMENT_ROW_FIELDS].sort(),
      'assessment row fields changed: name the new exclusion instead of absorbing it');
    const out = {};
    for (const [field, value] of Object.entries(row)) {
      if (field === 'assessed_at') continue;
      out[field] = value;
    }
    return out;
  });
}

/** Group by a label, preserving each group's member order. */
function groupBy(items, labelFor) {
  const out = new Map();
  for (const item of items) {
    const label = labelFor(item);
    if (!out.has(label)) out.set(label, []);
    out.get(label).push(item);
  }
  return out;
}

/** Sorted stable serializations of a group's members (unordered comparison). */
function multiset(values) {
  return values.map(stable).sort();
}

module.exports = {
  UUID_RE,
  SPEC_BEARING_ROLES,
  DIMENSION_FIELDS,
  COMPAT_KEYS,
  isUuid,
  stable,
  stripUuids,
  keyOf,
  specKey,
  naturalKey,
  fingerprintOf,
  buildIdentity,
  buildDimensionSignatures,
  buildPlatformSignatures,
  canonicalSpec,
  canonicalCompat,
  canonicalPlatformBySocket,
  canonicalQuery,
  canonicalModel,
  canonicalPrice,
  canonicalFilterResult,
  canonicalAssessmentRows,
  labelForCandidateIds,
  groupBy,
  multiset,
};
