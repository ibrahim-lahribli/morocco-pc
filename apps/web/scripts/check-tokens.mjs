#!/usr/bin/env node
/**
 * apps/web/scripts/check-tokens.mjs — the S2 token gate.
 *
 * Three rules, all greppable and all about the same failure: a component that
 * quietly invents a colour or a physical side instead of using a token, so the
 * palette drifts and the Arabic pass (S20) becomes a rewrite.
 *
 *   1. HEX LITERAL       - `#3730A3` in a component. The value belongs in
 *                          app/globals.css and nowhere else.
 *   2. PALETTE CLASS     - `bg-stone-200`, `text-white`, `border-neutral-200`.
 *                          A palette utility bypasses the semantic layer even
 *                          though it contains no hex.
 *   3. PHYSICAL SIDE     - `ml-`, `pr-`, `left-`, `text-right`, `border-l-`.
 *                          Logical properties (`ms/me/ps/pe/start/end/
 *                          text-start`) mirror under `dir="rtl"`; these do not.
 *
 * Scope: every .ts/.tsx under app/, components/ and lib/. `app/globals.css` is
 * the one place a literal is allowed, and it is not scanned. Test files are
 * scanned too - a test that hardcodes a colour is testing something the app
 * cannot render. `components/` joined the list in S3, when the kit moved there:
 * a component is exactly the file this gate exists to constrain.
 *
 * Exit 1 on any violation, naming file:line, so the gate is actionable.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TARGETS = ["app", "components", "lib"];

const RULES = [
  {
    id: "hex-literal",
    // #RGB, #RGBA, #RRGGBB, #RRGGBBAA - but not an HTML id or a URL fragment.
    pattern: /(?<![\w&/])#[0-9a-fA-F]{3,8}\b/g,
    message: "raw hex colour; move it to app/globals.css and use a token",
  },
  {
    id: "palette-class",
    pattern:
      /\b(?:bg|text|border|ring|outline|from|via|to|fill|stroke|divide|shadow|accent|caret|decoration)-(?:white|black|stone|neutral|zinc|gray|slate|indigo|violet|purple|amber|yellow|red|rose|green|emerald|teal|sky|blue)-\d{1,3}\b/g,
    message: "raw palette utility; use a semantic token class",
  },
  {
    id: "physical-side",
    pattern:
      /\b(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r)-(?!none\b)[a-z0-9.[\]%/-]+/g,
    message: "physical side; use the logical property (ms/me/ps/pe/start/end)",
  },
  {
    id: "physical-align",
    pattern: /\btext-(?:left|right)\b/g,
    message: "physical text alignment; use text-start / text-end",
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

/**
 * The files allowed a raw hex outside globals.css: the OG share cards
 * (S15's result card, S18's preset card), whose renderer (Satori) knows neither
 * CSS nor Tailwind - their hex literals ARE the token values globals.css
 * compiles to, named in each card's own header. Only the hex rule exempts them;
 * the palette and physical-side rules still read the files.
 */
const HEX_EXEMPT = new Set([
  path.join(ROOT, "app", "[locale]", "config", "[id]", "opengraph-image.tsx"),
  // S18's preset card: the same renderer, the same reason.
  path.join(ROOT, "app", "[locale]", "[presetSlug]", "opengraph-image.tsx"),
]);

const files = TARGETS.flatMap((target) => walk(path.join(ROOT, target)));
const violations = [];

for (const file of files) {
  const hexExempt = HEX_EXEMPT.has(file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(line);
      if (match === null) continue;
      if (hexExempt && rule.id === "hex-literal") continue;
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
  console.error(`\nFAIL tokens - ${violations.length} violation(s) in ${files.length} file(s)`);
  process.exit(1);
}

console.log(
  `PASS tokens - ${files.length} file(s), no hex literals, no palette utilities, no physical sides`,
);
