'use strict';

/**
 * scripts/lib/enforcement-claims.js — "a rule the doc calls unenforced must not
 * have an implementer" (verify-docs check 9, `engine-enforcement-claims`).
 *
 * Why this exists: the 2026-10-29 engine audit found SIX passages in
 * docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md still saying the four Decision 26
 * item B rules were unimplemented — sixteen days after Decision 45 (E8)
 * shipped all four. The claim was true on 2026-09-28 and was never revisited
 * when the rules landed, because no gate read this file. A design baseline that
 * says a shipped rule does not exist is how a rule gets implemented twice, so
 * the mechanical half of that failure is made detectable here.
 *
 * The rule is narrow ON PURPOSE, and only ever points one way: a doc sentence
 * that asserts a rule is NOT enforced, while the rule's implementing module is
 * in the tree, is a FAIL. The reverse (doc says enforced, module absent) is not
 * checked — that is the roadmap, not a contradiction, and an unbuilt rule is
 * legitimately described as future work.
 *
 * Exemptions, all deliberate:
 *   - struck-through history (`~~...~~`) records what was believed then;
 *   - a line that already says SUPERSEDED or CLOSED has been corrected, and is
 *     dropped from its block entirely so its rule names cannot count either;
 *   - a rule whose module is MISSING is genuinely unenforced, so the sentence
 *     is true and the check stays silent.
 *
 * Scope is a PARAGRAPH, not a line, because the document's worst claims were
 * split: `[DECISION 26 - NOT IMPLEMENTED, EXPLICITLY DEFERRED.` sits on one
 * line and the columns it is about (`max_tdp_watts`, `height_mm`) on the next.
 * A line-scoped check cannot see that, which is how the claim survived. Table
 * rows are their own unit (a table has no blank lines between rows, and one
 * row's correction must not excuse its neighbour) and a heading is its own
 * unit too. The reported line is the first line of the block that carries the
 * claim, so a reader lands on the sentence to fix.
 *
 * Pure: no I/O, no clock, no database. The caller supplies the markdown and a
 * module-existence predicate. The registry lives here so the check, its test
 * and any future doc have one vocabulary.
 */

/**
 * The four rules Decision 26 item B deferred on 2026-09-28 and Decision 45
 * (E8, 2026-10-14) implemented. `keywords` match the phrasings the architecture
 * document actually uses, including hyphenated and prose forms.
 */
const ENFORCED_RULES = Object.freeze([
  Object.freeze({
    id: 'cooler-tdp',
    label: 'cooler max_tdp_watts vs CPU tdp_watts (SOFT since E8)',
    keywords: /max_tdp_watts|cooler[\s-]tdp|cooler TDP|tdp half/i,
    module: 'src/recommendation/compatibility/cooler-tdp.js',
  }),
  Object.freeze({
    id: 'cooler-height',
    label: 'AIR cooler height_mm vs case clearance (HARD since E8)',
    keywords: /max_cpu_cooler_height_mm|height_mm|cooler[\s/-]*height|tdp[\s/,]*(?:and\s+)?height|clearance/i,
    module: 'src/recommendation/compatibility/cooler-height.js',
  }),
  Object.freeze({
    id: 'ram-slots',
    label: 'RAM module_count vs motherboard dimm_slots (HARD since E8)',
    keywords: /module_count|module-count|dimm_slots|slot[\s-]count/i,
    module: 'src/recommendation/compatibility/memory-slots.js',
  }),
  Object.freeze({
    id: 'ram-capacity',
    label: 'RAM total capacity vs motherboard max_memory_capacity_gb (HARD since E8)',
    keywords: /max_memory_capacity_gb|capacity_per_module_gb|total capacity|capacity[\s-]pruning/i,
    module: 'src/recommendation/compatibility/memory-capacity.js',
  }),
]);

/**
 * Phrases that ASSERT a rule is not enforced. The `None of the four is
 * implemented` form matters as much as the explicit ones: that is the sentence
 * the S3 list carried, and a marker list of capitalised status words alone
 * would walk straight past it.
 */
const DEFERRAL_CLAIM = new RegExp(
  [
    '\\bunenforced\\b',
    '\\bnot[ _]implemented\\b',
    '\\bread by nothing\\b',
    '\\bno code reads\\b',
    '\\bnone of the\\b[^.\\n]{0,60}?\\b(?:is|are) implemented\\b',
    '\\bnever built\\b',
  ].join('|'),
  'i'
);

/** A table row or an ATX heading is judged on its own, never with neighbours. */
const STANDALONE_LINE = /^\s*(?:\||#{1,6}\s)/;

/** A line that already records the correction is not a live claim. */
const CORRECTED_LINE = /\b(?:SUPERSEDED|CLOSED)\b/;

/** Struck-through runs, removed before matching so history stays history. */
const STRUCK_THROUGH = /~~[^~]*~~/g;

/**
 * @param {string} text  Markdown to inspect (CRLF or LF).
 * @param {{ hasModule: (relPath: string) => boolean }} options
 * @returns {{ line: number, rule: string, module: string, text: string }[]}
 */
function findStaleEnforcementClaims(text, options) {
  if (typeof text !== 'string') {
    throw new TypeError('findStaleEnforcementClaims expects markdown text');
  }
  if (!options || typeof options.hasModule !== 'function') {
    throw new TypeError('findStaleEnforcementClaims expects { hasModule }');
  }
  const { hasModule } = options;
  const problems = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  // Group into units: a blank line ends a block, while a table row or heading
  // is a unit of its own.
  const units = [];
  let block = null;
  const closeBlock = () => {
    if (block !== null) units.push(block);
    block = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim() === '') {
      closeBlock();
      continue;
    }
    if (STANDALONE_LINE.test(raw)) {
      closeBlock();
      units.push({ start: i + 1, lines: [{ line: i + 1, text: raw }] });
      continue;
    }
    if (block === null) block = { start: i + 1, lines: [] };
    block.lines.push({ line: i + 1, text: raw });
  }
  closeBlock();

  for (const unit of units) {
    // Corrected and struck-through lines cannot contribute a claim OR a name.
    const active = unit.lines
      .map((entry) => ({ line: entry.line, text: entry.text.replace(STRUCK_THROUGH, '') }))
      .filter((entry) => !CORRECTED_LINE.test(entry.text));
    if (active.length === 0) continue;
    const claim = active.find((entry) => DEFERRAL_CLAIM.test(entry.text));
    if (!claim) continue;
    const prose = active.map((entry) => entry.text).join(' ');
    for (const rule of ENFORCED_RULES) {
      if (!rule.keywords.test(prose)) continue;
      if (!hasModule(rule.module)) continue;
      problems.push({
        line: claim.line,
        rule: rule.id,
        module: rule.module,
        text: claim.text.trim(),
      });
    }
  }
  return problems;
}

module.exports = { ENFORCED_RULES, findStaleEnforcementClaims };
