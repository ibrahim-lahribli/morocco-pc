# Homepage v2 (Step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `apps/web-v2` design-system preview page with the approved first-release homepage: hero, budget/usage finder, three use-case configuration cards driven by the live API, trust, guides, final CTA, banner/footer/mobile nav — in French and Arabic, with no POST and no resolution controls.

**Architecture:** One server page (`app/[locale]/page.tsx`) composes static server sections; two client islands own state and data (`BudgetUsageFinder`, `RecommendedBuildSection`) plus two small client actions (`FinalRecommendationCTA`, `DiscoveryPathways`). Data flows through TanStack Query hooks in `lib/homepage/use-presets.ts`, keyed by `recommendation_id` + `catalog_version`; a Zustand store in `lib/homepage/store.ts` carries the visitor's budget/use-case from the finder to the cards. All card copy comes from a new `Homepage` dictionary namespace.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl 4, TanStack Query 5, Zustand 5, React Hook Form 7 + Zod 4, Tailwind v4 tokens, Vitest 5 (jsdom), Playwright 1.65.

**Spec:**
- `apps/web-v2/docs/sections/01-homepage.md` (normative; §3–§11 content tables are the copy source)
- `apps/web-v2/docs/sections/01-homepage-api-mapping.md` (normative; field-level mapping)
- `apps/api/test/unit/openapi-v1.10.json` (the only contract; types are generated from it)

## Global Constraints

- Generic ceiling is **`12_000` MAD**: per use case select the highest preset with `budget_amount <= 12_000`. Never the median of the ladder, never a row above the ceiling; a use case with no qualifying row keeps its slot and shows `builds.empty.*`.
- Finder budget: integer JSON **number**, min `3_500`, max `100_000`, step `500`. Presets offered: `5 000`, `8 000`, `12 000`, `15 000` (reuse `BUDGET_OPTIONS` from `lib/demo/store.ts`; do not copy the values).
- Use cases and fixed order: `GAMING`, `OFFICE`, `WORKSTATION`. Card H3 copy is exactly `builds.category.gaming` = `PC Gaming`, `builds.category.office` = `PC Bureautique`, `builds.category.workstation` = `PC Création & Professionnel`. No configuration name is invented.
- `builds[0].price_status` is the **only** badge source: `verified` → `builds.badge.verified`, `indicative` → `builds.badge.indicative`, anything else → **no badge**. `presets[].price_status` is never a fallback.
- Resolution shortcuts: **not rendered in either variant**. No resolution filtering on the client, no `resolution` in any request, no placeholder tile.
- `NEXT_PUBLIC_HOMEPAGE_SUBMIT` stays **off** by default and no recommendation `POST` is implemented this release. Homepage load issues only `GET /v1/meta/options`, `GET /v1/presets?use_case&currency` (three) and `GET /v1/recommendations/{id}`.
- Never render `budget_floor`, `generated_at`, `reused`, `served_by`, `engine_version`, or a `compatibility_status` verdict on a card.
- Every visible string comes from `messages/fr.json` / `messages/ar.json` or a prop. No metric literal (`12 000`, `/100`) in a component.
- `fr.json` and `ar.json` keep exact key and `{placeholder}` parity (`tests/i18n/messages.test.ts`).
- Tokens only, logical properties only (`ms/me`, `ps/pe`, `start/end`, `text-start`, `border-s`); directional icons use `rtl:-scale-x-100`.
- Exactly one `<h1>`; every section `<section aria-labelledby>`; radio groups are `<fieldset>` + `<legend>` with native radios; 44 px minimum targets.
- No new dependency, no lockfile change, no `app/globals.css` token change, no `apps/web`/`apps/api` change, no `.github/workflows/**` change.
- Arabic copy ships with parity but is **not production-approved** until native-language review; Task 6 records the pending review.

### Reviewed spec/code conflicts (resolved here — do not re-open)

| # | Conflict | Resolution in this plan |
| - | -------- | ----------------------- |
| C1 | §15/§13 say prices are formatted with the currency the API returns; the API's only advertised currency is `MAD` (`apps/api/src/meta.js`), while the approved copy and `Price.currency` are `DH` / `د.م.`. Literal compliance prints `12 000 MAD`. | Fetch/report the API currency (`MAD`), but **render** with the `Price.currency` dictionary symbol via `formatPrice(amount, tPrice("currency"))`. Report to the owner. |
| C2 | §6 says a `null` build-level `price_status` must show no badge; the contract types `builds[].price_status` as `"indicative" \| "verified"` (non-nullable). | Keep the generated type untouched; add a runtime narrowing helper (`resolvePriceBadge`) that returns `null` for anything not in the enum. |
| C3 | §7/§16.1 require a four-tile desktop categories grid; the approved key table defines only three use-case labels (the other two are the deferred resolution tiles). | Ship a three-tile use-case grid at `lg`. Inventing a fourth label is forbidden. |
| C4 | §16.4 ("with submit on, posts once and navigates to `/[locale]/resultats/{id}`") and §16.9 ("request-body assertion") vs the brief's submit-off scope and the absent Step 2 route. | **Not implemented.** `HOMEPAGE_SUBMIT_ENABLED` is read but false; the CTA's no-write behaviour is the only path. Do not add a mutation. |
| C5 | Q-19 wants the hero preview backed by the Gaming preset, but `HomepageHero` is server and the preset lives in the client island; §16.10 caps the islands at six. | `HeroRigPreview` renders the **text-only shell** (no price, no score), which §4 explicitly allows when no preset data is available. |
| C6 | Replacing the preview page removes the `Home` namespace, which the `components/demo/*` islands consume. | Delete `components/demo/` (all three), `lib/demo/search-schema.ts` and its test in the same commit. Keep `lib/demo/store.ts` (its `BUDGET_OPTIONS` is the spec-mandated source) and its test. |
| C7 | §6 needs a `{score}/100` message on the card; `builds.scoreLabel` is label-only and `hero.preview.score` is hero-scoped. | Add exactly one key, `Homepage.builds.scoreValue` = `{score}/100` in both locales (parity-tested). |
| C8 | Page-level metadata still says "Fondations V2". | Keep the `Metadata` namespace and set its two values to already-approved homepage strings: title = `Homepage.banner.label` text, description = `Homepage.hero.intro` text. Flag to the owner (no new copy invented). |

