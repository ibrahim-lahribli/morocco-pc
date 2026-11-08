# Recipe: release in two stages — the code first, then the scoring model

Two releases, never one. **Release 1** ships the current `master` code to the EU origin with
`ENGINE_VERSION` set and `SCORING_MODEL_PIN` still `launch-v2@2.4.0`: a deploy, no data change.
**Release 2** changes the served model (`launch-v2@2.5.0`, seed 029 `per_day_decay: 0`), which IS a
data change plus a preset regeneration.

**Who runs it:** the repository owner. Every step touches a real database, a real deploy or a real
secret. **Never print a connection string** — every command below takes a variable NAME, and the
scripts print a `db:<12 hex>` digest instead.

**Why two releases.** A deploy and a model change in one move makes any failure ambiguous: a 503, a
bad answer and an empty shelf have different causes, and a single step cannot tell them apart. The
code release is reversible with a redeploy and touches no rows; the model release moves
`catalog_version`, empties the preset shelf and cannot be undone by a redeploy.

## The one ordering rule, and why it is not the obvious one

> **The empty-shelf window starts at the SEED, not at the import and not at the pin.**

`GET /v1/presets` serves **the presets of the CURRENT `catalog_version`** and answers `200` with
`presets: []` when none exist at that version (`apps/api/src/routes/presets.js`). `catalog_version`
is a content digest over `CATALOG_COVERED_TABLES`, which includes **`scoring_model`** and
**`store_offer`** (`src/recommendation/query/catalog-version.js`). Measured on the TEST branch
2026-11-08, read-only, inside one rolled-back transaction:

| State | `catalog_version` |
|---|---|
| before seed 029 | `d2a400a79607807a877d1e8e5dfab7e6` |
| after seed 029 | `1badf5d7270096b5b993e6520d64471d` |

So **inserting the model row alone empties the shelf**, even while the deployed pin still names the
old model; the import moves the digest again. The shelf is only refilled by regenerating presets
*after* both, at the version the app will serve.

## Release 1 — code only (no data change)

### 0. Record the starting state (read-only)

```bash
git status --porcelain && git --no-pager log --oneline -1     # note the sha being shipped
export APP="https://morocco-pc-api-eu.onrender.com"           # the EU origin
curl -sS "$APP/v1/health"
```

Expected: `{"status":"ok","db":"ok","engine_version":"<deployed sha>"}`. **Write that sha down** —
it is the only thing that proves the deploy actually changed the code.

### 1. Read-only pre-checks (all four must pass before anything is deployed)

```bash
# (a) EU's LEDGER — expect "no pending" and exit 0. Point DATABASE_URL at the EU direct host for a
#     read-only check; --check writes nothing, so no restore point is needed.
DATABASE_URL="$TARGET_DIRECT_URL" node scripts/run-migrations.js --check

# (b) nothing in master is waiting for a migration that EU has not seen:
#     compare the two ledgers side by side (RESULT: MATCH on the ledger line is what matters).
DOTENV_CONFIG_PATH=.env.eu node -r dotenv/config scripts/check-target-parity.js \
  --a=env:DATABASE_URL --b=env:TARGET_DATABASE_URL

# (c) the app presents the API role TODAY (so a red result after the deploy is attributable):
DOTENV_CONFIG_PATH=.env.eu node -r dotenv/config scripts/check-deployed-role.js \
  --target=env:TARGET_DATABASE_URL

# (d) the shelf baseline: 17 / 18 / 17 keys and a non-null generated_at.
curl -sS "$APP/v1/presets?use_case=GAMING&currency=MAD"
curl -sS "$APP/v1/presets?use_case=OFFICE&currency=MAD"
curl -sS "$APP/v1/presets?use_case=WORKSTATION&currency=MAD"
```

**STOP** if (a) reports a pending migration (that is Release 2 work, not a code deploy), if (c) is
not `PASS` (fix the credential before blaming the deploy), or if the shelf is already empty (record
it as the baseline; do not "fix" it here).

### 2. Deploy

