# Layer 4 Reconciliation Plan

Status: **PROPOSAL — NOT IMPLEMENTED.** No database changes have been made. Migration 011 has NOT been created or applied.

Prepared: 2026-09-12
Based on: read-only catalog inspection of the live Neon database plus review of migrations 001–010, `CONTEXT.md`, and `DEVELOPMENT_NOTES.md`.

---

## 1. Current state

The live Neon database already contains all five Layer 4 tables and one extra enum. None of these objects exists in migrations 001–010:

| Object | Status in Neon | In Git migrations |
|---|---|---|
| `recommendation_profile` | exists, 0 rows | absent |
| `recommendation_query` | exists, 0 rows | absent |
| `recommendation_result` | exists, 0 rows | absent |
| `build_candidate` | exists, 0 rows | absent |
| `build_component` | exists, 0 rows | absent |
| enum `component_role` | exists | absent |

Because all five tables are empty, reconciliation requires no data migration — the same favourable situation as the Layer 3 reconciliation (migration 010).

### 1.1 Live schema as inspected (exact)

```text
recommendation_profile
  id UUID PK DEFAULT gen_random_uuid()
  name TEXT NOT NULL
  description TEXT
  use_case TEXT
  priority INTEGER                -- nullable, semantics undefined
  default_resolution TEXT
  created_at TIMESTAMP (naive) NOT NULL DEFAULT now()
  updated_at TIMESTAMP (naive) NOT NULL DEFAULT now()

recommendation_query
  id UUID PK DEFAULT gen_random_uuid()
  recommendation_profile_id UUID NULL  FK -> recommendation_profile(id)
  scoring_model_id UUID NULL           FK -> scoring_model(id)
  budget_amount NUMERIC NOT NULL       CHECK > 0
  currency TEXT NOT NULL
  use_case TEXT
  priority INTEGER
  resolution TEXT
  created_at TIMESTAMP (naive) NOT NULL DEFAULT now()

build_candidate
  id UUID PK DEFAULT gen_random_uuid()
  recommendation_query_id UUID NOT NULL  FK -> recommendation_query(id)
  total_price NUMERIC NULL               CHECK >= 0
  compatibility_status compatibility_status NULL
  score NUMERIC NULL                     CHECK 0..100
  created_at TIMESTAMP (naive) NOT NULL DEFAULT now()

build_component
  id UUID PK DEFAULT gen_random_uuid()
  build_candidate_id UUID NOT NULL   FK -> build_candidate(id)
  product_id UUID NOT NULL           FK -> product(id)
  product_variant_id UUID NULL       FK -> product_variant(id)
  category product_category NULL     -- REDUNDANT, derivable from component_role
  component_role component_role NOT NULL
  selected_price NUMERIC NOT NULL    CHECK >= 0
  currency TEXT NOT NULL
  store_id UUID NULL                 FK -> store(id)
  price_checked_at TIMESTAMP (naive) NULL
  created_at TIMESTAMP (naive) NOT NULL DEFAULT now()
  updated_at TIMESTAMP (naive) NOT NULL DEFAULT now()

recommendation_result
  id UUID PK DEFAULT gen_random_uuid()
  recommendation_query_id UUID NOT NULL  FK -> recommendation_query(id)
  build_candidate_id UUID NULL           FK -> build_candidate(id)
  rank INTEGER NULL                      CHECK > 0
  explanation TEXT
  created_at TIMESTAMP (naive) NOT NULL DEFAULT now()
```

Existing indexes (live): PK indexes on all five tables; `idx_build_candidate_recommendation_query_id`; `idx_build_component_build_candidate_id`; `idx_build_component_product_id`; `idx_recommendation_profile_use_case`; `idx_recommendation_query_profile_id`; `idx_recommendation_query_scoring_model_id`; `idx_recommendation_result_build_candidate_id`; `idx_recommendation_result_recommendation_query_id`.

