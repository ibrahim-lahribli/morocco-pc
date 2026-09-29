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
  if (!(agents.includes('`001`') && agents.includes('`011`'))) {
    warn('migrations-range-documented', 'tree 001->' + last + ' not visibly cited in AGENTS.md');
  }
  pass('migrations-contiguous', files.length + ' files, range ' + first + '->' + last);
})();

// 2. Decision log parses to the expected counts with Status: lines.
// 24 global headings (no ## Decision 4/5) + nested 1..5 where local 4/5
// double as global 4/5 => 26 global decisions; 24 + 5 entries plus the
// Decision 18 addendum each carry a Status: line => 30.
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
  const ok = global === 24 && nested === 5 && status === 30;
  if (!ok) {
    fail('decisions-parse', 'global=' + global + ' (want 24), nested=' + nested + ' (want 5), Status:=' + status + ' (want 30)');
    return null;
  }
  pass('decisions-parse', global + ' headings + ' + nested + ' nested = 26 global, ' + status + ' Status: lines');
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

// 4. Decision index freshness (same semantics as gen-decision-index --check,
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

// 5. Engine stage entry points match the documented layout.
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

// 6. Documented npm scripts exist.
(function checkScripts() {
  const pkg = JSON.parse(readRepo('package.json'));
  const want = ['test:unit', 'gen:decisions', 'verify:docs'];
  const missing = want.filter((s) => !pkg.scripts || !pkg.scripts[s]);
  if (missing.length > 0) fail('npm-scripts', 'missing: ' + missing.join(', '));
  else pass('npm-scripts', want.join(', ') + ' present');
})();

// 7. Live read-only structural checks (--live only).
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

