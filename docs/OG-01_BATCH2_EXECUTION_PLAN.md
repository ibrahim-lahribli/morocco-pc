# OG-01 Batch-2 Execution Plan — seed `004b` (56 products / 168 rows)

**Date:** 2026-10-02 · **Owner:** data-research · **Status:** steps 0-6 DONE for TWO of
the three files (`004b_cpu_motherboard.sql` 63 rows and `004b_ssd_ram.sql` 60 rows:
anchors frozen, researched, branch-applied, measured, shared-applied, verified —
123 of 168 rows done, assessments 112 -> 235);
steps 1-6 still to run for `004b_case_cooler.sql` (15 products / 45 rows)
**Parent plan:** `docs/OG-01_ASSESSMENT_RESEARCH_PLAN.md` (this file is its executable
companion: same hard rules, concrete anchors, per-file workflow) · **Closes:** OG-01
**Gates:** `scripts/check-og01-coverage.js` · `scripts/check-deferred-rules.js` ·
`scripts/measure-og01-reach.js`

## 1. Scope (fixed 2026-10-02)

56 fully-unassessed products / **168 rows** — the gate's FAIL set exactly. The 14 seed-001
partial fixtures are excluded on purpose (`DELIBERATE_PARTIAL`): a missing type is the
missing-type branch of Decision 13 STEP 1, and they are its only live coverage.

| File | Products | Rows | Types per product |
|---|---|---|---|
| `004b_cpu_motherboard.sql` (pilot) | 16 CPU + 5 MB = 21 | 63 | PERFORMANCE/QUALITY/VALUE · QUALITY/UPGRADEABILITY/VALUE |
| `004b_ssd_ram.sql` **(DONE 2026-10-02)** | 15 SSD + 5 RAM = 20 | 60 | PERFORMANCE/QUALITY/VALUE |
| `004b_case_cooler.sql` **(REMAINING)** | 8 CASE + 7 COOLER = 15 | 45 | QUALITY/THERMALS/VALUE · THERMALS/QUALITY/VALUE |

Three independently appliable files so research can run in parallel sessions; each must
satisfy section 6 of the parent plan for its own subset.

## 2. Pilot inventory (live facts, read 2026-10-02 — the research input, not the scores)

CPU (socket · cores/threads · TDP · iGPU · offer MAD):

| Product | Socket | C/T | TDP | iGPU | Price |
|---|---|---|---|---|---|
| Seed AMD Ryzen 5 3400G | AM4 | 4/8 | 65 | yes | 1599 |
| Seed AMD Ryzen 5 3500X | AM4 | 6/6 | 65 | no | 1299 |
| Seed AMD Ryzen 5 5500 | AM4 | 6/12 | 65 | no | 899 |
| Seed AMD Ryzen 5 5600 | AM4 | 6/12 | 65 | no | 2199 |
| Seed AMD Ryzen 5 5600X | AM4 | 6/12 | 65 | no | 1599 |
| Seed AMD Ryzen 5 PRO 5655G | AM4 | 6/12 | 65 | yes | 2699 |
| Seed AMD Ryzen 7 5700G | AM4 | 8/16 | 65 | yes | 5160 |
| Seed AMD Ryzen 7 5700X | AM4 | 8/16 | 65 | no | 1890 |
| Seed AMD Ryzen 7 5800X | AM4 | 8/16 | 105 | no | 2249 |
| Seed AMD Ryzen 7 7700X | AM5 | 8/16 | 105 | yes | 2799 |
| Seed AMD Ryzen 7 7800X3D | AM5 | 8/16 | 120 | yes | 3549 |
| Seed AMD Ryzen 7 8700F | AM5 | 8/16 | 65 | no | 1749 |
| Seed AMD Ryzen 9 5900X | AM4 | 12/24 | 105 | no | 3199 |
| Seed AMD Ryzen 9 5950X | AM4 | 16/32 | 105 | no | 2999 |
| Seed Intel Core i5-12400F | LGA1700 | 6/12 | 65 | no | 1549 |
| Seed Intel Core i7-12700KF | LGA1700 | 12/20 | 125 | no | 2699 |

