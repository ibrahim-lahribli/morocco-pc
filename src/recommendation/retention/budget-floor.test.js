'use strict';

// ---------------------------------------------------------------------------
// Decision 27 (src/recommendation/retention/budget-floor.js): focused unit
// tests for the zero-build diagnostic.
//
// Scope: the cheapest-retained-price-per-role map, the GPU-excluded total, the
// NULL-not-zero treatment of a missing required role, the within_budget
// comparison, determinism and the fail-fast gates. No database is used or
// required anywhere in this file.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { BUDGET_FLOOR_ROLES, computeBudgetFloor } = require('./budget-floor');
const { EXPANSION_ORDER } = require('../assembly/assemble');
const { priceKey } = require('../assembly/prices');
const { CandidateSelectionError, ERROR_CODES } = require('../candidates/errors');

// ---------------------------------------------------------------------------
// Fixtures. The deepFreeze / carrier builders are copied from retain.test.js
// rather than extracted: this project creates no shared test-utility module.
// ---------------------------------------------------------------------------

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function verdict(role, productId, overrides = {}) {
  const { variantId = null, ...rest } = overrides;
  return deepFreeze({
    product_id: productId,
    product_variant_id: variantId,
    category: role,
    component_role: role,
    status: 'PASS',
    reason: null,
    relationships: {},
    unknown_pairwise_count: 0,
    ...rest,
  });
}

/** Stage 1 price carrier: [role, productId, selectedPrice] rows. */
function priced(spec) {
  const carrier = Object.create(null);
  for (const [role, productId, selectedPrice] of spec) {
    carrier[priceKey(productId, null, role)] = deepFreeze({
      selected_price: selectedPrice,
      currency: 'MAD',
      store_id: 'store-1',
      price_checked_at: '2026-10-02T00:00:00.000Z',
    });
  }
  return Object.freeze(carrier);
}

function rejectionOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

function assertError(error, code, field, label) {
  assert.ok(error instanceof CandidateSelectionError, `${label}: not a CandidateSelectionError`);
  assert.equal(error.code, code, `${label}: wrong code`);
  assert.equal(error.field, field, `${label}: wrong field`);
}

/** One retained candidate in every BUDGET_FLOOR_ROLE, at the prices below. */
const FULL_RETENTION = [
  verdict('CPU', 'cpu-1'),
  verdict('MOTHERBOARD', 'mb-1'),
  verdict('RAM', 'ram-1'),
  verdict('PSU', 'psu-1'),
  verdict('CASE', 'case-1'),
  verdict('CPU_COOLER', 'cool-1'),
  verdict('SSD_BOOT', 'ssd-1'),
];

/** 2699+1199+649+899+949+499+799 = 7693 MAD. */
const FULL_PRICES = priced([
  ['CPU', 'cpu-1', 2699],
  ['MOTHERBOARD', 'mb-1', 1199],
  ['RAM', 'ram-1', 649],
  ['PSU', 'psu-1', 899],
  ['CASE', 'case-1', 949],
  ['CPU_COOLER', 'cool-1', 499],
  ['SSD_BOOT', 'ssd-1', 799],
]);

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test('sums the cheapest retained candidate per required role', () => {
  const floor = computeBudgetFloor({
    retained: FULL_RETENTION,
    prices: FULL_PRICES,
    budgetAmount: 15000,
    currency: 'MAD',
  });
  assert.equal(floor.cheapest_total, 7693);
  assert.equal(floor.within_budget, true);
  assert.equal(floor.currency, 'MAD');
  assert.equal(floor.budget_amount, 15000);
  assert.deepEqual(floor.missing_roles, []);
  assert.deepEqual(Object.keys(floor), [
    'cheapest_total',
    'currency',
    'budget_amount',
    'within_budget',
    'cheapest_by_role',
    'missing_roles',
  ]);
});

