# Step 3.2 — Configurator Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a locale-rooted `/configurateur` route that seeds requirements from the URL, loads an existing recommendation by `from=<id>`, and renders a persistent build summary — in French and Arabic, with reads only.

**Architecture:** One server page parses `searchParams` through a pure module and hands a serialisable seed to a client shell. The shell creates one Zustand store per mount (no module singleton, so a second deep link cannot inherit the first one's answers), runs two TanStack queries (`meta/options` for the currency, `recommendations/{id}` for the pass), and renders a requirements form beside a summary panel that is sticky on desktop and a fixed bottom bar above the existing mobile nav below `lg`. No POST, no catalog, no swap.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl 4, TanStack Query 5, Zustand 5, React Hook Form 7 + Zod 4, Tailwind v4 tokens, Vitest 5 (jsdom), Playwright 1.65.

**Spec:**

- `docs/superpowers/specs/step-3-1-configurator-architecture.md` — §4.1 (Stage A field mapping), §8 (URL handoff and ownership), §9 (component tree and responsive behaviour), §10 (one `Configurator` namespace), §15 (3.2 acceptance criteria).
- The Step 3.2 brief supplied by the owner on 2026-11-07 (sections cited below as §1–§14 _of the brief_; it is not a tracked file, so each task restates the requirement it satisfies).
- `apps/api/test/unit/openapi-v1.10.json` — the only contract; `GET /v1/meta/options` and `GET /v1/recommendations/{id}` are the only operations used.

## Global Constraints

- Branch `feature/v2-design`; application `apps/web-v2`; V1 (`apps/web/`) untouched.
- Baseline HEAD `dcff3996da8a7973928170a5cfb63e4e86b2732c`. The working tree already carries two untracked paths — `apps/web-v2/app/[locale]/simulateur-preview/` and `docs/superpowers/` — preserved byte-for-byte. The regenerated homepage screenshots and `scripts/screenshots.mjs` are also currently modified; leave them alone.
- **No `POST`, `PUT`, `PATCH` or `DELETE` to any API origin.** No mutation, no `useMutation`.
- **Do not commit or push** (brief §14). Unlike the usual TDD plan, tasks end with a green check, not a commit.
- The homepage is unchanged: no edit under `apps/web-v2/components/home/`, `apps/web-v2/lib/homepage/`, `apps/web-v2/app/[locale]/page.tsx` or `apps/web-v2/app/globals.css`. The one shared-shell exception is `components/layout/locale-switcher.tsx` (see C1) — behaviour only, no visual change.
- No new dependency, lockfile change, token, route group, root layout or provider. `app/[locale]/layout.tsx` already supplies `NextIntlClientProvider` and `ApiProvider`.
- Use-case vocabulary and bounds are the existing ones: `HOME_USE_CASES = ["GAMING","OFFICE","WORKSTATION"]`, `BUDGET_MIN = 3_500`, `BUDGET_MAX = 100_000`. Import them; never restate the values.
- A URL budget is an integer in `[3_500, 100_000]`. The 500 step is a field affordance, not a URL rule.
- Invalid URL values are shown, never clamped or silently corrected; valid neighbours are preserved. The URL is not rewritten in 3.2.
- `from` is validated client-side as a canonical 8-4-4-4-12 hex UUID. The contract declares no `format: uuid` (C2).
- Prices render through `formatPrice(amount, tPrice("currency"))`; a missing price stays absent, never `0`. Only `builds[].price_status` may drive a badge; an unknown status shows none.
- Every visible string comes from the `Configurator` namespace in `messages/fr.json` / `messages/ar.json`, or from the API (`builds[].name`, `disclaimer`, `explanation`). No raw engine token (`CPU_COOLER`, `PASS`, `UNKNOWN`) reaches the DOM.
- Logical properties only (`ms/me`, `ps/pe`, `start/end`, `text-start`); directional icons use `rtl:-scale-x-100`. 48 px minimum targets on mobile, 44 px floor from `lg`.
- Arabic copy is authored with key/placeholder parity but is **not** native-approved; `docs/homepage-arabic-review.md` remains the open gate and this step does not claim it.
- E2E stubs every `/v1/**` call; an unmatched **API** path fails the run. Asset, RSC and HMR requests are not API calls and are not intercepted.
- No fixed sleeps in tests. Pending states are observed with auto-waiting assertions and stub latency.

## Reviewed brief/spec conflicts (resolved here — do not re-open)

| #   | Conflict                                                                                                                                                                                | Resolution in this plan                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Brief §11.11 requires the locale switch to preserve query parameters, but `components/layout/locale-switcher.tsx` builds `href={pathname}` from `usePathname()`, which drops the query. | Add a mount-time `window.location.search` to the link's href. The homepage has no query string, so its rendered HTML and click behaviour are unchanged; re-run the homepage i18n spec. This is the only shared-shell edit.                                                                                           |
| C2  | Brief §3 says `from` must be validated as a UUID; the contract types `id` as `minLength: 1` with no `format: uuid`.                                                                     | Validate with a local canonical-hex regex, normalise to lower case. A malformed value is a visible link error and issues no request; a valid but absent id becomes the API's 404 state.                                                                                                                              |
| C3  | Brief §4 says the store owns "selected build" and "loading and error state"; 3.1 §8.3 lists `recommendationId` and `activeBuildRank`.                                                   | The store owns `phase`, `requirements`, `recommendationId`, `activeBuildRank`. The selected build is derived from `activeBuildRank` + the detail query; loading/error are TanStack Query's. Copying server data or query status into Zustand would create a second source of truth that goes stale on every refetch. |
| C4  | Brief §5 requires a "Continue action", but §12 forbids the POST that would generate anything.                                                                                           | Continue validates, writes the requirements to the store, sets `phase: "review"`, and moves focus to the summary heading. With no `from`, the summary shows its honest empty state; nothing pretends a pass was generated. Owner may replace the empty-state copy (D-3.2-1).                                         |
| C5  | 3.1 §8.4 says `from`-only derives requirements from the loaded pass; the 3.2 brief does not require form prefill.                                                                       | The summary shows the pass's own `use_case` and `budget_amount`. The form is not auto-filled after load, because a late form reset would overwrite an answer the visitor typed while the detail was in flight. Recorded as D-3.2-2.                                                                                  |
| C6  | Brief §7 asks for a fixed mobile summary; the shell already renders a fixed 80 px `MobileNav` at `bottom-0`.                                                                            | The bar sits at `bottom-[calc(5rem+env(safe-area-inset-bottom))]` (above the nav, below its z-index), and the page reserves `pb-44` below `lg`. The 360 px spec measures both edges.                                                                                                                                 |
| C7  | Brief §11 says E2E must "fail on unmatched network requests"; failing on `_next` assets would make every test flaky by construction.                                                    | The stub intercepts `**/v1/**` only and records unmatched **API** paths; every spec asserts `unmatched` and `writes` are empty through one helper.                                                                                                                                                                   |
| C8  | The detail's `disclaimer` and `explanation` are served in French.                                                                                                                       | Render them verbatim under a localized label. Translating them would invent a second verdict. On `/ar` they remain French, the same known limitation the homepage records.                                                                                                                                           |
| C9  | The brief's "Continue" copy could read as generation.                                                                                                                                   | Copy says what the button does in this release: validate and show the summary. No "generating", "finding" or "searching" wording until 3.3 owns the pass.                                                                                                                                                            |

## Review Focus

| Input / condition                              | Behaviour a reasonable person expects                                                             | Test that pins it                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `?use_case=GAMING&budget=12`                   | GAMING stays selected, the budget field shows `12` with the range message, no detail request      | Task 1 `parseConfiguratorSearchParams` case + Task 4 invalid-budget spec |
| `from` is a valid UUID but deleted server-side | "This build is no longer available", the form stays usable, no retry loop                         | Task 2 panel 404 case + Task 4 unknown-`from` spec                       |
| 360 px with both fixed bars                    | The summary bar sits above the nav; the last component row is reachable, no horizontal scroll     | Task 4 geometry spec                                                     |
| Locale switch on a deep-linked configurator    | `/fr/configurateur?use_case=…&budget=…` → `/ar/configurateur?use_case=…&budget=…`, answers intact | Task 3 switcher test + Task 4 locale-switch spec                         |     | `total_price: null` or `components[].price_used: null` | The value is absent from the DOM; never `0`, never invented | Task 2 panel null-price test |

## Design direction (locked)

- **Desktop reads as a build sheet beside a form, not a settings page.** The page intro sits above a 7/5 grid: the requirements `Card` on the start side, the summary as a bordered panel on the end side with a hairline rule under its header — not a second floating card and not a gradient (the homepage CTA owns that treatment).
- **Summary hierarchy:** eyebrow (`Configuration`), the total in `text-price`, the status badge, then one hairline-separated row per component — role label muted at the start, product name strong, price at the end. The disclaimer is a `text-body-sm` footnote under the last row.
- **Mobile is a different composition, not a shrunken one.** One column; the summary is a compact fixed bar (total + badge + disclosure) above the existing nav. Expanding opens an internally scrolling panel capped at `70dvh`; the page still reads top-to-bottom as requirements, then build.
- **No new tokens, no decorative numbering, no all-caps labels.** Primary is reserved for the submit action and the active rank; badge tones come from the existing palette. Every value is a design-system token.
- **States occupy the same panel.** Skeletons match the final row heights; empty and error states keep a three-row summary footprint so the page does not jump when a detail lands.
- **Direction and targets:** logical properties only, `rtl:` flips for the single disclosure chevron, 48 px below `lg`, 44 px above.

---

### Task 1: URL contract, form schema and per-mount store (no UI)

**Files:**

- Modify: `apps/web-v2/messages/fr.json`, `apps/web-v2/messages/ar.json`
- Create: `apps/web-v2/lib/configurator/schema.ts`
- Create: `apps/web-v2/lib/configurator/store.ts`
- Test: `apps/web-v2/tests/configurator/schema.test.ts`
- Test: `apps/web-v2/tests/configurator/store.test.ts`
- Test: `apps/web-v2/tests/configurator/imports.test.ts`

**Interfaces:**

- Consumes: `HOME_USE_CASES`, `HomeUseCase` from `@/lib/homepage/builds`; `BUDGET_MIN`, `BUDGET_MAX` from `@/lib/homepage/finder-schema`. Constants only — never `useHomepageStore`.
- Produces (used by Tasks 2–4):
  - `type ConfiguratorUseCase = HomeUseCase`
  - `type ConfiguratorErrorCode = "USE_CASE_INVALID" | "BUDGET_INVALID" | "BUDGET_RANGE" | "FROM_INVALID"`
  - `interface ConfiguratorSeed { useCase: ConfiguratorUseCase | null; budgetAmount: number | null; budgetText: string | null; recommendationId: string | null; fieldErrors: Partial<Record<"useCase" | "budget" | "from", ConfiguratorErrorCode>> }`
  - `type RawSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>`
  - `parseConfiguratorSearchParams(params: RawSearchParams): ConfiguratorSeed`
  - `parseBudgetInput(raw: string): number | null`
  - `interface RequirementsValues { useCase: ConfiguratorUseCase | null; budget: string }`
  - `createRequirementsSchema(messages: { useCaseRequired: string; budgetRequired: string; budgetRange: string }): ZodType<RequirementsValues>`
  - `resolveRequirementsBudget(values: RequirementsValues): number | null`
  - `type ConfiguratorPhase = "requirements" | "review"`
  - `interface ConfiguratorRequirements { useCase: ConfiguratorUseCase | null; budgetAmount: number | null }`
  - `interface ConfiguratorState { phase: ConfiguratorPhase; requirements: ConfiguratorRequirements; recommendationId: string | null; activeBuildRank: number; submitRequirements(requirements: ConfiguratorRequirements): void; setActiveBuildRank(rank: number): void }`
  - `createConfiguratorStore(seed: ConfiguratorSeed): StoreApi<ConfiguratorState>`

- [ ] **Step 1: Write the failing URL/schema test**

```ts
// apps/web-v2/tests/configurator/schema.test.ts
import { describe, expect, it } from "vitest";
import {
  createRequirementsSchema,
  parseBudgetInput,
  parseConfiguratorSearchParams,
  resolveRequirementsBudget,
} from "@/lib/configurator/schema";

describe("parseConfiguratorSearchParams", () => {
  it("accepts a valid deep link", () => {
    expect(
      parseConfiguratorSearchParams({ use_case: "GAMING", budget: "12000" }),
    ).toEqual({
      useCase: "GAMING",
      budgetAmount: 12000,
      budgetText: null,
      recommendationId: null,
      fieldErrors: {},
    });
  });

  it("keeps the valid neighbour when one field is invalid", () => {
    const seed = parseConfiguratorSearchParams({
      use_case: "GAMING",
      budget: "12",
    });
    expect(seed.useCase).toBe("GAMING");
    expect(seed.budgetAmount).toBeNull();
    expect(seed.budgetText).toBe("12");
    expect(seed.fieldErrors.budget).toBe("BUDGET_RANGE");
  });

  it("rejects an unknown use case without touching the budget", () => {
    const seed = parseConfiguratorSearchParams({
      use_case: "CONSOLE",
      budget: "8000",
    });
    expect(seed.useCase).toBeNull();
    expect(seed.budgetAmount).toBe(8000);
    expect(seed.fieldErrors.useCase).toBe("USE_CASE_INVALID");
  });

  it("rejects a non-numeric or repeated budget as invalid, not out of range", () => {
    expect(
      parseConfiguratorSearchParams({ budget: "9 000" }).fieldErrors.budget,
    ).toBe("BUDGET_INVALID");
    expect(
      parseConfiguratorSearchParams({ budget: ["9000", "12000"] }).fieldErrors
        .budget,
    ).toBe("BUDGET_INVALID");
  });

  it("accepts the bounds and rejects 3499 / 100001 as out of range", () => {
    expect(parseConfiguratorSearchParams({ budget: "3500" }).budgetAmount).toBe(
      3500,
    );
    expect(
      parseConfiguratorSearchParams({ budget: "100000" }).budgetAmount,
    ).toBe(100000);
    expect(
      parseConfiguratorSearchParams({ budget: "3499" }).fieldErrors.budget,
    ).toBe("BUDGET_RANGE");
    expect(
      parseConfiguratorSearchParams({ budget: "100001" }).fieldErrors.budget,
    ).toBe("BUDGET_RANGE");
  });

  it("accepts a canonical UUID and normalises it, rejecting anything else", () => {
    const id = "3B157941-B4DF-4945-A6AE-E6E079644E4C";
    expect(parseConfiguratorSearchParams({ from: id }).recommendationId).toBe(
      id.toLowerCase(),
    );
    expect(
      parseConfiguratorSearchParams({ from: "rec-1" }).recommendationId,
    ).toBeNull();
    expect(
      parseConfiguratorSearchParams({ from: "rec-1" }).fieldErrors.from,
    ).toBe("FROM_INVALID");
  });

  it("ignores unknown parameters", () => {
    expect(
      parseConfiguratorSearchParams({ utm_source: "x", use_case: "OFFICE" })
        .useCase,
    ).toBe("OFFICE");
  });
});

describe("requirements schema", () => {
  const schema = createRequirementsSchema({
    useCaseRequired: "Choisissez un usage.",
    budgetRequired: "Saisissez un budget.",
    budgetRange: "Saisissez un budget entre 3 500 et 100 000 DH.",
  });

  it("rejects an empty form with one message per field", () => {
    const result = schema.safeParse({ useCase: null, budget: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual([
        "Choisissez un usage.",
        "Saisissez un budget.",
      ]);
    }
  });

  it("accepts an integer in bounds and resolves it to a number", () => {
    const values = { useCase: "GAMING" as const, budget: "8000" };
    expect(schema.safeParse(values).success).toBe(true);
    expect(resolveRequirementsBudget(values)).toBe(8000);
  });

  it("rejects a decimal, a space-grouped amount and out-of-range values", () => {
    for (const budget of ["9000,5", "9 000", "3499", "100001"]) {
      expect(schema.safeParse({ useCase: "GAMING", budget }).success).toBe(
        false,
      );
      expect(parseBudgetInput(budget)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web-v2 && npx vitest run tests/configurator/schema.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/configurator/schema"`.

- [ ] **Step 3: Implement `lib/configurator/schema.ts`**

Parsing is per field and total: each parameter is coerced only when it is a single string and passes its own rule; failures populate `fieldErrors` and leave every other field alone. `parseBudgetInput` accepts `/^\d+$/` only, then checks the imported bounds. `createRequirementsSchema` uses `z.enum(HOME_USE_CASES).nullable()` plus `superRefine`, emitting `useCaseRequired` on `useCase`, `budgetRequired` on an empty budget and `budgetRange` on any other invalid budget, so a partially typed value is a message, not a crash. `resolveRequirementsBudget` delegates to `parseBudgetInput`.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/web-v2 && npx vitest run tests/configurator/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store test**

```ts
// apps/web-v2/tests/configurator/store.test.ts
import { describe, expect, it } from "vitest";
import { createConfiguratorStore } from "@/lib/configurator/store";

const seed = {
  useCase: "GAMING" as const,
  budgetAmount: 12000,
  recommendationId: "3b157941-b4df-4945-a6ae-e6e079644e4c",
  fieldErrors: {},
};

describe("configurator store", () => {
  it("seeds requirements, recommendation and rank 1", () => {
    const store = createConfiguratorStore(seed);
    expect(store.getState().phase).toBe("requirements");
    expect(store.getState().requirements).toEqual({
      useCase: "GAMING",
      budgetAmount: 12000,
    });
    expect(store.getState().recommendationId).toBe(seed.recommendationId);
    expect(store.getState().activeBuildRank).toBe(1);
  });

  it("keeps two mounts independent", () => {
    const a = createConfiguratorStore(seed);
    const b = createConfiguratorStore({ ...seed, useCase: "OFFICE" });
    a.getState().submitRequirements({
      useCase: "WORKSTATION",
      budgetAmount: 15000,
    });
    expect(a.getState().requirements.useCase).toBe("WORKSTATION");
    expect(b.getState().requirements.useCase).toBe("OFFICE");
  });

  it("submits requirements and advances to review", () => {
    const store = createConfiguratorStore(seed);
    store
      .getState()
      .submitRequirements({ useCase: "OFFICE", budgetAmount: 8000 });
    expect(store.getState().requirements).toEqual({
      useCase: "OFFICE",
      budgetAmount: 8000,
    });
    expect(store.getState().phase).toBe("review");
  });

  it("selects a build rank without touching the answers", () => {
    const store = createConfiguratorStore(seed);
    store.getState().setActiveBuildRank(2);
    expect(store.getState().activeBuildRank).toBe(2);
    expect(store.getState().requirements).toEqual({
      useCase: "GAMING",
      budgetAmount: 12000,
    });
  });
});
```

- [ ] **Step 6: Implement `lib/configurator/store.ts`**

Export `createConfiguratorStore(seed)` built on Zustand's vanilla `createStore`. Hold the seed in a closure; 3.2 exposes no reset action. No module-level store, no persistence, no `homepage/store` import.

- [ ] **Step 7: Write the import guard**

```ts
// apps/web-v2/tests/configurator/imports.test.ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIRS = [
  "lib/configurator",
  "components/configurator",
  "app/[locale]/configurateur",
];

describe("configurator ownership", () => {
  it("never imports the homepage store", () => {
    for (const dir of DIRS) {
      const absolute = path.join(ROOT, dir);
      if (!existsSync(absolute)) continue;
      for (const file of readdirSync(absolute)) {
        if (!/\.(ts|tsx)$/.test(file)) continue;
        const source = readFileSync(path.join(absolute, file), "utf8");
        expect(source, `${dir}/${file}`).not.toMatch(
          /homepage\/store|useHomepageStore/,
        );
      }
    }
  });
});
```

Run: `cd apps/web-v2 && npx vitest run tests/configurator/store.test.ts tests/configurator/imports.test.ts`
Expected: PASS. The guard skips a directory that does not exist yet; Task 3 adds `components/configurator` and the route, and Task 5 re-runs it over all three.

- [ ] **Step 8: Add the `Configurator` namespace to both dictionaries**

Add the same tree to `messages/fr.json` and `messages/ar.json` (Arabic authored, Latin digits, same `{placeholders}`):

```
Configurator.metadata.{title,description}
Configurator.page.{eyebrow,title,intro}
Configurator.requirements.{badge,title,intro,budgetLabel,budgetHint,budgetPlaceholder,usageLegend,submit,saved,update,note}
Configurator.requirements.usage.{gaming,office,creation}.{title,body}
Configurator.summary.{eyebrow,title,emptyTitle,emptyBody,loading,errorTitle,errorBody,retry,notFoundTitle,notFoundBody,componentsTitle,noComponents,totalLabel,budgetLabel,rankLabel,rankOption,priceUnavailable,disclaimerLabel}
Configurator.summary.badge.{verified,indicative}
Configurator.errors.{useCaseRequired,budgetRequired,budgetInvalid,budgetRange,fromInvalid}
Configurator.roles.{CPU,GPU,MOTHERBOARD,RAM,SSD_BOOT,SSD_SECONDARY,PSU,CASE,CPU_COOLER,other}
Configurator.actions.{expand,collapse}
```

Fixed strings, so no task invents them later:

| Key                        | French                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `errors.useCaseRequired`   | `Choisissez un usage pour continuer.`                                                                                        |
| `errors.budgetRequired`    | `Saisissez un budget.`                                                                                                       |
| `errors.budgetRange`       | `Saisissez un budget entre 3 500 et 100 000 DH.`                                                                             |
| `errors.budgetInvalid`     | `Saisissez un budget en dirhams, sans espace ni virgule.`                                                                    |
| `errors.fromInvalid`       | `Ce lien de configuration est invalide.`                                                                                     |
| `summary.emptyTitle`       | `Aucune configuration chargée`                                                                                               |
| `summary.emptyBody`        | `Renseignez vos besoins puis continuez. Pour afficher une configuration existante, ouvrez le configurateur depuis son lien.` |
| `summary.notFoundTitle`    | `Configuration introuvable`                                                                                                  |
| `summary.notFoundBody`     | `Cette configuration n'est plus disponible. Vous pouvez continuer avec vos propres réponses.`                                |
| `summary.priceUnavailable` | `Prix non disponible`                                                                                                        |
| `requirements.submit`      | `Continuer`                                                                                                                  |
| `requirements.saved`       | `Vos réponses sont enregistrées.`                                                                                            |
| `requirements.update`      | `Mettre à jour`                                                                                                              |
| `summary.badge.indicative` | `Prix indicatif`                                                                                                             |
| `summary.badge.verified`   | `Prix vérifié`                                                                                                               |
| `summary.retry`            | `Réessayer`                                                                                                                  |
| `actions.expand`           | `Afficher le détail`                                                                                                         |
| `actions.collapse`         | `Masquer le détail`                                                                                                          |

Map the four error codes to these keys: `USE_CASE_INVALID` → `errors.useCaseRequired`, `BUDGET_INVALID` → `errors.budgetInvalid`, `BUDGET_RANGE` → `errors.budgetRange`, `FROM_INVALID` → `errors.fromInvalid`. No key may mention generation, search or a future step. Run `npx vitest run tests/i18n/messages.test.ts` — parity must pass.

- [ ] **Step 9: Run the task's checks**

Run: `cd apps/web-v2 && npx vitest run tests/configurator/schema.test.ts tests/configurator/store.test.ts tests/configurator/imports.test.ts tests/i18n/messages.test.ts && npm run typecheck`
Expected: all green.

---

### Task 2: Queries, build-summary panel and its states

**Files:**

- Create: `apps/web-v2/lib/configurator/queries.ts`
- Create: `apps/web-v2/components/configurator/build-summary-panel.tsx`
- Test: `apps/web-v2/tests/configurator/queries.test.ts`
- Test: `apps/web-v2/tests/configurator/build-summary-panel.test.tsx`

**Interfaces:**

- Consumes: `PresetDetail` from `@/lib/api/types`; `getBrowserApiClient`, `unwrapApiResult`; `formatPrice`; UI `Badge`, `Button`; `Configurator` dictionary.
- Produces:
  - `configuratorRecommendationKey(id: string | null): readonly ["configurator", "recommendation", string | null]`
  - `useConfiguratorCurrency(): { currency: string }`
  - `useConfiguratorRecommendation(id: string | null): UseQueryResult<PresetDetail, Error>`
  - `BuildSummaryPanel(props: { detail: PresetDetail | undefined; currency: string; isPending: boolean; errorStatus: number | null; activeBuildRank: number; onSelectRank: (rank: number) => void; onRetry: () => void })`

- [ ] **Step 1: Write the failing query-identity test**

```ts
// apps/web-v2/tests/configurator/queries.test.ts
import { describe, expect, it } from "vitest";
import { configuratorRecommendationKey } from "@/lib/configurator/queries";

describe("configurator query identity", () => {
  it("distinguishes recommendations and the empty state", () => {
    expect(configuratorRecommendationKey("a")).not.toEqual(
      configuratorRecommendationKey("b"),
    );
    expect(configuratorRecommendationKey("a")).not.toEqual(
      configuratorRecommendationKey(null),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement `queries.ts`**

Run: `cd apps/web-v2 && npx vitest run tests/configurator/queries.test.ts` → FAIL (module not found).

`useConfiguratorRecommendation` calls `GET /v1/recommendations/{id}` with `enabled: id !== null`, `staleTime: 60_000`, no `placeholderData`. `useConfiguratorCurrency` reads `GET /v1/meta/options` under the shared key `["meta", "options"]`, `staleTime: 5 * 60_000`, falls back to `"MAD"`, and surfaces no error (the symbol still renders through `Price.currency`).

- [ ] **Step 3: Write the failing panel test**

```tsx
// apps/web-v2/tests/configurator/build-summary-panel.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import fr from "@/messages/fr.json";
import { BuildSummaryPanel } from "@/components/configurator/build-summary-panel";

const detail = {
  id: "id-1",
  budget_amount: 12000,
  currency: "MAD",
  use_case: "GAMING",
  generated_at: null,
  budget_floor: null,
  engine_version: "test",
  catalog_version: "v1",
  reused: false,
  reason: null,
  disclaimer: "Prix indicatifs, non actualisés.",
  input_effects: [],
  served_by: { engine_version: "test" },
  builds: [
    {
      rank: 1,
      engine_version: "test",
      total_price: 11946,
      build_score: 56.88,
      compatibility_status: "PASS",
      price_status: "indicative",
      explanation: null,
      strategy_key: "BALANCED",
      swapped: null,
      components: [
        {
          role: "CPU",
          product_id: "cpu",
          name: "AMD Ryzen 5 5600G",
          slug: "cpu",
          variant: null,
          price_used: 1200,
          offer_class: "SEED_UNVERIFIED",
          store_offer_id: null,
        },
        {
          role: "GPU",
          product_id: "gpu",
          name: "RTX 4060",
          slug: "gpu",
          variant: null,
          price_used: 3200,
          offer_class: "SEED_UNVERIFIED",
          store_offer_id: null,
        },
      ],
    },
    {
      rank: 2,
      engine_version: "test",
      total_price: null,
      build_score: 50,
      compatibility_status: "UNKNOWN",
      price_status: "indicative",
      explanation: null,
      strategy_key: "CHEAP",
      swapped: null,
      components: [],
    },
  ],
} as never;

const renderPanel = (
  props: Partial<ComponentProps<typeof BuildSummaryPanel>> = {},
) =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <BuildSummaryPanel
        detail={detail}
        currency="MAD"
        isPending={false}
        errorStatus={null}
        activeBuildRank={1}
        onSelectRank={vi.fn()}
        onRetry={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );

describe("BuildSummaryPanel", () => {
  it("renders real components, the total, the badge and the API disclaimer", () => {
    renderPanel();
    expect(screen.getByText("AMD Ryzen 5 5600G")).toBeInTheDocument();
    expect(screen.getByText(/11\s?946/)).toBeInTheDocument();
    expect(screen.getByText("Prix indicatif")).toBeInTheDocument();
    expect(
      screen.getByText("Prix indicatifs, non actualisés."),
    ).toBeInTheDocument();
  });

  it("keeps a missing total absent instead of showing zero", () => {
    renderPanel({ activeBuildRank: 2 });
    expect(screen.queryByText(/^0/)).not.toBeInTheDocument();
    expect(screen.getByText("Prix non disponible")).toBeInTheDocument();
  });

  it("shows the empty state when no link supplied one", () => {
    renderPanel({ detail: undefined });
    expect(
      screen.getByText("Aucune configuration chargée"),
    ).toBeInTheDocument();
  });

  it("announces a pending detail and keeps the total absent", () => {
    renderPanel({ detail: undefined, isPending: true });
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Prix non disponible")).toBeNull();
  });

  it("names a deleted build and offers no retry", () => {
    renderPanel({ detail: undefined, errorStatus: 404 });
    expect(screen.getByText("Configuration introuvable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /réessayer/i })).toBeNull();
  });

  it("offers one retry on a generic failure", () => {
    const onRetry = vi.fn();
    renderPanel({ detail: undefined, errorStatus: 500, onRetry });
    fireEvent.click(screen.getByRole("button", { name: /réessayer/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("expands the mobile summary from one 48 px control", () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: /afficher|détail/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
```

- [ ] **Step 4: Implement the panel**

One `<aside aria-labelledby="build-summary-title">` rendered once. Its body is a single tree: `hidden` below `lg` until expanded, always visible from `lg`. The header carries the total (or `priceUnavailable`), the badge only when `build.price_status` is `verified` or `indicative`, and the mobile toggle (48 px, `aria-expanded`/`aria-controls`). `Escape` collapses and returns focus. Components render as a `<dl>` with role labels from `Configurator.roles` and names verbatim; `price_used` renders only when non-null. Rank buttons render only when `detail.builds.length > 1`, `aria-pressed` on the active one. Loading is a `role="status"` `aria-busy` skeleton; 404 is the not-found copy; other errors add a retry button calling `onRetry`. Every amount is formatted as `formatPrice(value, currency === "MAD" ? tPrice("currency") : currency)`, so the meta-sourced code is what the page displays. No total or component price is ever defaulted to 0.

- [ ] **Step 5: Run the panel and query tests**

Run: `cd apps/web-v2 && npx vitest run tests/configurator`
Expected: PASS.

---

### Task 3: Requirements form, client shell, route and query-preserving locale switch

**Files:**

- Create: `apps/web-v2/components/configurator/requirements-form.tsx`
- Create: `apps/web-v2/components/configurator/configurator-shell.tsx`
- Create: `apps/web-v2/app/[locale]/configurateur/page.tsx`
- Modify: `apps/web-v2/components/layout/locale-switcher.tsx`
- Test: `apps/web-v2/tests/configurator/requirements-form.test.tsx`

**Interfaces:**

- Consumes: `createConfiguratorStore`, `ConfiguratorSeed`, `createRequirementsSchema`, `resolveRequirementsBudget`; `useConfiguratorCurrency`, `useConfiguratorRecommendation`; `BuildSummaryPanel`; `Button`, `Card`, `TextField`; `useTranslations`.
- Produces:
  - `RequirementsForm({ defaultValues, initialErrors, submitted, onSubmit }: { defaultValues: RequirementsValues; initialErrors?: Partial<Record<"useCase" | "budget", ConfiguratorErrorCode>>; submitted?: boolean; onSubmit: (requirements: ConfiguratorRequirements) => void })`
  - `ConfiguratorShell({ seed }: { seed: ConfiguratorSeed })`
  - server page reading `params` and `searchParams`, rendering the `h1` and the shell.

- [ ] **Step 1: Write the failing form test**

```tsx
// apps/web-v2/tests/configurator/requirements-form.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import fr from "@/messages/fr.json";
import { RequirementsForm } from "@/components/configurator/requirements-form";

const renderForm = (
  props: Partial<ComponentProps<typeof RequirementsForm>> = {},
) => {
  const onSubmit = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <RequirementsForm
        defaultValues={{ useCase: null, budget: "" }}
        submitted={false}
        onSubmit={onSubmit}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onSubmit };
};

describe("RequirementsForm", () => {
  it("asks exactly two questions and offers no resolution or priority control", () => {
    renderForm();
    expect(screen.getByRole("group", { name: /usage/i })).toBeInTheDocument();
    expect(screen.queryByText(/1080p|1440p|priorité/i)).not.toBeInTheDocument();
  });

  it("shows one localized message per unanswered field", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect(
      screen.getByText("Choisissez un usage pour continuer."),
    ).toBeInTheDocument();
    expect(screen.getByText("Saisissez un budget.")).toBeInTheDocument();
  });

  it("rejects an out-of-range budget and submits valid answers once", () => {
    const { onSubmit } = renderForm({
      defaultValues: { useCase: "GAMING", budget: "3499" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect(screen.getByText(/entre 3\s?500 et 100\s?000/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/budget/i), {
      target: { value: "8000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
    expect(onSubmit).toHaveBeenCalledWith({
      useCase: "GAMING",
      budgetAmount: 8000,
    });
  });

  it("marks a URL-invalid field on mount and keeps its raw value", () => {
    renderForm({
      defaultValues: { useCase: "GAMING", budget: "12" },
      initialErrors: { budget: "BUDGET_RANGE" },
    });
    expect(screen.getByLabelText(/budget/i)).toHaveValue("12");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/entre 3\s?500 et 100\s?000/)).toBeInTheDocument();
  });

  it("confirms saved answers and offers an update once submitted", () => {
    renderForm({ submitted: true });
    expect(
      screen.getByText("Vos réponses sont enregistrées."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mettre à jour" }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement the form**

React Hook Form with `zodResolver(createRequirementsSchema(messages))`, `defaultValues` from the seed, and `setError` for `initialErrors` on mount. Two `<fieldset>` + `<legend>` groups: three native radios (title + one-line body from the dictionary) and a `TextField type="number" inputMode="numeric" step={500}`. The submit button is `type="submit"`, full width, `Continuer`; on valid submit it calls `onSubmit({ useCase, budgetAmount })`. A single `role="alert"` summary above the fields lists mount-time URL errors; field errors use `aria-invalid`/`aria-describedby` via `TextField`. No resolution, priority, preset ladder, or POST.

- [ ] **Step 3: Implement the shell and the route**

`ConfiguratorShell`:

- `const [store] = useState(() => createConfiguratorStore(seed));`
- `useStore(store, (state) => state.phase)`, `requirements`, `recommendationId`, `activeBuildRank`.
- `const detailQuery = useConfiguratorRecommendation(recommendationId);`
- Form props: `defaultValues={{ useCase: seed.useCase, budget: seed.budgetText ?? seed.budgetAmount?.toString() ?? "" }}`, `initialErrors={{ useCase: seed.fieldErrors.useCase, budget: seed.fieldErrors.budget }}`, `submitted={phase === "review"}`. `budgetText` is what keeps an invalid URL value such as `12` visible in the field instead of erasing it.
- If `seed.fieldErrors.from` is set, render a `role="alert"` with `errors.fromInvalid` above the grid and issue no detail request.
- `BuildSummaryPanel` receives `detail`, `currency` (from `useConfiguratorCurrency()`), `isPending`, `errorStatus` (`isApiError(error) ? error.status : error ? 0 : null`), `activeBuildRank`, `onSelectRank`, `onRetry`. Pass `isPending={seed.recommendationId !== null && detailQuery.isPending}`: TanStack's disabled query is pending but not loading, so passing it raw would keep the empty route in the loading state forever.
- Submit: `store.getState().submitRequirements(requirements)`, then `requestAnimationFrame(() => document.getElementById("build-summary-title")?.focus())`.
- Layout: page intro is server-rendered above; shell grid `grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8`; form in a `Card`; `pb-44 lg:pb-0` reserves the mobile bars.
- Strict Mode: `useState(() => createConfiguratorStore(seed))` runs its initializer twice in development and discards one store; no seed effect and no module singleton, so the answers are seeded exactly once per retained mount.

Server page:

- `const { locale } = await params; if (!hasLocale(routing.locales, locale)) notFound();`
- `const seed = parseConfiguratorSearchParams(await searchParams);`
- `generateMetadata` reads `Configurator.metadata` (title = `Configurator.metadata.title`, description = `.description`).
- Render one `<h1>` from `Configurator.page.title`, an eyebrow and intro, then `<ConfiguratorShell seed={seed} />`. No new provider.

Locale switcher (C1):

- Read the query once on mount: `const [search, setSearch] = useState(""); useEffect(() => setSearch(window.location.search), []);`
- `href={search === "" ? pathname : `${pathname}${search}`}`.
- Do not use `useSearchParams` (it would need a Suspense boundary and would remove the switcher from the initial HTML).

- [ ] **Step 4: Run the form tests and the homepage locale regression**

Run: `cd apps/web-v2 && npx vitest run tests/configurator/requirements-form.test.tsx && npx playwright test e2e/homepage-i18n.spec.ts`
Expected: PASS; `/fr` → `/ar` still works with no query string.

- [ ] **Step 5: Typecheck and lint the new route**

Run: `cd apps/web-v2 && npm run typecheck && npm run lint`
Expected: both exit 0.

---

### Task 4: Browser evidence — stubs, handoff, states, RTL, 360 px, no writes

**Files:**

- Create: `apps/web-v2/e2e/support/configurator-api.ts`
- Create: `apps/web-v2/e2e/configurator.spec.ts`

**Interfaces:**

- Produces: `stubConfiguratorApi(page, options?): Promise<{ writes: string[]; calls: string[]; unmatched: string[]; controls: { detailStatus: number | null; detailDelayMs: number } }>`; `expectNoApiViolations(stub)`.
- Fixture: `FROM_ID = "3b157941-b4df-4945-a6ae-e6e079644e4c"` (canonical UUID), one pass with two ranked builds, eight component roles, `disclaimer: "Prix indicatifs, non actualisés."`, `price_status: "indicative"`.

- [ ] **Step 1: Write the stub**

`page.route("**/v1/**")` handles exactly `GET /v1/meta/options` and `GET /v1/recommendations/{id}`. Every other **method** is pushed to `writes` and answered `405`; every other **API path** is pushed to `unmatched` and answered `404`. `controls.detailStatus` (500/503/404) and `controls.detailDelayMs` are read per request, so a spec can hold a response open or flip a failure before retrying. Meta answers `MAD`, the three use cases, `inputs_applied: ["use_case"]`. The detail fixture carries every required contract field: `id`, `budget_amount`, `currency`, `use_case`, `generated_at`, `budget_floor`, `engine_version`, `catalog_version`, `reused`, `reason`, `disclaimer`, `input_effects`, `served_by`, and per build `rank`, `engine_version`, `strategy_key`, `total_price`, `build_score`, `compatibility_status`, `explanation`, `swapped`, `price_status`, `components`.

- [ ] **Step 2: Write the French spec**

One `test.describe`, each test ending with `expectNoApiViolations(stub)`:

1. **Empty route** — `/fr/configurateur`: one `h1`, two form questions, summary empty copy, no detail call.
2. **Valid deep link** — `?use_case=GAMING&budget=12000`: GAMING checked, budget `12000`, no error alert, no detail call.
3. **Invalid budget** — `?use_case=GAMING&budget=12`: GAMING still checked, budget value `12`, range message, no detail call.
4. **Invalid use case** — `?use_case=CONSOLE&budget=8000`: use-case error, budget `8000` preserved.
5. **Existing recommendation** — `?from=${FROM_ID}`: total `11 946 DH`, `Prix indicatif`, eight component names, the disclaimer, two rank buttons; clicking rank 2 shows its own total (or the unavailable copy).
6. **Malformed link** — `?from=rec-1`: `Ce lien de configuration est invalide.`; no detail request; the form remains usable.
7. **Unknown recommendation** — `controls.detailStatus = 404`: "Configuration introuvable", form still operable.
8. **Loading** — `controls.detailDelayMs = 800`: summary `role="status"` with `aria-busy="true"`, then the total.
9. **API failure and retry** — `controls.detailStatus = 500` (the query policy retries 5xx twice), error copy + retry; set `detailStatus = null`, click retry, total appears.
10. **Continue** — empty route, choose OFFICE, type `8000`, click `Continuer`; summary heading receives focus, URL unchanged, no request beyond meta.
11. **No writes** — every test's `writes` is empty; no `POST` is stubbed at all.

- [ ] **Step 3: Write the Arabic and layout spec**

12. **Arabic** — `/ar/configurateur?from=${FROM_ID}`: `dir="rtl"`, Arabic `h1`, Arabic role labels, `د.م.` price suffix, `سعر إرشادي`.
13. **Locale switch preserves the query** — from `/fr/configurateur?use_case=GAMING&budget=12000`, click the `العربية` link; expect URL path `/ar/configurateur` and the same `use_case`/`budget`, radio still checked.
14. **360 px** — `/fr/configurateur?from=${FROM_ID}` at `360×800`: `scrollWidth - clientWidth <= 0`; after scrolling to the end, the last component row's bottom is above the fixed summary bar's top, and the bar's bottom is at or above the bottom nav's top.
15. **Accessibility** — exactly one `h1`; the form has two `fieldset`/`legend` groups; the summary heading is `h2`; the invalid-field alert is `role="alert"`; every interactive control's bounding box is at least 44 px (48 px below `lg`).

- [ ] **Step 4: Run the browser suite**

Run: `cd apps/web-v2 && npx playwright test e2e/configurator.spec.ts`
Expected: all pass. Re-run with `--repeat-each=2` for the hydration-sensitive deep-link tests.

---

### Task 5: Documentation, gates, scope audit and the A–I report

**Files:**

- Modify: `apps/web-v2/README.md`
- Create: `docs/superpowers/specs/step-3-2-report.md`

- [ ] **Step 1: Update the README**

Status becomes "homepage (Step 1) + configurator foundation (Step 3.2)". Add `app/[locale]/configurateur`, `components/configurator`, `lib/configurator`, `tests/configurator` and `e2e/configurator.spec.ts` to the structure table. State: reads only (`meta/options`, `recommendations/{id}`), no POST, no picker/swap, Arabic not signed off. Run `npx prettier --write README.md` if the table reflows.

- [ ] **Step 2: Run every gate in one command**

```bash
cd apps/web-v2 && npm run typecheck && npm run lint && npm run format:check && npm run check:api-types && npm test && npm run test:e2e
```

Record each result separately and the actual unit/spec counts. The pre-change baseline is 98 unit tests and 29 browser specs.

- [ ] **Step 3: Prove the scope**

```bash
git status --porcelain
git diff --stat -- apps/web-v2/components/home apps/web-v2/lib/homepage apps/web-v2/app/'[locale]'/page.tsx apps/web-v2/app/globals.css apps/web-v2/package.json apps/web-v2/package-lock.json apps/web apps/api
```

Expected: no diff in those paths. `git status` adds only the new configurator files, the two dictionaries, the locale switcher, README and the report — plus the pre-existing screenshot/script changes and the two untracked paths. No commit.

- [ ] **Step 4: Write `docs/superpowers/specs/step-3-2-report.md`**

Sections A–I from brief §14, each filled with measured output: initial state; files created/modified; route and URL behaviour; API requests and response handling; French/Arabic; desktop/mobile validation; commands and actual results; defects; `git status` and "no commit (brief §14)". End with one verdict line: `PASS`, `CONDITIONAL` or `FAIL`. Run `npx prettier --write ../../docs/superpowers/specs/step-3-2-report.md` from `apps/web-v2` so the report matches the repo's Markdown style.

- [ ] **Step 5: Hand off**

Report the verdict, the C1–C9 resolutions, the two owner decisions (D-3.2-1 Continue copy, D-3.2-2 `from` form prefill) and the fact that Arabic remains unsigned. Do not start Step 3.3.

---

## Out of scope (do not implement)

- `POST /v1/recommendations`, any generation state, `retryAfterSeconds` countdown.
- Catalogue picker, filters, compatibility preview, swap preview/commit.
- New API endpoints, database changes, auth, saved builds, V1 changes.
- Persisted configurator state (localStorage/cookie) or a global module store.
- Resolution and priority questions — `inputs_applied` is not consumed until a question exists to gate (3.3+).
- Translation of engine `explanation` or API `disclaimer` text.

## Self-Review

**Spec coverage:** route (§2) Task 3; URL handoff and validation (§3) Task 1 + Task 4; independent state (§4) Task 1; requirements form (§5) Task 3; existing recommendation (§6) Tasks 2–4; summary panel (§7) Task 2; component structure (§8) Tasks 1–3; visual quality (§9) Tasks 2–3; fr/ar (§10) Tasks 1, 3, 4; tests (§11) Tasks 1–4; exclusions (§12) Out of scope; regression (§13) Task 5; report (§14) Task 5.

**Type consistency:** `ConfiguratorSeed` is produced by `parseConfiguratorSearchParams`, consumed by `createConfiguratorStore` and `RequirementsForm.defaultValues`; `ConfiguratorRequirements` is produced by `resolveRequirementsBudget`/the form and consumed by `submitRequirements`; `BuildSummaryPanel` consumes `PresetDetail`, `activeBuildRank` and `onSelectRank`. No task names a field another does not define.

**Review Focus:** each of the five lines names its owning test (Task 1, Task 2, Task 3/4, Task 3/4, Task 2).

**Proportion:** three product tasks, one browser-evidence task and one reporting task; the plan fixes signatures, URL rules, keys and assertions, and leaves component bodies to the implementer.
