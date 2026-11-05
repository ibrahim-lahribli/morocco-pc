/**
 * scripts/g3-capture.mjs — the images half of the G3 evidence pack.
 *
 * WHY A SCRIPT. The pack must be reproducible: a review image collected by hand
 * is a claim nobody can re-run. This walks a fixed matrix (locale x route x
 * viewport), proves each page answers 200 AT ITS OWN PATH, screenshots it, and
 * then composes the shell comparisons the gate asks for.
 *
 * WHAT IT WRITES (all under design/g3-review/):
 *
 *   <locale>/<route>.<locale>.<w>x<h>.viewport.png   what a phone sees
 *   <locale>/<route>.<locale>.<w>x<h>.full.png       the whole page (phone widths only)
 *   <locale>/home.<locale>.360x800.bottom.png        scrolled to the footer
 *   <locale>/focus.<locale>.360x800.png              keyboard focus on the active tab
 *   <locale>/home.<locale>.iphone.<w>x<h>.webkit.png WebKit at iPhone metrics
 *   <locale>/arabic-price.<locale>.360x800@3x.png    the money element at 3x (ar)
 *   compare/<piece>.<locale>.compare.png             ours beside the Stitch board
 *   og/og-<card>.ar.1200x630.png                     the two Arabic share cards
 *
 * THE FOLDER BUDGET IS 3 MB. Playwright writes lossless PNG and a full-page
 * 360 px capture of the result page is a metre of scrolling, so every file is
 * re-encoded to a palette PNG at the end (see `compress`) and the script prints
 * the final size. If the budget is ever exceeded it fails rather than silently
 * shipping an oversized pack.
 *
 * It follows scripts/capture-reference.mjs's server pattern on purpose: start the
 * mock and the BUILT app as direct children, wait for both, and never reuse a
 * server already holding a port (a dev server would photograph the wrong app).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, webkit } from "@playwright/test";
import sharp from "sharp";

import { IDS } from "../mock/fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP_PORT = 3210;
const MOCK_PORT = 3211;
const BROWSER_MOCK_PORT = 3000;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const MOCK_ORIGIN = `http://localhost:${MOCK_PORT}`;
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const OUT_DIR = path.join(ROOT, "design", "g3-review");
const STITCH_DIR = path.join(ROOT, "design", "stitch");
const BUDGET_BYTES = 3 * 1024 * 1024;

/** The four routes the gate names. `name` becomes the filename stem. */
const ROUTES = [
  { name: "home", path: "/" },
  { name: "contact", path: "/contact" },
  { name: "guides", path: "/guides" },
  { name: "result", path: `/config/${IDS.threeBuilds}` },
];
const LOCALES = ["fr", "ar"];
const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];
/** Full-page captures only at the two phone widths: they are metres tall. */
const FULL_PAGE_WIDTHS = [360, 390];

/**
 * The Stitch boards the shell pieces are compared against.
 *
 * There are TWO home boards and they are not interchangeable:
 *   - `accueil_morocco_pc/screen.png` (360x1600) is the FRENCH home;
 *   - `morocco_pc_1/screen.png` (307x1600) is the ARABIC home.
 * Comparing /ar against the French board would compare a mirrored layout to the
 * wrong side of the mirror, so each locale is compared against the board drawn
 * in its own direction.
 *
 * The FOOTER is the exception and a real limitation of the reference set: the
 * French board ends at the tab bar and draws no footer at all, so both locales'
 * footers are compared against the Arabic board's footer band (y 1400-1500, the
 * © line and the legal row above its bar). The `fr` caption says so rather than
 * implying a like-for-like comparison that does not exist.
 */
const BOARDS = {
  fr: path.join(STITCH_DIR, "accueil_morocco_pc", "screen.png"),
  ar: path.join(STITCH_DIR, "morocco_pc_1", "screen.png"),
};
const FOOTER_BOARD = path.join(STITCH_DIR, "morocco_pc_1", "screen.png");
/** The footer band inside the Arabic home board: crop top and height, measured. */
const FOOTER_BAND = { top: 1400, height: 100 };

