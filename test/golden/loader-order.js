'use strict';

// test/golden/loader-order.js — the in-database statement-order invariant.
//
// The golden fixtures prove the loaders return the same CONTENT on another
// database. They cannot prove the SQL ORDER BY still exists: every loader
// either re-sorts in JavaScript (loadCandidates, selectCandidatePool) or keys a
// map that is re-sorted (loadComponentAssessments), so a reversed ORDER BY is
// invisible in the returned value. The statement is the only place the order is
// observable.
//
// This module wraps the client's query() for the duration of one
// runRecommendation pass, records each statement with the rows it actually
// returned, classifies the statement by its text (never by an exported
// constant - the AS-OF offers SQL is a private string), and checks the returned
// row sequence against the canonical order for that statement.
//
// The recorded rows are the raw pg rows of that statement: a loader may re-sort
// afterwards, so the check is on the loader's own SQL contract, which is what a
// future "optimisation" would break.

/** UUID strings order byte-wise the same way PostgreSQL's uuid type does. */
function text(value) {
  return value === null || value === undefined ? '' : String(value);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ascending check over a sequence of stringified keys. */
function assertAsc(rows, keyOfRow, label) {
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prev = keyOfRow(rows[i - 1]);
    const cur = keyOfRow(rows[i]);
    if (compareText(prev, cur) > 0) {
      out.push(label + ': row ' + (i - 1) + ' "' + prev + '" > row ' + i + ' "' + cur + '"');
    }
  }
  return out;
}

/** Lexicographic composite ascending check. */
function assertCompositeAsc(rows, keyFns, label) {
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prev = keyFns.map((fn) => fn(rows[i - 1]));
    const cur = keyFns.map((fn) => fn(rows[i]));
    let cmp = 0;
    for (let k = 0; k < prev.length; k += 1) {
      cmp = compareText(prev[k], cur[k]);
      if (cmp !== 0) break;
    }
    if (cmp > 0) {
      out.push(label + ': row ' + (i - 1) + ' [' + prev.join(', ') + '] > row ' + i + ' [' + cur.join(', ') + ']');
    }
  }
  return out;
}

function isVerified(row) {
  return row.ingestion_record_id !== null && row.ingestion_record_id !== undefined;
}

/** (verified class DESC, price ASC, id ASC) — migration 018 provenance order. */
function assertOfferOrder(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const prevClass = isVerified(prev) ? 1 : 0;
    const curClass = isVerified(cur) ? 1 : 0;
    if (prevClass < curClass) {
      out.push('offers: verified class regressed at row ' + i);
      continue;
    }
    if (prevClass > curClass) continue;
    const prevPrice = Number(prev.price);
    const curPrice = Number(cur.price);
    if (prevPrice > curPrice) {
      out.push('offers: row ' + (i - 1) + ' price ' + prevPrice + ' > row ' + i + ' price ' + curPrice);
      continue;
    }
    if (prevPrice === curPrice && compareText(text(prev.id), text(cur.id)) > 0) {
      out.push('offers: row ' + (i - 1) + ' id ' + text(prev.id) + ' > row ' + i + ' id ' + text(cur.id));
    }
  }
  return out;
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

/**
 * (product_id ASC, assessment_type ASC by ENUM declaration order,
 *  assessed_at DESC). `id` is the fourth tiebreak but is not selected, so a
 * same-type same-second tie is unobservable and is accepted.
 */