test('the output is frozen throughout, and cheapest_by_role is null-prototype', () => {
  const floor = computeBudgetFloor({
    retained: FULL_RETENTION,
    prices: FULL_PRICES,
    budgetAmount: 15000,
    currency: 'MAD',
  });
  assert.ok(Object.isFrozen(floor));
  assert.ok(Object.isFrozen(floor.cheapest_by_role));
  assert.ok(Object.isFrozen(floor.missing_roles));
  // Null-prototype: a role named "constructor" cannot read an inherited value.
  assert.equal(Object.getPrototypeOf(floor.cheapest_by_role), null);
});

test('within_budget is an inclusive comparison, exactly as assembly prunes', () => {
  // assembly prunes only when the running total is STRICTLY greater than
  // budget_amount, so a total exactly equal to the budget is affordable.
  const exact = computeBudgetFloor({
    retained: FULL_RETENTION,
    prices: FULL_PRICES,
    budgetAmount: 7693,
    currency: 'MAD',
  });
  assert.equal(exact.within_budget, true);

  const oneShort = computeBudgetFloor({
    retained: FULL_RETENTION,
    prices: FULL_PRICES,
    budgetAmount: 7692,
    currency: 'MAD',
  });
  assert.equal(oneShort.within_budget, false);
  // The floor is unchanged by the budget: it is a property of the retained set.
  assert.equal(oneShort.cheapest_total, 7693);
});

test('a retained role contributes its CHEAPEST candidate, not its dearest', () => {
  // Two RAM kits retained. The floor must read the cheaper of the two - a
  // per-role MAX here would report a build nobody can assemble.
  const carrier = Object.create(null);
  for (const key of Object.keys(FULL_PRICES)) {
    carrier[key] = FULL_PRICES[key];
  }
  for (const [productId, selectedPrice] of [['ram-dear', 4000], ['ram-cheap', 700]]) {
    carrier[priceKey(productId, null, 'RAM')] = deepFreeze({
      selected_price: selectedPrice,
      currency: 'MAD',
      store_id: 'store-1',
      price_checked_at: '2026-10-02T00:00:00.000Z',
    });
  }
  const floor = computeBudgetFloor({
    retained: [
      ...FULL_RETENTION.filter((entry) => entry.component_role !== 'RAM'),
      verdict('RAM', 'ram-dear'),
      verdict('RAM', 'ram-cheap'),
    ],
    prices: Object.freeze(carrier),
    budgetAmount: 15000,
    currency: 'MAD',
  });
  assert.equal(floor.cheapest_by_role.RAM, 700);
  assert.equal(floor.cheapest_total, 7693 - 649 + 700);
  // Input order is irrelevant: the dear kit listed first must not win.
  const swapped = computeBudgetFloor({
    retained: [
      ...FULL_RETENTION.filter((entry) => entry.component_role !== 'RAM'),
      verdict('RAM', 'ram-cheap'),
      verdict('RAM', 'ram-dear'),
    ],
    prices: Object.freeze(carrier),
    budgetAmount: 15000,
    currency: 'MAD',
  });
  assert.deepEqual(swapped, floor);
});

// ---------------------------------------------------------------------------
// The GPU exclusion - the decision that is easiest to get wrong
// ---------------------------------------------------------------------------

test('excludes the omissible GPU role from the total but still reports its price', () => {
  const withGpu = priced([...[
    ['CPU', 'cpu-1', 2699],
    ['MOTHERBOARD', 'mb-1', 1199],
    ['RAM', 'ram-1', 649],
    ['PSU', 'psu-1', 899],
    ['CASE', 'case-1', 949],
    ['CPU_COOLER', 'cool-1', 499],
    ['SSD_BOOT', 'ssd-1', 799],
  ], ['GPU', 'gpu-1', 4500]]);
  const floor = computeBudgetFloor({
    retained: [...FULL_RETENTION, verdict('GPU', 'gpu-1')],
    prices: withGpu,
    budgetAmount: 15000,
    currency: 'MAD',
  });
  // The GPU is omissible under the OPTIONAL policy, so including 4500 MAD here
  // would report "unaffordable" for a build that is serviceable without it.
  assert.equal(floor.cheapest_total, 7693);
  assert.equal(floor.cheapest_by_role.GPU, 4500);
  assert.equal(BUDGET_FLOOR_ROLES.includes('GPU'), false);
  // A caller that needs the with-GPU total can add it back from the report.
  assert.equal(floor.cheapest_total + floor.cheapest_by_role.GPU, 12193);
});

