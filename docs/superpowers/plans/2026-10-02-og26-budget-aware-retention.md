# OG-26 — Budget-Aware Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-role retention reserve a slot for the cheapest eligible candidate so a
budget below the score-driven top-K can still produce builds, and surface a `budget_floor`
diagnostic so a zero-build result is never silent.

**Architecture:** `retainTopKPerRole` gains one required input — the Stage 1 price carrier —
and one new rule: per role, retain `min(K, eligible)` candidates as *top-(K-1) by score plus
the single cheapest*, re-emitted in the existing Rule 3/5 order. A new pure module
`retention/budget-floor.js` turns the retained set plus the budget into a `budget_floor`
object that `orchestrator/run.js` adds as a seventh result field and `full-run.js` passes
through. No migration, no seed, no schema change, no new loader: Stage 1 already computed
`offerResult.prices` at `src/recommendation/orchestrator/run.js:279`, before retention runs.

**Tech Stack:** Node.js CommonJS, `node:test`, `pg` (loaders only), raw SQL. No lint, no
typecheck, no build step.

**Spec:** `docs/OPEN_GAPS.md` row **OG-26** (class IMPORTANT, owner engine-code) plus
`docs/OG-01_ASSESSMENT_RESEARCH_PLAN.md` §112 for the rating bands this change does not touch.

**Plan document:** this plan is `docs/superpowers/plans/2026-10-02-og26-budget-aware-retention.md`.

## Global Constraints

- Engine modules stay pure: no DB access, no clock reads, no randomness, no I/O
  (`AGENTS.md` §5). All new logic is pure functions over already-loaded data.
- New code reuses the existing error vocabulary `CandidateSelectionError` / `ERROR_CODES`
  from `src/recommendation/candidates/errors.js`. No new error code.
- `NULL` means UNKNOWN and UNKNOWN ≠ PASS. A missing price is a fail-fast, never a
  silent `0` and never a "free" candidate.
- Ordering is by code-unit comparison only — never `localeCompare`. No clock, no randomness.
- Retention emits **the producer's verdict records by reference** — never copied, cloned or
  field-extended. `retainTopKPerRole`'s output stays exactly `{ results }`.
- Line endings: every git blob in this repository is LF, and the working tree is CRLF for
  most files because `core.autocrlf=true` with no `.gitattributes`. **Match the working-tree
  ending of the file you edit**: `verify-docs` check 2 asserts the decision log contains
  `\r\n` in the working tree, so that file must stay CRLF on disk. A stray-LF file reads as
  a whole-file diff.
- `git status` first: this is a shared checkout. Stage only intended files.
- Do not run `npm run gen:schema` or any write-capable script against `DATABASE_URL`.
  All three guarded harnesses require `TEST_DATABASE_URL` and a live 1-row SELECT preflight.
- No new npm script, no new CI step, no new dependency. `pg` and `dotenv` only.

## Review Focus

Five input classes the register's prose implies but no existing test exercises. Each gets
its test in the task that owns the code, in that task's own step style.

1. **Two candidates at the identical `selected_price` within one role.** Seed `004b_ssd_ram.sql`
   already ships two 1349 MAD RAM kits, so this is live data, not a hypothetical. The
   cheapest-reservation tie-break must resolve by existing Rule 3/5 position, or the retained
   set becomes unstable across runs. → Task 2, Step 1.
2. **Zero builds while `within_budget` is `true`.** The budget-blind failure and a genuine
   pairwise-incompatibility failure (the OG-05 → OG-28 class) look identical in `builds: []`.
   The diagnostic must represent "affordable but incompatible" without erroring. → Task 3, Step 1.
3. **A required role with no retained candidate** (every cooler REJECTs). `cheapest_total`
   must be `null`, never `0`, and `missing_roles` must name the role. → Task 3, Step 1.
4. **`candidate_caps.top_k_per_role = 1`.** The reservation consumes the only slot, so
   retention becomes purely price-ordered and every score signal is discarded. Intended, but
   it must be pinned as a decision rather than discovered later. → Task 2, Step 1.
5. **A role bucket holding exactly one eligible candidate.** The reservation must not
   duplicate it or push the bucket to `K+1`. → Task 2, Step 1.

---

### Task 1: Record Decision 27 and commit the plan document

**Files:**
- Create: `docs/superpowers/plans/2026-10-02-og26-budget-aware-retention.md`
- Modify: `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (append after the Decision 26 entry)
- Modify: `scripts/verify-docs.js` (`checkDecisions`, the `global === 24` / `status === 30` assertion)
- Modify: `AGENTS.md` §2 item 5 (`Decisions 1-26` → `Decisions 1-27`)
- Regenerate: `docs/DECISION_INDEX.md` (`npm run gen:decisions` — never hand-edit)

**Interfaces:**
- Consumes: nothing.
- Produces: the normative contract every later task implements —
  `priceKey(product_id, product_variant_id, component_role) -> string` (already exported by
  `src/recommendation/assembly/prices.js`, unchanged), and the four new retention rules named
  in the Step 3 text, which Tasks 2-4 implement verbatim.

- [ ] **Step 1: Commit this plan document**

This file. Match the working-tree ending of its siblings under `docs/`
(`docs/OG-01_*_PLAN.md` are CRLF on disk).

```bash
git add docs/superpowers/plans/2026-10-02-og26-budget-aware-retention.md
git commit -m "docs: add the OG-26 budget-aware retention implementation plan"
```

- [ ] **Step 2: Write the failing gate check**

The decision log is machine-parsed: `scripts/verify-docs.js:98` hard-codes
`global === 24 && nested === 5 && status === 30`. Run it now to confirm the baseline is green
before touching the log.

Run: `npm run verify:docs`
Expected: PASS, including `decisions-parse ... 24 headings + 5 nested = 26 global, 30 Status: lines`.

- [ ] **Step 3: Append the Decision 27 entry**

Append to `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (CRLF in the working tree). Follow
`docs/decisions/TEMPLATE.md` exactly. The entry must contain, in this order: the
`## Decision 27 — <one-line verdict>` heading; the `Status:` line as the **first content
line**; `Date:`; then `### Current situation`, `### Problem`, `### Decision`,
`### Consequences`, `### Out of scope`.

