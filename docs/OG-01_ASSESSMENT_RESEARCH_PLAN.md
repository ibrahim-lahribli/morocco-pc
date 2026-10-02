# OG-01 Research Plan — real `component_assessment` data for the 85 unassessed products

**Date:** 2026-09-30 · **Owner:** data-research · **Status:** IN PROGRESS — batch 1 (seed 004a, 87 rows) AUTHORED 2026-09-30 and **APPLIED to shared DB 2026-10-01 + MEASURED** (reach now score-driven; TEST_DATABASE_URL branch unreachable, measured via read-only pipeline replication against shared DB — see DEVELOPMENT_NOTES 2026-10-01); batch 2 IN PROGRESS: `004b_cpu_motherboard.sql` (21 products / 63 rows) and `004b_ssd_ram.sql` (20 products / 60 rows) AUTHORED, BRANCH-APPLIED, MEASURED and APPLIED 2026-10-02; only `004b_case_cooler.sql` (15 products / 45 rows) outstanding
**Closes:** `docs/OPEN_GAPS.md` OG-01 (the only BLOCKING gap) · **Executable companion:** `docs/OG-01_BATCH2_EXECUTION_PLAN.md` · **Contract:** `database/seeds/002_catalog_expansion.sql` header D2 (amended 2026-09-28) · **Gate:** `scripts/check-og01-coverage.js` (read-only; exit 1 while fully-unassessed products remain)

---

## 1. Why this is blocking (the measured facts)

- 85 of 100 products have **zero** `component_assessment` rows → every weighted type scores the
  flat no-evidence branch: `neutral_baseline 50 − no_evidence_penalty 10 = 40.000` (Decision 13 STEP 1).
- With `top_k_per_role = 5`, only **2 of 20 new GPUs and 3 of 9 new PSUs** from seed 002 reach a
  build; WHICH ones survive is decided by lexicographic order of **random UUIDs** (verified 2026-09-28:
  the 3 surviving PSUs are exactly the 3 smallest UUIDs). The reachable subset is not stable across a
  database reset — every reach figure taken on this data is instance-specific.
- Seed 003 cannot fix this: candidate score comes **only** from `component_assessment`; connector
  data only moves pair verdicts UNKNOWN → PASS/FAIL, adding no reach.
- Assessments are the ONLY mechanism that lets the expansion influence scores. **They must be
  OBTAINED, never invented** (seed-002 D1/D6/D7 forbid guessing). This plan exists to make "obtain"
  concrete, auditable, and machine-verifiable.

## 2. Exact deliverable (what "done" means)

One idempotent seed — named `database/seeds/004_component_assessments.sql` in this draft and SHIPPED SPLIT as `database/seeds/004a_component_assessments_gpu_psu.sql` (batch 1: 20 GPU + 9 PSU = 87 rows, authored 2026-09-30) plus `004b_...` (batch 2: the remaining 56 products / 168 rows) — inserting real assessments
for all 85 products. Counts are fixed by the scoring model's `role_weights` and are not negotiable:

Counts use the engine's canonical `component_role` values (`component_role` enum, migration 011);
per-product category derives from spec-table presence (`cpu_spec` / `gpu_board_spec` / `ram_spec` /
`ssd_spec` / `motherboard_spec` / `psu_spec` / `case_spec` / `cooler_spec`), never from a product
column — `product` has no category column (candidates/loader.js header).

| Role (`component_role`) | `product_category` | Products | Types required (`role_weights[role]`) | Rows |
|---|---|---|---|---|
| CPU | CPU | 16 | PERFORMANCE, VALUE, QUALITY | 48 |
| GPU | GPU | 20 | PERFORMANCE, VALUE, QUALITY | 60 |
| RAM | MEMORY | 5 | PERFORMANCE, VALUE, QUALITY | 15 |
| SSD_BOOT | STORAGE | 15 | PERFORMANCE, VALUE, QUALITY | 45 |
| MOTHERBOARD | MOTHERBOARD | 5 | QUALITY, VALUE, UPGRADEABILITY | 15 |
| PSU | PSU | 9 | QUALITY, EFFICIENCY, VALUE | 27 |
| CASE | CASE | 8 | QUALITY, VALUE, THERMALS | 24 |
| CPU_COOLER | COOLER | 7 | THERMALS, QUALITY, VALUE | 21 |
| **Total** | | **85** | 3 each | **255** |

