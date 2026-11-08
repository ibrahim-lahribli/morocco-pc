# Step 3.5 — Homepage completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining homepage gaps in `apps/web-v2` so the approved redesign is genuinely finished: a real hero preview, a mobile discovery affordance, working visible affordances, a measured accessibility/RTL evidence suite, and a signed-off completion report.

**Architecture:** The homepage is a server page (`app/[locale]/page.tsx`) composing static sections plus two client islands. Each task below changes one surface and reuses the existing hooks (`usePresets`, `useRecommendationDetail`, `useMetaOptions`), the existing URL contract (`buildConfiguratorHref`), the existing store (`useHomepageStore`) and the existing tokens. No new endpoint, no new dependency, no token change, no V1 (`apps/web`) or `apps/api` edit.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl 4 (`fr`/`ar`), TanStack Query 5, Zustand 5, Tailwind v4 tokens, Vitest 5 + Testing Library (jsdom), Playwright 1.65.

## Reconciliation (2026-11-08)

Owner decisions Task 2, 3 and 4 were answered **A / A / A**, implemented on
`feature/v2-design-step-3-5` and merged in PR #17 (merge commit `39a3ee0`), so Tasks 2-4 are
closed against the test each one names. Task 9's steps 1-4, 6 and 7 are closed by
`docs/superpowers/specs/step-3-5-report.md`; step 5's verdicts live in the section spec's section
18 table. **Task 7 (C11, imagery) and Task 8 (C12, native Arabic review) remain unchecked and
BLOCKED** on input no agent can supply: approved assets, and a qualified reviewer's signed
verdict. Final owner acceptance of the homepage is likewise outstanding - a merged PR is not
acceptance.

**Spec:** `apps/web-v2/docs/sections/01-homepage.md` (authoritative; frame-derived) and `apps/web-v2/docs/sections/01-homepage-api-mapping.md`. Both travel with this plan; executors read them before Task 1.

## Global Constraints

- Work only in `apps/web-v2`. Do not modify `apps/web` (V1), `apps/api`, the root engine, or any `package.json`/lockfile.
- No new dependency. Every capability below ships with what is installed (`playwright`, `vitest`, Testing Library, `@tanstack/react-query`, `zustand`, `next-intl`, `lucide-react`).
- No design-token change and no hex literal, `text-[…]` arbitrary size, or physical direction utility (`ml/mr/pl/pr/left/right/text-left`) may be added. `tests/homepage/rtl-utilities.test.ts` enforces this.
- All copy lives in `messages/fr.json` and `messages/ar.json`; key and `{placeholder}` parity is enforced by `tests/i18n/messages.test.ts`. Reuse the keys the spec already authors; do not add a key without adding it to both dictionaries and `apps/web-v2/docs/homepage-arabic-review.md`.
- The homepage never writes: no `POST`, no `PUT`, no `DELETE`. Browser specs must keep asserting an empty `posts` array.
- No stock or hot-linked imagery. Any image asset must be committed under `apps/web-v2/public/` and pass the origin guard in `e2e/homepage.spec.ts`.
- Run every command from `apps/web-v2`. Node is `^22.22.2 || ^24.15.0 || >=26.0.0` (measured here on v24.21.0).
- Commit only when the owner authorises it. Each task ends green on its own focused checks.
- Report results as PASS / FAIL / BLOCKED with the printed counts; never claim a gate that did not run.

## Review Focus

The inputs and failure modes the spec implies but that no task's tests currently exercise, most likely to bite a real visitor first:

1. **API slow, failing or 429 while the hero preview mounts.** A reasonable person expects the promise above the fold to stay readable, without a fake score or a shifted layout. Pinned in Task 1 (skeleton, shell fallback, `aria-busy`).
2. **A preset detail that 404s or has `builds: []`.** The preview must show no score and no price, never `0/100` or a `budget_floor` number. Pinned in Task 1.
3. **A visitor budget below the cheapest tier, or above the top tier.** The card CTA must link with the served tier it actually shows, never the typed budget. Pinned in Task 3.
4. **Arabic at 360 px with the new preview and the now-visible mobile discovery section.** Long Arabic labels must not overflow or collide with the bottom nav. Pinned in Tasks 1, 2 and 6.
5. **Keyboard-only traversal of a page whose visible "links" are plain text.** A screen-reader user must not hear a control that does nothing, and must still reach every real one. Pinned in Tasks 3, 4 and 6.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `components/home/hero-rig-preview.tsx` | client preview: rank-1 Gaming preset at the 12 000 ceiling, with pending/empty/error states | 1 |
| `components/home/homepage-hero.tsx` | keeps the `lg:block` slot; no data logic | 1 |
| `components/home/discovery-pathways.tsx` | one component, visible at every width | 2 |
| `components/home/featured-build-card.tsx` | card anatomy + a real details link | 3 |
| `components/home/recommended-build-section.tsx` | passes `useCase` down; unchanged selection rule | 3 |
| `app/[locale]/layout.tsx` | mobile nav "Guides" anchor | 4 |
| `e2e/support/homepage-api.ts` | records full request URLs for dedupe assertions | 1 |
| `e2e/homepage-hero.spec.ts` | new: preview content, dedupe, empty state, RTL | 1 |
| `e2e/homepage-a11y.spec.ts` | new: heading order, focus, targets, contrast, console | 6 |
| `lib/a11y/contrast.ts` | pure WCAG contrast helper (no dependency) | 6 |
| `tests/homepage/hero-rig-preview.test.tsx` | new: preview states | 1 |
| `tests/a11y/contrast.test.ts` | new: helper maths | 6 |
| `tests/i18n/arabic-signoff.test.ts` | new: sign-off + key-coverage gate | 8 |
| `apps/web-v2/docs/sections/01-homepage.md` | decisions and status amendments | 2, 3, 4, 7, 8, 9 |
| `apps/web-v2/docs/homepage-arabic-review.md` | the native-review sign-off record | 8 |
| `apps/web-v2/README.md` | spec/test counts after the change | 9 |

