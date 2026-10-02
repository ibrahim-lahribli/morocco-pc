'use strict';

/**
 * Decision 26 item B violation gate — the four DEFERRED HARD rules
 * (OG-09, OG-10, OG-11, OG-12). Read-only; shared-DB safe.
 *
 * Why this exists: architecture §5.3/§6 specify four HARD rules that no
 * non-test module in `src/` implements — nothing reads `max_tdp_watts`,
 * `height_mm`, `max_cpu_cooler_height_mm`, `module_count` or
 * `max_memory_capacity_gb`. Decision 26 (2026-09-28) item B recorded them
 * as EXPLICITLY DEFERRED and UNENFORCED, which is only safe while the
 * catalog violates none of them (0 live violations measured 2026-09-28,
 * hence the "IMPORTANT (latent)" class in `docs/OPEN_GAPS.md`).
 *
 * Decision 26 item 11 makes the re-check BINDING: "Any future seed that
 * adds or edits a CPU, cooler, case, motherboard or RAM row MUST re-run
 * the four violation queries before merge" — repeated as step 3 of
 * `docs/RECIPES/add-a-seed.md`. Until now those queries existed only as a
 * one-off paste. This script makes the trigger re-runnable, in the same
 * spirit as `scripts/check-og01-coverage.js` becoming the OG-01 gate, so
 * a seed author runs one command instead of reconstructing four SQL
 * statements (and cannot silently skip a scope).
 *
 * The rules, verbatim from Decision 26 item 7:
 *   (i)   cooler_spec.max_tdp_watts < cpu_spec.tdp_watts                 -> REJECT  (OG-09)
 *   (ii)  AIR cooler_spec.height_mm > case_spec.max_cpu_cooler_height_mm -> REJECT  (OG-10)
 *   (iii) ram_spec.module_count > motherboard_spec.dimm_slots            -> REJECT  (OG-11)
 *   (iv)  ram_spec.module_count * ram_spec.capacity_per_module_gb
 *         > motherboard_spec.max_memory_capacity_gb                      -> REJECT  (OG-12)
 *
 * Two scopes per rule, mirroring how Decision 26 item 10 measured them:
 *   catalog   — every combination of the two roles in the ACTIVE catalog;
 *   reachable — only combinations the engine could actually build: cooler<->CPU
 *               joined through non-FAIL `cooler_socket_support`, and
 *               RAM<->motherboard with a matching `memory_type_id`. A rule
 *               violation in either scope is a real unsafe build, so BOTH
 *               must stay at zero; the reachable scope is what actually
 *               reaches a recommendation today.
 * Rule (ii) is catalog-scope only: case<->cooler height is not an engine
 * pair (no compatibility table carries it), so there is no reachable subset
 * to narrow it to.
 *
 * NULL policy (architecture §5.3, unimplemented for the same reason): a NULL
 * on either side is UNKNOWN — never "unlimited", never a violation. Those
 * pairs are counted and printed as `not-measured` so the exposure stays
 * visible instead of being silently assumed safe.
 *
 * Only ACTIVE products are measured, matching `scripts/lib/og01-catalog.js`.
 *
 * Read-only: SELECT-only against `DATABASE_URL`. It never writes, so it needs
 * no `TEST_DATABASE_URL` guard (same reasoning as the OG-01 gate).
 *
 * Usage:
 *   node scripts/check-deferred-rules.js
 * Exit codes: 0 = no violation (rules stay latent); 1 = at least one
 * violation, or the catalog could not be read; 2 = usage error.
 */

require('dotenv').config();
const { Client } = require('pg');

const ARGS = process.argv.slice(2);
if (ARGS.length > 0) {
  console.error('usage: node scripts/check-deferred-rules.js');
  process.exit(2);
}

/** Violating pairs are listed up to this many rows per scope, then truncated. */
const MAX_LISTED = 20;

