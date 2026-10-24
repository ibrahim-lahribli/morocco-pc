# First EU launch — the owner checklist, in runnable order

This page is the ORDER across the owner actions that stand between today's state and a launched
API: the first EU deploy, the rotation of the app onto `morocco_pc_api`, and OG-54's two remaining
residues. Each of them is closed on its own evidence, and none of them before the thing it depends
on exists.

The step DETAIL lives in `deploy-eu-colocation.md` (§8.2 deploy, §8.3 verify, §8.4 trust proxy,
§8.5 rotate) and `provision-the-api-role.md`. This page supplies the sequence, what each step must
PRINT, and the conditions that say stop.

**Who runs it:** the repository owner. Every step touches a real database, a real app or a real
secret.

**What it does not cover:** §8.4's `TRUST_PROXY` pin, §9's two re-measurements, staging, the web
frontend, and the retailer relationship itself (§5 only consumes its output). Those are follow-on
steps, not prerequisites for OG-54.

## Why this order

1. **Deploy first, on the OWNER's credentials.** A first deploy and a credential change in one move
   makes any failure ambiguous, and §8.3 could then not say which half broke.
2. **Rotate second.** The rotation is observable only while the app is running: its evidence is the
   app's own live database session, so there is nothing to observe before step 1.
3. **Close OG-54 item (1) third**, on §2's two lines alone. This is the item that unblocks the
   deployed-host work: V1's latency target, P2 Sprint 2 Step 4, and the Sentry delivery steps.
4. **OG-54 item (2) fourth.** It blocks no step, but any figure quoted from the shared database
   before it describes a DIFFERENT scoring model, so it belongs before anyone measures on shared.
5. **OG-54 item (3) last.** It is the only item with a commercial lead time, and nothing waits on it.

**A row may be closed as a DECISION** ("not now", with the reason recorded). It may never be closed
as DONE without the evidence its step names.

## 0. Record the starting state (read-only, about two minutes)

```bash
git status --porcelain && git --no-pager log --oneline -1     # note the sha
```

The EU-targeted reads below need `TARGET_DATABASE_URL` from `.env.eu`. That file is NOT loaded by
`DOTENV_CONFIG_PATH=.env.eu node scripts/x.js` — that form silently does nothing, because the
variable is read only by the `dotenv/config` PRELOAD (measured 2026-10-23). Use the preload form:

```bash
export APP="https://morocco-pc-api.fly.dev"

# TEST <-> EU: expected RESULT: MATCH (measured 2026-10-23: ledger 22/22, 43 tables,
# launch-v2@1.0.0|active on both, equal catalog and Layer 4 counts).
DOTENV_CONFIG_PATH=.env.eu node -r dotenv/config scripts/check-target-parity.js \
  --a=env:TEST_DATABASE_URL --b=env:TARGET_DATABASE_URL

# No app session yet: expected RESULT: INCONCLUSIVE (exit 0, and NOT a pass).
DOTENV_CONFIG_PATH=.env.eu node -r dotenv/config scripts/check-deployed-role.js \
  --target=env:TARGET_DATABASE_URL

# No retailer evidence anywhere: expected RESULT: INCONCLUSIVE.
DOTENV_CONFIG_PATH=.env.eu node -r dotenv/config scripts/check-offer-provenance.js \
  --target=env:TARGET_DATABASE_URL
```

**STOP if the parity gate is not `RESULT: MATCH`.** A DIFF means the deploy target is not the
database every measurement describes; resolve it (`docs/RECIPES/deploy-eu-colocation.md` §7) before
deploying anything. A DIFF at `scoring-model-pins` in particular means the target serves a model
nobody measured.

## 1. Deploy on the owner's credentials

Follow §8.2 and §8.3. The checklist form, with what each step must print:

- [ ] `fly auth login`, then `fly apps create morocco-pc-api` (once; if the name is taken, change
      `app` in `fly.toml` and the `--app` values in the commands below).
- [ ] `fly secrets set DATABASE_URL="$TARGET_DATABASE_URL" \
      ENGINE_VERSION="$(git rev-parse --short HEAD)" --app morocco-pc-api`
      — the OWNER url for this first deploy, by choice: see "Why this order" item 1.