The `### Decision` section must state, in the log's own voice and citing
`src/recommendation/retention/retain.js` and `src/recommendation/assembly/assemble.js:616`:

1. **Rule 4 is replaced.** Per role bucket, ordered by the unchanged Rule 3/5 comparator
   (`candidate_score` DESC, then the reused `compareCandidates()`), retention retains the
   first `K-1` entries **plus the single cheapest eligible candidate by `selected_price`**,
   where ties on `selected_price` are broken by position in that same Rule 3/5 order. The
   selected set is then re-emitted in Rule 3/5 order, so the output ordering contract is
   unchanged. `retained_count` is still `min(K, eligible_count)`.
2. **`prices` becomes a REQUIRED input** to `retainTopKPerRole` — the Stage 1 carrier from
   `offers.selectOfferPrices`, the same frozen null-prototype object already handed to
   Engine 3. An eligible verdict with no carrier entry fails fast with
   `MISSING_REQUIRED_FIELD` on field `prices`, matching the existing missing-score gate. A
   missing price is never read as `0`.
3. **The boundary is amended, not widened.** `retention/retain.js` may import exactly one
   Engine 3 symbol, `priceKey` from `../assembly/prices` — a pure key constructor with no
   logic, imported so the carrier key format has exactly one owner. It may NOT import
   `../assembly/assemble`, `../assembly/pipeline`, `../assembly/gpu-policy`, `../assembly/input`,
   or the assembly barrel. `retention/index.test.js`'s banned-token list changes from the
   single token `'../assembly'` to those five specific specifiers.
4. **`budget_floor` is a new field on the `runRecommendation` result** (seventh, appended
   after `build_contributions`), and an eleventh on `runRecommendationFullRun`'s result. It
   is produced by the new pure `computeBudgetFloor` and is ALWAYS present, on every query,
   whether or not builds exist. Zero builds remains a valid outcome (Decision 17.2) — this
   entry makes it an *explained* outcome, not a changed one.

Also record, under `### Consequences`: the retained floor becomes the catalog's
cheapest-per-role combination whenever the bucket exceeds K, so the two harness measurement
budgets in `scripts/measure-orchestrator.js` (GAMING 20000, OFFICE 12000) are expected to fall
and MUST be re-measured, not assumed.

Under `### Out of scope`, state explicitly: no migration, no seed, no scoring change, no
change to `max_builds_per_query`, no change to the GPU OPTIONAL/REQUIRED policy, no new
persisted column, and **no change to Engine 6 explanation text** — `budget_floor` is a
result field only, because this project has no UI or API surface to render it into yet.

- [ ] **Step 4: Update the parse counts and the AGENTS range**

In `scripts/verify-docs.js` `checkDecisions`, change the assertion to
`global === 25 && nested === 5 && status === 31` and the failure message to match. In
`AGENTS.md` §2 item 5, change `Decisions 1-26` to `Decisions 1-27`.

- [ ] **Step 5: Run the gates**

```bash
npm run gen:decisions
node scripts/gen-decision-index.js --check
npm run verify:docs
npm run test:unit
```