Assessments attach at product level (the FK is `product_id`; GPU is the only variant-keyed role for
specs, but seed 001 shows product-level GPU assessments applying to both variants). Before authoring,
**re-derive this table from the live DB, not from this doc** — product counts and the role→types
mapping come from the active scoring model's `role_weights`, and the checklist must match the DB the
seed runs against.

Hard rules for every row (from D2 + the engine contracts):

1. **One row per `(product_id, assessment_type)`.** `load-assessments` takes the latest `assessed_at`
   per pair — a newer NULL-score row *shadows* an older scored one (seed-001 precedent). Do not
   create shadow pairs.
2. **`assessed_at` fresh** — within 7 days of the seed being applied. Decay is linear
   0.5%/day capped at 180 days (`effective-score.js`): an 80 score at 180 days decays to 8. Old
   research is nearly worthless; research older than ~90 days should be re-checked, not transcribed.
3. **`confidence` NOT NULL** — NULL fails fast in the loader. Use the `confidence_level` enum:
   `CONFIRMED` (primary spec sheet / official benchmark), `HIGH` (two independent credible sources),
   `MEDIUM` (single credible review), `LOW` (partial data, normalized across models),
   `UNVERIFIED` (aggregator-only figures — see §4).
4. **`source_type` per the enum**: `OFFICIAL` (vendor spec/launch material), `DATASHEET`,
   `COMMUNITY` (credible review sites), `USER_SUBMITTED`, `RETAILER`.
5. **`summary` = one-line finding; `rationale` = the normalization path** (see §4) — enough for a
   reviewer to recompute the score from the cited source without re-researching.
6. **Every product's source URLs go in the seed header comments** (provenance lives in comments
   until U12 lands). No URL, no row.
7. **Never invent.** If a type genuinely cannot be sourced for a product: insert the row with
   `score NULL`, `rating 'Unrated'`, a stated reason in `summary`, and `confidence 'LOW'`. A
   documented NULL is honest data; a guessed number is D1/D6/D7 drift.

## 3. Sourcing strategy per component class

Research priority follows reach impact: **GPU and PSU first** (they are the roles whose reach is
UUID-random today), then CPU, then the rest. Batch 1 ≈ unblocks the measured K1 starvation.

**Batch 1 — GPU (20 products, 60 rows).** Performance: vendor-official relative performance where
published; otherwise a single fixed resolution/settings tier across credible reviews (pick ONE
anchor review set and normalize every card against it — do not mix methodologies). Value: performance
per currency at current live offers (`store_offer` prices are the denominators; cross-check 002's
unverified assessment-era prices only if the offer pass has run). Quality: RMA/brand track record,
driver support history, known failure modes.

**Batch 1 — PSU (9 products, 27 rows).** Quality: unit-level reviews (teardowns, protection-circuit
testing) over brand reputation. Efficiency: certification level is objective — 80 PLUS Bronze/Silver/
Gold/Platinum maps to a fixed rubric; Cybenetics ETA numbers preferred where they exist. The 3
deliberately-NULL rows (`Seed Antec G850`, `Seed Connect PSU 850`, `Seed HYBROK PSU 650`) have
unverified vendor specs — treat their QUALITY as the strict gate D2 warns about; do not seed it
optimistically.

**Batch 2 — CPU (16), MOTHERBOARD (5).** CPU PERFORMANCE: one multi-threaded and/or gaming benchmark
suite held constant (Cinebench R23 multi matches seed 001's `Seed Cinebench R23 Multi` precedent).
MOTHERBOARD UPGRADEABILITY is partly objective (DIMM slots, PCIe generation, BIOS support horizon) —
the seed-001 entry "2 DIMM slots → 60" is the calibration precedent.

**Batch 3 — SSD (15), RAM (5), CASE (8), CPU_COOLER (7).** SSD PERFORMANCE from controller/NAND tier
+ sustained-write reviews; CASE THERMALS from airflow reviews (radiator/fan configs noted — this
dovetails with OG-05, the missing radiator matrices: capture both in the same research pass);
COOLER THERMALS from standardized-delta reviews. RAM PERFORMANCE is nearly uniform within a DDR
generation — normalize by speed/bin, and say so in `rationale`.

**Where sources don't exist** (unbranded/off-brand parts: HYBROK, Connect, Innovation IT, TwinMOS,
Intenso, Netac, Hiksemi): community teardown/review evidence or honest NULLs. These products
*staying* low-scored is a legitimate outcome; the gap is coverage, not every product scoring well.