Motherboard (socket · memory type · DIMM · max GB · mem speed · M.2 · PCIe x16 · Wi-Fi · MAD):

| Product | Socket | Mem | DIMM | Max GB | Mem MT/s | M.2 | x16 | Wi-Fi | Price |
|---|---|---|---|---|---|---|---|---|---|
| Seed LPC Gaming B650 DDR5 | AM5 | DDR5 | 4 | 192 | 4800-6400 | 2 | NULL | yes | 2190 |
| Seed MSI A520M A-PRO | AM4 | DDR4 | 2 | 128 | 1866-4600 | 1 | 1 | no | 582 |
| Seed MSI B550M PRO-VDH | AM4 | DDR4 | 4 | 128 | 1866-4400 | 2 | 1 | no | 952 |
| Seed MSI B550M PRO-VDH WIFI | AM4 | DDR4 | 4 | 128 | 1866-4400 | 2 | 1 | yes | 1267 |
| Seed MSI Z790 GAMING PLUS WIFI | LGA1700 | DDR5 | 4 | 256 | 4800-7200 | 4 | 3 | yes | 2649 |

## 3. Price integrity gate (must run before any VALUE score)

Seed 002's assessment-era prices are UNVERIFIED (OG-06) and the pilot set contains
**internally impossible** combinations, so VALUE cannot be trusted blindly:

- `5700G` 5160 MAD vs `5700X` 1890 MAD — same 8C/16T Zen 3 die, 2.7x price gap.
- `5600` 2199 vs `5600X` 1599 — the non-X part priced above the X part.
- `5950X` 2999 vs `5900X` 3199 — the 16-core priced below the 12-core.

Rule for this batch: **sanity-check first, and where the live offer price fails the check,
seed VALUE as `score NULL` / `rating 'Unrated'` with the reason and a pointer to OG-06 —
never derive a score from a price known to be wrong.** A documented NULL keeps the type on
its documented no-evidence branch; a computed score from a 3x-wrong price is invented data
with extra steps. Price correction itself is OG-06's own separate seed, out of scope here
(parent plan section 7).

## 4. Rubric anchors (frozen BEFORE scoring; written into each seed header)

Scale 0-100; bands >=85 `Great`, 70-84 `Good`, 55-69 `Average`, <55 `Poor`, unscored
`Unrated`. No type may be derived from another type's score (parent plan section 4).