## Review Focus

| Input / condition | Behaviour a reasonable person expects | Test that pins it |
| ----------------- | ------------------------------------- | ----------------- |
| `GET /v1/presets` returns an unsorted or duplicate-budget ladder | The selected row is still the highest at or below 12 000, independent of array order | Task 1 `selectPresetAtOrBelow` shuffled-list case |
| The visitor changes selection A → B while B's detail is inflight | A's component pills/score/badge disappear immediately; nothing of A is shown under B | Task 5 `recommended-build-section` "clears the previous selection" case |
| `builds: []`, `total_price: null`, `build_score: null` | No price, no badge, no complete-PC claim, score reads `—` — never `0` or `budget_floor.cheapest_total` | Task 1 `toBuildCardView` cases + Task 5 card cases |
| All three preset requests fail | Static sections still render; each slot shows its own error + retry; no unhandled rejection | Task 5 e2e "all presets 500" |
| Arabic copy is longer than French at 360 px | No horizontal page scroll; the bottom nav never covers the final CTA or footer | Task 6 e2e overflow + nav/CTA geometry |

---

### Task 1: Dictionary, API aliases and pure homepage logic (no UI)

**Files:**
- Modify: `apps/web-v2/messages/fr.json`, `apps/web-v2/messages/ar.json`
- Modify: `apps/web-v2/lib/api/types.ts`
- Create: `apps/web-v2/lib/homepage/builds.ts`
- Create: `apps/web-v2/lib/homepage/finder-schema.ts`
- Create: `apps/web-v2/lib/homepage/store.ts`
- Create: `apps/web-v2/lib/homepage/guides.ts`
- Test: `apps/web-v2/tests/homepage/builds.test.ts`
- Test: `apps/web-v2/tests/homepage/finder-schema.test.ts`
- Test: `apps/web-v2/tests/homepage/guides.test.ts`

**Interfaces:**
- Produces (used by Tasks 4, 5):
  - `HOME_USE_CASES: readonly ["GAMING","OFFICE","WORKSTATION"]`, `type HomeUseCase`
  - `HOMEPAGE_BUDGET_CEILING = 12_000`
  - `selectPresetAtOrBelow(presets: readonly Preset[], ceiling: number): Preset | null`
  - `resolvePriceBadge(builds: readonly PresetBuild[]): "verified" | "indicative" | null`
  - `specPillNames(components: readonly BuildComponent[]): string[]` (roles `CPU`, `GPU`, `RAM`, `SSD_BOOT`, max 4, `name` only)
  - `interface BuildCardView { recommendationId: string; budgetAmount: number; score: number | null; totalPrice: number | null; badge: "verified" | "indicative" | null; pills: string[]; rationale: string | null; hasCompleteBuild: boolean }`
  - `toBuildCardView(preset: Preset, detail: PresetDetail | undefined): BuildCardView`
  - `BUDGET_MIN = 3_500`, `BUDGET_MAX = 100_000`, `BUDGET_STEP = 500`
  - `createFinderSchema(messages: { required: string; budgetRange: string })` (Zod resolver for `{ budgetPreset: number | null; customBudget: string; useCase: HomeUseCase | null }`)
  - `resolveBudgetAmount(values): number | null`
  - `useHomepageStore` (`{ budgetAmount, useCase, setBudgetAmount, setUseCase, reset }`; **no `resolution` field** — see constraint C3/§5.4)
  - `GUIDES: readonly { slug: string; category: "practical" | "comparison" | "advice" | "special"; minutes: number; titleKey: "budget" | "gpu" | "ram" | "portable" }[]` (exactly four)
  - `Preset`, `PresetDetail`, `PresetBuild`, `BuildComponent` from `lib/api/types.ts`

- [ ] **Step 1: Write the failing selection/badge tests**

