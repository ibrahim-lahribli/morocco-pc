# Step 3.3 — Homepage → Configurator Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the homepage finder's CTA hand its two answers to `/{locale}/configurateur` through one canonical URL contract, and make the configurator state the truth about what it is showing — no loaded pass, or a pass whose own use case and budget are visible.

**Architecture:** A pure `buildConfiguratorHref` joins `parseConfiguratorSearchParams` in `lib/configurator/schema.ts`, so one module owns both directions of the URL contract; the finder calls it and pushes with next-intl's locale-aware router. The configurator side needs no new state: the panel already receives the detail, and gains the pass's `use_case` plus a submitted/not-submitted distinction for the empty state.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl 4, TanStack Query 5, Zustand 5, Zod 4, Tailwind v4 tokens, Vitest 5 (jsdom), Playwright 1.65.

**Spec:** `docs/superpowers/plans/2026-11-07-step-3-2-configurator-foundation.md` (the route this plan integrates with), `apps/web-v2/docs/sections/01-homepage.md` §5.5 (the CTA decision being superseded), `apps/web-v2/docs/sections/01-homepage-api-mapping.md` (the only contract), and the Step 3.3 brief supplied by the owner on 2026-11-07.

## Global Constraints

- Branch `feature/v2-design`; application `apps/web-v2`; V1 (`apps/web/`) untouched. Baseline `8da9521`.
- **Do not commit or push** (brief §10). Tasks end with a green check, not a commit.
- **GETs only**: `/v1/meta/options`, `/v1/presets`, `/v1/recommendations/{id}`. No `POST`, `PUT`, `PATCH`, `DELETE`, and no `useMutation`.
- Canonical parameters are `use_case` and `budget`; `from` is unchanged. One validation owner: `lib/configurator/schema.ts`. No second parser, no second copy of the bounds.
- The URL is never rewritten and an invalid value is never clamped or defaulted. `buildConfiguratorHref` returns `null` rather than inventing an answer.
- The locale prefix comes from `@/i18n/navigation`; the builder returns a locale-less path.
- Every visible string comes from `messages/fr.json` / `messages/ar.json`, with identical keys and placeholders. Arabic is machine-authored and is **not** native-approved.
- Logical properties only; 48 px targets below `lg`, 44 px above.
- E2E stubs every `/v1/**`: an unexpected write or an unmatched API path fails the spec.
- Preserve the pre-existing working tree: the six modified screenshots, `scripts/screenshots.mjs`, `app/[locale]/simulateur-preview/`.

## Review Focus

| Input / condition                                                    | Behaviour a reasonable person expects                                                                       | Test that pins it                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A direct visit with no parameters at all                             | A normal empty form, no error on arrival; messages only after a submit                                      | Task 1 shape + `e2e/configurator.spec.ts` (empty route) |
| A valid `from` combined with an out-of-range `budget`                | The pass loads **and** the budget field shows its range error; neither state erases the other               | Task 5 `from` + invalid budget spec                     |
| A loaded pass whose use case differs from the visitor's typed answer | The summary shows the pass's own use case and budget; the form keeps what the visitor typed                 | Task 3 panel spec + Task 5 `from` spec                  |
| Locale switch after `Continuer`                                      | The query survives, the answers survive, the phase returns to requirements (client state is not in the URL) | Task 5 locale-switch spec                               |
| 360 px Arabic with the new summary meta line                         | No horizontal scroll; the bar still sits above the nav                                                      | Task 5 360 Arabic spec                                  |

---

### Task 1: One URL contract, both directions

**Files:**

- Modify: `apps/web-v2/lib/configurator/schema.ts`
- Test: `apps/web-v2/tests/configurator/handoff.test.ts`

**Interfaces:**