---

### Task 1: Render the real rank-1 build in the hero preview

**Owner approval:** not required. Q-19 already decided the content — "the Gaming card's preset already fetched for section 3 (highest at or below 12,000 MAD; no extra request)". Only the "Détails specs" destination (Q-06) stays owner-gated and remains non-interactive.

**Files:**
- Modify: `components/home/hero-rig-preview.tsx`
- Modify: `components/home/homepage-hero.tsx` (only if a prop becomes unused)
- Modify: `e2e/support/homepage-api.ts` (add `requests`)
- Test: `tests/homepage/hero-rig-preview.test.tsx` (new)
- Test: `e2e/homepage-hero.spec.ts` (new)

**Interfaces:**
- Consumes: `useMetaOptions(): { useCases, currency }`, `usePresets(useCase, currency)`, `useRecommendationDetail(id, catalogVersion)`, `selectSlotPreset(ladder, budgetAmount): { preset, capped }`, `toBuildCardView(preset, detail): BuildCardView`, `BuildMediaPlaceholder`, `formatPrice(value, currency)`.
- Produces: `HeroRigPreview(props: { eyebrow: string; caption: string; details: string })` — a client component that adds the score and the price; props unchanged so `HomepageHero` and `page.tsx` keep their current signatures. `stubHomepageApi` additionally returns `requests: string[]` (pathname + search) while `calls` stays pathname-only.

- [x] **Step 1: Write the failing unit test**

```tsx
// tests/homepage/hero-rig-preview.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const presets = vi.fn();
const detail = vi.fn();
const meta = vi.fn();

vi.mock("@/lib/homepage/use-presets", () => ({
  useMetaOptions: () => meta(),
  usePresets: () => presets(),
  useRecommendationDetail: () => detail(),
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}));

import { HeroRigPreview } from "@/components/home/hero-rig-preview";

const shell = { eyebrow: "EB", caption: "CAP", details: "DET" };
const ladder = {
  data: {
    catalog_version: "v1",
    presets: [{ budget_amount: 12_000, recommendation_id: "rec-GAMING-12000", build_score: 72.5, price_status: "verified" }],
  },
  isPending: false,
};

describe("HeroRigPreview", () => {
  it("stays busy and shows no numbers while the ladder is pending", () => {
    meta.mockReturnValue({ currency: "MAD", useCases: [] });
    presets.mockReturnValue({ data: undefined, isPending: true });
    detail.mockReturnValue({ data: undefined });
    render(<HeroRigPreview {...shell} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
  });

  it("renders the served score and price for the 12 000 ceiling preset", () => {
    meta.mockReturnValue({ currency: "MAD", useCases: [] });
    presets.mockReturnValue(ladder);
    detail.mockReturnValue({
      data: { builds: [{ build_score: 72.5, total_price: 11_500, price_status: "verified", components: [] }] },
    });
    render(<HeroRigPreview {...shell} />);
    expect(screen.getByText(/72\.5/)).toBeInTheDocument();
    expect(screen.getByText(/11\s?500/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to the text shell when no preset qualifies", () => {
    meta.mockReturnValue({ currency: "MAD", useCases: [] });
    presets.mockReturnValue({ data: { catalog_version: "v1", presets: [] }, isPending: false });
    detail.mockReturnValue({ data: undefined });
    render(<HeroRigPreview {...shell} />);
    expect(screen.getByText("EB")).toBeInTheDocument();
    expect(screen.getByText("DET")).toBeInTheDocument();
    expect(screen.queryByText(/72/)).not.toBeInTheDocument();
  });

  it("shows no score for a zero-build detail", () => {
    meta.mockReturnValue({ currency: "MAD", useCases: [] });
    presets.mockReturnValue(ladder);
    detail.mockReturnValue({ data: { builds: [] } });
    render(<HeroRigPreview {...shell} />);
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
    expect(screen.getByText("DET")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/homepage/hero-rig-preview.test.tsx`
Expected: FAIL — the component currently renders no score, no price and no `role="status"`, so the `72.5`, `11 500` and busy assertions all miss.

- [x] **Step 3: Implement the client preview in `components/home/hero-rig-preview.tsx`**

Add `"use client"`. Keep the three props. Inside, use the translation namespaces `Homepage.hero.preview`, `Homepage.builds` and `Price`, then:

```tsx
const { currency } = useMetaOptions();
const ladderQuery = usePresets("GAMING", currency);
const ladder = ladderQuery.data?.presets ?? [];
const { preset } = selectSlotPreset(ladder, null); // the 12 000 ceiling, per Q-19
const detailQuery = useRecommendationDetail(
  preset?.recommendation_id ?? null,
  ladderQuery.data?.catalog_version ?? null,
);
const view = preset === null ? null : toBuildCardView(preset, detailQuery.data);
```

Render three states from one `Card`:
1. `ladderQuery.isPending || (view !== null && detailQuery.isPending)` → a skeleton with `aria-busy="true"` and a `role="status"` line using `Homepage.builds.loading`; the media block keeps `h-44` so the hero does not shift.
2. `view === null` → today's text-only shell (caption overlay, eyebrow, `details` as `aria-disabled` text).
3. otherwise → `BuildMediaPlaceholder` + caption overlay, then the eyebrow, `tBuilds("category.gaming")` as the title, `tPreview("score", { score: view.score })` **only when `view.score !== null`**, and `formatPrice(view.totalPrice, currency)` **only when `view.totalPrice !== null`** with `tBuilds("priceLabel")`. Keep `details` as `aria-disabled` text (Q-06).

Use `<p>` elements, not headings: the hero already owns the page's only `<h1>`, and adding an `<h3>` would skip `<h2>` in the outline Task 6 asserts.

- [x] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run tests/homepage/hero-rig-preview.test.tsx`
Expected: PASS (4 tests).

- [x] **Step 5: Extend the stub with full request URLs**

In `e2e/support/homepage-api.ts`, add `requests: string[]` to `StubHomepageApiResult`, push `` `${method} ${url.pathname}${url.search}` `` on every routed call, and return it. Do not change `calls` or `posts`; existing specs depend on their shape.

- [x] **Step 6: Write the failing browser spec**

```ts
// e2e/homepage-hero.spec.ts
import { expect, test } from "@playwright/test";
import { stubHomepageApi } from "./support/homepage-api";

