/**
 * apps/web/e2e/wizard-engine.spec.ts — the write path, against the REAL API.
 *
 * WHAT IT PROVES that nothing else in this package can. The suite has three
 * halves and none of them crosses this seam: most wizard specs intercept
 * `**\/v1/**` (the FORM against a stub), `wizard-browser-api.spec.ts` drives a
 * real HTTP hop to a second FIXTURE mock, and the results specs render committed
 * fixture bodies. So no spec ever submitted a form, let the engine run, wrote
 * the pass to PostgreSQL and then read THAT pass back with the browser, the API
 * and the database all real. This one does, in a single pass:
 *
 *   form → POST /v1/recommendations (real CORS preflight, port 3000)
 *     → Fastify → engine → one committed pass (query, candidates, components,
 *       results) → 201 carrying its id
 *     → /fr/config/<id> → the Next SERVER fetches that id back over HTTP
 *     → the rendered HTML carries the total the database holds
 *   plus a second identical submit → 200 `reused: true`, same id (Decision 47)
 *   plus the stored rows agreeing with the printed page, to the dirham.
 *
 * OPT-IN — it WRITES, so it needs all three of these or it skips:
 *
 *   E2E_ENGINE_API=1                        the gate
 *   E2E_APP_API_BASE_URL=http://localhost:3000
 *                                          so the Next server reads the real
 *                                          pass back instead of the fixture mock
 *   the real API listening on :3000         npm run start:api (TEST branch only —
 *                                          the API itself refuses shared)
 *
 * Run it ALONE: that override would point every fixture-driven spec at a live
 * database, which is why `web.yml` never sets it and this file is not in CI.
 *
 *   # terminal 1, repo root — refuses to start unless the target is the TEST branch.
 *   # ALLOWED_ORIGINS is required: unset, the API sends no CORS header at all and
 *   # the browser refuses the POST before the engine is reached (app.js).
 *   ALLOWED_ORIGINS=http://localhost:3210 npm run start:api
 *   # terminal 2, apps/web — needs a prior `npm run build`; the harness starts the app
 *   E2E_ENGINE_API=1 E2E_APP_API_BASE_URL=http://localhost:3000 \
 *     npx playwright test e2e/wizard-engine.spec.ts
 *
 * IT CLEANS UP AFTER ITSELF, and the cleanup is part of the proof. The database
 * half resolves `pg`, `dotenv` and `scripts/lib/db-url.js` from the REPO ROOT via
 * `createRequire` — this package does not depend on them and no app code imports
 * them, so nothing ships from here — and `getWriteTestDbUrl()` is the same guard
 * every write test in the repo uses: it refuses before connecting unless
 * `TEST_DATABASE_URL` is configured and differs from `DATABASE_URL`, so this
 * spec cannot touch the shared database even if pointed at it. Rows go in FK
 * order in a `finally`, the residue is asserted to be zero, and a leftover from
 * a killed earlier run is removed BEFORE submitting so the fresh-201 assertion
 * holds on a re-run. A leftover `recommendation_query` row would otherwise block
 * the golden harness preflight (`npm run eval:scenarios`) for the whole checkout.
 *
 * The stored-facts half matters because the page CANNOT lie about them: the
 * rendered total is arithmetic over `build_component.selected_price`, so a total
 * computed twice (once to render, once to store) would disagree with itself.
 */
import { createRequire } from "node:module";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

const API_ORIGIN = "http://localhost:3000";

test.skip(
  process.env.E2E_ENGINE_API !== "1" || process.env.E2E_APP_API_BASE_URL !== API_ORIGIN,
  "set E2E_ENGINE_API=1 and E2E_APP_API_BASE_URL=http://localhost:3000, with the real API listening on :3000",
);

/** The answers this spec submits — the GAMING profile S10 drives, fully filled. */
const ANSWERS = {
  use_case: "GAMING",
  budget_amount: 13340,
  resolution: "1080p",
  priority: 3,
};

const LAST_STEP =
  `/fr/configurer?etape=priority&use_case=${ANSWERS.use_case}` +
  `&budget_amount=${ANSWERS.budget_amount}&resolution=${ANSWERS.resolution}&priority=${ANSWERS.priority}`;