```ts
// apps/web-v2/tests/homepage/builds.test.ts
import { describe, expect, it } from "vitest";
import type { Preset } from "@/lib/api/types";
import {
  HOMEPAGE_BUDGET_CEILING,
  resolvePriceBadge,
  selectPresetAtOrBelow,
  specPillNames,
  toBuildCardView,
} from "@/lib/homepage/builds";

const preset = (budget_amount: number, extra: Partial<Preset> = {}): Preset => ({
  budget_amount,
  recommendation_id: `rec-${budget_amount}`,
  build_score: 61.25,
  price_status: "indicative",
  ...extra,
});

describe("selectPresetAtOrBelow", () => {
  const ladder = [5_000, 8_000, 12_000, 15_000].map((b) => preset(b));

  it("selects the highest preset at or below the 12 000 ceiling", () => {
    expect(selectPresetAtOrBelow(ladder, HOMEPAGE_BUDGET_CEILING)?.budget_amount).toBe(12_000);
  });

  it("never selects the 15 000 preset for the ceiling", () => {
    const chosen = selectPresetAtOrBelow(ladder, HOMEPAGE_BUDGET_CEILING);
    expect(chosen?.budget_amount).toBeLessThanOrEqual(12_000);
  });

  it("does not fall back to the median of the ladder", () => {
    const odd = [4_000, 6_000, 12_000].map((b) => preset(b));
    expect(selectPresetAtOrBelow(odd, HOMEPAGE_BUDGET_CEILING)?.budget_amount).toBe(12_000);
  });

  it("is independent of the response order", () => {
    const shuffled = [15_000, 8_000, 12_000, 5_000].map((b) => preset(b));
    expect(selectPresetAtOrBelow(shuffled, HOMEPAGE_BUDGET_CEILING)?.budget_amount).toBe(12_000);
  });

  it("includes the ceiling and excludes one dirham above it", () => {
    expect(selectPresetAtOrBelow([preset(12_000), preset(12_001)], 12_000)?.budget_amount).toBe(12_000);
    expect(selectPresetAtOrBelow([preset(12_001)], 12_000)).toBeNull();
  });

  it("returns null when no preset qualifies", () => {
    expect(selectPresetAtOrBelow([], 12_000)).toBeNull();
    expect(selectPresetAtOrBelow([preset(15_000)], 12_000)).toBeNull();
  });
});

describe("resolvePriceBadge", () => {
  const build = (price_status: unknown) => ({ price_status }) as never;

  it("maps a verified rank-1 build to verified", () => {
    expect(resolvePriceBadge([build("verified")])).toBe("verified");
  });

  it("maps an indicative rank-1 build to indicative", () => {
    expect(resolvePriceBadge([build("indicative")])).toBe("indicative");
  });

  it("returns null for a null status even though the contract forbids it", () => {
    expect(resolvePriceBadge([build(null)])).toBeNull();
    expect(resolvePriceBadge([build("unknown")])).toBeNull();
  });

  it("returns null for an empty build list", () => {
    expect(resolvePriceBadge([])).toBeNull();
  });
});

describe("toBuildCardView", () => {
  const verifiedPreset = preset(12_000, { price_status: "verified" });

  it("never takes the badge from the preset when there is no build", () => {
    expect(toBuildCardView(verifiedPreset, undefined).badge).toBeNull();
    expect(toBuildCardView(verifiedPreset, { builds: [] } as never).badge).toBeNull();
  });

  it("keeps the budget line but renders no price when total_price is null", () => {
    const view = toBuildCardView(verifiedPreset, {
      currency: "MAD",
      builds: [{ total_price: null, build_score: 70, price_status: "verified", components: [], explanation: null }],
    } as never);
    expect(view.totalPrice).toBeNull();
    expect(view.budgetAmount).toBe(12_000);
  });

  it("takes the build's own status when a build exists", () => {
    const view = toBuildCardView(preset(12_000, { price_status: null }), {
      currency: "MAD",
      builds: [{ total_price: 11_500, build_score: 70, price_status: "indicative", components: [], explanation: null }],
    } as never);
    expect(view.badge).toBe("indicative");
  });

  it("orders the spec pills by role and caps them at four", () => {
    const names = specPillNames([
      { role: "PSU", name: "PSU 650W" },
      { role: "SSD_BOOT", name: "NVMe 1TB" },
      { role: "GPU", name: "RTX 4060" },
      { role: "CASE", name: "Case" },
      { role: "RAM", name: "32 Go" },
      { role: "CPU", name: "Ryzen 5 5600" },
    ] as never);
    expect(names).toEqual(["Ryzen 5 5600", "RTX 4060", "32 Go", "NVMe 1TB"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web-v2 && npx vitest run tests/homepage/builds.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/homepage/builds"`.

- [ ] **Step 3: Implement `lib/homepage/builds.ts`**

Selection filters to `budget_amount <= ceiling` and takes the maximum (do not rely on index order). `resolvePriceBadge` reads `builds[0]?.price_status` and returns it **only** when it equals `"verified"` or `"indicative"`, else `null`. `toBuildCardView` returns `score: builds[0]?.build_score ?? null`, `totalPrice: builds[0]?.total_price ?? null`, `hasCompleteBuild: builds.length > 0 && builds[0] !== undefined`, `rationale: builds[0]?.explanation ?? null`. First four entries of the `Homepage.builds` key table in §6 stay the only source of copy.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/web-v2 && npx vitest run tests/homepage/builds.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Write the failing finder-schema test**

