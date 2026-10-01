# OPEN_GAPS — consolidated open-gap register

**Date:** 2026-09-29 (last revised 2026-10-01) · **Audit ref:** A3 / fix-order item 9 · **Owner:** docs

**Purpose:** one place that answers "what is still open?" — today that question
requires reading four documents that disagree with each other.

**Sources consolidated** (each remains authoritative in its own domain; this
file is a *register*, not a source of truth — see `AGENTS.md` §9):

1. `docs/RECOMMENDATION_ENGINE_ARCHITECTURE.md` §16 (gap table) and §18 "Future / non-blocking"
2. `database/seeds/002_catalog_expansion.sql` header decisions D1–D8
3. `docs/DOCUMENTATION_AUDIT_2026-09-28.md` findings D1–D12 and recommendations A1–A12
4. Cross-reference only, NOT duplicated: `docs/PROJECT_STATUS_REVIEW_2026-09-28.md` registers K1–K16 / U1–U13

**Vocabulary**

- **Class** (audit A3 spec): `BLOCKING` / `IMPORTANT` / `ACCEPTABLE` / `FUTURE`. `IMPORTANT (latent)` = declared important but 0 live violations today.
- **Status**: `OPEN` (action possible now) / `DEFERRED` (recorded, binding re-check trigger) / `UNVERIFIED` (never measured) / `CLOSED` (resolved; see the closed tables).
- **Owner**: `data-research` / `engine-code` / `schema-migration` / `tooling` / `docs` / `—` (accepted, no action planned).

Abbreviations in Source: `ARCH §n` = architecture doc section; `002 Dn` = seed 002 header decision; `audit Dn` / `An` = audit finding / recommendation; `Dec N` = decision log.

---

## 1. Open register

