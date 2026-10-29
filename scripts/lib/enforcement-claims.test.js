'use strict';

// scripts/lib/enforcement-claims.test.js — tests for the "doc says unenforced,
// module exists" detector behind `verify-docs` check 9.
//
// Uses node:test + node:assert/strict only. The markdown is a parameter and the
// module lookup is injected, so this suite needs no file or DB access.
// NOT part of `npm run test:unit` (that glob is `src/**/*.test.js`); it runs in
// `npm run test:scripts`.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { ENFORCED_RULES, findStaleEnforcementClaims } = require('./enforcement-claims');

const ALL_PRESENT = { hasModule: () => true };

function ids(text, options) {
  return findStaleEnforcementClaims(text, options || ALL_PRESENT).map((p) => p.rule);
}

describe('findStaleEnforcementClaims', () => {
  // The sentences that were actually in the document before the 2026-10-29
  // rewrite, near-verbatim. If the detector cannot see these, it cannot see
  // the class of bug: each was true on 2026-09-28 and false after E8.
  it('fires on each of the four claims the architecture doc carried', () => {
    const realClaims = [
      'this list omits the four HARD rules that S5.3 and S6 prescribe elsewhere (cooler max_tdp_watts vs CPU TDP; air-cooler height_mm vs case max_cpu_cooler_height_mm; RAM module_count vs dimm_slots; total RAM capacity vs max_memory_capacity_gb). None of the four is implemented in code either.',
      'The section 5.3 cooler TDP/height checks are UNENFORCED deferrals.',
      '`ram_spec.module_count` and `motherboard_spec.dimm_slots` are read by NOTHING in `src/`.',
      'Total RAM capacity vs `max_memory_capacity_gb`: no code reads either column.',
    ];
    assert.deepEqual(ids(realClaims[0]), ['cooler-tdp', 'cooler-height', 'ram-slots', 'ram-capacity']);
    assert.deepEqual(ids(realClaims[1]), ['cooler-tdp', 'cooler-height']);
    assert.deepEqual(ids(realClaims[2]), ['ram-slots']);
    assert.deepEqual(ids(realClaims[3]), ['ram-capacity']);
  });

  // The block that actually shipped wrong: the marker and the columns it is
  // about sit on different physical lines, which a line-scoped check misses.
  it('sees a multi-line block whose claim and rule names are split', () => {
    const text = [
      '[DECISION 26, 2026-09-28 - **NOT IMPLEMENTED, EXPLICITLY DEFERRED.** Neither',
      'rule and neither NULL-fallback is implemented: `cooler_spec.max_tdp_watts`,',
      '`cooler_spec.height_mm` and `case_spec.max_cpu_cooler_height_mm` are read by',
      'NOTHING in `src/`.',
    ].join('\n');
    const found = findStaleEnforcementClaims(text, ALL_PRESENT);
    assert.deepEqual(found.map((p) => p.rule), ['cooler-tdp', 'cooler-height']);
    assert.ok(found.every((p) => p.line === 1), 'reports the line that carries the claim');
  });

  it('judges each table row on its own', () => {
    const text = [
      '| Cooler TDP (section 5.3) UNENFORCED | CLOSED 2026-10-14 |',
      '| RAM `module_count` vs `dimm_slots` | OPEN |',
    ].join('\n');
    assert.deepEqual(ids(text), []);
  });

  it('does not let a corrected line excuse an uncorrected neighbour', () => {
    const text = [
      '| x | SUPERSEDED 2026-10-14 |',
      '',
      'The RAM `module_count` check is NOT IMPLEMENTED.',
    ].join('\n');
    assert.deepEqual(ids(text), ['ram-slots']);
  });

  it('stays silent when the rule has no implementer (a true deferral)', () => {
    const text = 'The cooler TDP rule is NOT IMPLEMENTED; no module reads `max_tdp_watts`.';
    assert.deepEqual(ids(text, { hasModule: () => false }), []);
  });

  it('stays silent on struck-through history', () => {
    const text = '~~Cooler `max_tdp_watts` vs CPU TDP REJECT is UNENFORCED~~ see below.';
    assert.deepEqual(ids(text), []);
  });

  it('stays silent on a line that already records the correction', () => {
    const superseded = 'SUPERSEDED 2026-10-14: cooler TDP is no longer UNENFORCED.';
    const closed = '| Cooler TDP (section 5.3) UNENFORCED ~~x~~ | CLOSED 2026-10-14 |';
    assert.deepEqual(ids(superseded), []);
    assert.deepEqual(ids(closed), []);
  });

  it('reports line numbers 1-based and tolerates CRLF', () => {
    const text = [
      '# Doc',
      '',
      'Filler line.',
      'The RAM module_count vs dimm_slots rule is UNENFORCED.',
    ].join('\r\n');
    const found = findStaleEnforcementClaims(text, ALL_PRESENT);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 4);
    assert.equal(found[0].module, 'src/recommendation/compatibility/memory-slots.js');
  });

  it('reports every implicated rule on one line', () => {
    const text = 'Both the cooler TDP and the RAM module_count checks are NOT IMPLEMENTED.';
    assert.deepEqual(ids(text), ['cooler-tdp', 'ram-slots']);
  });

  it('ignores prose that names a rule without asserting it is unenforced', () => {
    const text = [
      'Cooler TDP is SOFT: an under-spec cooler resolves UNKNOWN, never a REJECT.',
      'RAM `module_count` above `dimm_slots` is FAIL `RAM_SLOTS_EXCEEDED`.',
    ].join('\n');
    assert.deepEqual(ids(text), []);
  });

  it('ignores a deferral claim about something outside the registry', () => {
    const text = 'The rated-speed soft check is not implemented; it is a scoring input.';
    assert.deepEqual(ids(text), []);
  });

  it('returns an empty array for empty input', () => {
    assert.deepEqual(ids(''), []);
  });

  it('refuses a non-string and a missing predicate', () => {
    assert.throws(() => findStaleEnforcementClaims(null, ALL_PRESENT), TypeError);
    assert.throws(() => findStaleEnforcementClaims('x', {}), TypeError);
  });

  it('keeps the registry on the four Decision 26 item B rules', () => {
    assert.deepEqual(
      ENFORCED_RULES.map((r) => r.id),
      ['cooler-tdp', 'cooler-height', 'ram-slots', 'ram-capacity']
    );
    for (const rule of ENFORCED_RULES) {
      assert.match(rule.module, /^src\/recommendation\/compatibility\/.+\.js$/);
      assert.ok(Object.isFrozen(rule));
    }
  });
});
