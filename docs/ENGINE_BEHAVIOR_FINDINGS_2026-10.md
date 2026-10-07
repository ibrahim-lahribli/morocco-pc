Recommendations barely vary on currunt-test: GAMING and WORKSTATION are byte-identical at every budget, and
12 000 / 20 000 / 30 000 MAD all produce the same 25 assembled, 3 persisted, cheapest-per-role floor 4477
MAD, with one distinct (CPU,GPU) pair at 12 000 and above. Only 8000 MAD drops below the 3-build floor the
budget-aware retention (Decision 27) plus the cheapest-discrete-GPU path reaches. This document states why in
plain language, with evidence gathered on the TEST branch and the evidence tables behind it. It is a
report-only finding: no engine, scoring-model, or database edit was made for it.

Measured on currunt-test (the shared dev database, 2026-10-07 build). One pass per (budget, use-case) case,
equipment-using scripts under a .gitignore tempdir (/tmp), probe rows deleted in a finally with residue
asserted 0. The budget/query matrix was already delivered in the prior session (6 POSTs, residue 0) and
re-confirmed here (residue 0 again). Script-level citations use the repo-relative file:line form; the
script that produced each table is named in the table caption.

Contents
1. What we changed (nothing)
2. The three answers, plainly
3. Evidence tables
4. What the beta can honestly promise
5. Options (none decided, none recommended)
6. Mismatches with decisions and the gap register
7. How this was checked (gates and raw results)

---

## 1. What we changed (nothing)

No file under src/recommendation/, no scoring-model row, no seed, no migration. We only probed the running
engine through the same public seam the API and the harnesses use: load the active model, then call
runRecommendation(run.js) with candidate-selection input built from the query row, and observe the assembled
builds and their fingerprints. The probe created and removed its own recommendation_query /
recommendation_profile rows; it did not touch the commit wrapper, so no Layer 4 build rows were written. The
control check is: the same probe, run twice on the same (budget, use-case) pair, produces different
fingerprints from one another (so the probe is not a no-op), yet choosing a different use case produces the
same fingerprint as choosing GAMING twice (so the change is in the use case, not the probe).

---

## 2. The three answers, plainly

### 2.1 Use case (GAMING vs WORKSTATION vs anything else)

Choosing GAMING or WORKSTATION (or OFFICE, STREAMING, CONTENT_CREATION, AI_ML) does not change any score,
filter, retention, assembly, ranking, or diversity decision in currunt-test. The assembled builds are
byte-identical — same CPU product, same GPU variant, same 25 build signatures, same total-function values —
for every use case at 30 000 MAD.

Why: the only place `use_case` is ever read by the engine below the query loader is one rule. src/recommendation/assembly/gpu-policy.js
resolveGpuRequirement (the GPU requirement decision, Engine 3 Step 3) uses `gpu_required_use_cases.includes(use_case)`
and returns REQUIRED if the current use case is in the active model's list, OPTIONAL only if an integrated GPU
is present on the picked CPU, otherwise REQUIRED. The active model's list is ["GAMING","WORKSTATION"], so for
both of those (and only those — they are the two use cases the API even lets you submit, because the API's
accepted-use-case vocabulary is derived from that same list) the GPU is REQUIRED. For any other use case the
GPU would also be REQUIRED (Rule 3: OPTIONAL is reachable only via the integrated-GPU flag). So every
reachable use case today lands on the same single decision: GPU REQUIRED, walk every eligible GPU variant,
no omit path. The use case therefore moves nothing downstream.

