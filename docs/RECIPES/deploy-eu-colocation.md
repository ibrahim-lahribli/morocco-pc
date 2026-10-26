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
| Replay source | the **TEST branch**, not the shared database | Both carry the API's contract (ledger 22 on each since 2026-10-19), so either replays an API that can serve. The branch stays the source because the shared dev database accumulates local test rows. |
| Host | **Fly.io `fra`** (recommended); Render `frankfurt` as the alternative | See the comparison below. Both build `apps/api/Dockerfile` with the repository root as context. |
| Contract version at deploy | v1.6 | The served OpenAPI document names it; `/v1/docs/json` is the check. Eight paths as of 2026-10-23 — the price history is the eighth. |

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
| **A. Recommended** | `DATABASE_URL` (the environment's real target) | `DATABASE_URL` is the real target; `API_ALLOW_SHARED=1` says "this is not the dev branch". Omit `TEST_DATABASE_URL`. | Deploy this. |
| B. Guard-honouring | `TEST_DATABASE_URL` (EU) | `TEST_DATABASE_URL` is production and `DATABASE_URL` is the old database — a script run on the host would read the wrong one. | Do not deploy this. |

`API_ALLOW_SHARED` is a guard bypass, not a statement that the target is shared. Nothing in the
API writes to `DATABASE_URL` when it is the pool target; that is the point of the flag.

**Both deployed environments use row A** (Platform P3 Sprint 3, `PLAN_PLATFORM_P3.md`): production
sets `DATABASE_URL` to the EU project, staging sets it to the TEST branch's pooled URL, and both
set `API_ALLOW_SHARED=1` with `TEST_DATABASE_URL` unset. They differ in the URL, never in the
shape. Staging must NOT be run with `API_ALLOW_SHARED=0`: the pool would come from
`TEST_DATABASE_URL`, leaving `DATABASE_URL` as a baseline that a host-side script would read as
the real target — row B, exactly the inversion this section exists to prevent.

A LOCAL run is the one place row B is correct: `.env.frontend-dev` sets `TEST_DATABASE_URL` to the
frontend-dev branch and `DATABASE_URL` to the main branch, both real databases, and no script runs
on a laptop as if it were the host. Do not "fix" that file to row A.

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

`fly.toml` is COMMITTED at the repository root (2026-10-19) and reproduces the block below byte for
byte, so §8.1 is a verification step: diff the file against this block rather than retyping it. (It
was authored here and landed with PR #3, `8800422`.)

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


The production role now exists on this database (applied 2026-10-23, audit target
`db:2d66f26d7ddc`, restore point `br-late-rice-b906upai`, self-check 20/20, smoke test
green as `morocco_pc_api`). The deploy therefore SHOULD set `DATABASE_URL` to the ROLE's
connection string rather than the owner's. That is section 8.5 — its own deploy, its own
checks and its own rollback, because a green smoke test does not prove the app uses the
role. Until it is taken, the deployed API runs with the owner's credentials (OG-54).
Deliberately **not** set yet:

- `TEST_DATABASE_URL` — absent, so the guard cannot silently select the wrong pool.
- `TRUST_PROXY` — unset for the FIRST deploy on purpose: with it empty, `X-Forwarded-For` is
  ignored and every caller shares one bucket, which is safe but not truthful. Section 8.4 reads
  the trusted addresses off the running app's own logs and proves both halves of P2 Sprint 2
  Step 4 — do it in this same sitting. **Every latency number from this deploy is valid either
  way; per-IP fairness is not, until 8.4 is done.**
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

### 8.4 Pin `TRUST_PROXY` from the origin's own evidence (P2 Sprint 2 Step 4)

The deploy in 8.2 leaves `TRUST_PROXY` unset, which is correct but not finished: with it unset,
`request.ip` is the Fly Proxy's address, so the 30/min POST budget is 30/min for the whole
internet. This section reads the trusted addresses off the running app, pins them, and proves
both halves of the sprint's Step 4 — one client keeps one bucket, and a spoofed header cannot
mint a new one.

**The instrument is the existing request log, not a new endpoint.** Fastify's pino request
serializer sets `remoteAddress: req.ip` (`fastify@5.12.5` `lib/logger-pino.js`), so every
`fly logs` request line already prints the TRUST-RESOLVED address. That makes the log the
evidence channel for both states:

- with `TRUST_PROXY` empty, `remoteAddress` is the **proxy's** address;
- with the proxy named, `remoteAddress` is the **caller's** address.

Do not copy a proxy CIDR from anywhere: Fly publishes none, and the address to trust is
whatever the socket peer actually is (step 1). There is one documented complication: Fly says
the LAST `X-Forwarded-For` entry is a **shared or dedicated IP address assigned to your app**,
the edge the client connected to ([Fly request headers](https://docs.fly.io/networking/request-headers)).
Fastify walks the chain from the right and stops at the first UNtrusted address, so a pin that
covers only the peer can stop on the app's own edge address: one bucket for every caller again.
Pin both — the app addresses cost nothing when unused and are required when present.

**Preflight — the origin must be real before anything is pinned.**

Every later step assumes two facts about the deployed origin, so assert both instead of
eyeballing §8.3: the app owns at least one public address, and its health route answers 2xx
with `db: "ok"`. The check is committed (`scripts/check-origin-readiness.js`), so the
assertions cannot drift between runs, and both halves are unit-tested —
`scripts/lib/origin-readiness.test.js` for the parsing/verdict and
`scripts/lib/origin-readiness-cli.test.js` for the exit codes and messages:

```bash
APP="https://morocco-pc-api.fly.dev"
node scripts/check-origin-readiness.js --app=morocco-pc-api --origin="$APP"
```

`PREFLIGHT OK - addresses:` is the pass line and prints exactly the addresses the pin may
contain. Any `FAIL preflight:` line exits 1 and must stop the section — a pin read from a dead
or addressless origin is evidence of nothing; usage errors exit 2. The address list is column 1
of `fly ips list` filtered by `net.isIP`, so a table header or the CREATED AT timestamp can
never reach `TRUST_PROXY`, and the health verdict requires `status: "ok"` AND `db: "ok"`
rather than a bare 2xx. It reads only (one `fly ips list`, one `GET`) and does not care which
address family it connects over: unlike steps 1 and 3 it asserts reachability, not identity,
so there is no `-4` here.

**A redirect is a failure, not a pass.** The probe asks whether *this* origin answers, so it does
not follow redirects (the inline `curl -fsS` it replaced had no `-L`). Following one would let
some other host's healthy body stand in for this deploy's. A `301`/`302` therefore prints
`did not answer 2xx (HTTP 301)`; pass the `https://` origin, which `$APP` above already is.

**Step 1 — with trust OFF, read the proxy address.**

```bash
APP="https://morocco-pc-api.fly.dev"
MY_IP=$(curl -4 -sS https://api.ipify.org); echo "my public IP: $MY_IP"

# The ?probe marker is what makes the log line unambiguous: Fly's own health checks hit
# /v1/health too, so an unfiltered tail can show the checker's line instead of yours. The
# health route ignores unknown query parameters, so this is still a 200.
# -4 on BOTH curls: the app answers on IPv4 and IPv6, and a probe over the other family would
# log the other client address, which can never equal a v4 $MY_IP. For a v6-only client use -6
# here and in step 3, and get $MY_IP from https://api64.ipify.org.
curl -4 -sS -o /dev/null "$APP/v1/health?probe=trust-off"
sleep 2   # `fly logs` delivers buffered lines a moment after the request
fly logs --no-tail --app morocco-pc-api | grep 'probe=trust-off' | tail -3
```

Expected: a `"remoteAddress"` that is **not** `$MY_IP` — typically Fly's private 6PN peer
address. If `grep` prints nothing the buffered line has not arrived yet: wait a few seconds and
run it again. Repeat with a different probe value (`?probe=trust-off-2`), and again after a
redeploy, noting every distinct address; that set is what the pin must cover.
`fly logs --no-tail` returns the buffered lines and exits ([fly logs docs](https://docs.fly.io/flyctl/cmd/fly_logs));
on an older flyctl, run `fly logs` and press Ctrl-C after the request.

**Step 2 — pin it in `fly.toml` and deploy.**

Only once the preflight printed `PREFLIGHT OK`. The pin has two halves: the socket peer from
step 1, and every address the preflight listed — each of those can appear as the last
`X-Forwarded-For` entry. Add the combined value to the existing `[env]` block (none of it is a
secret, and the committed file is where the per-host pin belongs):

```toml
[env]
  PORT = "3000"
  HOST = "0.0.0.0"
  API_ALLOW_SHARED = "1"
  LOG_LEVEL = "info"
  LOG_PRETTY = "0"
  TRUST_PROXY = "<step 1 peer>,<each address the preflight printed, comma-separated>"
```

```bash
fly deploy --app morocco-pc-api
```

A startup error here is the parser refusing the shape (a hop count, `true`, a `/0` prefix or a
hostname); the message names the accepted form. Addresses, CIDRs and a comma-separated list are
accepted. Trusting an address only means "skip this entry while walking the chain from the
right"; it does not change who can connect, so listing an extra assigned address is safe.

**Step 3 — prove the pin took effect.**

```bash
curl -4 -sS -o /dev/null "$APP/v1/health?probe=trust-on"
sleep 2
fly logs --no-tail --app morocco-pc-api | grep 'probe=trust-on' | tail -1
```

Expected: `"remoteAddress":"$MY_IP"` — the caller's public address, same family as the probe. Three outcomes, three
meanings; do not proceed on an unproven pin:

- **`$MY_IP`** — the pin covers every entry Fly appends. Record it and go to step 4.
- **the step 1 peer address** (private) — the value never reached the process: check the
  `[env]` block and `fly status` for a restart.
- **a public address that is not `$MY_IP`**, usually one `fly ips list` printed — that entry is
  untrusted, so Fastify stopped on it. Add the missing address(es) to `TRUST_PROXY`, redeploy,
  and repeat this step.

`Fly-Client-IP` carries the client too, but Fastify's `trustProxy` reads `X-Forwarded-For`
only; switching the app to that header is a code change, not a config pin — do not do it here.

**Step 4 — one client, one bucket, and a forged header cannot mint one.**

The 30/min POST limit makes this cheap: the first request either runs a pass or reuses the one
8.3 created, and the rest reuse it (same body), but every request still counts against the bucket.

```bash
BODY='{"budget_amount":20000,"currency":"MAD","use_case":"GAMING"}'
sleep 61   # start from an empty window
for i in $(seq 1 31); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$APP/v1/recommendations" \
    -H 'content-type: application/json' \
    -H "x-forwarded-for: 198.51.100.$i" \
    -d "$BODY")
  echo "$i $code"
done
```

Expected: `200` for request 1 (a `201` if no pass with that exact body exists yet), `200` for
2–30, and **`429` for 31** — every request resolved to
the same real client, and a different forged prefix per request changed nothing. This is the
sprint's "a spoofed header cannot mint a bucket" half; it also shows one client keeps one bucket.
It does **not** by itself distinguish a working pin from a disabled one (both refuse to mint), so
step 3 and step 5 are not optional.

**Step 5 — two clients, two buckets (scenario 2.5).**

This is the only step that separates a working pin from a disabled one, and it does so only when
BOTH probes fall inside ONE 60-second window: two `29`s collected minutes apart just mean each
window was fresh, which is exactly what a broken pin also produces. Keep the gap under 50 s and
treat a longer gap as INCONCLUSIVE (not a failure): wait 61 s and redo the pair.

The second client is this machine switched to a phone's hotspot (mobile data, so the public
address differs). Switch back and forth rather than walking away.

```bash
BODY='{"budget_amount":20000,"currency":"MAD","use_case":"GAMING"}'
probe() {
  date +%s
  curl -sS -D - -o /dev/null -X POST "$APP/v1/recommendations" \
    -H 'content-type: application/json' -d "$BODY" \
    | grep -iE '^(HTTP/|x-ratelimit-remaining|x-ratelimit-reset)'
}

sleep 61   # the window starts empty; step 4's last request is older than this
probe      # network A: the one steps 1-4 ran on
# switch to the phone hotspot now, then run the SAME function:
probe      # network B, still inside network A's window
```

Expected: `HTTP/2 200` (`201` if a pass had to run) twice, `x-ratelimit-remaining: 29` twice,
network B's `x-ratelimit-reset` LOWER than network A's (the one shared window is counting
down), and the two `date` values less than 50 s apart. If network B reports `28`, `0` or `429`,
the two clients share ONE bucket and `TRUST_PROXY` is not taking effect — check step 3 again.
If network B is `29` but its `x-ratelimit-reset` is back near the full 60, the window rolled:
redo the pair, do not record a pass.

**Step 6 — record what was proven, then update the docs.**

Record in `DEVELOPMENT_NOTES.md`, dated: the deployed origin, the observed peer and app
address(es), the pinned `TRUST_PROXY`, `$MY_IP` as seen in the log, step 4's first and last
status codes, and the two step-5 `x-ratelimit-remaining` values with their timestamps, reset
values and the gap between them, and the preflight's printed addresses and `PREFLIGHT OK`. Then:

- tick **P2 Sprint 2 Step 4** in `PLAN_PLATFORM_P2.md` and paste the evidence beside it;
- replace `docs/API.md`'s "not yet recorded because no host is chosen" sentence with the pinned
  value and the date;
- move P2 Sprint 2 from PARTIAL to DONE in `PLAN_PLATFORM_STATUS.md` (Step 4 is its only open step).

**If the pin breaks after a redeploy** an address changed. Remove `TRUST_PROXY` and deploy: the
default-off state is safe (one shared bucket, limits still enforced), then re-run the preflight
and step 1 — a new app address also needs adding. If the observed peers span several
addresses, pin their smallest covering CIDR rather than one `/32`, and record that. The counters
remain per process (Decision 49 item 7), so this pin does not make the limits multi-instance
exact.

### 8.5 Rotate the app onto the database role (P3 Sprint 2 Step 5, second half)

The role exists on this database. The app does not use it yet: its `DATABASE_URL` secret still
carries the owner's URL, so every request runs with credentials that could drop a table. This is
its own section because it needs its own deploy, its own evidence and its own rollback.

**Two proofs, and only one of them is the smoke test.** `scripts/smoke-api-role.js` runs the API
*from the operator's machine* as `morocco_pc_api`. Green there means the role's grants are
sufficient for a whole pass. It does NOT mean the deployed app presents that credential — the
smoke test opens its own connection. The app's secret is unreadable too: `fly secrets list` prints
a digest, never a value. The one place the answer is visible is the database. The API tags every
pooled connection `application_name = 'morocco-pc-api'` (`apps/api/src/db.js`), so
`pg_stat_activity` names the user each live app session authenticated as, and
`scripts/check-deployed-role.js` reads exactly that. Measured 2026-10-23: Neon's pooler preserves
`application_name` on the server connection it opens, but only once a query has run — a bare
`connect()` opens nothing, and the app's 15 s health check (`SELECT 1`) is what keeps a connection
visible between requests.

Two traps came out of measuring that channel, and both are why the check is written the way it is.
**The read must be DIRECT.** The pooler multiplexes clients onto one server connection and applies
`application_name` per client, so a check connected through the pooled URL lands on the app's own
server connection and RELABELS it: the first version of this check did exactly that, then reported
`INCONCLUSIVE` having destroyed the evidence it went looking for. `check-deployed-role.js` derives
the direct endpoint with `toDirectUrl`, so its read has its own backend. **A pooled server
connection outlives its client** and keeps the last client's tag, so an app tag can be a leftover:
the report prints the app sessions' `backend_start` (oldest and newest) for exactly that reason.
Run step 4 while the app is serving traffic, and treat an old start time as a leftover rather than
as the running app.

**Step 0 — the preconditions, each of which fails loudly.**

- The app is deployed and answering (§8.2, §8.3). Rotating a secret on an app that has never
  started proves nothing, because there is no session to observe.
- The role exists on the target: `node scripts/apply-api-role.js --target-env=TARGET_DATABASE_URL
  --restore-point=<id>` (procedure `provision-the-api-role.md`; applied to EU 2026-10-23, 20/20).
- The role is SUFFICIENT: the smoke test must be green **first** —
  `node scripts/smoke-api-role.js --confirm-shared --target-env=TARGET_DATABASE_URL`. A red smoke
  test is a grant problem, and rotating onto it turns a working app into a failing one.
- The password is in its own file (`$HOME/.morocco-pc/api-role-eu.password`), one per database.

**Step 1 — build the role's URL and never print it.** Host and database stay the same; only the
user and password change, so nothing in section 1's env-var trap moves. `roleConnectionString`
(`scripts/lib/api-role.js`) replaces the whole userinfo, so the owner's password cannot survive
into the result:

```bash
export TARGET_DATABASE_URL='postgres://…-pooler…/neondb'   # the OWNER url, as in section 2
export ROLE_DATABASE_URL="$(node -e "
require('dotenv').config({ path: '.env.eu' });
const fs = require('fs'), os = require('os'), path = require('path');
const { roleConnectionString } = require('./scripts/lib/api-role');
const pw = fs.readFileSync(path.join(os.homedir(), '.morocco-pc', 'api-role-eu.password'), 'utf8').trim();
process.stdout.write(roleConnectionString(process.env.TARGET_DATABASE_URL, 'morocco_pc_api', pw));
")"

# Prove the SHAPE without echoing the secret: the user is the role, the host is unchanged.
node -e "const u = new URL(process.env.ROLE_DATABASE_URL); console.log('user:', u.username, '| host:', u.host, '| db:', u.pathname)"
```

Expected: `user: morocco_pc_api | host: ep-…-pooler.…neon.tech | db: /neondb`. If `user` is not the
role, stop — the secret you would set is the owner's again.

**Step 2 — set the secret and deploy.**

```bash
fly secrets set DATABASE_URL="$ROLE_DATABASE_URL" --app morocco-pc-api
fly deploy --app morocco-pc-api
```

`fly secrets set` restarts the machines by itself; the explicit `fly deploy` makes that restart
deterministic and is the image section 9's numbers are recorded against. The value does pass
through `fly`'s argv, so run this from the owner's own terminal, not a shared session, and never
paste the URL into a chat, an issue or a commit.

**Step 3 — the origin must still be healthy on the new credential.** The health probe runs
`SELECT 1` through the pool, so this is the first proof the role can connect from Fly at all:

```bash
node scripts/check-origin-readiness.js --app=morocco-pc-api --origin="https://morocco-pc-api.fly.dev"
```

Expected `PREFLIGHT OK`. A `db: "down"` here means the new credential is wrong (a bad password, a
typo'd user, or a URL that lost its `-pooler` suffix) — fix step 1, not the role.

**Step 4 — the check that decides it: which user is the app's session?**

```bash
node scripts/check-deployed-role.js --target=env:TARGET_DATABASE_URL
```

Three outcomes, three meanings:

- **`RESULT: PASS - every morocco-pc-api session is authenticated as morocco_pc_api`** — the
  rotation landed. The report prints session counts per user, so the evidence is quotable;
- **`RESULT: FAIL - … authenticated as another role: neondb_owner`** — the app is still on the
  owner. Either step 2 did not restart the machines, a second machine kept the old secret, or the
  secret landed on the wrong app. `fly status` and `fly secrets list` (digest only) are the next
  reads;
- **`RESULT: INCONCLUSIVE - no session tagged morocco-pc-api was observed`** — NOT a pass. Nothing
  was observed, so nothing was proved: the app may be stopped, freshly restarted, or holding no
  server connection. Send a request (`curl -sS "$APP/v1/health"`), wait ~20 s for the 15 s health
  check to open a connection, and re-run. Record an outcome only when it is PASS or FAIL.

**Step 5 — prove the write path on the deployed origin.** Rotation is a credential change, and the
write path is what it can break: the role may INSERT into the seven Layer 4 tables (`recommendation_swap`
joined them in Decision 56) and UPDATE exactly three columns (Decision 46 item 7). One POST and its read-back (§8.3) must still answer `201` with
builds, then a `200` whose builds match. A `42501` in `fly logs` means the grant set is wrong and
the rotation is the moment it surfaced; a `500` with no `42501` is a different bug.

**Step 6 — record it, then close the gap item.** Record in `DEVELOPMENT_NOTES.md`, dated: the app,
the audit-target digest of the database (`db:2d66f26d7ddc` for EU), that the secret was rotated,
step 4's full `RESULT` line with its session counts, and step 5's POST id and
`served_by.engine_version`. Close **OG-54 item (1)** on those lines alone. The launch-wide order —
deploy, rotate, item (1), item (2) on shared, item (3) — is `docs/RECIPES/first-eu-launch.md`.
Items (2) and (3) of that row are different owner actions — a seed apply on shared, and a real
retailer source — and nothing here closes them.

**Rollback.** Setting the owner's URL back IS the rollback, and step 4 is how you see it land:

```bash
fly secrets set DATABASE_URL="$TARGET_DATABASE_URL" --app morocco-pc-api   # the owner url again
fly deploy --app morocco-pc-api
node scripts/check-deployed-role.js --target=env:TARGET_DATABASE_URL        # expect FAIL naming neondb_owner
```

A `FAIL … neondb_owner` is the CORRECT result there: the app is back on the credentials it had
before. If what leaked is the role's PASSWORD, that is not this rollback — issue
`ALTER ROLE morocco_pc_api PASSWORD '<new>'` as the owner, write the new value to the password
file, and repeat steps 1–5.

**What rotation does not prove.** It does not re-measure the grant set (the 20/20 self-check at
apply time and the rehearsal are that measurement), and it does not narrow the role's `SELECT` on
the catalog. It proves exactly one thing: the running app now authenticates as `morocco_pc_api`.

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
        scripts/lib/target-parity.test.js scripts/check-origin-readiness.js \
        scripts/lib/origin-readiness.js scripts/lib/origin-readiness.test.js \
        scripts/lib/origin-readiness-cli.test.js database/migration-applies.jsonl \
        docs/API.md docs/RECIPES/deploy-eu-colocation.md \
        DEVELOPMENT_NOTES.md PLAN_PLATFORM_P1.md PLAN_PLATFORM_P2.md PLAN_PLATFORM_STATUS.md
   ```

---

## 11. Rollback

| What | How | When |
|---|---|---|
| The deployed API | `fly apps destroy morocco-pc-api` (destroys the app and its machines; secrets go with it) | bad deploy, or after the sprint's numbers are recorded |
| The app's database credentials | `fly secrets set DATABASE_URL="$TARGET_DATABASE_URL"` then `fly deploy`; the rotated-role check then reports `FAIL` naming `neondb_owner`, which is the rollback landing (§8.5) | a role credential that is wrong, leaked, or missing a grant |
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

## 13. Definition of done (the sprint's own, plus the Step 4 record this runbook adds)

- `GET /v1/health` on the deployed origin returns 200 with `status: ok` and `db: ok`, and an
  `engine_version` equal to the deployed short SHA.
- The parity gate says `RESULT: MATCH` with 22 ledger files and equal counts.
- The before/after table exists in `DEVELOPMENT_NOTES.md` with both hosts, both regions, both
  dates and the model pin.
- The owner has re-derived the target from the measurement, or confirmed the roadmap's
  hypothesis: p95 ≤ 2.5 s uncached decides whether Sprints 2–3 are still required.
- P2 Sprint 2 Step 4 is recorded too: `TRUST_PROXY` pinned from the origin's log evidence and
  both bucket proofs captured (8.4).
