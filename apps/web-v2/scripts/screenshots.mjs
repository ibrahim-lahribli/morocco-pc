/**
 * Capture the Step 0 evidence screenshots (desktop + mobile, fr + ar).
 *
 * The app must already be running: `npm run build && npm run start` (or
 * `npm run dev`). Usage:
 *
 *   node scripts/screenshots.mjs
 *   SCREENSHOT_BASE_URL=http://localhost:3220 node scripts/screenshots.mjs
 *
 * Output:
 *   desktop-{fr,ar}.png        full page at 1440 x 1000
 *   mobile-{fr,ar}.png         phone viewport at 390 x 844, bottom nav visible
 *   mobile-{fr,ar}-full.png    full page with the fixed nav hidden, so it does
 *                              not repeat over the content it covers on scroll
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const baseUrl = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3220";
const outputDir = path.resolve(process.cwd(), "docs/screenshots");

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });

    for (const locale of ["fr", "ar"]) {
      await page.goto(`${baseUrl}/${locale}`, { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.waitForTimeout(250);

      const write = async (suffix, fullPage) => {
        const file = path.join(outputDir, `${viewport.name}-${locale}${suffix}.png`);
        await page.screenshot({ path: file, fullPage });
        console.log(`saved ${path.relative(process.cwd(), file)}`);
      };

      if (viewport.name === "desktop") {
        await write("", true);
        continue;
      }

      // Phone: the first shot is what a user sees, nav included.
      await write("", false);

      // The full-page shot hides the fixed nav; otherwise a fullPage capture
      // paints it once at its fixed position, covering the content below.
      await page.evaluate(() => {
        for (const element of document.querySelectorAll("nav")) {
          if (getComputedStyle(element).position === "fixed") {
            element.setAttribute("data-screenshot-hidden", "true");
            element.style.display = "none";
          }
        }
      });
      await write("-full", true);
    }

    await page.close();
  }
} finally {
  await browser.close();
}
