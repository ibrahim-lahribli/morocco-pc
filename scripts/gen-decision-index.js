'use strict';

/**
 * Audit D5 tooling: generate docs/DECISION_INDEX.md from
 * docs/RECOMMENDATION_ENGINE_DECISIONS.md so the index cannot drift.
 *
 * What it does:
 *   1. Reads RECOMMENDATION_ENGINE_DECISIONS.md (CRLF required; BOM tolerated).
 *   2. Finds every decision entry: the `## Decision N ...` global headings plus the
 *      nested `### Decision N ...` entries inside "Engine 3 contract decisions".
 *      Engine-3-local numbering: local 4/5 ARE global Decisions 4/5 (the file has
 *      no `## Decision 4` / `## Decision 5` headings - see AGENTS.md section 2 and
 *      RECOMMENDATION_ENGINE_ARCHITECTURE.md section 11, which cites that section's
 *      Decision 5 for the budget rule). Engine-3-local 1-3 are NOT global 1-3.
 *      `### Decision 18 addendum` is an implementation record, not an entry.
 *   3. REQUIRES a normalized status line as the first content line of every entry:
 *          Status: <STATE> <YYYY-MM-DD>[; <secondary fact>] - <qualifier>
 *      No heuristics, no VERDICT fallback, no UNKNOWN: a missing `Status:` line is
 *      a documentation defect and fails the run. That is audit finding D5's
 *      guarantee that `grep -n "^Status:"` on the decision log is complete and that
 *      "which decisions are open?" has a machine-readable answer.
 *   4. Date column = first YYYY-MM-DD on the `Status:` line, else the entry's own
 *      `Date:` line, else the run fails.
 *   5. Emits docs/DECISION_INDEX.md (CRLF): global table, Engine-3 table,
 *      open-decision summary, reconciliation block - or, with --check, compares
 *      against the committed file and exits non-zero when it is stale.
 *
 * Run:
 *   node scripts/gen-decision-index.js           # regenerate the index
 *   node scripts/gen-decision-index.js --check   # fail (exit 1) if the index is stale
 *   npm run gen:decisions                        # same as the first form
 *
 * The only volatile line is `Generated <date> ...`; --check normalizes that date so
 * the check is stable across days while still catching every other content change.
 * No dependencies beyond Node built-ins.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'RECOMMENDATION_ENGINE_DECISIONS.md');
const OUT = path.join(ROOT, 'docs', 'DECISION_INDEX.md');
const CHECK = process.argv.includes('--check');
const DATE_RE = /\d{4}-\d{2}-\d{2}/;

function fail(msg) {
  console.error('gen-decision-index: ' + msg);
  process.exit(1);
}

function esc(s) {
  return String(s).replace(/\|/g, '\\|');
}

const raw = fs.readFileSync(SRC, 'utf8');
if (!raw.includes('\r\n')) fail('RECOMMENDATION_ENGINE_DECISIONS.md is not CRLF; refusing to parse');
const lines = raw.split('\r\n');

// ---------------------------------------------------------------------------
// 1. Walk headings; track the current `## ` section for nested entries.
// ---------------------------------------------------------------------------
const entries = [];
let inEngine3 = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const isGlobal = /^## Decision \d+/.test(line);
  // ANY `## ` heading ends the Engine 3 section scope (including `## Decision N`
  // global entries) so the nested matcher cannot leak past that section.
  if (/^## /.test(line)) inEngine3 = /^## Engine 3 contract decisions/.test(line);
  const isNested = inEngine3 && /^### Decision \d+/.test(line);
  if (!isGlobal && !isNested) continue;
  const m = isGlobal
    // eslint-disable-next-line no-obscure-text -- dash class is em-dash, hyphen, en-dash
    ? line.match(/^## Decision (\d+) [—\-–] (.+)$/)
    : line.match(/^### Decision (\d+) ?--? (.+?)(\s*\((adopted|resolved)[^)]*\))?\.?\s*$/i);
  if (!m) fail('unparseable decision heading at line ' + (i + 1) + ': ' + line);
  entries.push({
    num: parseInt(m[1], 10),
    title: m[2].trim().replace(/\s*\((RESOLVED|ADOPTED)[^)]*\)\s*$/i, ''),
    line: i + 1,                    // 1-based heading line (the line anchor)
    nested: isNested,
    headingText: line.trim(),
    status: null,
    date: null,
  });
}

// ---------------------------------------------------------------------------
// 2. Normalized `Status:` line - REQUIRED as the first content line of every
//    entry (heading, blank, Status). Hard failure otherwise: the index must be
//    derived from the decision log's own statuses, never from guessed ones.
// ---------------------------------------------------------------------------
for (const e of entries) {
  const h = e.line - 1;             // 0-based heading index
  if (lines[h + 1] !== '') fail('expected a blank line after the heading at line ' + e.line + ' (' + e.title + ')');
  const st = (lines[h + 2] || '').match(/^Status: (.+)$/);
  if (!st) {
    fail('entry at line ' + e.line + ' has no normalized `Status:` line as its first content line: ' +
      e.headingText + '\n  add: Status: RESOLVED <YYYY-MM-DD> - <qualifier>');
  }
  e.status = st[1].trim();
  const dm = e.status.match(DATE_RE);
  if (dm) {
    e.date = dm[0];
  } else {
    for (let j = h + 3; j < lines.length && !/^#{2,3} /.test(lines[j]); j++) {
      const fd = lines[j].startsWith('Date: ') ? lines[j].match(DATE_RE) : null;
      if (fd) { e.date = fd[0]; break; }
    }
  }
  if (!e.date) fail('entry at line ' + e.line + ' has no date: put YYYY-MM-DD on its `Status:` line or on its `Date:` line');
}

// ---------------------------------------------------------------------------
// 3. Reconcile the numbering (no hard-coded total: contiguity + the documented
//    4/5 alias rule + the Engine-3-local set are the invariants).
// ---------------------------------------------------------------------------
const nested = entries.filter((e) => e.nested).sort((a, b) => a.num - b.num);
const topLevel = entries.filter((e) => !e.nested).sort((a, b) => a.num - b.num);
const nums = topLevel.map((e) => e.num);
if (new Set(nums).size !== nums.length) fail('duplicate global decision numbers: ' + nums.join(','));

const missing = [];
let expect = 1;
for (const n of nums) {
  while (expect < n) missing.push(expect++);
  if (n === expect) expect++;
}
let alias45 = false;
if (missing.join(',') === '4,5') {
  alias45 = true;                   // documented: global 4/5 exist only as nested 4/5
} else if (missing.length) {
  fail('global decision numbering gap: missing ' + missing.join(','));
} else if (nested.some((e) => e.num === 4 || e.num === 5)) {
  fail('`## Decision 4` / `## Decision 5` headings now exist alongside the nested Engine-3 4/5 - ' +
    'settle the numbering, then update AGENTS.md section 2 and this script');
}
const nestedNums = nested.map((e) => e.num);
if (JSON.stringify(nestedNums) !== JSON.stringify([1, 2, 3, 4, 5])) {
  fail('Engine-3-local decisions expected [1,2,3,4,5], found ' + JSON.stringify(nestedNums));
}
const globalCount = topLevel.length + (alias45 ? 2 : 0);
const open = entries.filter((e) => !/^RESOLVED\b/.test(e.status));

// ---------------------------------------------------------------------------
// 4. Emit the index (CRLF to match docs/*.md), or verify it with --check.
// ---------------------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const out = [];
out.push('# Decision Index (generated)');
out.push('');
out.push('**GENERATED FILE — do not edit by hand.** Regenerate with `node scripts/gen-decision-index.js`');
out.push('(or `npm run gen:decisions`) after any change to `docs/RECOMMENDATION_ENGINE_DECISIONS.md`.');
out.push('`node scripts/gen-decision-index.js --check` exits non-zero when this file is stale.');
out.push('Generated ' + today + ' from RECOMMENDATION_ENGINE_DECISIONS.md (' + lines.length + ' lines).');
out.push('');
out.push('Generated for audit finding **D5** (decision-log navigability): one row per decision with number,');
out.push('title, status, date and line anchor. Every status comes from the normalized `Status:` line at the');
out.push('top of its entry — nothing here is inferred — so');
out.push('`grep -n "^Status:" docs/RECOMMENDATION_ENGINE_DECISIONS.md` and this table always agree.');
out.push('');
out.push('Numbering: there are no `## Decision 4` / `## Decision 5` headings. Global Decisions 4 and 5 exist');
out.push('only as the nested `### Decision 4` / `### Decision 5` under "Engine 3 contract decisions"');
out.push("(Engine-3-local 4/5 double as global 4/5; `RECOMMENDATION_ENGINE_ARCHITECTURE.md` §11 cites that");
out.push("section's Decision 5 for the budget rule). Engine-3-local `### Decision 1–3` are NOT global 1–3.");
out.push('');
out.push('## Open decisions');
out.push('');
if (open.length === 0) {
  out.push('None. All ' + globalCount + ' global decisions (including the two nested 4/5 aliases) and all ' +
    nested.length + ' Engine-3-local contracts are `RESOLVED` as of ' + today + '.');
} else {
  out.push('Open / not-RESOLVED: ' + open.map((e) => '#' + e.num + ' (' + e.title + ')').join('; ') + '.');
}
out.push('');
out.push('## Global decisions (' + topLevel.length + ' `## Decision` headings + ' +
  (alias45 ? '2 nested 4/5 aliases' : '0 nested aliases') + ' = ' + globalCount + ')');
out.push('');
out.push('| # | Title | Status | Date | DECISIONS.md line |');
out.push('|---|---|---|---|---|');
for (const e of topLevel) {
  out.push('| ' + e.num + ' | ' + esc(e.title) + ' | ' + esc(e.status) + ' | ' + e.date + ' | ' + e.line + ' |');
}
out.push('');
out.push('## Engine 3 contract decisions (Engine-3-local numbering; local 4–5 ARE global Decisions 4–5)');
out.push('');
out.push('| Engine-3 # | Title | Status | Date | DECISIONS.md line |');
out.push('|---|---|---|---|---|');
for (const e of nested) {
  out.push('| ' + e.num + ' | ' + esc(e.title) + ' | ' + esc(e.status) + ' | ' + e.date + ' | ' + e.line + ' |');
}
out.push('');

out.push('## Reconciliation');
out.push('');
out.push('- Global decisions: ' + globalCount + ' = ' + topLevel.length + ' `## Decision` headings' +
  (alias45 ? ' + the 2 Engine-3-local contracts that fill global 4/5' : '') + '.');
out.push('- Engine-3-local contracts: ' + nested.length +
  ' (`### Decision 1–5` under "Engine 3 contract decisions"; local 1–3 are NOT global 1–3, local 4/5 ARE global 4/5 — AGENTS.md §2).');
out.push('- Parsed headings: ' + topLevel.length + ' `## Decision` + ' + nested.length +
  ' `### Decision` (Engine 3 section only; `### Decision 18 addendum` is an implementation record, not an entry).');
out.push('- Status source: each entry’s normalized `Status:` line (first content line). The generator exits');
out.push('  non-zero if a decision is added without one, so this table cannot go stale silently.');
out.push('- Open decisions: ' + (open.length === 0 ? 'none' : open.map((e) => '#' + e.num).join(', ')) + '.');
out.push('');
out.push('Precedence when sources conflict: `AGENTS.md` §9. This file is a **lookup aid**, never a source of truth.');
out.push('');

const content = out.join('\r\n') + '\r\n';
const stripDate = (s) => s.replace(/^Generated \d{4}-\d{2}-\d{2} /m, 'Generated <DATE> ');

if (CHECK) {
  if (!fs.existsSync(OUT)) fail('--check: docs/DECISION_INDEX.md does not exist; run `npm run gen:decisions`');
  const existing = fs.readFileSync(OUT, 'utf8');
  if (stripDate(existing) !== stripDate(content)) {
    fail('--check: docs/DECISION_INDEX.md is STALE; run `npm run gen:decisions` and commit the result');
  }
  console.log('gen-decision-index: OK - docs/DECISION_INDEX.md is up to date');
} else {
  fs.writeFileSync(OUT, content, 'utf8');
  console.log('gen-decision-index: wrote docs/DECISION_INDEX.md (' + topLevel.length +
    ' global + ' + nested.length + ' Engine-3-local entries; ' + globalCount + ' global decisions; ' +
    open.length + ' open)');
}