/**
 * Where each panel crops its source. `ours` differs per piece: the header and
 * the bar are regions of a VIEWPORT capture, the footer is an element capture of
 * its own (a fixed bar sits at the bottom of every viewport shot, so "the last
 * 100 px" of one is always the bar, never the footer).
 */
function pieces(locale) {
  return [
    {
      name: "header",
      ours: path.join(OUT_DIR, locale, `home.${locale}.360x800.viewport.png`),
      ourCrop: { top: 0, height: 72 },
      reference: BOARDS[locale],
      refCrop: { top: 0, height: 72 },
      note: "",
    },
    {
      name: "tabbar",
      ours: path.join(OUT_DIR, locale, `home.${locale}.360x800.bottom.png`),
      ourCrop: { fromBottom: 102 },
      reference: BOARDS[locale],
      refCrop: { fromBottom: 102 },
      note: "",
    },
    {
      name: "footer",
      ours: path.join(OUT_DIR, locale, `footer.${locale}.360x800.png`),
      ourCrop: { top: 0 },
      reference: FOOTER_BOARD,
      refCrop: FOOTER_BAND,
      note:
        locale === "ar"
          ? ""
          : " — NOTE: the FR board draws no footer; this reference is the AR board",
    },
  ];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const servers = [];
let stopped = null;

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
  const deadline = Date.now() + 60_000;
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
    if (Date.now() > deadline) throw new Error(`${server.name} did not answer ${url}`);
    await sleep(250);
  }
}

const stillRunning = (server) => server.child.exitCode === null && server.child.signalCode === null;

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

/** PNG dimensions, read from the IHDR chunk — no decoder needed. */
function pngSize(file) {
  const buffer = fs.readFileSync(file);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Re-encode a screenshot to a palette PNG.
 *
 * This is what keeps ~50 images inside a 3 MB folder: a lossless RGBA capture of
 * a mostly-flat UI carries far more colour depth than the UI has. `quality` is
 * the quantiser's, not JPEG's — the pixels stay exact enough for review, and
 * no text is destroyed.
 */
async function compress(file) {
  const before = fs.statSync(file).size;
  const buffer = await sharp(file).png({ palette: true, quality: 92, compressionLevel: 9 }).toBuffer();
  if (buffer.length < before) fs.writeFileSync(file, buffer);
  return fs.statSync(file).size;
}

const written = [];

async function shoot(page, file, options = {}) {
  await page.screenshot({ path: file, animations: "disabled", ...options });
  written.push(file);
}

/* ------------------------------------------------------------------ */
/* The compare compositor                                              */
/* ------------------------------------------------------------------ */

/**
 * Compose one comparison image in the BROWSER rather than with an image library.
 *
 * Why: a labelled side-by-side needs text, and the browser is the one renderer
 * on this machine that is guaranteed to have the fonts the app itself uses. Each
 * panel is an `overflow: hidden` window over the source PNG, positioned with a
 * negative offset, so the crop is exact and needs no resampling.
 */
async function compose(browser, piece, locale, caption) {
  const oursSize = pngSize(piece.ours);
  const referenceSize = pngSize(piece.reference);

  /**
   * Resolve a crop spec against an image's real height. Three shapes:
   *   { top, height }  a fixed window
   *   { fromBottom }   the bottom N pixels
   *   { top }          from `top` to the end — the footer's own element capture,
   *                    which has no meaningful fixed height.
   */
  const crop = (spec, image) => {
    if (spec.height !== undefined && spec.top !== undefined) {
      const top = Math.max(0, Math.min(spec.top, image.height - 1));
      return { top, height: Math.min(spec.height, image.height - top) };
    }
    if (spec.fromBottom !== undefined) {
      const height = Math.min(spec.fromBottom, image.height);
      return { top: Math.max(0, image.height - height), height };
    }
    const top = Math.max(0, spec.top ?? 0);
    return { top, height: image.height - top };
  };

  const ourCrop = crop(piece.ourCrop, oursSize);
  const refCrop = crop(piece.refCrop, referenceSize);

  const panel = (src, width, cropTop, height, label) => `
    <figure>
      <div class="window" style="width:${width}px;height:${height}px">
        <img src="${src}" style="top:-${cropTop}px" alt="" />
      </div>
      <figcaption>${label}</figcaption>
    </figure>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 12px; background: #fff; font: 12px/1.4 system-ui, sans-serif; color: #111; }
    h1 { font: 600 13px/1.3 system-ui, sans-serif; margin: 0 0 2px; }
    p.caption { margin: 0 0 10px; color: #555; font-size: 11px; }
    .row { display: flex; gap: 10px; align-items: flex-start; }
    figure { margin: 0; }
    .window { position: relative; overflow: hidden; background: #fff; border: 1px solid #cbd5e1; }
    .window img { position: absolute; left: 0; width: 100%; display: block; }
    figcaption { font-size: 10px; color: #475569; margin-top: 4px; }
  </style></head><body>
    <h1>${caption}</h1>
    <p class="caption">left: our build &nbsp;·&nbsp; right: Stitch reference</p>
    <div class="row">
      ${panel(piece.ours, oursSize.width, ourCrop.top, ourCrop.height, `ours — ${oursSize.width}x${oursSize.height}, crop y=${ourCrop.top}, h=${ourCrop.height}`)}
      ${panel(piece.reference, referenceSize.width, refCrop.top, refCrop.height, `Stitch — ${path.basename(path.dirname(piece.reference))}/screen.png, crop y=${refCrop.top}, h=${refCrop.height}${piece.note}`)}
    </div>
  </body></html>`;

  const file = path.join(os.tmpdir(), `g3-compare-${piece.name}-${locale}.html`);
  fs.writeFileSync(file, html);
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 820, height: 400 } });
  try {
    await page.goto(`file://${file.replace(/\\/g, "/")}`);
    await page.waitForLoadState("load");
    await page.waitForTimeout(120);
    const target = path.join(OUT_DIR, "compare", `${piece.name}.${locale}.compare.png`);
    await page.locator("body").screenshot({ path: target, animations: "disabled" });
    written.push(target);
  } finally {
    await page.close();
    fs.rmSync(file, { force: true });
  }
}