## 4. Score normalization rubric (must be uniform)

- Scale 0–100 (`chk_component_assessment_score_range` enforces; NULL allowed).
- Anchor each type to 2–3 fixed reference points defined **before** scoring starts (e.g. GPU
  PERFORMANCE: class-leading current-gen card = 90, last-gen midrange = 70, entry = 50). Anchors go
  in the seed header so the whole batch is reproducible.
- `rating` bands (match seed-001 vocabulary): ≥85 `Great`, 70–84 `Good`, 55–69 `Average`, <55 `Poor`,
  unscored `Unrated`.
- VALUE is always relative to the *live* offer price at research time; note the price used in
  `rationale` (prices move; the assessment date bounds the claim).
- No type may be derived from another type's score (QUALITY ≠ f(PERFORMANCE)) — that is invention
  with extra steps.

## 5. Execution workflow

1. **Inventory dump** — generate the 85-product × 3-type worksheet from the live DB (read-only,
   category via spec-table presence per §6): product name, role, current offer price, existing
   assessment rows (expect none). This is the research checklist; no row may be skipped silently.
2. **Batch 1 research** (GPU + PSU) → review pass → Batch 2 → Batch 3. Review = a second person (or a
   fresh session) re-derives 10% of scores from the cited URLs and diffs.
3. **Author the seed file(s)** — `004a_component_assessments_gpu_psu.sql` (batch 1, DONE 2026-09-30) and `004b_...sql` (batch 2); the single-file name `004_component_assessments.sql` used earlier in this plan is superseded by that split — per [docs/RECIPES/add-a-seed.md](RECIPES/add-a-seed.md):
   CRLF, idempotent (`INSERT ... SELECT ... WHERE NOT EXISTS` on `(product_id, assessment_type)` with
   `ON CONFLICT`-style guard; re-run is a no-op), all source URLs in the header, single row per pair,
   `assessed_at = NOW()` at apply time (freshness rule §2.2).
4. ~~**Apply on the `TEST_DATABASE_URL` branch first**, measure, then shared DB.~~ **DONE 2026-10-01, with deviation:** the branch was unreachable (`password authentication failed` on both pooled and direct hosts); applied directly to the shared DB per operator decision (seed is transactional + idempotent; all 29 product names pre-verified against live DB before apply). Measured via a one-shot read-only pipeline replication (stages 4–11) against the shared DB — recorded in DEVELOPMENT_NOTES 2026-10-01. Result: reach is score-driven, not UUID-random (5/5 retained GPUs + 5/5 retained PSUs are 004a-scored; 57/101 pool candidates still at flat 40.000 = batch-2 roles).

## 6. Acceptance criteria (all machine-checkable)

**Status 2026-10-02 — batch 1 (87 rows) plus two of the three batch-2 files (63 + 60 = 123 rows) are APPLIED + MEASURED: assessments 112 -> 235, coverage gate 56 -> 15 products / 45 rows implied, flat-40 pool candidates 57 -> 16 of 101, and CPU/MOTHERBOARD/SSD_BOOT reach is score-driven. Remaining: `004b_case_cooler.sql` (45 rows) only. Applying real data also surfaced OG-26 (retention is budget-blind -> GAMING@15000 MAD now assembles 0 builds).** The checklist describes the completed deliverable, and `scripts/check-og01-coverage.js` is its live gate (now reporting 15 products / 45 rows implied).

There is **no product→category FK**: `product_category` is an enum used only in
`product_candidate.source_category`, and the loader derives category from spec-table presence
(`candidates/loader.js` `PRODUCT_KEYED_SPEC_BY_CATEGORY`; GPU is variant-keyed via `gpu_board_spec`).
The coverage check must use the same derivation. Sketch (adapt to the real spec-table PK columns —
each `*_spec` table references product or variant):