test('BUDGET_FLOOR_ROLES stays EXPANSION_ORDER minus GPU', () => {
  assert.deepEqual(BUDGET_FLOOR_ROLES, EXPANSION_ORDER.filter((role) => role !== 'GPU'));
  // SSD_SECONDARY is not in EXPANSION_ORDER at all, so it is not a floor role
  // either - but a retained one is still reported.
  assert.equal(BUDGET_FLOOR_ROLES.includes('SSD_SECONDARY'), false);
  const floor = computeBudgetFloor({
    retained: [...FULL_RETENTION, verdict('SSD_SECONDARY', 'ssd-2')],
    prices: priced([
      ['CPU', 'cpu-1', 2699],
      ['MOTHERBOARD', 'mb-1', 1199],
      ['RAM', 'ram-1', 649],
      ['PSU', 'psu-1', 899],
      ['CASE', 'case-1', 949],
      ['CPU_COOLER', 'cool-1', 499],
      ['SSD_BOOT', 'ssd-1', 799],
      ['SSD_SECONDARY', 'ssd-2', 600],
    ]),
    budgetAmount: 15000,
    currency: 'MAD',
  });
  assert.equal(floor.cheapest_total, 7693);
  assert.equal(floor.cheapest_by_role.SSD_SECONDARY, 600);
});

// ---------------------------------------------------------------------------
// The NULL-not-zero contract
// ---------------------------------------------------------------------------

test('a missing required role yields null, never 0, and names the role', () => {
  const withoutCooler = {
    retained: FULL_RETENTION.filter((entry) => entry.component_role !== 'CPU_COOLER'),
    prices: FULL_PRICES,
    budgetAmount: 15000,
    currency: 'MAD',
  };
  const floor = computeBudgetFloor(withoutCooler);
  assert.equal(floor.cheapest_total, null);
  assert.notEqual(floor.cheapest_total, 0);
  // 0 <= 15000 would read as "comfortably affordable", which is exactly the lie
  // NULL exists to prevent.
  assert.equal(floor.within_budget, null);
  assert.notEqual(floor.within_budget, true);
  assert.deepEqual(floor.missing_roles, ['CPU_COOLER']);
  // The other roles are still reported, so the caller can see what DID survive.
  assert.equal(floor.cheapest_by_role.CPU, 2699);
});

test('every missing role is named, in BUDGET_FLOOR_ROLES order', () => {
  const floor = computeBudgetFloor({
    retained: [verdict('RAM', 'ram-1')],
    prices: priced([['RAM', 'ram-1', 649]]),
    budgetAmount: 15000,
    currency: 'MAD',
  });
  assert.deepEqual(floor.missing_roles, [
    'CPU',
    'MOTHERBOARD',
    'PSU',
    'CASE',
    'CPU_COOLER',
    'SSD_BOOT',
  ]);
  assert.equal(floor.cheapest_total, null);
  assert.equal(floor.within_budget, null);
});

test('an empty retained set is a null floor, not a zero floor', () => {
  const floor = computeBudgetFloor({
    retained: [],
    prices: Object.freeze(Object.create(null)),
    budgetAmount: 15000,
    currency: 'MAD',
  });
  assert.equal(floor.cheapest_total, null);
  assert.equal(floor.within_budget, null);
  assert.deepEqual(floor.missing_roles, [...BUDGET_FLOOR_ROLES]);
  assert.deepEqual(Object.keys(floor.cheapest_by_role), []);
});

// ---------------------------------------------------------------------------
// Review Focus item 2 - the whole point of the module
// ---------------------------------------------------------------------------

