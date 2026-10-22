/**
 * apps/web/e2e/sitemap-budget.spec.ts — the sitemap walk's BOUND, pinned by CI.
 *
 * `indexableComponentSlugs()` confirms every catalogue candidate through the
 * product read, and a 2 000-product catalogue made that 2 000 reads inside one
 * `/sitemap.xml` response — a crawl that times out before it is handed anything.
 * The fix is a 15 s wall-clock budget with four reads in flight, and until this
 * spec existed that bound was measured ONCE by hand against a throwaway fake API
 * and recorded in the sprint board: the fixture mock serves three products, so no
 * part of the suite could reach the deadline. A documented measurement is not a
 * gate; a refactor that dropped the deadline check would have left every spec
 * green.
 *
 * So this spec starts a SECOND instance of the fixture mock in its slow-catalogue
 * mode (`MOCK_CATALOG_SLOW=1`): a synthetic catalogue of `SIZE` products, all
 * VERIFIED, each detail read delayed by `DETAIL_DELAY_MS`. It then calls the walk
 * exactly as `/sitemap.xml` does and asserts the four properties the bound
 * promises — none of which a fast walk can fake:
 *
 *   1. **The clock bound bites.** The walk returns with products still unverified
 *      (a full walk here takes `SIZE × DETAIL_DELAY_MS`, far past the budget), and
 *      it returns within the budget plus ONE in-flight read's own timeout — the
 *      documented worst case, independent of catalogue size.
 *   2. **Truncation is a clean PREFIX in keyset order.** Results are written at the
 *      candidate's POSITION, so concurrency cannot reorder or scatter them; a
 *      shortened sitemap must still read as "the first N products".
 *   3. **The work really overlapped.** The reads that did happen took clearly less
 *      wall clock than the same number sequentially, which is the property the
 *      four-wide pool exists for.
 *   4. **A truncation is NEVER silent.** The log names the budget and how many
 *      products went unverified — the honest failure for a document whose contract
 *      is "only what is indexable".
 *
 * The budget and the per-read timeout are the loader's own constants, repeated
 * here on purpose: a spec that imported them could not notice one of them changing.
 */

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { indexableComponentSlugs } from "../lib/catalog/load";

/** Must match `SITEMAP_BUDGET_MS` / `REQUEST_TIMEOUT_MS` in `lib/catalog/load.ts`. */
const BUDGET_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5000;

const SIZE = 40;
const DETAIL_DELAY_MS = 2000;

/** A port nothing is listening on: the slow mock is a per-spec instance. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("could not reserve a port"));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/v1/health`)).ok) return;
    } catch {
      // Not listening yet; keep polling inside the deadline.
    }
    if (Date.now() > deadline) throw new Error(`the slow mock API never answered at ${base}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test("the sitemap walk returns within its budget, as a prefix, and says what it skipped", async () => {
  // The walk itself waits out the real budget, so this one test needs more than
  // the default ceiling.
  test.setTimeout(60_000);

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let mock: ChildProcess | undefined;

  try {
    mock = spawn(process.execPath, [path.join(__dirname, "..", "mock", "server.mjs")], {
      env: {
        ...process.env,
        MOCK_API_PORT: String(port),
        MOCK_CATALOG_SLOW: "1",
        MOCK_CATALOG_SLOW_SIZE: String(SIZE),
        MOCK_CATALOG_SLOW_DELAY_MS: String(DETAIL_DELAY_MS),
      },
      stdio: "ignore",
    });
    await waitForHealth(base);

    // `serverApiBaseUrl()` reads this at call time, so the walk under test talks
    // to the slow instance rather than to the suite's shared fixture mock.
    const previous = process.env.API_BASE_URL;
    process.env.API_BASE_URL = base;

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    };

    let slugs: string[] = [];
    let elapsed = 0;
    try {
      const startedAt = Date.now();
      slugs = await indexableComponentSlugs();
      elapsed = Date.now() - startedAt;
    } finally {
      console.warn = originalWarn;
      if (previous === undefined) delete process.env.API_BASE_URL;
      else process.env.API_BASE_URL = previous;
    }

    const expected = Array.from(
      { length: SIZE },
      (_, index) => `produit-${String(index).padStart(3, "0")}`,
    );

    // 1. The bound bit: some products are missing, and the call came back in the
    //    documented worst case (budget + one in-flight read), not in full-walk time.
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.length).toBeLessThan(SIZE);
    expect(elapsed).toBeLessThan(BUDGET_MS + REQUEST_TIMEOUT_MS + 2000);

    // 2. A clean prefix, in keyset order — never a scatter.
    expect(slugs).toEqual(expected.slice(0, slugs.length));

    // 3. The reads overlapped: sequentially these same reads need far longer than
    //    the elapsed time. Self-scaling, so a slower CI box does not flip it.
    expect(elapsed).toBeLessThan((slugs.length * DETAIL_DELAY_MS) / 2);

    // 4. The truncation was logged with the number left unverified.
    const budgetLine = warnings.find((line) => line.includes(`hit its ${BUDGET_MS} ms budget`));
    expect(budgetLine, `expected a budget warning, got: ${warnings.join(" | ")}`).toBeDefined();
    const skipped = Number(/;\s*(\d+) product\(s\) went unverified/.exec(budgetLine ?? "")?.[1]);
    expect(Number.isFinite(skipped)).toBe(true);
    expect(skipped).toBeGreaterThanOrEqual(SIZE - slugs.length);
  } finally {
    mock?.kill();
  }
});
