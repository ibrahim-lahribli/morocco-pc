# Step 2 — activate launch-v2 on the TEST branch and prove model byte-identity

> This is the **operator-run** section of the plan. The engine changes are Tasks 3–6 (Phase 2),
> and they are committed and green already. These steps apply seed 013 on the TEST branch and run
> two pinned golden runs against it; they touch **no file in `src/`**, write to **no shared
> database**, and are the only part of the plan that depends on Neon reachability and the commit
> wrapper's re-run guard. Run them only after explicit confirmation, because they move real data on
> `test-engine` (reversible per §6).

## §1 — Verified preconditions (read-only, checked before each run)

Confirmed before the first run:

- `test-engine` is currently `ep-weathered-salad-axdc6r3t` (Neon host and credential are in
  `.env` only — hosts in any doc are historical and stale).
- The shared `DATABASE_URL` is healthy and untouched by these steps: `node scripts/test-db.js`
  lists the core tables and `node scripts/check-og01-coverage.js --strict` reports PASS.
- `node scripts/apply-seed.js database/seeds/013_scoring_model_launch_v2.sql --dry-run` reports
  the seed's own idempotency guards and writes nothing. A second dry-run is still a no-op because
  the INSERT is guarded with `NOT EXISTS (...)` and the UPDATE is guarded with `is_active = true`
  plus `EXISTS (...)`. Note: dry-run counts statements only; it does not execute the INSERT, so it
  cannot prove a broken INSERT — the real apply is what proves it.
- `scripts/lib/model-pin.js` resolves by `name@version` among active models (default
  `seed-minimal-v1@1.0.0`; override `--model=<pin>` or `SCORING_MODEL_PIN`). On the shared DB the
  only active model is `seed-minimal-v1 1.0.0`, so the default pin resolves cleanly and the harness
  is byte-identical to the committed `test/golden/baseline-2026-10.md`. `node scripts/eval-scenarios.js`
  runs green against the shared DB and reproduces that baseline byte-for-byte.

## §2 — Verified on a real two-active branch (read-only, before applying)

Before touching any database, the selector was proven against a real two-active branch with a
temporary model `pin-rehearsal-tmp@9.9.9` copied from v1's configuration, removed after. That
rehearsal confirmed the exact contract the SELECTOR must honour after seed 013 is applied:

- An unmatched pin exits non-zero, writes nothing, and prints the active models instead of a dead-end
  "seed the branch first" message. The pin is resolved BEFORE the marker profile is created, so the
  run starts with profiles 0 and queries 0.
- The default pin still resolves cleanly beside the temp model; a full run pinned to the temp model
  passes and reports that pin.
- PI-1 passed when pinned to the temp model.
- The golden harness ran unchanged with two active models, and the default-pin baseline was
  byte-identical to the committed one.

That rehearsal is recorded in the C-36 close block of `docs/OPEN_GAPS.md` (OG-39 row) and is the
reason the plan can say "a pin is a SELECTOR, never an activation" and mean it. The rehearsal row and
all residue were removed before anything else was done, so `test-engine` still has exactly the rows
seed 013 will add.

## §3 — Apply seed 013 on the TEST branch (guarded, one transaction, direct host)

```
node scripts/apply-seed.js database/seeds/013_scoring_model_launch_v2.sql
```

What it does:

- Inserts `scoring_model launch-v2 1.0.0` as `seed-minimal-v1 1.0.0`'s exact configuration
  (`||`) with `use_case_profiles` appended — so the two models differ by exactly one configuration
  key, and today's scoring numbers are byte-identical between them. Profiles: GAMING / WORKSTATION /
  OFFICE, each with `gpu_policy`, `spend_targets` and `archetype_objectives`. `spend_targets` are
  relative weights, not a partition (GAMING 0.97, WORKSTATION 0.98, OFFICE 0.89).
- Makes `launch-v2` the single ACTIVE model and sets `seed-minimal-v1` to `is_active = false`,
  while retaining v1's row.
- Applies to the TEST branch ONLY: `applyseed.js` routes through `getWriteTestDbUrl()` (a pg CONFIG
  OBJECT from `scripts/lib/db-url.js`, not a URL string), connects directly, and runs the file in one
  transaction. On success the seed runner prints its own summary and writes NO audit line —
  `database/migration-applies.jsonl` is written only by `run-migrations.js`, one line per applied
  migration. On failure the file is NOT partially applied.

What to verify after it returns 0:

- `SELECT name, version, is_active FROM scoring_model WHERE name IN ('seed-minimal-v1','launch-v2')
  ORDER BY name, version;` reads exactly one active row (`launch-v2 1.0.0`) with v1 present but
  inactive. Both rows exist because the INSERT is guarded — if the SELECT shows only one row, the
  INSERT did not apply and you are not on the expected branch.
- Active count is 2 (one active, one retained / inactive), not 1 and not 0. The harness's
  active-model check is now by count AFTER the pin resolves, so a two-active branch is the
  EXPECTED state after this step — that is the change from the locked engine.

