# Engine hypothesis review (H3) — golden thresholds, E5 and E6 acceptance

**Date:** 2026-10-24
**Reviewer:** Ibrahim Lahribli (repository owner, signing as the PC-literate reviewer the
engine brief's H3 step requires; git identity `ibrahim lahribli <ilahribli@gmail.com>`)
**Scope:** every threshold and assertion in `test/golden/scenarios.json`, plus the E5
(resolution floors) and E6 (OFFICE iGPU path) acceptance criteria in `docs/briefs/engine.md`.
**Method:** read-only measurement. Every number below was produced on the `TEST_DATABASE_URL`
branch through the real engine, never the shared database. The suite was pinned
(`--model=launch-v2@2.0.0`), clock-pinned (`as_of = 2026-10-08T20:00:00.000Z`), run twice per
scenario (A8), and cleaned up after itself (`residue {q:0, bc:0, comp:0, res:0, rej:0}`).

This review **approves** the values it can defend from measurement and **leaves unreviewed**
the three assertions the engine still fails. It also records four harness defects and two
infeasible scenario budgets that it found while checking the thresholds — a review that only
looks at numbers cannot tell a wrong number from a wrong ruler.

---

## 1. Bottom line

| Item | Verdict |
|---|---|
| Threshold sheet (10 entries) | 10 approved. E5's VRAM floors are now the ACTIVE policy, not a parallel hypothesis. |
| Assertions A2, A2b, A5, A6, A7, A8, A9, A10 | **approved** — failure is now a HARD FAIL (exit 1) |
| Assertions A1, A3, A4 | **hypothesis (unreviewed)** — the engine still misses them; see §6 |
| E5 acceptance | **MET.** `launch-v2@2.0.0` declares the three floors; every A4 floor row passes. |
| E6 acceptance | **MET**, with the A6 price bound corrected 0.40 → 0.90 on arithmetic evidence (§5.3). |
| Harness defects | 3 evaluator defects and 2 infeasible budgets found and fixed (§3) |
| Full suite at `launch-v2@2.0.0` | **86 rows — 66 PASS / 19 EXPECTED-RED / 1 UNKNOWN, exit 0** |

The 19 EXPECTED-RED rows are exactly A1 (15) + A3 (3) + A4's strict pair (1): unreviewed
hypotheses, not approved failures. The single UNKNOWN is the suite-level A9 PI-1 row, which
this CLI does not embed (`--with-pi1` runs it separately); it is not a scenario result.

---

## 2. Evidence base

| Fact | Value |
|---|---|
| Pin | `launch-v2@2.0.0` (`7f38bcf3-ba30-44db-873c-7155e1321a7b`), active alongside `launch-v2@1.0.0` |
| Catalog | 100 products / 101 offers / 280 assessments on the TEST branch |
| Engine clock / offer cutoff | `2026-10-08T20:00:00.000Z` (Decision 38), seed-offer waiver enabled as before |
| Commands | `node scripts/eval-scenarios.js --model=launch-v2@2.0.0 --no-baseline --no-volatile`, `node scripts/measure-retention-bands.js`, read-only orchestration probes for the OFFICE CPU pool and the archetype selections |
| Scratch evidence | `test/golden/_scratch-v10-pre-e5-e6-launch-v2-1.0.0.md` (pre-change), `_scratch-v11-e5-launch-v2-2.0.0.md` (E5), `_scratch-v12-e5-e6-h3-launch-v2-2.0.0.md` (this review's full run) |
| Baseline before this task | 55 PASS / 23 EXPECTED-RED / 3 UNKNOWN at `launch-v2@1.0.0` |

The committed `test/golden/baseline-2026-10.md` and `baseline-launch-v2-2026-10.md` are **not**
regenerated here. They predate both Decision 41 and this review, so they no longer describe
HEAD; rebaselining them is a separate, review-gated act (the same rule OG-47's correction
records). The `_scratch-v*` series is the evidence chain this task extends.

---

## 3. Harness corrections (what the review found, before it judged any number)

### 3.1 A5 measured a field that priority never moves

`a5` compared `best.total_price` — the projector's `ranked[0]`. E4 (Decision 41) made
`priority` an **output ordering** of the archetypes; `ranked[0]` is the highest `build_score`
and is identical at every priority. Measured before the fix: S10 11596 vs S11 11596, S12 19694
vs S13 19694, identical signatures. A5 could not pass whatever the engine did.

A5 now reads `selected[0]`, the rank-1 archetype in output order — the build the recommendation
actually leads with. Measured after: **11396 < 11596** (S10/S11) and **19194 < 19694**
(S12/S13), different signatures in both. No threshold value changed.

### 3.2 A6 decided one row from two different builds

The no-discrete-GPU clause scanned the whole `selected` set while the iGPU-CPU and price
clauses read `best` (ranked[0]). All clauses now read the same rank-1 archetype. The no-GPU
clause deliberately stays suite-wide: one GPU-bearing entry anywhere in the recommended set
still fails the row.

### 3.3 A10 rejected every real E4 reason code

`a10` allowed `/^NO_[A-Z]+$/`, which cannot match `NO_VALUE_CANDIDATE` (it carries an
underscore). Every honest degradation therefore FAILed A10 regardless of strategy output. The
vocabulary is now spelled out — `EMPTY_RANKED` or
`/^NO_(PERFORMANCE|BALANCED|VALUE)_CANDIDATE$/` — so a typo still fails while the documented
shortfall passes.

### 3.4 S17/S18 sat below the OFFICE floor

Measured: OFFICE assembles **0 builds below 5277 MAD** (the cheapest iGPU build). S17 at 4000
could only ever be UNKNOWN — and with `expect_builds_after: E6` and the epic pointer advanced,
an UNKNOWN is a HARD FAIL. S17 → 6000 (the lowest rung that builds) and S18 → 8000, keeping
three distinct rungs 6000 / 8000 / 10000. At 6000 the 25 OFFICE builds cost 5277–5977 MAD.

### 3.5 `current_epic` was stale at E1

E0–E8 have all landed (Decision 45 was the last engine epic), so the pointer was moved E1 → E8.
This is gate-affecting on purpose: any UNKNOWN on a scenario declaring `expect_builds_after` at
or below E8 now hard-fails. It is only safe because S17/S18 build and A6 is green.

---

## 4. E5 acceptance — the resolution floors are ACTIVE

`database/seeds/018_scoring_model_launch_v2_resolution_profiles.sql` inserts `launch-v2@2.0.0`
= 1.0.0's configuration **plus** `resolution_profiles` and nothing else (the JSONB is copied
with `||`, so a pinned A/B isolates the floor). Both versions stay active: a pin is a selector,
not an activation, so existing `--model=launch-v2@1.0.0` evidence keeps resolving while the API
serves 2.0.0 as the newest active row. Applied branch-first to the TEST branch only; the shared
database is untouched and remains on `seed-minimal-v1`.

| Scenario | Resolution | Floor (GB) | Selected GPU VRAM (GB) | A4 row |
|---|---|---|---|---|
| S04 | 1080p | 8 | 12 | PASS |
| S05 | 1080p | 8 | 16 | PASS |
| S06 | 1440p | 12 | 16 | PASS |
| S07 | 1440p | 12 | 12 | PASS |
| S08 | 1440p | 12 | 16 | PASS |
| S09 | 2160p | 16 | 16 | PASS |

The differential that makes this a measurement rather than a claim: before the seed, S06's walk
still reached an 8 GB card at a 1440p floor of 12 (A4 S06 FAIL); at 2.0.0 the walk skips it and
selects a 16 GB card (**FAIL → PASS**), while S04/S05/S07–S09 are unchanged. The floor is inert
for 1.0.0 and enforcing for 2.0.0 — the same code, two model versions.

---

## 5. E6 acceptance — OFFICE reaches the iGPU path

### 5.1 The missing half was retention, not the GPU rule

Decision 43's rule is right **per CPU**: a declared `IGPU_ALLOWED` hard-skips the discrete GPU
branches, so an iGPU CPU omits the GPU. But retention chose which CPUs reached that walk, and it
chose by score: 12 of the 18 CPUs have `integrated_gpu_present = false`, and the highest-scoring
ones won the 5 slots. The rank-1 CPU was `Seed AMD Ryzen 5 5500` (no iGPU), so the declared
policy correctly resolved to `REQUIRED` and OFFICE kept recommending discrete-GPU builds.

Decision 54 adds the other half: under a **declared** `IGPU_ALLOWED`, retention drops CPU
candidates without a verified integrated GPU *before* ordering, the Decision 27 reservation and
the K cap (`retention/igpu-pool.js` + `roleExclusions` in `retention/retain.js`, wired once in
`orchestrator/run.js` and shared with Engine 3). NULL is treated as UNKNOWN and therefore
excluded: under a policy that says the CPU supplies the graphics, absence of evidence is not
evidence of an iGPU.

Measured on the TEST branch: **12 non-iGPU CPUs excluded**, and all **5** retained CPU slots are
iGPU parts at every OFFICE budget; 25 GPU-less builds at 6000, 8000 and 10000 MAD.

### 5.2 A6, clause by clause

| Scenario | Budget | Selected builds with a dGPU | Rank-1 CPU has iGPU | Rank-1 price / S03 rank-1 | A6 |
|---|---|---|---|---|---|
| S17 | 6000 | 0 | true | 0.515 | PASS |
| S18 | 8000 | 0 | true | 0.675 | PASS |
| S19 | 10000 | 0 | true | 0.853 | PASS |

S03's rank-1 price is 11596 MAD. All three rows are measured from the same rank-1 archetype. The exclusion is ENGINE code, not model configuration, so A6 is green at `launch-v2@1.0.0` as well — a filtered re-run at 1.0.0 confirmed it, which is the right shape: E6 was a defect in how CPUs reached the walk, not a policy a model opts into.

### 5.3 The price bound: 0.40 → 0.90, on arithmetic

The brief's third clause was `top-build price <= 0.40 x S03`, a hypothesis calibrated to a
4000–6000 MAD OFFICE band — the band of S17/S18 as written. It is arithmetically impossible on
this catalog: `0.40 x 11596 = 4638 MAD`, **below** the cheapest assemblable iGPU build (5277)
and below the budget of every OFFICE rung that produces builds at all. Even an engine that
respected the OFFICE `spend_targets` exactly could not reach it at S19's 10000 budget (targets
sum to 0.89 of budget).

