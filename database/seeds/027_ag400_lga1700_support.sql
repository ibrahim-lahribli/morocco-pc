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
