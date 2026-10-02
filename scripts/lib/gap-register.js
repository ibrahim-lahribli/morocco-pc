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

  for (let i = 0; i < lines.length; i++) {
    // Gap ids that are the SUBJECT of a closed-table row are accounted for by
    // that table, not by section 1 — see the module header on the closed-row
    // policy. Only the ID and Item cells count; a closed row's resolution prose
    // may name-drop other gaps, and those still need a row of their own.
    if (CLOSED_ROW_RE.test(lines[i])) {
      const cells = lines[i].split('|');
      for (const cell of [cells[1], cells[2]]) {
        for (const id of (cell || '').match(MENTION_RE) || []) {
          closedTableIds.add(id);
        }
      }
      continue;
    }

    const match = ROW_RE.exec(lines[i]);
    if (!match) continue;

    const id = match[1];
    const line = i + 1; // 1-based, as an editor shows it
    const cells = lines[i].split('|').length - 2; // leading + trailing empties

    ids.push(id);

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