Existing CHECKs (live): `chk_recommendation_query_budget_positive` (>0); `chk_build_candidate_score_range` (0..100); `chk_build_candidate_total_price_nonneg` (>=0); `chk_build_component_selected_price_nonneg` (>=0); `chk_recommendation_result_rank_positive` (>0).

Live FK list (9 total, all child→parent, Layer 4 → Layers 1–3 only):

```text
recommendation_query.recommendation_profile_id -> recommendation_profile.id
recommendation_query.scoring_model_id          -> scoring_model.id
build_candidate.recommendation_query_id        -> recommendation_query.id
build_component.build_candidate_id             -> build_candidate.id
build_component.product_id                     -> product.id
build_component.product_variant_id             -> product_variant.id
build_component.store_id                       -> store.id
recommendation_result.recommendation_query_id  -> recommendation_query.id
recommendation_result.build_candidate_id       -> build_candidate.id
```

### 1.2 Live `component_role` enum (exact values)

```text
CPU, GPU, MOTHERBOARD, RAM, SSD_BOOT, SSD_SECONDARY, PSU, CASE, CPU_COOLER
```

### 1.3 Enum assessment

The enum **is sufficient** for the intended build model:

* It covers every hardware slot the Layer 1 schema supports (CPU, MOTHERBOARD, RAM, GPU, STORAGE via SSD_BOOT/SSD_SECONDARY, PSU, CASE, COOLER via CPU_COOLER).
* `SSD_BOOT` / `SSD_SECONDARY` distinguish boot vs secondary storage, which the engine needs for benchmark context and role-based scoring.
* `CPU_COOLER` unambiguously refers to the CPU cooler, avoiding a bare `COOLER` role that could be confused with case/radiator cooling.
* Multiple GPUs, RAM modules, and secondary SSDs are representable as multiple rows with the same role — compatible with the "allow multiples" design (§2.8).

No missing or incorrect values found. **Documented problem: none.** The enum will NOT be modified.

---

## 2. Proposed canonical Layer 4 changes

The migration will be named `011_reconcile_layer4.sql`. Every change below is idempotent and row-safe (all tables are empty, so constraint tightening has no data risk).

### 2.1 `build_component.price_checked_at` → TIMESTAMPTZ — CHANGE

Migration 010 established `TIMESTAMPTZ` (UTC) as canonical for market timestamps (`store_offer.last_checked_at`, `price_history.observed_at`). A price-snapshot timestamp is market data and must follow the same convention. Method, identical to 010:

```sql
ALTER TABLE build_component
    ALTER COLUMN price_checked_at TYPE TIMESTAMPTZ USING price_checked_at AT TIME ZONE 'UTC';
```

All tables are empty, so the USING clause is a no-op formality.

**Recommendation:** also convert all Layer 4 `created_at`/`updated_at` columns to TIMESTAMPTZ for one consistent project-wide timestamp convention (Layer 3 `store`/`store_offer` are TIMESTAMPTZ since 010). `price_checked_at` conversion is blocking; the generic timestamps are CHANGE (recommended) but could be deferred as FUTURE if a smaller diff is preferred.

### 2.2 Remove `build_component.category` — REMOVE

`component_role` fully identifies the component type; `category` duplicates it and is even nullable while `role` is NOT NULL. Keeping both invites divergence (e.g. role `SSD_SECONDARY` with category `CPU`). Remove:

```sql
ALTER TABLE build_component DROP COLUMN IF EXISTS category;
```

The `product_category` enum itself stays (owned by Layer 1, used by `product_candidate`).

### 2.3 `build_candidate.compatibility_status` NOT NULL DEFAULT 'UNKNOWN' — CHANGE

`CONTEXT.md` principle 5 ("NULL means UNKNOWN") applies to *specifications*; a build's evaluated compatibility is an engine *decision field* and must be explicit. A NULL here is ambiguous between "not yet evaluated" and "evaluated, data unknown" — precisely the ambiguity principle 6 forbids assuming away.

```sql
ALTER TABLE build_candidate
    ALTER COLUMN compatibility_status SET DEFAULT 'UNKNOWN',
    ALTER COLUMN compatibility_status SET NOT NULL;
```