- Consumes: `HOME_USE_CASES`, `BUDGET_MIN`, `BUDGET_MAX` (already imported by `schema.ts`), `parseConfiguratorSearchParams` (already there).
- Produces: `interface ConfiguratorHandoffAnswers { useCase: ConfiguratorUseCase | null; budgetAmount: number | null }` and `buildConfiguratorHref(answers: ConfiguratorHandoffAnswers): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web-v2/tests/configurator/handoff.test.ts
import { describe, expect, it } from "vitest";

import {
  buildConfiguratorHref,
  parseConfiguratorSearchParams,
} from "@/lib/configurator/schema";

const queryOf = (href: string) =>
  Object.fromEntries(new URLSearchParams(href.slice(href.indexOf("?") + 1)));

describe("buildConfiguratorHref", () => {
  it("builds the canonical href for every use case", () => {
    expect(
      buildConfiguratorHref({ useCase: "GAMING", budgetAmount: 12_000 }),
    ).toBe("/configurateur?use_case=GAMING&budget=12000");
    expect(
      buildConfiguratorHref({ useCase: "OFFICE", budgetAmount: 8_000 }),
    ).toBe("/configurateur?use_case=OFFICE&budget=8000");
    expect(
      buildConfiguratorHref({ useCase: "WORKSTATION", budgetAmount: 15_000 }),
    ).toBe("/configurateur?use_case=WORKSTATION&budget=15000");
  });

  it("accepts both bounds and refuses everything outside the contract", () => {
    expect(
      buildConfiguratorHref({ useCase: "GAMING", budgetAmount: 3_500 }),
    ).not.toBeNull();
    expect(
      buildConfiguratorHref({ useCase: "GAMING", budgetAmount: 100_000 }),
    ).not.toBeNull();

    for (const budgetAmount of [3_499, 100_001, 0, -1, 12_000.5, Number.NaN]) {
      expect(
        buildConfiguratorHref({ useCase: "GAMING", budgetAmount }),
      ).toBeNull();
    }

    expect(
      buildConfiguratorHref({ useCase: "GAMING", budgetAmount: null }),
    ).toBeNull();
    expect(
      buildConfiguratorHref({ useCase: null, budgetAmount: 12_000 }),
    ).toBeNull();
  });

  it("round-trips through the parser the route uses", () => {
    const href = buildConfiguratorHref({
      useCase: "OFFICE",
      budgetAmount: 8_000,
    });
    expect(href).not.toBeNull();

    expect(parseConfiguratorSearchParams(queryOf(href ?? ""))).toEqual({
      useCase: "OFFICE",
      budgetAmount: 8000,
      budgetText: null,
      recommendationId: null,
      fieldErrors: {},
    });
  });

  it("emits exactly two canonical parameters and never a from", () => {
    const href =
      buildConfiguratorHref({ useCase: "GAMING", budgetAmount: 12_000 }) ?? "";
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));

    expect([...params.keys()]).toEqual(["use_case", "budget"]);
    expect(params.has("from")).toBe(false);
    expect(href.startsWith("/configurateur?")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web-v2 && npx vitest run tests/configurator/handoff.test.ts`
Expected: FAIL — `buildConfiguratorHref is not a function` / no export.

- [ ] **Step 3: Implement `buildConfiguratorHref` in `lib/configurator/schema.ts`**

Export the two symbols just above `parseConfiguratorSearchParams`, so the builder and the parser read as one contract:

```ts
export interface ConfiguratorHandoffAnswers {
  useCase: ConfiguratorUseCase | null;
  budgetAmount: number | null;
}

/**
 * The inverse of `parseConfiguratorSearchParams`, for the homepage handoff.
 * Returns null rather than inventing an answer: the caller must not navigate.
 */
export function buildConfiguratorHref(
  answers: ConfiguratorHandoffAnswers,
): string | null {
  const { useCase, budgetAmount } = answers;
  if (
    useCase === null ||
    !(HOME_USE_CASES as readonly string[]).includes(useCase)
  )
    return null;
  if (budgetAmount === null || !Number.isSafeInteger(budgetAmount)) return null;
  if (budgetAmount < BUDGET_MIN || budgetAmount > BUDGET_MAX) return null;

  const params = new URLSearchParams({
    use_case: useCase,
    budget: String(budgetAmount),
  });
  return `/configurateur?${params.toString()}`;
}
```