```ts
// apps/web-v2/tests/homepage/finder-schema.test.ts
import { describe, expect, it } from "vitest";
import { createFinderSchema, resolveBudgetAmount } from "@/lib/homepage/finder-schema";

const messages = { required: "Choisissez un budget et un usage pour continuer.", budgetRange: "Saisissez un budget entre {min} et {max} DH." };
const schema = createFinderSchema(messages);
const parse = (values: unknown) => schema.safeParse(values);

describe("finder schema", () => {
  it("accepts a preset with a use case", () => {
    expect(parse({ budgetPreset: 8_000, customBudget: "", useCase: "GAMING" }).success).toBe(true);
  });

  it("accepts the 3 500 and 100 000 bounds and rejects 3 499", () => {
    expect(parse({ budgetPreset: null, customBudget: "3500", useCase: "OFFICE" }).success).toBe(true);
    expect(parse({ budgetPreset: null, customBudget: "100000", useCase: "OFFICE" }).success).toBe(true);
    expect(parse({ budgetPreset: null, customBudget: "3499", useCase: "OFFICE" }).success).toBe(false);
  });

  it("rejects a non-integer custom budget with the range message", () => {
    const result = parse({ budgetPreset: null, customBudget: "9 000,5", useCase: "OFFICE" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(messages.budgetRange);
  });

  it("requires both answers", () => {
    const result = parse({ budgetPreset: null, customBudget: "", useCase: null });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(messages.required);
  });

  it("resolves the amount from the preset first, then the custom field", () => {
    expect(resolveBudgetAmount({ budgetPreset: 12_000, customBudget: "9000", useCase: "GAMING" })).toBe(12_000);
    expect(resolveBudgetAmount({ budgetPreset: null, customBudget: "9000", useCase: "GAMING" })).toBe(9_000);
    expect(resolveBudgetAmount({ budgetPreset: null, customBudget: "", useCase: null })).toBeNull();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/web-v2 && npx vitest run tests/homepage/finder-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `finder-schema.ts` and `store.ts`**

`createFinderSchema` builds a Zod object with `budgetPreset: z.number().int().nullable()`, `customBudget: z.string()`, `useCase: z.enum(["GAMING","OFFICE","WORKSTATION"]).nullable()`, plus a `superRefine` that (a) requires a use case with `messages.required`, (b) when `budgetPreset === null`, requires `customBudget` to match `^\d+$` and be within bounds, else issues `messages.budgetRange` on `customBudget`, and (c) when `budgetPreset !== null`, validates it is one of `BUDGET_OPTIONS`. `resolveBudgetAmount` returns `budgetPreset ?? (parsed custom or null)`. `useHomepageStore` is a Zustand store with the three fields above and no persistence.

- [ ] **Step 8: Write the failing guides test, then implement**

Test: `GUIDES` has exactly four entries, slugs equal the table in §9, `titleKey`s are `budget/gpu/ram/portable`, minutes are `4/6/3/5`, and categories are `practical/comparison/advice/special`. Run it red, create `lib/homepage/guides.ts` with no titles (titles live in the dictionary), run it green.

- [ ] **Step 9: Add the `Homepage` namespace and remove `Home`**

In both `messages/fr.json` and `messages/ar.json`:
- Add `Homepage` with branches `banner`, `hero`, `finder`, `builds`, `pathways`, `trust`, `guides`, `finalCta`, `footer`. Transcribe every `French source` cell from §3, §4, §5, §6, §7, §8, §9, §10, §11 **verbatim**, preserving `{amount}`, `{min}`, `{max}`, `{score}`, `{minutes}`, `{seconds}`, `{current}`, `{total}`.
- Add `Homepage.builds.scoreValue` = `"{score}/100"` in both locales (constraint C7).
- Author Arabic for every key: same tree, same placeholders, Latin digits. Do not leave any French string in `ar.json`.
- Delete the `Home` branch from both files.
- `Shell.*` needs no additions: `nav.home|configure|guides|saved`, `primaryNav`, `mobileNav`, `footerTagline`, `footerCopyright` already exist.
- Set `Metadata.title` to the homepage banner label text and `Metadata.description` to the hero intro text in both locales (constraint C8).

- [ ] **Step 10: Add the API type aliases**

In `lib/api/types.ts` add `Preset`, `PresetDetail` (derived from `paths["/v1/recommendations/{id}"]["get"]["responses"][200]`), `PresetBuild`, `BuildComponent`, and `PriceStatus = Preset["price_status"]`. No hand-written shapes.

- [ ] **Step 11: Run the whole unit suite and the typecheck**

Run: `cd apps/web-v2 && npx vitest run && npm run typecheck`
Expected: all green; the parity test proves the new namespace matches; `typecheck` proves the aliases resolve.

- [ ] **Step 12: Commit**

```bash
git add apps/web-v2/messages apps/web-v2/lib/homepage apps/web-v2/lib/api/types.ts apps/web-v2/tests/homepage
git commit -m "feat(web-v2): add the homepage dictionary and pure selection logic"
```

---

### Task 2: Kit additions (`cta` variant, footer props, optional nav href)

**Files:**
- Modify: `apps/web-v2/components/ui/button.tsx`
- Modify: `apps/web-v2/components/layout/site-footer.tsx`
- Modify: `apps/web-v2/components/layout/mobile-nav.tsx`
- Modify: `apps/web-v2/docs/DESIGN_SYSTEM.md`
- Test: `apps/web-v2/tests/components/button.test.tsx` (extend)
- Test: `apps/web-v2/tests/components/mobile-nav.test.tsx` (create)

**Interfaces:**
- Produces: `Button variant="cta"` (`bg-accent text-on-accent`), `SiteFooter({ brand, tagline, copyright, location?, links? })` where `links` is `readonly string[]` rendered as non-interactive `aria-disabled` items, and `MobileNavItem.href?: string` (`undefined` = visibly disabled, not focusable, no `href`).

- [ ] **Step 1: Write the failing tests**

Extend `tests/components/button.test.tsx` with a `cta` case asserting the rendered class list contains `bg-accent` and `text-on-accent`. Create `tests/components/mobile-nav.test.tsx` asserting: an item with `href` renders a link; an item without `href` renders no link but its label is still present, is not focusable and carries `aria-disabled="true"`; the `home` item carries `aria-current="page"`; the centre item keeps the raised FAB (label present, no href when absent).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web-v2 && npx vitest run tests/components/button.test.tsx tests/components/mobile-nav.test.tsx`
Expected: FAIL — no `cta` variant class; footer/nav assertion mismatch.

- [ ] **Step 3: Implement the three additions**

`cta: "bg-accent text-on-accent shadow-level-1 hover:bg-accent-strong"` in `buttonVariants`. `SiteFooter` renders `location` and `links` only when provided, in the mobile stacked order from §11, using `text-start`/`text-center` logical alignment. `MobileNav` keeps its geometry; a missing `href` renders the same markup with `<span aria-disabled="true">` instead of `<a>`.

- [ ] **Step 4: Document them and re-run**

