# Step 2.2 — Homepage Finder Functional Validation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the existing homepage finder coordinates use-case selection, budget state,
discovery pathways and real staged recommendation data in French and Arabic, and close only
the E2E gaps that currently have no browser-level coverage.

**Architecture:** Validation-first. A record document captures intended vs implemented
behaviour and the real-API evidence; three focused Playwright specs close the missing mocked
coverage; the live pass is driven in a browser against the EU staging origin with no relay and
no writes. No product logic is expected to change.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query, Zustand, next-intl, Zod,
Playwright (1 chromium project), Vitest + Testing Library, Node built-in tooling.

**Spec:** `apps/web-v2/docs/sections/01-homepage.md` §4–§7 (finder, cards, pathways),
§14 (UI states), §15 (i18n/RTL), §16.3 (budget/usage DoD); the Step 2.2 brief supplies the
report format. Executors read both.

## Global Constraints

- Branch `feature/v2-design` only. `apps/web-v2` only. V1 (`apps/web/`) untouched.
- Read-only against the database and the staging service: no `POST`/`PUT`/`PATCH`/`DELETE`, no
  seed, no migration, no Render change.
- **No commits** unless the owner explicitly asks. Ending state is a reviewed working tree.
- Preserve `apps/web-v2/lib/api/config.ts` as committed in `04e6f77`; do not edit it.
- Preserve the untracked `apps/web-v2/app/[locale]/simulateur-preview/` and `docs/superpowers/`.
- Do not amend, rebase or rewrite any existing commit.
- Values that are fixed and must be copied verbatim: `BUDGET_OPTIONS = [5000, 8000, 12000, 15000]`,
  `BUDGET_MIN = 3500`, `BUDGET_MAX = 100000`, `BUDGET_STEP = 500`,
  `HOMEPAGE_BUDGET_CEILING = 12000`, staging origin `https://morocco-pc-api-eu.onrender.com`,
  dev/start port `3220`, locales `fr` and `ar`.
- No fixed sleeps, no weakened assertions, no skipped tests, no worker/retry changes, no raised
  timeouts. Mocked E2E and real-API validation stay clearly separated in the record.
- Arabic native-speaker sign-off stays outstanding (`docs/homepage-arabic-review.md`); nothing in
  this plan claims it.

## Behaviour facts this plan is built on (measured in the source, 2026-11-07)

Corrections to the brief's implied model — an executor who assumes otherwise will test the
wrong thing:

1. **Budget only affects the cards once a use case is chosen.**
   `RecommendedBuildSection` computes `selectedBudget = useCase === null ? null : budgetAmount`,
   so with no use case the section always shows three peers at the 12 000 ceiling.
2. **There is no currency control.** `currency` comes from `useMetaOptions()` (first advertised
   value, fallback `MAD`) and feeds both the preset query and `formatPrice`. Currency switching
   is a scope limitation, not an untested feature.
3. **Discovery pathways are `lg`-only and there are three tiles**, not four:
   `DiscoveryPathways` is `hidden lg:block`, `TILES` = GAMING/OFFICE/WORKSTATION, each a button
   with `aria-pressed` that writes the store and focuses `#finder-usage`.
4. **The card CTA is not actionable:** it is `<span aria-disabled="true">Voir la configuration</span>`
   plus an icon, so "clicking a card must not submit" is vacuous — the honest assertion is that
   no actionable card element exists.
5. **The finder CTA does not submit in this release** (Q-08): `preventDefault`, scroll to
   `#configurations`, focus its `h2`, URL unchanged, zero requests beyond the reads.
6. **Cap note needs a budget above the top preset tier.** With the 15 000 radio the top tier _is_
   15 000, so no cap appears; the cap is reached by a custom amount above 15 000 (e.g. 20 000).
7. **Below the cheapest tier is an empty slot, not a substitute**: a 3 500 custom budget against a
   ladder whose cheapest row is 5 000 renders `builds.empty.*` and no price.
8. `BudgetUsageFinder` keeps a vestigial `values.useCase` that is always `null` (the store owns
   the answer). Note it in the record; do not "fix" it here.

## Review Focus

The five things the brief's implicit model gets wrong, each pinned to a task's test:

1. **Budget changed before any use case** — expected: three cards still at 12 000; a tester who
   expects narrowing may log a false defect. (Task 2 pins the observed contract.)
2. **Minimum budget (3 500) with a use case** — expected: honest empty slot, no substituted card.
   (Task 2)
3. **Custom budget above the top tier (20 000)** — expected: highest tier plus the cap note that
   names 15 000. (Task 2)
4. **Use case switched while the new ladder is in flight** — expected: the previous card's
   category heading disappears immediately; a skeleton replaces it; the new card appears after.
   (Task 4)
5. **`.env.local` now points at staging, and every spec must stub** — a new spec that forgets
   `stubHomepageApi` would hit the real service; `**/v1/**` matches that host too. (Tasks 3–5)

## File Structure

| Path                                         | Responsibility                                            | Change                                                 |
| -------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `apps/web-v2/e2e/support/homepage-api.ts`    | Stub for every `/v1/**` call                              | Modify: add `presetsDelayMs` / `detailDelayMs` options |
| `apps/web-v2/e2e/homepage-builds.spec.ts`    | Cards, badges, empty/error, narrowing                     | Modify: +3 tests (cap, below-cheapest, stale clear)    |
| `apps/web-v2/e2e/homepage-finder.spec.ts`    | Finder island, pathways, CTA focus                        | Modify: +1 test (pathway narrows cards)                |
| `apps/web-v2/e2e/homepage-finder-ar.spec.ts` | Arabic finder interaction and RTL after selection         | Create                                                 |
| `apps/web-v2/docs/finder-validation.md`      | Intended vs implemented behaviour, live evidence, verdict | Create                                                 |

`apps/web-v2/e2e/homepage-i18n.spec.ts`, `homepage.spec.ts`, the unit tests and every component
stay untouched unless a defect is proven and approved (Task 8).

---

### Task 1: Baseline and behaviour record

**Files:**

- Create: `apps/web-v2/docs/finder-validation.md`

**Interfaces:**

- Produces: the record every later task appends to; sections `## 1. Repository state`,
  `## 2. Intended vs implemented behaviour`, `## 3. Live ladder`, `## 4. French pass`,
  `## 5. Arabic pass`, `## 6. Regression`, `## 7. Defects`, `## 8. Verdict`.

- [x] **Step 1: Capture the initial state**

Run:

```bash
cd /c/projects/morocco-pc
git rev-parse --abbrev-ref HEAD && git log -1 --format='%H %s' && git status --short
```

Expected: `feature/v2-design`; HEAD `4e54d6c` (or a later commit the owner made); status shows
only the two untracked paths. Record the exact output.

- [x] **Step 2: Run the suite before any change**

Run:

```bash
cd apps/web-v2 && npm run typecheck && npm run lint && npm test && npm run test:e2e
```

Expected: exit 0 each; `98 passed`; `22 passed`. Record the counts as the baseline.

- [x] **Step 3: Write the record's behaviour matrix**

Create `apps/web-v2/docs/finder-validation.md` with `## 1. Repository state` (Step 1 output) and
`## 2. Intended vs implemented behaviour` containing exactly this table, one row per row below,
with a `Source` column naming `01-homepage.md §N` or the file that proves it:

| Behaviour            | Intended                           | Implemented today                                                              | Deferred                 |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------ |
| Use-case selection   | three peers, no default            | three radios + three `lg` pathway tiles, both write `useHomepageStore.useCase` | —                        |
| Budget selection     | four presets + custom, one answer  | preset radios, numeric field, `lg`-only range, `resolveBudgetAmount`           | —                        |
| Currency             | `MAD`, confirmed by `meta/options` | read from `meta/options`, no control                                           | switching is not planned |
| Cards on load        | three peers at 12 000              | three slots, ceiling rule                                                      | —                        |
| Cards after answers  | one slot, at/below budget          | one slot; budget ignored until a use case exists                               | —                        |
| Cap / no-match       | cap note / honest empty            | `budgetCap` above top tier; `builds.empty.*` below cheapest                    | —                        |
| Resolution shortcuts | hidden first release               | absent, no store field                                                         | Q-20                     |
| Finder CTA           | no write until results route       | scroll + focus `#configurations` h2                                            | Q-08                     |
| Card CTA             | not a link yet                     | `aria-disabled` span                                                           | results route            |