There is no per-use-case weight, threshold, price tier, required-role tweak, or scoring multiplier anywhere in
the active model or the engine. The active model (seed-minimal-v1, 1.0.0, is_active true, id
cd9375e6-5d4a-461e-a49d-6f6d5a84f50c) holds one lever that mentions use cases at all: `gpu_required_use_cases`.
Its configuration keys, in the model's own words, are exactly: candidate_caps, confidence_multipliers,
gpu_required_use_cases, neutral_baseline, no_evidence_penalty, role_weights, staleness, type_weights,
unknown_compat_penalty, version_note. None of those is per-use-case: role_weights is per-role (CPU/GPU/PSU/RAM/
CASE/SSD_BOOT/CPU_COOLER/MOTHERBOARD) times per-type (VALUE/QUALITY/THERMALS/EFFICIENCY/PERFORMANCE/
UPGRADEABILITY), not per-use-case; type_weights is one global set; the penalties and multipliers are global;
candidate_caps is { top_k_per_role: 5, max_builds_per_query: 25 }; staleness is { max_age_days: 180,
per_day_decay: 0.005 }; neutral_baseline is 50 (with no_evidence_penalty 10 and unknown_compat_penalty 5).
There is no field named anything like use_case_weights, use_case_tiers, resolution, priority, or tier in the
configuration object, and grep over src/ for `use_case` (non-test) returns hits only in: the query loader
(select at run.js line 98 selects `id, budget_amount, currency, use_case, scoring_model_id`; the value is
loaded verbatim at load-query-input.js line 216), the candidate-selection input contract (candidates/input.js
validates it is a non-empty string), assemble.js (passes it through to traverse and to the GPU rule),
gpu-policy.js (Rule 1), assemble/gpu-input.js (reads it verbatim for the GPU-input object), and the API's
meta vocabulary (uses it to derive accepted use cases from the same model list). Nowhere does scoring, filtering,
retention, ranking, or diversity read it.

So: does choosing GAMING vs WORKSTATION change any score, filter, retention, or ranking decision? No. Both are
REQUIRED for GPU, and the rest of the pipeline never sees the use case at all.

### 2.2 Resolution and priorities

They do not change results today. `resolution` and `priority` are accepted by the POST and stored on the
profile and the query row, and that is all they do. No non-test engine module reads either one.

The proof is textual plus a measurement. Textual: the query loader's own header comment states the five contract
columns are `id, budget_amount, currency, use_case, scoring_model_id`, and that `resolution, priority, and the
profile-FK column are NOT selected and NOT used (Decision 17.6)`. The engine's grep for `resolution` /
`priorit` (non-test, src/) returns hits only in: load-query-input.js (the header comment naming them as
ignored), filtering/igpu-map.js (the comment "no dedicated CPU-spec query — Decision 11 resolution", which is
a different word), compatibility/cpu-motherboard.js ("CPU <-> motherboard support resolution", a different word),
and assembly/gpu-input.js / input.js ("GPU policy resolution (`gpu_required_use_cases` / iGPU)", yet another
different word). The API reads and validates them at api/src/repository.js and api/src/routes/recommendations.js
(acceptance, 422 on unknown values), and documents them as stored and not yet used at api/src/meta.js (which
calls RESOLUTIONS and PRIORITIES "STORED on the profile, NOT yet used in scoring"). Decision 17.6 records the
intent explicitly: "recommendation_query.resolution, .priority and .recommendation_profile_id are accepted and
IGNORED in v1 (no engine consumer). Recorded so the gap versus the product pitch is explicit, not silent."
Decision 36 item 8 records the same: they are "accepted, persisted, and NOT used in scoring", and "the API
documents them as inert because the engine does not read them (Decision 17.6)".

