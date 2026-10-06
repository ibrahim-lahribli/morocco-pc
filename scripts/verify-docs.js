'use strict';

/**
 * Audit A2 tooling: verify fact-shaped documentation claims against the
 * repository and (optionally, read-only) the live database.
 *
 * --offline (default; no DB, no network): parse the working tree only.
 * --live: offline checks PLUS read-only information_schema / row-count
 * queries against DATABASE_URL. Structural facts FAIL when wrong;
 * instance-specific counts are INFO only (they describe the DB, not docs).
 *
 * Exit codes: 0 = all checks pass; 1 = at least one FAIL; 2 = usage error.
 * No dependencies beyond Node built-ins (pg + dotenv only for --live).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const LIVE = ARGS.includes('--live');
if (ARGS.some((a) => a !== '--live' && a !== '--offline')) {
  console.error('usage: node scripts/verify-docs.js [--offline] [--live]');
  process.exit(2);
}

let failures = 0;
let warnings = 0;

function pass(name, detail) {
  console.log('PASS ' + name + (detail ? ' -- ' + detail : ''));
}

function fail(name, detail) {
  failures += 1;
  console.log('FAIL ' + name + (detail ? ' -- ' + detail : ''));
}

function info(name, detail) {
  console.log('INFO ' + name + (detail ? ' -- ' + detail : ''));
}

function warn(name, detail) {
  warnings += 1;
  console.log('WARN ' + name + (detail ? ' -- ' + detail : ''));
}

function readRepo(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// 1. Migration filenames form a contiguous 001..NNN range.
(function checkMigrations() {
  const dir = path.join(ROOT, 'database', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const nums = files.map((f) => parseInt(f.split('_')[0], 10));
  const contiguous = nums.length > 0 && nums.every((n, i) => n === i + 1);
  if (!contiguous) {
    fail('migrations-contiguous', 'found: ' + files.join(', '));
    return;
  }
  const first = String(nums[0]).padStart(3, '0');
  const last = String(nums[nums.length - 1]).padStart(3, '0');
  const agents = readRepo('AGENTS.md');
  if (!(agents.includes('`' + first + '`') && agents.includes('`' + last + '`'))) {
    warn('migrations-range-documented', 'tree 001->' + last + ' not visibly cited in AGENTS.md');
  }
  pass('migrations-contiguous', files.length + ' files, range ' + first + '->' + last);
})();

// 2. Decision log parses to the expected counts with Status: lines.
// 24 global headings (no ## Decision 4/5) + nested 1..5 where local 4/5
// double as global 4/5 => 26 global decisions; 24 + 5 entries plus the
// Decision 18 addendum each carry a Status: line => 30; Decision 27 added one
// => 31; Decisions 28, 29 and 30 each added one more => 34; Decision 31
// (OG-33, 2026-10-05) added one more => 35; Decision 32 (OG-32,
// 2026-10-05) added one more => 36; Decisions 33 and 34 each added one more
// => 38; Decision 35 (Decision 35 beta seed-offer freshness, 2026-10-06) added
// one more => 39.
const decisions = (function checkDecisions() {
  const raw = readRepo('docs/RECOMMENDATION_ENGINE_DECISIONS.md');
  if (!raw.includes('\r\n')) {
    fail('decisions-crlf', 'decision log is not CRLF');
    return null;
  }
  const lines = raw.split('\r\n');
  let inEngine3 = false;
  let global = 0;
  let nested = 0;
  let status = 0;
  for (const line of lines) {
    if (/^## /.test(line)) inEngine3 = /^## Engine 3 contract decisions/.test(line);
    if (/^## Decision \d+/.test(line)) global += 1;
    if (inEngine3 && /^### Decision \d+/.test(line)) nested += 1;
    if (/^Status:/.test(line)) status += 1;
  }
  const ok = global === 33 && nested === 5 && status === 39;
  if (!ok) {
    fail('decisions-parse', 'global=' + global + ' (want 33), nested=' + nested + ' (want 5), Status:=' + status + ' (want 39)');
    return null;
  }
  pass('decisions-parse', global + ' headings + ' + nested + ' nested = ' + (global + 2) + ' global, ' + status + ' Status: lines');
  return { globalCount: global + 2 };
})();

// 3. AGENTS.md decision range matches the parsed global count.
(function checkAgentsRange() {
  if (!decisions) {
    fail('agents-decision-range', 'skipped: decision parse failed');
    return;
  }
  const agents = readRepo('AGENTS.md');
  const want = 'Decisions 1-' + decisions.globalCount;
  const wantEn = 'Decisions 1\u2013' + decisions.globalCount;
  if (agents.includes(want) || agents.includes(wantEn)) {
    pass('agents-decision-range', '"' + want + '" cited');
  } else {
    fail('agents-decision-range', 'AGENTS.md does not cite "' + want + '"');
  }
})();

// 4. The gap register's own table shape: every section 1 row has the declared
// six cells, no id is duplicated, and every OG id cited anywhere in
// docs/OPEN_GAPS.md is accounted for by a section 1 row or a closed-table row.
// Added 2026-10-02 after commit 10a8e87 registered OG-29 by editing the OG-26
// row in place and lost its ID cell, leaving OG-26 with no row at all Ã¢ÂÂ an
// IMPORTANT engine-code gap, invisible in the rendered table, caught by
// nothing. Offline: a file read plus scripts/lib/gap-register.js.
(function checkGapRegister() {
  let parsed;
  try {
    const { parseGapRegister } = require(path.join(ROOT, 'scripts', 'lib', 'gap-register'));
    parsed = parseGapRegister(readRepo('docs/OPEN_GAPS.md'));
  } catch (err) {
    fail('gap-register-shape', 'could not parse docs/OPEN_GAPS.md: ' + err.message);
    return;
  }
  if (parsed.problems.length === 0) {
    pass(
      'gap-register-shape',
      parsed.ids.length + ' rows, 6 cells each, every cited OG id has a row'
    );
    return;
  }
  for (const problem of parsed.problems) {
    const where = problem.line === 0 ? 'whole document' : 'line ' + problem.line;
    fail('gap-register-shape', problem.id + ' [' + problem.code + '] (' + where + '): ' + problem.detail);
  }
})();

// 5. Decision index freshness (same semantics as gen-decision-index --check,
// in-process so CI needs only this one script).
(function checkIndexFresh() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-decision-index.js'), '--check'], { stdio: 'pipe' });
    pass('decision-index-fresh', 'gen-decision-index --check clean');
  } catch (_err) {
    fail('decision-index-fresh', 'docs/DECISION_INDEX.md is STALE; run `npm run gen:decisions`');
  }
})();

// 6. Engine stage entry points match the documented layout.
(function checkEngineLayout() {
  const base = path.join(ROOT, 'src', 'recommendation');
  const expected = ['assembly', 'candidates', 'compatibility', 'explanation', 'filtering',
    'offers', 'orchestrator', 'persistence', 'query', 'ranking', 'retention', 'scoring'];
  const missing = [];
  const badEntry = [];
  for (const stage of expected) {
    const dir = path.join(base, stage);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      missing.push(stage);
      continue;
    }
    if (stage === 'persistence') {
      if (!fs.existsSync(path.join(dir, 'persist-ranked.js'))) badEntry.push(stage + ' (no persist-ranked.js)');
    } else if (!fs.existsSync(path.join(dir, 'index.js'))) {
      badEntry.push(stage + ' (no index.js barrel)');
    }
  }
  if (missing.length > 0) fail('engine-layout', 'missing stages: ' + missing.join(', '));
  else if (badEntry.length > 0) fail('engine-layout', 'bad entry points: ' + badEntry.join(', '));
  else pass('engine-layout', expected.length + ' stages, barrels OK (persistence/ exception holds)');
})();

// 7. Documented npm scripts exist.
(function checkScripts() {
  const pkg = JSON.parse(readRepo('package.json'));
  const want = ['test:unit', 'gen:decisions', 'verify:docs'];
  const missing = want.filter((s) => !pkg.scripts || !pkg.scripts[s]);
  if (missing.length > 0) fail('npm-scripts', 'missing: ' + missing.join(', '));
  else pass('npm-scripts', want.join(', ') + ' present');
})();

// 8. Generated docs exist, carry the GENERATED banner, and their generator
// script is wired into package.json (freshness itself is asserted by
// gen-schema-reference.js --check, which needs a DB and therefore stays out
// of the offline gate; see docs/OPEN_GAPS.md maintenance rules).
(function checkGeneratedDocs() {
  const generated = ['docs/SCHEMA_REFERENCE.md', 'docs/DATA_STATE.md'];
  const problems = [];
  for (const rel of generated) {
    let text = null;
    try {
      text = readRepo(rel);
    } catch (_err) {
      problems.push(rel + ' missing (run `npm run gen:schema`)');
      continue;
    }
    if (!text.includes('GENERATED FILE')) {
      problems.push(rel + ' lacks the GENERATED banner (hand-edited?)');
    }
  }
  const recipes = path.join(ROOT, 'docs', 'RECIPES');
  if (!fs.existsSync(recipes) || fs.readdirSync(recipes).length === 0) {
    problems.push('docs/RECIPES/ missing or empty (audit A8)');
  }
  for (const rel of ['docs/GLOSSARY.md', 'docs/TEST_MAP.md']) {
    try {
      readRepo(rel);
    } catch (_err) {
      problems.push(rel + ' missing (audit A6/A7)');
    }
  }
  const pkg = JSON.parse(readRepo('package.json'));
  if (!pkg.scripts || !pkg.scripts['gen:schema']) {
    problems.push('package.json is missing the gen:schema script');
  }
  if (problems.length > 0) fail('generated-docs', problems.join('; '));
  else pass('generated-docs', generated.join(', ') + ' + GLOSSARY/TEST_MAP/RECIPES + gen:schema present');
})();

// 9. Live read-only structural checks (--live only).
//
// Includes the schema-digest freshness gate for the generated docs: the DB's
// structure (tables, columns, enums) is hashed and compared against a digest
// line embedded in docs/SCHEMA_REFERENCE.md. This is the CI-equivalent of
// `gen-schema-reference.js --check` for offline machines Ã¢ÂÂ the decision index
// gets this for free (its --check is DB-free); the schema reference cannot,
// so the digest is computed here read-only instead.
//
// DATA_STATE.md is deliberately NOT digest-gated: its figures (row counts,
// coverage) describe the instance and legitimately drift between generations.
// It is covered by the offline banner check above.
//
// The digest query + hash MUST stay in sync with gen-schema-reference.js
// (buildSchemaReference's digestRows block mirrors this one). If you change
// what the generator renders from the schema, change both.
function computeSchemaDigest(rows) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  for (const r of rows) hash.update(r.kind + '|' + r.a + '|' + r.b + '\n');
  return hash.digest('hex').slice(0, 16);
}

const DIGEST_MARKER = 'schema-digest:';

async function checkLive() {
  require('dotenv').config();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    fail('live-connection', 'DATABASE_URL is not set');
    return;
  }
  let Client;
  try {
    Client = require('pg').Client; // eslint-disable-line global-require
  } catch (_err) {
    fail('live-connection', 'pg module not available');
    return;
  }
  const client = new Client({ connectionString: connectionString });
  try {
    await client.connect();
  } catch (err) {
    fail('live-connection', err.message);
    return;
  }
  try {
    const required = ['product', 'product_variant', 'cpu_spec', 'cooler_spec',
      'benchmark_result', 'component_assessment', 'scoring_model',
      'store', 'store_offer', 'price_history',
      'recommendation_profile', 'recommendation_query', 'recommendation_result',
      'build_candidate', 'build_component'];
    const res = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const have = new Set(res.rows.map((r) => r.table_name));
    const absent = required.filter((t) => !have.has(t));
    if (absent.length > 0) fail('live-tables', 'absent: ' + absent.join(', '));
    else pass('live-tables', required.length + ' core tables present');
    const counts = await client.query(
      'SELECT (SELECT count(*) FROM product) AS products,' +
      ' (SELECT count(*) FROM product_variant) AS variants,' +
      ' (SELECT count(*) FROM store_offer) AS offers,' +
      ' (SELECT count(*) FROM component_assessment) AS assessments,' +
      ' (SELECT count(*) FROM build_candidate) AS candidates'
    );
    const c = counts.rows[0];
    info('live-counts', 'products=' + c.products + ' variants=' + c.variants +
      ' offers=' + c.offers + ' assessments=' + c.assessments +
      ' build_candidates=' + c.candidates + ' (instance-specific, not asserted)');

    // Schema-digest freshness gate for docs/SCHEMA_REFERENCE.md.
    const digestRows = await client.query(
      // Tables + columns.
      "SELECT 'col' AS kind, table_name AS a, column_name || ':' || data_type || ':' || is_nullable AS b" +
      " FROM information_schema.columns WHERE table_schema = 'public'" +
      ' UNION ALL ' +
      // Enum vocabularies (typname + full ordered label list).
      "SELECT 'enum' AS kind, t.typname AS a, e.enumlabel AS b" +
      ' FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid' +
      " JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'" +
      ' ORDER BY kind, a, b'
    );
    const liveDigest = computeSchemaDigest(digestRows.rows);
    let schemaRefText = null;
    try {
      schemaRefText = readRepo('docs/SCHEMA_REFERENCE.md');
    } catch (_err) {
      fail('schema-digest', 'docs/SCHEMA_REFERENCE.md missing (run `npm run gen:schema`)');
    }
    if (schemaRefText !== null) {
      const markerAt = schemaRefText.indexOf(DIGEST_MARKER);
      if (markerAt === -1) {
        fail('schema-digest', 'docs/SCHEMA_REFERENCE.md has no "' + DIGEST_MARKER + '" line; regenerate with `npm run gen:schema`');
      } else {
        const afterMarker = schemaRefText.slice(markerAt + DIGEST_MARKER.length, markerAt + DIGEST_MARKER.length + 40).trim();
        const docDigest = (afterMarker.match(/^[0-9a-f]+/) || [''])[0];
        if (docDigest !== liveDigest) {
          fail('schema-digest', 'docs/SCHEMA_REFERENCE.md is STALE: DB digest ' + liveDigest + ' != doc digest ' + docDigest + ' (run `npm run gen:schema`)');
        } else {
          pass('schema-digest', 'docs/SCHEMA_REFERENCE.md matches the live schema (' + liveDigest + ')');
        }
      }
    }
  } catch (err) {
    fail('live-queries', err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

(async function main() {
  if (LIVE) await checkLive();
  else info('live-checks', 'skipped (offline mode); use --live for read-only DB checks');
  console.log('verify-docs: ' + (failures === 0 ? 'OK' : failures + ' FAILURE(S)') +
    (warnings === 0 ? '' : ', ' + warnings + ' warning(s)'));
  process.exit(failures === 0 ? 0 : 1);
})();