test('an affordable floor is representable, so 0 builds is never a silent state', () => {
  // 7693 MAD of cheapest-per-role against a 20000 MAD budget: reachable on
  // price. A caller seeing builds: [] with this floor knows the emptiness is
  // NOT a budget problem, and can look at pairwise compatibility instead. That
  // distinction is exactly what the OG-05 -> OG-28 class of defect hid.
  const floor = computeBudgetFloor({
    retained: FULL_RETENTION,
    prices: FULL_PRICES,
    budgetAmount: 20000,
    currency: 'MAD',
  });
  assert.equal(floor.within_budget, true);
  assert.ok(floor.cheapest_total < 20000);
  assert.deepEqual(floor.missing_roles, []);
});

test('an unaffordable floor is reported as such, with the shortfall derivable', () => {
  const floor = computeBudgetFloor({
    retained: FULL_RETENTION,
    prices: FULL_PRICES,
    budgetAmount: 5000,
    currency: 'MAD',
  });
  assert.equal(floor.within_budget, false);
  assert.equal(floor.cheapest_total, 7693);
  // The caller can state the shortfall without re-deriving anything.
  assert.equal(floor.cheapest_total - floor.budget_amount, 2693);
});

// ---------------------------------------------------------------------------
// Determinism and purity
// ---------------------------------------------------------------------------

test('purity and determinism: input order does not change the output', () => {
  const forward = computeBudgetFloor({
    retained: FULL_RETENTION,
    prices: FULL_PRICES,
    budgetAmount: 15000,
    currency: 'MAD',
  });
  const reversed = computeBudgetFloor({
    retained: [...FULL_RETENTION].reverse(),
    prices: FULL_PRICES,
    budgetAmount: 15000,
    currency: 'MAD',
  });
  assert.deepEqual(reversed, forward);
  // Canonical COMPONENT_ROLES order - the enum declaration order, in which
  // SSD_BOOT precedes PSU - so the emitted object is independent of the input
  // order. BUDGET_FLOOR_ROLES order is a DIFFERENT order and is used only for
  // summing and for missing_roles; conflating the two is the trap here.
  assert.deepEqual(
    Object.keys(forward.cheapest_by_role),
    ['CPU', 'MOTHERBOARD', 'RAM', 'SSD_BOOT', 'PSU', 'CASE', 'CPU_COOLER']
  );
  assert.deepEqual(
    Object.keys(forward.missing_roles),
    forward.missing_roles,
    'missing_roles is an array and compares by value'
  );
});

test('inputs are never mutated', () => {
  const retained = [...FULL_RETENTION];
  const before = structuredClone(retained);
  computeBudgetFloor({
    retained,
    prices: FULL_PRICES,
    budgetAmount: 15000,
    currency: 'MAD',
  });
  assert.deepEqual(structuredClone(retained), before);
});

// ---------------------------------------------------------------------------
// Fail-fast gates (existing error vocabulary only)
// ---------------------------------------------------------------------------

test('fail-fast: the sources object itself', () => {
  assertError(
    rejectionOf(() => computeBudgetFloor()),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    null,
    'missing sources'
  );
  assertError(
    rejectionOf(() => computeBudgetFloor(null)),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    null,
    'null sources'
  );
  assertError(
    rejectionOf(() => computeBudgetFloor([])),
    ERROR_CODES.INVALID_INPUT,
    null,
    'array sources'
  );
});

test('fail-fast: malformed retained', () => {
  for (const bad of [undefined, null, 'results', {}, 7]) {
    assertError(
      rejectionOf(() =>
        computeBudgetFloor({
          retained: bad,
          prices: FULL_PRICES,
          budgetAmount: 15000,
          currency: 'MAD',
        })
      ),
      ERROR_CODES.INVALID_INPUT,
      'retained',
      `retained=${String(bad)}`
    );
  }
  for (const bad of [null, 'verdict', [], { product_id: 'cpu-1' }]) {
    assertError(
      rejectionOf(() =>
        computeBudgetFloor({
          retained: [bad],
          prices: FULL_PRICES,
          budgetAmount: 15000,
          currency: 'MAD',
        })
      ),
      ERROR_CODES.INVALID_FIELD_VALUE,
      'retained',
      `retained entry=${String(bad)}`
    );
  }
});

