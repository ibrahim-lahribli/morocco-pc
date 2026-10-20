#!/usr/bin/env node
/**
 * apps/web/scripts/check-i18n.mjs — the S5 formatting gate (test scenario 4:
 * "No hardcoded date/number strings in components").
 *
 * A formatting helper is only useful if it is the ONLY way to format. Four
 * rules, each a real way a locale bug ships:
 *
 *   1. INLINE INTL      `new Intl.NumberFormat(...)` outside `lib/i18n/`. Two
 *                       call sites with slightly different options is how a
 *                       price becomes "7.300" in one card and "7,3" in another.
 *   2. LOCALE METHOD    `.toLocaleString()` / `.toLocaleDateString()` /
 *                       `.toLocaleTimeString()`. These read the RUNTIME locale,
 *                       not the route's, so an Arabic page can print French
 *                       dates on a server whose locale is fr-FR.
 *   3. MONEY LITERAL    "8 500 MAD", "7.300 DH", "8\u00A0500 DH" in JSX. The value
 *                       belongs to the API; only the helper may render it.
 *   4. DATE LITERAL     "12 oct. 2026" — the short month of one language,
 *                       frozen into source.
 *
 * Scope: app/, components/ and lib/, minus `lib/i18n/` (the one place allowed
 * to touch Intl). Comments count, as in `check-tokens.mjs`: a comment that
 * shows a literal teaches the next author to write one. That is why this file
 * describes the patterns instead of printing a sample.
 *
 * Exit 1 on any violation, naming file:line, so the gate is actionable.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TARGETS = ["app", "components", "lib"];
const ALLOWED_DIR = path.join(ROOT, "lib", "i18n");

const RULES = [
  {
    id: "inline-intl",
    pattern: /\bnew\s+Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat)\b/g,
    message: "format through lib/i18n/format.ts, not inline Intl",
  },
  {
    id: "locale-method",
    pattern: /\.toLocale(?:String|DateString|TimeString)\(/g,
    message: "runtime locale; use the route locale via lib/i18n/format.ts",
  },
  {
    id: "money-literal",
    // 1-3 digits, then grouped thousands (space, NBSP, narrow NBSP or dot),
    // optionally decimals, then a currency word.
    pattern: /\b\d{1,3}(?:[\u202F\u00A0 .]\d{3})+(?:[,.]\d+)?\s*(?:MAD|DH)\b/g,
    message: "hardcoded amount; format the API's number with formatMoney()",
  },
  {
    id: "date-literal",
    pattern:
      /\b\d{1,2}\s+(?:janv|f[ée]vr|mars|avr|mai|juin|juil|ao[ûu]t|sept|oct|nov|d[ée]c)\b/gi,
    message: "hardcoded date; format an ISO value with formatDate()",
  },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = TARGETS.flatMap((target) => walk(path.join(ROOT, target))).filter(
  (file) => !file.startsWith(ALLOWED_DIR + path.sep),
);

const violations = [];

for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(line);
      if (match === null) continue;
      violations.push({
        file: path.relative(ROOT, file).split(path.sep).join("/"),
        line: index + 1,
        rule: rule.id,
        found: match[0],
        message: rule.message,
      });
    }
  });
}

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`${v.file}:${v.line}  ${v.rule}  ${JSON.stringify(v.found)}  ${v.message}`);
  }
  console.error(`\nFAIL i18n - ${violations.length} violation(s) in ${files.length} file(s)`);
  process.exit(1);
}

console.log(
  `PASS i18n - ${files.length} file(s), every number and date goes through lib/i18n/format.ts`,
);