function assertAssessmentOrder(rows, ctx) {
  const out = [];
  const rank = ctx.assessmentTypeRank;
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const productCmp = compareText(text(prev.product_id), text(cur.product_id));
    if (productCmp > 0) {
      out.push('assessments: product_id row ' + (i - 1) + ' > row ' + i);
      continue;
    }
    if (productCmp < 0) continue;
    const prevRank = rank.get(prev.assessment_type);
    const curRank = rank.get(cur.assessment_type);
    if (prevRank === undefined || curRank === undefined) {
      out.push('assessments: unknown assessment_type ' + prev.assessment_type + ' / ' + cur.assessment_type);
      continue;
    }
    if (prevRank > curRank) {
      out.push('assessments: assessment_type order regressed at row ' + i);
      continue;
    }
    if (prevRank < curRank) continue;
    if (!(toMs(prev.assessed_at) >= toMs(cur.assessed_at))) {
      out.push('assessments: assessed_at is not DESC at row ' + i);
    }
  }
  return out;
}

const PRODUCT_SPEC_TABLES = Object.freeze([
  'cpu_spec',
  'motherboard_spec',
  'ram_spec',
  'ssd_spec',
  'psu_spec',
  'case_spec',
  'cooler_spec',
]);

const hasNullVariantProjection = (sql) => /NULL::uuid\s+AS\s+product_variant_id/i.test(sql);

function candidatesProductClass(table) {
  return {
    key: 'candidates_product:' + table,
    match: (sql) => hasNullVariantProjection(sql)
      && new RegExp('FROM\\s+' + table + '\\s+s\\b', 'i').test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.product_id), 'candidates(' + table + ') product_id ASC'),
  };
}

/**
 * Ordered most-specific-first: a statement is attributed to exactly one
 * classifier, so a broad expression (e.g. a spec table also named inside the
 * candidate loader's EXISTS) can never hide a statement from its owner.
 */
const CLASSES = Object.freeze([
  {
    key: 'now',
    match: (sql) => /SELECT\s+CURRENT_TIMESTAMP\s+AS\s+now/i.test(sql),
    check: () => [],
  },
  {
    key: 'candidates_integrity',
    match: (sql) => /HAVING\s+count\(\*\)\s*>\s*1/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.product_id), 'candidates integrity product_id ASC'),
  },
  ...PRODUCT_SPEC_TABLES.map(candidatesProductClass),
  {
    key: 'candidates_gpu',
    match: (sql) => /FROM\s+product\s+p\s+JOIN\s+product_variant\s+pv\b/i.test(sql)
      && /gpu_board_spec/i.test(sql),
    check: (rows) => assertCompositeAsc(
      rows,
      [(row) => text(row.product_id), (row) => text(row.product_variant_id)],
      'candidates(GPU) (product_id, product_variant_id) ASC'
    ),
  },
  {
    key: 'offers',
    match: (sql) => /FROM\s+store_offer\b/i.test(sql),
    check: (rows) => assertOfferOrder(rows),
  },
  {
    key: 'support:cpu_motherboard',
    match: (sql) => /FROM\s+cpu_motherboard_support\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.id), 'cpu_motherboard_support id ASC'),
  },
  {
    key: 'support:cooler_socket',
    match: (sql) => /FROM\s+cooler_socket_support\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.id), 'cooler_socket_support id ASC'),
  },
  {
    key: 'support:case_form_factor',
    match: (sql) => /FROM\s+case_motherboard_form_factor\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.id), 'case_motherboard_form_factor id ASC'),
  },
  {
    key: 'support:case_radiator',
    match: (sql) => /FROM\s+case_radiator_support\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.id), 'case_radiator_support id ASC'),
  },
  {
    key: 'platform_memory',
    match: (sql) => /FROM\s+platform_memory_support\b/i.test(sql),
    check: (rows) => assertCompositeAsc(
      rows,
      [(row) => text(row.platform_id), (row) => text(row.memory_type_id)],
      'platform_memory_support (platform_id, memory_type_id) ASC'
    ),
  },
  {
    key: 'motherboard_memory',
    match: (sql) => /FROM\s+motherboard_memory_support\b/i.test(sql),
    check: (rows) => assertCompositeAsc(
      rows,
      [(row) => text(row.motherboard_product_id), (row) => text(row.memory_type_id)],
      'motherboard_memory_support (motherboard_product_id, memory_type_id) ASC'
    ),
  },
  {
    key: 'platform_by_socket',
    match: (sql) => /FROM\s+platform\s+WHERE/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.id), 'platform_by_socket id ASC'),
  },
  {
    key: 'spec:cpu',
    match: (sql) => /FROM\s+cpu_spec\s+cs\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.product_id), 'cpu_spec product_id ASC'),
  },
  {
    key: 'spec:motherboard',
    match: (sql) => /FROM\s+motherboard_spec\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.product_id), 'motherboard_spec product_id ASC'),
  },
  {
    key: 'spec:ram',
    match: (sql) => /FROM\s+ram_spec\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.product_id), 'ram_spec product_id ASC'),
  },
  {
    key: 'spec:cooler',
    match: (sql) => /FROM\s+cooler_spec\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.product_id), 'cooler_spec product_id ASC'),
  },
  {
    key: 'spec:case',
    match: (sql) => /FROM\s+case_spec\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.product_id), 'case_spec product_id ASC'),
  },
  {
    key: 'spec:psu',
    match: (sql) => /FROM\s+psu_spec\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.product_id), 'psu_spec product_id ASC'),
  },
  {
    key: 'spec:gpu',
    match: (sql) => /FROM\s+gpu_board_spec\s+b\b/i.test(sql),
    check: (rows) => assertAsc(rows, (row) => text(row.product_variant_id), 'gpu_board_spec product_variant_id ASC'),
  },
  {
    key: 'assessments',
    match: (sql) => /FROM\s+component_assessment\b/i.test(sql),
    check: (rows, ctx) => assertAssessmentOrder(rows, ctx),
  },
  {
    key: 'query',
    match: (sql) => /FROM\s+recommendation_query\b/i.test(sql) && !/FOR\s+UPDATE/i.test(sql),
    check: (rows) => (rows.length === 1 ? [] : ['recommendation_query: expected exactly one row, got ' + rows.length]),
  },
  {
    key: 'model',
    match: (sql) => /FROM\s+scoring_model\b/i.test(sql),
    check: (rows) => (rows.length === 1 ? [] : ['scoring_model: expected exactly one row, got ' + rows.length]),
  },
]);

