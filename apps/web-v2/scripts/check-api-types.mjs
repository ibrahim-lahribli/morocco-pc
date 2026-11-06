/**
 * Contract-drift gate: does `lib/api/schema.d.ts` still describe the API's
 * committed OpenAPI document?
 *
 *   npm run check:api-types
 *
 * Exits 1 when the file is missing or stale. The fix is always
 * `npm run gen:api-types`; the check never rewrites the file.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildApiTypes, CONTRACT_PATH, OUTPUT_PATH } from "./api-types.mjs";

const relativeOutput = path.relative(process.cwd(), OUTPUT_PATH);
const relativeContract = path.relative(process.cwd(), CONTRACT_PATH);

const expected = await buildApiTypes();
let actual;

try {
  actual = await readFile(OUTPUT_PATH, "utf8");
} catch {
  console.error(`FAIL: ${relativeOutput} is missing.`);
  console.error("Run: npm run gen:api-types");
  process.exit(1);
}

const normalize = (text) => text.replace(/\r\n/g, "\n");
const expectedText = normalize(expected);
const actualText = normalize(actual);

if (actualText === expectedText) {
  console.log(`api types are up to date (${relativeContract} -> ${relativeOutput})`);
  process.exit(0);
}

const expectedLines = expectedText.split("\n");
const actualLines = actualText.split("\n");
const firstDifference = expectedLines.findIndex((line, index) => line !== actualLines[index]);
const lineNumber =
  firstDifference === -1 ? Math.min(expectedLines.length, actualLines.length) : firstDifference;

const showLine = (line) => (line === undefined ? "<end of file>" : JSON.stringify(line));

console.error(`FAIL: ${relativeOutput} is stale against ${relativeContract}.`);
console.error(`First difference at generated line ${lineNumber + 1}:`);
console.error(`  expected: ${showLine(expectedLines[firstDifference])}`);
console.error(`  actual:   ${showLine(actualLines[firstDifference])}`);
if (actualLines.length > expectedLines.length) {
  console.error(
    `  the committed file has ${actualLines.length - expectedLines.length} extra line(s)`,
  );
}
console.error("Run: npm run gen:api-types");
process.exit(1);
