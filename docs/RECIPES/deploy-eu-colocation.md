# Recipe: co-locate in the EU — Neon Frankfurt + a deployed API (P1 Sprint 1 Steps 4–9)

Platform P1 Sprint 1, Steps 4–9 of `PLAN_PLATFORM_P1.md`. **Owner-gated**: this creates a new
Neon project and a hosting account, so it spends money and adds cloud resources. The plan
prepares it; the owner runs it.

What it buys: a database and an API in the same region, which is the precondition for every
later latency measurement. The recorded ~147 ms per SQL round trip is distance to
`aws-us-east-2` (Ohio), not work — no batching removes distance.

Time: about 90 minutes of wall clock, most of it waiting for migrations, seeds and two
measurement runs.

---

## 0. What is already decided

| Decision | Value | Why |
|---|---|---|
| Database region | Neon `aws-eu-central-1` (Frankfurt) | Fly's `fra` and Render's `frankfurt` are the same metro. Neon's only other EU region is `aws-eu-west-2` (London). |
| Replay source | the **TEST branch**, not the shared database | The branch carries the API's contract (ledger 22). Shared stands at ledger 20 and lacks `catalog_version` and `recommendation_preset`, so a replay from shared would produce an API that cannot serve a request. |
| Host | **Fly.io `fra`** (recommended); Render `frankfurt` as the alternative | See the comparison below. Both build `apps/api/Dockerfile` with the repository root as context. |
| Contract version at deploy | v1.5 | The served OpenAPI document names it; `/v1/docs/json` is the check. |

