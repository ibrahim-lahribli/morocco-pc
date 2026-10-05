'use strict';

/**
 * scripts/lib/gap-register.js — shape checker for the consolidated gap
 * register (docs/OPEN_GAPS.md).
 *
 * Why this exists: on 2026-10-02 commit 10a8e87 registered a new gap (OG-29)
 * by editing the OG-26 row in place, and lost that row's ID cell. The result
 * was a single 11-cell row inside a 6-column table: OG-26 — an IMPORTANT
 * engine-code gap and the first entry in the register's own section 7
 * next-actions list — had no row of its own and was invisible to every reader
 * of the rendered markdown. No gate failed, because nothing looked at this
 * file. The register's own maintenance rules (section 6) already name the
 * failure mode ("it has already drifted twice"); this module makes the
 * mechanical part of it detectable instead.
 *
 * The register is hand-maintained and never generated, so this is a pure
 * parse with no I/O, no clock and no database — the caller supplies the
 * markdown text. It is deliberately narrow: it checks the table's SHAPE, not
 * the truth of any row's prose.
 *
 * What "shape" means here, from the register's own header row:
 *   | ID | Gap | Class | Status | Owner | Source(s) |
 * A gap row is a line beginning `| OG-nn |`. Each must have exactly six cells,
 * each ID must appear once, and every `OG-nn` mentioned in the document must
 * be accounted for by either a section 1 row or a closed-table row. That last
 * rule is the one that catches the 10a8e87 class of damage: prose in sections
 * 5-7 can reference a gap that no longer exists, and nothing else notices.
 *
 * The closed-table exemption is not a loophole, it is the register's own
 * documented policy (section 1, "Closed-row policy"): a closed row leaves
 * section 1 once its ID is cited only from the closed tables in sections 2/3.
 * So an OG id that is the SUBJECT of a `| C-nn |` row is legitimately closed,
 * while an id cited only from prose is the defect.
 *
 * "Subject" is deliberately narrow: a closed-table row's ID and Item cells
 * only, never its Status or Resolution prose. C-16's resolution text mentions
 * OG-26 only as a side effect ("OG-26 re-measured in the opposite direction"),
 * and harvesting from that cell would excuse any gap that a closed row merely
 * name-drops — which is precisely the gap this check exists to catch.
 *
 * Table CONTIGUITY is also checked, because a 6-column markdown table ends at
 * the first blank line: prose that follows a row with no blank line between
 * renders as a new, broken table rather than as text. That is not a cell-count
 * defect, so ROW_CELL_COUNT cannot see it — every row is individually
 * perfect while the document is shredded. This actually happened on
 * 2026-10-04, when a shell heredoc expanded the backticks in a C-22 row and
 * left ten shredded lines after it; the register passed every other check.
 * A row followed directly by a non-blank, non-row, non-heading line is
 * therefore a CONTIGUITY_BREAK.
 *
 * Explicit NON-responsibilities: does not parse the closed tables (C-nn ids
 * are not gap ids), does not validate the class/status/owner vocabularies,
 * does not check that a row's claimed status matches reality, and does not
 * read the file — the caller does that, so this stays unit-testable.
 *
 * Pure and deterministic: same input string always yields the same result.
 */

'use strict';

/** Cells a section 1 gap row must have, from the register's header row. */
const EXPECTED_CELLS = 6;

/** A line that opens a section 1 gap row. */
const ROW_RE = /^\|\s*(OG-\d{2})\s*\|/;

/** Any mention of a gap id anywhere in the document. */
const MENTION_RE = /OG-\d{2}/g;

/** A row of the closed tables (sections 2/3), which cite gap ids by subject. */
const CLOSED_ROW_RE = /^\|\s*C-\d{2}\s*\|/;

/**
 * A row of section 1's data-research sub-table, which repeats a gap id in BOLD
 * and has three columns (Row | Live residue | Blocked on). It is deliberately
 * not matched by ROW_RE, which requires a bare `OG-nn` first cell.
 */
const SUBTABLE_ROW_RE = /^\|\s*\*\*OG-\d{2}\*\*\s*\|/;

/** A table header row, used to learn that table's column count. */
const TABLE_HEADER_RE = /^\|\s*ID\s*\|/;

/** Any line that belongs to a markdown table. */
const TABLE_LINE_RE = /^\|/;

/** A markdown heading; legitimately ends a table without a blank line. */
const HEADING_RE = /^#{1,6}\s/;

/**
 * Parse the register's markdown and report every shape problem it finds.
 *
 * @param {string} markdown the full contents of docs/OPEN_GAPS.md
 * @returns {{ids: string[], problems: Array<{code: string, id: string, line: number, detail: string}>}}
 *   `ids` is every gap-row id in file order; `problems` is empty when the
 *   table is well-formed. Problems are collected in a single pass so one bad
 *   row does not hide the next.
 */