- [ ] **Step 4: Run the test, then the configurator suite**

Run: `cd apps/web-v2 && npx vitest run tests/configurator/handoff.test.ts tests/configurator/schema.test.ts && npm run typecheck`
Expected: PASS, typecheck 0.

---

### Task 2: The finder hands the answers over

**Files:**

- Modify: `apps/web-v2/components/home/budget-usage-finder.tsx`
- Modify: `apps/web-v2/tests/components/finder.test.tsx`
- Modify: `apps/web-v2/e2e/homepage-finder.spec.ts`
- Modify: `apps/web-v2/e2e/homepage-builds.spec.ts:88-93`

**Interfaces:**

- Consumes: `buildConfiguratorHref` from Task 1; `useRouter` from `@/i18n/navigation`.
- Produces: no new export. The finder's submit navigates instead of scrolling.

- [ ] **Step 1: Rewrite the pinned unit test**

In `tests/components/finder.test.tsx`, replace the `mountConfigurationsSection` helper and the `"writes the answers to the store and moves focus to the configurations section"` test with:

```tsx
const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

// …inside describe:
beforeEach(() => {
  push.mockClear();
});

it("hands the two answers to the configurator", () => {
  renderFinder();

  fireEvent.click(preset(12_000));
  fireEvent.click(screen.getByRole("radio", { name: /Études et bureautique/ }));
  fireEvent.click(cta());

  expect(push).toHaveBeenCalledWith(
    "/configurateur?use_case=OFFICE&budget=12000",
  );
  expect(push).toHaveBeenCalledTimes(1);
  expect(useHomepageStore.getState().budgetAmount).toBe(12_000);
  expect(useHomepageStore.getState().useCase).toBe("OFFICE");
});

it("never navigates without both answers", () => {
  renderFinder();

  fireEvent.click(preset(12_000));
  expect(cta()).toBeDisabled();
  fireEvent.click(cta());
  expect(push).not.toHaveBeenCalled();
});
```

Delete the `Element.prototype.scrollIntoView` stub and the `#configurations` mount/cleanup hooks if nothing else uses them.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web-v2 && npx vitest run tests/components/finder.test.tsx`
Expected: FAIL — `push` never called (the component still scrolls).

- [ ] **Step 3: Replace the scroll with the handoff**

In `budget-usage-finder.tsx`: import `useRouter` from `@/i18n/navigation`, import `buildConfiguratorHref`, and replace the body of `onSubmit` after the `canSubmit` guard with:

```tsx
const href = buildConfiguratorHref({ useCase: storedUseCase, budgetAmount });
if (href === null) {
  return;
}
router.push(href);
```

Update the component's doc comment: the CTA now navigates to the configurator with the answers in the URL; it still never posts. The `#configurations` section keeps rendering — only the scroll target disappears.

- [ ] **Step 4: Run the unit test**

Run: `cd apps/web-v2 && npx vitest run tests/components/finder.test.tsx`
Expected: PASS.

- [ ] **Step 5: Replace the browser assertion that pinned the scroll**

In `e2e/homepage-finder.spec.ts`, replace the `"moves focus to the configurations heading on submit and never posts"` test:

```ts
test("hands the answers to the configurator and never posts", async ({
  page,
}) => {
  const { posts } = await stubHomepageApi(page);
  await page.goto("/fr");

  await page
    .getByRole("radio", { name: BUDGET_PRESET_8000 })
    .check({ force: true });
  await page.getByRole("radio", { name: USAGE_OFFICE }).check({ force: true });
  await page.getByRole("button", { name: CTA, exact: true }).click();

  await expect(page).toHaveURL(
    /\/fr\/configurateur\?use_case=OFFICE&budget=8000$/,
  );
  await expect(page.getByRole("radio", { name: USAGE_OFFICE })).toBeChecked();
  await expect(
    page.getByRole("spinbutton", { name: "Budget (DH)" }),
  ).toHaveValue("8000");

  expect(posts).toEqual([]);
});
```

In `e2e/homepage-builds.spec.ts` (the `"narrows to the finder's use case and budget without posting"` test), replace

```ts
await expect(page).toHaveURL(/\/fr$/);
```

with

```ts
await expect(page).toHaveURL(
  /\/fr\/configurateur\?use_case=OFFICE&budget=8000$/,
);
```

`stubHomepageApi` already answers `/v1/meta/options`, so the destination's currency query is stubbed; no detail request is made.

- [ ] **Step 6: Run both browser specs**

Run: `cd apps/web-v2 && npx playwright test e2e/homepage-finder.spec.ts e2e/homepage-builds.spec.ts`
Expected: PASS, no unmatched-path failure.

---

### Task 3: The summary states the pass's own use case

**Files:**

- Modify: `apps/web-v2/lib/configurator/schema.ts` (add `USE_CASE_MESSAGE_KEYS`)
- Modify: `apps/web-v2/components/configurator/build-summary-panel.tsx`
- Modify: `apps/web-v2/messages/fr.json`, `apps/web-v2/messages/ar.json`
- Test: `apps/web-v2/tests/configurator/build-summary-panel.test.tsx`

**Interfaces:**

- Consumes: `PresetDetail["use_case"]`, `formatPrice`, `Configurator.summary.useCaseLabel` (new key).
- Produces: `export const USE_CASE_MESSAGE_KEYS: Record<ConfiguratorUseCase, "gaming" | "office" | "creation">` — Task 4 reuses it for the recap.

- [ ] **Step 1: Write the failing panel test**

```tsx
it("shows the pass's own use case and budget, not the form's", () => {
  renderPanel({
    detail: { ...detail, use_case: "OFFICE", budget_amount: 15_000 } as never,
  });

  expect(screen.getByText(/Études et bureautique/)).toBeInTheDocument();
  expect(screen.getByText(/15\s?000/)).toBeInTheDocument();
  expect(screen.queryByText("Jeux vidéo & Gaming")).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web-v2 && npx vitest run tests/configurator/build-summary-panel.test.tsx`
Expected: FAIL — the OFFICE label is absent (only the budget renders).

- [ ] **Step 3: Add the key and render the pair**

`messages/fr.json` → `Configurator.summary.useCaseLabel`: `"Usage"`.
`messages/ar.json` → `"الاستخدام"`.

In `lib/configurator/schema.ts`, export the one mapping this task and Task 4 share:

```ts
export const USE_CASE_MESSAGE_KEYS: Record<
  ConfiguratorUseCase,
  "gaming" | "office" | "creation"
> = {
  GAMING: "gaming",
  OFFICE: "office",
  WORKSTATION: "creation",
};
```

Import it in `build-summary-panel.tsx` — one map, never a second. Add `const tRequirements = useTranslations("Configurator.requirements")`. Replace the header's budget paragraph with one meta paragraph:

```tsx
<p className="mt-1 text-label-md text-muted">
  {t("useCaseLabel")} ·{" "}
  <span className="font-semibold text-foreground">
    {tRequirements(`usage.${USE_CASE_MESSAGE_KEYS[detail.use_case]}.title`)}
  </span>
  <span aria-hidden="true"> · </span>
  {t("budgetLabel")} ·{" "}
  <span className="font-semibold text-foreground tabular-nums">
    {formatPrice(detail.budget_amount, displayCurrency)}
  </span>
</p>
```