Add the `cta` variant row and the new props to `docs/DESIGN_SYSTEM.md` (Button + the layout components section), then run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-v2/components apps/web-v2/docs/DESIGN_SYSTEM.md apps/web-v2/tests/components
git commit -m "feat(web-v2): add the saffron CTA variant and footer/nav props"
```

---

### Task 3: Page shell — banner, header nav, hero, trust, guides, footer

**Files:**
- Replace: `apps/web-v2/app/[locale]/page.tsx`
- Modify: `apps/web-v2/app/[locale]/layout.tsx`
- Modify: `apps/web-v2/components/layout/site-header.tsx`
- Create: `apps/web-v2/components/home/announcement-banner.tsx`
- Create: `apps/web-v2/components/home/primary-nav.tsx`
- Create: `apps/web-v2/components/home/homepage-hero.tsx`
- Create: `apps/web-v2/components/home/hero-rig-preview.tsx`
- Create: `apps/web-v2/components/home/trust-highlights.tsx`
- Create: `apps/web-v2/components/home/featured-guides.tsx`
- Create: `apps/web-v2/components/home/guide-card.tsx`
- Create: `apps/web-v2/lib/homepage/config.ts`
- Delete: `apps/web-v2/components/demo/budget-picker.tsx`, `.../build-card-preview.tsx`, `.../search-demo.tsx`, `apps/web-v2/lib/demo/search-schema.ts`, `apps/web-v2/tests/lib/search-schema.test.ts`, `apps/web-v2/e2e/foundation.spec.ts`
- Modify: `apps/web-v2/.env.example`
- Test: `apps/web-v2/e2e/homepage.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1 `GUIDES`, Task 2 `cta` variant and new footer/nav props.
- Produces: `HOMEPAGE_SUBMIT_ENABLED: boolean`, `GUIDES_ENABLED: boolean` from `lib/homepage/config.ts`; page anchors `#top`, `#simulateur`, `#configurations`, `#confiance`, `#guides`.

- [ ] **Step 1: Write the failing e2e shell spec**

```ts
// apps/web-v2/e2e/homepage.spec.ts
import { expect, test } from "@playwright/test";

test.describe("homepage shell", () => {
  test("renders the approved static sections in French with a single h1", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Pourquoi faire confiance à Morocco-PC ?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bien choisir son PC au Maroc" })).toBeVisible();
    await expect(page.getByText("Configurations PC pour le Maroc").first()).toBeVisible();
  });

  test("shows the banner only from md and the primary nav only from lg", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr");
    await expect(page.getByRole("note")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole("note")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
  });

  test("makes no API request on load while the finder is absent", async ({ page }) => {
    const calls: string[] = [];
    await page.route("**/v1/**", (route) => {
      calls.push(route.request().method());
      return route.abort();
    });
    await page.goto("/fr");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web-v2 && npx playwright test e2e/homepage.spec.ts`
Expected: FAIL — the preview page's headings are still there.

- [ ] **Step 3: Build the static sections**

Compose per §3, §4, §8, §9, §11: `AnnouncementBanner` (`hidden md:flex`, `role="note"`, dot + `banner.label` + `banner.arabicBadge`), `PrimaryNav` (`hidden lg:flex`, anchors only, `aria-current` on Accueil), header height `h-14 lg:h-16`, `HomepageHero` (eyebrow pill, `text-display lg:text-display-lg`, intro, three trust chips, `HeroRigPreview` `hidden lg:block`), `TrustHighlights` (cards from `md`, single card with hairline rows below), `FeaturedGuides` (`GUIDES`, items 3–4 `max-lg:hidden`, cards are `<article aria-disabled="true">` because `GUIDES_ENABLED` is false), `SiteFooter` with `location` + `links`. Keep `generateMetadata` as-is.

- [ ] **Step 4: Wire the layout**

`app/[locale]/layout.tsx`: render `AnnouncementBanner` above `SiteHeader`, pass the four primary anchors into the header, replace the mobile nav items with `home` (`#top`, current), `components` (no href), `configure` (`#simulateur`, FAB), `guides` (no href), `saved` (no href), and pass `location`/`links` to the footer. Anchor targets in `main` must match. The `configure` FAB points at `#simulateur`, which Task 4 creates; until that commit the anchor is inert by design, so do not add it to the nav in this task and do not test the jump here.

- [ ] **Step 5: Delete the preview-only code and gate the env**

Remove the three demo islands, the demo search schema and its test, and `e2e/foundation.spec.ts`. Add `NEXT_PUBLIC_HOMEPAGE_SUBMIT=off` and `NEXT_PUBLIC_GUIDES_ENABLED=off` to `.env.example` with a one-line comment each. `lib/homepage/config.ts` reads both with `=== "on"`.

- [ ] **Step 6: Run the shell spec, lint and build**

Run: `cd apps/web-v2 && npx playwright test e2e/homepage.spec.ts && npm run lint && npm run build`
Expected: 3 pass; build succeeds with no API process (the page is fully static at this task).

- [ ] **Step 7: Commit**

```bash
git add -A apps/web-v2
git commit -m "feat(web-v2): replace the preview page with the homepage shell"
```

---

### Task 4: Finder island and final CTA (no submit)

**Files:**
- Create: `apps/web-v2/components/home/budget-usage-finder.tsx` (`"use client"`)
- Create: `apps/web-v2/components/home/budget-preset-grid.tsx`
- Create: `apps/web-v2/components/home/custom-budget-field.tsx`
- Create: `apps/web-v2/components/home/usage-selector.tsx`
- Create: `apps/web-v2/components/home/final-cta.tsx` (`"use client"`)
- Create: `apps/web-v2/components/home/discovery-pathways.tsx` (`"use client"`)
- Modify: `apps/web-v2/app/[locale]/page.tsx`
- Test: `apps/web-v2/e2e/homepage-finder.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1 `createFinderSchema`, `resolveBudgetAmount`, `useHomepageStore`, `HOME_USE_CASES`; Task 2 `cta` variant; `BUDGET_OPTIONS` from `lib/demo/store.ts`; `Price.currency` for display.
- Produces: `#simulateur` section owning the form; store writes on every valid change; the CTA calls `useRouter`-free `scrollIntoView` on `#configurations` and focuses the section heading (`tabIndex={-1}`).