Do not run any harness in this step. The next step re-activates v1, which is what makes both models
active simultaneously.

## §4 — Re-activate seed-minimal-v1 so both models are active on the TEST branch

This is the documented deviation, not an accident: seed 013 deactivates v1 by construction, but the
plan's whole point is to compare two active models, so v1 is re-activated immediately after.

The cleanest reversible way is a small JS helper that calls the same guarded UPDATE the seed used, so
a re-run is a no-op:

```
node scripts/_tmp_activate_v1.js
```

where `_tmp_activate_v1.js` (temporary, committed under a clear name and removed before the final
commit) runs the single guarded statement:

```sql
UPDATE scoring_model
   SET is_active = true,
       updated_at = now()
 WHERE name = 'seed-minimal-v1'
   AND version = '1.0.0'
   AND is_active = false
   AND EXISTS (SELECT 1 FROM scoring_model WHERE name = 'launch-v2' AND version = '1.0.0');
```

After it returns 0, verify:

- `SELECT count(*) FILTER (WHERE is_active) FROM scoring_model WHERE name IN
  ('seed-minimal-v1','launch-v2');` = 2.
- `node scripts/eval-scenarios.js --model=seed-minimal-v1@1.0.0` starts without the "exactly one
  active model" gate (that gate is gone after the pin landed) and runs against the two-active branch.

## §5 — Run the golden harness pinned to each model and capture the byte-identity evidence

Two pinned runs, both to committed baseline files:

```
node scripts/eval-scenarios.js --model=seed-minimal-v1@1.0.0 --baseline=test/golden/baseline-2026-10.md
node scripts/eval-scenarios.js --model=launch-v2@1.0.0 --baseline=test/golden/baseline-launch-v2-2026-10.md
```

Both use `scripts/lib/model-pin.js` and BOTH write the selected model's identity into the baseline
header (`scoring model: <name> <version> (<id>)`). That is why the two written baselines differ on
exactly one line — the model-identity header — when the two models are byte-identical downstream of
configuration. If a future run produces a v1 baseline that differs from the committed one on any other
line, that is a regression, not a calendar effect, and it must be investigated before anything is
committed.

After both return 0:

- The v1 run's written `test/golden/baseline-2026-10.md` is the COMMITTED baseline for the unchanged
  engine. Commit it as-is; do NOT regenerate it. It should be byte-identical to the committed one
  already on disk — `cmp` clean — and it must stay that way. If it is not byte-identical, the
  harness flag or the branch has changed and the plan is not in the state the plan assumed.
- The launch-v2 run's written `test/golden/baseline-launch-v2-2026-10.md` is the second committed
  baseline — the one that proves what launch-v2 ACTUALLY returns on this catalog. After E2 lands, this
  is the file that moves; the v1 baseline does not.
- Both runs should report 81 assertion rows / 56 PASS / 22 EXPECTED-RED / 3 UNKNOWN, exit 0, residue
  0 (cleanup verified). The exact numbers are the proof, not summary prose.
- Run `git diff --stat test/golden/baseline-2026-10.md test/golden/baseline-launch-v2-2026-10.md`
  and confirm the diff is exactly ONE line (the model-identity header). If it is more than one line,
  stop: that means the two models are NOT byte-identical downstream of configuration, and the plan's
  pre-condition is not met.

## §6 — Reversal (clean up if anything here fails before Phase 2 is committed)

If any step here fails and you need to back out before Phase 2 is committed:

1. Restore the two uncommitted phases to the committed state:
   `git restore --source=HEAD -- AGENTS.md CONTEXT.md docs/briefs/step2-launch-v2-runbook.md
   docs/OG-39_ACTIVATION_PLAN.md docs/OPEN_GAPS.md docs/RECOMMENDATION_ENGINE_DECISIONS.md
   docs/TEST_MAP.md docs/briefs/engine.md scripts/verify-docs.js
   test/golden/baseline-launch-v2-2026-10.md` — but do NOT touch
   `test/golden/baseline-2026-10.md` (that is the locked v1 baseline; never overwrite it).
2. Reset the TEST-only write commits that this step added (careful: this rewrites the branch):
   `git reset --soft HEAD~<n>` where `<n>` is the number of TEST-write commits since the last
   shared state, or `git reset --hard HEAD~<n>` if you want the branch's file state back too. Only do
   this on `agent/engine` after confirming no other work is in flight.
3. Confirm the shared database is unchanged: re-run `node scripts/check-og01-coverage.js --strict`
   and `node scripts/eval-scenarios.js --model=seed-minimal-v1@1.0.0` and confirm the v1 baseline
   still reproduces byte-for-byte. **The shared `DATABASE_URL` is never written by these steps** —
   seed 013 is applied to the TEST branch only, via the guard. The shared DB still has exactly the
   rows it had before.

If anything here fails after Phase 2 is committed, do NOT reset blindly — the engine changes are real
and green. Instead, leave the branch as-is and investigate the specific failure; the steps are
re-runnable because seed 013's statements are idempotent.
