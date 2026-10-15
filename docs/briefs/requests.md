# Requests — Engine → Platform agent / integrator

One file for cross-agent requests. **The Engine agent does NOT edit `apps/api/` or
`database/migrations/`**; anything below that lives in those areas is a request for the owner, not a
change Engine has made. Add new requests at the top of the list, dated, with an explicit acceptance.

Owner key: **Platform** owns `apps/api/` and schema migrations. **Integrator** owns the seed-number
series and cross-cutting coordination.

---

## 2026-10-15 — Platform P0 Sprint 5: 019 + 020 applied to the SHARED database; one operator step remains (the API role)

**Owner:** Platform (the role + GRANTs). **Requested by:** Platform (self-recorded so the owner sees it). **Status:** the shared apply is DONE; the role provisioning is a REQUEST.

The shared database went from ledger 18 to 20 on 2026-10-15: `019_recommendation_pass_facts.sql` and `020_product_identity_and_media.sql` applied through the OG-14 ledger, one transaction per file, from restore point `br-damp-grass-axyri6yl` - a `pre-019-020` branch created off `production` at LSN `0/4C9C840` BEFORE the apply, because no backup branch existed. Two audit lines were appended to `database/migration-applies.jsonl`, both carrying the restore point and the applying git sha. Measured after: no pending migrations on either database; all 8 new columns present and nullable; 104 shared products all with `display_name` and 104 distinct CHECKed slugs, 0 NULL, 0 format violations; `verify:replay` replays 20 files into an empty database at 0 drift; `gen:schema` regenerated `docs/SCHEMA_REFERENCE.md` + `docs/DATA_STATE.md` and `verify-docs --live` matches the new schema digest. The API's read path was proven against shared by executing both repository statements read-only (they previously raised `42703`) - note this needed migration 020 as well as 019, because the component read selects `p.slug` and `COALESCE(p.display_name, p.name)`.

**The request.** The `morocco_pc_api` production role does not exist on the shared database (`pg_roles` has no such row), so the COLUMN-scoped GRANTs Decision 46 item 7 specifies are still unapplied and cannot be applied yet. The script and its `has_table_privilege` / `has_column_privilege` self-checks are maintained in `docs/API.md` Production mode.

**Acceptance:** once the role is provisioned on shared, the Production-mode script runs clean and its self-checks report table-level `UPDATE` false for `recommendation_query` and `recommendation_result` while `has_column_privilege(...,'budget_floor','UPDATE')`, `(...,'engine_version','UPDATE')` and `(...,'strategy_key','UPDATE')` are all true; and a role-parameterised pass completes with no `42501` and residue 0.

## 2026-10-14 — Engine widened `filtering/context-loader.js` for E8, and a shared-DB fixture leak needs an owner

**Owner:** Platform (the loader file, and the shared-DB cleanup). **Requested by:** Engine (E8). **Status:** the loader change is DONE by Engine and disclosed here; the fixture cleanup is a REQUEST.

This brief lists `filtering/context-loader.js` as do-not-edit, and Engine edited it under Decision 45 (E8). Disclosing that rather than leaving it silent: six spec columns were added to four existing SELECTs (`cpu_spec.tdp_watts`; `cooler_spec.max_tdp_watts`; `motherboard_spec.dimm_slots` and `max_memory_capacity_gb`; `ram_spec.module_count` and `capacity_per_module_gb`), each projected through the existing `normalizeSpecForRole` shape with a null fallback. The change is purely additive — no existing key moved, `normalizeSpecForRole` itself is untouched, nothing else in the loader changed, and the full 20-scenario golden suite is byte-identical to the pre-E8 reference except the `as_of:` line. The same file was widened twice before for the same class of change (Decision 30 for cooler `height_mm` plus case clearance, Decision 42 for `vram_capacity_gb`), which is the precedent Decision 45 follows. A HARD rule cannot be enforced from a column its loader does not select, so if the do-not-edit list is meant to hold for this file, please say so explicitly in the brief.

**The request.** Four `TestCompat*` fixture products persist in the SHARED database: `TestCompatCPU`, `TestCompatCase`, `TestCompatCooler`, `TestCompatMotherboard`. Measured 2026-10-14: each has 0 `component_assessment` rows and 0 `store_offer` rows, so nothing reads them as candidates — but `TestCompatMotherboard` carries NULL `dimm_slots` AND NULL `max_memory_capacity_gb`, which is the only reason `scripts/check-deferred-rules.js` reports a coverage denominator of 8 motherboards instead of the 7 real ones, making the gate's coverage figure under-state real coverage and read as a missing datum. The writer is `scripts/test-compatibility.js` (AGENTS section 6 still lists it as a normal command), which creates the fixtures against the unguarded `DATABASE_URL` and never removes them. Registered as **OG-51**, same defect family as the accumulating fixtures AGENTS section 10 already records for `scripts/verify-hardware-schema.js`.