The paragraph already only renders when `state === "ready"` and `budget_amount` is non-null; guard the use-case label the same way (render the pair only if both are present). If the generated `use_case` type is wider than the three values, index through a `Record<string, …>` and omit the pair when the key is unknown — never fall back to a label that could be wrong.

- [ ] **Step 4: Run the panel suite**

Run: `cd apps/web-v2 && npx vitest run tests/configurator/build-summary-panel.test.tsx`
Expected: PASS.

---

### Task 4: The no-`from` journey says what happens next

**Files:**

- Modify: `apps/web-v2/components/configurator/build-summary-panel.tsx`
- Modify: `apps/web-v2/components/configurator/configurator-shell.tsx`
- Modify: `apps/web-v2/messages/fr.json`, `apps/web-v2/messages/ar.json`
- Test: `apps/web-v2/tests/configurator/build-summary-panel.test.tsx`

**Interfaces:**

- Consumes: `ConfiguratorRequirements` from `@/lib/configurator/store`; `USE_CASE_MESSAGE_KEYS` from Task 3.
- Produces: `BuildSummaryPanel` gains required props `requirements: ConfiguratorRequirements` and `submitted: boolean`. The shell passes the store's `requirements` and `phase === "review"`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("explains the empty panel before any submit", () => {
  renderPanel({ detail: undefined });

  expect(
    screen.getByText(fr.Configurator.summary.emptyBody),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Vos réponses/)).toBeNull();
});

it("recaps the answers after a submit and claims no build", () => {
  renderPanel({
    detail: undefined,
    submitted: true,
    requirements: { useCase: "OFFICE", budgetAmount: 8_000 },
  });

  expect(
    screen.getByText(fr.Configurator.summary.reviewBody),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Vos réponses : Études et bureautique · 8\s?000\s?DH/),
  ).toBeInTheDocument();
});

