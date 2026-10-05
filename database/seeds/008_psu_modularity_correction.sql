-- ===========================================================================
-- Seed 008: correct psu_spec.modularity for the Antec G850 (OG-31)
--
-- Gap: OG-31 (docs/OPEN_GAPS.md), registered 2026-10-04 during the seed 005
-- re-check. Layer-1 spec value `psu_spec.modularity` for
-- `Seed Antec G850 850W Gold` was stored as NON_MODULAR by seed 002, which
-- contradicts the published Semi-Modular design.
--
-- WHY THIS FILE EXISTS, and why it is not a cosmetic one:
--   * Seed 003 D7 and seed 005's first pass BOTH used `modularity` to
--     disambiguate the G850 from two confusable Antec units, and BOTH passes
--     were wrong as a result. A wrong Layer-1 value does not only mislead
--     queries, it misdirects RESEARCH - that is the recorded lesson.
--   * The live database already reads SEMI_MODULAR (corrected by hand on
--     2026-10-04), but NO committed seed or migration wrote that value and
--     `002_catalog_expansion.sql:683` still inserts NON_MODULAR. The tree
--     therefore did not match the live state: a fresh replay would silently
--     restore the wrong value and the next research pass would be misled
--     again. This file is what makes the correction REPRODUCIBLE.
--
-- THE VALUE, and its provenance. Re-verified independently for this seed
-- (2026-10-04) rather than copied from the 005 header, because a seed's own
-- citation must be re-fetchable by a second reader:
--   * ryans.com  - "Antec G-Series G850 850W Semi Modular Power Supply",
--                  spec table reads "PSU Category - Semi Modular",
--                  80 Plus Gold, 850W.
--   * amazon.in  - "Antec G850 850W 80+ Gold Power Supply Semi Modular".
--   * techlandbd - "Antec G850 Power Supply", "Semi-modular design for
--                  improved cable management".
--   * Regional retailer pages for the ATOM G850 (the near-identical SKU)
--                  also read "Semi-modular design": wootware.co.za and
--                  firstshop.co.za ("Modular: Semi-modular design").
--   * The manufacturer's own G-series listing is not directly quotable:
--     antec.com/product/power/hcg-gold850 is the HCG GOLD 850W, which is
--     Fully Modular, and antec.com/product/power/gsk-atx-850 is the GSK
--     ATX 850 - BOTH are DIFFERENT UNITS from the plain G850. That
--     distinction is the whole reason 003 D7 left the connector columns NULL,
--     and it is why a manufacturer page cannot settle this field.
--
--   Consensus across five independent retailers is Semi-Modular. This seed
--   writes SEMI_MODULAR and nothing else about the row.
--
-- SCOPE - deliberately the narrowest possible correction:
--   * ONE column, ONE row. `modularity` is read by NO engine module
--     (grep-verified across `src/`), so this is inert for compatibility and
--     cannot change any recommendation, score or rank. It matters for
--     research integrity only.
--   * The connector columns are NOT touched here. Seed 005 already filled
--     them (eps 2 / pcie_8pin 4 / 12vhpwr 0 / sata 8) and that is a separate,
--     already-closed concern.
--
-- CONVENTIONS (identical to 005/006/007):
--   * DML only, no DDL. Single BEGIN/COMMIT: all-or-nothing per run.
--   * Seed rows only, matched by exact product name - never a LIKE that
--     could catch a real product.
--   * ASCII only.
--   * THIS UPDATE OVERWRITES rather than COALESCEs, and that is the point:
--     the stored value is wrong, so "only fill NULLs" would be a no-op and
--     would leave the tree unreproducible. Idempotency is instead guaranteed
--     by the `AND ps.modularity IS DISTINCT FROM 'SEMI_MODULAR'` guard, so a
--     second run changes zero rows.
--   * The guard is in the DML, not only in this header, so a row that is
--     already correct is provably left alone.
-- ===========================================================================

BEGIN;

UPDATE psu_spec ps
   SET modularity = 'SEMI_MODULAR',
       updated_at = NOW()
  FROM product p
 WHERE p.id = ps.product_id
   AND p.name = 'Seed Antec G850 850W Gold'
   AND ps.modularity IS DISTINCT FROM 'SEMI_MODULAR';

COMMIT;