/** Any query row this spec could have written — its fingerprint, not a table scan. */
const FINGERPRINT = [
  "budget_amount = $1::numeric",
  "use_case = $2",
  "resolution = $3",
  "priority = $4",
  "currency = $5",
].join(" AND ");

const submitButton = (page: Page) =>
  page.getByRole("button", { name: "Voir mes configurations" });

// ---------------------------------------------------------------------------
// The database half: repo-root `pg`, behind the guard every write test uses.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Db = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Row[] }>;
  close: () => Promise<void>;
};

// Playwright transpiles this package to CJS (no `"type": "module"`), so the
// module's own location is `__dirname`, not `import.meta.url`.
const ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Resolve the repo root's client, or null with the reason — the spec then skips
 * rather than pretending a `pg`-less `npm ci` in this package can assert rows.
 */
async function openDb(): Promise<Db | null> {
  try {
    const req = createRequire(__filename);
    req(path.join(ROOT, "node_modules", "dotenv")).config({
      path: path.join(ROOT, ".env"),
      quiet: true,
    });
    const { getWriteTestDbUrl } = req(path.join(ROOT, "scripts", "lib", "db-url.js"));
    const { Client } = req(path.join(ROOT, "node_modules", "pg"));
    const client = new Client({ ...getWriteTestDbUrl(), connectionTimeoutMillis: 15_000 });
    await client.connect();
    // The guard's connection string sets its own `search_path`; Layer 4 is in `public`.
    await client.query("SET search_path = public");
    return {
      query: (sql, values) => client.query(sql, values),
      close: () => client.end(),
    };
  } catch (error) {
    console.warn(`[wizard-engine] no database, skipping the stored-facts half: ${String(error)}`);
    return null;
  }
}