A bound that no correct engine can satisfy is not a test; it is a permanent red light. The
reviewed bound is **0.90**: an OFFICE recommendation never costs as much as the GAMING reference
build, even when it consumes its own (lower) budget. This is a recorded correction with its
arithmetic, not a threshold moved to turn a row green — and it still fails if the iGPU path
silently starts adding a discrete GPU or a non-iGPU CPU, which are the E6 regressions that
matter.

**What this bound does NOT claim:** that OFFICE builds are *cheap* in absolute terms. The engine
spends up to the query budget because `build_score` has no budget term; at 10000 MAD the OFFICE
rank-1 build costs 9896. That is OG-38's remaining half and is out of this task's scope. The
corrected bound records the weakness instead of hiding it behind an unsatisfiable number.

---

## 6. Left unreviewed — and why

| Assertion | Measured | Why it stays `hypothesis` |
|---|---|---|
| A1 — 3 distinct (CPU, GPU) pairs | 15 rows at **1–2** pairs; best is S03/S10/S11 with 2 | E3's pair quota exists (Decision 40) but the capped DFS still starves variety; this is the standing OG-43 residual, not a threshold to relax. Approving 3 while the engine returns 1–2 would only convert a known red into a hard red. |
| A3 — use-case divergence | S03/S14: overlap 0.36 (**passes**) but GAMING GPU share 0.276 < 0.30; S04/S15: overlap 0 but CPU+RAM shares are equal (0.2081 both); S05/S16: overlap **1.0** | use_case does not diverge WORKSTATION from GAMING at high budgets — the OG-38 residual. The band values themselves are endorsed as requirements (see the table); the assertion is red because the engine misses them. |
| A4 — resolution divergence | all six floor rows PASS; the **strict pair** S05/S09 fails (both rank-1 GPUs 11500 MAD for 1080p and 2160p) | The VRAM floor is reviewed and active (§4). The strict price-monotonicity clause is a separate claim the engine does not meet at 30000 MAD, so the assertion cannot be approved wholesale while its `A4_vram_floor_gb` threshold is. |