test('fail-fast: malformed prices carrier', () => {
  for (const bad of [undefined, null, 'prices', []]) {
    assertError(
      rejectionOf(() =>
        computeBudgetFloor({
          retained: FULL_RETENTION,
          prices: bad,
          budgetAmount: 15000,
          currency: 'MAD',
        })
      ),
      ERROR_CODES.INVALID_INPUT,
      'prices',
      `prices=${String(bad)}`
    );
  }
});

test('fail-fast: a retained candidate the carrier cannot price', () => {
  assertError(
    rejectionOf(() =>
      computeBudgetFloor({
        retained: FULL_RETENTION,
        // Carries every role except CASE - a real shape when Stage 1 dropped an
        // offer-less candidate, and one the floor must not paper over with 0.
        prices: priced([
          ['CPU', 'cpu-1', 2699],
          ['MOTHERBOARD', 'mb-1', 1199],
          ['RAM', 'ram-1', 649],
          ['PSU', 'psu-1', 899],
          ['CPU_COOLER', 'cool-1', 499],
          ['SSD_BOOT', 'ssd-1', 799],
        ]),
        budgetAmount: 15000,
        currency: 'MAD',
      })
    ),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'prices',
    'retained candidate with no carrier entry'
  );
});

test('fail-fast: a non-finite selected_price is UNKNOWN, never 0', () => {
  const carrier = Object.create(null);
  for (const [role, productId, price] of [
    ['CPU', 'cpu-1', 2699],
    ['MOTHERBOARD', 'mb-1', 1199],
    ['RAM', 'ram-1', 649],
    ['PSU', 'psu-1', 899],
    ['CASE', 'case-1', 949],
    ['CPU_COOLER', 'cool-1', 499],
    ['SSD_BOOT', 'ssd-1', 799],
  ]) {
    carrier[priceKey(productId, null, role)] = deepFreeze({
      selected_price: price,
      currency: 'MAD',
      store_id: 'store-1',
      price_checked_at: '2026-10-02T00:00:00.000Z',
    });
  }
  carrier[priceKey('cool-1', null, 'CPU_COOLER')] = deepFreeze({
    selected_price: null,
    currency: 'MAD',
    store_id: 'store-1',
    price_checked_at: '2026-10-02T00:00:00.000Z',
  });
  assertError(
    rejectionOf(() =>
      computeBudgetFloor({
        retained: FULL_RETENTION,
        prices: Object.freeze(carrier),
        budgetAmount: 15000,
        currency: 'MAD',
      })
    ),
    ERROR_CODES.MISSING_REQUIRED_FIELD,
    'prices',
    'NULL selected_price'
  );
});

test('fail-fast: budgetAmount and currency', () => {
  for (const bad of [0, -1, '3', NaN, Infinity, null, undefined]) {
    assertError(
      rejectionOf(() =>
        computeBudgetFloor({
          retained: FULL_RETENTION,
          prices: FULL_PRICES,
          budgetAmount: bad,
          currency: 'MAD',
        })
      ),
      ERROR_CODES.INVALID_FIELD_VALUE,
      'budgetAmount',
      `budgetAmount=${String(bad)}`
    );
  }
  // A fractional budget is ACCEPTED, deliberately: assemble.js validates
  // budget_amount as "a finite number greater than 0" with no integer
  // requirement, and within_budget has to agree with the very cutoff that
  // pruned the traversal. Tightening it here would make the diagnostic lie.
  const fractional = computeBudgetFloor({
    retained: FULL_RETENTION,
    prices: FULL_PRICES,
    budgetAmount: 7693.5,
    currency: 'MAD',
  });
  assert.equal(fractional.within_budget, true);
  assert.equal(fractional.budget_amount, 7693.5);
  for (const bad of ['mad', 'MADX', 'M', '', null, undefined, 3]) {
    assertError(
      rejectionOf(() =>
        computeBudgetFloor({
          retained: FULL_RETENTION,
          prices: FULL_PRICES,
          budgetAmount: 15000,
          currency: bad,
        })
      ),
      ERROR_CODES.INVALID_FIELD_VALUE,
      'currency',
      `currency=${String(bad)}`
    );
  }
});