/** Query ids this spec's own fingerprint owns. */
async function matchingQueries(db: Db): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT id FROM recommendation_query WHERE ${FINGERPRINT} ORDER BY created_at ASC, id ASC`,
    [ANSWERS.budget_amount, ANSWERS.use_case, ANSWERS.resolution, ANSWERS.priority, "MAD"],
  );
  return rows.map((row) => String(row.id));
}

/**
 * Delete these passes in FK order. `build_candidate` → `build_component` and
 * `recommendation_result` → `build_candidate` are NOT cascading, so a bare
 * `DELETE FROM recommendation_query` raises a constraint violation and leaks
 * every row (AGENTS §7 item 11). `build_rejection` and `recommendation_preset`
 * cascade from the query; they are cleared explicitly all the same, so the
 * statement list reads as the whole tree.
 */
async function deletePasses(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { rows } = await db.query(
    "SELECT DISTINCT recommendation_profile_id AS id FROM recommendation_query WHERE id = ANY($1::uuid[])",
    [ids],
  );
  const profileIds = rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string");

  await db.query("DELETE FROM build_rejection WHERE recommendation_query_id = ANY($1::uuid[])", [ids]);
  await db.query("DELETE FROM recommendation_preset WHERE query_id = ANY($1::uuid[])", [ids]);
  await db.query("DELETE FROM recommendation_result WHERE recommendation_query_id = ANY($1::uuid[])", [ids]);
  await db.query(
    `DELETE FROM build_component
      WHERE build_candidate_id IN (
        SELECT id FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])
      )`,
    [ids],
  );
  await db.query("DELETE FROM build_candidate WHERE recommendation_query_id = ANY($1::uuid[])", [ids]);
  await db.query("DELETE FROM recommendation_query WHERE id = ANY($1::uuid[])", [ids]);
  if (profileIds.length > 0) {
    // Only profiles nothing else references: a shared profile must survive.
    await db.query(
      `DELETE FROM recommendation_profile
        WHERE id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM recommendation_query WHERE recommendation_profile_id = recommendation_profile.id
          )`,
      [profileIds],
    );
  }
}

const num = (value: unknown): number => Number(value);

test("one submit is a real engine pass: POST → committed rows → the page reads them back", async ({
  page,
  request,
}) => {
  // A refused connection means "the API is not running" (skip); an answer that
  // is not healthy means the stack is broken (fail). They are not the same.
  const health = await request.get(`${API_ORIGIN}/v1/health`).catch(() => null);
  if (health === null) {
    test.skip(true, `no API on ${API_ORIGIN} — start it with npm run start:api (TEST branch)`);
    return;
  }
  expect(health.status(), "the real API's health route").toBe(200);
  const healthBody = (await health.json()) as { status?: string; db?: string };
  expect(healthBody.status).toBe("ok");
  expect(healthBody.db, "the API must be connected to a database").toBe("ok");

  const db = await openDb();
  if (db === null) {
    test.skip(true, "the repo root's pg/.env is not resolvable from this package");
    return;
  }

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const posts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/v1/recommendations")) posts.push(req.url());
    });

  let submittedId: string | null = null;

  try {
    // A killed earlier run leaves its pass behind; the second POST would then be a
    // 200 dedupe hit and the "a fresh pass was created" assertion would be a lie.
    await deletePasses(db, await matchingQueries(db));

    // --- the submit -------------------------------------------------------
    await page.goto(LAST_STEP);
    await expect(submitButton(page)).toBeEnabled();

    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("/v1/recommendations"),
    );
    await submitButton(page).click();

    const response = await answered;
    expect(new URL(response.url()).origin).toBe(API_ORIGIN);
    expect(response.status(), "a first submit is a NEW pass, not a dedupe hit").toBe(201);
    expect(response.headers()["access-control-allow-origin"]).toMatch(/^(http:\/\/localhost:3210|\*)$/);
    expect(posts).toHaveLength(1);

    const body = (await response.json()) as {
      id: string;
      budget_amount: number | null;
      currency: string | null;
      use_case: string | null;
      reused: boolean;
      engine_version: string | null;
      catalog_version: string | null;
      budget_floor: { cheapest_total: number | null; within_budget: boolean | null } | null;
      builds: {
        rank: number;
        total_price: number | null;
        build_score: number | null;
        engine_version: string | null;
        strategy_key: string | null;
        compatibility_status: string;
        explanation: string;
        components: { role: string; name: string; price_used: number | null }[];
      }[];
    };

    submittedId = body.id;
    expect(body.reused).toBe(false);
    expect(body.use_case).toBe(ANSWERS.use_case);
    expect(num(body.budget_amount)).toBe(ANSWERS.budget_amount);
    expect(body.currency).toBe("MAD");
    // The engine actually ran: a committed pass with at least one assembled build.
    expect(body.builds.length).toBeGreaterThan(0);
    expect(body.engine_version).toBeTruthy();

    const first = body.builds[0];
    expect(first.rank).toBe(1);
    expect(first.components).toHaveLength(8);
    expect(first.compatibility_status).toBe("PASS");
    expect(first.explanation.length).toBeGreaterThan(0);
    const shownTotal = num(first.total_price);
    // The API's own total is the sum of the parts it returned.
    expect(first.components.reduce((sum, component) => sum + num(component.price_used), 0)).toBe(
      shownTotal,
    );

    // --- the read-back the user sees -------------------------------------
    await expect(page).toHaveURL(new RegExp(`/fr/config/${body.id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vos configurations");
    await expect(page.locator("article")).toHaveCount(body.builds.length);

    // Server-rendered, not client state: fetch the HTML with no browser involved.
    // Thousands are printed with a thin/narrow space, so compare shedding spaces.
    const html = (await (await request.get(page.url())).text()).replace(
      /[\s\u00a0\u202f]/g,
      "",
    );
    expect(html).toContain(String(shownTotal));
    const cpu = first.components.find((component) => component.role === "CPU");
    expect(cpu, "the rank-1 build has a CPU").toBeDefined();
    // Same whitespace-stripped comparison: a multi-word part name has spaces too.
    expect(html).toContain(String(cpu?.name).replace(/&/g, "&amp;").replace(/[\s\u00a0\u202f]/g, ""));

    // --- the API's own read verb serves the same pass ---------------------
    const readBack = await request.get(`${API_ORIGIN}/v1/recommendations/${body.id}`);
    expect(readBack.status()).toBe(200);
    const stored = (await readBack.json()) as typeof body;
    expect(stored.id).toBe(body.id);
    // `reused` is a REQUEST fact, true only on a POST that found an equivalent
    // pass; the contract says false on every GET, and the read path is not
    // bypassed by the dedupe route (Decision 36 item 4).
    expect(stored.reused).toBe(false);
    expect(stored.builds).toHaveLength(body.builds.length);
    expect(num(stored.builds[0].total_price)).toBe(shownTotal);
    expect(num(stored.budget_floor?.cheapest_total)).toBeGreaterThan(0);
    expect(stored.budget_floor?.within_budget).toBe(true);

    // --- what is actually in PostgreSQL -----------------------------------
    const queryRow = (
      await db.query(
        `SELECT budget_amount::text AS budget, currency, use_case, resolution, priority,
                catalog_version, budget_floor
           FROM recommendation_query WHERE id = $1`,
        [body.id],
      )
    ).rows[0];
    expect(queryRow, "the pass is a row, not a response").toBeDefined();
    expect(num(queryRow.budget)).toBe(ANSWERS.budget_amount);
    expect(queryRow.currency).toBe("MAD");
    expect(queryRow.use_case).toBe(ANSWERS.use_case);
    expect(queryRow.resolution).toBe(ANSWERS.resolution);
    expect(queryRow.priority).toBe(ANSWERS.priority);
    expect(String(queryRow.catalog_version)).toMatch(/^[0-9a-f]{32}$/); // Decision 47
    expect(num((queryRow.budget_floor as { cheapest_total: number | null }).cheapest_total)).toBe(
      num(body.budget_floor?.cheapest_total),
    );

    const storedBuilds = (
      await db.query(
        `SELECT r.rank, r.engine_version, r.strategy_key, r.explanation,
                c.total_price::text AS total_price, c.score::text AS score,
                (SELECT COALESCE(SUM(bc.selected_price), 0)::text
                   FROM build_component bc WHERE bc.build_candidate_id = c.id) AS parts_total,
                (SELECT COUNT(*)::int
                   FROM build_component bc WHERE bc.build_candidate_id = c.id) AS parts_count
           FROM recommendation_result r
           JOIN build_candidate c ON c.id = r.build_candidate_id
          WHERE r.recommendation_query_id = $1
          ORDER BY r.rank ASC`,
        [body.id],
      )
    ).rows;

    expect(storedBuilds).toHaveLength(body.builds.length);
    const top = storedBuilds[0];
    expect(top.rank).toBe(1);
    expect(num(top.parts_count)).toBe(8);
    // The rendered price IS arithmetic over the persisted parts: all four agree.
    expect(num(top.total_price)).toBe(shownTotal);
    expect(num(top.parts_total)).toBe(shownTotal);
    expect(top.engine_version).toBeTruthy();
    expect(String(top.strategy_key)).toBe(String(first.strategy_key));
    expect(String(top.explanation).length).toBeGreaterThan(0);
    expect(num(top.score)).toBe(num(first.build_score));

    // --- the dedupe path, on the real API (Decision 47) -------------------
    await page.goto(LAST_STEP);
    const reusedResponse = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().includes("/v1/recommendations"),
    );
    await submitButton(page).click();
    const dedupe = await reusedResponse;
    expect(dedupe.status(), "an identical second submit reuses the committed pass").toBe(200);
    const dedupeBody = (await dedupe.json()) as { id: string; reused: boolean };
    expect(dedupeBody.reused).toBe(true);
    expect(dedupeBody.id).toBe(body.id);
    await expect(page).toHaveURL(new RegExp(`/fr/config/${body.id}$`));
    expect(posts).toHaveLength(2);

    // ...and it added no second query row.
    expect(await matchingQueries(db)).toEqual([body.id]);

    expect(consoleErrors, "no console or page errors across both submits").toEqual([]);
  } finally {
    // Leave the database exactly as it was found — and prove it, because a
    // leftover recommendation_query blocks the golden harness for the checkout.
    const own = submittedId === null ? await matchingQueries(db) : [submittedId];
    await deletePasses(db, own);
    await deletePasses(db, await matchingQueries(db));
    expect(await matchingQueries(db), "residue after cleanup").toEqual([]);
    if (submittedId !== null) {
      const { rows } = await db.query("SELECT 1 FROM recommendation_query WHERE id = $1", [submittedId]);
      expect(rows, "the pass this spec created is gone").toHaveLength(0);
    }
    await db.close();
  }
});