- [x] **Step 4: Note the two oddities without changing them**

Append under the table: (a) `BudgetUsageFinder` holds a `values.useCase` that is always `null`
because the store owns the answer; (b) the cap note compares against the _highest served tier_,
which is 15 000 in the stub ladder, so only a custom budget above 15 000 reaches it.

- [x] **Step 5: Commit**

None. Report the file as an uncommitted addition.

---

### Task 2: Pin the budget boundaries in the browser (mocked)

**Files:**

- Modify: `apps/web-v2/e2e/homepage-builds.spec.ts`

**Interfaces:**

- Consumes: `stubHomepageApi` (`LADDER = [5000, 8000, 12000, 15000]`), `CARD_TITLES`.
- Produces: nothing for later tasks.

- [x] **Step 1: Add the below-cheapest test**

```ts
test("shows the honest empty slot when the budget is below the cheapest tier", async ({
  page,
}) => {
  const { posts } = await stubHomepageApi(page);
  await page.goto("/fr");

  await page
    .getByRole("radio", { name: /Jeux vidéo & Gaming/ })
    .check({ force: true });
  await page
    .getByRole("spinbutton", { name: "Budget exact en dirhams" })
    .fill("3500");

  const section = page.locator("#configurations");
  await expect(
    section.getByText("Aucune configuration disponible pour cet usage"),
  ).toBeVisible();
  await expect(
    section.getByRole("heading", { name: CARD_TITLES.GAMING }),
  ).toBeVisible();
  await expect(section.getByText(/Budget visé/)).toHaveCount(0);
  expect(posts).toEqual([]);
});
```

- [x] **Step 2: Add the cap-note test**

```ts
test("caps a budget above the top tier and names the tier it served", async ({
  page,
}) => {
  const { posts } = await stubHomepageApi(page);
  await page.goto("/fr");

  await page
    .getByRole("radio", { name: /Jeux vidéo & Gaming/ })
    .check({ force: true });
  await page
    .getByRole("spinbutton", { name: "Budget exact en dirhams" })
    .fill("20000");

  const section = page.locator("#configurations");
  await expect(
    section.getByText(
      /Configuration pré-générée la plus élevée disponible : 15\s?000\s?DH/,
    ),
  ).toBeVisible();
  await expect(section.getByText(/Budget visé · 15\s?000\s?DH/)).toBeVisible();
  expect(posts).toEqual([]);
});
```

- [x] **Step 3: Run both, and prove each fails for its own reason**

Two independent mutations, each reverted with `git checkout --` before the next:

- **Below-cheapest:** in `selectSlotPreset`, make the no-match branch substitute the cheapest row
  (`?? ladder[0] ?? null`). Only the empty-slot test must fail, because a card then shows a budget
  line where none is allowed.
- **Cap:** replace `if (budgetAmount > highest.budget_amount)` with
  `if (false && budgetAmount > highest.budget_amount)`. Only the cap test must fail.

`HOMEPAGE_BUDGET_CEILING` is inert here: both tests set a custom budget, so the
`budgetAmount === null` branch never runs. Do not use it as the mutation.

- [x] **Step 4: Run the whole file green**

Run: `npx playwright test e2e/homepage-builds.spec.ts`
Expected: `9 passed`.

- [x] **Step 5: Commit**

None.

---

### Task 3: Make the stub able to hold a response open

**Files:**

- Modify: `apps/web-v2/e2e/support/homepage-api.ts`

**Interfaces:**

- Produces: `StubHomepageApiOptions.presetsDelayMs?: number` and `.detailDelayMs?: number`,
  applied with `await new Promise((resolve) => setTimeout(resolve, ms))` inside the existing
  handlers before `route.fulfill`. Task 4 consumes `presetsDelayMs`.

- [x] **Step 1: Add the two option fields**

Extend the interface with both numbers, documented as "test latency, never a product sleep".

- [x] **Step 2: Apply them in the handlers**

In the `/v1/presets` branch, before `route.fulfill`, delay by `options.presetsDelayMs ?? 0`; in
the `/v1/recommendations/` branch, by `options.detailDelayMs ?? 0`. Do not delay the non-GET
branch or `meta/options`.