/** Non-FAIL cooler<->CPU compatibility rows make the pair buildable. */
const REACHABLE_COOLER_CPU = `AND EXISTS (
      SELECT 1
        FROM cooler_socket_support css
       WHERE css.cooler_product_id = cs.product_id
         AND css.socket_id = xs.socket_id
         AND css.support_status <> 'FAIL')`;

/** A RAM kit is only installable in a board of the same memory type. */
const REACHABLE_RAM_MB = 'AND ms.memory_type_id = rs.memory_type_id';

/**
 * The four rules. Each scope is one aggregate query (evaluated /
 * not-measured / violations counts) plus the detail query used only when the
 * count is non-zero, so a healthy catalog costs four cheap aggregates.
 */
const RULES = [
  {
    id: 'OG-09',
    label: 'cooler max_tdp_watts < CPU tdp_watts',
    pairs: 'cooler x CPU',
    scopes: [
      {
        name: 'catalog',
        sql: `SELECT
    count(*) FILTER (WHERE cs.max_tdp_watts IS NOT NULL AND xs.tdp_watts IS NOT NULL)::int AS evaluated,
    count(*) FILTER (WHERE cs.max_tdp_watts IS NULL OR xs.tdp_watts IS NULL)::int AS not_measured,
    count(*) FILTER (WHERE cs.max_tdp_watts IS NOT NULL AND xs.tdp_watts IS NOT NULL
                       AND cs.max_tdp_watts < xs.tdp_watts)::int AS violations
  FROM cooler_spec cs
  JOIN product cp ON cp.id = cs.product_id AND cp.lifecycle_status = 'ACTIVE'
 CROSS JOIN cpu_spec xs
  JOIN product xp ON xp.id = xs.product_id AND xp.lifecycle_status = 'ACTIVE'`,
        detail: `SELECT cp.name AS cooler, xp.name AS cpu,
       cs.max_tdp_watts AS cooler_max_tdp_watts, xs.tdp_watts AS cpu_tdp_watts
  FROM cooler_spec cs
  JOIN product cp ON cp.id = cs.product_id AND cp.lifecycle_status = 'ACTIVE'
 CROSS JOIN cpu_spec xs
  JOIN product xp ON xp.id = xs.product_id AND xp.lifecycle_status = 'ACTIVE'
 WHERE cs.max_tdp_watts IS NOT NULL
   AND xs.tdp_watts IS NOT NULL
   AND cs.max_tdp_watts < xs.tdp_watts
 ORDER BY cp.name ASC, xp.name ASC`,
      },
      {
        name: 'reachable (non-FAIL cooler_socket_support)',
        sql: `SELECT
    count(*) FILTER (WHERE cs.max_tdp_watts IS NOT NULL AND xs.tdp_watts IS NOT NULL)::int AS evaluated,
    count(*) FILTER (WHERE cs.max_tdp_watts IS NULL OR xs.tdp_watts IS NULL)::int AS not_measured,
    count(*) FILTER (WHERE cs.max_tdp_watts IS NOT NULL AND xs.tdp_watts IS NOT NULL
                       AND cs.max_tdp_watts < xs.tdp_watts)::int AS violations
  FROM cooler_spec cs
  JOIN product cp ON cp.id = cs.product_id AND cp.lifecycle_status = 'ACTIVE'
 CROSS JOIN cpu_spec xs
  JOIN product xp ON xp.id = xs.product_id AND xp.lifecycle_status = 'ACTIVE'
 WHERE 1 = 1 ${REACHABLE_COOLER_CPU}`,
        detail: `SELECT cp.name AS cooler, xp.name AS cpu,
       cs.max_tdp_watts AS cooler_max_tdp_watts, xs.tdp_watts AS cpu_tdp_watts
  FROM cooler_spec cs
  JOIN product cp ON cp.id = cs.product_id AND cp.lifecycle_status = 'ACTIVE'
 CROSS JOIN cpu_spec xs
  JOIN product xp ON xp.id = xs.product_id AND xp.lifecycle_status = 'ACTIVE'
 WHERE cs.max_tdp_watts IS NOT NULL
   AND xs.tdp_watts IS NOT NULL
   AND cs.max_tdp_watts < xs.tdp_watts
   ${REACHABLE_COOLER_CPU}
 ORDER BY cp.name ASC, xp.name ASC`,
      },
    ],
  },
  {
    id: 'OG-10',
    label: 'AIR cooler height_mm > case max_cpu_cooler_height_mm',
    pairs: 'AIR cooler x case',
    scopes: [
      {
        name: 'catalog',
        sql: `SELECT
    count(*) FILTER (WHERE cs.height_mm IS NOT NULL AND ks.max_cpu_cooler_height_mm IS NOT NULL)::int AS evaluated,
    count(*) FILTER (WHERE cs.height_mm IS NULL OR ks.max_cpu_cooler_height_mm IS NULL)::int AS not_measured,
    count(*) FILTER (WHERE cs.height_mm IS NOT NULL AND ks.max_cpu_cooler_height_mm IS NOT NULL
                       AND cs.height_mm > ks.max_cpu_cooler_height_mm)::int AS violations
  FROM cooler_spec cs
  JOIN product cp ON cp.id = cs.product_id AND cp.lifecycle_status = 'ACTIVE'
 CROSS JOIN case_spec ks
  JOIN product kp ON kp.id = ks.product_id AND kp.lifecycle_status = 'ACTIVE'
 WHERE cs.cooling_type = 'AIR'`,
        detail: `SELECT cp.name AS cooler, kp.name AS chassis,
       cs.height_mm AS cooler_height_mm, ks.max_cpu_cooler_height_mm AS case_max_height_mm
  FROM cooler_spec cs
  JOIN product cp ON cp.id = cs.product_id AND cp.lifecycle_status = 'ACTIVE'
 CROSS JOIN case_spec ks
  JOIN product kp ON kp.id = ks.product_id AND kp.lifecycle_status = 'ACTIVE'
 WHERE cs.cooling_type = 'AIR'
   AND cs.height_mm IS NOT NULL
   AND ks.max_cpu_cooler_height_mm IS NOT NULL
   AND cs.height_mm > ks.max_cpu_cooler_height_mm
 ORDER BY cp.name ASC, kp.name ASC`,
      },
    ],
  },
  {
    id: 'OG-11',
    label: 'RAM module_count > motherboard dimm_slots',
    pairs: 'RAM kit x motherboard',
    scopes: [
      {
        name: 'catalog',
        sql: `SELECT
    count(*) FILTER (WHERE rs.module_count IS NOT NULL AND ms.dimm_slots IS NOT NULL)::int AS evaluated,
    count(*) FILTER (WHERE rs.module_count IS NULL OR ms.dimm_slots IS NULL)::int AS not_measured,
    count(*) FILTER (WHERE rs.module_count IS NOT NULL AND ms.dimm_slots IS NOT NULL
                       AND rs.module_count > ms.dimm_slots)::int AS violations
  FROM ram_spec rs
  JOIN product rp ON rp.id = rs.product_id AND rp.lifecycle_status = 'ACTIVE'
 CROSS JOIN motherboard_spec ms
  JOIN product mp ON mp.id = ms.product_id AND mp.lifecycle_status = 'ACTIVE'`,
        detail: `SELECT rp.name AS kit, mp.name AS motherboard,
       rs.module_count AS module_count, ms.dimm_slots AS dimm_slots
  FROM ram_spec rs
  JOIN product rp ON rp.id = rs.product_id AND rp.lifecycle_status = 'ACTIVE'
 CROSS JOIN motherboard_spec ms
  JOIN product mp ON mp.id = ms.product_id AND mp.lifecycle_status = 'ACTIVE'
 WHERE rs.module_count IS NOT NULL
   AND ms.dimm_slots IS NOT NULL
   AND rs.module_count > ms.dimm_slots
 ORDER BY rp.name ASC, mp.name ASC`,
      },
      {
        name: 'reachable (matching memory_type_id)',
        sql: `SELECT
    count(*) FILTER (WHERE rs.module_count IS NOT NULL AND ms.dimm_slots IS NOT NULL)::int AS evaluated,
    count(*) FILTER (WHERE rs.module_count IS NULL OR ms.dimm_slots IS NULL)::int AS not_measured,
    count(*) FILTER (WHERE rs.module_count IS NOT NULL AND ms.dimm_slots IS NOT NULL
                       AND rs.module_count > ms.dimm_slots)::int AS violations
  FROM ram_spec rs
  JOIN product rp ON rp.id = rs.product_id AND rp.lifecycle_status = 'ACTIVE'
 CROSS JOIN motherboard_spec ms
  JOIN product mp ON mp.id = ms.product_id AND mp.lifecycle_status = 'ACTIVE'
 WHERE ms.memory_type_id = rs.memory_type_id`,
        detail: `SELECT rp.name AS kit, mp.name AS motherboard,
       rs.module_count AS module_count, ms.dimm_slots AS dimm_slots
  FROM ram_spec rs
  JOIN product rp ON rp.id = rs.product_id AND rp.lifecycle_status = 'ACTIVE'
 CROSS JOIN motherboard_spec ms
  JOIN product mp ON mp.id = ms.product_id AND mp.lifecycle_status = 'ACTIVE'
 WHERE ms.memory_type_id = rs.memory_type_id
   AND rs.module_count IS NOT NULL
   AND ms.dimm_slots IS NOT NULL
   AND rs.module_count > ms.dimm_slots
 ORDER BY rp.name ASC, mp.name ASC`,
      },
    ],
  },
  {
    id: 'OG-12',
    label: 'RAM module_count * capacity_per_module_gb > motherboard max_memory_capacity_gb',
    pairs: 'RAM kit x motherboard',
    scopes: [
      {
        name: 'catalog',
        sql: `SELECT
    count(*) FILTER (WHERE rs.module_count IS NOT NULL AND rs.capacity_per_module_gb IS NOT NULL
                       AND ms.max_memory_capacity_gb IS NOT NULL)::int AS evaluated,
    count(*) FILTER (WHERE rs.module_count IS NULL OR rs.capacity_per_module_gb IS NULL
                       OR ms.max_memory_capacity_gb IS NULL)::int AS not_measured,
    count(*) FILTER (WHERE rs.module_count IS NOT NULL AND rs.capacity_per_module_gb IS NOT NULL
                       AND ms.max_memory_capacity_gb IS NOT NULL
                       AND rs.module_count * rs.capacity_per_module_gb > ms.max_memory_capacity_gb)::int AS violations
  FROM ram_spec rs
  JOIN product rp ON rp.id = rs.product_id AND rp.lifecycle_status = 'ACTIVE'
 CROSS JOIN motherboard_spec ms
  JOIN product mp ON mp.id = ms.product_id AND mp.lifecycle_status = 'ACTIVE'`,
        detail: `SELECT rp.name AS kit, mp.name AS motherboard,
       rs.module_count * rs.capacity_per_module_gb AS kit_total_gb,
       ms.max_memory_capacity_gb AS board_max_gb
  FROM ram_spec rs
  JOIN product rp ON rp.id = rs.product_id AND rp.lifecycle_status = 'ACTIVE'
 CROSS JOIN motherboard_spec ms
  JOIN product mp ON mp.id = ms.product_id AND mp.lifecycle_status = 'ACTIVE'
 WHERE rs.module_count IS NOT NULL
   AND rs.capacity_per_module_gb IS NOT NULL
   AND ms.max_memory_capacity_gb IS NOT NULL
   AND rs.module_count * rs.capacity_per_module_gb > ms.max_memory_capacity_gb
 ORDER BY rp.name ASC, mp.name ASC`,
      },
      {
        name: 'reachable (matching memory_type_id)',
        sql: `SELECT
    count(*) FILTER (WHERE rs.module_count IS NOT NULL AND rs.capacity_per_module_gb IS NOT NULL
                       AND ms.max_memory_capacity_gb IS NOT NULL)::int AS evaluated,
    count(*) FILTER (WHERE rs.module_count IS NULL OR rs.capacity_per_module_gb IS NULL
                       OR ms.max_memory_capacity_gb IS NULL)::int AS not_measured,
    count(*) FILTER (WHERE rs.module_count IS NOT NULL AND rs.capacity_per_module_gb IS NOT NULL
                       AND ms.max_memory_capacity_gb IS NOT NULL
                       AND rs.module_count * rs.capacity_per_module_gb > ms.max_memory_capacity_gb)::int AS violations
  FROM ram_spec rs
  JOIN product rp ON rp.id = rs.product_id AND rp.lifecycle_status = 'ACTIVE'
 CROSS JOIN motherboard_spec ms
  JOIN product mp ON mp.id = ms.product_id AND mp.lifecycle_status = 'ACTIVE'
 WHERE ms.memory_type_id = rs.memory_type_id`,
        detail: `SELECT rp.name AS kit, mp.name AS motherboard,
       rs.module_count * rs.capacity_per_module_gb AS kit_total_gb,
       ms.max_memory_capacity_gb AS board_max_gb
  FROM ram_spec rs
  JOIN product rp ON rp.id = rs.product_id AND rp.lifecycle_status = 'ACTIVE'
 CROSS JOIN motherboard_spec ms
  JOIN product mp ON mp.id = ms.product_id AND mp.lifecycle_status = 'ACTIVE'
 WHERE ms.memory_type_id = rs.memory_type_id
   AND rs.module_count IS NOT NULL
   AND rs.capacity_per_module_gb IS NOT NULL
   AND ms.max_memory_capacity_gb IS NOT NULL
   AND rs.module_count * rs.capacity_per_module_gb > ms.max_memory_capacity_gb
 ORDER BY rp.name ASC, mp.name ASC`,
      },
    ],
  },
];

