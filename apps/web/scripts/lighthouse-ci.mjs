#!/usr/bin/env node
/**
 * apps/web/scripts/lighthouse-ci.mjs — run S6's budgets against the BUILT app.
 *
 * `lhci autorun` alone measures whatever is already listening on 3210. On a
 * developer's machine that is often `next dev` — unbundled, unminified, and
 * nothing like what ships — so a budget measured that way is a lie that looks
 * like a pass. This harness therefore OWNS both servers:
 *
 *   1. refuses to start if the ports are busy (measuring someone else's server
 *      is the failure mode above, and a stale `next start` is just as wrong);
 *   2. refuses to start without a production build, because `next start` would
 *      otherwise serve a stale `.next` or fail late;
 *   3. starts the fixture mock and the built app, waits until BOTH answer, and
 *      requires the measured page ITSELF to answer 200 without a redirect (a
 *      404 or a redirect collects happily and every budget passes on the wrong
 *      page, which is the same lie as measuring a dev server);
 *   4. runs `lhci autorun` (the config is `lighthouserc.cjs`);
 *   5. stops both servers even when Lighthouse fails or the run is interrupted,
 *      and frees the ports.
 *
 * Exit code is Lighthouse's: since S19 the assertions are `error`, so a budget
 * miss fails this script (and the web job) — a collect failure and a `warn`-level
 * miss are non-zero too. Server output is buffered and printed only when
 * something goes wrong, so a green run stays readable.
 *
 * On a failure `assertion-results.json` is printed as well: LHCI's own summary
 * names the assertion but not the aggregate it compared against, and "the median
 * of three" is the entire reason the number is trustworthy.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP_PORT = 3210;
const MOCK_PORT = 3211;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const MOCK_ORIGIN = `http://localhost:${MOCK_PORT}`;
const READY_TIMEOUT_MS = 60_000;
const LHCI_CLI = path.join(ROOT, "node_modules", "@lhci", "cli", "src", "cli.js");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

const servers = [];
/** One cleanup promise, so a signal handler and the normal path cannot race. */
let stopped = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** True when something already answers on the port (IPv4 loopback is enough). */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const finish = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/**
 * Start one server as a DIRECT node child (no shell), so stopping it stops the
 * process that owns the port rather than a wrapper that would leave it behind.
 */
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
      if (log.length > 80) log.shift();
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
      // Not up yet: connect refused, timed out, or answered non-2xx. Retry.
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
    for (const server of servers) {
      if (stillRunning(server)) server.child.kill();
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && servers.some(stillRunning)) await sleep(100);
    for (const server of servers) {
      if (stillRunning(server)) server.child.kill("SIGKILL");
    }
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

// LHCI's summary says "expected <= 2500, found > 2500" and stops there. The
// aggregate it actually compared is only in the JSON, and under a median
// aggregation that number is the one to argue with.
function dumpAssertions() {
  const file = path.join(ROOT, ".lighthouseci", "assertion-results.json");
  try {
    if (!fs.existsSync(file)) return;
    const results = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const result of results) {
      if (result.passed) continue;
      const actual =
        result.actual === undefined ? "" : " (aggregate: " + String(result.actual) + ")";
      console.error(`--- assertion ${result.level}: ${result.auditId}${actual} ---`);
    }
  } catch (error) {
    console.error(`could not read assertion results: ${error.message}`);
  }
}

async function main() {
  // The page to measure comes FROM the config, not from a second copy of the
  // URL: the route the budgets name and the route this harness proves is up
  // have to be the same string, or the proof is about some other page.
  const configPath = path.join(ROOT, "lighthouserc.cjs");
  const { default: config } = await import(pathToFileURL(configPath).href);
  const [measuredUrl] = config.ci.collect.url;

  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    throw new Error(
      "no production build found — run `npm run build` first. Lighthouse must measure the built app, not dev.",
    );
  }

  for (const [port, label] of [
    [APP_PORT, "app"],
    [MOCK_PORT, "fixture mock"],
  ]) {
    if (await portInUse(port)) {
      throw new Error(
        `port ${port} (${label}) is already in use — stop that server first: measuring it would budget the wrong app.`,
      );
    }
  }

  const mock = startServer("mock", [path.join(ROOT, "mock", "server.mjs")], {
    MOCK_API_PORT: String(MOCK_PORT),
  });
  await waitForReady(`${MOCK_ORIGIN}/v1/health`, mock);

  const app = startServer(
    "app",
    [NEXT_BIN, "start", "-p", String(APP_PORT)],
    { API_BASE_URL: MOCK_ORIGIN },
  );
  await waitForReady(`${APP_ORIGIN}/fr`, app);

  // Lighthouse reports the FINAL url, so a redirect is a quiet way to budget the
  // wrong page; both checks run before the three runs are spent.
  const bare = (url) => url.replace(/\/+$/, "");
  const probe = await fetch(measuredUrl, { signal: AbortSignal.timeout(10_000) });
  if (!probe.ok || bare(probe.url) !== bare(measuredUrl)) {
    throw new Error(
      `${measuredUrl} did not answer 200 at its own path (status ${probe.status}, final ${probe.url}) — the budgets would measure the wrong page.`,
    );
  }

  console.log(`Measuring ${measuredUrl} (fixture mock on ${MOCK_PORT}), enforced budgets from lighthouserc.cjs`);
  const result = spawnSync(process.execPath, [LHCI_CLI, "autorun"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

// A Ctrl+C during the measurement must not leave `next start` holding 3210 for
// the next run (or for Playwright, which would then reuse the wrong server).
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopServers().finally(() => process.exit(130));
  });
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error(`FAIL lighthouse-ci: ${error.message}`);
  exitCode = 1;
} finally {
  await stopServers();
  if (exitCode !== 0) {
    dumpAssertions();
    dumpLogs();
  }
}

process.exit(exitCode);