- [x] **Step 3: Prove the stub still behaves**

Run: `npx playwright test e2e/homepage-finder.spec.ts e2e/homepage.spec.ts`
Expected: `12 passed`, unchanged.

- [x] **Step 4: Commit**

None.

---

### Task 4: Prove a use-case switch cannot leave the previous card on screen

> **Executed 2026-11-07 with one premise correction.** All three ladders are fetched on first
> paint, so a use-case switch is served from the TanStack cache and no skeleton is ever rendered
> (`Chargement des configurations…` count 0 where Step 1 expects 1). The switch test asserts the
> reachable invariant — previous category gone, exactly one card, `aria-labelledby` equal to the
> new use case's recommendation id — and first-paint pending state is covered by its own skeleton
> test. Evidence: `apps/web-v2/docs/finder-validation.md` §6.2.

**Files:**

- Modify: `apps/web-v2/e2e/homepage-builds.spec.ts`

**Interfaces:**

- Consumes: `presetsDelayMs` from Task 3.

- [x] **Step 1: Write the test**

```ts
test("clears the previous use case's card while the next ladder is in flight", async ({
  page,
}) => {
  const { posts } = await stubHomepageApi(page, { presetsDelayMs: 900 });
  await page.goto("/fr");

  const section = page.locator("#configurations");
  await expect(
    section.getByRole("heading", { name: CARD_TITLES.GAMING }),
  ).toBeVisible();

  await page
    .getByRole("radio", { name: /Études et bureautique/ })
    .check({ force: true });

  // The new key has no data yet: the old category must be gone, not merely dimmed.
  await expect(
    section.getByRole("heading", { name: CARD_TITLES.GAMING }),
  ).toHaveCount(0);
  await expect(page.getByText("Chargement des configurations…")).toHaveCount(1);

  await expect(
    section.getByRole("heading", { name: CARD_TITLES.OFFICE }),
  ).toBeVisible();
  await expect(section.locator("article")).toHaveCount(1);
  expect(posts).toEqual([]);
});
```

- [x] **Step 2: Run it**

Run: `npx playwright test e2e/homepage-builds.spec.ts -g "in flight"`
Expected: PASS. If it fails with the GAMING heading still present, stop: that is a real stale-state
defect — record it in the record and follow Task 8's defect procedure instead of editing the test.

- [x] **Step 3: Repeat it for determinism**

Run: `npx playwright test e2e/homepage-builds.spec.ts -g "in flight" --repeat-each=5`
Expected: `5 passed` with the default workers.

- [x] **Step 4: Commit**

None.

---

### Task 5: Prove a pathway tile narrows the cards, not just the radio

**Files:**

- Modify: `apps/web-v2/e2e/homepage-finder.spec.ts`

**Interfaces:**

- Consumes: `stubHomepageApi`, `CARD_TITLES`.

- [x] **Step 1: Write the test**

```ts
test("narrows the cards to the pathway's use case", async ({ page }) => {
  const { posts } = await stubHomepageApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/fr");

  const section = page.locator("#configurations");
  await expect(section.locator("article")).toHaveCount(3);

  await page
    .getByRole("button", { name: "Études & bureautique", exact: true })
    .click();

  await expect(page.getByRole("radio", { name: USAGE_OFFICE })).toBeChecked();
  await expect(section.locator("article")).toHaveCount(1);
  await expect(
    section.getByRole("heading", { name: CARD_TITLES.OFFICE }),
  ).toBeVisible();
  await expect(
    section.getByRole("heading", { name: CARD_TITLES.GAMING }),
  ).toHaveCount(0);
  expect(posts).toEqual([]);
});
```

- [x] **Step 2: Run it**

Run: `npx playwright test e2e/homepage-finder.spec.ts -g "pathway's use case"`
Expected: PASS. A count of 3 after the click means the tiles only write the radio — record as a
defect (Task 8) rather than relaxing the assertion.

- [x] **Step 3: Record the sub-`lg` absence once, by hand**

No test is added for this: `#pathways` is `hidden lg:block`, so at `390×844` it must not be
visible. Confirm it manually during the browser pass in Task 7 and record the observation in the
doc rather than encoding a breakpoint rule twice.