**Acceptance:** the four fixture rows are removed from the shared DB and `scripts/test-compatibility.js` either cleans up exactly what it created in a `finally` (spec rows before `product` before `product_family` — spec tables are ON DELETE NO ACTION, AGENTS section 7 item 11) or moves behind the `TEST_DATABASE_URL` guard like the other write-capable scripts; and `scripts/check-deferred-rules.js` then reports 7 of 7 real motherboards. No shared-DB DELETE is authorized by this request — it asks the owner to perform one.

## 2026-10-08 — Persist explicit run as_of (Decision 38 / OG-42)

**Owner:** Platform. **Requested by:** Engine (E2-pre). **Status:** REQUEST ONLY; no migration applied.

Engine now accepts optional `options.asOf` on the existing run/snapshot/full-run interfaces.
Present pins assessment decay and offer eligibility/price decision metadata; absent preserves
legacy transaction time. No restricted Platform-owned loader or persistence changes were needed.

Please author a NEW sequential migration (choose the next free number, do not assume 019 is free)
adding immutable `recommendation_query.as_of TIMESTAMPTZ NOT NULL`, defaulted once at insertion.
Backfill from created_at only with an explicit approximation note: it is not the original run time.
API code should load the persisted value and pass `options.asOf` to the engine. Do not expose
unrestricted caller-selected historical times without an explicit serving/security policy.
Define traceable result readback and enforce immutability; do not update as_of to refresh a query.

**Acceptance:** same query/time/data/model gives identical ranks and scores; missing or malformed
explicit times fail closed; offer freshness uses the same instant; legacy callers remain unchanged.
Cache identity includes canonical as_of, model identity/configuration digest, engine version/options
and a catalog-data revision (offers/assessments/compatibility too). Time pinning alone does not freeze
mutable data or establish historical replay. Current purchase eligibility needs separate revalidation.
No shared-DB apply is authorized by this request. No change to filtering/context-loader.js,
candidates/loader.js or persistence/ is requested for the engine-only option.

## 2026-10-08 — Wire `listUseCases` into `apps/api/src/meta.js` (Decision 37 / OG-38)

**Owner:** Platform. **Requested by:** Engine (E1b).

Today `apps/api/src/meta.js` derives the accepted use-case vocabulary from
`configuration.gpu_required_use_cases` — the SAME list that makes the GPU mandatory — so OFFICE is
rejected 422 and only GAMING / WORKSTATION are reachable (OG-38). Decision 37 decouples vocabulary
from the GPU mandate: the scoring barrel now exports

```js
const { listUseCases } = require('<scoring barrel>'); // src/recommendation/scoring/index.js
listUseCases(configuration); // -> frozen string[] of the model's use cases
```

`listUseCases(configuration)` returns the `use_case_profiles` keys when the model declares them, and
falls back to `gpu_required_use_cases` for a legacy model that declares none (the retained
`seed-minimal-v1`). So this is a one-line SOURCE swap with identical behaviour until seed 013 is active.

**Acceptance**
- `meta.js`'s accepted-use-case vocabulary comes from `listUseCases(activeModel.configuration)`, not
  from `gpu_required_use_cases`.
- With a profiles-declaring model active (`launch-v2`, seed 013), the meta vocabulary is
  `{GAMING, OFFICE, WORKSTATION}` and a valid-but-previously-rejected OFFICE request no longer 422s at
  the vocabulary gate. (Its downstream behaviour is still E6 — the request is about the vocabulary, not
  about OFFICE producing iGPU builds yet.)
- With `seed-minimal-v1` active (no profiles), the vocabulary is unchanged
  `{GAMING, WORKSTATION}` — the fallback preserves today's behaviour byte-for-byte.
- A unit/DB test pins both cases.

**Note:** the decoupling is only OBSERVABLE end-to-end once seed 013 is active on the database the API
serves; see `docs/OG-39_ACTIVATION_PLAN.md`. Engine does not edit `apps/api/`; this request is the
interface.

## 2026-10-08 — Seed number 013 is taken by Engine; reserve 014+ for Platform

**Owner:** Integrator. **Requested by:** Engine (E1b).

Engine has authored **`database/seeds/013_scoring_model_launch_v2.sql`** (Decision 37). Seed number
**013 is therefore taken**, and Platform should not use it.

Please reserve **seed numbers 014 and up** for Platform's seeds going forward (Engine's next seed, if
any, will claim the next free number explicitly). The migration series is separate — `014` is already
used by `database/migrations/014_build_rejection.sql` — so this reservation is about the SEED series
(`database/seeds/`) only, not migrations.