test.describe("hero preview", () => {
  test("shows the served Gaming score and price without a second request", async ({ page }) => {
    const { requests, posts } = await stubHomepageApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr");

    const preview = page.locator("#top").first();
    await expect(preview.getByText("Score de configuration : 72.5/100")).toBeVisible();
    await expect(preview.getByText(/11\s?500\s?DH/)).toBeVisible();

    const gaming = requests.filter((request) => request.includes("/v1/presets?use_case=GAMING"));
    expect(gaming, "the hero must reuse the builds section's query key").toHaveLength(1);
    expect(posts).toEqual([]);
  });

  test("is absent from the phone layout", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr");
    await expect(page.locator("#top").getByText("Vue Référence")).toBeHidden();
  });

  test("keeps the text shell when the Gaming ladder is empty", async ({ page }) => {
    await stubHomepageApi(page, { emptyPresetsFor: ["GAMING"] });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr");

    await expect(page.locator("#top").getByText("Détails specs →")).toBeVisible();
    await expect(page.locator("#top").getByText(/Score de configuration/)).toHaveCount(0);
  });

  test("never overflows in Arabic at 360", async ({ page }) => {
    await stubHomepageApi(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/ar");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
```

- [x] **Step 7: Run the spec to verify it passes**

Run: `npx playwright test e2e/homepage-hero.spec.ts`
Expected: PASS (4 tests). If the dedupe assertion fails at 1, the hero is not using the shared query keys — fix the component, never the assertion.

- [x] **Step 8: Run the affected regression suite**

Run: `npm test && npx playwright test e2e/homepage.spec.ts e2e/homepage-builds.spec.ts e2e/homepage-i18n.spec.ts`
Expected: 158+ unit tests PASS, all listed browser tests PASS.

- [x] **Step 9: Commit**

```bash
git add apps/web-v2/components/home/hero-rig-preview.tsx \
        apps/web-v2/components/home/homepage-hero.tsx \
        apps/web-v2/e2e/support/homepage-api.ts \
        apps/web-v2/e2e/homepage-hero.spec.ts \
        apps/web-v2/tests/homepage/hero-rig-preview.test.tsx
git commit -m "feat(web-v2): render the rank-1 build in the hero preview"
```

**Acceptance:** the desktop preview shows the Gaming preset's own score and price at 1280; it requests nothing the builds section does not already request; it shows no number when the ladder is empty or the detail has no build; the phone layout is unchanged; both locales stay overflow-free at 360.

**Dependencies:** none. **Risk:** `useMetaOptions` may upgrade the currency after mount and re-key the ladder (an extra request in a slow-meta case); acceptable, and the dedupe assertion runs on the settled page.

---

### Task 2: Make discovery visible on mobile

**Owner approval:** **required.** The approved mobile frame shows resolution shortcuts (deferred by Q-20), not category tiles; the section spec's own responsive table still promises a mobile pathways affordance (§2.1 "2 tiles"). The recommended resolution is to render the three existing category tiles stacked below `lg` — the smallest change that gives mobile the affordance without inventing the resolution shortcut.

**Files:**
- Modify: `components/home/discovery-pathways.tsx`
- Modify: `apps/web-v2/docs/sections/01-homepage.md` (§2.1 and §7 responsive rows, recording the decision)
- Test: `e2e/homepage-finder.spec.ts` (add the 390 px case)

**Interfaces:**
- Consumes: `useHomepageStore`, `HomeUseCase`, `#finder-usage`.
- Produces: `DiscoveryPathways()` unchanged in signature; `#pathways` now present at every width.

- [x] **Step 1: Write the failing browser test**

Add to `e2e/homepage-finder.spec.ts`:

```ts
test("offers the same three tiles on a phone and keeps the focus move", async ({ page }) => {
  const { posts } = await stubHomepageApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fr");
  await waitForSettledCards(page);

  const section = page.locator("#pathways");
  await expect(section).toBeVisible();
  await expect(section.getByRole("button")).toHaveCount(3);
  await expect(section.getByRole("button", { name: "Gaming 1080p" })).toHaveCount(0);

  await section.getByRole("button", { name: "Études & bureautique" }).click();
  await expect(page.getByRole("radio", { name: USAGE_OFFICE })).toBeChecked();
  await expect(page.locator("#finder-usage")).toBeFocused();
  await expect(page.locator("#configurations article")).toHaveCount(1);
  expect(posts).toEqual([]);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/homepage-finder.spec.ts -g "same three tiles"`
Expected: FAIL — the section is `display:none` below `lg`.

- [x] **Step 3: Change the section's responsive classes**

In `discovery-pathways.tsx`: `className="hidden scroll-mt-24 lg:block"` → `className="block scroll-mt-24"`, and the list `"mt-4 grid grid-cols-3 gap-4"` → `"mt-4 grid gap-3 sm:grid-cols-3 lg:gap-4"`. Keep the tile markup, the `aria-pressed` state, the focus move and the comment that the resolution tiles stay deferred (Q-20). Update the component comment to say the three use-case tiles are the mobile affordance and the resolution row is still deferred.

- [x] **Step 4: Run the test to verify it passes**

Run: `npx playwright test e2e/homepage-finder.spec.ts`
Expected: PASS (all tests, including the existing "renders no resolution shortcut tile at any breakpoint").

- [x] **Step 5: Record the decision in the section spec**

Amend §2.1's mobile Pathways cell and §7's Mobile composition paragraph to state: the three use-case tiles render at every width, one per row below `sm` and three across from `sm`; the resolution tiles remain deferred (Q-20). Cite the owner's approval and the date.

- [x] **Step 6: Check the narrowest Arabic layout**

Run: `npx playwright test e2e/homepage-i18n.spec.ts e2e/homepage-finder-ar.spec.ts`
Expected: PASS — the seven-width sweep still reports no horizontal overflow.

- [x] **Step 7: Commit**

```bash
git add apps/web-v2/components/home/discovery-pathways.tsx \
        apps/web-v2/e2e/homepage-finder.spec.ts \
        apps/web-v2/docs/sections/01-homepage.md
git commit -m "feat(web-v2): give the phone layout the discovery tiles"
```

**Acceptance:** `#pathways` is visible at 390 and 1280; it offers three labeled buttons; selecting one writes the store, moves focus to `#finder-usage` and narrows the cards; no resolution tile appears; both locales remain overflow-free at every measured width; the spec amendment exists.

**Dependencies:** none. **Risk:** the extra section lengthens the mobile page before the trust section; the existing bottom-nav clearance specs still bound it.

---

### Task 3: Make "Voir la configuration" navigate

**Owner approval:** **required.** It changes a documented placeholder (Q-06/Q-08 territory) into a real link. It is the most prominent dead affordance on the page, and the destination already exists.

**Files:**
- Modify: `components/home/featured-build-card.tsx`
- Modify: `components/home/recommended-build-section.tsx`
- Test: `e2e/homepage-builds.spec.ts` (new test)

**Interfaces:**
- Consumes: `buildConfiguratorHref({ useCase, budgetAmount }): string | null` (`@/lib/configurator/schema`), `Link` from `@/i18n/navigation`, `HomeUseCase`.
- Produces: `FeaturedBuildCardProps` gains `useCase: HomeUseCase`. `RecommendedBuildSection`'s `BuildSlot` passes its own `useCase` and `preset.budget_amount`.

- [x] **Step 1: Write the failing browser test**

Add to `e2e/homepage-builds.spec.ts`:

```ts
test("opens the configurator from a card with the tier it actually shows", async ({ page }) => {
  const { posts } = await stubHomepageApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/fr");
  await waitForSettledCards(page);

  const gaming = page.locator("#configurations article", {
    has: page.getByRole("heading", { name: CARD_TITLES.GAMING }),
  });

  await gaming.getByRole("link", { name: "Voir la configuration" }).click();
  await expect(page).toHaveURL(/\/fr\/configurateur\?use_case=GAMING&budget=12000$/);
  expect(posts).toEqual([]);
});

test("links the capped tier, never the budget the visitor typed", async ({ page }) => {
  await stubHomepageApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/fr");
  await waitForSettledCards(page);

  await page.getByRole("radio", { name: /Jeux vidéo & Gaming/ }).check({ force: true });
  await page.getByRole("spinbutton", { name: "Budget exact en dirhams" }).fill("20000");

  const gaming = page.locator("#configurations article", {
    has: page.getByRole("heading", { name: CARD_TITLES.GAMING }),
  });
  await expect(gaming.getByRole("link", { name: "Voir la configuration" })).toHaveAttribute(
    "href",
    "/fr/configurateur?use_case=GAMING&budget=15000",
  );
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/homepage-builds.spec.ts -g "opens the configurator"`
Expected: FAIL — the card renders a `span`, so no link role exists.

- [x] **Step 3: Implement the link**

In `featured-build-card.tsx`, import `Link` from `@/i18n/navigation` and `buildConfiguratorHref`; add `useCase` to the props. Replace the CTA `span` with:

```tsx
const href = buildConfiguratorHref({ useCase, budgetAmount: view.budgetAmount });
// href is null only for an out-of-contract amount; keep the current inert text then.
```

Render `<Link href={href} className="text-label-lg text-primary underline-offset-4 hover:underline">{t("cta")}</Link>` when `href !== null`, else the existing `aria-disabled` span. Keep the arrow icon and the retry button unchanged. In `recommended-build-section.tsx`, pass `useCase={useCase}`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test e2e/homepage-builds.spec.ts`
Expected: PASS — including the existing "never writes on load" and the compact-row test.

- [x] **Step 5: Record the decision**

Add one line to the section spec §6's **Interactions** paragraph: the details action is now a real link to `/{locale}/configurateur?use_case=…&budget=<served tier>`; it uses the served preset budget, not the typed one; Q-06 is closed for build cards and remains open for the hero preview and guide cards.

- [x] **Step 6: Commit**

```bash
git add apps/web-v2/components/home/featured-build-card.tsx \
        apps/web-v2/components/home/recommended-build-section.tsx \
        apps/web-v2/e2e/homepage-builds.spec.ts \
        apps/web-v2/docs/sections/01-homepage.md
git commit -m "feat(web-v2): link a build card to the configurator"
```

**Acceptance:** every rendered card exposes one link with an accessible name; its href carries the card's use case and served tier; the capped case links 15 000, not 20 000; nothing is posted.

**Dependencies:** Task 1 is independent; both touch no shared file. **Risk:** the link sits inside an `<article>` with a retry button; keep the DOM order and the 44 px target.

---

### Task 4: Close the remaining dead affordance that has a real destination

**Owner approval:** **recommended (small).** Only the mobile nav "Guides" item changes: its destination (`#guides`) already exists on the page. Guides cards, the methodology link and the footer links have no destination and stay inert text — record that as accepted, do not invent routes.

**Files:**
- Modify: `app/[locale]/layout.tsx`
- Modify: `apps/web-v2/docs/sections/01-homepage.md` (§3 and §11 interaction rows)
- Test: `e2e/homepage.spec.ts` (new assertion in the shell describe)

**Interfaces:**
- Consumes: `MobileNav`, `MobileNavItem` (`href?`).
- Produces: the `guides` item carries `href: "#guides"`.

- [x] **Step 1: Write the failing assertion**

```ts
test("points the mobile Guides item at the guides section", async ({ page }) => {
  await stubHomepageApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fr");

  const nav = page.getByRole("navigation", { name: "Navigation mobile" });
  await expect(nav.getByRole("link", { name: "Guides" })).toHaveAttribute("href", "#guides");
  // The three destinations without a route stay non-focusable text.
  for (const label of ["Composants", "Enregistrés"]) {
    await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
    await expect(nav.getByText(label)).toBeVisible();
  }
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/homepage.spec.ts -g "Guides item"`
Expected: FAIL — the item has no `href`, so it renders a span.

- [x] **Step 3: Add the anchor**

In `app/[locale]/layout.tsx`, change the `guides` mobile item to `{ key: "guides", href: "#guides", label: t("nav.guides") }` and update the comment above the list: Guides now points at the homepage section; Composants and Enregistrés still have no route.

- [x] **Step 4: Run the test to verify it passes**

Run: `npx playwright test e2e/homepage.spec.ts`
Expected: PASS, including the bottom-nav clearance assertions.

- [x] **Step 5: Record the acceptance**

In §3 and §11 of the section spec, state that the mobile nav's Guides item is an in-page anchor and that the remaining placeholders (hero details, guide cards, methodology link, footer links, Composants, Enregistrés) are **accepted placeholders** until their routes exist, with Q-06/Q-10/Q-11/Q-12 cited.

- [x] **Step 6: Commit**

```bash
git add apps/web-v2/app/[locale]/layout.tsx \
        apps/web-v2/e2e/homepage.spec.ts \
        apps/web-v2/docs/sections/01-homepage.md
git commit -m "fix(web-v2): point the mobile Guides tab at the guides section"
```

**Acceptance:** the Guides tab is a real anchor at 390; the inert items expose no link role; the nav still mirrors in Arabic and clears the footer.

**Dependencies:** none. **Risk:** `#guides` scrolls under the sticky header — `scroll-mt-24` is already on the section.

---

### Task 5: Put the discovery heading on the same type step as its peers

**Owner approval:** not required. This is a token-level consistency fix, not a new value: `text-headline-lg` (28 px) already exists and the other two section headings use it from `lg`.

**Files:**
- Modify: `components/home/discovery-pathways.tsx`
- Test: `e2e/homepage.spec.ts` (extend the heading-size test)

**Interfaces:**
- Consumes: `text-headline-md lg:text-headline-lg`.
- Produces: `#pathways-title` at 22 px below `lg`, 28 px from `lg`.

- [x] **Step 1: Extend the failing assertion**

In `e2e/homepage.spec.ts`, change the id list to `["configurations-title", "pathways-title", "confiance-title", "guides-title"]` and expect four equal sizes per breakpoint.

- [x] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/homepage.spec.ts -g "one size per breakpoint"`
Expected: FAIL at 1280 — the pathways heading is 22 where its peers are 28.

- [x] **Step 3: Apply the size**

Change the `<h2 id="pathways-title">` class to `"text-headline-md text-balance text-foreground lg:text-headline-lg"`.

- [x] **Step 4: Run it to verify it passes**

Run: `npx playwright test e2e/homepage.spec.ts`
Expected: PASS (four headings equal at 390 and 1280).

- [x] **Step 5: Commit**

```bash
git add apps/web-v2/components/home/discovery-pathways.tsx apps/web-v2/e2e/homepage.spec.ts
git commit -m "fix(web-v2): align the discovery heading with the section scale"
```

**Acceptance:** all four section headings share one size per breakpoint; no new class outside the token set.

**Dependencies:** Task 2 changes the same file's container classes; land Task 2 first to avoid a conflict.

---

### Task 6: Pin the accessibility and responsive evidence

**Owner approval:** not required. No new dependency: the contrast maths is ~15 lines of pure TypeScript.

**Files:**
- Create: `lib/a11y/contrast.ts`
- Create: `tests/a11y/contrast.test.ts`
- Create: `e2e/homepage-a11y.spec.ts`

**Interfaces:**
- Produces:
  - `type Rgb = { r: number; g: number; b: number }`
  - `parseCssColor(value: string): Rgb` — understands `rgb(r, g, b)` and `rgba(r, g, b, a)` as `getComputedStyle` returns them.
  - `relativeLuminance(color: Rgb): number`
  - `contrastRatio(a: Rgb, b: Rgb): number` — 1…21.

- [x] **Step 1: Write the failing unit test**

```ts
// tests/a11y/contrast.test.ts
import { describe, expect, it } from "vitest";
import { contrastRatio, parseCssColor, relativeLuminance } from "@/lib/a11y/contrast";

describe("contrast", () => {
  it("parses the rgb() form getComputedStyle returns", () => {
    expect(parseCssColor("rgb(255, 255, 255)")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseCssColor("rgba(11, 28, 48, 0.8)")).toEqual({ r: 11, g: 28, b: 48 });
  });

  it("matches the WCAG reference values", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/a11y/contrast.test.ts`
Expected: FAIL — the module does not exist.

- [x] **Step 3: Implement the helper**

`sRGB` channel → `c / 255`, then `c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4`; luminance is `0.2126 R + 0.7152 G + 0.0722 B`; ratio is `(lighter + 0.05) / (darker + 0.05)`. Throw a named error on an unparsable colour so a silent `NaN` cannot pass a gate.

- [x] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/a11y/contrast.test.ts`
Expected: PASS (2 tests).

- [x] **Step 5: Write the browser evidence spec**

`e2e/homepage-a11y.spec.ts`, two locales, three widths (360, 390, 1280), stubbed API, with these assertions:

1. **Heading order** — collect `h1…h6` in document order from `main`; exactly one `h1`; no level jumps by more than one; every `section` has an accessible name via `aria-labelledby`.
2. **Touch targets** — for `header a, header button, nav a, nav button, #pathways button, #simulateur label, #configurations a, #configurations button, section[aria-labelledby="final-cta-title"] a` that is visible, assert `width >= 44 && height >= 44`. Skip elements with `display:none` ancestors.
3. **Focus visibility** — press `Tab` once: the skip link is focused and its computed `outlineWidth` parses to `>= 2px`. Press `Tab` again: the focused element has a non-`none` outline **or** a non-`none` `box-shadow`. Assert focus is always inside the document (never `body` after 12 tabs).
4. **Contrast** — body copy (`#configurations article p` first) on its card background ≥ 4.5; the saffron CTA (`button` with variant `cta`, found by name) text on its own background ≥ 4.5 for the label size used; the final CTA body on the gradient panel ≥ 4.5. Resolve `backgroundColor` by walking ancestors until a non-transparent value, and read the text colour from the element itself.
5. **Announcements** — the finder's status line is `role="status"`; the budget error is `role="alert"`; submit stays focusable while disabled (`aria-disabled` only where the spec says so).
6. **Console** — collect `console` messages of type `error`; assert none on `/fr` and none on `/ar`.

- [x] **Step 6: Run the spec**

Run: `npx playwright test e2e/homepage-a11y.spec.ts`
Expected: PASS. If contrast fails on `text-subtle` or the saffron CTA, fix the token usage the spec already names (`text-on-accent`), not the threshold.

- [x] **Step 7: Commit**

```bash
git add apps/web-v2/lib/a11y/contrast.ts apps/web-v2/tests/a11y/contrast.test.ts \
        apps/web-v2/e2e/homepage-a11y.spec.ts
git commit -m "test(web-v2): pin homepage accessibility and contrast evidence"
```

**Acceptance:** the new spec runs in `npm run test:e2e` with no new dependency; failures name the file, the selector and the measured value; heading order, targets, focus, contrast, announcements and console are all covered in both locales.

**Dependencies:** land after Tasks 1–5 so the measured DOM is final. **Risk:** computed-style contrast on translucent surfaces can be misleading; resolve against the nearest opaque ancestor and, if a surface is genuinely translucent, assert against the design token pair in the spec instead.

---

### Task 7: Imagery (BLOCKED on assets)

**Owner approval:** **required, and currently unavailable.** Q-03 stands: the repository holds no approved photography. Do not substitute stock.

**Files (only when assets exist):**
- Create: `public/images/home/hero-rig.webp`, `public/images/home/build-{gaming,office,workstation}.webp`, `public/images/home/guide-{budget,gpu,ram,portable}.webp`
- Modify: `components/home/hero-rig-preview.tsx`, `featured-build-card.tsx`, `guide-card.tsx`, `build-media-placeholder.tsx`
- Modify: `e2e/homepage.spec.ts`
- Modify: `apps/web-v2/docs/sections/01-homepage.md` (§1.1 imagery decision)

**Interfaces:**
- Produces: `BuildMediaPlaceholder` keeps its decorative role but renders a local `<Image>` when a `src` is supplied; `alt=""` because the card heading carries the meaning.

- [ ] **Step 1: Obtain the assets and record them** — hero 16:9 ≥ 1200 px, three builds 4:3, four guides 16:9, committed under `public/`. If the owner supplies none, stop here and record "Q-03 accepted, placeholders remain" in §1.1; the task is then **BLOCKED**, not passed.
- [ ] **Step 2: Update the origin guard first** — change the existing assertion in `e2e/homepage.spec.ts` from "no external image" to "no external image **and** the expected local images are requested", so a missing asset fails rather than silently degrading.
- [ ] **Step 3: Run it to verify it fails** — `npx playwright test e2e/homepage.spec.ts -g "image"` → FAIL (no images rendered).
- [ ] **Step 4: Render the images** with `next/image`, explicit width/height or `fill` with a sized parent, `sizes` matching the card widths, and `loading="lazy"` below the fold.
- [ ] **Step 5: Re-run** — `npx playwright test e2e/homepage.spec.ts e2e/homepage-i18n.spec.ts` → PASS, no overflow at any width.
- [ ] **Step 6: Commit** once assets are approved: `feat(web-v2): render the approved homepage imagery`.

**Acceptance:** every media slot shows an approved local asset with correct dimensions; zero third-party origins; no layout shift; Arabic and French both measured.

**Dependencies:** owner-provided assets. **Risk:** unoptimised files bloat the bundle; keep WebP and the declared aspect ratios.

---

### Task 8: Close the Arabic native-review gate

**Owner approval:** **required** — a native Arabic reviewer, not an agent. The gate cannot be self-signed.

**Files:**
- Modify: `apps/web-v2/docs/homepage-arabic-review.md` (fill the Sign-off table; regenerate the key table if any copy changed in Tasks 1–4)
- Create: `tests/i18n/arabic-signoff.test.ts`

**Interfaces:**
- Produces: `tests/i18n/arabic-signoff.test.ts` reads the doc and `messages/ar.json`, flattening the `Homepage` namespace to dotted keys.

- [ ] **Step 1: Prepare the review packet** — the doc's table plus fresh `/ar` captures at 390 and 1280 (Task 9's harness), and the RTL findings from Task 6.
- [ ] **Step 2: Write the gate, expecting failure** — assert (a) the Sign-off table has a non-empty reviewer and an ISO date, (b) the doc's key column covers exactly the flattened `Homepage` keys in `ar.json` — no missing, no stale.

```ts
expect(signoff.reviewer.trim()).not.toBe("");
expect(signoff.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
expect([...documentedKeys].sort()).toEqual([...arabicHomepageKeys].sort());
```

- [ ] **Step 3: Run it to verify it fails** — `npx vitest run tests/i18n/arabic-signoff.test.ts` → FAIL (unsigned).
- [ ] **Step 4: Obtain the sign-off** — the reviewer signs the table; record their name, date and any approved copy changes. Until this happens the task is **BLOCKED**; do not fill the table on their behalf.
- [ ] **Step 5: Re-run** — PASS, and the doc's banner changes from "Pending native-language review" to the signed state with the date.
- [ ] **Step 6: Commit** — `docs(web-v2): record the Arabic homepage sign-off` (+ the test).

**Acceptance:** the sign-off is real, dated and attributable; the key-coverage gate prevents a later copy change from silently invalidating it.

**Dependencies:** Task 6's RTL evidence; reviewer availability. **Risk:** the gate fails the whole suite until sign-off lands, so land the test and the signature in the same commit.

---

### Task 9: Final gates, evidence and completion report

**Owner approval:** not required to run; approval is required to declare the homepage complete.

**Files:**
- Create: `docs/superpowers/specs/step-3-5-report.md`
- Modify: `apps/web-v2/docs/sections/01-homepage.md` (status header; close Q-02/Q-04/Q-06/Q-19/Q-20 rows with dated answers)
- Modify: `apps/web-v2/README.md` (test counts, spec count, widths)
- Regenerate: `apps/web-v2/docs/screenshots/step-3-5/{before,after}/**`

**Interfaces:**
- Consumes: `scripts/screenshots.mjs` with `SCREENSHOT_OUTPUT_DIR` and `SCREENSHOT_BASE_URL`.
- Produces: a report whose every claim is a printed number or a file path.

- [x] **Step 1: Run the full gate set** from `apps/web-v2`, capturing each exit code:

```bash
npm run typecheck; npm run lint; npm run format:check; npm run check:api-types
npm test; npm run build; npm run test:e2e
```

Expected: every command exit 0; record the printed unit and browser counts (the baseline to beat is 157 unit / 62 browser).

- [x] **Step 2: Capture evidence** — `npm run build && npm run start` against the configured API, then `SCREENSHOT_OUTPUT_DIR=docs/screenshots/step-3-5/after node scripts/screenshots.mjs` for desktop/mobile, fr/ar, full-page mobile included. `before/` is the existing `step-3-4/after` set, copied, not re-shot.
- [x] **Step 3: Measure the seven widths by hand where the suite is silent** — 360, 390, 430, 768, 1024, 1280, 1440: record the new preview's box, the pathways tile row/grid, the card row and bottoms, and the bottom-nav clearance in both locales. A number you did not read goes in the report as "not measured".
- [x] **Step 4: Write the report** — one table mapping each of the 13 completion criteria to its evidence (spec line, test name, measured number, screenshot path). Explicitly list anything BLOCKED (imagery Q-03, Arabic sign-off if unsigned) as not-complete, not as a caveat.
- [x] **Step 5: Close the open questions** — Q-02 (keep 40 px: accepted), Q-04 (three functional tiles: accepted, frame's fourth unreadable — Figma 429 measured 2026-11-07), Q-06 (build cards closed by Task 3; hero/guides inert by decision), Q-19 (implemented by Task 1), Q-20 (resolution tiles still deferred). Each row gets a date and a verdict.
- [x] **Step 6: Review the diff against the constraints** — no `apps/api`, `apps/web`, token, manifest or lockfile change; `tests/homepage/rtl-utilities.test.ts` green; no hex literal.
- [x] **Step 7: Commit**

```bash
git add apps/web-v2/docs apps/web-v2/README.md docs/superpowers/specs/step-3-5-report.md
git commit -m "docs(web-v2): record the Step 3.5 completion evidence"
```

**Acceptance:** the report's criterion table has no empty evidence cell; every BLOCKED item is named with what would close it; the branch is green on the same commands CI runs (`web-v2.yml`); the owner can accept or reject the remaining decisions from the report alone.

**Dependencies:** Tasks 1–8 (7 and 8 may remain BLOCKED). **Risk:** screenshots against a cold API capture skeletons — the harness warns on zero cards; wait for a settled section and record the count it printed.

---

## Execution order and owner gates

| Order | Task | Owner gate | Why here |
| --- | --- | --- | --- |
| 1 | Task 1 — hero preview | no | Spec-mandated by Q-19; unblocks the largest visual gap |
| 2 | Task 2 — mobile discovery | **yes** | Changes the approved mobile composition |
| 3 | Task 3 — card CTA link | **yes** | Turns a documented placeholder into a route |
| 4 | Task 4 — mobile nav Guides | yes (small) | One anchor, existing destination |
| 5 | Task 5 — pathways heading | no | Token-only consistency |
| 6 | Task 6 — a11y evidence | no | Must measure the final DOM |
| 7 | Task 7 — imagery | **yes + assets** | Blocked until assets exist |
| 8 | Task 8 — Arabic sign-off | **yes + reviewer** | Cannot be automated |
| 9 | Task 9 — final report | yes (to declare complete) | Aggregates everything |

If the owner declines Tasks 2, 3, 4 or 7, record the declination in the section spec with the date and skip the task; the completion report then carries it as an accepted limitation, never as a pass.

## Self-review notes

- **Spec coverage:** hero states (§4, §14, Q-19) → Task 1; discovery variants (§2.1, §7, Q-04, Q-20) → Tasks 2 and 5; card interaction (§6) → Task 3; header/footer/mobile nav (§3, §11, Q-05/10/11/12) → Task 4; i18n/RTL (§15, §16.6–16.7) → Tasks 1, 2 and 6; a11y (§16.8) → Task 6; imagery (§1.1, Q-03) → Task 7; Arabic gate (§16.6, Q-15) → Task 8; Definition of Done (§16) → Task 9.
- **Deliberately absent:** no task changes the 12 000 selection rule, the price-badge source, the peer ordering, the request set on first paint, or the token scale. Those are pinned and correct today.
- **Type consistency:** `selectSlotPreset`, `toBuildCardView`, `buildConfiguratorHref`, `usePresets`, `useRecommendationDetail` and `useMetaOptions` are used with the signatures read from the branch at `58fe17c`; `FeaturedBuildCard` gains exactly one prop (`useCase`), and every caller is named.
