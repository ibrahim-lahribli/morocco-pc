import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIRS = ["lib/configurator", "components/configurator", "app/[locale]/configurateur"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

describe("configurator ownership", () => {
  it("never imports the homepage store", () => {
    for (const dir of DIRS) {
      const absolute = path.join(ROOT, dir);
      if (dir !== "lib/configurator" && !existsSync(absolute)) continue;

      expect(existsSync(absolute), `expected ${absolute}`).toBe(true);

      for (const file of sourceFiles(absolute)) {
        const source = readFileSync(file, "utf8");
        expect(source, path.relative(ROOT, file)).not.toMatch(/homepage\/store|useHomepageStore/);
      }
    }
  });
});