**CPU PERFORMANCE** — single anchor chain: one dataset's Cinebench R23 **multi** score
(seed 001's own `Seed Cinebench R23 Multi` benchmark is the precedent). Calibrated so the
incumbent anchors hold:

    score = 78 + 10 * ln(r23multi / r23_7500F) / ln(r23_5950X / r23_7500F)

capped to [50, 90], where `r23_7500F` and `r23_5950X` are that dataset's figures. This
reproduces seed 001's `Seed Ryzen 5 7500F` PERFORMANCE = 78 exactly. Documented limitation,
carried into the header and the register: a multi-thread metric understates
gaming-specialised parts (7800X3D, 8700F); the engine's single `seed-minimal-v1` model has
one CPU PERFORMANCE number per product, so this is a known approximation, not a bug.

**CPU QUALITY** — silicon/tier + documented product-level facts, not vibes: bin/tier
consensus, iGPU presence, and named caveats (3500X's PCIe-3-only platform, 5655G being an
OEM-locked rebadge, Zen 2's platform end-of-life, 7800X3D's 3D V-Cache value). Anchors:
current-gen flagship 85-88, mainstream Zen 3 78-82, Zen 2 70-76, OEM-locked/limited 64-70.

**CPU VALUE** — performance points per MAD at the live offer price, using the section 4
index: linear on price-per-performance-point with anchors best = 74, worst = 55, and `NULL`
where section 3 rejects the price.

**MOTHERBOARD QUALITY** — vendor tier + VRM/build + warranty, MSI's own line hierarchy
(PRO > Gaming Plus > entry A-series) plus review consensus; `Seed LPC Gaming B650 DDR5` is
a regional brand with no credible unit review, so its QUALITY is an honest `NULL` /
`Unrated` (same treatment 004a gave Connect/HYBROK PSUs).

**MOTHERBOARD UPGRADEABILITY** — objective, straight from the section 2 columns (seed 001's
"2 DIMM slots -> 60" is the calibration precedent): DIMM count and max capacity dominate,
then memory-speed ceiling, M.2 count, PCIe x16 count/wifi as a small bonus. A NULL
`pcie_x16_slots` (LPC B650) is documented as unknown, never as zero.

**MOTHERBOARD VALUE** — price relative to the same feature set, linear between the best
and worst position in this 5-board set, with the price sanity check applied.

## 5. Per-row protocol (parent plan section 2 hard rules)

1. One row per `(product_id, assessment_type)`; never create a shadow pair.
2. `assessed_at = NOW()` at apply; decay is 0.5%/day.
3. `confidence` NOT NULL, from `confidence_level`; `source_type` from its enum.
4. `summary` = the finding; `rationale` = the arithmetic/path so a reviewer can recompute
   the score from the cited URL.
5. Source URLs in the header; the price used stated in the rationale.
6. No URL, no row. No invention: unsourceable => `NULL` + reason + `confidence LOW`.
7. ASCII only; CRLF; single `BEGIN;`/`COMMIT;`; `WHERE NOT EXISTS` on
   `(product_id, assessment_type)` — a correction is a NEW seed file, never an overwrite.

## 6. Workflow per file (pilot first)

1. Freeze the anchors for the file's types in its header (step 1 of the parent plan).
2. Research every product against the frozen anchors; log price sanity per product.
3. Author the seed; `node scripts/run-seeds.js --dry-run` reads right.
4. Branch-first: apply to `TEST_DATABASE_URL`, re-run to prove idempotency (row counts
   identical), then `DATABASE_URL=$TEST_DATABASE_URL node scripts/measure-og01-reach.js`
   before/after — expect the flat-40 count to fall and the retained sets to change.
5. `scripts/check-deferred-rules.js` (0 violations — the seed touches CPU/board roles) and
   `scripts/check-og01-coverage.js` (56 drops by this file's product count).
6. Shared-DB apply; `npm run gen:schema`; `verify-docs --offline` + `--live`;
   `gen-decision-index --check`; `npm run test:unit`; the three guarded harnesses.
7. Same-session doc sync: seed header, `CONTEXT.md` counts, register OG-01 row + section 7,
   parent plan section 6 status, DEVELOPMENT_NOTES. Review pass: re-derive 10% of the scores
   from the cited URLs; no unexplained >10-point outliers.

## 7. Acceptance criteria (machine-checkable, per file)

- [ ] Row count == the file's product count x 3; `check-og01-coverage.js` fully-unassessed
      drops by exactly that many products.
- [ ] `confidence` non-NULL on every row; every `assessed_at` fresh; one row per pair.
- [ ] Every product has >= 1 source URL in the header; per-row rationale shows the path.
- [ ] `check-deferred-rules.js` exits 0 (no new violating pair).
- [ ] Idempotent re-run inserts 0 rows.
- [ ] Before/after `measure-og01-reach.js` recorded: flat-40 count falls, retained sets
      change and are score-driven, not UUID-driven.
- [ ] `gen:schema`, `verify-docs` (offline + live), `gen-decision-index --check`,
      `test:unit`, three guarded harnesses all green.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Wrong seed-002 prices poison VALUE | section 3 sanity gate => honest `NULL` + OG-06 pointer |
| Gaming-specialised CPUs understated by a multi-thread anchor | documented limitation in the seed header and the register |
| No credible review exists (LPC board, OEM-locked CPU) | honest `NULL` / `Unrated`; staying low is a legitimate outcome |
| Scores drift from seed 001's incumbents | anchors reproduce 7500F = 78 by construction; cross-check 8600G, 990 Pro, NH-U12S, Flare X5 |
| Research spread over days => stale prices/benchmarks | `assessed_at = NOW()` at apply; re-verify the price column before the final apply |