it("never recaps under a loaded pass", () => {
  renderPanel({
    submitted: true,
    requirements: { useCase: "OFFICE", budgetAmount: 8_000 },
  });

  expect(screen.queryByText(/Vos réponses/)).toBeNull();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web-v2 && npx vitest run tests/configurator/build-summary-panel.test.tsx`
Expected: FAIL — the props do not exist and the copy is the old one.

- [ ] **Step 3: Add the props, the copy and the recap**

Exact copy (fr / ar), same keys both files:

| Key                   | French                                                                                                                     | Arabic                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `summary.emptyBody`   | `Choisissez un usage et un budget, puis continuez. Aucune configuration n'est encore chargée.`                             | `اختر الاستخدام والميزانية ثم تابع. لا يوجد تكوين محمّل بعد.`            |
| `summary.reviewBody`  | `Vos réponses sont enregistrées. Aucune configuration n'a encore été générée : la génération arrive à la prochaine étape.` | `تم حفظ إجاباتك. لم يُنشأ أي تكوين بعد: الإنشاء يأتي في الخطوة التالية.` |
| `summary.reviewRecap` | `Vos réponses : {useCase} · {budget}`                                                                                      | `إجاباتك: {useCase} · {budget}`                                          |

In the panel's `state === "empty"` block:

```tsx
<p className="text-body-sm text-muted">
  {submitted ? t("reviewBody") : t("emptyBody")}
</p>;
{
  submitted &&
  requirements.useCase !== null &&
  requirements.budgetAmount !== null ? (
    <p className="mt-2 text-label-md font-semibold text-foreground">
      {t("reviewRecap", {
        useCase: tRequirements(
          `usage.${USE_CASE_MESSAGE_KEYS[requirements.useCase]}.title`,
        ),
        budget: formatPrice(requirements.budgetAmount, displayCurrency),
      })}
    </p>
  ) : null;
}
```

In `configurator-shell.tsx`: read `const requirements = useStore(store, (state) => state.requirements);` and pass `requirements={requirements}` and `submitted={phase === "review"}`.

- [ ] **Step 4: Run the configurator unit suite and the i18n parity test**

Run: `cd apps/web-v2 && npx vitest run tests/configurator tests/i18n && npm run typecheck`
Expected: PASS; `tests/i18n/messages.test.ts` proves key and placeholder parity.

- [ ] **Step 5: Update the existing panel test that assert the old copy**

`"shows the empty state when no link supplied one"` asserts `Aucune configuration chargée` (the title, still correct). If any test asserts the old `emptyBody`, retarget it to the new key reference rather than the literal.

---

### Task 5: The journey, end to end

**Files:**

- Modify: `apps/web-v2/e2e/support/configurator-api.ts` (answer `GET /v1/presets`)
- Create: `apps/web-v2/e2e/journey.spec.ts`

**Interfaces:**

- Consumes: `stubConfiguratorApi`, `expectNoApiViolations`, `FROM_ID`, `COMPONENT_NAMES` from `./support/configurator-api`.
- Produces: nothing imported elsewhere.

- [ ] **Step 1: Let the stub survive the homepage leg**

`stubConfiguratorApi` must answer `GET /v1/presets` with the same four-tier ladder the homepage stub uses, `5000 / 8000 / 12000 / 15000`, one preset per tier (`recommendation_id: "rec-${use_case}-${budget_amount}"`), for any advertised `use_case`. It must **not** become permissive: keep `writes` (non-GET → 405) and `unmatched` (other API path → 404) exactly as they are, and keep `expectNoApiViolations` failing on either.

- [ ] **Step 2: Write the journey spec**

One `test.describe("homepage to configurator", …)`, each test ending with `expectNoApiViolations(stub)`:

1. **Gaming 12 000** — `/fr`, preset 12 000 + Gaming, CTA → `/fr/configurateur?use_case=GAMING&budget=12000`; radio checked, budget `12000`; `Continuer` → recap `Vos réponses : Jeux vidéo & Gaming · 12 000 DH`.
2. **Office 8 000** — same pattern, `/fr/configurateur?use_case=OFFICE&budget=8000`.
3. **Workstation 15 000** — same pattern, `WORKSTATION` / `15000`.
4. **Direct entry** — `page.goto("/ar/configurateur?use_case=OFFICE&budget=8000")`: `dir="rtl"`, office radio checked, budget `8000`.
5. **Refresh** — reload the current URL; same radio, same value, no error.
6. **Back** — after arriving from the homepage, `page.goBack()` lands on `/fr` with the finder's h1 visible. Do **not** assert the finder's answers survive: the budget is form-local by design.
7. **fr → ar** — from `/fr/configurateur?use_case=GAMING&budget=12000`, click `Afficher en العربية`; URL `/ar/configurateur?…` with both parameters, Gaming radio checked.
8. **ar → fr** — the reverse, from a submitted `/ar` page: the query survives even though the review phase does not.
9. **360 px Arabic** — `/ar/configurateur?use_case=GAMING&budget=12000` at 360×800: `scrollWidth - clientWidth <= 0`, and the summary bar's bottom is at or above the nav's content top.

Scenarios 9–13 of the brief (loaded `from`, invalid UUID, 404, 500 + retry, no writes) are already pinned by `e2e/configurator.spec.ts`; do not duplicate them here. Add one test that the `from` leg plus an invalid budget coexists, since no existing spec covers the combination:

10. **`from` + invalid budget** — `/fr/configurateur?from=${FROM_ID}&budget=12`: the pass loads **and** the range message is visible; the two states do not erase each other.

- [ ] **Step 3: Run the journey spec, then twice for flakiness**

Run: `cd apps/web-v2 && npx playwright test e2e/journey.spec.ts && npx playwright test e2e/journey.spec.ts --repeat-each=2`
Expected: all pass, both runs.

- [ ] **Step 4: Run the whole browser suite**

Run: `cd apps/web-v2 && npm run test:e2e`
Expected: PASS; the count grows from 44 to 44 + the new specs.

---

### Task 6: Documentation, gates and the report

**Files:**

- Modify: `apps/web-v2/README.md`
- Modify: `apps/web-v2/lib/homepage/config.ts` (comment only)
- Modify: `apps/web-v2/docs/sections/01-homepage.md` (§5.5)
- Modify: `apps/web-v2/docs/finder-validation.md` (the CTA row)
- Create: `docs/superpowers/specs/step-3-3-report.md`

- [ ] **Step 1: Update the four descriptions**

- `README.md`, `## Configurator`: add "The homepage finder's CTA hands its two answers to this route (`use_case`, `budget`) and posts nothing."
- `lib/homepage/config.ts`: the `HOMEPAGE_SUBMIT_ENABLED` comment now reads that the CTA navigates to the configurator and never posts, so the flag still gates only a future POST.
- `docs/sections/01-homepage.md` §5.5: replace the "no-write scroll" sentence with the 3.3 behaviour and state that Q-08's scroll fallback is superseded; leave the POST description as the future step.
- `docs/finder-validation.md`: row 8 becomes `→ /fr/configurateur?use_case=…&budget=…, values seeded, nothing written`.

- [ ] **Step 2: Run every gate in one session**

```bash
cd apps/web-v2 && npm run typecheck && npm run lint && npm run format:check && npm run check:api-types && npm test && npm run test:e2e && npm run build
```

Record each exit code and the real counts (baseline before this step: 129 unit tests, 44 browser specs).

- [ ] **Step 3: Prove the scope**

```bash
git diff --stat 8da9521 -- apps/web-v2/components/home \
  apps/web-v2/lib/homepage apps/web-v2/app/'[locale]'/page.tsx \
  apps/web-v2/app/globals.css apps/web-v2/package.json \
  apps/web-v2/package-lock.json apps/web apps/api
```

Expected: only `components/home/budget-usage-finder.tsx` and `lib/homepage/config.ts` (comment) inside the protected set; nothing under `apps/web` or `apps/api`; no manifest.

- [ ] **Step 4: Write `docs/superpowers/specs/step-3-3-report.md`**

Sections A–J from brief §12, each with measured output: implementation summary; modified files; the journey; API behaviour with an explicit "no writes introduced"; fr/ar + RTL and the unsigned-Arabic caveat; viewports tested (360, 390, 430, 768, 1024, 1280, 1440) with what was measured where; gate results; remaining issues (including the pass-with-zero-builds empty state if still unhandled); `git status` with the preserved pre-existing changes; and the Step 3.4 recommendation (the recommendation `POST` and a results view, per Q-08, with swap preview already in the contract). End with one verdict line: `PASS`, `CONDITIONAL` or `FAIL`.

---

## Self-Review

**Spec coverage:** handoff contract §5 Task 1 → Task 1; finder integration Task 2 → Task 2; existing recommendation Task 3 → Task 3 (use case) + existing 3.2 specs; no-`from` journey Task 4 → Task 4; state consistency Task 5 → Tasks 2, 5; errors Task 6 → Task 5 (the combination) + existing configurator specs; i18n §6 → Tasks 3, 4, 5; visual §7 → existing 3.2 layouts, untouched; testing §8 → Tasks 1–5; gates §11 → Task 6; deliverables §12 → Task 6.

**Type consistency:** `ConfiguratorHandoffAnswers` and `buildConfiguratorHref` are defined once, in Task 1, and consumed by Task 2. `USE_CASE_MESSAGE_KEYS` is defined in Task 3 and reused in Task 4. `requirements` and `submitted` are introduced in Task 4 and passed only by the shell.

**Review Focus:** each of the five rows names a task's test; none is left to the report.

**Proportion:** six tasks, one of which is verification-only and one documentation; the copy is pinned as strings, not described.