- [ ] **Step 1: Write the failing finder spec**

```ts
// apps/web-v2/e2e/homepage-finder.spec.ts
import { expect, test } from "@playwright/test";

test.describe("budget and usage finder", () => {
  test("starts empty, disables the CTA and reads À définir", async ({ page }) => {
    await page.goto("/fr");
    const cta = page.getByRole("button", { name: "Trouver mon PC" });
    await expect(cta).toBeDisabled();
    await expect(page.getByText("À définir").first()).toBeVisible();
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  });

  test("a preset plus a usage enables the CTA and never posts", async ({ page }) => {
    const posts: string[] = [];
    await page.route("**/v1/**", (route) => {
      if (route.request().method() === "POST") posts.push(route.request().url());
      return route.fulfill({ json: { use_cases: [], currencies: [], resolutions: [], priorities: [], inputs_applied: [] } });
    });
    await page.goto("/fr");
    await page.getByRole("radio", { name: "Budget de 12 000 DH" }).check();
    await page.getByRole("radio", { name: /Jeux vidéo/ }).check();
    const cta = page.getByRole("button", { name: "Trouver mon PC" });
    await expect(cta).toBeEnabled();
    await cta.click();
    await expect(page).toHaveURL(/\/fr$/);
    expect(posts).toEqual([]);
  });

  test("rejects an out-of-range custom budget", async ({ page }) => {
    await page.goto("/fr");
    await page.getByRole("radio", { name: /Études et bureautique/ }).check();
    await page.getByLabel("Budget exact en dirhams").fill("3000");
    await expect(page.getByText("Saisissez un budget entre 3 500 et 100 000 DH.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Trouver mon PC" })).toBeDisabled();
  });

  test("renders no resolution shortcut tile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr");
    await expect(page.getByText(/1080p|1440p/)).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web-v2 && npx playwright test e2e/homepage-finder.spec.ts`
Expected: FAIL — no form on the page.

- [ ] **Step 3: Implement the finder**

`<form noValidate>` with two `<fieldset>` + `<legend>` groups; presets and usages are native radios (not `aria-pressed` buttons); the custom field is a `TextField` (`type="number"`, `inputMode="numeric"`, `step={BUDGET_STEP}`) plus a range input shown only from `lg`, sharing one value; selected chips also get `ring-2 ring-primary` and a `Check` icon so selection is never colour-only; the CTA is a `Button type="submit" variant="cta"`, `disabled`/`aria-disabled` until both answers exist, and its action stores the answers then scrolls to `#configurations` and focuses its heading. Render `finder.error.*` in a `role="alert"` region wired by `aria-describedby`. `FinalRecommendationCTA` scrolls to `#simulateur` and focuses the budget group. `DiscoveryPathways` renders the three use-case tiles (`lg` only) that set the store's use case and focus the usage group — three tiles, per constraint C3, with no resolution variant in the DOM.

- [ ] **Step 4: Run the finder spec and the unit suite**

Run: `cd apps/web-v2 && npx playwright test e2e/homepage-finder.spec.ts && npx vitest run`
Expected: 4 pass; unit suite green.

- [ ] **Step 5: Commit**

```bash
git add apps/web-v2
git commit -m "feat(web-v2): add the homepage budget and usage finder"
```

---

### Task 5: Recommended configurations — queries, selection, badges, states

**Files:**
- Create: `apps/web-v2/lib/homepage/use-presets.ts`
- Create: `apps/web-v2/components/home/recommended-build-section.tsx` (`"use client"`)
- Create: `apps/web-v2/components/home/featured-build-card.tsx`
- Create: `apps/web-v2/components/home/compact-build-row.tsx`
- Create: `apps/web-v2/components/home/spec-pill.tsx`
- Create: `apps/web-v2/components/home/price-status-badge.tsx`
- Create: `apps/web-v2/components/home/build-media-placeholder.tsx`
- Modify: `apps/web-v2/app/[locale]/page.tsx`
- Modify: `apps/web-v2/e2e/homepage-finder.spec.ts` (point its stub at `stubHomepageApi`)
- Test: `apps/web-v2/tests/homepage/use-presets.test.ts` (create)
- Test: `apps/web-v2/tests/homepage/recommended-build-section.test.tsx` (create)
- Test: `apps/web-v2/e2e/homepage-builds.spec.ts` (create)
- Test: `apps/web-v2/e2e/support/homepage-api.ts` (create)

**Interfaces:**
- Consumes: Task 1 `selectPresetAtOrBelow`, `toBuildCardView`, `resolvePriceBadge`, `HOMEPAGE_BUDGET_CEILING`, `HOME_USE_CASES`, `useHomepageStore`; `getBrowserApiClient`, `unwrapApiResult`; `formatPrice`.
- Produces:
  - `presetsQueryKey(useCase: HomeUseCase, currency: string)`
  - `recommendationQueryKey(recommendationId: string, catalogVersion: string | null)`
  - `useMetaOptions(): { useCases, currency }` (fallback `HOME_USE_CASES` + `"MAD"`, `staleTime: 5 * 60_000`, failure is silent)
  - `usePresets(useCase, currency)` and `useRecommendationDetail(id: string | null, catalogVersion: string | null)` (both `staleTime: 60_000`)
  - `stubHomepageApi(page, options?): Promise<{ posts: unknown[] }>` for the e2e specs

- [ ] **Step 1: Write the failing cache-identity test**

