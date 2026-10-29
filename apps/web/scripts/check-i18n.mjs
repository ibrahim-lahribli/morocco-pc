#!/usr/bin/env node
/**
 * apps/web/scripts/check-i18n.mjs — the S5 formatting gate (test scenario 4:
 * "No hardcoded date/number strings in components"), extended by S20 with the
 * locale-parity rule.
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
 * And one rule about the catalogues themselves (S20):
 *
 *   5. LOCALE PARITY    `messages/fr.json` and `messages/ar.json` must carry the
 *                       same KEYS and the same ICU PLACEHOLDERS for each key.
 *                       This is the gate the Arabic pass actually needed: the two
 *                       files held 222 keys each, but nothing compared them, so a
 *                       key added to `fr` would have shipped as `MISSING_MESSAGE`
 *                       on `/ar` — a runtime error on the page a translator never
 *                       visits. `next-intl` resolves a missing key at render
 *                       time, so the build stays green and only the Arabic page
 *                       breaks; a key-set diff is the only check that sees it.
 *                       Placeholders are compared too because `{amount}` and
 *                       `{montant}` are both valid Arabic keys with one wrong
 *                       interpolation, which renders the literal brace text.
 *
 * And one rule about the call sites (2026-10-29):
 *
 *   6. TEMPLATE READ    A message with ICU arguments must be read with `t.raw()`
 *                       when the CALLER fills those arguments (`fill()` in the
 *                       wizard, `.replace()` in the swap panel), never with
 *                       `t()`. `t()` FORMATS: with no value for `{count}` it
 *                       reports FORMATTING_ERROR and returns the KEY PATH, so
 *                       the page paints `wizard.progress` where "Étape 1 sur 3"
 *                       belongs. Production hides the error but not the wrong
 *                       text, which is why the browser suite stayed green while
 *                       every dev run was red. The namespaces are resolved per
 *                       BINDING (`const t = await getTranslations({namespace})`,
 *                       the most recent one before the call), so a file with two
 *                       translators (`t` and `tResult`) is judged by the right
 *                       one; a computed key is skipped because it cannot be
 *                       resolved statically.
 *
 * Scope: app/, components/ and lib/, minus `lib/i18n/` (the one place allowed
 * to touch Intl). Comments count, as in `check-tokens.mjs`: a comment that
 * shows a literal teaches the next author to write one. That is why this file
 * describes the patterns instead of printing a sample. Rule 5 reads
 * `messages/*.json` instead and uses `fr` as the reference locale, and rule 6
 * compares the CALL SITES with that same reference.
 *
 * Exit 1 on any violation, naming file:line (or key), so the gate is actionable.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TARGETS = ["app", "components", "lib"];
const ALLOWED_DIR = path.join(ROOT, "lib", "i18n");
const MESSAGES_DIR = path.join(ROOT, "messages");
const REFERENCE_LOCALE = "fr";

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

// ---------------------------------------------------------------------------
// Rule 5: the catalogues must describe the same messages
// ---------------------------------------------------------------------------

/** `{ "a": { "b": "x" } }` -> `[["a.b", "x"]]`, leaves only. */
function flattenMessages(value, prefix = "", out = []) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenMessages(child, prefix === "" ? key : `${prefix}.${key}`, out);
    }
  } else {
    out.push([prefix, value]);
  }
  return out;
}

/** The ICU argument names a message interpolates: `{amount}` and `{n, plural, …}`. */
function placeholders(text) {
  const names = new Set();
  for (const match of String(text).matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

const catalogueFiles = fs.existsSync(MESSAGES_DIR)
  ? fs
      .readdirSync(MESSAGES_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort()
  : [];

const catalogues = new Map();
for (const name of catalogueFiles) {
  const locale = name.slice(0, -".json".length);
  const parsed = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, name), "utf8"));
  catalogues.set(locale, new Map(flattenMessages(parsed)));
}