function parseGapRegister(markdown) {
  if (typeof markdown !== 'string') {
    throw new TypeError('markdown must be a string');
  }

  // Split on CRLF or LF: the register is stored CRLF, but a stray LF must not
  // make every cell count wrong.
  const lines = markdown.split(/\r?\n/);
  const ids = [];
  const problems = [];
  const rowLineById = new Map();
  const closedTableIds = new Set();
  // Column count of the table currently being scanned, learned from its own
  // header row rather than hardcoded, so adding a column later needs no edit.
  // null means "no header seen yet for this table": the closed-row check is
  // then skipped rather than guessing, so a C-row in an excerpt that carries no
  // header cannot be reported against the wrong column count.
  let currentTableCells = null;
  // Line index of the previous data-research sub-table row, so a blank line
  // splitting that table can be detected.
  let prevSubRowIdx = null;

  for (let i = 0; i < lines.length; i++) {
    // A row must not be followed directly by prose. Markdown ends a table at
    // the first blank line, so a run like `| C-22 | ... |` then `  (migration`
    // renders as a second broken table instead of text — every cell count is
    // correct and no other check notices. Reported per offending line so the
    // fix is localisable.
    if (TABLE_LINE_RE.test(lines[i]) && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (
        next.trim() !== '' &&
        !TABLE_LINE_RE.test(next) &&
        !HEADING_RE.test(next)
      ) {
        problems.push({
          code: 'CONTIGUITY_BREAK',
          id: 'table',
          line: i + 2,
          detail:
            'a table row is followed immediately by non-table text ("' +
            next.trim().slice(0, 60) +
            '") with no blank line between; markdown ends the table at the ' +
            'blank line, so this renders as a second broken table and the ' +
            'rows above it stop being readable',
        });
      }
    }

    // Gap ids that are the SUBJECT of a closed-table row are accounted for by
    // that table, not by section 1 — see the module header on the closed-row
    // policy. Only the ID and Item cells count; a closed row's resolution prose
    // may name-drop other gaps, and those still need a row of their own.
    // A header row tells us how many columns the table below it has. Section 1
    // has 6; the closed tables have 4. Reading it here keeps the closed-table
    // cell check from needing a hardcoded constant.
    if (TABLE_HEADER_RE.test(lines[i])) {
      currentTableCells = lines[i].split('|').length - 2;
    } else if (HEADING_RE.test(lines[i])) {
      // A new section means a new table; its shape is unknown until its header.
      currentTableCells = null;
    }

    // The data-research sub-table must be ONE table. A blank line ends a
    // markdown table, so a blank line between two of its rows renders the tail
    // as a headerless fragment — the exact defect fixed in a95353a, which this
    // check exists to stop recurring.
    if (SUBTABLE_ROW_RE.test(lines[i])) {
      if (prevSubRowIdx !== null) {
        for (let j = prevSubRowIdx + 1; j < i; j += 1) {
          if (lines[j].trim() === '') {
            problems.push({
              code: 'SUBTABLE_SPLIT',
              id: 'table',
              line: j + 1,
              detail:
                'a blank line splits the section 1 data-research sub-table; markdown ' +
                'ends a table at the blank line, so the rows after it render as a ' +
                'headerless fragment. ROW_RE does not match this table’s bolded ids, ' +
                'so no other check sees it.',
            });
            break;
          }
        }
      }
      prevSubRowIdx = i;
    }

    if (CLOSED_ROW_RE.test(lines[i])) {
      const cells = lines[i].split('|');
      for (const cell of [cells[1], cells[2]]) {
        for (const id of (cell || '').match(MENTION_RE) || []) {
          closedTableIds.add(id);
        }
      }

      // Closed-table rows were previously exempt from every cell check. A row
      // that lost a cell renders as a broken table exactly like a section 1 row
      // does, so it is checked against its own table's header column count.
      const cellCount = cells.length - 2;
      if (currentTableCells !== null && cellCount !== currentTableCells) {
        problems.push({
          code: 'CLOSED_ROW_CELL_COUNT',
          id: (cells[1] || '').trim(),
          line: i + 1,
          detail:
            'closed-table row has ' +
            cellCount +
            ' cells, expected ' +
            currentTableCells +
            ' from its table header; a missing cell makes the row render as a ' +
            'broken table',
        });
      }
      continue;
    }

    const match = ROW_RE.exec(lines[i]);
    if (!match) continue;

    const id = match[1];
    const line = i + 1; // 1-based, as an editor shows it
    const cells = lines[i].split('|').length - 2; // leading + trailing empties

    ids.push(id);

    // A header governs the rows that immediately follow it in the SAME table.
    // Once a section 1 gap row appears, the pending header no longer describes
    // whatever comes next, so the closed-row check falls back to "unknown"
    // rather than checking a C-row against section 1's 6 columns.
    currentTableCells = null;

    if (rowLineById.has(id)) {
      problems.push({
        code: 'DUPLICATE_ID',
        id,
        line,
        detail:
          'id already has a row on line ' +
          rowLineById.get(id) +
          '; a gap id may appear once',
      });
    } else {
      rowLineById.set(id, line);
    }

    if (cells !== EXPECTED_CELLS) {
      problems.push({
        code: 'ROW_CELL_COUNT',
        id,
        line,
        detail:
          'row has ' +
          cells +
          ' cells, expected ' +
          EXPECTED_CELLS +
          ' (ID | Gap | Class | Status | Owner | Source(s)); a row with a ' +
          'missing or extra cell usually means two gaps were merged into one line',
      });
    }
  }

  // An id referenced in prose (section 5 contradictions, section 6 rules,
  // section 7 next actions, or another row's Source cell) but with no row of
  // its own is invisible in the rendered table. This is the 10a8e87 failure.
  const referenced = new Set(markdown.match(MENTION_RE) || []);
  for (const id of [...referenced].sort()) {
    if (!rowLineById.has(id) && !closedTableIds.has(id)) {
      problems.push({
        code: 'REFERENCED_ABSENT',
        id,
        line: 0, // 0 = the whole document, not one line
        detail:
          'cited in this document but has no "| ' + id + ' |" row; a reader of the ' +
          'rendered table cannot see it',
      });
    }
  }

  return { ids, problems };
}

module.exports = { EXPECTED_CELLS, parseGapRegister };