```ts
// apps/web-v2/tests/homepage/use-presets.test.ts
import { describe, expect, it } from "vitest";
import { presetsQueryKey, recommendationQueryKey } from "@/lib/homepage/use-presets";

describe("query identity", () => {
  it("distinguishes recommendation ids", () => {
    expect(recommendationQueryKey("rec-a", "v1")).not.toEqual(recommendationQueryKey("rec-b", "v1"));
  });

  it("distinguishes catalog versions for the same recommendation", () => {
    expect(recommendationQueryKey("rec-a", "v1")).not.toEqual(recommendationQueryKey("rec-a", "v2"));
  });

  it("keys presets by use case and currency", () => {
    expect(presetsQueryKey("GAMING", "MAD")).not.toEqual(presetsQueryKey("OFFICE", "MAD"));
    expect(presetsQueryKey("GAMING", "MAD")).not.toEqual(presetsQueryKey("GAMING", "EUR"));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web-v2 && npx vitest run tests/homepage/use-presets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hooks**

`usePresets` calls `getBrowserApiClient().GET("/v1/presets", { params: { query: { use_case, currency } } })` and unwraps. `useRecommendationDetail` runs only when `id` is non-null, calls `GET("/v1/recommendations/{id}")`, and uses the key from `recommendationQueryKey`. Do **not** pass `placeholderData`/`keepPreviousData`: a changed key must return `data: undefined` while pending.

- [ ] **Step 4: Write the failing section test (stale data + states)**

```tsx
// apps/web-v2/tests/homepage/recommended-build-section.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHomepageStore } from "@/lib/homepage/store";
import fr from "@/messages/fr.json";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ getBrowserApiClient: () => ({ GET: get }) }));
const { RecommendedBuildSection } = await import("@/components/home/recommended-build-section");

const presetResponse = (budget: number, id: string) => ({
  data: { catalog_version: "v1", generated_at: "2026-11-01T00:00:00.000Z", presets: [{ budget_amount: budget, recommendation_id: id, build_score: 60, price_status: "verified" }] },
  response: { ok: true },
});
const detail = (name: string, status: "verified" | "indicative" | null) => ({
  data: { currency: "MAD", builds: [{ total_price: 11_500, build_score: 70, price_status: status, explanation: null, components: [{ role: "CPU", name }] }] },
  response: { ok: true },
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <QueryClientProvider client={client}>
        <RecommendedBuildSection />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  useHomepageStore.setState({ budgetAmount: null, useCase: null });
});