`render.yaml` keeps `SCORING_MODEL_PIN: "launch-v2@2.4.0"` **unchanged** and `ENGINE_VERSION` at
`sync: false`; `autoDeployTrigger` is off, so a push does not deploy.

- [ ] Set `ENGINE_VERSION` to the sha from step 0 (dashboard → the service → Environment; it is a
      public value, not a secret).
- [ ] Deploy the commit: dashboard → *Manual Deploy → Deploy latest commit* (or the Render deploy
      API for the service).
- [ ] No migration and no seed is applied in this release. If anything tells you to run one, the
      release has drifted — stop.

### 3. Post-deploy checks

```bash
curl -sS "$APP/v1/health"          # engine_version MUST equal the new sha, db "ok"
DOTENV_CONFIG_PATH=.env.eu node -r dotenv/config scripts/check-deployed-role.js \
  --target=env:TARGET_DATABASE_URL  # RESULT: PASS - every session is morocco_pc_api
```

- [ ] **One read-only recommendation GET.** Take an id from the shelf response of step 1(d) and read
      it back: `GET /v1/recommendations/{id}` → `200`, `builds` non-empty, `served_by.engine_version`
      equal to the new sha. This is read-only on purpose: a POST would write rows and change the
      thing Release 2 is about to measure.
- [ ] **The shelf is still served:** the same three `GET /v1/presets` calls return the same counts
      (17 / 18 / 17) and a `generated_at`. Release 1 must not move `catalog_version`.
- [ ] Warm the app before the role check (`curl` the health route, wait ~20 s): a spun-down instance
      answers `INCONCLUSIVE`, which is not a pass.

### 4. Rollback (Release 1)

Redeploy the **previous** sha and set `ENGINE_VERSION` back to it. No migration ran, no seed ran and
`catalog_version` was never touched, so there is nothing to reverse in the database — and no Neon
reset is ever part of this release. If the role check failed after the deploy, the credential is the
suspect, not the code (`docs/RECIPES/provision-the-api-role.md`, `deploy-eu-colocation.md` §8.5).

## Release 2 — the scoring model

Order: **restore point → seed → import → pin + deploy → regenerate presets → gates → accept.**
Steps 1–3 write to the EU database, so each needs `--target-env` and a restore point.

### 1. Restore point (owner)

Create a Neon branch of the EU database and keep its id. This is the rollback for steps 2, 3 and 5.
**Never reset to the parent branch** — TEST and EU carry fixtures that shared does not.

### 2. Seed the model — *the window opens here*

```bash
node scripts/apply-seed.js database/seeds/029_scoring_model_launch_v2_decay_off.sql \
  --target-env=TARGET_DATABASE_URL --restore-point=<id>
```

Expected: one transaction, one row, `launch-v2@2.5.0` inactive-then-active as the seed states,
`APPLIED`. `scoring_model` is in the digest, so **the shelf is now empty** (see the rule above) even
though the pin still names 2.4.0. That is expected, not a regression — steps 3 and 5 close it.

### 3. Import offers

```bash
node scripts/ingest-offers.js --target-env=TARGET_DATABASE_URL --restore-point=<id>
```

Run it **before** the presets: presets bake the prices that exist at generation time, so generating
first would publish seed prices into a freshly stamped shelf. The import moves `catalog_version`
again, which is why regeneration is step 5 and not step 3.

### 4. Pin and deploy

```bash
# render.yaml: SCORING_MODEL_PIN value "launch-v2@2.4.0" -> "launch-v2@2.5.0"; ENGINE_VERSION = new sha
```

Then deploy as in Release 1 §2–3. The pin must be bumped in the file, never in the dashboard. The
named row must be ACTIVE on the target: a pin matching no active row (or more than one) answers
`503 SCORING_MODEL_UNAVAILABLE`, and a malformed value fails at app construction.

### 5. Regenerate the presets — *the window closes here*

