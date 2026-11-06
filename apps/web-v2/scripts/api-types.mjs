/**
 * OpenAPI type generation for the V2 API client.
 *
 * The contract source is the API's OWN committed snapshot
 * (`apps/api/test/unit/openapi-v1.10.json`) — the same file the API's tests and
 * the V1 web app treat as the contract. V2 does not keep a second copy, so a
 * path or field that leaves the API disappears from these types on the next
 * `npm run gen:api-types`.
 *
 * Both `gen:api-types` and `check:api-types` call `buildApiTypes()` so the
 * committed file and the freshness check can never disagree about formatting.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

export const CONTRACT_PATH = fileURLToPath(
  new URL("../../api/test/unit/openapi-v1.10.json", import.meta.url),
);
export const OUTPUT_PATH = fileURLToPath(new URL("../lib/api/schema.d.ts", import.meta.url));

const HEADER = `/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Source: apps/api/test/unit/openapi-v1.10.json
 * Regenerate: npm run gen:api-types
 * Freshness gate: npm run check:api-types
 */`;

/**
 * Build the TypeScript declaration text from the committed OpenAPI document.
 * `openapi-typescript` emits deterministic output for a given document, which
 * is what makes a byte comparison a meaningful staleness check.
 */
export async function buildApiTypes() {
  const document = JSON.parse(await readFile(CONTRACT_PATH, "utf8"));
  const ast = await openapiTS(document);
  const body = astToString(ast).trimEnd();

  return `${HEADER}\n\n${body}\n`;
}