- [ ] `fly deploy --app morocco-pc-api`; `fly status` shows one machine running.
- [ ] Leave `TEST_DATABASE_URL` UNSET. `fly.toml` already carries `API_ALLOW_SHARED=1`, which is what
      makes `DATABASE_URL` the pool; setting a test URL as well is §8.2's "deliberately not set"
      trap, where the guard can silently select the wrong pool.
- [ ] `node scripts/check-origin-readiness.js --app=morocco-pc-api --origin="$APP"` →
      `PREFLIGHT OK - addresses:` and at least one address. `FAIL preflight` exits 1: fix the
      deploy before anything else, and do not pin `TRUST_PROXY` against it.
- [ ] One POST and its read-back, exactly as §8.3 prints them → `201` with builds, then a `200`
      whose builds match, and `served_by.engine_version` is the sha you just deployed.
- [ ] **The before-evidence for §2** — the check must now SEE the app and name the wrong credential:

      `DOTENV_CONFIG_PATH=.env.eu node -r dotenv/config scripts/check-deployed-role.js --target=env:TARGET_DATABASE_URL`

      Expected: `RESULT: FAIL - … authenticated as another role: neondb_owner (… connection)`, exit
      1. That FAIL is the check WORKING. Record the line and the start times it prints.

**STOP if that last check prints `INCONCLUSIVE`.** It has not seen the app, so it has nothing to say
about the credential, and a later PASS could be a stale-tag artifact. Make the app's session
observable first — `curl -sS "$APP/v1/health"`, wait about 20 s for the 15 s health check, re-run —
and compare the printed start times with the deploy time before treating a session as the app's.

## 2. Rotate onto the role

Follow §8.5 steps 0–5. Its preconditions again, because each one is a real stop:

- [ ] Smoke test GREEN first: `node scripts/smoke-api-role.js --confirm-shared --target-env=TARGET_DATABASE_URL`.
      A red smoke test is a grant problem, and rotating onto it turns a working app into a failing one.
- [ ] Build the role's URL without printing it, and confirm `user: morocco_pc_api` (§8.5 step 1).
- [ ] `fly secrets set DATABASE_URL="$ROLE_DATABASE_URL" --app morocco-pc-api`, then
      `fly deploy --app morocco-pc-api`.
- [ ] `node scripts/check-origin-readiness.js --app=morocco-pc-api --origin="$APP"` → `PREFLIGHT OK`.
      `db: "down"` means the new credential is wrong; fix step 1 of §8.5, not the role.
- [ ] **The after-evidence:** `check-deployed-role.js` (same command as §1) →
      `RESULT: PASS - every morocco-pc-api session is authenticated as morocco_pc_api`.
- [ ] One POST and its read-back → `201` then `200`, with no `42501` in `fly logs`.

## 3. Close OG-54 item (1)

Item (1) is "the EU host still connects with the owner's credentials". It closes on BOTH of these,
from §2, and on nothing else:

- the `RESULT: PASS - every morocco-pc-api session is authenticated as morocco_pc_api` line, with
  its session counts and start times;
- one POST that answered `201` with builds on the deployed origin, plus its read-back.

- [ ] Record in `DEVELOPMENT_NOTES.md`, dated: the app, the target's audit digest
      (`db:2d66f26d7ddc` for EU), that the secret was rotated, the PASS line verbatim, the POST id
      and `served_by.engine_version`, and §1's FAIL line as the "before".
- [ ] Update OG-54: item (1) CLOSED with that evidence, and state in the row that items (2) and (3)
      remain open. Do not change the class or the row's other claims.

**A green `smoke-api-role.js` is not evidence for this item.** It connects as the role from this
machine and never observes the app's credential. Neither is a `fly secrets list` digest, which
cannot be compared to anything.

## 4. Decide, then act on OG-54 item (2)

The shared dev database still serves `seed-minimal-v1@1.0.0`, while TEST and EU serve
`launch-v2@1.0.0` (seed 013 is unapplied on shared). Two consequences have to be accepted BEFORE
the apply, because both are behaviour changes, not cosmetics:

- **The default scoring-model pin stops resolving.** Eight scripts resolve a `name@version` pin
  through `scripts/lib/model-pin.js` (`eval-scenarios`, `generate-presets`, `measure-api-pass-phases`,
  `measure-og01-reach`, `measure-orchestrator`, `measure-retention-bands`,
  `test-orchestrator-full-run`, `verify-pool-independence`) and the default is
  `seed-minimal-v1@1.0.0`. The pin FAILS CLOSED on an INACTIVE model, so after the apply every run
  against shared must pass `--model=launch-v2@1.0.0`. Seed 013's own header calls itself "a
  coordinated step, not a routine seed run" for exactly this reason.
- **The API pointed at shared starts serving launch-v2** and advertising `OFFICE` (`docs/API.md`,
  Option vocabulary). Anything that pins the old vocabulary there is now wrong.

If the answer is **"align shared"**:

- [ ] Create a Neon restore point on shared and record its id. `run-seeds.js` does NOT ask for one,
      and it applies to whatever `DATABASE_URL` names — there is no `--test-db` routing in it.
- [ ] `node scripts/run-seeds.js --dry-run` → per-file statement counts. Read them; a `;` inside a
      SQL comment inflates the count, so only a wildly different file is worth investigating.
- [ ] `npm run seed` → `SEEDED: <file>` per file. Seed 013 activates `launch-v2@1.0.0` and
      deactivates v1; 014–016 insert the pair-quota experiment versions; 017 deletes them again
      (guarded by an FK check, so a version any pass references is kept). The END STATE is stable
      across repeated runs even though a second run re-inserts and re-deletes.
- [ ] Verify the end state — the statement seed 017's header pins:
      `SELECT name, version, is_active FROM scoring_model ORDER BY name, version;`
      → two rows: `launch-v2@1.0.0 active`, `seed-minimal-v1@1.0.0 inactive` (a row that any
      pass references is KEPT by 017, and the parity gate would then name it).
- [ ] `node scripts/check-target-parity.js --a=env:DATABASE_URL --b=env:TARGET_DATABASE_URL` →
      `scoring-model-pins` MATCH. Explain any other DIFF it names rather than waving it through.
- [ ] `node scripts/check-offer-freshness.js --fail-days=14` on shared (the seed run re-stamps the
      offer window) → record the new first-expiry date; it is a 30-day obligation, not a one-off.
- [ ] Record the apply (restore point id, sha, the two-row result) and close item (2).

If the answer is **"shared stays on v1"**: record that decision, with its cost (a shared figure is
not comparable to a branch figure), and close item (2) as a decision. Do not close it as done.

## 5. OG-54 item (3): retailer provenance

- [ ] Obtain a real retailer export (the hard part, and the reason this item is last), then follow
      `docs/IMPORT_OFFERS.md` "Refresh the catalog".
- [ ] `node scripts/check-offer-provenance.js` → `RESULT: PASS`. The path was exercised end to end
      on 2026-10-23 on a temporary fixture: `SKU_EXACT` match, `PASS` with 1 verified offer, then
      the fixture deleted in FK order with residue asserted 0.
- [ ] Note for the reader: a NEW offer's first observation lives on `store_offer.fetched_at`;
      `price_history` only appends on a price or availability CHANGE, so an empty history means
      "no change yet", not "never observed".

Until that PASS exists, both gates report `INCONCLUSIVE` (101 seed offers, 0 verified). That is the
honest state and must not be presented as a verified catalog.

## 6. Launch definition of done

| Claim | Proving command | Where it is recorded |
|---|---|---|
| The API answers on a real origin | `check-origin-readiness.js` → `PREFLIGHT OK` | `DEVELOPMENT_NOTES.md`, dated |
| The app authenticates as the least-privilege role | `check-deployed-role.js` → `RESULT: PASS` | OG-54 item (1) + the notes entry |
| The write path works as that role | one POST `201` + read-back, no `42501` | same notes entry |
| Shared serves the same scoring model as the target | `check-target-parity.js` → `scoring-model-pins` MATCH | OG-54 item (2) |
| Prices have a retailer behind them | `check-offer-provenance.js` → `RESULT: PASS` | OG-54 item (3) |

**Do not:**

- apply the role, or rotate onto it, before `smoke-api-role.js` is green;
- rotate before §1 has produced the before-FAIL, or a later PASS proves nothing;
- run seeds against shared without a recorded restore point;
- close OG-54 item (1) on a smoke test, a secret digest, or an `INCONCLUSIVE` line;
- quote a figure measured on shared while shared runs a different model from the target.