Hosting facts verified 2026-10-17 on vendor pages (re-check at checkout; Fly prices vary by
region and Render's page bundles pricing into a comparison article):

| | Fly.io | Render |
|---|---|---|
| Region code | `fra` | `frankfurt` |
| Deploy | `fly deploy` builds the Dockerfile | `git push` builds the Dockerfile |
| Smallest always-on | `shared-cpu-1x`, **256 MB** offered; ~$2.19/30 days in the cheapest regions (Frankfurt varies) | Starter, **512 MB**, **$7/month** |
| Free tier | none | **sleeps after 15 min idle** — unusable for latency measurement |
| Port | app reads `PORT`; `fly.toml` `internal_port` must match | Render injects `PORT=10000`; do not override it |
| Health check | `[[http_service.checks]]` path | `healthCheckPath`, HTTP GET, 2xx/3xx |

Sources: [Fly regions](https://docs.fly.io/reference/regions) · [Fly Dockerfile deploy](https://docs.fly.io/languages-and-frameworks/dockerfile) · [Fly pricing](https://docs.fly.io/about/pricing) · [Render regions](https://render.com/docs/regions) · [Render Docker](https://render.com/docs/docker) · [Render health checks](https://render.com/docs/health-checks) · [Render free tier](https://render.com/docs/free) · [Neon regions](https://neon.com/docs/introduction/regions).

**Choose Fly** unless there is a reason to pay 3× for the same metro: the always-on requirement
kills Render's free tier, and Frankfurt/Frankfurt makes them otherwise equivalent for this
workload. The Render path is at the end.

---

## 1. The env-var trap: `TEST_DATABASE_URL` is the POOL, `DATABASE_URL` is the baseline

Read this before step 7 (the deploy), because getting it backwards deploys the API against the OLD database
while every health check still passes.

`apps/api/src/db.js` `resolvePoolConfig`:

- `API_ALLOW_SHARED=1` → the pool uses **`DATABASE_URL`**;
- otherwise → the pool uses **`TEST_DATABASE_URL`**, and `DATABASE_URL` is only the hostname
  baseline the guard compares against (`resolveTestDbUrl`).

So there are exactly two coherent configurations for the deployed host:

| | Pool target | What the names mean on that host | Verdict |
|---|---|---|---|
| **A. Recommended** | `DATABASE_URL` (EU) | `DATABASE_URL` is the real target; `API_ALLOW_SHARED=1` says "this is not the dev branch". Omit `TEST_DATABASE_URL`. | Deploy this. |
| B. Guard-honouring | `TEST_DATABASE_URL` (EU) | `TEST_DATABASE_URL` is production and `DATABASE_URL` is the old database — a script run on the host would read the wrong one. | Do not deploy this. |

`API_ALLOW_SHARED` is a guard bypass, not a statement that the target is shared. Nothing in the
API writes to `DATABASE_URL` when it is the pool target; that is the point of the flag.

The same inversion appears in the two local tools below — each says which variable is which.
Copy the commands as written; do not "normalise" them.

---

## 2. Prerequisites

1. `git status` — this is a shared checkout. Record `git rev-parse HEAD`; `ENGINE_VERSION`
   uses its short form.
2. A Neon account that can create a project, and a hosting account with a payment method.
3. `flyctl` on `PATH` (`fly version`), and `curl`. `docker` is optional — the deploy builds
   remotely; a local build is only a smoke test.
4. The current branch values to replay against. Record them once, in this shell:

   ```bash
   node scripts/check-target-parity.js --a=env:TEST_DATABASE_URL --b=env:TEST_DATABASE_URL
   ```

   Expected `RESULT: MATCH`, with `22 files, tail 022_recommendation_preset.sql`,
   `product` 100, `store_offer` 101, `component_assessment` 280.
   **These are the numbers step 5 must reproduce.**

5. Two shell variables for the new project — never written into `.env`, never committed:

   ```bash
   export TARGET_DATABASE_URL='postgres://…-pooler…/neondb'   # pooled: the API's pool
   export TARGET_DIRECT_URL='postgres://…/neondb'             # direct: migrations + seeds
   export OLD_BRANCH_URL='postgres://…'                       # the CURRENT TEST branch URL
   ```

   `.env` is read by the SCRIPTS, not by your shell: `$TEST_DATABASE_URL` is empty in this
   shell unless you exported it yourself, so copy that URL out of `.env` rather than expanding
   the variable. (`OLD_BRANCH_URL` is only the hostname baseline for the profiler in §9.1 and
   the replay source; it is never written.)

---

## 3. Step 4 — create the Neon project (owner)

1. Neon console → **New Project**.
2. Name `morocco-pc-eu`; region **AWS eu-central-1 (Frankfurt)**. Accept the default Postgres
   version — it must match the current project's major (`Settings → General` on the existing
   project); a different major is a parity risk, not a feature.
3. Create it, then copy **both** connection strings from *Connect*: the **pooled** one
   (`-pooler` in the host) and the **direct** one. Assign them as in §2.5.
4. Record the project id and region in `DEVELOPMENT_NOTES.md` under a dated heading. Do not
   write the URLs there or anywhere in the repository.

The project's default branch is the deploy target. `neondb` is the database name used by every
command below; substitute if the console shows another.

---

## 4. Step 5a — the restore point (owner)

Neon console → the new project → **Branches → New branch**: name `pre-p1-replay`, parent = the
default branch, **no compute**. Copy the branch id (`br-…`).

Why on the NEW project: `run-migrations.js` refuses a shared-path apply without a restore point,
and that refusal is the guard that makes this step safe. A branch is instant and free; without
one, the apply stops before writing.

---

## 5. Step 5b — replay the migrations (22 files)

```bash
# 1) Prove which database you are about to write to. This prints the digest it will log.
DATABASE_URL="$TARGET_DIRECT_URL" node scripts/run-migrations.js --dry-run

# 2) Apply. Direct host on purpose: Neon's pooler runs PgBouncer in transaction mode, and
#    schema DDL is safer on a direct session (scripts/lib/db-url.js `toDirectUrl` states the
#    same rule for migrations and for session-level SET).
DATABASE_URL="$TARGET_DIRECT_URL" \
  node scripts/run-migrations.js \
  --restore-point='<br-id-from-step-4>' \
  --note='P1 co-location: morocco-pc-eu (aws-eu-central-1)'

# 3) The ledger must now be complete.
DATABASE_URL="$TARGET_DIRECT_URL" node scripts/run-migrations.js --check; echo "exit=$?"
```

Expected: `AUDIT TARGET: db:<12 hex>` **different from the old project's digest**, then
**22** `MIGRATED` lines, one audit line each carrying the note and the new digest.
A `shared` or `test` value in any new line means the runner wrote to the wrong database —
stop and investigate; the field names a database since 2026-10-15.

The apply appends 22 lines to the tracked `database/migration-applies.jsonl`. That is the
record; commit it with the sprint.

**If it stops part-way:** the runner records per file, so re-running applies only the pending
tail. Do not re-run the whole set by hand.

---

## 6. Step 5c — replay the seeds

`run-seeds.js` reads `DATABASE_URL` and has **no routing** (`--test-db` does nothing there), so
point it at the new project explicitly. Direct host, every file as-is (`client.query(rawText)`,
never split on `;`):

```bash
DATABASE_URL="$TARGET_DIRECT_URL" node scripts/run-seeds.js
```

Expected: one `SEEDED: <file>` per seed file, then
`Seed rows: products=100, offers=101, assessments=280`.

Re-running is safe: the seed files are idempotent. If one fails, fix the cause and run the whole
command again rather than editing the target by hand. A `relation ... does not exist` error means
the client's `search_path` is not `public`; apply that file through a `Client` that runs
`SET search_path = public` before `query(rawText)` (the pattern in `AGENTS.md` section 6), and
do not split the file on `;`.

---

## 7. Step 6 — the parity gate (blocks everything after it)

```bash
export TARGET_DATABASE_URL='postgres://…-pooler…/neondb'
node scripts/check-target-parity.js --a=env:TEST_DATABASE_URL --b=env:TARGET_DATABASE_URL; echo "exit=$?"
```

Expected `RESULT: MATCH`, `exit=0`, and on the printed lines:
`22 files, tail 022_recommendation_preset.sql` on both sides, the same shape digest, and equal
counts for every table.

`RESULT: DIFF` names the first difference (ledger file, table, shape row, or table count) and
exits 1. **Do not deploy on a DIFF.** Adjusting the measurement later cannot fix a catalog that
is smaller than the one it is compared with.

Read-only: two SELECT-only snapshots, no writes, no URLs printed. Run it BEFORE the
measurement (step 8): a pass writes Layer 4 rows, which the `rows:` checks would then report as a
difference.

---

## 8. Step 7 — deploy the API (Fly)

### 8.1 The app definition

`fly.toml` does not exist yet. Create it at the repository root with exactly this content (it is
committed by step 9):

```toml
app = "morocco-pc-api"
primary_region = "fra"

[build]
  # Context is the repository root; the image copies src/, apps/api/ and scripts/lib/db-url.js.
  dockerfile = "apps/api/Dockerfile"

[env]
  PORT = "3000"
  HOST = "0.0.0.0"
  # Pool target = DATABASE_URL (see section 1). Not a secret.
  API_ALLOW_SHARED = "1"
  LOG_LEVEL = "info"
  LOG_PRETTY = "0"

[http_service]
  internal_port = 3000
  force_https = true
  # Always-on: a stopped machine makes the p95 measurement meaningless.
  auto_start_machines = true
  auto_stop_machines = false
  min_machines_running = 1

  [[http_service.checks]]
    interval = "15s"
    timeout = "3s"
    grace_period = "10s"
    method = "GET"
    path = "/v1/health"

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

If the machine restarts under memory pressure (`fly logs` shows OOM), raise `memory` to
`512mb`; do not change `size` first.

### 8.2 Deploy

```bash
fly auth login
fly apps create morocco-pc-api          # once; fails if the name is taken — pick another and
                                        # update `app` in fly.toml
fly secrets set \
  DATABASE_URL="$TARGET_DATABASE_URL" \
  ENGINE_VERSION="$(git rev-parse --short HEAD)" \
  --app morocco-pc-api
fly deploy --app morocco-pc-api
```

Deliberately **not** set yet:

- `TEST_DATABASE_URL` — absent, so the guard cannot silently select the wrong pool.
- `TRUST_PROXY` — unset means `X-Forwarded-For` is ignored, so the rate limiter keys on Fly's
  proxy address and every caller shares one bucket. That is the honest state until P2 Sprint 2
  Step 4 measures the deployed origin's `request.ip` and pins the proxy range (Decision 49
  item 6). **Every latency number from this deploy is still valid; per-IP fairness is not.**
- `ALLOWED_ORIGINS` — empty disables CORS. Set it to the frontend origin when one exists.

### 8.3 Verify on the deployed origin (not locally)

```bash
APP="https://morocco-pc-api.fly.dev"

curl -sS -w '\nHTTP %{http_code}\n' "$APP/v1/health"
# {"status":"ok","db":"ok","engine_version":"<short HEAD>"} — db:"down" means the pool target,
# credentials or network; it is not a rate-limit or CORS problem.

curl -sS "$APP/v1/meta/options" | head -c 400          # the active model's vocabulary
curl -sS "$APP/v1/catalog/products?limit=2" | head -c 500
curl -sS -o /dev/null -w 'docs HTTP %{http_code}\n' "$APP/v1/docs/json"
```

Then one real POST and its read-back (this is the only proof the write path works through the
deployed pool):

```bash
ID=$(curl -sS -X POST "$APP/v1/recommendations" \
  -H 'content-type: application/json' \
  -d '{"budget_amount":20000,"currency":"MAD","use_case":"GAMING"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")
curl -sS "$APP/v1/recommendations/$ID" | head -c 400
```

Expected: 201 with builds, then a 200 whose builds match; `served_by.engine_version` is the
deployed short SHA. Save the id — it is one of the rows the measurement run will add.

---

## 9. Step 8 — re-measure, twice, and record both

### 9.1 Per-phase profiler (statement counts + ms per round trip)

`measure-api-pass-phases.js` connects via **`TEST_DATABASE_URL`**, with `DATABASE_URL` as the
hostname baseline (the inversion from §1):

```bash
DATABASE_URL="$OLD_BRANCH_URL" TEST_DATABASE_URL="$TARGET_DATABASE_URL" \
  node scripts/measure-api-pass-phases.js --budget=20000 --use-case=GAMING --model='<name@version>'
```

Pin the model that is ACTIVE on the new target — the instrument refuses an inactive pin and
prints the active models. Resolve it first:

```bash
node -e "
const { Client } = require('pg');
const url = process.argv[1];
(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  const r = await c.query('SELECT name, version FROM scoring_model WHERE is_active ORDER BY name');
  console.log(r.rows.map((row) => row.name + '@' + row.version).join('\n'));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
" "$TARGET_DIRECT_URL"
```

The branch answers `launch-v2@1.0.0`; a complete seed replay reproduces it. If the new target
answers only `seed-minimal-v1`, seed `013` did not apply - re-run step 5c rather than pinning a
model the target is not running.

Expected: the same **statement count** as the baseline (74 — the pipeline did not change) and a
lower ms per round trip. A different statement count means the engine or repository changed;
stop and find out why before comparing timings.

### 9.2 The 50-POST HTTP profile

Two things the 2026-10-07 baseline did not have to deal with, and this run does:

- **Request dedupe (P1 Sprint 5).** An identical body reuses the stored pass and answers in
  milliseconds with `200 reused:true`. Vary `budget_amount` by 1 MAD per request so every POST
  is a real pass.
- **The 30/min POST limit.** Request 31 inside one minute answers `429`. Pace the run: 30
  requests, wait 61 s, then 20. At the old ~10 s per pass the window resets on its own; at the
  target p95 the 30 would fit inside a minute, so the pause is what keeps the run valid either
  way.

```bash
APP="https://morocco-pc-api.fly.dev"
node - "$APP" <<'NODE'
const { execFileSync } = require('child_process');
const base = process.argv[2];
const times = [];
const codes = [];
for (let i = 1; i <= 50; i += 1) {
  if (i === 31) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 61000);
  const body = JSON.stringify({ budget_amount: 20000 + i, currency: 'MAD', use_case: 'GAMING' });
  const out = execFileSync('curl', [
    '-sS', '-o', '/dev/null', '-w', '%{http_code} %{time_total}',
    '-X', 'POST', base + '/v1/recommendations',
    '-H', 'content-type: application/json', '-d', body,
  ]).toString().trim();
  const [code, seconds] = out.split(' ');
  codes.push(code);
  times.push(Number(seconds) * 1000);
}
const sorted = times.slice().sort((a, b) => a - b);
const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
console.log('codes', codes.filter((c) => c !== '201').length ? codes.join(',') : 'all 201');
console.log('min %s p50 %s p95 %s max %s', at(0.01).toFixed(1), at(0.5).toFixed(1), at(0.95).toFixed(1), sorted[sorted.length - 1].toFixed(1));
NODE
```

Baseline to compare against (Decision 36, measured 2026-10-07 against the TEST branch):
**min 9 988.6 ms, p50 11 898.8 ms, p95 13 313.0 ms, max 14 425.5 ms.** Anything other than
`all 201` invalidates the row — fix and re-run.

Record in `DEVELOPMENT_NOTES.md`, in one table: date, host + region, database + region, the
model pin, statements per phase, ms per phase, ms per round trip, and the four HTTP percentiles
— the baseline row beside the new one.

---

## 10. Step 9 — record and commit

1. `DEVELOPMENT_NOTES.md`: the dated entry, the before/after table, every command that was
   actually run (including the ones that failed), and the project id + region.
2. `docs/API.md`: replace the placeholder in the *Deployment* area with the real origin, the
   region pair, the env-var set from §1 and the health-check path. (The owner's host is a
   fact; do not write a host into the doc before it exists.)
3. `PLAN_PLATFORM_P1.md` Steps 4–9: tick the boxes and record the measured outcome.
4. `PLAN_PLATFORM_STATUS.md`: P1 Sprint 1 moves from PARTIAL to DONE, and the totals change.
5. Commit — explicit pathspec, never `git add -A`:

   ```bash
   git commit -m "P1 Sprint 1: co-locate the API with an EU database and record the before/after" \
     -- fly.toml scripts/check-target-parity.js scripts/lib/target-parity.js \
        scripts/lib/target-parity.test.js database/migration-applies.jsonl \
        docs/API.md docs/RECIPES/deploy-eu-colocation.md \
        DEVELOPMENT_NOTES.md PLAN_PLATFORM_P1.md PLAN_PLATFORM_STATUS.md
   ```

---

## 11. Rollback

| What | How | When |
|---|---|---|
| The deployed API | `fly apps destroy morocco-pc-api` (destroys the app and its machines; secrets go with it) | bad deploy, or after the sprint's numbers are recorded |
| The Neon project | Console → Project → Delete; the `pre-p1-replay` branch is inside it and goes with it | only after the parity table and the measurement are recorded |
| A half-applied migration set | none needed: the ledger resumes at the pending tail | re-run the runner with the same `--restore-point` |

Deleting the Neon project is destructive and cannot be undone. The restore point exists for the
replay, not for the project's life; export anything you need to keep before deleting.

---

## 12. Render alternative (only if Fly is unavailable)

1. **New → Web Service**, connect the repository.
2. Runtime **Docker**; Dockerfile path `apps/api/Dockerfile`; **root directory empty** (the
   build context is the repository root).
3. Region **Frankfurt**. Instance **Starter** — the free tier sleeps after 15 minutes and a
   cold start would be measured as latency.
4. Environment: `DATABASE_URL` (EU pooled), `API_ALLOW_SHARED=1`,
   `ENGINE_VERSION=<short sha>`, `LOG_LEVEL=info`. Do **not** set `PORT`: Render injects
   `PORT=10000` and the app reads it; the Dockerfile's `EXPOSE 3000` is documentation only.
   Do not set `TEST_DATABASE_URL` (see §1).
5. Health check path `/v1/health`.
6. Deploy by pushing the commit; the first build takes a few minutes. Then repeat §8.3, §9 and
   §10 with `APP=https://<service>.onrender.com`.

---

## 13. Definition of done (copy of the sprint's own)

- `GET /v1/health` on the deployed origin returns 200 with `status: ok` and `db: ok`, and an
  `engine_version` equal to the deployed short SHA.
- The parity gate says `RESULT: MATCH` with 22 ledger files and equal counts.
- The before/after table exists in `DEVELOPMENT_NOTES.md` with both hosts, both regions, both
  dates and the model pin.
- The owner has re-derived the target from the measurement, or confirmed the roadmap's
  hypothesis: p95 ≤ 2.5 s uncached decides whether Sprints 2–3 are still required.