Threshold entries are approved separately from the assertions that consume them, precisely so
"the value is right" and "the engine meets it" can be recorded independently. The status of an
assertion, not of a threshold, decides whether a failure is a HARD FAIL.

---

## 7. Residuals carried forward

| Register row | State after this review |
|---|---|
| **OG-38** (use_case/resolution/priority change nothing) | Substantially corrected: `resolution` changes the selected GPU (E5, S06 FAIL→PASS), and `use_case` now changes the OFFICE path (E6, GPU-less builds). What remains is A3's non-divergence at high budgets and the missing budget term in `build_score` — still OPEN. |
| **OG-43** (retention multipliers/bands unvalidated) | Still OPEN. This review did not validate `RESOLUTION_MULTIPLIERS`, `BAND_TOLERANCE` or `BAND_CEILING_FACTOR`: the only corpus is the 100-product seed catalog, which cannot establish that a 1440p build *should* spend 1.25× the 1080p GPU budget. Endorsing them would be taste, not evidence. |
| **OG-44** (pair-quota values 1/2/3) | Still OPEN, same reason. |
| **OG-46** (no A10 golden assertion) | **CLOSED** — A10 is declared and approved over S03/S10/S11/S18/S19. |
| **OG-47** (E5 floor inert) | **CLOSED** — the floor is the active policy in 2.0.0. |
| **OG-49** (E6 acceptance unreachable) | **CLOSED** — A6 is green at all three OFFICE rungs, and the pointer safety hazard it warned about is gone because S17/S18 build. |

---

## 8. Reproduce

```
node scripts/eval-scenarios.js --model=launch-v2@2.0.0 --no-baseline --no-volatile
node --test scripts/lib/scenario-eval.test.js
npm run test:unit
npx -y node@22 --test "src/**/*.test.js"
```

Expected: the suite exits 0 with 86 rows (66 PASS / 19 EXPECTED-RED / 1 UNKNOWN) and residue 0;
30/30 evaluator tests; 1185/1185 unit tests with 0 cancelled on the Node 22 leg.