```sql
-- coverage: must return 0 rows (every product × its 3 required types present)
-- Category via spec-table presence, mirroring candidates/loader.js (NOT a product column).
WITH categorized AS (
    SELECT p.id, p.name, 'CPU'::product_category AS cat FROM cpu_spec s JOIN product p ON p.id = s.product_id
    UNION ALL SELECT p.id, p.name, 'MOTHERBOARD' FROM motherboard_spec s JOIN product p ON p.id = s.product_id
    UNION ALL SELECT p.id, p.name, 'MEMORY' FROM ram_spec s JOIN product p ON p.id = s.product_id
    UNION ALL SELECT p.id, p.name, 'STORAGE' FROM ssd_spec s JOIN product p ON p.id = s.product_id
    UNION ALL SELECT p.id, p.name, 'PSU' FROM psu_spec s JOIN product p ON p.id = s.product_id
    UNION ALL SELECT p.id, p.name, 'CASE' FROM case_spec s JOIN product p ON p.id = s.product_id
    UNION ALL SELECT p.id, p.name, 'COOLER' FROM cooler_spec s JOIN product p ON p.id = s.product_id
    -- GPU: variant-keyed — join product_variant → gpu_board_spec, then back to product
)
SELECT c.name, t.type
FROM categorized c
CROSS JOIN (VALUES ('PERFORMANCE'),('VALUE'),('QUALITY')) t(type)
LEFT JOIN component_assessment a
  ON a.product_id = c.id AND a.assessment_type = t.type::assessment_type
WHERE c.name LIKE 'Seed %' AND a.id IS NULL
  -- plus per-category type filters: MOTHERBOARD requires (QUALITY,VALUE,UPGRADEABILITY),
  -- PSU (QUALITY,EFFICIENCY,VALUE), CASE (QUALITY,VALUE,THERMALS), COOLER (THERMALS,QUALITY,VALUE);
  -- the sketch's uniform 3-type list is exact only for CPU/GPU/MEMORY/STORAGE rows.
  -- Simplest robust form: generate one UNION arm per category with its own VALUES list.
;
```

The acceptance gate is a small read-only script committed next to the seed — `scripts/check-og01-coverage.js` — so it is re-runnable, not a one-off paste. **DONE 2026-09-30:** `scripts/check-og01-coverage.js` is committed (read-only, reads `DATABASE_URL`, no guard needed). It derives each product's category from spec-table presence and the required types from the active scoring model's `role_weights`, FAILs (exit 1) while any active product has zero assessment rows, reports seed 001's deliberate no-evidence fixture separately, and has `--strict` for partially-covered products (only meaningful after batch 2). Live result: **56 products / 168 implied rows** (was 85/255 before the 004a apply on 2026-10-01). [The SQL sketch below is retained as the derivation reference — the script is the gate.]

- [ ] 255 new rows; coverage script returns 0; every `confidence` non-NULL; every `assessed_at`
      within 7 days.
- [ ] Every row's source URL present in the seed header; 10% re-derivation diff has no material
      outliers (>10 points unexplained).
- [ ] Re-run the 002-D2-amended measurement on the branch
      (`filterCandidates → computeCandidateScores → retainTopKPerRole` under `seed-minimal-v1`):
      new GPUs/PSUs must now score ≠ 40.000 and the **reach figures must change and become
      UUID-independent** for scored products (ties may remain only among genuinely equal scores).
      Record the new figures in the seed header and in `CONTEXT.md`.
- [ ] Idempotency: `npm run seed` twice → identical row counts, no duplicates.
- [ ] `npm run gen:schema` (refreshes `DATA_STATE.md` counts), `npm run verify:docs --live`,
      `npm run test:unit` — all green.

## 7. Out of scope (do not fold in)

- Offer price verification (OG-06) — separate pass, but note VALUE scores depend on it; if the price
  pass lands first, use its numbers.
- Case radiator matrices (OG-05) — capture opportunistically during CASE research, but its seed is a
  separate file.
- GPU dimensions (OG-07) and PSU spec NULLs (OG-08) — same research sessions may gather them, but
  they close their own gaps with their own seeds.

## 8. Effort estimate

~15–30 min per product including source citation and rationale → **roughly 25–40 hours total**,
halved if batch 1 (GPU+PSU, the reach-blocking roles) is split out as the first deliverable and
shipped as seed 004a with the remainder following as 004b. Both must satisfy §6 for their subset.
