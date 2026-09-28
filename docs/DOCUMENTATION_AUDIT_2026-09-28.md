# Documentation Audit — docs vs. code vs. live database

**Date:** 2026-09-28
**Scope:** every documentation file in the repository, compared against the current source code and the current state of the shared Neon database.
**Method:** read-only. Each doc was read, its verifiable claims extracted, then checked against `src/**` (54 non-test modules), `scripts/**` (15 files), `database/migrations/**` (11 files), `database/seeds/**` (3 files), and live `information_schema` / `pg_constraint` / `pg_indexes` / row-count queries. `npm run test:unit` = **817 pass / 0 fail**.

**Files audited**

| File | Lines | Verdict |
|---|---|---|
| `AGENTS.md` | 167 | **sound** — the best-maintained doc in the repo; 2 additions suggested (§4) |
| `CONTEXT.md` | 158 | **sound** — audited and corrected earlier today (`e8d5bc7`); no new drift found |
| `DEVELOPMENT_NOTES.md` | 604 | **3 stale lines**, 1 missing session entry, 1 command-table inconsistency (D6, D7, D8) |
| `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` | 748 | **1 critical code-vs-doc gap** (D2), superseded-but-unmarked sections (D4), misleading status header (D4, D10) |
| `docs/RECOMMENDATION_ENGINE_DECISIONS.md` | 3,359 | **inverted status claim** (D3), not navigable (D5) |
| `database/LAYER4_RECONCILIATION_PLAN.md` | 240 | **false status header — the worst single finding** (D1) |

Headline: **12 findings**, of which **3 are serious** — a plan document that claims its own work was never done, an architecture document that prescribes four HARD safety rules no code implements, and a decision entry whose status line now asserts the exact opposite of the shipped code.

---

## 1. Findings

### D1 — `LAYER4_RECONCILIATION_PLAN.md` says its own work was never done · **CRITICAL**

> **RESOLVED 2026-09-28.** The status header now reads IMPLEMENTED with a per-item applied/deferred ledger; §5.4, §6.20 and §7 were corrected the same way. The §5.4 caveat itself (fresh `001→011` on an empty DB still unverified) remains open and is tracked as U1/F13 in the status review.

**The doc says:** `Status: **PROPOSAL — NOT IMPLEMENTED.** No database changes have been made. Migration 011 has NOT been created or applied.` (§5.4 repeats: "**NOT AVAILABLE.** No isolated scratch database (Docker, Neon branch, `TEST_DATABASE_URL`) exists.")

**Reality:** migration `011_reconcile_layer4.sql` exists, is committed, and **is applied to the live database**. Every blocking item the plan proposed is implemented — verified live:

| Plan item | Live state |
|---|---|
| §2.1 `build_component.price_checked_at` → TIMESTAMPTZ | `timestamp with time zone` ✔ |
| §2.1 all Layer 4 `created_at`/`updated_at` → TIMESTAMPTZ | all `timestamp with time zone` ✔ |
| §2.2 drop `build_component.category` | 0 columns named `category` ✔ |
| §2.3 `compatibility_status NOT NULL DEFAULT 'UNKNOWN'` | `NO` / `'UNKNOWN'::compatibility_status` ✔ |
| §2.4 `scoring_model_id NOT NULL` | `NO` ✔ |
| §2.5 price CHECKs `> 0` | `chk_build_component_selected_price_positive`, `chk_build_candidate_total_price_positive` ✔ |
| §2.6 store ⇒ `price_checked_at` CHECK | `chk_build_component_store_requires_checked_at` ✔ |
| §2.7 unique rank per query | `uq_recommendation_result_query_rank` ✔ |
| §2.8 singular role uniqueness | `uq_build_component_role_singular` ✔ |
| §2.9 the two `build_component` indexes | `idx_..._product_variant_id`, `idx_..._store_id` ✔ |
| §2.10 `idx_recommendation_profile_name` | present, UNIQUE ✔ |
| §2.11 (`store_offer_id`) · §3 (`priority`) | deliberately deferred — still deferred ✔ |

So **19 of the plan's 30 difference-table rows are implemented**, 2 are intentionally deferred, and the remaining 9 were KEEP classifications.
`DEVELOPMENT_NOTES.md` contradicts this file in the same repository: its "Layer 4 schema drift (2026-09-12)" entry correctly says 011 "applied and re-applied to confirm idempotency".

