'use strict';

/**
 * Shared comparison helpers for the generated-doc freshness gates:
 * `scripts/gen-decision-index.js --check` and `scripts/gen-schema-reference.js --check`.
 *
 * Why this exists. Git stores text as LF. A Windows checkout with
 * `core.autocrlf=true` materializes CRLF; a Linux checkout (GitHub Actions, and any
 * clone made with `core.autocrlf=false`) materializes LF. The generators always
 * WRITE CRLF (they join with '\r\n'), so a naive `committed === generated` byte
 * comparison reports STALE on every LF materialization even when the content is
 * identical. That is exactly the CI failure `gen-decision-index --check` hit on
 * 2026-10-07 at commit 8ffeee4: the committed index is LF in the repository, the
 * generator emits CRLF, and the check compared the two raw.
 *
 * The comparison therefore normalizes BOTH sides before comparing:
 *   - CRLF (and a stray lone CR) -> LF
 *   - strip a leading UTF-8 BOM
 *   - neutralize the volatile `Generated <YYYY-MM-DD>` / `as of <YYYY-MM-DD>`
 *     tokens, which change daily and must not make a same-content file "stale"
 *
 * Normalization is comparison-only: the files stay CRLF ON DISK (the writers keep
 * '\r\n'), and the generator output style is unchanged.
 *
 * No dependencies beyond Node built-ins.
 */

// Leading BOM only: a U+FEFF anywhere else is real content and must not be eaten.
const BOM = '\uFEFF';

/**
 * Normalize line endings to LF and strip a single leading UTF-8 BOM.
 * @param {string|null|undefined} s
 * @returns {string}
 */
function normLineEndings(s) {
  return (s == null ? '' : String(s))
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Replace the two volatile date tokens the generators emit with a stable
 * placeholder, so a same-content file generated on a different day is not STALE.
 * @param {string} s
 * @returns {string}
 */
function stripGeneratedDate(s) {
  return String(s == null ? '' : s)
    .replace(/^Generated \d{4}-\d{2}-\d{2} /m, 'Generated <DATE> ')
    .replace(/as of \d{4}-\d{2}-\d{2}/g, 'as of <DATE>');
}

/**
 * The full comparison normalization: line endings + BOM + volatile dates.
 * @param {string|null|undefined} s
 * @returns {string}
 */
function normalizeForCompare(s) {
  return stripGeneratedDate(normLineEndings(s));
}

/**
 * True when the committed file differs from a fresh generation after the
 * line-ending / BOM / volatile-date normalization. Reads the committed file and
 * the generated content directly, so a caller never has to pre-normalize.
 * @param {string|null|undefined} committed
 * @param {string|null|undefined} generated
 * @returns {boolean}
 */
function isStale(committed, generated) {
  return normalizeForCompare(committed) !== normalizeForCompare(generated);
}

/**
 * Short unified-diff-style report of the first differing lines, for CI logs.
 * Both sides are normalized the same way the comparison normalizes them, so the
 * report never shows a difference the check itself ignored (e.g. CRLF vs LF or a
 * differing `Generated <date>`), and it reflects exactly why the check failed.
 * @param {string|null|undefined} committed
 * @param {string|null|undefined} generated
 * @param {{ maxHunks?: number }} [opts]
 * @returns {string}
 */
function firstDiff(committed, generated, opts) {
  const maxHunks = (opts && opts.maxHunks) || 8;
  const a = normalizeForCompare(committed).split('\n');
  const b = normalizeForCompare(generated).split('\n');
  const n = Math.max(a.length, b.length);
  const lines = [];
  let hunks = 0;
  for (let i = 0; i < n && hunks < maxHunks; i++) {
    if (a[i] === b[i]) continue;
    hunks += 1;
    lines.push('@@ line ' + (i + 1) + ' @@');
    lines.push('- ' + (a[i] === undefined ? '<missing line>' : a[i]));
    lines.push('+ ' + (b[i] === undefined ? '<missing line>' : b[i]));
  }
  if (a.length !== b.length) {
    lines.push('(line counts differ: committed ' + a.length + ' vs generated ' + b.length + ')');
  }
  if (hunks >= maxHunks) lines.push('... (more diffs omitted)');
  return lines.join('\n');
}

module.exports = {
  BOM,
  normLineEndings,
  stripGeneratedDate,
  normalizeForCompare,
  isStale,
  firstDiff,
};