- [x] **Step 4: Commit**

None.

---

### Task 6: Arabic finder interaction, not just Arabic layout

**Files:**

- Create: `apps/web-v2/e2e/homepage-finder-ar.spec.ts`

**Interfaces:**

- Consumes: `stubHomepageApi`. Arabic strings come from `apps/web-v2/messages/ar.json`
  (`Homepage.finder.budget.presetLabel` `ميزانية {amount}`, usage `الدراسة والمكتبيات`,
  card heading `حاسوب للمكتبيات`, `Homepage.builds.budgetLabel` `الميزانية المستهدفة`).

- [x] **Step 1: Write the spec**

```ts
import { expect, test } from "@playwright/test";

import { stubHomepageApi } from "./support/homepage-api";

test.describe("Arabic finder", () => {
  test("selects a budget and a use case, then narrows to one Arabic card", async ({
    page,
  }) => {
    const { posts } = await stubHomepageApi(page);
    await page.goto("/ar");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page
      .getByRole("radio", { name: /ميزانية 8\s?000/ })
      .check({ force: true });
    await page
      .getByRole("radio", { name: /الدراسة والمكتبيات/ })
      .check({ force: true });

    const section = page.locator("#configurations");
    await expect(section.locator("article")).toHaveCount(1);
    await expect(
      section.getByRole("heading", { name: "حاسوب للمكتبيات" }),
    ).toBeVisible();
    await expect(section.getByText(/الميزانية المستهدفة/)).toBeVisible();
    expect(posts).toEqual([]);
  });

  test("keeps the narrowed Arabic cards inside the viewport at 360", async ({
    page,
  }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/ar");

    await page
      .getByRole("radio", { name: /ميزانية 8\s?000/ })
      .check({ force: true });
    await page
      .getByRole("radio", { name: /الدراسة والمكتبيات/ })
      .check({ force: true });
    await expect(page.locator("#configurations article")).toHaveCount(1);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
```

- [x] **Step 2: Run it**

Run: `npx playwright test e2e/homepage-finder-ar.spec.ts`
Expected: `2 passed`.

- [x] **Step 3: Re-run the file for stability**

Run: `npx playwright test e2e/homepage-finder-ar.spec.ts --repeat-each=3`
Expected: `6 passed`.

- [x] **Step 4: Commit**

None.

---

### Task 7: Live French pass against the staging origin

**Files:**

- Modify: `apps/web-v2/docs/finder-validation.md` (§3 and §4)

**Interfaces:**

- Consumes: `apps/web-v2/.env.local` already pointing at `https://morocco-pc-api-eu.onrender.com`.
- Produces: the measured ladder table §3 that Task 8's probes are chosen from.

- [x] **Step 1: Start the frontend**

Run: `cd apps/web-v2 && npm run dev`, then wait for `GET /fr 200` in its log. Confirm the log
says `Environments: .env.local`.

- [x] **Step 2: Record the live ladder before asserting anything**

In the browser at `/fr`, capture `https://morocco-pc-api-eu.onrender.com/v1/presets?use_case=GAMING|OFFICE|WORKSTATION&currency=MAD`
from the network panel and record for each use case: row count, `budget_amount` **minimum and
maximum**, and the `recommendation_id` for the highest row at or below 12 000. Do not reuse
remembered ids. Expect the 12 000 picks to be `366d0fae…` (Gaming), `20417fa9…` (Office),
`3b157941…` (Workstation) — a difference is evidence, not a failure, so record it.

- [x] **Step 3: Walk the scenarios and record each in §4**

For every step record the request line (method, path, query, status) and the visible result:

1. Load `/fr`: three cards, 12 000 tier, seven reads (meta + 3 presets + 3 details), no write.
2. Choose GAMING only: section narrows to one card at 12 000; budget still unset.
3. Choose 8 000: card follows the highest live tier ≤ 8 000; if the live ladder has none, expect
   the empty slot and record that as the correct outcome, not a defect.
4. Type 20 000: cap note naming the highest tier.
5. Type 3 500: empty slot, no price, no badge.
6. Switch GAMING → OFFICE → WORKSTATION → GAMING: each shows one card; no previous use case text
   remains; the GAMING card at the end matches step 2's id.