Expected: the index regenerates with a `27` row; `--check` passes; `verify:docs` reports
`decisions-parse 25 headings + 5 nested = 27 global, 31 Status: lines` and
`agents-decision-range "Decisions 1-27" cited`; `test:unit` is unchanged and green.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans docs/RECOMMENDATION_ENGINE_DECISIONS.md docs/DECISION_INDEX.md scripts/verify-docs.js AGENTS.md
git commit -m "docs: record Decision 27 (budget-aware retention + budget_floor diagnostic)"
```

---

### Task 2: Cheapest-per-role reservation in `retainTopKPerRole`

**Files:**
- Modify: `src/recommendation/retention/retain.js` (header comment, `require` block,
  `retainBucket`, JSDoc)
- Modify: `src/recommendation/retention/index.js` (header comment only — the barrel's
  export list is unchanged)
- Test: `src/recommendation/retention/retain.test.js`
- Test: `src/recommendation/retention/index.test.js`

**Interfaces:**
- Consumes: `priceKey(product_id, product_variant_id, component_role) -> string` from
  `../assembly/prices` (Task 1, unchanged); `compareCandidates(a, b) -> number` and
  `COMPONENT_ROLES` from the existing local requires.
- Produces: `retainTopKPerRole({ filterResult, candidateScores, topKPerRole, prices }) -> Object.freeze({ results })`.
  `prices` is REQUIRED and fail-fast. Every existing call site that omits it now throws
  `MISSING_REQUIRED_FIELD` — that is the intended break, and Tasks 4 and 5 fix the two
  non-test call sites (`src/recommendation/orchestrator/run.js:300`,
  `scripts/measure-og01-reach.js:141`).

- [ ] **Step 1: Write the failing tests**

Add to `src/recommendation/retention/retain.test.js`. First add a carrier fixture helper next
to the existing `verdict` / `scoreEntry` / `scores` helpers, and thread `prices:` through all
31 existing `retainTopKPerRole(` call sites:

```js
/** Stage 1 price carrier fixture: [role, productId, selectedPrice] rows. */
function prices(spec) {
  const carrier = Object.create(null);
  for (const [role, productId, selectedPrice] of spec) {
    carrier[priceKey(productId, null, role)] = deepFreeze({
      selected_price: selectedPrice,
      currency: 'MAD',
      store_id: 'store-1',
      price_checked_at: '2026-10-02T00:00:00.000Z',
    });
  }
  return deepFreeze(carrier);
}
```

with `const { priceKey } = require('../assembly/prices');` added to the requires. Then add
these five tests — one per Review Focus item, plus the ordering contract:

```js
test('the cheapest eligible candidate is reserved a slot when the bucket exceeds K', () => {
  const out = retainTopKPerRole({
    filterResult: { results: [
      verdict('CPU', 'cpu-expensive'),
      verdict('CPU', 'cpu-cheap'),
    ] },
    candidateScores: scores(
      scoreEntry('CPU', 'cpu-expensive', 90),
      scoreEntry('CPU', 'cpu-cheap', 50)
    ),
    topKPerRole: 1,
    prices: prices([['CPU', 'cpu-expensive', 9000], ['CPU', 'cpu-cheap', 800]]),
  });
  assert.deepEqual(ids(out.results), ['cpu-cheap']);
});

test('the reserved set is re-emitted in Rule 3/5 score order, not price order', () => {
  const out = retainTopKPerRole({
    filterResult: { results: [
      verdict('CPU', 'cpu-a'), verdict('CPU', 'cpu-b'),
      verdict('CPU', 'cpu-c'), verdict('CPU', 'cpu-cheap'),
    ] },
    candidateScores: scores(
      scoreEntry('CPU', 'cpu-a', 95), scoreEntry('CPU', 'cpu-b', 90),
      scoreEntry('CPU', 'cpu-c', 85), scoreEntry('CPU', 'cpu-cheap', 10)
    ),
    topKPerRole: 3,
    prices: prices([
      ['CPU', 'cpu-a', 5000], ['CPU', 'cpu-b', 4000],
      ['CPU', 'cpu-c', 3000], ['CPU', 'cpu-cheap', 700],
    ]),
  });
  // top-(K-1)=2 by score is cpu-a, cpu-b; the reservation adds cpu-cheap; the
  // emitted order is still Rule 3/5, so cpu-cheap lands last despite being cheapest.
  assert.deepEqual(ids(out.results), ['cpu-a', 'cpu-b', 'cpu-cheap']);
});

test('an equal-price tie for the reservation is broken by Rule 3/5 position', () => {
  const out = retainTopKPerRole({
    filterResult: { results: [
      verdict('RAM', 'ram-high'), verdict('RAM', 'ram-a'), verdict('RAM', 'ram-b'),
    ] },
    candidateScores: scores(
      scoreEntry('RAM', 'ram-high', 99),
      scoreEntry('RAM', 'ram-a', 60), scoreEntry('RAM', 'ram-b', 40)
    ),
    topKPerRole: 2,
    prices: prices([
      ['RAM', 'ram-high', 5000], ['RAM', 'ram-a', 1349], ['RAM', 'ram-b', 1349],
    ]),
  });
  // ram-a and ram-b tie at 1349 MAD; ram-a scores higher, so ram-a is reserved.
  assert.deepEqual(ids(out.results), ['ram-high', 'ram-a']);
});

test('a single eligible candidate is never duplicated and never exceeds K', () => {
  const out = retainTopKPerRole({
    filterResult: { results: [verdict('CASE', 'case-1')] },
    candidateScores: scores(scoreEntry('CASE', 'case-1', 70)),
    topKPerRole: 5,
    prices: prices([['CASE', 'case-1', 849]]),
  });
  assert.deepEqual(ids(out.results), ['case-1']);
});

test('a REJECTed cheap candidate is never reserved', () => {
  const out = retainTopKPerRole({
    filterResult: { results: [
      verdict('CPU', 'cpu-good'),
      verdict('CPU', 'cpu-rejected', { status: CANDIDATE_STATUSES.REJECT }),
    ] },
    candidateScores: scores(
      scoreEntry('CPU', 'cpu-good', 60), scoreEntry('CPU', 'cpu-rejected', 95)
    ),
    topKPerRole: 1,
    prices: prices([['CPU', 'cpu-good', 3000], ['CPU', 'cpu-rejected', 100]]),
  });
  assert.deepEqual(ids(out.results), ['cpu-good']);
});

test('an eligible verdict with no carrier entry fails fast and is never priced at 0', () => {
  assert.throws(
    () => retainTopKPerRole({
      filterResult: { results: [verdict('CPU', 'cpu-1')] },
      candidateScores: scores(scoreEntry('CPU', 'cpu-1', 60)),
      topKPerRole: 5,
      prices: prices([]),
    }),
    (error) => {
      assert.ok(error instanceof CandidateSelectionError);
      assert.equal(error.code, ERROR_CODES.MISSING_REQUIRED_FIELD);
      assert.equal(error.field, 'prices');
      return true;
    }
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/recommendation/retention/retain.test.js`
Expected: FAIL. The reservation tests fail because the current Rule 4 slice keeps
`cpu-expensive`; the missing-price test fails because `prices` is not read at all.

- [ ] **Step 3: Implement the reservation**

In `src/recommendation/retention/retain.js`:

1. Add `const { priceKey } = require('../assembly/prices');` to the require block. This is the
   only new import permitted by Decision 27 item 3.
2. Add a light gate in the existing gate block, after the `topKPerRole` gate: `prices` must be
   a non-null, non-array object (a null-prototype carrier from Stage 1 always passes); fail
   with `ERROR_CODES.INVALID_INPUT` on field `prices` otherwise. Do NOT call
   `validatePrices` — the carrier is already validated by Stage 1 and re-validating it would
   duplicate Engine 3's contract inside retention.
3. Add a private `priceOf(verdict)` that builds `priceKey(verdict.product_id,
   verdict.product_variant_id, verdict.component_role)`, reads it with
   `Object.prototype.hasOwnProperty.call`, and on a miss calls `fail(ERROR_CODES.MISSING_REQUIRED_FIELD,
   'prices', ...)`. A present-but-non-finite `selected_price` fails the same way — never
   coerce to `0`.
4. Replace `retainBucket` with the two-step selection, keeping `bucket.sort(byScoreDescThenCanonical)`:

```js
const retainBucket = (bucket) => {
  bucket.sort(byScoreDescThenCanonical);
  if (bucket.length <= topKPerRole) {
    for (const entry of bucket) retained.push(entry.verdict);
    return;
  }
  // Decision 27: reserve one slot for the cheapest eligible candidate so a
  // budget below the score-driven top-K can still assemble. Ties on
  // selected_price fall to the earliest Rule 3/5 position (the sort above).
  let cheapest = 0;
  for (let index = 1; index < bucket.length; index += 1) {
    if (priceOf(bucket[index].verdict).selected_price
        < priceOf(bucket[cheapest].verdict).selected_price) {
      cheapest = index;
    }
  }
  const selected = new Set(bucket.slice(0, topKPerRole - 1));
  selected.add(bucket[cheapest]);
  for (const entry of bucket) {
    if (selected.has(entry)) retained.push(entry.verdict);
  }
};
```

`Set` membership is by object identity, and each bucket entry is a distinct `{ verdict, score }`
object, so this is exact. Note `topKPerRole - 1 === 0` when `K === 1`: `slice(0, 0)` is empty
and the reservation alone fills the slot, which is Review Focus item 4.
5. Update the file's header comment: the pipeline diagram gains the Stage 1 price carrier on
   the input side; the `Field sourcing` block documents `prices` as sourced from Stage 1 and
   owned by Engine 2; `Explicit NON-responsibilities` drops "no Engine 3 work … prices" and
   replaces it with the single-`priceKey`-import rule from Decision 27 item 3. The
   `Determinism` line must now say the reservation tie-break is the Rule 3/5 order.
6. In `src/recommendation/retention/index.js`, update the header's pipeline diagram and
   field-sourcing prose the same way. Do NOT change `module.exports`.

- [ ] **Step 4: Amend the two boundary tests**

In `src/recommendation/retention/index.test.js`:

- In `retention keeps its source boundary`, replace the single banned token `'../assembly'`
  with these five, keeping every other entry: `'../assembly/assemble'`,
  `'../assembly/pipeline'`, `'../assembly/gpu-policy'`, `'../assembly/input'`,
  `'../assembly/index'`. Add `'../orchestrator'` and `'../persistence'` — retention must never
  reach upward. Add a comment naming Decision 27 item 3 as the reason `'../assembly/prices'`
  is permitted.
- In `retain.js imports exactly the composed sources and nothing else`, add
  `'../assembly/prices'` to the expected sorted array.
- Leave `retention barrel exposes exactly the one-function public API` and
  `re-exports by identity` untouched — the barrel's export list did not change.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --test src/recommendation/retention/retain.test.js
node --test src/recommendation/retention/index.test.js
npm run test:unit
```

Expected: PASS. `test:unit` will still FAIL at this point — `run.test.js` and
`measure-og01-reach.js` reach retention without `prices`. That failure is expected and is
fixed in Task 4; confirm it is the ONLY failure and that it is a
`MISSING_REQUIRED_FIELD ... prices` from the orchestrator path.

- [ ] **Step 6: Commit**

```bash
git add src/recommendation/retention
git commit -m "feat(retention): reserve a slot for the cheapest eligible candidate per role"
```

---

### Task 3: `computeBudgetFloor` — the zero-build diagnostic

**Files:**
- Create: `src/recommendation/retention/budget-floor.js`
- Create: `src/recommendation/retention/budget-floor.test.js`
- Modify: `src/recommendation/retention/index.js` (`module.exports` + header)

**Interfaces:**
- Consumes: `retained` — the `results` array from `retainTopKPerRole`; `prices` — the same
  Stage 1 carrier; `budgetAmount` — a finite number > 0; `currency` — a 3-letter uppercase
  string. Pure; reads no clock, no DB.
- Produces:
  - `BUDGET_FLOOR_ROLES` — `Object.freeze(['CPU', 'MOTHERBOARD', 'RAM', 'PSU', 'CASE', 'CPU_COOLER', 'SSD_BOOT'])`,
    i.e. `EXPANSION_ORDER` minus `GPU` (the GPU is omissible under the OPTIONAL policy, so
    including it would overstate the floor).
  - `computeBudgetFloor({ retained, prices, budgetAmount, currency }) -> Object.freeze({ cheapest_total, currency, budget_amount, within_budget, cheapest_by_role, missing_roles })`
    - `cheapest_by_role` — frozen **null-prototype** object mapping every role present in
      `retained` (including `GPU` and any foreign role) to its lowest `selected_price`.
    - `cheapest_total` — the sum of `cheapest_by_role` over `BUDGET_FLOOR_ROLES` only;
      `null` when `missing_roles` is non-empty.
    - `missing_roles` — frozen array of `BUDGET_FLOOR_ROLES` with no entry in `cheapest_by_role`.
    - `within_budget` — `cheapest_total <= budgetAmount`; `null` when `cheapest_total` is `null`.
    - All six fields are always present. `null` is never substituted with `0`.

- [ ] **Step 1: Write the failing tests**

Create `src/recommendation/retention/budget-floor.test.js` with the `prices(...)` and
`deepFreeze(...)` fixture helpers copied from `retain.test.js` (this project creates no
shared test-utility module), then:

```js
test('sums the cheapest retained candidate per required role', () => {
  const floor = computeBudgetFloor({
    retained: FULL_RETENTION,
    prices: prices([
      ['CPU', 'cpu-1', 2699], ['MOTHERBOARD', 'mb-1', 1199], ['RAM', 'ram-1', 649],
      ['PSU', 'psu-1', 899], ['CASE', 'case-1', 949], ['CPU_COOLER', 'cool-1', 499],
      ['SSD_BOOT', 'ssd-1', 799],
    ]),
    budgetAmount: 15000,
    currency: 'MAD',
  });
  assert.equal(floor.cheapest_total, 7693);
  assert.equal(floor.within_budget, true);
  assert.deepEqual(floor.missing_roles, []);
  assert.equal(Object.getPrototypeOf(floor.cheapest_by_role), null);
  assert.ok(Object.isFrozen(floor) && Object.isFrozen(floor.cheapest_by_role));
});

test('excludes the omissible GPU role from the total but reports its price', () => {
  // FULL_RETENTION plus { component_role: 'GPU', product_id: 'gpu-1' } at 4500 MAD
  assert.equal(floor.cheapest_total, 7693);   // unchanged by the GPU
  assert.equal(floor.cheapest_by_role.GPU, 4500);
});

test('a missing required role yields null, never 0, and names the role', () => {
  // retained omits CPU_COOLER entirely
  assert.equal(floor.cheapest_total, null);
  assert.equal(floor.within_budget, null);
  assert.deepEqual(floor.missing_roles, ['CPU_COOLER']);
});

test('an affordable floor is representable, so 0 builds is never a silent state', () => {
  assert.equal(floor.within_budget, true);
  assert.ok(floor.cheapest_total < 20000);
});

test('BUDGET_FLOOR_ROLES stays EXPANSION_ORDER minus GPU', () => {
  const { EXPANSION_ORDER } = require('../assembly/assemble');
  assert.deepEqual(BUDGET_FLOOR_ROLES, EXPANSION_ORDER.filter((role) => role !== 'GPU'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/recommendation/retention/budget-floor.test.js`
Expected: FAIL with `Cannot find module './budget-floor'`.

- [ ] **Step 3: Implement `computeBudgetFloor` in `src/recommendation/retention/budget-floor.js`**

Pure module, `'use strict'`, `module.exports = { BUDGET_FLOOR_ROLES, computeBudgetFloor }`.
Reuse `priceKey` from `../assembly/prices` and the existing `deepFreeze` idiom (a private
recursive freezer, as every module in this codebase does — no shared utility is created).
Use `CandidateSelectionError` / `ERROR_CODES` for its fail-fast gates: `retained` must be an
array, `budgetAmount` a finite number > 0, `currency` a 3-letter uppercase string, `prices`
an object. A retained verdict with no carrier entry fails with `MISSING_REQUIRED_FIELD` on
field `prices`, identically to Task 2 — never a `0` price. Freeze the verdicts' parent map
with `Object.create(null)` + `Object.freeze`, matching `validatePrices`.

- [ ] **Step 4: Export it from the barrel**

In `src/recommendation/retention/index.js`:

```js
const { retainTopKPerRole } = require('./retain');
const { BUDGET_FLOOR_ROLES, computeBudgetFloor } = require('./budget-floor');

module.exports = { retainTopKPerRole, BUDGET_FLOOR_ROLES, computeBudgetFloor };
```

Document both functions in the header's `Public surface` block.

- [ ] **Step 5: Update the barrel test for the new export list**

In `src/recommendation/retention/index.test.js`,
`retention barrel exposes exactly the one-function public API` now FAILS. Rename it to
`retention barrel exposes exactly its two-function public API` and assert:

```js
assert.deepEqual(Object.keys(retention), ['retainTopKPerRole', 'BUDGET_FLOOR_ROLES', 'computeBudgetFloor']);
assert.equal(typeof retention.computeBudgetFloor, 'function');
assert.equal(retention.computeBudgetFloor.length, 1);
assert.ok(Array.isArray(retention.BUDGET_FLOOR_ROLES));
assert.ok(Object.isFrozen(retention.BUDGET_FLOOR_ROLES));
```

Add the identity pin next to the existing one: keep
`assert.strictEqual(retention.retainTopKPerRole, retain.retainTopKPerRole);` and add
`assert.strictEqual(retention.computeBudgetFloor, budgetFloor.computeBudgetFloor);` with
`const budgetFloor = require('./budget-floor');`. In the banned-token loop, extend its
`for` list to include `'budget-floor.js'` so the new file is boundary-checked too.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
node --test src/recommendation/retention/budget-floor.test.js
node --test src/recommendation/retention/index.test.js
npm run test:unit
```

Expected: the two retention files PASS. `test:unit` still fails only in `run.test.js`
(`retainTopKPerRole` without `prices`) — Task 4.

- [ ] **Step 7: Commit**

```bash
git add src/recommendation/retention
git commit -m "feat(retention): add computeBudgetFloor, the zero-build diagnostic"
```

---

### Task 4: Wire the pass and the orchestrator result

**Files:**
- Modify: `src/recommendation/orchestrator/run.js` (step 11 call, new step 11b, result object,
  header comment)
- Modify: `src/recommendation/orchestrator/full-run.js` (result object pass-through, header)
- Modify: `scripts/measure-og01-reach.js` (the `prices` argument at line 141)
- Test: `src/recommendation/orchestrator/run.test.js`
- Test: `src/recommendation/orchestrator/full-run.test.js`

**Interfaces:**
- Consumes: `retainTopKPerRole({ filterResult, candidateScores, topKPerRole, prices })` and
  `computeBudgetFloor({ retained, prices, budgetAmount, currency })` from Task 2 and Task 3.
- Produces: `runRecommendation` returns a frozen object whose `Object.keys` are exactly
  `['query_id', 'scoring_model_id', 'builds', 'budget_amount', 'currency', 'build_contributions', 'budget_floor']`
  — `budget_floor` appended LAST. `runRecommendationFullRun` returns exactly
  `[... its ten existing keys ..., 'budget_floor']` — also appended last. The Decision 17.3
  call-order pin in `run.test.js` is unchanged: `computeBudgetFloor` is a pure call, not a
  stage, so it does not join the `sequence` array.

- [ ] **Step 1: Write the failing tests**

In `src/recommendation/orchestrator/run.test.js`, extend the existing
`runRecommendation: one pass returns the frozen Decision 17.2 shape` test:

```js
assert.deepEqual(Object.keys(result), [
  'query_id', 'scoring_model_id', 'builds', 'budget_amount', 'currency',
  'build_contributions', 'budget_floor',
]);
assert.ok(Object.isFrozen(result.budget_floor));
assert.equal(result.budget_floor.currency, 'MAD');
assert.equal(result.budget_floor.budget_amount, 12000);
assert.equal(typeof result.budget_floor.cheapest_total, 'number');
assert.equal(typeof result.budget_floor.within_budget, 'boolean');
```

In the existing retention-wiring test, add the new argument assertion by spying on
`offers.selectOfferPrices` and asserting
`retentionArgs.prices === thatSpy.calls[0].result.prices` — the SAME object identity, not a
copy. Add one new test:

```js
test('a zero-build pass still returns a budget_floor that explains the emptiness', async () => {
  const db = createDb({ routes: { budget: '1000' } });
  const out = await runRecommendation({ db, queryId: QUERY_ID });
  assert.equal(out.builds.length, 0);
  assert.equal(typeof out.budget_floor.cheapest_total, 'number');
  assert.equal(out.budget_floor.within_budget, false);
  assert.ok(out.budget_floor.cheapest_total > 1000);
});
```

In `src/recommendation/orchestrator/full-run.test.js`, extend the `Object.keys(out)` assertion
with `'budget_floor'` and add `assert.equal(out.budget_floor, fx.snap.budget_floor);` to the
pass-through test.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test src/recommendation/orchestrator/run.test.js
node --test src/recommendation/orchestrator/full-run.test.js
```

Expected: FAIL — `run.test.js` currently throws `MISSING_REQUIRED_FIELD` on `prices` from
Task 2, and both `Object.keys` assertions are one element short.

- [ ] **Step 3: Pass `prices` into retention in `run.js`**

At `src/recommendation/orchestrator/run.js:300`, add `prices: offerResult.prices,` to the
`retainTopKPerRole` call, with a comment citing Decision 27: the Stage 1 carrier is already
loaded at step 6 and is the same frozen object handed to Engine 3 at step 12.

- [ ] **Step 4: Add the diagnostic step and the result field**

Immediately after the retention call, insert a new numbered step (renumbering 12→13, 13→14,
13b→14b in the surrounding comments):

```js
// 11b. Decision 27: the zero-build diagnostic. Pure, always computed, never
//      conditional on the build count — a build-free budget is a valid outcome
//      (Decision 17.2) and this is what makes it explicable rather than silent.
const budgetFloor = retention.computeBudgetFloor({
  retained: retentionResult.results,
  prices: offerResult.prices,
  budgetAmount: queryInput.input.budget_amount,
  currency: queryInput.input.currency,
});
```

Add `budget_floor: budgetFloor,` as the last property of the returned frozen object. Update
the `@returns` JSDoc to name the seventh field, and the header's pipeline diagram to show
the Stage 1 price carrier feeding both retention and the diagnostic.

- [ ] **Step 5: Pass it through `full-run.js`**

Add `budget_floor: snap.budget_floor,` as the last property of the frozen result in
`src/recommendation/orchestrator/full-run.js` and name it in the header's ten-field list
(which becomes eleven). Do NOT pass it to `explanation.explainSelection` — Decision 27's
Out-of-scope section forbids changing Engine 6 output.

- [ ] **Step 6: Fix the second non-test call site**

In `scripts/measure-og01-reach.js`, add `prices: offerResult.prices,` to the
`retainTopKPerRole` call at line 141, and print the new floor in the existing
`=== reach per role ===` section: one line reading
`budget floor: <cheapest_total> MAD vs budget <BUDGET> (<within_budget ? 'within' : 'ABOVE'>)`.
This makes the reach script the cheapest standing witness that the floor dropped.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm run test:unit
node --test src/recommendation/orchestrator/snapshot.test.js
```

Expected: PASS, all green. `snapshot.test.js` needs no change — it stubs
`retainTopKPerRole` by name and the stub already returns a `{ results }` shape.

- [ ] **Step 8: Commit**

```bash
git add src/recommendation/orchestrator scripts/measure-og01-reach.js
git commit -m "feat(orchestrator): wire budget-aware retention and surface budget_floor"
```

---

### Task 5: Measure, close OG-26, sweep the docs

**Files:**
- Modify: `scripts/measure-orchestrator.js` (`QUERIES` budgets + the comment block at lines
  75-95, after measuring)
- Modify: `docs/OPEN_GAPS.md` (OG-26 row status/class, new closed-table row `C-17`, §7
  next-actions item 1)
- Modify: `docs/RECOMMENDATION_ENGINE_DECISIONS.md` (Decision 27 `Status:` line → IMPLEMENTED)
- Regenerate: `docs/DECISION_INDEX.md`
- Modify: `CONTEXT.md`, `AGENTS.md`, `docs/TEST_MAP.md`, `DEVELOPMENT_NOTES.md`

**Interfaces:**
- Consumes: everything from Tasks 1-4, plus the live shared DB via the three
  `TEST_DATABASE_URL`-guarded harnesses.
- Produces: the closure record. No new code.

> **Environment prerequisite, and it is a real one.** `TEST_DATABASE_URL` has been
> re-created twice in three days, each time minting a new endpoint, and a stale credential is
> indistinguishable from a dead branch (both raise `28P01`). Before any step below, run a
> 1-row SELECT against `TEST_DATABASE_URL`. If it fails, **stop and report BLOCKED** — do not
> fall back to `DATABASE_URL` for a write-capable script, and do not lower a budget on an
> unmeasured guess.

- [ ] **Step 1: Prove the gate is not vacuous — run the reach measurement BEFORE and AFTER**

The AGENTS rule: a gate never shown to fail is not evidence. Establish the before/after pair
on the same catalog, read-only, no writes:

```bash
node -e 'require("dotenv").config();const{Client}=require("pg");const c=new Client({connectionString:process.env.TEST_DATABASE_URL});c.connect().then(()=>c.query("SELECT 1 AS ok")).then(r=>{console.log("preflight",r.rows[0].ok);return c.end()}).catch(e=>{console.error("BLOCKED",e.message);process.exit(1)})'
```

Then measure the floor at the two pre-fix budgets, on the branch:

```bash
node scripts/measure-og01-reach.js --budget 15000 --use-case GAMING
node scripts/measure-og01-reach.js --budget 10000 --use-case OFFICE
```

Expected AFTER the fix: both print a `budget floor` line with `within`, and a non-zero
retained count per role that now includes the cheap parts (a sub-1000 MAD CASE such as the
Fractal Pop XL or the MAG FORGE 320R AIRFLOW at 849 MAD, and a sub-2699 MAD CPU). Record
both floors verbatim. If either still prints `ABOVE` or still retains no cheap part, the
reservation is not reaching assembly — go back to Task 2 before proceeding.

- [ ] **Step 2: Run the two guarded harnesses and re-derive the harness budgets**

```bash
node scripts/test-orchestrator-full-run.js
node scripts/measure-orchestrator.js
```

Expected: `test-orchestrator-full-run.js` 28 pass / 0 fail (the count is a live pin — if it
differs, report the new number, do not edit the assertion to match). `measure-orchestrator.js`
must report Decision-20 criteria 1+2 MET for both use cases.

Then re-derive the cheapest serviceable budget for each, by inserting a throwaway
`recommendation_query` per budget, calling `runRecommendationSnapshot`, snapshotting, and
deleting every probe row afterwards. Do NOT wrap the probe in your own `BEGIN` — the snapshot
issues its own `SET TRANSACTION ISOLATION LEVEL`. Lower `QUERIES` in
`scripts/measure-orchestrator.js` to the smallest round budget at or above each newly
measured floor, and rewrite the comment block at lines 75-95 to state the NEW floors and to
say plainly that the reservation — not the budget raise — is what moved them. If a floor did
not fall, say so in the comment rather than deleting the history.

- [ ] **Step 3: Run the full gate set**

```bash
npm run test:unit
node --test scripts/lib/gap-register.test.js
node --test scripts/lib/db-url.test.js
npm run gen:decisions
node scripts/gen-decision-index.js --check
npm run verify:docs
node scripts/check-og01-coverage.js --strict
node scripts/check-deferred-rules.js
```

Expected: all PASS. `check-og01-coverage.js --strict` stays `RESULT: PASS` and
`check-deferred-rules.js` reports 0 violations in both scopes — this change touches neither
assessments nor the four deferred rules, and both gates are the proof.

- [ ] **Step 4: Close OG-26 in the register**

In `docs/OPEN_GAPS.md` (CRLF in the working tree):

1. Change the OG-26 row's Class to `**IMPORTANT** (resolved)` and Status to
   `CLOSED <today's date>`. **Leave the row in §1** — the closed-row policy keeps it for one
   release cycle. Add a dated resolution sentence and a `→ C-17` pointer. Do NOT rewrite the
   two existing measurement paragraphs; they are the record of how the defect presented.
2. Add a `C-17` row to the §3 closed table with Item `OG-26 — budget-blind retention`, Status
   `CLOSED <date>`, and a Resolution naming Decision 27, the reservation rule, the
   `budget_floor` field, the before/after floors measured in Step 1, and the
   `measure-og01-reach.js` line that witnesses it. This row is what exempts the `OG-26` id
   from the `gap-register-shape` gate once the row leaves §1 in a later cycle.
3. Rewrite §7 next-action item 1's trailing sentence, which currently says OG-26 "is an engine
   change with a real design decision in it" — that is now stale. Point at the next
   BLOCKING-shaped item instead (OG-07 / OG-08 data, or OG-25's migration-012 decision).
4. Run `npm run verify:docs` and confirm the `gap-register-shape` check still passes: every
   §1 row has exactly 6 cells, no duplicated id, and every cited `OG-nn` is accounted for.

- [ ] **Step 5: Amend the Decision 27 status and sweep the copied claims**

Change the `Status:` line's first clause from `RESOLVED 2026-10-02 — budget-aware retention
ADOPTED but NOT YET IMPLEMENTED` to `RESOLVED 2026-10-02; IMPLEMENTED <today's date>`,
keeping the rest of the line. Then run the AGENTS §8 sweep and fix every copy in the same
commit — leave dated `DEVELOPMENT_NOTES.md` history alone:

```bash
grep -rn "OG-26\|budget-blind\|15000 MAD\|12000 MAD" --include="*.md" .
```

Known sites: `CONTEXT.md` (the seed-002 status paragraph and the `OG-26` side-effect
mention), `AGENTS.md` §6 (the bullet beginning `Seed 004b changed the canonical catalog and
two harness budgets` — its GAMING/OFFICE figures are now wrong), `docs/TEST_MAP.md`, and
`docs/OG-01_ASSESSMENT_RESEARCH_PLAN.md` §Status.

While in `AGENTS.md` §5, also delete the sentence
`One known gap: retention ties fall through to random product.id, so which products reach
builds is NOT stable across a database reset.` It is false: `compareCandidates()` breaks ties
on `product_id` ASC, and this plan's reservation tie-break is now pinned to that same order.
This is a factual correction to the module being changed, not an adjacent refactor.

Add a `docs/TEST_MAP.md` row under "Data-semantics contracts" pinning the reservation rule and
its tie-break to `retention/retain.test.js`.

Add a `DEVELOPMENT_NOTES.md` entry dated today recording: the two measured floors, the
`28P01`-vs-dead-branch preflight, and the fact that the harness budgets are again
re-derivable rather than load-bearing.

- [ ] **Step 6: Run the gates one final time**

```bash
npm run gen:decisions
node scripts/gen-decision-index.js --check
npm run verify:docs
npm run test:unit
git status --porcelain
```

Expected: all gates green; `git status` shows only intended files.

- [ ] **Step 7: Commit**

```bash
git add scripts/measure-orchestrator.js docs/OPEN_GAPS.md docs/RECOMMENDATION_ENGINE_DECISIONS.md docs/DECISION_INDEX.md CONTEXT.md AGENTS.md docs/TEST_MAP.md DEVELOPMENT_NOTES.md
git commit -m "docs: close OG-26 with the measured retention floors after Decision 27"
```

Do not push.

---

## Self-Review

**Spec coverage.** OG-26's row names three things: retention is budget-blind; a budget below
the cheapest retained combination yields zero builds; and a silent empty recommendation is a
product defect. Task 2 fixes the first two (the reservation lowers the retained floor to the
catalog's cheapest-per-role combination). Task 3 plus Task 4 fix the third (`budget_floor` is
always present, so zero builds always carries a reason). Task 5 closes the row with the
measurement. The row's `Owner: engine-code` and the harness-budget consequences are both
honoured. Nothing in the row is left without a task.

**Step scan.** Every step names an exact signature, file, or command. The two code blocks
that do carry bodies — the `retainBucket` replacement and the Task 4 wiring — are there
because the Set-identity trick and the exact result-key order are decisions the signature and
the tests do not determine. No step says "handle edge cases" or "add appropriate tests".

**Type consistency.** `retainTopKPerRole` takes `prices` in Task 2 and every later call site
supplies it. `computeBudgetFloor`'s six output field names are used identically in Task 3's
tests, Task 4's wiring, and Task 4's orchestrator tests. `budget_floor` is the field name on
both result objects. `BUDGET_FLOOR_ROLES` is the constant name in the module, the barrel, and
the test. `priceKey` is imported, never redefined.

**Review Focus.** Five lines, each with its test placed in the owning task: items 1, 4 and 5
in Task 2 Step 1, items 2 and 3 in Task 3 Step 1. All five are covered.

**Proportion.** Five tasks, ~40 steps, against a single IMPORTANT register row whose
implementation is two new/changed pure functions plus wiring. The length is in the boundary
amendments and the doc sweep, which this repo's conventions require, not in transcribed code.

**Known risk, stated rather than hidden.** The reservation is a *floor* guarantee, not a
completeness guarantee: it makes the cheapest-per-role combination reachable, but pairwise
FAILs inside assembly can still abandon that specific branch. `budget_floor.within_budget ===
true` alongside `builds.length === 0` is therefore a legitimate, expected state — Review Focus
item 2 pins that it is representable. This plan does not claim OG-04 (rejection-reason
persistence) is closed, and it should not be cited as such.