The existing `compatibility_status` enum (PASS/FAIL/UNKNOWN/CONDITIONAL) is reused — no new enum.

### 2.4 `recommendation_query.scoring_model_id` NOT NULL — CHANGE

`CONTEXT.md` requires each query to record "which `scoring_model` version was used", and `scoring_model` exists so results are reproducible and comparable between algorithm versions. A query without a model cannot be reproduced.

```sql
ALTER TABLE recommendation_query ALTER COLUMN scoring_model_id SET NOT NULL;
```

Safe: table is empty.

### 2.5 Price validation — CHANGE

Align with the Layer 3 canon (`price > 0`, migrations 009/010). `total_price` stays nullable until the engine computes it, but must be positive when present.

```sql
ALTER TABLE build_component
    DROP CONSTRAINT IF EXISTS chk_build_component_selected_price_nonneg,
    ADD CONSTRAINT chk_build_component_selected_price_positive CHECK (selected_price > 0);

ALTER TABLE build_candidate
    DROP CONSTRAINT IF EXISTS chk_build_candidate_total_price_nonneg,
    ADD CONSTRAINT chk_build_candidate_total_price_positive
        CHECK (total_price IS NULL OR total_price > 0);
```

### 2.6 Snapshot consistency — CHANGE (new CHECK)

A store snapshot without a check time is meaningless:

```sql
ALTER TABLE build_component
    ADD CONSTRAINT chk_build_component_store_requires_checked_at
        CHECK (store_id IS NULL OR price_checked_at IS NOT NULL);
```

A stronger symmetric variant (`CHECK ((store_id IS NULL) = (price_checked_at IS NULL))`) would also forbid a check time without a store. The weaker form is proposed as blocking (matching the review decision); the symmetric form is FUTURE if the tighter guarantee is wanted.

### 2.7 Unique ranking — CHANGE (new partial unique index)

Two results of the same query must not share a non-NULL rank:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendation_result_query_rank
    ON recommendation_result (recommendation_query_id, rank)
    WHERE rank IS NOT NULL;
```

NULL ranks (e.g. "no build found" results) remain allowed and are not compared.

### 2.8 Component-role uniqueness — CHANGE (new partial unique index)

Exactly one CPU, MOTHERBOARD, PSU, CASE, CPU_COOLER, and SSD_BOOT per candidate; multiples of GPU, RAM, SSD_SECONDARY remain legal:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_build_component_role_singular
    ON build_component (build_candidate_id, component_role)
    WHERE component_role IN ('CPU','MOTHERBOARD','PSU','CASE','CPU_COOLER','SSD_BOOT');
```

One partial unique index with an IN-list is sufficient and cheaper than six separate indexes.

### 2.9 Additional indexes — ADD

```sql
CREATE INDEX IF NOT EXISTS idx_build_component_product_variant_id
    ON build_component (product_variant_id);
CREATE INDEX IF NOT EXISTS idx_build_component_store_id
    ON build_component (store_id);
```

The new unique `(query_id, rank)` index plus the existing `idx_recommendation_result_recommendation_query_id` cover query/rank access (the standalone query_id index stays KEEP — still needed for NULL-rank lookups).

### 2.10 `recommendation_profile.name` uniqueness — ADD

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_profile_name
    ON recommendation_profile (name);