7. Click the `Études & bureautique` pathway at ≥1280: radio follows, `#finder-usage` receives
   focus, cards narrow.
8. Submit the CTA with both answers: URL stays `/fr`, `#configurations-title` is focused, zero
   `POST`.
9. Click every card's text area: nothing navigates, no request is issued.

- [x] **Step 4: Confirm the write count**

In the network panel filter for `POST|PUT|PATCH|DELETE` across the whole session. Expected: zero.
Record the exact filter result.

- [x] **Step 5: Commit**

None.

---

### Task 8: Live Arabic pass, then regression, defects and verdict

**Files:**

- Modify: `apps/web-v2/docs/finder-validation.md` (§5–§8)

**Interfaces:**

- Consumes: Task 7's ladder table; the staging origin; `.env.local`.

- [x] **Step 1: Repeat the core walk at `/ar`**

Record: `dir="rtl"`; the three Arabic card headings; one-card narrowing after a budget + usage
selection; `سعر إرشادي` / `سعر مُوثَّق` badges matching `builds[0].price_status`; the served French
`explanation` is shown as served (a known non-mapping, not a defect); overflow 0 at 360; zero
writes.

- [x] **Step 2: Test the rapid-switch sequence**

Switch use cases four times quickly, then settle on one. Confirm the final card's
`recommendation_id` (visible via the card's `aria-labelledby` → `build-<id>`) belongs to the final
use case and that no intermediate card remains. Record the observed request order; duplicate
in-flight requests for the same key are a finding, missing cancellation is not (TanStack Query
keeps the last key's data).

- [x] **Step 3: Run the required regression suite**

Run, in `apps/web-v2`:

```bash
npm run typecheck && npm run lint && npm run format:check && npm run check:api-types
npm test
npm run test:e2e
```

Expected: exit 0 each; unit `98 passed`; E2E **28 passed** (the 22 existing plus 6 new: 2 in
Task 2, 1 in Task 4, 1 in Task 5, 2 in Task 6). Record the actual number.

- [x] **Step 4: Handle any proven defect**

Only if a check above contradicts the record's "intended" column: reproduce it twice, write the
expected/observed/root-cause/files into §7, propose the smallest correction, get owner approval
for a product change, add the regression test to the owning spec, and re-run the affected
commands. Never adjust an assertion, timeout or worker count to make a check pass.

- [x] **Step 5: Write the verdict**

`## 8. Verdict` uses one of `PASS` / `CONDITIONAL` / `FAIL` / `UNKNOWN`, names every deferred
feature explicitly (resolution shortcuts Q-20, finder POST Q-08, card CTA, currency switching,
Arabic sign-off), and states that mocked coverage is not API evidence.

- [x] **Step 6: Stop the dev server and report the tree**

> **Executed 2026-11-07:** the `next dev` server on port 3220 pre-dated this pass, so it was
> reused and left running instead of being killed; the tree is reported in §6.4 of the record.

Kill only the PID listening on 3220; run `git status --short` and list changed/added files. No
commit unless the owner asks.

---

## Self-Review

**Spec coverage:** use-case selection (Tasks 4, 5, 7), budget boundaries (Task 2, Task 7 steps
3–5), currency (recorded as a limitation in Task 1, no control exists), cards and variants
(Task 1 matrix + Task 7 step 9), discovery pathways (Task 5, Task 7 step 7), state transitions
(Tasks 4, 8 step 2), French/Arabic (Tasks 6, 7, 8), real API (Tasks 7–8), loading/empty/error
(existing specs plus Task 2), E2E coverage (Tasks 2–6), regression (Task 8 step 3), report
(Tasks 1, 7, 8).

**Type consistency:** `presetsDelayMs`/`detailDelayMs` defined in Task 3 and consumed only by
Task 4; `CARD_TITLES` and `stubHomepageApi` are existing exports; `USAGE_OFFICE` is an existing
constant in `homepage-finder.spec.ts`.

**Review Focus:** all five lines map to Task 2 (lines 1–3) and Task 4 (line 4), with the stub
requirement enforced in Tasks 3–6 (line 5).

**Proportion:** five tasks touch tests and one document; no product file is planned to change.