const reference = catalogues.get(REFERENCE_LOCALE);
if (reference === undefined) {
  violations.push({
    file: `messages/${REFERENCE_LOCALE}.json`,
    line: 0,
    rule: "locale-parity",
    found: "(missing)",
    message: "the reference locale's catalogue does not exist, so nothing can be compared",
  });
} else {
  for (const [locale, messages] of catalogues) {
    if (locale === REFERENCE_LOCALE) continue;
    const file = `messages/${locale}.json`;

    for (const key of reference.keys()) {
      if (messages.has(key)) continue;
      violations.push({
        file,
        line: 0,
        rule: "locale-parity",
        found: key,
        message: `missing key; a render that asks for it would fail on /${locale}`,
      });
    }

    for (const key of messages.keys()) {
      if (reference.has(key)) continue;
      violations.push({
        file,
        line: 0,
        rule: "locale-parity",
        found: key,
        message: `key is not in messages/${REFERENCE_LOCALE}.json, so nothing renders it`,
      });
    }

    for (const [key, expected] of reference) {
      if (!messages.has(key)) continue;
      const actual = messages.get(key);
      const wanted = placeholders(expected).join(",");
      const got = placeholders(actual).join(",");
      if (wanted === got) continue;
      violations.push({
        file,
        line: 0,
        rule: "locale-parity",
        found: key,
        message:
          wanted === ""
            ? `has placeholders (${got || "none"}) where the reference has none`
            : `placeholders {${got}} do not match the reference's {${wanted}}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 6: a caller-filled TEMPLATE is read raw, never formatted
// ---------------------------------------------------------------------------

/** The index of the `)` matching the `(` at `openIndex`, string literals skipped. */
function matchingParen(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      for (i += 1; i < source.length && source[i] !== char; i += 1) {
        if (source[i] === "\\") i += 1;
      }
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

if (reference !== undefined) {
  /** Every message that interpolates something, with the names it needs. */
  const templated = new Map();
  for (const [key, text] of reference) {
    const names = placeholders(text);
    if (names.length > 0) templated.set(key, names);
  }

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(ROOT, file).split(path.sep).join("/");
    const lineAt = (index) => source.slice(0, index).split("\n").length;

    // `const t = await getTranslations({ locale, namespace: "result" })`, and
    // the `useTranslations("x")` form a client component would use.
    const bindings = [];
    const bindingPattern =
      /\b(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\s*\(/g;
    for (const match of source.matchAll(bindingPattern)) {
      const open = match.index + match[0].length - 1;
      const close = matchingParen(source, open);
      if (close === -1) continue;
      const args = source.slice(open + 1, close);
      const namespace =
        /namespace:\s*["']([^"']+)["']/.exec(args)?.[1] ?? /^\s*["']([^"']+)["']/.exec(args)?.[1];
      bindings.push({ name: match[1], namespace: namespace ?? null, index: match.index });
    }
    bindings.sort((a, b) => a.index - b.index);

    for (const binding of bindings) {
      const callPattern = new RegExp(
        `\\b${binding.name.replace(/\$/g, "\\$")}(?:\\.(raw|rich|markup))?\\s*\\(`,
        "g",
      );
      callPattern.lastIndex = binding.index;

      for (const call of source.matchAll(callPattern)) {
        // Lexical shadowing, approximated: a later binding of the same name owns
        // the calls after it, so each call is judged by exactly one binding.
        const owner = bindings.filter((b) => b.name === binding.name && b.index <= call.index).at(-1);
        if (owner !== binding) continue;
        // `t.raw` is the fix this rule asks for: reading a template is not an error.
        if (call[1] === "raw") continue;

        const open = call.index + call[0].length - 1;
        const close = matchingParen(source, open);
        if (close === -1) continue;
        const args = source.slice(open + 1, close);
        const quote = args[0];
        // A computed key (`t(`a.${b}`)`) cannot be resolved here, and a call that
        // is not a literal is somebody else's question.
        if (quote !== '"' && quote !== "'") continue;
        let end = 1;
        while (end < args.length && args[end] !== quote) {
          if (args[end] === "\\") end += 1;
          end += 1;
        }
        const key = args.slice(1, end);
        const rest = args.slice(end + 1).trim();
        const values = rest.startsWith(",") ? rest.slice(1).trim() : null;
        const formatted = values !== null && values !== "" && values !== "{}";
        if (formatted) continue;

        const full = binding.namespace === null ? key : `${binding.namespace}.${key}`;
        const names = templated.get(full) ?? templated.get(key);
        if (names === undefined) continue;

        violations.push({
          file: relative,
          line: lineAt(call.index),
          rule: "template-read",
          found: key,
          message:
            values === null
              ? `interpolates {${names.join(", ")}} but no values are passed; read it with t.raw(...) if the caller fills them`
              : `interpolates {${names.join(", ")}} but its values object is empty; pass them or read it with t.raw(...)`,
        });
      }
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) {
    const where = v.line > 0 ? `${v.file}:${v.line}` : v.file;
    console.error(`${where}  ${v.rule}  ${JSON.stringify(v.found)}  ${v.message}`);
  }
  console.error(`\nFAIL i18n - ${violations.length} violation(s) in ${files.length} file(s)`);
  process.exit(1);
}

const catalogueSummary =
  catalogues.size <= 1
    ? "1 catalogue"
    : `${catalogues.size} catalogues (${catalogueFiles.join(", ")}) with identical keys and placeholders`;
console.log(
  `PASS i18n - ${files.length} file(s), every number and date goes through lib/i18n/format.ts, every caller-filled template is read with t.raw; ${catalogueSummary}`,
);