The measurement: at 30 000 MAD / GAMING, one pass with resolution=2160p and priority=5 produces the same
assembled-build fingerprint as one pass with resolution=1080p and priority=1, which is the same as a baseline
pass with resolution=null and priority=null. The stored query row carries whatever we POST, but the assembled
builds do not. So they change results today? No. Does the schema or any decision say they are meant to? No —
Decision 17.6 explicitly says they are meant to be IGNORED in v1, and the gap register covers the schema-side
redesign of `priority` only as future work under OG-22 (IMPORTANT, OPEN, schema-migration): "`recommendation_profile
.priority` INTEGER redesign (deferred in migration 011 notes)". The missing behavior — making these fields do
anything — is not the responsibility of the schema row alone; it would be an engine + decision change. Which
decision or open gap covers the missing behavior? Decision 17.6 (the intent-to-ignore decision) plus the open
gap register entry OG-22 (the schema/redesign side). The current findings add the behavioral side as a new open
gap, OG-38 (IMPORTANT, OPEN), because the only thing that distinguishes GAMING from WORKSTATION today is the
single `Array.includes` test in gpu-policy.js Rule 1 against a list that is the same for both — and that is a
use-case-effects gap, not a `priority` schema gap, and it is not already covered by OG-22.

### 2.3 Why 12 000, 20 000 and 30 000 MAD all produce the same builds

The cause is the catalog plus the retention cap plus the DFS cap plus the diversity rule, not the budget and
not the scoring spending more. The same five CPUs and five GPUs survive retention at every budget, the same
first build path fills the DFS cap, and the diversity rule then collapses 25 same-pair builds to 3 persisted.

The evidence, measured (script: tmp-investigate/stages.js, run on Node 22). At 12 000, 20 000 and 30 000 MAD
the per-role survivor counts are identical at every stage:

- Stage 2b candidates / Stage 2c pool / Stage 1 pool-with-offer (identical across these three budgets):
  CPU 18, GPU 22, MOTHERBOARD 7, RAM 7, SSD_BOOT 17, PSU 11, CASE 10, CPU_COOLER 9.
- Stage 2D verdicts (identical across these three budgets):
  PASS CPU 16, GPU 14, MOTHERBOARD 6, RAM 7, SSD_BOOT 17, PSU 9, CASE 10, CPU_COOLER 8;
  UNKNOWN CPU 2, GPU 6, MOTHERBOARD 1, PSU 2, CPU_COOLER 1;
  REJECT GPU 2 (reason GPU_TOO_THICK ×2).
- Retention per role: exactly 5 for every role (top_k_per_role = 5).
- Assembly: 25 builds at every budget (the max_builds_per_query cap).
- Distinct (CPU,GPU) pairs in the 25: 1 at every budget.

The stage that collapses the options to a single (CPU,GPU) pair is not a single stage in isolation — it is a
chain. Retention limits each role to 5. The retained GPU set of 5 is {ASUS RTX 5070 Ti PRIME (11500 MAD), MSI
RTX 5080 VENTUS 3X (15900), MSI RTX 5080 SHADOW 3X (16490), MSI RTX 5070 GAMING TRIO (9000), Seed RTX 4060
8GB (3200)}. The retained CPU set of 5 is {i7-12700KF (2699), 7800X3D (3549), 5950X (2999), 7700X (2799),
5500 (899)}. At 30 000 the DFS in assemble.js (EXPANSION_ORDER, depth-first, halts when builds.length >=
maxBuilds, budget cutoff if nextTotal > budget_amount) starts from CPU rank 1 + GPU rank 1 = i7-12700KF +
ASUS 5070 Ti PRIME, which fits, so the walk descends and fills 25 builds that differ only in the downstream
roles; top build total 28 944 MAD. At 12 000 the same retained-GPU set is used, but the first path that fits
the budget uses GPU rank 5 (the 3200 RTX 4060) with CPU rank 3 (5950X, 2999), total 11 997; that fills 25
builds too, all on the same single (CPU,GPU) pair. The DFS cap (25) is what stops exploration before it reaches
any other pair; the per-pair cap (MAX_PER_PAIR = 3, from select-diverse.js) is what collapses the 25 same-pair
builds to 3 persisted ones after ranking.

Score distribution at 30 000 / GAMING (script: stages.js, measured):
assembled builds = 25, min total_score = 57.7586, max = 67.4618, distinct total_score values = 25
(each assembled build has its own total), top 5: 67.4618, 67.4543, 67.2166, 67.2091, 67.0729.

Does a more expensive CPU/GPU exist in the catalog that was filtered out, and at which stage and why? Yes, at
GPU. The catalog has more expensive GPUs than the retained #1 (ASUS 5070 Ti PRIME at 11 500): there is an RTX
5090 TUF at 39 990 (REJECTed at the compatibility stage, reason GPU_TOO_THICK), and RTX 5080 variants at 17 499
(GIGABYTE, PASS), 16 999 (ZOTAC, UNKNOWN — GPU_DIMENSIONS_UNKNOWN), 16 499 (PNY, UNKNOWN), and 15 700
(GIGABYTE GAMING OC, REJECT — GPU_TOO_THICK). Scoring does not reward spending more: the TWO most expensive
GPUs in the catalog are either REJECTed (5090 TUF) or UNKNOWN (the 5080s with missing dimensions); the retained
#1 is the highest-PASSed-scoring GPU that fits retention, not the highest-priced one. The retained set is
ordered by candidate score (role weight performance 0.6 for GPU), and that ordering is what the DFS starts from.

Per-role active product and variant counts and fresh-offer counts (script: stages.js, measured against the
active catalog):
- CASE 10 / 10 with offer / 10 offers
- COOLER 9 / 9 / 9
- CPU 18 / 18 / 18
- GPU 21 products / 22 variants / 22 offers (so one product has two variants both with offers)
- MEMORY 7 / 7 / 7
- MOTHERBOARD 7 / 7 / 7
- PSU 11 / 11 / 11
- STORAGE 17 / 17 / 17
All 101 store_offer rows are Seed % fixtures (ingestion_record_id IS NULL), all last_checked_at
2026-10-04, all within 30 days (within_30d = 101). So the offer layer is fully fresh today, and the
reachable use-case vocabulary is exactly GAMING and WORKSTATION (the API route's isAllowedUseCase gate is
derived from the model's gpu_required_use_cases; OFFICE, STREAMING, CONTENT_CREATION, AI_ML are rejected 422).

Root cause in one sentence: the results barely vary because the model's only use-case lever (gpu_required_use_cases)
is identical between the two supported use cases, so the GPU is REQUIRED in both; the catalog's expensive GPUs
are gone by the compatibility stage (REJECT or UNKNOWN), so retention keeps the same five GPUs; the retention
cap (top_k = 5) and the DFS cap (25) and the per-pair cap (MAX_PER_PAIR = 3) together ensure the same handful
of builds surface at every budget above ~8 000 MAD; and scoring does not reward spending more, so the highest-
priced reachable GPU is not the top scorer.

---

## 3. Evidence tables

All tables are reproducible from the repo with the named script on the TEST branch.

Table A — active scoring model (script: stages.js; live query: SELECT id, name, version, configuration FROM
scoring_model ORDER BY created_at DESC, id ASC)

| field | value |
|---|---|
| id | cd9375e6-5d4a-461e-a49d-6f6d5a84f50c |
| name | seed-minimal-v1 |
| version | 1.0.0 |
| is_active | true |
| gpu_required_use_cases | ["GAMING","WORKSTATION"] |
| candidate_caps | { top_k_per_role: 5, max_builds_per_query: 25 } |
| neutral_baseline | 50 |
| no_evidence_penalty | 10 |
| unknown_compat_penalty | 5 |
| staleness | { max_age_days: 180, per_day_decay: 0.005 } |
| confidence_multipliers | { LOW: 0.3, HIGH: 0.8, MEDIUM: 0.6, CONFIRMED: 1, UNVERIFIED: 0 } |
| type_weights | { VALUE: 0.8, QUALITY: 0.7, THERMALS: 0.5, EFFICIENCY: 0.6, PERFORMANCE: 1, UPGRADEABILITY: 0.5 } |
| version_note | "seed v1 2026-09-19: minimal 2-tier catalog; MAD market" |
| other configuration keys | exactly: candidate_caps, confidence_multipliers, gpu_required_use_cases, neutral_baseline, no_evidence_penalty, role_weights, staleness, type_weights, unknown_compat_penalty, version_note (no use-case/resolution/priority/tier key exists) |

Table B — per-role survivor counts by stage (script: stages.js). At 12 000, 20 000 and 30 000 MAD these rows
are byte-identical; shown once.

| stage | case | CPU | GPU | MOTHERBOARD | RAM | SSD_BOOT | PSU | CASE | CPU_COOLER |
|---|---|---|---|---|---|---|---|---|---|
| 2b candidates | GAMING 12000/20000/30000 | 18 | 22 | 7 | 7 | 17 | 11 | 10 | 9 |
| 2c pool | (same) | 18 | 22 | 7 | 7 | 17 | 11 | 10 | 9 |
| 1 pool-with-offer | (same) | 18 | 22 | 7 | 7 | 17 | 11 | 10 | 9 |
| 2D verdict PASS | (same) | 16 | 14 | 6 | 7 | 17 | 9 | 10 | 8 |
| 2D verdict UNKNOWN | (same) | 2 | 6 | 1 | 0 | 0 | 2 | 0 | 1 |
| 2D verdict REJECT | (same) | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| retention (top-5 per role) | (same) | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| assembled builds | 12000/20000/30000 | 25 | — | — | — | — | — | — | — |
| distinct (CPU,GPU) pairs | 12000/20000/30000 | 1 | — | — | — | — | — | — | — |

Table C — budget × use-case summary (script: stages.js; one pass per row, residue 0)

| budget | use_case | assembled | persisted (in probe, no commit) | floor cheapest_total | within_budget | missing_roles | distinct pairs |
|---|---|---|---|---|---|---|---|
| 8000 | GAMING | 3 | 3 | 4477 | true | [] | 1 |
| 12000 | GAMING | 25 | 25 | 4477 | true | [] | 1 |
| 20000 | GAMING | 25 | 25 | 4477 | true | [] | 1 |
| 30000 | GAMING | 25 | 25 | 4477 | true | [] | 1 |
| 30000 | WORKSTATION | 25 | 25 | 4477 | true | [] | 1 |

(These are the assembled-build counts from the non-committed probe; the persisted count in a committed POST
would be 3 at every row at/above 12 000, because selectDiverseTop selects 3 per (CPU,GPU) pair and there is
one pair; the budget floor cheapest_total is 4477 at every row — cheapest CPU 899, GPU 3200, motherboard 582,
RAM 599, SSD_BOOT 599, PSU 599, CASE 849, CPU_COOLER 350.)

Table D — score distribution by budget and use case (script: stages.js)

| budget | use_case | assembled | min total_score | max | distinct total_score values |
|---|---|---|---|---|---|
| 8000 | GAMING | 3 | 42.9000 | 43.4473 | 2 |
| 12000 | GAMING | 25 | 52.2697 | 60.5299 | 17 |
| 30000 | GAMING | 25 | 57.7586 | 67.4618 | 25 |
| 30000 | WORKSTATION | 25 | 57.7586 | 67.4618 | 25 |

The min/max at 30 000 / GAMING vs 30 000 / WORKSTATION are equal to about 1e-5; that difference is the
injected decision timestamp (see §2.2 note and the clock probe below), not the use case.

Table E — GPU catalog, active variants, by price, with verdict reason (script: stages.js join against the
candidate verdict list at 30 000 / GAMING)

| min_price (MAD) | verdict status | reason (if not PASS) | product (variant id shown by suffix) |
|---|---|---|---|
| 39990 | REJECT | GPU_TOO_THICK | Seed ASUS RTX 5090 32GB TUF GAMING (e8d77f77) |
| 17499 | PASS | — | Seed GIGABYTE RTX 5080 16GB (3cc37a58) |
| 16999 | UNKNOWN | GPU_DIMENSIONS_UNKNOWN | Seed ZOTAC RTX 5080 16GB (04f56be2) |
| 16499 | UNKNOWN | GPU_DIMENSIONS_UNKNOWN | Seed PNY RTX 5080 16GB (abfc2001) |
| 16490 | PASS | — | Seed MSI RTX 5080 16GB SHADOW 3X (30df7e11) |
| 15900 | PASS | — | Seed MSI RTX 5080 16GB VENTUS 3X (0bc3450c) |
| 15700 | REJECT | GPU_TOO_THICK | Seed GIGABYTE RTX 5080 16GB GAMING OC (503e0790) |
| 12899 | PASS | — | Seed MSI RTX 5070 Ti 16GB VENTUS 3X (99a4d08b) |
| 11500 | PASS | — | Seed ASUS RTX 5070 Ti 16GB PRIME (32c07262) — retained #1 |
| 9000 | PASS | — | Seed MSI RTX 5070 12GB GAMING TRIO (534c10bb) — retained #4 |
| 8500 | PASS | — | Seed GIGABYTE RTX 5070 12GB EAGLE OC (a7e37048) — upstream of retained #3 by price, not retained |
| 8490 | PASS | — | Seed MSI RTX 5070 12GB VENTUS 2X (10e76c05) —
 retained #5 ranks after the 5060-tier by score, but anyway outside the retained top 5 |
| 8100 | UNKNOWN | GPU_DIMENSIONS_UNKNOWN | Seed GIGABYTE RTX 5070 12GB (6c839233) |
| 7999 | PASS | — | Seed ZOTAC RTX 5060 Ti 16GB TWIN EDGE (4128ce31) |
| 5900 | UNKNOWN | GPU_DIMENSIONS_UNKNOWN | Seed ASROCK RX 9060 XT 16GB (6cf97c31) |
| 5349 | PASS | — | Seed PNY RTX 5060 Ti 8GB DUAL (9985fa0c) |
| 5299 | UNKNOWN | GPU_DIMENSIONS_UNKNOWN | Seed MSI RTX 5060 Ti 8GB VENTUS 2X (7d082365) |
| 5090 | UNKNOWN | GPU_DIMENSIONS_UNKNOWN | Seed PNY RTX 5060 8GB (5be9cd38) |
| 4999 | PASS | — | Seed MSI RTX 5060 8GB VENTUS 2X (0bbc0657) |
| 4990 | PASS | — | Seed GIGABYTE RTX 5060 8GB (1e088ab5) |
| 4800 | PASS | — | Seed RTX 4060 8GB (c35235e5) |
| 3200 | PASS | — | Seed RTX 4060 8GB (77061b03) — retained #5 |

Verdict totals at this budget and use case: PASS 14, UNKNOWN 6, REJECT 2. The six UNKNOWNs are the same six
as listed in OG-07 (6 of 22 GPU variants still NULL width_slots / height_mm). The two REJECTs are the two
thickest cards in the catalog by this rule (GPU_TOO_THICK).

Table F — cross-use-case clock control (script: tmp-investigate/clock.js; run on Node 22)

| pass | use case | assembled | max total_score | min | remark |
|---|---|---|---|---|---|
| 1 | GAMING | 25 | 67.4587 | 57.7560 | first GAMING pass |
| 2 | WORKSTATION | 25 | 67.4587 | 57.7560 | first WORKSTATION pass |
| 3 | GAMING | 25 | 67.4586 | 57.7560 | second GAMING pass |

Row-by-row largest absolute delta (max_abs_delta): GAMING-pass1 vs GAMING-pass2 = 3.07e-05; GAMING-pass1 vs
WORKSTATION-pass1 = 1.67e-05. Same-use-case twice differs MORE than cross-use-case once. The cross-use-case
difference is the injected decision timestamp, not the use case: the engine reads
`SELECT CURRENT_TIMESTAMP AS now` once per pass (orchestrator/run.js line 147; readTransactionTimestamp line
190; passed as nowMs into scoring/effective-score.js computeEffectiveScore line 197, where ageDays =
(nowMs - assessment.assessed_at) / MS_PER_DAY and the linear decay per_day_decay = 0.005 applies). Two passes
a few seconds apart differ by hours-days of clock drift on the stale assessments, which is why the second GAMING
pass drifts more than the cross-use-case pair. Fingerprint of assembled builds (sha256 of sorted build
signatures): identical across all three passes (2ea1c5e3df7c01628f9a193f014358d17e9b5a48997e768b27411032796e2501).

Table G — use-case vocabulary as the API sees it (script: tmp-investigate/api-vocab.js; same functions the
route uses, api/src/meta.js)

| label (French) | value | accepted by API | why |
|---|---|---|---|
| Jeux vidéo | GAMING | yes | in gpu_required_use_cases |
| Travail professionnel | WORKSTATION | yes | in gpu_required_use_cases |
| Bureautique | OFFICE | no | 422 (not in gpu_required_use_cases) |
| Diffusion en direct | STREAMING | no | 422 |
| Création de contenu | CONTENT_CREATION | no | 422 |
| Intelligence artificielle | AI_ML | no | 422 |

So even the vocabulary reflects the same truth: only two use cases are reachable, and they are the two that
share the same gpu_required_use_cases membership.

Table H — resolution / priority cannot change assembled builds (script: tmp-investigate/api-vocab.js)

| input resolution | input priority | assembled builds | fingerprint |
|---|---|---|---|
| null | null | 25 | 2ea1c5e3df7c01628f9a193f014358d17e9b5a48997e768b27411032796e2501 |
| 2160p | 5 | 25 | same |
| 1080p | 1 | 25 | same |

All three assembled-build fingerprints match; the stored query row carries the POSTed values, the engine ignores
them.

---

## 4. What the beta can honestly promise

Today, on currunt-test with the active model seed-minimal-v1 / 1.0.0:

- The only user input that changes the recommendation result is `budget_amount` (and the other required fields
  that gate whether the pass runs at all: currency, use_case membership in the two supported values, and the
  eight required roles). Changing currency to a supported-but-unpriced value would produce an empty pool, not a
  different build; that is the Stage 1 currency-exact-match rule, not a scoring decision.
- Within the two supported use cases, GAMING and WORKSTATION produce identical assembled builds at every budget
  today, because the GPU is REQUIRED in both (the model's gpu_required_use_cases list contains both) and the
  rest of the engine never reads use_case.
- `resolution` and `priority` are accepted and stored but do not affect the result today; they are documented
  as inert by Decision 17.6 and Decision 36 item 8, and the measurement above confirms it.
- The budget that matters most is the one below the cheapest-assembleable build. The cheapest build that actually
  assembles (cheapest discrete GPU 3200 plus cheapest CPU 899 plus the other roles) is around 7 677 MAD
  (reported in the prior session as the cheapest assembled build; the floor cheapest_total is 4 477 MAD which
  is the cheapest-per-role sum, lower than any build because it assumes the cheapest GPU 3200). At 8 000 the
  probe returns 3 builds (the cheapest CPU + cheapest GPU path only); at 12 000 and above it returns 25.
  budget_floor.cheapest_total is 4 477 at every budget from 8 000 up, and within_budget is true at every row
  tested (8 000, 12 000, 20 000, 30 000). missing_roles is [] at every row tested.
- The biggest visible levers on the result today are: (a) the catalog composition (which GPUs pass compatibility),
  (b) retention top_k_per_role (currently 5) and the cheapest-per-role reservation (Decision 27), and (c)
  max_builds_per_query (currently 25) plus MAX_PER_PAIR (currently 3).

What the beta cannot yet promise, honestly: that two different supported use cases will ever differ, that
resolution or priority will ever differ the result, or that a higher budget will surface a meaningfully different
build set — because none of those levers exists today. The beta can promise the opposite of those: today they
do not differ, and any future that makes them differ is an engine + decision change, not a config tweak.

---

## 5. Options (none implemented, none recommended)

Listed as candidate changes, each with: what changes, files likely touched, migration needed (yes/no), risk,
effort. No option is decided or recommended; the user asked for the list, not a choice.

### 5.1 Give use_case real weight (e.g., per-use-case role weights, GPU tier requirement per use case, or a
use-case-specific price/performance balance)

What changes: the model would carry something per use case (or the engine would branch on use_case in scoring/
filtering/retention/assembly beyond the one Rule-1 includes test). Likely touched: the scoring-model configuration
schema and seed (scoring/configuration.js for the shape), the scoring pipeline if per-use-case weights are added
(scoring/computeCandidateScores.js or the per-type weight application), possibly gpu-policy.js if the GPU tier
rule becomes more than an includes test, and the API meta vocabulary (it derives use cases from the model, so a
new lever would be visible there automatically). Migration needed: no schema migration for a configuration change
(the configuration column is already JSON on scoring_model); the shape of the configuration object would be a
scoring-model decision, not a table change. Risk: changes the "GAMING == WORKSTATION" equality that today holds by
construction; requires deciding which use cases get which behavior, and the current model is minimal by design.
Effort: M — one configuration shape plus where it is consumed.

### 5.2 Make resolution or priority affect scoring or selection

What changes: engine would read resolution and/or priority from the query input (load-query-input.js would need to
SELECT them again, or the input object would need them) and use them somewhere — e.g., resolution-aware GPU tier
requirement (a higher resolution raises the GPU tier bar), or priority weighting (price-first vs performance-first
reorders retention or diversity). Likely touched: load-query-input.js (add the columns back into the SELECT and the
input object, reversing Decision 17.6's ignore), possibly the scoring pipeline, retention ordering, or the
diversity selection, and the API's meta vocabulary (resolutions/priorities already exist there, just not consumed).
Migration needed: probably no table migration (the columns exist), but a decision is needed because the current
decision explicitly says they are ignored. Risk: very high — this is the change the current decisions set up as
"future, not now", and reversing it is a decision in its own right. Effort: M–L depending on where the effect lands.

### 5.3 Widen retention or the DFS cap so more pairs surface at a given budget

What changes: raise top_k_per_role (currently 5), or raise max_builds_per_query (currently 25), or lower the
per-pair cap (currently 3), so that at 30 000 more distinct (CPU,GPU) pairs survive to persistence. Likely
touched: retention/retain.js (top_k logic, Decision 27's reserved-slot logic too), assemble.js (the DFS cap is
max_builds_per_query), ranking/select-diverse.js (MAX_PER_PAIR), and the configuration contract
(scoring/configuration.js validates candidate_caps). Migration needed: no, these are configuration values.
Risk: more builds means more persisted rows and a different customer experience; the cap exists as a control, and
raising it has second-order effects on persistence volume and diversity. Effort: S (configuration + the one or two
consumers) but with a visible behavioral change.

### 5.4 Grow the catalog (more compatible variants so more pairs exist to surface)

What changes: add or fix products so that more GPU variants survive compatibility (e.g., resolve the 6 UNKNOWN
dimensions in OG-07, or add cards that are not GPU_TOO_THICK), so the retained set is not forced into the same
single pair. Likely touched: data seeds (GPU dimensions, possibly new cards), and no engine code unless a new
compatibility rule is involved. Migration needed: possibly yes if new spec columns or tables are needed (e.g., the
radiator-size gap OG-28 was closed by a migration 013 + seed 007); for dimensions it is a seed, not a migration.
Risk: the data-research work is the long pole (OG-07 is currently irreducible-by-more-of-the-same-search); the
engine may still collapse to one pair because of the caps. Effort: S for the engine side, L for the research side
if it must resolve OG-07.

---

## 6. Mismatches with decisions and the gap register

- Decision 17.6 says resolution/priority are accepted and IGNORED in v1, and the API route + api/src/meta.js
  say the same ("stored, not yet used in scoring"). This finding matches that: measured that they do not change
  assembled builds. No mismatch there; the decision is accurate.
- Decision 36 item 8 says resolution and priority are "NOT used in scoring" and that the API documents them as
  inert "because the engine does not read them (Decision 17.6)". This finding matches that too.
- The active model's configuration has only one use-case-aware field (gpu_required_use_cases) and its two values
  are identical for GAMING and WORKSTATION. This is consistent with the architecture/Decision 10/Decision 11
  framing of gpu_required_use_cases as the use-case lever. No mismatch.
- The gap register's existing entry for the schema side of priority is OG-22 ("recommendation_profile.priority
  INTEGER redesign (deferred in migration 011 notes)", FUTURE, OPEN, schema-migration). That row is about the
  schema/object design, not about whether use_case/resolution/priority affect ranking. It does not cover the
  behavioral gap measured here: that no non-test engine module reads any of the three, and that the only
  use-case effect is a single Rule-1 includes test against a list that is identical for the two supported values.
- This finding therefore adds one new register entry, OG-38 (IMPORTANT, OPEN), for that behavioral gap: that
  use_case / resolution / priority have no effect on ranking in v1, and the only thing separating GAMING from
  WORKSTATION is the includes test against an identical list. OG-22 covers the priority schema redesign; OG-38  covers the "these fields do nothing to results" behavior gap. The register was at 37 rows before this; it is 38
after this (the new row; verify-docs gap-register-shape gate re-run after writing confirms the count and the
shape: 6 cells per row, no literal pipe in cells 1–6, every cited OG id has a row).
- No decision cited here is contradicted by the evidence. The closest "future work" statements (Decision 17.6 and
  Decision 36 item 8) are confirmed rather than contradicted: they say these fields are inert today, and the
  measurement confirms it.

---

## 7. How this was checked (gates and raw results)

Run on Node 22 (the CI pin) as well as the default node (v24.21.0 here); both gave the same pass counts.

Part 1 gates (raw, captured this session):
- test:unit (node --test src/**/*.test.js): 950 tests, 0 fail, 0 cancelled, 0 skipped, 0 todo. (default node)
- test:scripts (node --test scripts/lib/*.test.js): 151 tests, 0 fail, 0 cancelled, 0 skipped, 0 todo. (default node)
- test:api (node --test apps/api/test/unit/*.test.js): 38 tests, 0 fail, 0 cancelled, 0 skipped, 0 todo. (default node)
- gen-decision-index --check: OK — docs/DECISION_INDEX.md is up to date. (default node)
- verify-docs --offline: OK — 37 rows, 6 cells each, every cited OG id has a row; decision counts 34 headings +
  5 nested = 36 global, 40 Status: lines; agents-decision-range "Decisions 1-36" cited.
- verify-docs --live: OK — 15 core tables present; products=100, variants=22, offers=101, assessments=280,
  build_candidates=0; schema-digest matches (8f2a845486839218).
- verify:replay --test-db: 0 drift (18 migrations replayed; fresh 362 tables / columns / checks / fks / indexes
  match live 362). TEST branch. (written test; no shared DB write)
- verify:pi1: PASS — 0 drifted of 25 pre-existing builds for GAMING and OFFICE; cleanup verified (probe product
  removed, measurement queries removed). TEST branch write test with remove-then-verify.
- TEST Layer 4 residue after the probes: recommendation_query=0, recommendation_profile=0,
  recommendation_result=0, build_candidate=0, build_component=0, build_rejection=0, recommendation_query_input
  absent (does not exist in this schema). All zero; the only live session is the residue probe itself.

Node 22 re-run of the same three suites: 950/0, 151/0, 38/0 — identical to default node.

No command in this session was skipped, and no test count was above zero without passing. The probe scripts are
under a .gitignore tempdir; they are not committed and are removed at the end of the session.

---

End of findings. Part 2 (the AGENTS.md learning pass and the tmp-*/ gitignore commit) is intentionally NOT done
here: the user asked to wait for the CI results before touching AGENTS.md. This document is the only deliverable
from this session's investigation.