| ID | Gap | Class | Status | Owner | Source(s) |
|---|---|---|---|---|---|
| OG-01 | Real `component_assessment` research for the 85 seed-002 products was never supplied. 85/100 products score the flat no-evidence 40.000 and are mostly unreachable (`top_k_per_role = 5`; only 2 GPUs / 3 PSUs from the expansion reach a build; which ones survive is UUID-random). Must be OBTAINED, never invented; a later seed must cover every `role_weights[role]` type with fresh `assessed_at` and non-NULL confidence. **PROGRESS 2026-09-30:** the research plan exists and batch 1 (20 GPU + 9 PSU × 3 types = 87 rows) is AUTHORED as `database/seeds/004a_component_assessments_gpu_psu.sql`. **PROGRESS 2026-10-01:** seed 004a is **APPLIED to the shared DB** (25 → 112 assessment rows, idempotent re-run verified as no-op for these pairs) and **MEASURED** (read-only pipeline replication against shared DB, TEST_DATABASE_URL branch being unreachable — see DEVELOPMENT_NOTES 2026-10-01): all 5 retained GPU slots are 004a-scored new GPUs (ASUS 5070 Ti PRIME, 3× RTX 5080, 5070 GAMING TRIO) and the 5 retained PSUs (RM850e/RM1000e/A750GL×2/RM750e) are score-determined and UUID-independent; 57 of 101 pool candidates still score the flat 40.000 — exactly the batch-2 roles. Remaining: batch 2 = 56 products / 168 rows (CPU 16, MB 5, RAM 5, SSD 15, CASE 8, COOLER 7) as `004b`, then apply → re-measure reach. **The measurement environment is restored (2026-10-01):** `TEST_DATABASE_URL` was re-created (`ep-weathered-art-...`, canonical catalog re-seeded) and all three guarded harnesses re-verified green (`test-orchestrator-full-run.js` 28/0; `measure-orchestrator.js` Decision-20 criteria 1+2 MET for GAMING and OFFICE) — batch 2 can follow the original branch-first workflow again. | **BLOCKING** | OPEN | data-research | 002 D2 (amended 2026-09-28, + partial-fix note 2026-09-30); CONTEXT.md; status review K1 / Option A; **plan: `docs/OG-01_ASSESSMENT_RESEARCH_PLAN.md`**; batch 1 seed `database/seeds/004a_component_assessments_gpu_psu.sql`; gate: `scripts/check-og01-coverage.js` (reports 56 products / 168 rows, exit 1, as of 2026-10-01; was 85/255 pre-004a) |
| OG-02 | Single `motherboard_spec.memory_type_id` cannot represent boards supporting DDR4 AND DDR5 → possible false rejections | **IMPORTANT** | OPEN | schema-migration | ARCH §6/§16/§18 |
| OG-03 | Presence-only tables (`case_motherboard_form_factor`, `case_radiator_support`, `platform_memory_support`) cannot store FAIL/UNKNOWN/CONDITIONAL explicitly; asymmetric UNKNOWN policy mitigates | **IMPORTANT** | OPEN | schema-migration | ARCH §3.2/§16/§18 |
| OG-04 | No rejection-reason persistence — rejected combos are invisible; limits "why was nothing recommended?" debugging | **IMPORTANT** | OPEN | schema-migration | ARCH §16/§18 |
| OG-05 | Case radiator matrix missing for 6 of 10 cases → every liquid cooler is a HARD FAIL there (load-bearing per 002 D4; only 2 researched cases have documented positions) | **IMPORTANT** | OPEN | data-research | 002 D4; status review K5 |
| OG-06 | Seed-002 assessment-era prices are UNVERIFIED (companion aggregator prices differ materially; no offer-level unique key, so a correction INSERTs a second offer instead of updating) | **IMPORTANT** | OPEN | data-research | 002 D1 |
| OG-07 | 7 GPU variants have NULL `width_slots` / `height_mm` → GPU↔case thickness resolves UNKNOWN (seed 003 closed the connector half of 002 D6 but not dimensions) | **IMPORTANT** | OPEN | data-research | 002 D6 residue; CONTEXT.md |
| OG-08 | 4 PSU rows carry deliberately NULL connector counts: `Seed Antec G850`, `Seed Connect PSU 850`, `Seed HYBROK PSU 650` (all four of EPS / PCIe-8pin / 12VHPWR / SATA — unverified vendor specs, 002 D2 strict-gate) and `Seed MSI MAG A750GL PCIE5 750W` (EPS only — msi.com returns HTTP 403 to automated fetches, so seed 003 pinned the SKU and filled the other three; see 003 header). After Decision 26 a required-connector NULL on a ≥200 W-TGP pair FAILs conservatively — safe direction, but a false-negative risk. (Count corrected 2026-10-01 from "3": the register under-counted; live-verified by the NULL-scan behind this row's verification.) | **IMPORTANT** | OPEN | data-research | CONTEXT.md; Decision 26; seed 003 header D7 |

| OG-09 | Cooler `max_tdp_watts` vs CPU `tdp_watts` REJECT — no code reads the column | **IMPORTANT** (latent) | DEFERRED | engine-code | ARCH §5.3/§16; Decision 26 item B; 0 live violations 2026-09-28 — re-check before any cooler/CPU seed |
| OG-10 | Air-cooler `height_mm` vs `case_spec.max_cpu_cooler_height_mm` REJECT — height known for only 5 of 9 coolers | **IMPORTANT** (latent) | DEFERRED | engine-code | ARCH §5.3/§16; Decision 26 item B; 0 live violations — re-check before any cooler/case seed |
| OG-11 | RAM `module_count` vs `motherboard_spec.dimm_slots` REJECT (was silent drift until Decision 26) | **IMPORTANT** (latent) | DEFERRED | engine-code | ARCH §6/§16; Decision 26 item B; 0 live violations — re-check before any RAM/motherboard seed |
| OG-12 | Total RAM capacity vs `motherboard_spec.max_memory_capacity_gb` REJECT | **IMPORTANT** (latent) | DEFERRED | engine-code | ARCH §6/§16; Decision 26 item B; 0 live violations — re-check before any RAM/motherboard seed |
| OG-13 | Fresh `001→011` migration on an empty database has never been run (a `TEST_DATABASE_URL` branch has existed since 2026-09-21 — only the empty-DB run is outstanding) | ACCEPTABLE (environmental) | CLOSED 2026-09-30 | tooling | **RAN AND VERIFIED 2026-09-30** on a throwaway Neon DB (emptied to 0 tables / 0 enums, then all 11 migrations applied in order, zero errors). Structural diff vs live: tables 39/39, columns 336/336, enums 14/14 identical. Found 3 real drifts — all **live-has-more** (the migrations are the incomplete side, never the reverse): (1) 3 benchmark CHECKs stricter live (`sample_size`/`resolution_width`/`resolution_height` lose the `IS NULL OR` escape hatch — live enforces `> 0` even for NULLs), (2) `chk_benchmark_result_metric_value_finite` exists only live, (3) 5 performance indexes exist only live (`idx_benchmark_source_name` UNIQUE, `idx_benchmark_source_id`, `idx_component_assessment_product_id`, `idx_scoring_model_active`, `idx_component_assessment_type`) — none documented in any migration or doc; provenance unknown (pre-migration manual work or a lost migration). Verdict: fresh replay is **faithful for every engine-relevant structure**; the drift is benchmark-table hardening + indexes, recorded as the schema-drift finding below. See closed table C-15 |
| OG-14 | No applied-migration tracking; `run-migrations.js` is single-use (`002_enums.sql` bare `CREATE TYPE`). Workaround: apply new files individually | ACCEPTABLE (tool defect) | OPEN | tooling | ARCH §16; audit D10 |
| OG-15 | iGPU requirement limited to the `integrated_gpu_present` BOOLEAN; no performance tiering | ACCEPTABLE | OPEN (accepted) | — | ARCH §16 |
| OG-16 | CONDITIONAL semantics exist only in `cpu_motherboard_support` (via `min_bios_version`) | ACCEPTABLE | OPEN (accepted) | — | ARCH §16 |
| OG-17 | Assessment coverage sparse at seed time (handled by the ARCH §9 no-evidence policy) | ACCEPTABLE | OPEN (mitigated) | — | ARCH §16 — root cause tracked as OG-01 |
| OG-18 | No engine-version column on results (`scoring_model` version + explanation cover configuration) | ACCEPTABLE | OPEN (accepted) | — | ARCH §16 |
| OG-19 | `seller_name` / `product_url` stay NULL (research captured category-level links only) | ACCEPTABLE | OPEN | data-research | 002 D8; CONTEXT.md |
| OG-20 | Multi-currency recommendations — no conversion infrastructure | FUTURE | OPEN | engine-code | ARCH §7/§16/§18 |
| OG-21 | `store_offer_id` provenance FK on `build_component` (snapshot columns suffice today) | FUTURE | OPEN | schema-migration | ARCH §15/§16/§18 |
| OG-22 | `recommendation_profile.priority` INTEGER redesign (deferred in migration 011 notes) | FUTURE | OPEN | schema-migration | ARCH §16/§18 |
| OG-23 | Multi-GPU assembly — listed in §18's future list but ABSENT from the §16 gap table (omission recorded here) | FUTURE | OPEN | engine-code | ARCH §18 only |
| OG-24 | Audit fix-order item 9 remainder: `docs/SCHEMA_REFERENCE.md`, `docs/GLOSSARY.md`, `docs/TEST_MAP.md`, `docs/RECIPES/` not yet created (A5–A8) | **IMPORTANT** | CLOSED 2026-09-29 | docs | Created: `SCHEMA_REFERENCE.md` + `DATA_STATE.md` generated by `scripts/gen-schema-reference.js` (`npm run gen:schema`, A5+A9), `GLOSSARY.md` (A6), `TEST_MAP.md` (A7), `docs/RECIPES/` ×6 (A8); guarded by verify-docs `generated-docs` check. See closed table C-14 |
| OG-25 | Live-vs-migrations drift found by the OG-13 empty-DB replay: 3 benchmark CHECKs stricter live (NULL escape removed), `chk_benchmark_result_metric_value_finite` live-only, 5 undocumented live-only indexes. Decision needed: migration 012 to reconcile, or document live-only provenance. Engine-irrelevant today (engine reads none of these structures) | **IMPORTANT** (latent) | OPEN | schema-migration | OG-13 diff 2026-09-30; ARCH §16 |

No BLOCKING gaps other than OG-01 were found (ARCH §16: the engine can be fully implemented on the current schema with the documented policies).

Closed-row policy: a closed row stays in this table for one release cycle with its dated resolution inline and a `→ C-xx` pointer into the closed tables (§2/§3), so a reader scanning §1 sees that it *was* open; the closed tables remain the canonical record. Today that applies to OG-13 (→ C-15) and OG-24 (→ C-14). A row that closes leaves §1 once its ID is cited only from the closed tables.

---

## 2. Closed — audit findings D1–D12

| ID | Finding | Status | Resolution |
|---|---|---|---|
| C-01 | D1 + D9 — Layer-4 plan claimed its own work was never done; "no isolated DB" reason wrong | CLOSED 2026-09-28 | Status header → IMPLEMENTED + per-item ledger (`59dc0a3`); §5.4 / §6.20 / §7 corrected (`853b1b6`). Residue → OG-13 |
| C-02 | D2 — four HARD rules unimplemented + §5.2 escalation | CLOSED 2026-09-28 | Decision 26 hybrid: §5.2 escalation IMPLEMENTED (`GPU_PSU_CONNECTOR_NULL_HIGH_TGP`); the four rules explicitly DEFERRED → OG-09…OG-12 |
| C-03 | D3 — Decision 22 status line inverted vs shipped code | CLOSED 2026-09-28 | UPDATE block added, inverted sentences struck (`fe2a816`) |
| C-04 | D4 + D11 — architecture status header / superseded sections unmarked; §9 tie consequence | CLOSED 2026-09-28 | Supersession notice + inline SUPERSEDED markers + §9 pointer (`fe2a816`, `676973b`, `6c69baa`) |
| C-05 | D5 — decision log not navigable | CLOSED 2026-09-28 | `docs/DECISION_INDEX.md` generated; 30 normalized `Status:` lines; `npm run gen:decisions` + `--check` gate |
| C-06 | D6 + D7 — DEVELOPMENT_NOTES stale lines / missing session entries | CLOSED 2026-09-28 | 5 table rows fixed (`35b0618`); consolidated D7 backlog entry (`d06e998`) |
| C-07 | D8 + D12 — Layer 3 empty-table precondition / guard coverage undocumented | CLOSED 2026-09-28 | AGENTS §6/§7 preconditions + guard inventory; notes qualified (`bcdab5e`) |
| C-08 | D10 — migration-tracking gap undocumented | CLOSED 2026-09-28 | Owned as ACCEPTABLE tool defect in ARCH §16 → OG-14 (`853b1b6`) |

## 3. Closed — source rows that are no longer open

| ID | Item | Status | Resolution |
|---|---|---|---|
| C-09 | 002 D3 — CPU `product_family` granularity | CLOSED by design | One family never spans two board-support rules (engine matches by `product_family_id`) |
| C-10 | 002 D6 connector half — GPU `required_power_connectors` NULL | CLOSED 2026-09-28 | Seed 003 (Decision 23 O1): 22/22 GPU variants populated + PSU counts supplied. **This is the audit's example contradiction**: still-worded-as-open in 002 D6 / older CONTEXT prose. Dimension half remains → OG-07 |
| C-11 | 002 D7 — research-filled fields / catalog-vs-companion conflicts | CLOSED | Precedence recorded inline (catalog wins, conflicts flagged); provenance-table question → status review U12 |
| C-12 | ARCH §18 "Needs clarification" items 1–7 | CLOSED | Decisions 1, 2, 3, 6, 7, 8, 9 — all RESOLVED in the decision log |
| C-13 | Engine 6 status prose ("implementation is future work") | CLOSED 2026-09-28 | Decision 22 UPDATE block; `explanation/` is shipped and wired in `orchestrator/full-run.js` |
| C-14 | OG-24 / audit A5–A9 — generated + task-shaped docs | CLOSED 2026-09-29 | `scripts/gen-schema-reference.js` generates `SCHEMA_REFERENCE.md` (A5) + `DATA_STATE.md` (A9) deterministically with a `--check` gate; `GLOSSARY.md` (A6), `TEST_MAP.md` (A7), `docs/RECIPES/` 6 checklists (A8) hand-written; `CLAUDE.md`/`.cursorrules` pointers (A11); verify-docs `generated-docs` check added |
| C-15 | OG-13 / status review U1 — fresh-migration verification | CLOSED 2026-09-30 | Empty-DB replay succeeded; live drift found (3 stricter benchmark CHECKs + 1 extra CHECK + 5 undocumented indexes, all live-only) → tracked forward as **OG-25** (reconcile the benchmark-table drift into a migration 012 or record live-only provenance) |

## 4. Audit recommendation status (A1–A12)

| Ref | Recommendation | Status |
|---|---|---|
| A1 | `docs/DECISION_INDEX.md` (generated) | CLOSED 2026-09-28 |
| A2 | `scripts/verify-docs.js` + `.github/workflows/ci.yml` | CLOSED 2026-09-29 (offline/`--live` checks; CI runs test:unit + index `--check` + verify-docs `--offline`) |
| A3 | `docs/OPEN_GAPS.md` (this file) | CLOSED 2026-09-29 |
| A4 | Retire / re-status `LAYER4_RECONCILIATION_PLAN.md` | CLOSED 2026-09-28 (status-block option taken — D1) |
| A5 | `docs/SCHEMA_REFERENCE.md` (generated) | CLOSED 2026-09-29 (`scripts/gen-schema-reference.js`, `npm run gen:schema`) |
| A6 | `docs/GLOSSARY.md` | CLOSED 2026-09-29 |
| A7 | `docs/TEST_MAP.md` | CLOSED 2026-09-29 |
| A8 | `docs/RECIPES/*.md` | CLOSED 2026-09-29 (6 checklists) |
| A9 | `docs/DATA_STATE.md` (generated) | CLOSED 2026-09-29 (same generator, `--check` gate) |
| A10 | `docs/decisions/TEMPLATE.md` | CLOSED 2026-09-30 (hard requirements: Status: as first line + machine-parse rules; placement/amendment notes; status vocabulary) |
| A11 | `CLAUDE.md` / `.cursorrules` → `AGENTS.md` pointers | CLOSED 2026-09-29 (one-line pointers) |
| A12 | AGENTS additions (CRLF convention; instance-specific figures; naive `split(';')`) | CLOSED 2026-09-28 (AGENTS §6/§8) |

---

## 5. Contradictions this register resolves

1. **GPU connectors** — open per `002 D6` / older `CONTEXT.md` prose, closed per seed 003 / Decision 23 O1 → **CLOSED (C-10)**; the genuinely open residue is dimensions (OG-07) and the 4 NULL-connector PSUs (OG-08 — three fully NULL, `A750GL PCIE5` EPS-only).
2. **Four HARD safety rules** — audit D2 found "no code implements" them; Decision 26 (2026-09-28) recorded them as **explicit DEFERRED unenforced** with binding seed-time re-check triggers (OG-09…OG-12), while implementing the §5.2 high-TGP escalation. They are deferred, not missing.
3. **Fresh `001→011` migration** — older docs blamed "no isolated database" (false since 2026-09-21); it was **RAN AND VERIFIED 2026-09-30** on a throwaway Neon DB (OG-13 / C-15; status review U1 marked DONE by `7d336cd`). The live-has-more benchmark drift it surfaced is tracked as **OG-25**. (This item said "UNVERIFIED for the empty-DB run only" until 2026-09-30 — it was missed when OG-13 closed, the exact self-contradiction the register exists to prevent; §1's own rows are authoritative.)
4. **Engine 6** — prose said "planned" while code shipped it; CLOSED via Decision 22 update (C-13). Not a gap.

---

## 6. Maintenance rules

- Hand-maintained (no generator — audit A3 does not require one). When a source gap closes or opens, update this file **in the same session** (same rule as `CONTEXT.md` status updates, `AGENTS.md` §8).
- Never duplicate live figures (row counts, test totals) here — they go stale; cite `CONTEXT.md` / status review instead.
- `scripts/verify-docs.js` (audit A2) does **not** check this file yet; adding a freshness assertion for it is a natural follow-up for the tooling owner. Until then keep this file in sync by hand **in the same session** — it has already drifted twice: OG-13's §5 line stayed "UNVERIFIED" for two commits after the closure (`afc1a03` → fixed 2026-09-30) and seed 004a landed without a register/plan/CONTEXT note (`a9d1514` → fixed 2026-09-30). Two mechanical aids now exist: `scripts/check-og01-coverage.js` for OG-01's live state, and the AGENTS §10 grep (`grep -rn "<OG-id>|<key phrase>" --include="*.md" .`) for closure propagation.
- Partial progress on a gap is recorded as a dated `**PROGRESS ...**` sentence inside the row; the class/status columns change only when the *live* state changes (OG-01 therefore stays `BLOCKING / OPEN` while batch 2 / seed 004b is unauthored — the batch-1 apply did change live state, hence the dated PROGRESS update).
- Since 2026-09-29 `verify-docs --live` DOES gate `docs/SCHEMA_REFERENCE.md`: `--live` mode hashes the DB's tables/columns/enums into a schema digest and fails when the doc's `schema-digest:` line no longer matches — run `npm run gen:schema` to refresh. `DATA_STATE.md` stays count-based and deliberately undigested.

---

## 7. Next actions (priority order, 2026-10-01)

Working list for the next sessions — each entry names its gap row; the register stays the source of truth for status.

1. **OG-01 batch 2 — author + apply + measure seed `004b`** (the only BLOCKING gap; the long pole, ~25–40 h of real research per the plan §8). 56 products / 168 rows: CPU 16, MOTHERBOARD 5, RAM 5, SSD 15, CASE 8, COOLER 7. Follow `docs/OG-01_ASSESSMENT_RESEARCH_PLAN.md` §3 (sourcing) + §4 (rubric); `TEST_DATABASE_URL` is restored, so the original **branch-first → measure → shared** workflow applies again. Acceptance: coverage gate drops to 0 fully-unassessed (`--strict` clean apart from documented fixtures), re-measure reach on the branch, record figures, update this row.
2. **OG-05 — case radiator matrices** (data-research; dovetails with batch-2 CASE research per plan §7). 6 of 10 cases have zero `case_radiator_support` rows → every liquid cooler HARD-FAILs there. Separate seed file; opportunistic capture during step 1's CASE pass is encouraged but its seed is independent.
3. **OG-07 / OG-08 — GPU dimensions + the 4 NULL-connector PSUs** (data-research; same research sessions as batch 1/2 may gather them, separate seeds). OG-08 matters more after seed 004a: its QUALITY rows are honest NULLs, and Decision 26 makes a required-connector NULL on a ≥200 W-TGP pair a conservative FAIL.
4. **OG-25 — benchmark-table drift decision** (schema-migration; engine-irrelevant today). Choose: migration 012 to reconcile the live-only CHECK/index drift, or document live-only provenance. Do this before any future migration lands so 012 ordering stays clean.
5. **OG-14 — migration tracking** (tooling; ACCEPTABLE but compounds every future migration). Make `run-migrations.js` re-runnable with an applied-migrations ledger; unblocks itself before 012 in step 4.
6. **OG-06 — offer-price verification pass** (data-research). VALUE scores in 004a/004b are computed from live offer prices; if prices are corrected later, assessments' VALUE rows age out (decay) and can be re-scored — so this can trail batch 2 rather than block it.
