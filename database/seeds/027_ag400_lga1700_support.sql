-- ============================================================================
-- Seed 027: the DeepCool AG400 supports LGA1700 - the row seed 024 named as absent
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- Seed 024 (the platform-cost axis) recorded this gap and deliberately did NOT
-- write the row:
--
--   "`cooler_socket_support` rows for AM5 only, so the cheapest LGA1700 cooler
--    in the catalog is the 699 MAD MSI COREFROZR. With an AG400 LGA1700 row the
--    same build is 11694 and fits. That row is NOT written here - it asserts
--    per-socket vendor support and belongs to its own evidence-bearing change,
--    not to a price-and-spec seed."
--
-- This is that change. Measured on the shared database 2026-10-31:
--
--   * `cooler_socket_support` holds 21 rows. 7 of the 8 catalog coolers carry an
--     LGA1700 row; `Seed DeepCool AG400` carries exactly ONE row, and it is AM5.
--   * LGA1700 has 2 catalog CPUs: `Seed Intel Core i5-12400F` (65 W) and
--     `Seed Intel Core i7-12700KF` (125 W). The AG400 is rated 220 W, so the
--     thermal side is not in question; what is missing is the MOUNTING claim.
--   * `compatibility/cooler.js` resolves "no matching row" as UNKNOWN
--     (`COOLER_SOCKET_SUPPORT_UNKNOWN`) - eligible, never rejected - and every
--     UNKNOWN pair costs one `unknown_compat_penalty` (5 points of `build_score`
--     in all five active models). So this gap is paid by builds, not by
--     correctness: an AG400 + LGA1700 build is scored as if its mounting were
--     unknown.
--
-- EVIDENCE (vendor, not derived)
--
--   DeepCool AG400 product page, "Application For":
--     Intel LGA1851/1700/1200/1151/1150/1155
--     AMD   AM5/AM4
--   and, under "Simple and Secure": "The included mounting brackets support
--   both Intel and AMD platforms".
--
--   https://www.deepcool.com/products/Cooling/cpuaircoolers/GAMMAXX-AG400-Single-Tower-CPU-Cooler-1851-1700-AM5/2024/15898.shtml
--
--   Read 2026-10-31 (HTTP 200). The product's dimension and height rows already
--   come from this same page - seeds 010 (height 150) and 026 (footprint
--   125x92) - so this row does not introduce a new source.
--
-- SCOPE - what this file deliberately does NOT do
--
--   * LGA1700 ONLY. The vendor also lists LGA1851/1200/1151/1150/1155, but the
--     `socket` table holds only AM4, AM5 and LGA1700: a row for any other
--     socket would reference a socket that does not exist, and adding sockets
--     the catalog has no CPU for buys nothing.
--   * NO AM4 row, even though the same page lists AM4. AM4 is a separate claim
--     with its own build economics (the cheap AM4 parts are what OG-58 is
--     about), so it stays its own change instead of riding in on this one.
--   * NO price, spec, assessment or offer change. This is a compatibility claim
--     only, and it is additive: nothing is updated or deleted.
--
-- TRIGGER (Decision 26 item 11 - mandatory before merging a cooler seed):
--   this row makes two previously unreachable pairs reachable, because
--   `scripts/check-deferred-rules.js` counts the "reachable (non-FAIL
--   cooler_socket_support)" scope for the SOFT cooler-TDP rule (OG-09). 0
--   violations is a READING to take after applying, not an assumption; the
--   AG400 is rated 220 W against 65 / 125 W CPUs, so rule (i) is expected to
--   evaluate cleanly.
--
-- APPLY: `npm run seed` (DML-only, idempotent, no BEGIN/COMMIT so the file can
-- be rollback-rehearsed). Nothing here is destructive.
-- ============================================================================

INSERT INTO cooler_socket_support (cooler_product_id, socket_id, support_status,
    mounting_note)
SELECT p.id, s.id, 'PASS', 'Seed: LGA1700 mounting included (DeepCool AG400 bracket)'
FROM product p
JOIN socket s ON s.name = 'LGA1700'
WHERE p.name = 'Seed DeepCool AG400'
  -- Constrain the TYPE as well as the name: a name-only guard would honour any
  -- product that happened to carry this name, and this file only asserts an AIR
  -- tower's mounting kit.
  AND EXISTS (
      SELECT 1 FROM cooler_spec cs
      WHERE cs.product_id = p.id AND cs.cooling_type = 'AIR'
  )
  AND NOT EXISTS (
      SELECT 1 FROM cooler_socket_support c
      WHERE c.cooler_product_id = p.id AND c.socket_id = s.id
  );

