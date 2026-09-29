# OPEN_GAPS — consolidated open-gap register

**Date:** 2026-09-29 · **Audit ref:** A3 / fix-order item 9 · **Owner:** docs

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
| OG-01 | Real `component_assessment` research for the 85 seed-002 products was never supplied. 85/100 products score the flat no-evidence 40.000 and are mostly unreachable (`top_k_per_role = 5`; only 2 GPUs / 3 PSUs from the expansion reach a build; which ones survive is UUID-random). Must be OBTAINED, never invented; a later seed must cover every `role_weights[role]` type with fresh `assessed_at` and non-NULL confidence. | **BLOCKING** | OPEN | data-research | 002 D2 (amended 2026-09-28); CONTEXT.md; status review K1 / Option A |
| OG-02 | Single `motherboard_spec.memory_type_id` cannot represent boards supporting DDR4 AND DDR5 → possible false rejections | **IMPORTANT** | OPEN | schema-migration | ARCH §6/§16/§18 |
| OG-03 | Presence-only tables (`case_motherboard_form_factor`, `case_radiator_support`, `platform_memory_support`) cannot store FAIL/UNKNOWN/CONDITIONAL explicitly; asymmetric UNKNOWN policy mitigates | **IMPORTANT** | OPEN | schema-migration | ARCH §3.2/§16/§18 |
| OG-04 | No rejection-reason persistence — rejected combos are invisible; limits "why was nothing recommended?" debugging | **IMPORTANT** | OPEN | schema-migration | ARCH §16/§18 |
| OG-05 | Case radiator matrix missing for 6 of 10 cases → every liquid cooler is a HARD FAIL there (load-bearing per 002 D4; only 2 researched cases have documented positions) | **IMPORTANT** | OPEN | data-research | 002 D4; status review K5 |
| OG-06 | Seed-002 assessment-era prices are UNVERIFIED (companion aggregator prices differ materially; no offer-level unique key, so a correction INSERTs a second offer instead of updating) | **IMPORTANT** | OPEN | data-research | 002 D1 |
| OG-07 | 7 GPU variants have NULL `width_slots` / `height_mm` → GPU↔case thickness resolves UNKNOWN (seed 003 closed the connector half of 002 D6 but not dimensions) | **IMPORTANT** | OPEN | data-research | 002 D6 residue; CONTEXT.md |
| OG-08 | 3 PSU rows (`Seed Antec G850`, `Seed Connect PSU 850`, `Seed HYBROK PSU 650`) carry deliberately NULL EPS / PCIe-8pin / 12VHPWR / SATA counts. After Decision 26 a required-connector NULL on a ≥200 W-TGP pair FAILs conservatively — safe direction, but a false-negative risk | **IMPORTANT** | OPEN | data-research | CONTEXT.md; Decision 26 |

| OG-09 | Cooler `max_tdp_watts` vs CPU `tdp_watts` REJECT — no code reads the column | **IMPORTANT** (latent) | DEFERRED | engine-code | ARCH §5.3/§16; Decision 26 item B; 0 live violations 2026-09-28 — re-check before any cooler/CPU seed |
| OG-10 | Air-cooler `height_mm` vs `case_spec.max_cpu_cooler_height_mm` REJECT — height known for only 5 of 9 coolers | **IMPORTANT** (latent) | DEFERRED | engine-code | ARCH §5.3/§16; Decision 26 item B; 0 live violations — re-check before any cooler/case seed |
| OG-11 | RAM `module_count` vs `motherboard_spec.dimm_slots` REJECT (was silent drift until Decision 26) | **IMPORTANT** (latent) | DEFERRED | engine-code | ARCH §6/§16; Decision 26 item B; 0 live violations — re-check before any RAM/motherboard seed |
| OG-12 | Total RAM capacity vs `motherboard_spec.max_memory_capacity_gb` REJECT | **IMPORTANT** (latent) | DEFERRED | engine-code | ARCH §6/§16; Decision 26 item B; 0 live violations — re-check before any RAM/motherboard seed |
| OG-13 | Fresh `001→011` migration on an empty database has never been run (a `TEST_DATABASE_URL` branch has existed since 2026-09-21 — only the empty-DB run is outstanding) | ACCEPTABLE (environmental) | UNVERIFIED | tooling | ARCH §16; audit D1/D9 residue; status review U1 / F13 |
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

No BLOCKING gaps other than OG-01 were found (ARCH §16: the engine can be fully implemented on the current schema with the documented policies).

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
| A10 | `docs/decisions/TEMPLATE.md` | OPEN |
| A11 | `CLAUDE.md` / `.cursorrules` → `AGENTS.md` pointers | CLOSED 2026-09-29 (one-line pointers) |
| A12 | AGENTS additions (CRLF convention; instance-specific figures; naive `split(';')`) | CLOSED 2026-09-28 (AGENTS §6/§8) |

---

## 5. Contradictions this register resolves

1. **GPU connectors** — open per `002 D6` / older `CONTEXT.md` prose, closed per seed 003 / Decision 23 O1 → **CLOSED (C-10)**; the genuinely open residue is dimensions (OG-07) and the 3 NULL PSUs (OG-08).
2. **Four HARD safety rules** — audit D2 found "no code implements" them; Decision 26 (2026-09-28) recorded them as **explicit DEFERRED unenforced** with binding seed-time re-check triggers (OG-09…OG-12), while implementing the §5.2 high-TGP escalation. They are deferred, not missing.
3. **Fresh `001→011` migration** — older docs blamed "no isolated database" (false since 2026-09-21); the honest status is **UNVERIFIED for the empty-DB run only** (OG-13 / U1/F13).
4. **Engine 6** — prose said "planned" while code shipped it; CLOSED via Decision 22 update (C-13). Not a gap.

---

## 6. Maintenance rules

- Hand-maintained (no generator — audit A3 does not require one). When a source gap closes or opens, update this file **in the same session** (same rule as `CONTEXT.md` status updates, `AGENTS.md` §8).
- Never duplicate live figures (row counts, test totals) here — they go stale; cite `CONTEXT.md` / status review instead.
- `scripts/verify-docs.js` (audit A2) does **not** check this file yet; adding a freshness assertion for it is a natural follow-up for the tooling owner.
