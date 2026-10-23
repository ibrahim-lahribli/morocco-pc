#!/usr/bin/env node
/**
 * apps/web/scripts/check-api-types.mjs — the contract-drift gate (S4).
 *
 * Three things fail this gate, in the order a human would want to hear them:
 *
 *   1. the snapshot is not contract 1.6.0 (the API raised or dropped a version
 *      and the web client was not revisited);
 *   2. the path set is not the eight the web app consumes (a path appeared or
 *      vanished, so a screen may be silently unreachable);
 *   3. `lib/api/schema.d.ts` does not match what the generator produces from
 *      the CURRENT snapshot — the committed types are stale.
 *
 * The generator is invoked exactly as `npm run gen:api-types` does, so "equal"
 * means byte-equal to the committed artifact, not merely semantically similar.
 *
 * Why the snapshot is the API's file: `apps/api/test/unit/openapi-v1.6.json` is
 * already the API team's gated artifact (its own snapshot test fails if the
 * served document drifts from it). Copying it into apps/web would create the
 * exact hazard this repo keeps closing elsewhere — two plausible contracts in
 * one tree, with no way to tell which one the service serves.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const SNAPSHOT = path.resolve(WEB_ROOT, "..", "api", "test", "unit", "openapi-v1.6.json");
const TYPES = path.join(WEB_ROOT, "lib", "api", "schema.d.ts");

const EXPECTED_VERSION = "1.6.0";
const EXPECTED_PATHS = [
  "/v1/catalog/products",
  "/v1/catalog/products/{slug}",
  "/v1/catalog/products/{slug}/price-history",
  "/v1/health",
  "/v1/meta/options",
  "/v1/presets",
  "/v1/recommendations",
  "/v1/recommendations/{id}",
].sort();

function fail(message) {
  console.error("FAIL: " + message);
  process.exit(1);
}

if (!fs.existsSync(SNAPSHOT)) {
  fail(
    "the API snapshot is missing at " + path.relative(WEB_ROOT, SNAPSHOT)
      + ". It is committed by the API suite - run `npm run test:api` at the repo root."
  );
}

const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));

if (snapshot?.info?.version !== EXPECTED_VERSION) {
  fail(
    "the snapshot is contract " + JSON.stringify(snapshot?.info?.version)
      + ", but this client is pinned to " + EXPECTED_VERSION
      + ". Read the API's changelog in docs/API.md, then update EXPECTED_VERSION and regenerate together."
  );
}

const actualPaths = Object.keys(snapshot.paths ?? {}).sort();
const missing = EXPECTED_PATHS.filter((p) => !actualPaths.includes(p));
const extra = actualPaths.filter((p) => !EXPECTED_PATHS.includes(p));
if (missing.length > 0 || extra.length > 0) {
  fail(
    "the path set changed. Missing: " + (missing.join(", ") || "(none)")
      + ". Unexpected: " + (extra.join(", ") || "(none)")
      + ". Either the client is missing a screen or the API removed a route this app still calls."
  );
}

// Resolve the generator's OWN bin so the check needs no npm PATH and cannot
// silently use a different version than `npm run gen:api-types`.
const require = createRequire(import.meta.url);
const generatorPkg = require.resolve("openapi-typescript/package.json");
const generatorBin = path.join(
  path.dirname(generatorPkg),
  require("openapi-typescript/package.json").bin["openapi-typescript"]
);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-types-"));
const tmpTypes = path.join(tmpDir, "schema.d.ts");

try {
  execFileSync(process.execPath, [generatorBin, SNAPSHOT, "-o", tmpTypes], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  // Line endings are normalized before comparing: the generator emits LF, and a
  // Windows checkout (core.autocrlf=true) can hand us CRLF. A newline difference
  // is a checkout artifact, not a contract change, and it must not read as drift.
  const generated = fs.readFileSync(tmpTypes, "utf8").replace(/\r\n/g, "\n");
  const committed = fs.readFileSync(TYPES, "utf8").replace(/\r\n/g, "\n");

  if (generated !== committed) {
    const genLines = generated.split("\n");
    const comLines = committed.split("\n");
    const firstDiff = genLines.findIndex((line, index) => line !== comLines[index]);
    const lineNumber = firstDiff === -1 ? Math.min(genLines.length, comLines.length) : firstDiff + 1;
    fail(
      "lib/api/schema.d.ts is stale: generated output differs from the committed file at line "
        + lineNumber + ".\n  generated: " + JSON.stringify(genLines[firstDiff] ?? "<eof>")
        + "\n  committed: " + JSON.stringify(comLines[firstDiff] ?? "<eof>")
        + "\n  Fix: npm run gen:api-types (and commit the result with the contract change)."
    );
  }

  console.log(
    "PASS api-types -- contract " + EXPECTED_VERSION + ", " + actualPaths.length
      + " paths, schema.d.ts byte-identical to the generator output"
  );
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