**Why this is the worst finding:** `AGENTS.md` §4 and §9 point agents at this file as the "Historical Layer 4 reconciliation record" and "Layer 4 reconciliation history". An agent that opens it and trusts the header will conclude Layer 4 is unbuilt and may attempt to write a duplicate reconciliation migration against a live schema — the exact failure mode `AGENTS.md` §7 warns about ("stale status has caused re-implementation attempts before").

**Fix:** retitle the status block to `IMPLEMENTED 2026-09-12 — migration 011 applied and catalog-verified` with a per-item applied/deferred ledger, or move the file to `database/archive/` with a one-line supersession header. Also correct §5.4 (a `TEST_DATABASE_URL` branch has existed since 2026-09-21).

---

### D2 — Architecture mandates four HARD rules that no engine code implements · **CRITICAL**

> **RESOLVED 2026-09-28 in the hybrid form this finding's own Fix line allowed (Decision 26).**
> The §5.2 HIGH-TGP connector escalation (row 5 below) is **IMPLEMENTED** — new reason code
> `GPU_PSU_CONNECTOR_NULL_HIGH_TGP`, `gpu.js` Rule 11, `board_tgp_watts` carried by
> `context-loader.js` + `filter.js`, inherited by Engine 3 with no assembly change. The other
> four rules are **EXPLICITLY DEFERRED** as unenforced, with inline markers at every architecture
> site, four new §16 gap rows, live-data evidence (0 violations today) and a binding seed-time
> re-check trigger. `AGENTS.md` §10 carries the same warning; see Decision 26 for the full ledger.

`RECOMMENDATION_ENGINE_ARCHITECTURE.md` states these as **HARD** (never-persist) constraints at §3.3, §5.3, §6 and §11 step 7. §3's definitive 11-item hard list omits all four of them — a separate doc-internal inconsistency surfaced by this verification and now flagged at `:17` and `:145` of that file:

| Rule | Architecture § | Implemented? |
|---|---|---|
| `cooler_spec.max_tdp_watts < cpu_spec.tdp_watts` → REJECT | §5.3, §3.3, §11.7 | **NO — DEFERRED** (Decision 26 item B; 0 live violations) |
| `cooler_spec.height_mm > case_spec.max_cpu_cooler_height_mm` → REJECT | §5.3 | **NO — DEFERRED** (Decision 26 item B; 0 live violations; cooler height known for only 5 of 9 coolers) |
| `ram_spec.module_count > motherboard_spec.dimm_slots` → REJECT | §6 | **NO — DEFERRED** (Decision 26 item B; was silent drift; 0 live violations) |
| total RAM capacity > `motherboard_spec.max_memory_capacity_gb` → REJECT | §6 | **NO — DEFERRED** (Decision 26 item B; was silent drift; 0 live violations) |
| high-TGP GPU (`board_tgp_watts >= 200`) + PSU connector count NULL → REJECT | §5.2 | **YES — IMPLEMENTED 2026-09-28** (Decision 26 item A: FAIL `GPU_PSU_CONNECTOR_NULL_HIGH_TGP`, decided before the unknown-name branch. The pre-2026-09-28 claim in this cell was misattributed — Rule 11's unconditional UNKNOWN was `gpu.js`'s own design, and Decision 23 never addressed the >=200W escalation) |

**Evidence:** a repo-wide search for `tdp` (case-insensitive) across all non-test JavaScript returns **zero matches**. `max_cpu_cooler_height_mm`, `dimm_slots`, `max_memory_capacity_gb` and `module_count` appear **only** in test-fixture scripts (`scripts/test-compatibility.js`, `scripts/verify-hardware-schema.js`) — never in `src/`. The columns all exist in the live schema (`cooler_spec: max_tdp_watts, height_mm`; `case_spec: max_cpu_cooler_height_mm`; `ram_spec: module_count, capacity_per_module_gb`; `motherboard_spec: dimm_slots, max_memory_capacity_gb`), and `gpu_board_spec.board_tgp_watts` **is now read by the connector rule** (Decision 26 item A, 2026-09-28: `board_tgp_watts` flows `context-loader.js` → `filter.js` → `gpu.js` Rule 11).

**Impact:** the engine's implemented pairwise set is 8 relationships (`cpu_motherboard`, `cooler_socket`, `motherboard_memory`, `platform_memory`, `case_form_factor`, `case_radiator`, `gpu_case`, `gpu_psu`). An under-spec CPU cooler, an over-height air cooler, an over-slot RAM kit, and an over-capacity RAM kit can all survive assembly and be persisted as a "compatible" build, contradicting the architecture's promise that "a build candidate must NEVER survive when a hard constraint is definitively incompatible".

