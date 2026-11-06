/**
 * Write `lib/api/schema.d.ts` from the API's committed OpenAPI snapshot.
 *
 *   npm run gen:api-types
 *
 * The output is generated, never hand-edited. `npm run check:api-types` fails
 * when the committed file no longer matches the contract.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildApiTypes, CONTRACT_PATH, OUTPUT_PATH } from "./api-types.mjs";

const output = await buildApiTypes();

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, output, "utf8");

console.log(
  `generated ${path.relative(process.cwd(), OUTPUT_PATH)} from ${path.relative(
    process.cwd(),
    CONTRACT_PATH,
  )}`,
);