/**
 * Column coverage behind the gate: how much of each rule is actually
 * measurable today. Decision 26 item 10 recorded these figures by hand;
 * printing them makes a NULL regression (a seed that blanks a column)
 * visible instead of silently shrinking `evaluated`.
 */
const COVERAGE_SQL = `SELECT
  (SELECT count(*)::int FROM cooler_spec cs JOIN product p ON p.id = cs.product_id
     WHERE p.lifecycle_status = 'ACTIVE' AND cs.max_tdp_watts IS NOT NULL)
    || '/' ||
  (SELECT count(*)::int FROM cooler_spec cs JOIN product p ON p.id = cs.product_id
     WHERE p.lifecycle_status = 'ACTIVE') AS coolers_tdp,
  (SELECT count(*)::int FROM cpu_spec xs JOIN product p ON p.id = xs.product_id
     WHERE p.lifecycle_status = 'ACTIVE' AND xs.tdp_watts IS NOT NULL)
    || '/' ||
  (SELECT count(*)::int FROM cpu_spec xs JOIN product p ON p.id = xs.product_id
     WHERE p.lifecycle_status = 'ACTIVE') AS cpus_tdp,
  (SELECT count(*)::int FROM cooler_spec cs JOIN product p ON p.id = cs.product_id
     WHERE p.lifecycle_status = 'ACTIVE' AND cs.cooling_type = 'AIR' AND cs.height_mm IS NOT NULL)
    || '/' ||
  (SELECT count(*)::int FROM cooler_spec cs JOIN product p ON p.id = cs.product_id
     WHERE p.lifecycle_status = 'ACTIVE' AND cs.cooling_type = 'AIR') AS air_coolers_height,
  (SELECT count(*)::int FROM case_spec ks JOIN product p ON p.id = ks.product_id
     WHERE p.lifecycle_status = 'ACTIVE' AND ks.max_cpu_cooler_height_mm IS NOT NULL)
    || '/' ||
  (SELECT count(*)::int FROM case_spec ks JOIN product p ON p.id = ks.product_id
     WHERE p.lifecycle_status = 'ACTIVE') AS cases_cooler_height,
  (SELECT count(*)::int FROM ram_spec rs JOIN product p ON p.id = rs.product_id
     WHERE p.lifecycle_status = 'ACTIVE' AND rs.module_count IS NOT NULL
       AND rs.capacity_per_module_gb IS NOT NULL)
    || '/' ||
  (SELECT count(*)::int FROM ram_spec rs JOIN product p ON p.id = rs.product_id
     WHERE p.lifecycle_status = 'ACTIVE') AS ram_kits_module_data,
  (SELECT count(*)::int FROM motherboard_spec ms JOIN product p ON p.id = ms.product_id
     WHERE p.lifecycle_status = 'ACTIVE' AND ms.dimm_slots IS NOT NULL
       AND ms.max_memory_capacity_gb IS NOT NULL)
    || '/' ||
  (SELECT count(*)::int FROM motherboard_spec ms JOIN product p ON p.id = ms.product_id
     WHERE p.lifecycle_status = 'ACTIVE') AS boards_memory_limits;`;