/* ------------------------------------------------------------------ */

async function main() {
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    throw new Error("no production build found — run `npm run build` first");
  }
  for (const [port, label] of [
    [APP_PORT, "app"],
    [MOCK_PORT, "fixture mock (server)"],
    [BROWSER_MOCK_PORT, "fixture mock (browser)"],
  ]) {
    if (await portInUse(port)) throw new Error(`port ${port} (${label}) is already in use — stop it first`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const locale of LOCALES) fs.mkdirSync(path.join(OUT_DIR, locale), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, "compare"), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, "og"), { recursive: true });

  const mock = startServer("mock", [path.join(ROOT, "mock", "server.mjs")], {
    MOCK_API_PORT: String(MOCK_PORT),
  });
  const mockBrowser = startServer("mock-browser", [path.join(ROOT, "mock", "server.mjs")], {
    MOCK_API_PORT: String(BROWSER_MOCK_PORT),
  });
  await waitForReady(`${MOCK_ORIGIN}/v1/health`, mock);
  await waitForReady(`http://localhost:${BROWSER_MOCK_PORT}/v1/health`, mockBrowser);

  const app = startServer("app", [NEXT_BIN, "start", "-p", String(APP_PORT)], {
    API_BASE_URL: MOCK_ORIGIN,
  });
  await waitForReady(`${APP_ORIGIN}/fr`, app);

  const browser = await chromium.launch();
  const bad = [];
  try {
    /* 1. The matrix. */
    for (const locale of LOCALES) {
      for (const route of ROUTES) {
        const url = `${APP_ORIGIN}/${locale}${route.path}`;
        const probe = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!probe.ok) {
          bad.push(`${url} answered ${probe.status}`);
          continue;
        }
        for (const viewport of VIEWPORTS) {
          const page = await browser.newPage({ viewport });
          try {
            const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
            if (response === null || !response.ok()) {
              bad.push(`${url} @${viewport.width} answered ${response?.status() ?? "nothing"}`);
              continue;
            }
            const stem = `${route.name}.${locale}.${viewport.width}x${viewport.height}`;
            await shoot(page, path.join(OUT_DIR, locale, `${stem}.viewport.png`));
            if (FULL_PAGE_WIDTHS.includes(viewport.width)) {
              await shoot(page, path.join(OUT_DIR, locale, `${stem}.full.png`), { fullPage: true });
            }
          } finally {
            await page.close();
          }
        }
      }
    }

    /* 2. The bottom of the home page: the footer and the bar in one frame. */
    for (const locale of LOCALES) {
      const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
      try {
        await page.goto(`${APP_ORIGIN}/${locale}`, { waitUntil: "networkidle", timeout: 45_000 });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(200);
        await shoot(page, path.join(OUT_DIR, locale, `home.${locale}.360x800.bottom.png`));
        // The footer as its own element: a fixed bar sits at the bottom of every
        // viewport capture, so "the last 100 px" of one is the bar, never this.
        const footer = page.locator("footer").first();
        const footerBox = await footer.boundingBox();
        if (footerBox === null || footerBox.height < 20) bad.push(`no footer box on /${locale}`);
        else {
          const file = path.join(OUT_DIR, locale, `footer.${locale}.360x800.png`);
          await footer.screenshot({ path: file, animations: "disabled" });
          written.push(file);
          console.log(`REPORT footer box /${locale} @360: ${footerBox.width.toFixed(0)}x${footerBox.height.toFixed(0)} px`);
        }
      } finally {
        await page.close();
      }
    }

    /* 3. Keyboard focus on the active tab, one image per locale. */
    for (const locale of LOCALES) {
      const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
      try {
        await page.goto(`${APP_ORIGIN}/${locale}`, { waitUntil: "networkidle", timeout: 45_000 });
        const tabLabel = locale === "fr" ? "Accueil" : "الرئيسية";
        const tabNavLabel = locale === "fr" ? "Navigation de l’application" : "التنقل في التطبيق";
        const bar = page.getByRole("navigation", { name: tabNavLabel });
        const target = bar.getByRole("link", { name: tabLabel, exact: true });
        let reached = false;
        for (let press = 0; press < 160 && !reached; press += 1) {
          await page.keyboard.press("Tab");
          reached = await target.evaluate((el) => el === document.activeElement);
        }
        if (!reached) bad.push(`could not Tab to the "${tabLabel}" tab on /${locale}`);
        await shoot(page, path.join(OUT_DIR, locale, `focus.${locale}.360x800.png`));
        console.log(`REPORT focus screenshot /${locale}: active tab reached by Tab = ${reached}`);
      } finally {
        await page.close();
      }
    }

    /* 4. The shell comparisons against the Stitch boards. */
    for (const locale of LOCALES) {
      for (const piece of pieces(locale)) {
        if (!fs.existsSync(piece.ours)) {
          bad.push(`missing capture ${path.relative(ROOT, piece.ours)}`);
          continue;
        }
        if (!fs.existsSync(piece.reference)) {
          bad.push(`missing Stitch reference ${path.relative(ROOT, piece.reference)}`);
          continue;
        }
        const caption = `${piece.name} — route /${locale} · viewport 360x800 · locale ${locale}`;
        await compose(browser, piece, locale, caption);
      }
    }

    /* 5. Check A at 3x: the money element, magnified. */
    const zoomContext = await browser.newContext({
      viewport: { width: 360, height: 800 },
      deviceScaleFactor: 3,
    });
    const zoomPage = await zoomContext.newPage();
    try {
      await zoomPage.goto(`${APP_ORIGIN}/ar/config/${IDS.threeBuilds}`, {
        waitUntil: "networkidle",
        timeout: 45_000,
      });
      const price = zoomPage.locator("article p.num-tabular.text-title").first();
      const box = await price.boundingBox();
      if (box === null) {
        bad.push("no money element on /ar result page to zoom");
      } else {
        const pad = 6;
        await shoot(zoomPage, path.join(OUT_DIR, "ar", "arabic-price.ar.360x800@3x.png"), {
          clip: {
            x: Math.max(0, box.x - pad),
            y: Math.max(0, box.y - pad),
            width: box.width + pad * 2,
            height: box.height + pad * 2,
          },
        });
        const size = pngSize(path.join(OUT_DIR, "ar", "arabic-price.ar.360x800@3x.png"));
        console.log(
          `REPORT price zoom: element ${box.width.toFixed(1)}x${box.height.toFixed(1)} px, file ${size.width}x${size.height} at deviceScaleFactor 3`,
        );
      }
    } finally {
      await zoomPage.close();
      await zoomContext.close();
    }

    /* 6. The two Arabic share cards, fetched from the running build. */
    for (const [card, pagePath] of [
      ["result", `/ar/config/${IDS.threeBuilds}`],
      ["preset", "/ar/config-pc-gamer-9000-dh"],
    ]) {
      const html = await (await fetch(`${APP_ORIGIN}${pagePath}`)).text();
      const match = /property="og:image"\s+content="([^"]+)"/.exec(html) ?? /content="([^"]+)"\s+property="og:image"/.exec(html);
      const imageUrl = match?.[1]?.replace(/&amp;/g, "&") ?? `${APP_ORIGIN}${pagePath}/opengraph-image`;
      const response = await fetch(imageUrl);
      if (!response.ok) {
        bad.push(`og:image for ${card} answered ${response.status} (${imageUrl.replace(APP_ORIGIN, "")})`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const file = path.join(OUT_DIR, "og", `og-${card}.ar.1200x630.png`);
      fs.writeFileSync(file, buffer);
      written.push(file);
      const size = pngSize(file);
      console.log(
        `REPORT og:image ${card} (ar): ${size.width}x${size.height}, ${(buffer.length / 1024).toFixed(0)} KB, ${response.headers.get("content-type")}`,
      );
      if (size.width !== 1200 || size.height !== 630) {
        bad.push(`og:${card} is ${size.width}x${size.height}, not 1200x630`);
      }
    }
  } finally {
    await browser.close();
  }

  /* 7. WebKit at iPhone metrics — only if the browser is actually installed. */
  let webkitState = "NOT INSTALLED";
  try {
    const wk = await webkit.launch();
    try {
      const iPhone = devices["iPhone 14"];
      const context = await wk.newContext({ ...iPhone });
      for (const locale of LOCALES) {
        const page = await context.newPage();
        try {
          await page.goto(`${APP_ORIGIN}/${locale}`, { waitUntil: "networkidle", timeout: 60_000 });
          const viewport = page.viewportSize();
          await shoot(
            page,
            path.join(OUT_DIR, locale, `home.${locale}.iphone.${viewport.width}x${viewport.height}.webkit.png`),
          );
          console.log(
            `REPORT webkit /${locale}: ${iPhone.deviceScaleFactor}x on ${viewport.width}x${viewport.height}, UA ${(await page.evaluate(() => navigator.userAgent)).slice(0, 40)}…`,
          );
        } finally {
          await page.close();
        }
      }
      await context.close();
    } finally {
      await wk.close();
    }
    webkitState = "INSTALLED";
  } catch (error) {
    webkitState = `BLOCKED: ${String(error.message).split("\n")[0]}`;
    console.log(`REPORT webkit: ${webkitState}`);
  }

  /* 8. Compress, then prove the folder budget. */
  for (const file of written) {
    if (!fs.existsSync(file)) continue;
    await compress(file);
  }
  // The budget is measured off the DISK, not off the files this run wrote: a
  // stale image left behind by an earlier run counts against the 3 MB too.
  const onDisk = fs
    .readdirSync(OUT_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .map((entry) => fs.statSync(path.join(entry.parentPath ?? entry.path, entry.name)).size)
    .reduce((sum, size) => sum + size, 0);

  console.log(`REPORT images written: ${written.length}, folder ${(onDisk / 1024).toFixed(0)} KB of 3072 KB`);
  console.log(`REPORT webkit: ${webkitState}`);
  if (onDisk > BUDGET_BYTES) bad.push(`design/g3-review is ${(onDisk / 1024 / 1024).toFixed(2)} MB, over the 3 MB budget`);
  if (bad.length > 0) {
    console.error("problems:");
    for (const line of bad) console.error(`  ${line}`);
  }
  return bad.length === 0 ? 0 : 1;
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