describe("RecommendedBuildSection", () => {
  it("clears the previous selection's specs as soon as the selection changes", async () => {
    let releaseB: (value: unknown) => void = () => {};
    const pendingB = new Promise((resolve) => { releaseB = resolve; });
    get.mockImplementation(async (path: string, init?: { params?: { query?: { use_case?: string } } }) => {
      if (path === "/v1/presets") {
        const useCase = init?.params?.query?.use_case;
        return presetResponse(12_000, `rec-${useCase}`);
      }
      if (path === "/v1/recommendations/{id}") {
        const id = (init as { params: { path: { id: string } } }).params.path.id;
        if (id === "rec-GAMING") return detail("Ryzen 5 5600", "verified");
        return pendingB;
      }
      return { data: {}, response: { ok: true } };
    });

    renderSection();

    await waitFor(() => expect(screen.getByText("Ryzen 5 5600")).toBeInTheDocument());
    useHomepageStore.setState({ budgetAmount: 8_000, useCase: "OFFICE" });
    await waitFor(() => expect(screen.queryByText("Ryzen 5 5600")).not.toBeInTheDocument());
    releaseB(detail("Ryzen 3 3200G", "indicative"));
    await waitFor(() => expect(screen.getByText("Ryzen 3 3200G")).toBeInTheDocument());
  });

  it("shows no badge when the build list is empty, even if the preset claims verified", async () => {
    get.mockImplementation(async (path: string) => {
      if (path === "/v1/presets") return presetResponse(12_000, "rec-empty");
      return { data: { currency: "MAD", builds: [] }, response: { ok: true } };
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("PC Gaming")).toBeInTheDocument());
    expect(screen.queryByText("Prix vérifié")).not.toBeInTheDocument();
    expect(screen.queryByText("Prix indicatif")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd apps/web-v2 && npx vitest run tests/homepage/recommended-build-section.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 6: Implement the section and the presentational cards**

`RecommendedBuildSection` runs three `usePresets` queries (fixed `GAMING`/`OFFICE`/`WORKSTATION` order), computes each slot's preset with `selectPresetAtOrBelow(presets, HOMEPAGE_BUDGET_CEILING)`, then one `useRecommendationDetail` per slot keyed by `(recommendation_id, catalog_version)`. When the store has a use case, render only that slot and select `selectPresetAtOrBelow(presets, store.budgetAmount)`; when the budget exceeds the highest tier, show that tier plus `builds.budgetCap`. Per-slot states: pending → skeleton with `aria-busy` and `builds.loading` in a polite live region; presets error → `builds.error.*` + retry (`refetch`); `presets: []` or no qualifying row → `builds.empty.*`; detail 404 → card with no pills/score/badge and a `console.warn`; other detail error → card-local error line + retry; `builds: []` → no price, no badge, no complete-PC claim. Card anatomy per §6: H3 = `builds.category.*`, `builds.budgetLabel` line with `formatPrice(budgetAmount, tPrice("currency"))`, `PriceStatusBadge`, `BuildMediaPlaceholder` (144/192 px token gradient), up to four `SpecPill`s, rationale (clamped), price (only when `totalPrice !== null`), `builds.cta` as a non-navigating `aria-disabled` label. Desktop `lg:grid-cols-3`; below `lg` one `FeaturedBuildCard` plus two `CompactBuildRow`s from the same three items. Equal weight, no "most recommended" badge.

- [ ] **Step 7: Write the e2e fixture helper and the builds spec**

Point `e2e/homepage-finder.spec.ts` at `stubHomepageApi` too — its inline `{\n use_cases: [] … }` stub predates the cards and would answer a preset request with the meta shape. `e2e/support/homepage-api.ts` stubs `**/v1/**`: `/v1/meta/options` returns `MAD` + the three use cases; `/v1/presets` returns one row per use case at 12 000 plus a 15 000 row (so the ceiling rule is observable), honouring `?use_case=`; `/v1/recommendations/{id}` returns a build whose `price_status` varies per id; it records POSTs and exposes them. The spec asserts: three cards titled PC Gaming / PC Bureautique / PC Création & Professionnel; the 12 000 row is rendered, `15 000` never appears as the selected tier; a verified build shows `Prix vérifié`, an indicative one `Prix indicatif`, a null-status/empty-builds card shows neither; `presets: []` for one use case shows the empty copy and keeps the other two; a 500 on all presets shows three error blocks and the trust/guides sections still render; and `posts` is empty after load and after the finder CTA.

- [ ] **Step 8: Run the tests**

Run: `cd apps/web-v2 && npx vitest run tests/homepage && npx playwright test e2e/homepage-builds.spec.ts`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/web-v2
git commit -m "feat(web-v2): add the recommended configuration cards and detail cache"
```

---

### Task 6: Arabic/RTL pass and the native-review gate

**Files:**
- Create: `apps/web-v2/e2e/homepage-i18n.spec.ts`
- Create: `apps/web-v2/docs/homepage-arabic-review.md`
- Modify: `apps/web-v2/app/[locale]/page.tsx` only if a mirroring defect is found

**Interfaces:**
- Consumes: every prior task.

- [ ] **Step 1: Write the failing i18n spec**

Assert: `/ar` has `lang="ar"` and `dir="rtl"`; the H1 contains Arabic; `body` computed `font-family` contains `IBM Plex Sans Arabic`; the hero, card and price rows mirror (compare bounding-box x of the first/last mobile-nav items, first item's `x` greater); the locale switch keeps the page and flips direction; no horizontal overflow at 360/390/430/1280/1440 in both locales; at 360 px the bottom nav's top edge is below the final CTA's bottom edge and the footer is above the nav. All `/v1/**` calls are stubbed with `stubHomepageApi`.

- [ ] **Step 2: Run it and fix what it finds**

Run: `cd apps/web-v2 && npx playwright test e2e/homepage-i18n.spec.ts`
Expected: first run may FAIL on a mirroring or overflow defect; fix with logical properties, `rtl:-scale-x-100` or copy length — never with a new token.

- [ ] **Step 3: Record the Arabic review gate**

Create `docs/homepage-arabic-review.md` with a table of every `Homepage` key and its current Arabic string, a "pending native-language review" banner, and a one-line rule that production requires the sign-off. This file is the release-gate record; do not claim Arabic is production-ready.

- [ ] **Step 4: Re-run and commit**

Run: `cd apps/web-v2 && npx playwright test e2e/homepage-i18n.spec.ts`
Expected: PASS.

```bash
git add apps/web-v2
git commit -m "test(web-v2): verify the Arabic homepage and record the review gate"
```

---

### Task 7: Documentation, full gate run and diff review

**Files:**
- Modify: `apps/web-v2/README.md`
- Modify: `apps/web-v2/docs/DESIGN_SYSTEM.md` (only if Task 2 left a gap)

- [ ] **Step 1: Update the README**

Replace the "Status: Step 0 + API foundation" block with the homepage status; extend the structure table (`components/home`, `lib/homepage`, `tests/homepage`, `docs/homepage-arabic-review.md`); state that the homepage performs only GETs, that `NEXT_PUBLIC_HOMEPAGE_SUBMIT` is off and why, and that the resolution shortcuts and the submit path are deferred to Step 2. Keep the "design-system preview" wording only where it is still true.

- [ ] **Step 2: Run every gate in one command**

```bash
cd apps/web-v2 && npm run typecheck && npm run lint && npm run format:check && npm run check:api-types && npm test && npm run build && npm run test:e2e
```

Record each result separately; a failure that pre-dates this branch must be reported with the exact command, not folded in.

- [ ] **Step 3: Run Prettier on the changed files**

```bash
cd apps/web-v2 && npx prettier --check $(git diff --name-only master...HEAD -- . | sed 's|apps/web-v2/||')
```

Expected: "All matched files use Prettier code style!".

- [ ] **Step 4: Review the diff for scope**

```bash
git --no-pager diff --stat master...HEAD -- apps/web-v2
git status --porcelain
```

Confirm: no `apps/web/**`, `apps/api/**`, `.github/**`, `app/globals.css`, `package.json` or `package-lock.json` change; no `resolution` string in a request body; no visible literal in `components/home/**` (grep for the French strings); no `1080p`/`1440p` outside the dictionary.

- [ ] **Step 5: Commit**

```bash
git add apps/web-v2/README.md apps/web-v2/docs
git commit -m "docs(web-v2): document the homepage release and its deferred seams"
```

---

## Out of scope (do not implement)

- `POST /v1/recommendations`, `retryAfterSeconds` countdown, `/[locale]/resultats/{id}` navigation — Step 2.
- Resolution shortcuts, any `resolution` value in the store or a request — deferred (Q-20).
- A fourth discovery tile, configuration names, hero preview price/score, guide routes, methodology page, saved builds.
- Deleting `lib/demo/store.ts` (its `BUDGET_OPTIONS` is the approved source) and `tests/lib/demo-store.test.ts`.
