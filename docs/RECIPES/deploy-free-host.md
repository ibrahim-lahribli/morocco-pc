# Recipe: deploy the API to a free host

**Status 2026-10-28: the Koyeb free instance this recipe used to describe no longer exists.**
Koyeb agreed to join Mistral AI (announced 2026-02-17). Koyeb's own announcement says the
Starter plan "will soon be removed and new users will instead need to subscribe to the Pro,
Scale, or Enterprise plan", and its FAQ says a new user "will need a valid payment method and
must subscribe to one of our paid plans to get started". The pricing page now lists Pro
($29/mo + compute), Scale and Enterprise only — the sole $0 line is a 5-hour Serverless
Postgres trial, which is a database, not a service host. `app.koyeb.com` serves a transition
notice instead of the console, so no service can be created there today. Do not follow the old
steps, and do not sign up expecting a free tier.

The `--platform=koyeb` mode of the readiness gate was **REMOVED 2026-10-29**: no Koyeb deployment
exists in this project and the free tier is gone, so the name now fails as an unknown platform
(`--platform must be one of: fly, northflank, render`). The two health-only modes are
`--platform=northflank` and `--platform=render`; both need an explicit `--origin`.

This recipe is the replacement. Read section 2 first: both options are explicitly "not for
production", and only one of them is always-on.

Read `deploy-eu-colocation.md` §1 before setting any database variable. The pool-target rule
there applies unchanged: on these hosts `DATABASE_URL` is the real target, so set
`API_ALLOW_SHARED=1` and do not set `TEST_DATABASE_URL`.

---

## 1. What the repository already provides

| Need | Where it is | Host setting |
|---|---|---|
| Image build from the repo root | `apps/api/Dockerfile` (context = repository root) | Builder: Dockerfile, path `apps/api/Dockerfile`, context `/` |
| Port | `EXPOSE 3000`; the server reads `PORT` (`Number(source.PORT) \|\| 3000`) | Port `3000`, HTTP |
| Bind address | `HOST=0.0.0.0` is already the default | Set as an env var anyway |
| Health check | `GET /v1/health` (`apps/api/src/routes/health.js`) | HTTP health check, path `/v1/health`, port `3000` |

No application code changes are needed for either host. The image deliberately bakes in no
connection string: `apps/api/src/db.js` refuses to start unless the target is provably the
isolated TEST branch or `API_ALLOW_SHARED=1` is set explicitly.

## 2. The free options that still exist (checked 2026-10-28)

| Host | Free plan | Always on? | Card | Verdict |
|---|---|---|---|---|
| **Northflank** Developer Sandbox | 2 services, 2 jobs, 1 add-on; up to $20/mo of resources on Northflank Cloud | **Yes, no sleeping** | **Yes, hour zero.** The pricing page says "No card needed", but creating a service answers `409 Please complete your account by adding a default payment method` until one is on file (measured 2026-10-28) | **Recommended.** The only free option that keeps the always-on requirement |
| **Render** Free | 1 free web service, 750 instance-hours per workspace per month, no persistent disk | **No** — spins down after 15 minutes idle, ~1 minute cold start | **Yes** — a card is required even for a Free instance (measured 2026-10-28: the Add Card modal appears before `Deploy web service`, for a **$1 temporary authorization**, not a charge) | A demo origin. **Every latency number taken here is invalid** |

Three things to be explicit about:

- Fly (the repository's documented production path in `deploy-eu-colocation.md`) has no free
  tier. Its `shared-cpu-1x` machine and its `auto_stop_machines = false` /
  `min_machines_running = 1` settings describe a **paid, always-on** host.
- Northflank's Sandbox is always-on, so unlike the old Koyeb free tier and unlike Render it meets the
  "always-on" requirement while staying managed — Oracle’s Always Free A1 VM is also effectively
  always-on, but you own the OS, TLS and reverse proxy (§2.1). Its compute plan `nf-compute-50` (0.5 vCPU / 1 GB) bills
  $12/mo, which fits inside the $20/mo Sandbox allowance — so a single always-on service costs
  nothing, but a second service or a larger plan consumes the credit.
- Both free tiers are documented by their owners as not for production use. This is a trial or
  demo origin, never the launch path (`first-eu-launch.md`).

### 2.1 Other free hosts checked (2026-10-28)

Recorded so nobody re-researches them. Each row was read from the vendor’s own page on 2026-10-28;
the last column says why it is not the choice here.

| Host | Free offer | Why it is not the choice |
|---|---|---|
| **Oracle Cloud Always Free** | 2 OCPU / 12 GB ARM (A1), or up to two 1/8-OCPU AMD VMs, plus 200 GB block volume. Genuinely always-on at $0 ([docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)) | Card required at signup; you own the OS, firewall, TLS and reverse proxy; provisioning commonly fails with `out of host capacity`; and Oracle **reclaims idle instances** (7-day 95th-percentile CPU < 20% AND network < 20% AND A1 memory < 20%) — an idle API is precisely that shape. The allowance was also cut from 4 OCPU/24 GB to 2/12 during 2026 |
| **Google Cloud Run** | Monthly free request + CPU-second grant, Docker images, real HTTPS URL | Scales to zero unless you pay for minimum instances, which is billable; a billing account and card are required. A request-driven platform cannot honestly serve an always-on origin requirement |
| **Azure Container Apps** | 180k vCPU-seconds + 360k GiB-seconds + 2M requests/month per subscription | Same shape as Cloud Run: zero replicas is free, a warm replica consumes the grant. Card required |
| **Back4App Containers** | 0.25 vCPU / 256 MB / 100 GB transfer, **no card** | 256 MB is a tight Node footprint, and Back4App’s own September 2026 article says the free URL expires **60 minutes after deployment** — unusable as a stable origin |
| **Koyeb** | Docs still describe a 0.1 vCPU / 512 MB free instance | The console serves a transition notice (Koyeb joining Mistral AI) — see the status note at the top of this file. **Trust the console over the docs page**: believing the docs is what sent the previous attempt at a dead host |
| **Hugging Face Spaces (Docker)** | 2 vCPU / 16 GB CPU Basic hardware | Docker Spaces now require a **paid plan** per their Spaces overview, and free hardware sleeps |
| **SnapDeploy** | 0.25 vCPU / 512 MB, no card | 100 running hours/month across the account, sleeping after 15 minutes — cannot hold 24/7 |
| **Railway** | $5 trial credit, then $1/month credit | Not durable: the trial runs 30 days and the free credit cannot carry an always-on service |
| **Fly.io** | — | No ongoing free tier; the smallest always-on Machine is about $2.19/month |
| **Heroku / Vercel / Netlify functions** | — | Heroku has no free tier; the others cannot run this long-lived Fastify process with its `pg` pool without code changes |

Conclusion: **no free host is both card-free and always-on.** The real trade is Northflank (card,
~$12/month exposure, always-on) against Render (card, $1 authorization, sleeps). Everything else either
sleeps harder, needs self-management with a reclamation risk, or is a time-limited trial.

## 3. Option A — Northflank Developer Sandbox (recommended)

1. Use the team created at signup and deploy into its existing **`Default`** project. Two
   measured constraints decide this: a free project is accepted only in `europe-west` or
   `us-central` (**not** Frankfurt — see the measured list below), and a Sandbox team may hold
   exactly one free project, which a new account has already used on `Default`.
2. Create a service from the GitHub repository (`master`). Build type: **Dockerfile**.
   Dockerfile path `apps/api/Dockerfile`, build context `/` (repository root — the API imports
   the engine from `src/recommendation/`, so a narrower context cannot build).
3. Port: `3000`, protocol HTTP (it is auto-detected from `EXPOSE 3000`; confirm it).
4. Compute plan: `nf-compute-50` (0.5 vCPU / 1 GB) — the smallest, and the one that fits the credit.
5. Health check: HTTP, path `/v1/health`, port `3000`.
6. Environment variables (secrets as a secret group, not plain values):

   | Name | Value | Secret? |
   |---|---|---|
   | `DATABASE_URL` | the target Neon connection string — measured 2026-10-28: `us-east-2` (Ohio), pooled host | yes |
   | `API_ALLOW_SHARED` | `1` | no |
   | `PORT` | `3000` | no |
   | `HOST` | `0.0.0.0` | no |
   | `LOG_LEVEL` | `info` | no |
   | `LOG_PRETTY` | `0` | no |
   | `ENGINE_VERSION` | the deploy’s short git sha | no |

   Do not set `TEST_DATABASE_URL` on this host.

   `ENGINE_VERSION` is optional but worth setting: the API reports it as `served_by.engine_version` and
   persists it as the pass’s provenance (Decision 46). Unset, [app.js](../../apps/api/src/app.js) defaults it
   to `dev`, so every persisted pass claims the same deploy.

7. Deploy. The public host is shown on the service overview — a `*.code.run` address. It is
   assigned by Northflank, so it cannot be derived from the app name.

**Measured against the live API on 2026-10-28.** These are the facts a next attempt needs; the
service itself was **not** created: the project did eventually reach `created`, and creation then
stopped on the missing payment method:

- Free projects are accepted only in `europe-west` and `us-central`. `europe-west-frankfurt`,
  `europe-west-netherlands`, `europe-west-zurich` and `us-east1` all answer
  `409 Region does not support free projects`.
- A Sandbox team may hold exactly **one** free project. A new account already owns `Default`
  (`id: default`), and a second create answers `409 Maximum number of free projects reached`.
- Use `POST /v1/projects/{projectId}/services/combined` (build and run in one resource). It
  requires `vcsData.projectBranch` in addition to `projectUrl` and `projectType`, and a
  `readinessProbe` health check requires `successThreshold` as well as the five timing fields.
- A freshly created free project reports `lifecycleStatus: "pending_initialization"` and rejects
  every write with `409 Project is currently pending_initialization` while its read routes
  succeed. It stayed that way for roughly 35 minutes after the project was created, then became
  `created` on its own. That is "not ready yet", not a bad token — do not conclude the token is
  wrong from a write failure inside that window.

- The card requirement bites at a different step than the project does: a secret group can be
  created on Sandbox (`HTTP 200`), and the *service* then answers
  `409 Please complete your account by adding a default payment method`. So the Sandbox is free
  of charge, but it is not card-free.

### 3.1 What the card actually costs (measured 2026-10-28)

The vendor’s two pages disagree and the API settles it: the billing docs say "all users must add a
payment method to start creating resources on Northflank, regardless of plan selection", while the
pricing page advertises the Sandbox as "No card needed". The project and the secret group can be
created without one; the service cannot. Never describe a Northflank deploy as card-free.

What the vendor states, read 2026-10-28:

- **Entering the card charges nothing.** Pricing FAQ: "when you enter a card we only verify the card.
  Your card is only charged at the end of the billing cycle." The card docs add: "Your card will not
  be charged until you create and use paid services."
- **Billing is threshold-driven, not calendar-monthly.** New accounts carry a $50 threshold: when
  usage reaches it, Northflank invoices the current period, applies available credits, and charges
  the remainder to the default card. Selectable thresholds are $50 / $100 / $250 / $500 — there is
  no lower setting, so no invoice can be raised below $50 of usage.
- **The Sandbox is "up to $20 a month of free resources"**, and `nf-compute-50` (0.5 vCPU / 1 GB) is
  $12.00/mo. One always-on service therefore fits inside the allowance. A SECOND service (+$12), a
  larger plan, or a volume ($0.11657/GiB/mo, billed even while paused) does not.
- **Taxes are outside usage control.** Their FAQ says estimates exclude VAT/GST and that they collect
  taxes where the law requires it, so a real invoice can exceed the resource figure.

Measured on this account with read-only `GET /v1/billing/usage`, `/v1/billing/invoices` and
`/v1/billing/credit-balance`: **$0.00 usage, 0 invoices, $0.00 credit balance.** That last number is
the one to handle carefully — the $20 allowance is a plan entitlement, not a credit sitting on the
account, so it cannot be confirmed from the credit balance, and nothing readable here proves an
invoice will not be generated at month end for a $12 service. Do not claim "no charges ever".

The exposure is bounded rather than open-ended: one month of one `nf-compute-50` service, about $12
— because the $50 threshold means nothing invoices below it, and services suspend when an invoice is
unpaid. Keep it bounded by design: exactly one service, no volumes, no addons, a billing alert
configured, and the service DELETED once the verification is finished.

## 4. Option B — Render Free (fallback)

Use this when you would rather not carry Northflank’s ~$12/month exposure than keep an always-on
host. Accept the spin-down: it makes this host
unusable for measurement, exactly like the withdrawn Koyeb free tier.

**Both free options now want a card, and that changes the risk, not just the steps.** Render asks for one
before `Deploy web service` even on a Free instance; its modal states "To verify your card, Render will
perform a temporary authorization for $1 USD. You won’t be charged." That is a hold, usually released
within days, but some banks display it as a pending charge. **Once a card is on file, Render BILLS an
overage instead of suspending:** outbound bandwidth beyond the workspace allowance is $0.15/GB, and
build pipeline minutes beyond the allowance are $5 per additional 1,000. Without a card it suspends
instead, which is why the earlier revision of this section could call charges structurally impossible
— that claim is only true for a workspace with no payment method, and Render no longer lets you reach
that state from the dashboard. Per Render’s April 2026 plan change (live since 2026-08-01), the Hobby
plan includes **5 GB/month** of
outbound bandwidth; extra GB are $0.15 and extra build minutes $5 per 1,000. Both figures sit far above
anything a verification run produces, because this API answers in kilobytes.


The other price is cold starts: 15 minutes without inbound traffic spins the service down, it takes
about a minute to come back, and a workspace gets 750 free instance hours per month (a spun-down service
consumes none, but a 31-day month is 744 hours, so exactly one always-on service just fits). The
filesystem is ephemeral and there is no SSH on a free service, so diagnosis is HTTP-only.

1. **New → Web Service**, connect the repository, Language **Docker**.
2. Root Directory: repository root. Dockerfile Path: `apps/api/Dockerfile`. Docker Build
   Context Directory: `.`
3. Instance Type: **Free**. Region: match the DATABASE, not this recipe’s old default — measured
   2026-10-28, this repository’s `DATABASE_URL` is `us-east-2` (Ohio), so pick **Ohio**. Frankfurt
   is only right when the target is a Frankfurt Neon branch (`TARGET_DATABASE_URL`). Co-location is
   the whole point: every engine pass issues ~49 statements, so a wrong region multiplies that
   round-trip cost by the distance.
4. Do **not** set `PORT`. Render injects it, and the server already reads it; pinning `3000`
   here is the one setting that makes the health check fail.
5. Health Check Path: `/v1/health`.
6. The same environment variables as Option A, minus `PORT`.
7. Deploy; the host is `https://<service>.onrender.com`.

Render's free tier also answers `/robots.txt` with "disallow all" while the service is asleep,
and it may suspend a free service that initiates an uncommonly high volume of outbound traffic —
database access counts as service-initiated traffic here, so a busy recommendation pass can look
like abuse.

## 5. Verify the deployed origin

Both hosts assign the public hostname, so pass it explicitly. The health probe is the whole
check on these platforms (there is no address allocation to assert):

```
node scripts/check-origin-readiness.js --platform=northflank --origin=https://<your-service-host>
node scripts/check-origin-readiness.js --platform=render      --origin=https://<your-service-host>
```

Expected: `PREFLIGHT OK - origin: <url>` and exit 0. This checks `GET /v1/health?probe=preflight`
answers 2xx with `status: "ok"` and `db: "ok"`. A 200 with `db: "down"` fails, and that is the
point: it proves the database, not just the process.

Give a scale-to-zero host time to wake: the health-only modes allow a **60 s** cold start, because
the 10 s budget that suits an always-on machine reported a timeout against a healthy but spun-down
Render Free instance (measured 2026-10-29) while the same origin answered in 1.4 s once warm. A
timeout there is "not awake yet", not "broken" - re-run before diagnosing.

Also confirm `GET /v1/docs/json` returns the OpenAPI document (`apps/api/src/routes/docs.js`).

Both gate modes were exercised locally 2026-10-28, short of an account: an API process started
with only `PORT` set (the pool guard resolves the isolated TEST branch by itself) answers
`/v1/health` with `db: "ok"`, and the gate prints `PREFLIGHT OK - origin:` and exits 0 for both
`--platform=northflank` and `--platform=render`. Pointed at a process whose database was
unreachable it prints the `db=down` stop line and exits 1, so a process-only deploy cannot pass.
**Measured 2026-10-29 on a real deployed origin:** `--platform=render --origin=https://morocco-pc.onrender.com`
answers `PREFLIGHT OK - origin:` and exits 0 (the Render Free demo origin, warm), which is the first
time either health-only mode has run against a host rather than a local process. What remains
unverified is the rest of the deployment: no image build (there is no Docker daemon on the dev box)
and no assertion on the proxy headers yet.

### 5.1 Measured on the first real deployment (2026-10-28)

`https://morocco-pc.onrender.com` is the first origin this recipe produced. The numbers, because they
are the only evidence the path works end to end:

- `node scripts/check-origin-readiness.js --platform=render --origin=https://morocco-pc.onrender.com`
  printed `PREFLIGHT OK` and exited 0.
- `GET /v1/health` answered `{"status":"ok","db":"ok","engine_version":"dev"}`. The `db: "ok"` half is
  the part no local test can prove: the Render container really reaches Neon.
- `GET /v1/catalog/products?limit=2` and `GET /v1/meta/options` both answered 200, so the repository
  SQL runs against the deployed schema — not merely `SELECT 1`. `/v1/presets` without `use_case`
  correctly answers `422 VALIDATION_ERROR`.
- The deployed OpenAPI document is byte-identical to the committed
  `apps/api/test/unit/openapi-v1.10.json` (OpenAPI 3.0.3, API version 1.10.0, 10 paths), so the
  published contract is the one in the repo.
- **Latency floor ≈ 270 ms per request**, measured two ways: `/v1/health` (one `SELECT 1`) median
  **272 ms**, and a catalog read median **276 ms**. A floor that does not move with payload size points
  at the hops around the process, not at query cost. Calibration: this dev box measures 120-207 ms to
  the same Neon instance, CI measures ~56 ms, and same-region compute should be ~5-15 ms. DNS resolves
  the hostname to Render’s anycast edge in San Francisco, which does **not** reveal the compute region —
  confirm the region in the dashboard, and if it is not `us-east-2`, redeploy there and repeat this
  measurement instead of trusting the recipe.
- `node scripts/check-deployed-role.js --target=env:DATABASE_URL` answers **FAIL** against this
  origin (1 of 1 `morocco-pc-api` session authenticated as `neondb_owner`, measured 2026-10-29). That
  is the documented state, not a surprise: Render carries the owner's `DATABASE_URL`, so rotating that
  secret onto `morocco_pc_api` is the owner step OG-54 tracks (`deploy-eu-colocation.md` §8.5). Warm
  the app with `GET /v1/health` before running the check — a spun-down Free instance has no session to
  classify and the answer degrades to INCONCLUSIVE, which is not a pass.
- `engine_version` reads `"dev"` because `ENGINE_VERSION` was left unset; see step 6.

### 5.2 Deploying HEAD against an older schema breaks the READ path (measured 2026-10-28)

The first real `POST /v1/recommendations` to the deployed origin answered `500 INTERNAL_ERROR`
(request id `req-4`) after 4.4 s — and the pass **was persisted anyway**: 1 `recommendation_query`,
2 `build_candidate`, 2 `recommendation_result`, 16 `build_component`, 2 `build_rejection`.
`GET /v1/recommendations/<id>` then answered 500 as well.

Cause: `apps/api/src/repository.js` LEFT JOINs `recommendation_swap` in both build SELECTs
(Decision 56), and the shared database is one migration behind the code. Measured on 2026-10-28:

| Database | `recommendation_swap` | ledger head |
|---|---|---|
| shared (`DATABASE_URL`) | **missing** | `022_recommendation_preset.sql` |
| TEST branch (`TEST_DATABASE_URL`) | present | `023_recommendation_swap.sql` |

The pass commits in its own transaction and the response is assembled afterwards, so the write succeeds
and the read-back 500s. Three consequences:

- **A 500 does not mean nothing was written.** A client that retries creates a second pass and leaves
  the first one’s rows behind. Clean up before re-testing.
- Cleanup order that worked (every FK here is `ON DELETE NO ACTION`): `build_component` →
  `recommendation_result` → `build_rejection` → `recommendation_preset` → `build_candidate` →
  `recommendation_query`, then assert 0 rows for that id **and** 0 in each table — a leftover unmarked
  `recommendation_query` row blocks `npm run eval:scenarios`.
- Fix without touching shared: point the service at the TEST branch, which is at 023, by setting
  `DATABASE_URL` to the branch string and **keeping `API_ALLOW_SHARED=1`** (without it the pool guard
  demands `TEST_DATABASE_URL` and refuses to start). Fixing it in place meant applying `023` to
  shared, which is owner-gated and needs a recorded Neon restore point (taken 2026-10-29, below).

**RESOLVED 2026-10-29 — the schema half is no longer a hazard.** The in-place fix the bullet above
describes was taken: `023` is applied to shared from restore point `br-royal-block-axu8i4a9` (audit
target `db:54ff6ea3f6e6`) and to EU from `br-cool-star-b9whdnt1`, so all three ledgers read 23 and the
deployed origin answers `POST /v1/recommendations` 201 and reads it back at 200 (both measured). Two
lessons here outlive the failure: a 500 does not mean nothing was written, and a deployment is only as
current as its target database's ledger. **The grant residue is CLOSED (2026-10-29):** both roles answer the full 21-answer contract after
`GRANT INSERT ON recommendation_swap` was applied from restore points `br-silent-cake-ax5q21at`
(shared) and `br-bitter-sky-b96jh91p` (EU), self-check 21/21 on each. Do not read a green role as a
least-privilege deploy, though: until the service's own secret is repointed,
`scripts/check-deployed-role.js` still answers **FAIL** (`neondb_owner`), which is OG-54 item 1.

**Before deploying, compare the two heads**: `ls database/migrations | tail -1` against
`SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1` on the target database.

## 6. Not covered

- `TRUST_PROXY` for either proxy chain is not pinned. Confirm the forwarded-header behaviour on
  the live origin before relying on per-IP limits; the pin procedure is Fly-specific
  (`deploy-eu-colocation.md` §8.4).
- `check-deployed-role.js` and the role/smoke scripts read `pg_stat_activity` and are not part of
  this recipe.
- The latency measurement chain (`measure-db-roundtrip.js`, `measure-api-pass-phases.js`) belongs
  on a paid, always-on host. On Render Free it is meaningless, and on Northflank Sandbox it is
  measuring a 0.5 vCPU shared container, not the production shape.
- Neither host is a launch target. `first-eu-launch.md` stays the owner sequence, and
  `deploy-eu-colocation.md` stays the production runbook.