-- ============================================================================
-- MEASURED AFTER APPLY (TEST branch, 2026-11-01, branch head 66a4609, pin
-- launch-v2@2.4.0)
-- ============================================================================
--
-- Applied branch-first through `getWriteTestDbUrl()` + `SET search_path = public`:
-- rowCount 1, and a second run rowCount 0 (idempotent). The full golden suite was then
-- run twice - once with this row un-applied, once applied, nothing else differing - and
-- the two reports are IDENTICAL: 86 assertion rows, 82 PASS / 3 EXPECTED-RED / 1
-- UNKNOWN, `RESULT: EXPECTED-RED`, exit 0, residue {q:0,bc:0,comp:0,res:0,rej:0} in
-- both. The only textual difference between the runs was the node PID.
--
-- So this row is CORRECT and reach-positive, and it is NOT sufficient on its own. The
-- resolver flips `Seed DeepCool AG400` x LGA1700 from UNKNOWN
-- (COOLER_SOCKET_SUPPORT_UNKNOWN) to PASS, and the 5-point unknown penalty on that pair
-- is gone - but the LGA1700 lane still assembles nothing: S06 (GAMING 1440p, 12000 MAD),
-- the pass seed 024 used to price the gap, selects the same builds and the same rank-1
-- prices (11995 / 19546 / 23794) before and after.
--
-- WHAT IS MEASURABLY NOT THE BLOCKER (all read from the same TEST catalog the run used):
--   * supply - 3 LGA1700 CPUs (`i5-12400F` 1549, `i5-14400` 1899 with an iGPU,
--     `i7-12700KF` 2699) and 3 LGA1700 boards from 899,
--   * cooler price - with this row the AG400 is 350 MAD against the 699 MAD
--     MSI COREFROZR, i.e. the 349 MAD seed 024 priced,
--   * case clearance - every one of the 10 catalog cases clears the AG400 150 mm
--     (the cheapest, 849 MAD, clears 160 mm), and the AG400 is rated 220 W so the
--     65 W `i5-14400` is not a thermal problem either.
--
-- The residual blocker therefore sits inside the assembly/reach path, not in the
-- catalog. Tracing it is engine-seat work and is deliberately NOT claimed here: this
-- file asserts vendor support, which is settled, and leaves the lane question open.

-- ============================================================================
-- APPLIED TO SHARED (2026-11-01, owner-authorised)
-- ============================================================================
--
-- Restore point: br-restless-art-ax6fineh ("pre-027-seed"), parent
-- br-proud-salad-axs4rxib, parent LSN 0/616AA50, created 2026-11-01T00:51:43Z with
-- no compute. Audit target of the applied database: db:54ff6ea3f6e6.
--
-- Applied through `npm run seed` (the documented path in docs/RECIPES/add-a-seed.md),
-- exit 0 on every run. A digest of every catalog table (all *_spec, product,
-- product_family, store, store_offer, cooler_socket_support, scoring_model) taken
-- after run 2 and after run 3 is IDENTICAL, which is the idempotency proof - the
-- earlier "changed" reading was dotenv's per-run banner line, not data.
--
-- SCOPE NOTE, recorded because it is bigger than this file: the seed runner replays
-- EVERY seed file, and shared had never carried 023, 024, 025 or 026. Applying this
-- seed therefore also brought them over - products 100 -> 113, offers 101 -> 114,
-- assessments 112 -> 319, cooler_socket_support rows 21 -> 22, coolers with an
-- LGA1700 row 7/9 -> 8/9. `check-target-parity` shared vs TEST now MATCHes on product
-- (113), component_assessment (319) and scoring_model (7). The remaining DIFFs are
-- store_offer (114 vs 116), store (2 vs 5) and the Layer 4 rows that the shared
-- database carries from API passes.
--
-- GATES AFTER THE APPLY (all on the shared database):
--   check-deferred-rules        PASS - 0 violations in every scope, all four rules
--                               ENFORCED. OG-09 reachable pairs 108 -> 135 (the
--                               AG400 LGA1700 row plus the coolers 023-026 added)
--   check-og01-coverage         PASS - OG-01 coverage complete, pin launch-v2@2.4.0
--   verify-docs --live          OK - schema digest unchanged (4110c1517a14a0ef),
--                               so this seed moved DATA_STATE, not the schema
--   npm run test:unit           exit 0
--
--
-- SCOPE NOTE 2 - the consequence that outlives this seed (2026-11-01):
--   Because the runner replays EVERY file, this apply added far more than one
--   row: shared now holds SIX ACTIVE `launch-v2` versions and
--   `seed-minimal-v1@1.0.0` is INACTIVE there, and
--   `apps/api/src/repository.js` picks the NEWEST active row - so the deployed
--   demo origin now serves `launch-v2@2.4.0`, not the v1 model Decision 57
--   keeps production on. Recorded in OG-54 and DEVELOPMENT_NOTES; resolving it
--   (restore the shared model set, or amend Decision 57) is an owner decision,
--   not a seed edit. The schema did not move - `gen-schema-reference --check`
--   re-verified both generated docs on 2026-11-01.