```bash
# dry-run first: it prints the plan and the catalog version it will stamp
node scripts/generate-presets.js --target-env=TARGET_DATABASE_URL \
  --restore-point=<id> --model=launch-v2@2.5.0

# then commit, same explicit pin
node scripts/generate-presets.js --target-env=TARGET_DATABASE_URL \
  --restore-point=<id> --model=launch-v2@2.5.0 --commit
```

`--model=` is mandatory here: without it the generator falls back to its default pin and would stamp
a shelf for a model nobody released. A key whose pass assembles nothing is recorded as `empty-pool`
and gets no preset (R-26), so expect GAMING and WORKSTATION at 6 000 MAD to stay absent.

Verify: the three `GET /v1/presets` calls return the ribbon again, `generated_at` is new, and one
preset id reads back through `GET /v1/recommendations/{id}` with builds.

### 6. Gates

```bash
DOTENV_CONFIG_PATH=.env.eu node -r dotenv/config scripts/check-offer-provenance.js --target=env:TARGET_DATABASE_URL
DOTENV_CONFIG_PATH=.env.eu node -r dotenv/config scripts/check-offer-freshness.js --fail-days=14
DOTENV_CONFIG_PATH=.env.eu node -r dotenv/config scripts/check-catalog-identity.js --target=env:TARGET_DATABASE_URL
node scripts/check-deferred-rules.js
node scripts/check-assessment-age.js --target=env:TARGET_DATABASE_URL     # WARNING only, never a gate
node scripts/check-og01-coverage.js --model=launch-v2@2.5.0
```

`check-offer-provenance` and `check-offer-freshness` answer **INCONCLUSIVE** while the catalogue is
seed-only — that is not a pass, and it is the gate that decides whether §7's "decision point" applies.

### 7. Accept

Record the measurements (golden harness at the pin on TEST, the gate outputs above, the shelf counts)
and keep the model decision **PROVISIONAL** until the owner accepts it. A green gate is evidence, not
adoption.

### Rollbacks (Release 2)

| Step | Rollback |
|---|---|
| 2 seed | `DELETE FROM scoring_model WHERE name='launch-v2' AND version='2.5.0' AND NOT EXISTS (SELECT 1 FROM recommendation_query q WHERE q.scoring_model_id = scoring_model.id);` — guarded on purpose: once a pass references the row the DELETE refuses, and the honest answer is then "regenerate presets for the old model", not a force delete |
| 3 import | offers are additive; delete the imported batch by its ingestion id and re-import, never reset |
| 4 pin | revert `render.yaml` to `launch-v2@2.4.0` and redeploy; **do not deactivate 2.4.0 before acceptance**, so the pin always has a target |
| 5 presets | delete the 2.5.0 preset rows and regenerate at the version actually served |
| 2–5 together | restore the Neon branch from step 1, then redeploy the previous pin |

## Decision point — shipping the model without the import

If real offers are not ready, the model CAN still ship; the cost is explicit:

- **The shelf is rebuilt from seed prices.** The seed already moved `catalog_version`, so skipping
  the import does not leave the old shelf in place — the shelf is empty until step 5, and step 5 then
  publishes a new ribbon whose prices are the seed's, freshly stamped. Landing pages look normal and
  quote indicative prices.
- **Live answers keep working and keep the "indicative" label.** Seed offers are served with
  `price_status: "indicative"` and the disclaimer; the recommendation itself does not degrade, but
  every price in it is unverified.
- **No gate can certify prices.** `check-offer-provenance` and `check-offer-freshness` stay
  INCONCLUSIVE, so "gates green" is unavailable: acceptance becomes an explicit, recorded acceptance
  of indicative pricing (R-01), not a pass.
- **The evaluation rests on a stale catalogue.** Measured on TEST 2026-11-08: 15 of 116 offers fresh,
  oldest 2026-10-04. A model released on that basis is evaluated against seed data, so the acceptance
  record must say so.

If that cost is unacceptable, the correct move is to ship Release 1 only and hold the seed until the
import can follow it in the same window — an empty shelf for the length of one seeding session, never
a shelf published against prices nobody verified.
