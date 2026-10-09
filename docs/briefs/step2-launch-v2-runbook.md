# Step 2 runbook — activate launch-v2 on test-engine (DO NOT RUN YET)

Status: **DRAFT / NOT RUN.** This file describes a coordinated step. Do not execute any command below until the
operator confirms it. Every write targets the **`test-engine` branch only** (`TEST_DATABASE_URL`, endpoint
`ep-weathered-salad-axdc6r3t`); production, `test` and `pre-018-2026-10-06` are out of scope.

## 0. Why this is not a routine seed run

`database/seeds/013_scoring_model_launch_v2.sql` **deactivates `seed-minimal-v1`** (statement 2) and makes
`launch-v2` the single active model. Step 2 requires the opposite: **both models active**, so the differential
run can compare them side by side on one branch. The seed as committed therefore cannot be applied verbatim
without a follow-up re-activation. Two further conflicts are recorded in §7 — read them before starting.

## 1. Preconditions (human, outside this repo)

1. `.env` has been repointed and the database password rotated (the operator does this by hand).
2. `TEST_DATABASE_URL` still resolves to `ep-weathered-salad-axdc6r3t` (branch `test-engine`, parent `test`).
   Confirm with `node scripts/apply-seed.js database/seeds/013_scoring_model_launch_v2.sql --dry-run`
   — the startup line must print `endpoint ep-weathered-salad-axdc6r3t (direct), database neondb`.
3. The 60 pre-marker `recommendation_query` rows are gone (see §2.4).

## 2. Pre-flight (read-only)

Target: **18 ledger rows, 100 `Seed %` products, 101 offers, exactly ONE active model, ZERO `recommendation_query` rows.**

1. Migration ledger and catalog — reuse the harness preflight by running it against a clean branch, or read
   directly:
   - `SELECT count(*) FROM schema_migrations` → **18** (latest `018_build_component_offer_provenance.sql`)
   - `SELECT count(*) FROM product WHERE name LIKE 'Seed %'` → **100**
   - `SELECT count(*) FROM store_offer o JOIN product p ON p.id = o.product_id WHERE p.name LIKE 'Seed %'` → **101**
   - `SELECT name, version, is_active FROM scoring_model WHERE is_active = true` → exactly one row:
     `seed-minimal-v1 1.0.0`.
2. Orphan sweep: `node scripts/eval-scenarios.js --cleanup-orphans`
   - Expected after the E0e change: `{ profiles: 0, queries: 0, dependents: 0, unmarked: 0 }` and exit 0.
   - If `unmarked > 0`, STOP — see §2.4.
3. A normal `node scripts/eval-scenarios.js` run must also print
   `startup orphan cleanup: {...}` and then pass `assertNoUnmarkedQueries`.
4. **Pre-marker rows (one-time).** The 60 rows measured on 2026-10-08 predate the marker, so the E0e harness
   will NOT delete them — `assertNoUnmarkedQueries` fails instead. They are attributable to the golden harness
   by shape (3 clusters of 20, each one committed transaction, budgets/use-cases equal to the `absolute` scenario
   set), and were left by runs killed before their `finally`. Removal is a hand operation, approved by the
   operator, in FK dependency order:
   `build_rejection` → `recommendation_result` → `build_component` → `build_candidate` → `recommendation_query`
   (all four dependents are currently 0, so only the `recommendation_query` DELETE does work).

## 3. Apply seed 013 (one transaction, BOTH models active)

1. Apply, on the **direct** host, in one transaction (the script does `BEGIN` → `SET LOCAL search_path = public`
   → the whole file → `COMMIT`):
   `node scripts/apply-seed.js database/seeds/013_scoring_model_launch_v2.sql`
2. Re-activate v1 so **both** are active (this is the Step-2 deviation from the seed's statement 2):
   `UPDATE scoring_model SET is_active = true, updated_at = now() WHERE name = 'seed-minimal-v1' AND version = '1.0.0';`
3. **Active-count print (required):**
   `SELECT count(*) FROM scoring_model WHERE is_active = true;` → **2**, and
   `SELECT name, version, is_active FROM scoring_model ORDER BY name;` → `launch-v2 1.0.0 true` and
   `seed-minimal-v1 1.0.0 true`.

## 4. Differential run

1. Pin the harness to a model **by name@version** (Step-2 item 1 — NOT yet implemented, see §7). Run the golden
   harness twice, once per model, with the suite's fixed `as_of` (`2026-10-08T20:00:00.000Z`):
   `node scripts/eval-scenarios.js --model=seed-minimal-v1@1.0.0` then
   `--model=launch-v2@1.0.0`.
2. Expected: **GAMING and WORKSTATION signatures are IDENTICAL across the two models** — nothing consumes
   `use_case_profiles` yet, and launch-v2's configuration is v1's configuration plus that one key. Any difference
   is a bug, not a tuning result.
3. Record what happens to **OFFICE** under each model (it is unreachable today; the differential run must not
   silently change that).
4. The orphan gate runs on every invocation: a killed run is swept at the next startup, and an unmarked row
   makes the run fail rather than proceed.

## 5. Baselines

1. Write `test/golden/baseline-launch-v2-2026-10.md` **next to** `test/golden/baseline-2026-10.md`.
   The v1 baseline is **immutable** — do not regenerate or hand-edit it.
2. The volatile sidecar (`test/golden/*.volatile.json`) is gitignored; regenerate it, never commit it.
3. Commit the new baseline in its own commit. State in the commit body that the v1 baseline was left untouched.

## 6. Rollback

- Deactivate launch-v2 and re-activate v1 (both are DML, and v1's row was never mutated or deleted):
  `UPDATE scoring_model SET is_active = false WHERE name = 'launch-v2';`
  `UPDATE scoring_model SET is_active = true WHERE name = 'seed-minimal-v1';`
- Remove launch-v2's row only if the operator explicitly asks; it is a normal seed row and `seed 013`'s
  `NOT EXISTS` guard makes a re-apply a no-op.
- The harness's marker profiles are self-cleaning: a killed run's rows are swept at the next startup.

## 7. Known conflicts and NOT-implemented items (read before starting)

1. **`is_active` conflicts three ways.** Step 2 wants both models active; seed 013 wants only launch-v2; the
   current harness preflight asserts **exactly one** active model and fails on two. Until the harness is pinned
   by name@version (Step-2 item 1, below), the differential run in §4 cannot execute on a two-active-model branch.
2. **Step-2 item 1 (pin harnesses by name@version via CLI/env flag, default `seed-minimal-v1 1.0.0`) is NOT
   implemented.** It is a prerequisite for §4 and is deliberately out of scope for the E0e change.
3. **`docs/briefs/requests.md` (Platform note: the API must read an explicit scoring-model id from config, and
   API DB tests must stay on a branch where only v1 is active) is NOT written.** Step-2 item 5, deferred.
4. `node scripts/run-seeds.js` is **not** the tool for this step: it targets the shared `DATABASE_URL` and has no
   TEST-branch routing. Use `scripts/apply-seed.js`.