const CLASS_BY_KEY = new Map(CLASSES.map((c) => [c.key, c]));

const EXPECTED_CLASSES = Object.freeze(CLASSES
  .map((c) => c.key)
  .filter((key) => key !== 'now'));

/**
 * Wrap client.query for one pass. Every resolved statement is recorded with
 * the rows it returned. The wrapper is restored by the caller in a finally.
 */
function instrument(client) {
  const original = client.query.bind(client);
  const records = [];
  client.query = async function instrumentedQuery(sql, params) {
    const result = await original(sql, params);
    const sqlText = typeof sql === 'string' ? sql : (sql && sql.text) || '';
    if (sqlText.length > 0 && result && Array.isArray(result.rows)) {
      records.push({ text: sqlText, rows: result.rows });
    }
    return result;
  };
  return {
    records,
    restore() { client.query = original; },
  };
}

function classify(records) {
  const out = new Map();
  for (const record of records) {
    for (const cls of CLASSES) {
      if (cls.match(record.text)) {
        if (!out.has(cls.key)) out.set(cls.key, []);
        out.get(cls.key).push(record);
        break;
      }
    }
  }
  return out;
}

/** Order violations for every recorded statement of one class. */
function violations(key, records, ctx) {
  const cls = CLASS_BY_KEY.get(key);
  if (cls === undefined) throw new Error('unknown statement class: ' + key);
  const out = [];
  for (const record of records || []) out.push(...cls.check(record.rows, ctx));
  return out;
}

module.exports = {
  instrument,
  classify,
  violations,
  EXPECTED_CLASSES,
  // exported for the proof scripts and direct checks
  assertAsc,
  assertCompositeAsc,
  assertOfferOrder,
  assertAssessmentOrder,
};