```

Profiles are configuration-like named templates; duplicate names would make "load profile X" ambiguous.

### 2.11 `build_component.store_offer_id` — OPTIONAL ENHANCEMENT (not added by default)

Advantages:

* Full provenance: the exact retailer listing (store + product + variant + product_url + seller_name) that produced the snapshot price, not just the store.
* Enables post-hoc auditing of recommendation decisions against the offer that existed at decision time.
* No ownership conflict: `store_offer` is mutable current state; the snapshot columns on `build_component` stay authoritative for the *price*; the FK would only record *which* offer was sampled.

Disadvantages:

* Referential coupling to a mutable Layer 3 row: if a store_offer is ever deleted/pruned (Layer 3 has no such policy today, but nothing forbids one), components referencing it would need `ON DELETE SET NULL`, weakening provenance anyway.
* Increases cross-layer coupling (build_component → store_offer), a new dependency direction for Layer 4.
* Offers can be re-scraped/merged; the offer id may not stay a stable historical anchor, whereas `store_id + price_checked_at + selected_price + currency` already is.

**Recommendation: DO NOT add in migration 011.** The composite snapshot is sufficient for reproducibility. Adding a nullable FK later is a trivial, non-breaking `ALTER TABLE ADD COLUMN` + constraint if a real audit need appears. Classified FUTURE / NON-BLOCKING.

---

## 3. `recommendation_profile.priority` — design review (no change now)

Current state: `priority INTEGER` (nullable) on both `recommendation_profile` and `recommendation_query`.

* A single integer is **sufficient only as a coarse, temporary knob** (e.g. value-focused = 1, performance-focused = 3).
* The intended scoring architecture routes real weighting through the versioned `scoring_model.configuration JSONB` (Layer 2). Profile preferences should eventually be *named, structured weights* per assessment type (PERFORMANCE/VALUE/QUALITY/UPGRADEABILITY/THERMALS/EFFICIENCY), because:
  1. A scalar cannot express "prioritize value over thermals" — it has no dimension.
  2. The scoring model needs typed inputs to combine with benchmark data and component assessments.
  3. Reproducibility requires the exact weight set to be recorded with the query.
* Recommended evolution (FUTURE, NON-BLOCKING): keep `priority INTEGER` for now as a simple ordering hint; do not remove it in 011. When the scoring pipeline lands, either repurpose it as display/order priority with real weighting carried by the scoring-model configuration, or introduce a structured weighting concept owned by the scoring model rather than Layer 4 tables. Decision deferred; no DB change in 011.

---

## 4. Live vs documentation — full difference table

Legend: KEEP (live object is correct, codify as-is) · CHANGE (live object is wrong, correct in 011) · REMOVE (live object must be deleted) · ADD (missing object, create in 011) · FUTURE (non-blocking, defer).

| # | Object | Live Neon | Docs / review expectation | Class |
|---|---|---|---|---|
| 1 | Five Layer 4 tables exist | yes, empty | planned | KEEP (codify in 011) |
| 2 | `component_role` enum | exists | undocumented | KEEP (codify in 011) |
| 3 | `build_component.price_checked_at` | TIMESTAMP (naive), NULL | TIMESTAMPTZ | CHANGE |
| 4 | Layer 4 `created_at`/`updated_at` | TIMESTAMP (naive) | TIMESTAMPTZ (post-010 convention) | CHANGE (recommended) / FUTURE (acceptable defer) |
| 5 | `build_component.category` | product_category NULL | none — redundant | REMOVE |
| 6 | `build_candidate.compatibility_status` | nullable | NOT NULL DEFAULT 'UNKNOWN' | CHANGE |
| 7 | `recommendation_query.scoring_model_id` | nullable | NOT NULL (reproducibility) | CHANGE |
| 8 | `chk_build_component_selected_price_nonneg` (>=0) | exists | `> 0` | CHANGE |
| 9 | `chk_build_candidate_total_price_nonneg` (>=0) | exists | `> 0` when non-NULL | CHANGE |
| 10 | snapshot consistency CHECK | absent | store_id ⇒ price_checked_at | ADD |
| 11 | unique rank per query | absent | required | ADD |
| 12 | singular role uniqueness | absent | required | ADD |
| 13 | `idx_build_component_product_variant_id` | absent | required | ADD |
| 14 | `idx_build_component_store_id` | absent | required | ADD |
| 15 | `idx_recommendation_profile_name` | absent | required | ADD |
| 16 | `idx_recommendation_result_(query_id, rank)` | absent | required (unique index) | ADD |
| 17 | `build_component.store_offer_id` FK | absent | optional | FUTURE (do not add in 011) |
| 18 | `recommendation_profile.priority` INTEGER | exists | semantics undefined | FUTURE / NON-BLOCKING |
| 19 | `recommendation_query.priority` INTEGER | exists | same concern | FUTURE / NON-BLOCKING |
| 20 | `recommendation_result.build_candidate_id` nullable | nullable | allows "no build found" results | KEEP |
| 21 | `build_component` product NN / variant NULL FK pattern | as-is | matches Layer 3 `store_offer` convention | KEEP |
| 22 | `idx_recommendation_result_recommendation_query_id` | exists | still needed for NULL-rank lookups | KEEP |
| 23 | `chk_recommendation_query_budget_positive` (>0) | exists | matches review | KEEP |
| 24 | `chk_build_candidate_score_range` (0..100) | exists | matches review | KEEP |
| 25 | `chk_recommendation_result_rank_positive` (>0) | exists | matches review | KEEP |
| 26 | No JSONB anywhere in Layer 4 | confirmed | desired | KEEP |
| 27 | FK direction (L4 → L1/L2/L3 only, 9 FKs) | confirmed | desired | KEEP |
| 28 | `build_component` mutable with `updated_at` | exists | supports swap/recalculate | KEEP |
| 29 | `CONTEXT.md` Layer 4 section | tables listed as PLANNED | update to canonical after 011 | FUTURE (doc update after implementation) |
| 30 | DEVELOPMENT_NOTES Layer 4 drift entry | now documented (this session) | — | KEEP |

---

## 5. Migration 011 strategy

### 5.1 Goal

One migration, two paths, one identical end state:

```text
Fresh DB:      001 → … → 010 → 011 → canonical Layer 4
Existing Neon: existing (undocumented) Layer 4 objects → 011 → canonical Layer 4
```

### 5.2 Recommended shape (dual-mode, proven pattern from migrations 005 and 010)

1. **Safety gate (first statement)** — assert via `DO $$ ... RAISE EXCEPTION ... $$` that all five tables exist, all are 0 rows, and `component_role` exists with exactly the nine expected values. Abort otherwise. Mirrors the zero-row gate used before migration 010.
2. **Codify phase** — `CREATE TABLE IF NOT EXISTS` / guarded `CREATE TYPE` (DO $$ ... $$) for the five tables and the enum, written to match the *canonical* target where the difference is a plain column definition (e.g. fresh DBs get `price_checked_at TIMESTAMPTZ`, no `category` column, `scoring_model_id NOT NULL`, `compatibility_status NOT NULL DEFAULT 'UNKNOWN'`). For a fresh DB this creates Layer 4 correctly in one step.
3. **Reconcile phase** — idempotent repairs: `DROP COLUMN IF EXISTS category`; `ALTER COLUMN ... TYPE TIMESTAMPTZ USING ... AT TIME ZONE 'UTC'`; `SET NOT NULL` / `SET DEFAULT`; drop-and-re-add of price CHECKs under canonical names. Every statement safe to run twice and safe against either starting state (DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT pattern). On a fresh DB these are no-ops or equivalent renames; on Neon they are real repairs — exactly the technique migration 005 used for the same dual-path problem.
4. **Index phase** — `CREATE [UNIQUE] INDEX IF NOT EXISTS` for §2.7–2.10.

### 5.3 Constraints on the migration

* No data migration needed (0 rows everywhere).
* Do not touch migrations 001–010.
* Do not modify `product_category` or `compatibility_status`; `component_role` is only codified, never altered.
* After 011 is applied, `CONTEXT.md` Layer 4 section must be updated from PLANNED to canonical (separate doc change).

### 5.4 Fresh 001→011 verification

**NOT AVAILABLE.** No isolated scratch database (Docker, Neon branch, `TEST_DATABASE_URL`) exists. Per standing project policy, fresh-migration correctness must NOT be claimed. Options for later: Neon branch, Docker Compose Postgres, or a scratch `TEST_DATABASE_URL`.

---

## 6. Testing strategy — planned `scripts/test-layer4.js`

Follows the `test-layer3.js` / `test-compatibility.js` patterns: preflight → schema assertions → positive cases → negative cases (assertRejects) → FK-reverse-order cleanup. All fixture rows use a dedicated prefix (e.g. `TestL4%`) and are removed afterwards. Planned case list:

1. **Schema existence** — all five tables + `component_role` enum present.
2. **Columns** — exact column sets per table (absence of `category` after reconciliation, presence of canonical column names/types).
3. **Nullability** — `scoring_model_id` NOT NULL; `compatibility_status` NOT NULL; `component_role` NOT NULL; `selected_price` NOT NULL; `price_checked_at` nullable; `total_price` nullable; `rank` nullable; `build_candidate_id` on result nullable; variant/store nullable.
4. **Enum values** — `component_role` exactly the nine values; `compatibility_status` reused from Layer 1 (PASS/FAIL/UNKNOWN/CONDITIONAL).
5. **Foreign keys** — exact FK list matches §1.1 (9 FKs, directions L4 → L1/L2/L3 only); no Layer 4 objects referenced by Layers 1–3.
6. **CHECK constraints** — budget > 0; selected_price > 0; total_price > 0 when non-NULL; score 0..100; rank > 0; store ⇒ price_checked_at consistency.
7. **Unique indexes** — profile name; result (query_id, rank) partial; component-role singular partial.
8. **Valid build creation** — profile → query (with scoring model, budget, currency) → candidates → components with roles incl. multi-RAM / multi-SSD_SECONDARY / multi-GPU → results with explanation; verify `compatibility_status` defaults to 'UNKNOWN'.
9. **Multiple candidates** — ≥2 candidates for one query, each with its own component set and score.
10. **Multiple recommendation results** — ≥2 results per query with distinct ranks; a NULL-rank result also allowed.
11. **Unique ranking** — second result with the same (query_id, rank) must be rejected.
12. **Component-role uniqueness** — second CPU/PSU/MOTHERBOARD/CASE/CPU_COOLER/SSD_BOOT in one candidate rejected; second GPU/RAM/SSD_SECONDARY accepted.
13. **Price validation** — `selected_price = 0` rejected; negative rejected; `total_price = 0` rejected; positive values accepted.
14. **UNKNOWN compatibility status** — default 'UNKNOWN' on insert; explicit PASS/FAIL/CONDITIONAL accepted; NULL rejected.
15. **Scoring-model requirement** — query without `scoring_model_id` rejected.
16. **Timestamp behavior** — `price_checked_at` (and all Layer 4 timestamps after 011) report `timestamp with time zone`; a value inserted with an explicit timezone offset is stored/returned correctly.
17. **Store/price snapshot consistency** — component with `store_id` set but `price_checked_at` NULL rejected; both NULL accepted; both set accepted.
18. **Cleanup order** — delete in FK-reverse order: `recommendation_result` → `build_component` → `build_candidate` → `recommendation_query` → `recommendation_profile` → Layer 3 rows (`price_history`, `store_offer`, `store`) → Layer 2 rows (`benchmark_result`, `component_assessment`, `scoring_model`) → spec tables → `product_variant`/`gpu_board_spec` → `product` → seeded reference rows — preserving the established `TestCompat%` cleanup-ordering lesson, extended with the five Layer 4 tables.
19. **Regression** — after Layer 4 tests pass, `npm run test:db` and the existing verify scripts still pass. `test-compatibility.js` inserts/deletes only its own `TestCompat%` data and does not touch Layer 4 tables.
20. **Fresh 001→011 migration test** — **NOT AVAILABLE.** Must be reported as such and never claimed as passed until an isolated scratch database exists.

---

## 7. Safety summary

* Files modified this session: `DEVELOPMENT_NOTES.md` (Layer 4 drift entry + live-inspection lesson only).
* Files created this session: `database/LAYER4_RECONCILIATION_PLAN.md` (this file).
* Database modified: **NO** (read-only catalog SELECTs only).
* Migration 011 created: **NO**.
* Migration 011 applied: **NO**.
* Commit created: **NO**. Push performed: **NO**.