**Measured impact on the live database (read-only `DATABASE_URL` queries, 2026-09-28) — the finding splits in two:**

* **Rows 1–4 (the deferred rules) are LATENT: 0 violating combinations today.** Coverage is complete for four of the five inputs — CPUs 18 (TDP known 18), cases 10 (cooler-height limit known 10), motherboards 7 (`dimm_slots` and `max_memory_capacity_gb` known 7), RAM kits 7 (`module_count` and `capacity_per_module_gb` known 7) — except cooler heights (known for only 5 of 9). Violations were counted BOTH over every catalog combination AND over the compatibility-reachable subsets (cooler↔CPU via non-FAIL `cooler_socket_support`; RAM↔motherboard with matching `memory_type_id`): **0** for all four rules, both ways. Nothing unsafe is persisted today; the risk is forward-looking, which is why Decision 26 accepts the deferral **with** a binding seed-time re-check trigger.
* **Row 5 is REACHABLE: 39 real (GPU, PSU) pairs.** 13 of 22 `gpu_board_spec` rows have `board_tgp_watts >= 200` (max 575 W) and all 13 require exactly `{"12vhpwr": 1}`; 3 of 11 `psu_spec` rows have `connector_12vhpwr IS NULL`. Before Decision 26 those pairs resolved UNKNOWN — which is **not** invisible: an UNKNOWN pair is allowed into an assembly (only FAIL is pruned, by Engine 3's Decision 16 gate) and, since Decision 23 O2, it counts toward the build-local `unknown_pairwise_count` penalty. The unsafe combination was therefore reachable-and-penalized, not merely unverified. Note also that "no PSU connector row exists at all" is not the failure mode here: the NULLs are **per-column**, which is exactly why Decision 26 escalates per-connector NULL availability rather than requiring the whole map to be NULL.

**Documented deferral — in two halves, only one of them honest (corrected 2026-09-28):** the cooler half was NOT silent. The Engine 1 readiness contract in `RECOMMENDATION_ENGINE_DECISIONS.md` ("Derived checks: GPU↔case, GPU↔PSU (wattage + connector subset), cooler TDP/height — NULL on either side = UNKNOWN, never 'unlimited'") names it, and `database/seeds/002_catalog_expansion.sql` D5 records it as deliberate forward-looking data ("seeded but NOT consumed by any engine code today … forward-looking data, not enforcement"). Because the readiness contract promised the check, the cooler half is **contract-violating drift**, not a permitted omission. The RAM half (rows 3–4) **was** silent: no decision, no seed note and no code comment mentioned it anywhere until Decision 26 item B. Both halves are now recorded in Decision 26 as unenforced, with `AGENTS.md` §10 carrying the agent-facing warning.

**Fix:** either implement the four rules (each is a small pure function plus one `PAIRWISE_CHECKS` entry — note the two cooler rules need a `CPU_COOLER ↔ CASE` height check and a `CPU_COOLER ↔ CPU` TDP check, and the RAM rules need `RAM ↔ MOTHERBOARD` slot/capacity inputs), or record a decision that explicitly defers them and downgrade them from HARD to unenforced in the architecture doc. Do not leave the doc asserting safety the engine does not provide.

> **Outcome 2026-09-28 — Decision 26 (hybrid; the finding's second option for the four rules, the first option for row 5).** Row 5 (the §5.2 HIGH-TGP escalation) was IMPLEMENTED as a small rule change in `gpu.js` Rule 11 plus the `board_tgp_watts` pass-through from `context-loader.js`/`filter.js`. The other four rules are EXPLICITLY DEFERRED and downgraded to unenforced with inline markers at every architecture site (§2 stage 6, §3 item 9, §3.3, §5.2, §5.3, §6, §11 steps 3/7, §16, §17, §18) and four new §16 IMPORTANT/latent gap rows. Unit tests 817 → 829, 0 failures. What remains open is deliberately time-bounded: the four rules are a recorded deferral with a seed-time re-check trigger, not a code-defect backlog item.

---

### D3 — Decision 22's status line is now inverted · **HIGH**

> **RESOLVED 2026-09-28. Decision 22 now carries a truthful Status line plus an implementation-record UPDATE block; the two inverted grounding sentences are struck.**

**The doc says** (`DECISIONS.md:2704`): `Status: RESOLVED 2026-09-24. Documentation only: no code, no migration, no commit. Records the Engine 6 (explanation generation) contract; implementation is future work against this contract.` Its grounding paragraph adds that "`persist-ranked.js` hard-codes `explanation` to `null`, ignoring `entry.explanation`; `validate-selected.js` never reads or validates the field".

**Reality** — both statements are now the reverse of the shipped code:
- `persistence/persist-ranked.js:24` inserts `explanation` as `$5`; line 87 passes `entry.explanation`; line 8 documents it.
- `persistence/validate-selected.js:6` says "Decision 22 item 5: entry.explanation is REQUIRED non-empty string", with explicit failures at lines 131–135.

Engine 6 is implemented and wired (`explanation/explain.js`, called from `orchestrator/full-run.js` between `selectDiverseTop` and `runRecommendationCommit`).

`AGENTS.md` §10 already warns that Engine 6 status is stale in prose — but only generically. An agent reading Decision 22 as the contract will find a "known missing field" that is in fact required and populated, and may try to implement `computeBuildScoreContributions` wiring or the explanation binding a second time. Note also that Decision 19.7's premise ("Engine 4 will later need to expose score contributions") is resolved by Decision 22 item 1, which is implemented.

**Fix:** append an `UPDATE 2026-09-24 (implementation)` block to the Decision 22 entry recording that items 1–5 landed, and strike the two inverted sentences from the grounding paragraph.

---

### D4 — Architecture's status header and superseded sections are unmarked · **HIGH**

> **RESOLVED 2026-09-28. ARCHITECTURE.md now opens with a supersession notice table and carries inline SUPERSEDED BY DECISION 18 markers at its stage table, S11 cap and S13 rank wording; the templates-versioning claim is struck inline.**

**The doc says** (line 4): `Status: ARCHITECTURE REVIEW ONLY. No engine code, no schema changes, no seeds. Date: 2026-09-12 … It is the contract that Engines 1-6 (section 17) must implement against.`

**Reality:** all six engines are implemented; the doc cross-references **only Decisions 1–3 and 5–9** — nothing from Decision 10 onward. Four concrete divergences between this doc and shipped code:

| Architecture claim | Shipped behaviour |
|---|---|
| §2 stage table + §13: "`recommendation_result.rank` is assigned at stage 9, **after persistence**" | `rankBuilds` runs **before** the single write transaction (`full-run.js`: snapshot → rank → select → explain → commit) |
| §13 third sort key: "candidate created order / candidate id ASC" | `build_score DESC → total_price ASC → **signature** ASC` (Decision 18.3, code-unit compare) |
| §13: "Generation order and templates are part of Engine 6 and **versioned with the scoring model**" | templates are code constants in `explanation/explain.js`; nothing versions them with the model |
| §11: "A hard cap (configuration) limits assembled builds per query (e.g. **500**)" | shipped `max_builds_per_query` = **25** |

Tellingly, `DECISIONS.md:2358` (Decision 18, item 7) already records this: *"**Supersedes** the architecture doc's stage-9 wording… and its stage table placing build scoring before assembly. The architecture doc is NOT edited here (refresh deferred); the supersession is recorded here only."* So the divergence is a **recorded, deliberate deferral** — but it is invisible to anyone starting from the architecture doc, which is exactly where `AGENTS.md` §2 tells agents to start.

**Fix:** a short status block under the title listing 011/Engine-status/decision coverage, plus inline `SUPERSEDED BY DECISION 18` / `DECISION 12` / `DECISION 23` markers at §2, §11, §13. No rewrite needed.

---

### D5 — The decision log is not navigable · **HIGH**

> **RESOLVED 2026-09-28.** `docs/DECISION_INDEX.md` now exists (generated by `scripts/gen-decision-index.js`, `npm run gen:decisions`, with a `--check` staleness gate that exits non-zero when the committed index is stale), and the decision log carries a normalized `Status:` line as the first content line of **every** decision entry: 30 `^Status:` lines (24 `## Decision` + 5 Engine-3-local `### Decision` + the Decision 18 addendum), **0** `^### Status:` headings (was 1 + 12). The generator hard-fails when an entry lacks its `Status:` line, so the index cannot go silently wrong — the old heuristic form (which reported global Decision 4 as `UNKNOWN`) is gone. The preamble gained a navigation block (index pointer, the 4/5 numbering quirk, and the "TBD only appears in history" note). `package.json` gained `gen:decisions`.

`DECISIONS.md` is 3,359 lines / 200 KB and is the repository's most important behavioural document. Problems, all verified:

1. **No index.** The preamble (lines 1–97) is a narrative of dated updates that stops at **Decision 11 (2026-09-17)** — Decisions 12–25 are never announced in it.
2. **Numbering is not machine-discoverable.** `grep "^## Decision"` returns **23 headings for 25 decisions**: Decisions 4 and 5 exist only as `### Decision 4 …` / `### Decision 5 …` nested under `## Engine 3 contract decisions (2026-09-14)`. Sections also exist with no decision number at all (`## Engine 1 readiness`, `## Engine 2C decision`, `## Engine 2D / Engine 3 boundary`).
3. **Almost no status lines.** Exactly **one** line in the entire file begins with `Status:` (Decision 22's, and that one is wrong — D3). Every other status lives in a heading suffix like `(RESOLVED 2026-09-24)`, so "which decisions are open?" is not answerable by grep.
4. **A retroactive `TBD - not yet decided` vocabulary** (lines 52, 1680, 1702, 1805, 1921, 1939) is used for stubs later resolved in place, so a search for `TBD` returns only history.

**Fix:** a `docs/DECISION_INDEX.md` (or an index table at the top of DECISIONS.md) with one row per decision: number, title, status, date, and the heading's line number; plus a normalized `Status:` line as the second line of every decision. Generate it with a script so it cannot drift.

---

### D6 — `DEVELOPMENT_NOTES.md`: three stale lines · **MEDIUM**

> **RESOLVED 2026-09-28.** All 5 table rows fixed in `DEVELOPMENT_NOTES.md`: seed-003 UPDATE appended to the 2026-09-25 resolution bullet (commit `4e70f9e`); test count 724 → 829; commit/push notes annotated as superseded (`59dc0a3`, `fe2a816` pushed to `origin`; `864905a`, `8127ea0` committed locally, ahead of `origin/master` as of 2026-09-28); `.kilo` noise converted to dated history (path absent, tree clean); `test-layer3.js` table row now carries the `--verify --functional` + empty-table precondition. The audit's own truth-line 817 is corrected to 829 inline below.

| Where | Stale claim | Truth |
|---|---|---|
| 2026-09-25 entry, "Resolution needed" | "O2 … implemented; **O1 seed 003 pending**" | seed 003 was applied 2026-09-28 (Decision 23 O1) |
| TESTING LESSONS | "`npm run test:unit` … **724 tests as of 2026-09-22**" | 829 as of 2026-09-28 (817 at audit-run time, superseded the same day by Decision 26's 817→829) |
| VERIFIED COMMANDS + GIT LESSONS | "commit and push commands were **NOT executed** in this session… not re-verified" | commits and pushes have since been executed and verified repeatedly |
| GIT LESSONS / KNOWN WORKING TOOLS | "untracked `.kilo/kilo.jsonc` (tool config — keep out of commits)" | not present; `git status` is clean |
| VERIFIED COMMANDS table | `node scripts/test-layer3.js` marked re-run-safe with no flags | its own TESTING LESSONS bullet (and `AGENTS.md` §6) require `--verify --functional`; a bare run executes only the preflight |

---

### D7 — `DEVELOPMENT_NOTES.md` has no entry for the last three sessions · **MEDIUM**

The file's own **DOCUMENTATION UPDATE RULE** requires an entry per significant session. Missing: seed 003 (Decision 23 O1 — 20 GPU + 9 PSU rows, 29 cited source URLs, idempotency proof), the Decision 20 seed-size reconciliation, Decisions 24–25, the `measure-orchestrator.js` O1 acceptance section and its moved preflight (15 products → 100), and the `CONTEXT.md` audit.

### D8 — Documented DB commands cannot run against the shared database · **MEDIUM**

`scripts/test-layer3.js` and `scripts/test-layer4.js` still read `process.env.DATABASE_URL`; no `scripts/lib/db-url.js` guard. `DEVELOPMENT_NOTES.md` correctly notes `test-layer4.js` "targets DATABASE_URL, not yet migrated to the `TEST_DATABASE_URL` guard", but neither doc records the operational consequence now that the shared DB holds data: **`test-layer3.js` requires the three Layer 3 tables to be empty**, and the shared database now holds 101 `store_offer` and 101 `price_history` rows. The command `AGENTS.md` §6 lists (`node scripts/test-layer3.js --verify --functional`) therefore cannot pass against `DATABASE_URL` today. Guard status per script:

| Guarded (`TEST_DATABASE_URL`) | Unguarded (`DATABASE_URL`) |
|---|---|
| `measure-orchestrator.js`, `test-orchestrator-commit.js`, `test-orchestrator-full-run.js` | `run-migrations.js`, `run-seeds.js`, `test-compatibility.js`, `test-db.js`, `test-layer3.js`, `test-layer4.js`, `verify-*.js` (4) |

### D9 — Layer 4 plan §5.4 and the "no isolated DB" claim · **MEDIUM** (part of D1)

`LAYER4_RECONCILIATION_PLAN.md` §5.4 and `DEVELOPMENT_NOTES.md`'s "No isolated fresh-migration environment" entry both say no Neon branch / `TEST_DATABASE_URL` exists. A branch has existed since 2026-09-21 and is used by three scripts today. The *fresh 001→011 migration* remains genuinely unverified — only the reason stated ("no isolated database exists at all") is now wrong.

### D10 — No applied-migration tracking; the workaround is documented but the gap is not owned · **LOW**

`run-migrations.js` re-executes every file and `002_enums.sql` uses a bare `CREATE TYPE`, so the runner is single-use. Confirmed live: **no `schema_migrations`-style table exists** (`information_schema` returns none). Both `DEVELOPMENT_NOTES.md` and `AGENTS.md` document the workaround (apply files individually via a throwaway script) — good — but no doc records this as a **tool defect worth fixing**, and the missing tracking table is absent from `ARCHITECTURE.md` §16's gap table.

### D11 — `ARCHITECTURE.md` §9's policy has an unrecorded consequence · **LOW**

§9 says an unevidenced product "can NEVER tie a well-tested one" — true. What the doc does not anticipate is that unevidenced products tie **each other** at exactly `neutral_baseline − no_evidence_penalty` (40.000), which is the root cause of the Decision 23 score degeneracy and of the UUID-dependent retention reach. Worth a one-line pointer from §9 to Decision 23.

### D12 — `AGENTS.md` command table omits two preconditions · **LOW**

`test-layer3.js` needs `--verify --functional` (its flags) *and* empty Layer 3 tables; `verify-hardware-schema.js` is broken (already flagged in §10). Add the empty-table precondition to §6/§7.

---

## 2. Claims verified as correct (so they need no action)

> **Note added 2026-09-28 (post-audit):** the two bullets below that cite the "decision pointers through 25" and the "Decision 1–25 range" were correct when this audit ran. Decision 26 was adopted the same day, so those ranges are now **1–26** in `CONTEXT.md` and `AGENTS.md`.

- **`CONTEXT.md`** — all counts (100 products / 22 variants / 101 offers / 76 families / 25 assessments), the benchmark names (`Seed TechPowerUp`, `Seed Cinebench R23 Multi`), the Layer 4 empty-table status, GPU connector coverage (22/22), and the decision pointers through 25. Zero new drift.
- **`AGENTS.md`** — the source-of-truth precedence table, the read-in-this-order list, the guard rules, and the Decision 1–25 range all hold.
- **`ARCHITECTURE.md` §1** — every schema statement (one-to-one spec tables, the five compatibility tables, presence-only tables, Layer 4 columns, index and CHECK names) matches the live database exactly.
- **`ARCHITECTURE.md` §3.2/§4.4** — the liquid-cooler-with-zero-radiator-rows REJECT **is** implemented (`compatibility/case-radiator.js`, rule 5), and the live data makes it bite: `case_radiator_support` holds 7 rows covering only 4 of 10 cases.
- **`ARCHITECTURE.md` §16 gap table** — the three IMPORTANT gaps (dual-memory motherboard, presence-only statuses, no rejection-reason persistence) remain open and correctly classified; no new BLOCKING gaps found.
- **`ARCHITECTURE.md` §5.2 "no currency conversion"** — matches code; `currency` is propagated, never converted.
- **`DEVELOPMENT_NOTES.md`** — the Neon-branch lesson, the timestamp double-conversion pitfall, the `deepFreeze` pre-freeze pitfall, `round2` shortest-decimal half-up, the `test-compatibility.js` cleanup-ordering rule, and the `verify-hardware-schema.js` brokenness warning are all still accurate and still useful.
- **`DECISIONS.md`** — Decisions 20's SEED-SIZE NOTE and the Decision 23/24/25 entries match the live database and code.
- **`AGENTS.md` §5** — "determinism is a requirement" is stated honestly; the UUID tie-break (D11-adjacent) is the one place the requirement is unmet, and it is recorded in Decision 23's amendment.

---

## 3. Why this drift keeps happening

Three structural causes, in order of impact:

1. **Status is restated in five places and owned by none.** `AGENTS.md`, `CONTEXT.md`, `DEVELOPMENT_NOTES.md`, `ARCHITECTURE.md` and `DECISIONS.md` each carry their own copy of "what exists", and each was written at a different point in time. Nine of the twelve findings above are instances of this single cause.
2. **Decisions supersede docs without editing them.** Decision 18 item 7 says so in writing ("refresh deferred"). That is a legitimate short-term choice, but with no supersession marker in the superseded file, the deferral becomes invisible.
3. **Nothing mechanically checks the prose.** There is no CI, no lint, no doc assertion script. Every drift instance found in the last two sessions (`AGENTS.md` decision range, `CONTEXT.md` benchmark names, Engine 6 status, the resolved `DECISION REQUIRED`, the GPU/PSU gap list, and all 12 findings here) was found by hand.

---

## 4. Files to add — optimizing the repository for AI agents

The repository already does the hard part well: `AGENTS.md` is a genuine index with a precedence table and a known-drift section, `CONTEXT.md` is short and status-focused, and module `index.js` headers carry local contracts. What is missing is **derived, drift-proof, machine-checkable structure**. Recommended additions, ordered by value:

### A1. `docs/DECISION_INDEX.md` (generated) — **HIGH**
Table of every decision: number, title, status, date, `DECISIONS.md` line anchor. Retires D5 and makes "is X decided, and how?" a one-lookup operation on a 3,359-line file. Generator: `scripts/gen-decision-index.js` parsed from the existing headings plus a normalized `Status:` line.

### A2. `scripts/verify-docs.js` + `.github/workflows/ci.yml` — **HIGH**
Assert the fact-shaped claims in `CONTEXT.md` and `AGENTS.md` against the live database and the code tree: table count, migration range, row counts, empty-table claims, decision range, engine-module presence per status bullet. Run it with `npm run test:unit` on push. This is the single change that stops §3 cause 3, and it is the only thing that keeps the other recommendations honest.

### A3. `docs/OPEN_GAPS.md` — **HIGH**
One register consolidating `ARCHITECTURE.md` §16, `002_catalog_expansion.sql` D1–D8, `ARCHITECTURE.md` §18's future list, and this audit's D1–D12 — each with an owner, a class (BLOCKING / IMPORTANT / ACCEPTABLE / FUTURE), and a status. Today "what is still open?" requires reading four documents that disagree about the answer (e.g. GPU connectors appear as an open gap in one and closed in another).

### A4. `database/ARCHIVE.md` (or move the plan to `database/archive/`) — **HIGH, cheapest**
Retire `LAYER4_RECONCILIATION_PLAN.md` from the active doc set with a one-line supersession header, or add a `Status` block that lists implemented vs deferred items. Fixes D1 with a five-minute edit.

### A5. `docs/SCHEMA_REFERENCE.md` (generated from `information_schema`) — **MEDIUM**
Per-table column/type/nullable/default/PK/FK/index/CHECK listing, plus the enum vocabularies. `AGENTS.md` §9 correctly says migrations are the authoritative source, but column-level truth currently requires reading 11 SQL files to answer "does this column exist?" — the question that produced finding D2. Generated by a script, so it cannot drift.

### A6. `docs/GLOSSARY.md` — **MEDIUM**
The vocabulary is load-bearing and scattered across 25 decisions: `PASS | FAIL | UNKNOWN | CONDITIONAL`, verdict / pair / relationship / `unknown_pairwise_count`, build candidate, retention, `top_k_per_role`, `max_builds_per_query`, pair value, `MAX_PER_PAIR`, O1/O2, PI-1, K, "no-evidence branch", `priceKey`, plus the decision-id convention (`D2` = seed decision vs `Decision 2` = engine decision — a collision that already caused one recorded correction in `DECISIONS.md:2810`).

### A7. `docs/TEST_MAP.md` — **MEDIUM**
Which test pins which contract, in both directions: the null-vs-0 contract (`filter.test.js` "null is never 0"), `round2` half-up, `deepFreeze` ordering, boundary `require()` allow-lists, `uq_build_component_role_singular`, the commit re-run guard. This turns "is it safe to change this?" into a lookup, and it is what let the Decision 23 O2 work proceed confidently.

### A8. `docs/RECIPES/*.md` — **MEDIUM**
Task-shaped checklists instead of prose: *add a migration*, *add a seed*, *add a scoring-model version*, *add a pair evaluator (and where its topology is declared twice)*, *add a pipeline stage*, *add an agent-visible status claim*. Each 15–30 lines, each ending with the exact verification commands. This is the highest-leverage format for agents and complements `AGENTS.md`'s index role.

### A9. `docs/DATA_STATE.md` (generated) — **MEDIUM**
Current live-DB state: row counts per layer, assessment coverage (25 of 100 products), connector/dimension coverage, Layer 3/4 emptiness, offer freshness (3–10 days). Retires the "which figures are instance-specific?" problem, and pairs with a one-line warning that retention reach depends on random UUIDs.

### A10. `docs/decisions/TEMPLATE.md` — **LOW**
A decision entry skeleton: `Status:` line, date, context, decision, rejected alternatives, evidence (file:line), supersedes/superseded-by. Prevents the current heterogeneity (some entries have `Status:`, some encode it in the heading, some are `TBD` stubs resolved in place).

### A11. `CLAUDE.md` / `.cursorrules` → `AGENTS.md` — **LOW**
One-line pointer files so other agent tools find the same single entry point rather than creating a second competing instruction file.

### A12. `AGENTS.md` additions — **LOW, do immediately**
Two short entries: (a) the CRLF convention (root `AGENTS.md` and `database/` + `docs/` files are CRLF; seeds are CRLF; a new file must match or diffs churn) and (b) "measurement/reach figures are instance-specific — retention ties fall through to random `product.id`" plus "`run-seeds.js --dry-run` counts statements with a naive `split(';')`, so a semicolon inside a comment inflates the count".

---

## 5. Prioritized fix order

| Order | Action | Retires |
|---|---|---|
| 1 | Correct or archive `LAYER4_RECONCILIATION_PLAN.md`'s status header | D1, D9 |
| 2 | Decide and record the four unimplemented HARD rules — implement or explicitly defer them in `ARCHITECTURE.md` and a decision entry | D2 — **DONE 2026-09-28**: Decision 26 (row 5 implemented; the four cooler/RAM rules explicitly deferred and marked unenforced at every site) |
| 3 | Append the implementation update to Decision 22 and strike its two inverted sentences | D3 |
| 4 | Add the status/supersession header to `ARCHITECTURE.md` with inline markers at §2/§11/§13 | D4, D11 |
| 5 | Add `docs/DECISION_INDEX.md` + normalized `Status:` lines | D5 — **DONE 2026-09-28**: generated index (24 global + 5 Engine-3-local rows, Date column, Open-decisions section, `--check` staleness gate) + a normalized `Status:` line as the first content line of all 29 decision entries (30 with the addendum); generator hard-fails when one is missing |
| 6 | Refresh `DEVELOPMENT_NOTES.md` (three stale lines + a 2026-09-28 entry) | D6, D7 — **D6 DONE 2026-09-28** (5 rows fixed, this session); D7 entry backlog still open |
| 7 | Record the Layer 3 empty-table precondition for `test-layer3.js`; note guard coverage | D8, D12 |
| 8 | Add `scripts/verify-docs.js` + CI | §3 causes 1–3 |
| 9 | Add `docs/OPEN_GAPS.md`, `docs/SCHEMA_REFERENCE.md`, `docs/GLOSSARY.md`, `docs/TEST_MAP.md`, `docs/RECIPES/` | ongoing drift |

Items 1–4 are documentation edits measured in minutes and remove all three CRITICAL/HIGH correctness hazards. Items 8–9 are the structural fix that makes the next audit trivial instead of manual.

**Status 2026-09-28 (end of day):** items **1–5 are DONE** — D1 (`LAYER4_RECONCILIATION_PLAN.md` header + §5.4/§6.20/§7, commit `59dc0a3`), D2 (this finding; Decision 26 hybrid — row 5 implemented, the other four rules recorded as explicit unenforced deferrals), D3 (Decision 22 UPDATE block, `fe2a816`), D4 (ARCHITECTURE supersession notice + inline markers, `fe2a816`, extended by `676973b`/`6c69baa`) and D5 (item 5: `docs/DECISION_INDEX.md` generated by `scripts/gen-decision-index.js` + `npm run gen:decisions` with `--check`, normalized `Status:` lines on all 29 decision entries (30 `^Status:` lines with the Decision 18 addendum), navigation block in the decision log preamble, pointers in `AGENTS.md`/`CONTEXT.md`) and D6 (item 6, D6 half: the 5 stale `DEVELOPMENT_NOTES.md` rows fixed, this session — see the D6 banner). Items 7–9 remain open: item 6 is partially served by the 2026-09-28 `DEVELOPMENT_NOTES.md` entry while the D7 entry backlog remains.