/** Detail-row columns that hold product names (the rest are the measured values). */
const NAME_KEYS = new Set(['cooler', 'cpu', 'kit', 'chassis', 'motherboard']);

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();

    console.log('Decision 26 item B violation gate (read-only, DATABASE_URL)');
    console.log(
      'The four DEFERRED HARD rules (architecture 5.3/6) are UNENFORCED in src/; ' +
        'this gate is the binding pre-merge re-check (Decision 26 item 11).'
    );

    const coverage = (await client.query(COVERAGE_SQL)).rows[0];
    console.log('');
    console.log(
      'Column coverage (known/total ACTIVE): coolers TDP ' +
        coverage.coolers_tdp +
        ' | CPUs TDP ' +
        coverage.cpus_tdp +
        ' | AIR coolers height ' +
        coverage.air_coolers_height +
        ' | cases cooler height ' +
        coverage.cases_cooler_height +
        ' | RAM kits module data ' +
        coverage.ram_kits_module_data +
        ' | boards memory limits ' +
        coverage.boards_memory_limits
    );

    let totalViolations = 0;
    console.log('');
    for (const rule of RULES) {
      console.log(rule.id + '  ' + rule.label + '  [' + rule.pairs + ']');
      for (const scope of rule.scopes) {
        const counts = (await client.query(scope.sql)).rows[0];
        totalViolations += counts.violations;
        console.log(
          '  ' +
            pad(scope.name, 44) +
            ' evaluated ' +
            pad(String(counts.evaluated), 5) +
            ' | not-measured (NULL side) ' +
            pad(String(counts.not_measured), 5) +
            ' | violations ' +
            counts.violations
        );
        if (counts.violations > 0) {
          const rows = (await client.query(scope.detail)).rows;
          for (const row of rows.slice(0, MAX_LISTED)) {
            const names = [];
            const values = [];
            for (const key of Object.keys(row)) {
              if (NAME_KEYS.has(key)) names.push(row[key]);
              else values.push(key + '=' + row[key]);
            }
            console.log('      VIOLATION ' + names.join(' x ') + '  (' + values.join(', ') + ')');
          }
          if (rows.length > MAX_LISTED) {
            console.log(
              '      ... ' + (rows.length - MAX_LISTED) + ' further violating pair(s) not listed'
            );
          }
        }
      }
    }

    console.log('');
    console.log(
      totalViolations === 0
        ? 'RESULT: PASS - 0 violations in every scope; the four rules stay LATENT (OG-09...OG-12)'
        : 'RESULT: FAIL - ' +
            totalViolations +
            ' violating pair(s) exist while the rules are UNENFORCED: an unsafe build is one seed away'
    );
    process.exitCode = totalViolations === 0 ? 0 : 1;
    await client.end();
  } catch (err) {
    console.error('ERROR:', err.message);
    if (client) await client.end();
    process.exit(1);
  }
}

main();