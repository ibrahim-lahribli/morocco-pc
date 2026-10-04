'use strict';

// scripts/lib/gap-register.test.js — shape tests for the consolidated gap
// register (docs/OPEN_GAPS.md).
//
// Uses node:test + node:assert/strict only. Tests the pure
// parseGapRegister() (markdown passed as a parameter; no file or DB access).
// NOT part of `npm run test:unit` (that glob is `src/**/*.test.js`); run with:
//   node --test scripts/lib/gap-register.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseGapRegister } = require('./gap-register');

// The header row of the register's section 1 table, verbatim shape.
const HEADER = [
  '| ID | Gap | Class | Status | Owner | Source(s) |',
  '|---|---|---|---|---|---|',
].join('\n');

function row(id, gap) {
  return `| ${id} | ${gap} | **IMPORTANT** | OPEN | engine-code | ARCH 16 |`;
}

describe('parseGapRegister', () => {
  it('accepts a well-formed register', () => {
    const md = [HEADER, row('OG-01', 'a'), row('OG-26', 'b')].join('\n');
    const r = parseGapRegister(md);
    assert.deepStrictEqual(r.ids, ['OG-01', 'OG-26']);
    assert.deepStrictEqual(r.problems, []);
  });

  it('reports a row whose cell count is not 6', () => {
    // The 10a8e87 damage: OG-26's cells appended onto the OG-29 row, so one
    // 11-cell row sits in a 6-column table and OG-26 has no row at all.
    const md = [
      HEADER,
      '| OG-29 | gap | **ACCEPTABLE** | OPEN | data-research | src | tail | **IMPORTANT** | OPEN | engine-code | src |',
    ].join('\n');
    const r = parseGapRegister(md);
    assert.deepStrictEqual(r.problems.map((p) => p.code), ['ROW_CELL_COUNT']);
    assert.strictEqual(r.problems[0].id, 'OG-29');
    assert.strictEqual(r.problems[0].line, 3);
  });

  it('reports an id cited in prose that has no row', () => {
    const md = [HEADER, row('OG-29', 'gap'), '', 'The next action is OG-26.'].join('\n');
    const r = parseGapRegister(md);
    assert.deepStrictEqual(r.problems.map((p) => p.code), ['REFERENCED_ABSENT']);
    assert.strictEqual(r.problems[0].id, 'OG-26');
  });

  it('reports a repeated id', () => {
    const md = [HEADER, row('OG-26', 'a'), row('OG-26', 'b')].join('\n');
    assert.deepStrictEqual(parseGapRegister(md).problems.map((p) => p.code), [
      'DUPLICATE_ID',
    ]);
  });

  it('reports every problem in one pass, not just the first', () => {
    const md = [
      HEADER,
      '| OG-29 | gap | A | B | C | D | E |',
      row('OG-26', 'ok'),
      '',
      'See also OG-26 and OG-27.',
    ].join('\n');
    const r = parseGapRegister(md);
    assert.deepStrictEqual(r.problems.map((p) => p.code).sort(), [
      'REFERENCED_ABSENT',
      'ROW_CELL_COUNT',
    ]);
  });

  it('ignores closed-table C-nn ids and prose without an OG mention', () => {
    const md = [
      HEADER,
      '| C-14 | OG-24 residue |',
      '| C-16 | OG-01 closed |',
      '',
      'Nothing to see; no gap ids here.',
    ].join('\n');
    const r = parseGapRegister(md);
    assert.deepStrictEqual(r.ids, []);
    assert.deepStrictEqual(r.problems, []);
  });

  it('does NOT let a closed row excuse an id it only names in passing', () => {
    // The real 10a8e87 shape: C-16's Item cell names OG-01 (its subject), but
    // its Resolution cell mentions OG-26 only as a side effect. Only the
    // former counts as "closed and accounted for"; otherwise a gap that lost
    // its row would be silently excused by any closed row that name-drops it.
    const md = [
      HEADER,
      row('OG-01', 'a'),
      '| C-16 | **OG-01 — research** | CLOSED | Side effects: OG-26 re-measured. |',
    ].join('\n');
    assert.deepStrictEqual(
      parseGapRegister(md).problems.map((p) => [p.code, p.id]),
      [['REFERENCED_ABSENT', 'OG-26']]
    );
  });

  it('accepts CRLF input, which is how the register is stored', () => {
    const md = [HEADER, row('OG-01', 'a'), '', 'See OG-01.'].join('\r\n');
    const r = parseGapRegister(md);
    assert.deepStrictEqual(r.ids, ['OG-01']);
    assert.deepStrictEqual(r.problems, []);
  });

  it('does not treat the separator row as a gap row', () => {
    const md = [HEADER, row('OG-01', 'a')].join('\n');
    assert.strictEqual(parseGapRegister(md).ids.length, 1);
  });

  // --- table contiguity -------------------------------------------------
  // The 2026-10-04 shred: a heredoc expanded the backticks in a C-22 row and
  // left ten prose lines directly after it. Every cell count was correct and
  // every other check passed, because markdown ends a table at the first
  // blank line -- so the tail rendered as a second, broken table.
  it('reports prose that follows a table row with no blank line between', () => {
    const md = [
      HEADER,
      row('OG-01', 'a'),
      '| C-22 | **OG-04 - rejections** | CLOSED 2026-10-04 | `t` (migration `014.sql`) |',
      '  (migration ) +  /',
      ' , written by the commit wrapper',
    ].join('\n');
    const problems = parseGapRegister(md).problems;
    assert.strictEqual(problems.filter((p) => p.code === 'CONTIGUITY_BREAK').length, 1);
    assert.strictEqual(problems[0].line, 5); // 1-based: the offending line, not the row above it
    assert.match(problems[0].detail, /ends the table/);
  });

  it('accepts prose after a blank line, which is how markdown ends a table', () => {
    const md = [
      HEADER,
      row('OG-01', 'a'),
      '',
      'Next actions follow here.',
    ].join('\n');
    assert.deepStrictEqual(parseGapRegister(md).problems, []);
  });

  it('accepts a heading immediately after a table row, with no blank line', () => {
    const md = [HEADER, row('OG-01', 'a'), '## 4. Audit'].join('\n');
    assert.deepStrictEqual(parseGapRegister(md).problems, []);
  });

  it('accepts a blank CRLF line between a row and the prose after it', () => {
    const md = [HEADER, row('OG-01', 'a'), '', 'Tail prose.'].join('\r\n');
    assert.deepStrictEqual(parseGapRegister(md).problems, []);
  });
});