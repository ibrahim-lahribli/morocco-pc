/**
 * scripts/capture-reference.mjs — the v1 reference set (Phase 0, task 7).
 *
 * Why a script and not a person with a phone: every Phase 4 screen is reviewed
 * against "what it looked like before", and a before-image collected by hand is
 * missing exactly the route someone forgot. This walks a fixed list, proves each
 * page answers 200 AT ITS OWN PATH, and screenshots it at three widths in both
 * locales — 13 routes x 2 locales x 3 widths = 78 files.
 *
 * It follows lighthouse-ci.mjs's server pattern on purpose: start the mock and
 * the BUILT app as direct node children, wait for both, and never reuse a server
 * that is already holding a port (a dev server would photograph the wrong app).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { IDS } from "../mock/fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP_PORT = 3210;
const MOCK_PORT = 3211;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const MOCK_ORIGIN = `http://localhost:${MOCK_PORT}`;
const READY_TIMEOUT_MS = 60_000;
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const OUT_DIR = path.join(ROOT, "design", "v1-reference");

/** The v1 surfaces. `name` becomes the filename, `path` is locale-less. */
const ROUTES = [
  { name: "home", path: "/" },
  { name: "configurer", path: "/configurer" },
  { name: "result", path: `/config/${IDS.threeBuilds}` },
  { name: "enregistrements", path: "/enregistrements" },
  { name: "composants", path: "/composants" },
  { name: "comparer", path: "/composants/comparer" },
  { name: "composant", path: "/composants/rtx-4060-8gb" },
  { name: "guides", path: "/guides" },
  { name: "guide", path: "/guides/choisir-un-gpu" },
  { name: "preset", path: "/config-pc-gamer-9000-dh" },
  { name: "contact", path: "/contact" },
  { name: "confidentialite", path: "/confidentialite" },
  { name: "mentions-legales", path: "/mentions-legales" },
];
const LOCALES = ["fr", "ar"];
const WIDTHS = [360, 768, 1280];

const servers = [];
let stopped = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const finish = (inUse) => { socket.destroy(); resolve(inUse); };
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function startServer(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  const capture = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line === "") continue;
      log.push(`[${name}] ${line}`);
      if (log.length > 40) log.shift();
    }
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const server = { name, child, log };
  servers.push(server);
  return server;
}

async function waitForReady(url, server) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (server.child.exitCode !== null) {
      throw new Error(`${server.name} exited (${server.child.exitCode}) before ${url} answered`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`${server.name} did not answer ${url} within ${READY_TIMEOUT_MS} ms`);
    }
    await sleep(250);
  }
}

function stillRunning(server) {
  return server.child.exitCode === null && server.child.signalCode === null;
}

function stopServers() {
  if (stopped !== null) return stopped;
  stopped = (async () => {
    for (const server of servers) if (stillRunning(server)) server.child.kill();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && servers.some(stillRunning)) await sleep(100);
    for (const server of servers) if (stillRunning(server)) server.child.kill("SIGKILL");
  })();
  return stopped;
}

function dumpLogs() {
  for (const server of servers) {
    if (server.log.length === 0) continue;
    console.error(`--- ${server.name} output ---`);
    for (const line of server.log) console.error(line);
  }
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    throw new Error("no production build found — run `npm run build` first");
  }
  for (const [port, label] of [[APP_PORT, "app"], [MOCK_PORT, "fixture mock"]]) {
    if (await portInUse(port)) {
      throw new Error(`port ${port} (${label}) is already in use — stop that server first`);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const mock = startServer("mock", [path.join(ROOT, "mock", "server.mjs")], {
    MOCK_API_PORT: String(MOCK_PORT),
  });
  await waitForReady(`${MOCK_ORIGIN}/v1/health`, mock);

  const app = startServer("app", [NEXT_BIN, "start", "-p", String(APP_PORT)], {
    API_BASE_URL: MOCK_ORIGIN,
  });
  await waitForReady(`${APP_ORIGIN}/fr`, app);

  const browser = await chromium.launch();
  let written = 0;
  const bad = [];
  try {
    for (const route of ROUTES) {
      for (const locale of LOCALES) {
        const url = `${APP_ORIGIN}/${locale}${route.path}`;
        const probe = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!probe.ok) {
          bad.push(`${url} answered ${probe.status}`);
          continue;
        }
        for (const width of WIDTHS) {
          const page = await browser.newPage({ viewport: { width, height: 800 } });
          try {
            const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
            if (!response || !response.ok()) {
              bad.push(`${url} @${width} answered ${response ? response.status() : "no response"}`);
              continue;
            }
            const file = path.join(OUT_DIR, `${route.name}.${locale}.${width}.png`);
            await page.screenshot({ path: file, fullPage: true });
            written += 1;
          } finally {
            await page.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`captured: ${written} of ${ROUTES.length * LOCALES.length * WIDTHS.length}`);
  if (bad.length > 0) {
    console.error("routes that did not answer 200 at their own path:");
    for (const line of bad) console.error(`  ${line}`);
  }
  return bad.length === 0 && written === ROUTES.length * LOCALES.length * WIDTHS.length ? 0 : 1;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopServers().finally(() => process.exit(130));
  });
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error(`capture failed: ${error.message}`);
  dumpLogs();
} finally {
  await stopServers();
}
process.exit(exitCode);
