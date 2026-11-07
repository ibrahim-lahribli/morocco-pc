# Step 3.4 — Homepage Visual Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the V2 homepage's visual fidelity and internal consistency — hero composition, section-header system, card geometry, rhythm, responsive coverage and the RTL rule — without changing the product, the URL contract, the API or a single design token.

**Architecture:** The page is one server-rendered tree in `app/[locale]/layout.tsx` + `app/[locale]/page.tsx` with four client islands (finder, cards, pathways, closing CTA). Refinement happens inside existing components plus one new presentational `SectionHeading`; tokens stay in `app/globals.css`; every measurement is asserted from the rendered DOM, never eyeballed.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 `@theme` tokens, next-intl (fr/ar), Vitest (jsdom, `tests/**`), Playwright (`e2e/**`, stubbed `/v1/**`), Prettier + Tailwind class sorting.

**Spec:** the Step 3.4 brief (owner message, 2026-11-07) and, as its measurable source, `apps/web-v2/docs/sections/01-homepage.md` (frame-derived: desktop node `19:3`, mobile node `23:1179`), `apps/web-v2/docs/DESIGN_SYSTEM.md`, `apps/web-v2/stitch_morocco_pc_builder_app/accueil_morocco_pc/{code.html,screen.png}`.

## Source-of-truth status (read before Task 1)

The brief names the Figma desktop frame as the primary reference. **Figma is not readable in this session:** `figma-context.get_figma_data` on file `OwaMKYnDfH2AQqj7y0bn2H`, node `0:1` returned HTTP 429 ("Figma API rate limit hit", retry after ≈56 967 s, starter plan). Therefore:

- The measurable authority is the **committed, frame-derived specification** (`01-homepage.md` §1.1, §1.2, §2, §4, §6, §7 — it records the frames' node ids, container, padding, grid and the already-approved deltas) plus the **Stitch reference screen** the token set came from.
- No plan task may claim Figma pixel parity. The report must say "layout and hierarchy parity against the committed frame specification; Figma itself unreadable (429)" and nothing stronger.
- Task 1 records one retry attempt with its timestamp. If it succeeds, Task 2's audit table may cite Figma values; if it fails again, the above stands and the report says so.

## Global Constraints

- Desktop Figma is the desktop reference; **mobile keeps its approved frame** (`01-homepage.md` §1.1 names mobile `23:1179` the primary UX reference) and the existing responsive architecture. §13's seven viewports are validated, not redesigned.
- **No token edits.** `app/globals.css` `@theme` is frozen: `01-homepage.md` §1.2 and `docs/DESIGN_SYSTEM.md` require design-owner approval, and the hero's 40 px/700 heading plus the saffron delta are already approved (Q-01, Q-02). No hex literal, no arbitrary `[…]` value in a component.
- **Logical properties only** in components: `ms/me`, `ps/pe`, `start/end`, `text-start/end`, `border-s/e`, `rounded-s/e`; direction-bearing icons keep `rtl:-scale-x-100`.
- **No new string in JSX.** Copy reaches components as props or through `useTranslations`/`getTranslations`; `fr.json` and `ar.json` keep key and `{placeholder}` parity.
- **No behaviour change:** the finder's Zod validation, the `use_case`/`budget`/`from` URL contract, the homepage→configurator handoff, the three GET-only reads, the disabled "Components"/"Saved" destinations and the `aria-disabled` text CTAs all stay exactly as Step 3.1–3.3 left them.
- **No API, schema, engine, V1 (`apps/web`) or manifest change.** No new dependency. `next-env.d.ts` is generated — never commit it.
- Every gate runs from `apps/web-v2`: `npm run typecheck`, `lint`, `format:check`, `check:api-types`, `npm test`, `npm run test:e2e`, `npm run build`. All must exit 0.
- Commits: `type(web-v2): …` subject, one logical change each; no force push; report HEAD at the end.

## Review Focus

Cases the brief's tests do not name but that a visitor will hit; each gets a test in the task that owns the code.

1. **No API listening.** Every section except the cards must still render, the three slots must show their error state at full card height, and the page must not overflow. (Task 4.)
2. **A very long component name in a spec pill** (real catalogue names exceed the pill). The name must stay readable and must not widen the card or the page at 360 px. (Task 4.)
3. **Arabic long labels** in cards, nav and CTAs at 360 px — the Arabic body line-height is 1.6, so card rows can grow past their Latin height. No clipping, no overflow. (Tasks 2, 3, 5.)
4. **Tablet at 1024 px** — the `lg` grid turns on at exactly this width, so the hero's two 6-column halves are narrowest here and the three cards are tightest. (Task 5.)
5. **Zero-build / empty slot** must keep the same geometry as a filled card, so the three-card row does not become ragged. (Task 4.)

---

### Task 1: Baseline, source record and a non-destructive screenshot harness

**Files:**
- Modify: `apps/web-v2/scripts/screenshots.mjs`
- Create: `apps/web-v2/docs/screenshots/step-3-4/before-*.png` (generated, committed as evidence)
- Modify: `apps/web-v2/README.md` (the `screenshots` row)

**Interfaces:**
- Produces: `SCREENSHOT_OUTPUT_DIR` env var, default `docs/screenshots` (unchanged behaviour when unset), honoured as a path relative to `apps/web-v2`.

- [ ] **Step 1: Record the baseline**

Run: `git -C . fetch origin && git status -sb && git rev-parse --short HEAD origin/feature/v2-design`
Expected: `## feature/v2-design...origin/feature/v2-design`, no ahead/behind, both SHAs `3a65bad`. Record the output verbatim for the report.

- [ ] **Step 2: Retry Figma once and record the answer**

Call `get_figma_data` with `{ fileKey: "OwaMKYnDfH2AQqj7y0bn2H", nodeId: "0:1" }`. Expected today: 429 with a retry interval. Record the exact message in the report's §C; do not retry in a loop.

- [ ] **Step 3: Add the output-directory override**

`scripts/screenshots.mjs` currently hard-codes `path.resolve(process.cwd(), "docs/screenshots")`. Replace it with:

```js
const outputDir = path.resolve(process.cwd(), process.env.SCREENSHOT_OUTPUT_DIR ?? "docs/screenshots");
```

- [ ] **Step 4: Capture the "before" set against a data-bearing page**

```bash
cd apps/web-v2
# the cards are the only data-bearing surface; without an API they render error states
API_ALLOW_SHARED=1 npm run start:api            # separate shell, root package, port 3000
npm run build && npm run start                   # port 3220
SCREENSHOT_OUTPUT_DIR=docs/screenshots/step-3-4/before npm run screenshots
```

Expected: six files (`desktop-fr`, `desktop-ar`, `mobile-fr`, `mobile-ar`, `mobile-fr-full`, `mobile-ar-full`) and `3 configuration card(s) visible` for each locale. **If the card count is 0, the capture is not evidence** — stop and fix the API origin/CORS before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/web-v2/scripts/screenshots.mjs apps/web-v2/README.md apps/web-v2/docs/screenshots/step-3-4/before
git commit -m "chore(web-v2): let the screenshot harness target a subdirectory"
```

---

### Task 2: One section-header system

**Files:**
- Create: `apps/web-v2/components/home/section-heading.tsx`
- Modify: `apps/web-v2/components/home/recommended-build-section.tsx` (the `<div className="max-w-2xl">…` block)
- Modify: `apps/web-v2/components/home/trust-highlights.tsx` (the `<div className="text-center">…` block)
- Modify: `apps/web-v2/components/home/featured-guides.tsx` (the header `<div className="flex …">…` block)
- Test: `apps/web-v2/tests/homepage/section-heading.test.tsx`, `apps/web-v2/e2e/homepage.spec.ts`

**Interfaces:**
- Produces: `SectionHeading(props: { id: string; eyebrow: string; title: string; intro?: string; eyebrowFrom?: "base" | "md"; align?: "start" | "center"; action?: React.ReactNode }): JSX.Element`, rendering `<p class="text-label-md font-semibold tracking-wide text-primary uppercase">` (hidden below `md` when `eyebrowFrom` is `"md"`, its default), `<h2 id={id} class="mt-1 text-headline-md text-balance text-foreground lg:text-headline-lg">`, and `<p class="mt-1.5 max-w-prose text-body-md text-muted">` hidden below `md`.

- [ ] **Step 1: Write the failing test**

```tsx
it("renders one h2 per section with a stable id and an optional action", () => {
  render(<SectionHeading id="guides-title" eyebrow="N" title="T" intro="I" action={<span>all</span>} />);
  const heading = screen.getByRole("heading", { level: 2, name: "T" });
  expect(heading).toHaveAttribute("id", "guides-title");
  expect(screen.getByText("N")).toHaveClass("hidden", "md:block");
  expect(screen.getByText("all")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/homepage/section-heading.test.tsx`
Expected: FAIL — cannot resolve `@/components/home/section-heading`.

- [ ] **Step 3: Implement `SectionHeading` and migrate the three sections**

Each section keeps its own `<section aria-labelledby>` and its own grid; only the header block is replaced. `RecommendedBuildSection` passes `eyebrowFrom="base"` (its frame shows the eyebrow at every width); `TrustHighlights` and `FeaturedGuides` use the `"md"` default, matching what they already do. `TrustHighlights` passes `align="center"`; `FeaturedGuides` passes its "all guides" span as `action`.

- [ ] **Step 4: Verify unit and browser**

Run: `npx vitest run tests/homepage && npm run test:e2e -- homepage.spec.ts`
Expected: PASS, and the three existing heading-name assertions unchanged.

- [ ] **Step 5: Add the heading-parity assertion**

In `e2e/homepage.spec.ts`:

```ts
test("gives the three section headings one size per breakpoint", async ({ page }) => {
  await stubHomepageApi(page);
  for (const [width, expected] of [[390, 22], [1280, 28]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/fr");
    const sizes = await page.evaluate(() =>
      ["configurations-title", "confiance-title", "guides-title"].map((id) =>
        parseFloat(getComputedStyle(document.getElementById(id)!).fontSize),
      ),
    );
    expect(new Set(sizes)).toEqual(new Set([expected]));
  }
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/web-v2/components/home/section-heading.tsx apps/web-v2/components/home/recommended-build-section.tsx apps/web-v2/components/home/trust-highlights.tsx apps/web-v2/components/home/featured-guides.tsx apps/web-v2/tests/homepage/section-heading.test.tsx apps/web-v2/e2e/homepage.spec.ts
git commit -m "feat(web-v2): give the homepage one section-header system"
```

---

### Task 3: Hero composition — two lines, 64 px, one measure

**Files:**
- Modify: `apps/web-v2/components/home/homepage-hero.tsx`
- Test: `apps/web-v2/e2e/homepage.spec.ts`

**Interfaces:**
- Consumes: `SectionHeading` is **not** used here (the hero owns the page's only `<h1>`). The `HomepageHero` props are unchanged.

**Why:** the frame's H1 is two lines — "Le bon PC," then "au bon budget." — with the accent phrase on line 2 (`01-homepage.md` §4). The shipped markup puts both phrases in one inline flow inside a ≈588 px column at 1280, so the break is left to the browser's wrap: at 40 px the pair can land on one line, and nothing in the code encodes the frame's composition. The spec also fixes the hero's vertical padding at **64 px** from `lg`; the component ships `pt-8 lg:pt-12` (32/48).

- [ ] **Step 1: Write the failing test**

```ts
test("sets the hero heading on two lines and its padding per the spec", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/fr");
  const boxes = await page.locator("#hero-title span").evaluateAll((spans) =>
    spans.map((span) => span.getBoundingClientRect().toJSON()),
  );
  expect(boxes).toHaveLength(2); // one block span per line
  expect(boxes[1]!.top).toBeGreaterThan(boxes[0]!.bottom - 2); // line 2 starts below line 1
  const paddingTop = await page
    .locator("section#top")
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  expect(paddingTop).toBe(64);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:e2e -- homepage.spec.ts --grep "two lines"`
Expected: FAIL — `boxes[1].top` sits inside line 1 (single line), padding is 48.

- [ ] **Step 3: Implement**

In `HomepageHero`: `className="… pt-10 lg:pt-16"` (40/64) on `section#top`. Wrap the lead and the accent in `block` spans so the composition is structural, not width-dependent:

```tsx
<h1 id="hero-title" className="mt-3 text-display text-foreground lg:text-display-lg">
  <span className="block">{titleLead}</span>
  <span className="block bg-linear-to-r from-primary-deep to-primary bg-clip-text text-transparent">
    {titleAccent}
  </span>
</h1>
```

Drop `text-balance` and `max-w-3xl` from the H1 (both are inert once the lines are explicit and the column is narrower than 768 px); keep `max-w-2xl` on the intro. The Arabic strings are two blocks as well, so RTL keeps the same composition.

- [ ] **Step 4: Re-run, in both locales**

Run: `npm run test:e2e -- homepage.spec.ts homepage-i18n.spec.ts`
Expected: PASS at 390, 1280, 1440 in `fr` and `ar`; no overflow.

- [ ] **Step 5: Commit**

```bash
git add apps/web-v2/components/home/homepage-hero.tsx apps/web-v2/e2e/homepage.spec.ts
git commit -m "fix(web-v2): compose the hero heading on two lines at the spec's padding"
```

---

### Task 4: Card geometry — one baseline, readable pills, stable slots

**Files:**
- Modify: `apps/web-v2/components/home/featured-build-card.tsx` (the `<dl>` block)
- Modify: `apps/web-v2/components/home/spec-pill.tsx`
- Test: `apps/web-v2/tests/homepage/spec-pill.test.tsx`, `apps/web-v2/e2e/homepage-builds.spec.ts`

**Interfaces:**
- `SpecPill` keeps `children: React.ReactNode`; only its classes change (`truncate` → `break-words` with `min-w-0`).
- The card keeps its `data-slot="build-card"`, `aria-labelledby` and every data field.

- [ ] **Step 1: Write the failing unit test**

```tsx
it("keeps a long component name readable instead of truncating it", () => {
  render(<SpecPill>AMD Ryzen 5 5600G (6 cœurs, 12 threads, 3,9 GHz)</SpecPill>);
  const text = screen.getByText(/AMD Ryzen 5 5600G/);
  expect(text).toHaveClass("break-words");
  expect(text).not.toHaveClass("truncate");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/homepage/spec-pill.test.tsx`
Expected: FAIL — the text node's wrapper is an inline `<span className="truncate">`.

- [ ] **Step 3: Implement the pill and the baseline**

`SpecPill`: outer keeps `inline-flex max-w-full items-center rounded-pill …`; inner `<span className="break-words">`. In `FeaturedBuildCard`, give the score value the price's line box so the two `dd` bottoms coincide: `<dd className="min-h-7 text-label-lg font-semibold …">` (`min-h-7` = 28 px = `--text-price--line-height`), leaving the `<dl>`'s `items-end` as is.

- [ ] **Step 4: Verify unit**

Run: `npx vitest run tests/homepage`
Expected: PASS.

- [ ] **Step 5: Add the browser geometry assertions**

In `e2e/homepage-builds.spec.ts`, with the stub:

```ts
test("aligns a card's score and price on one baseline", async ({ page }) => {
  await stubHomepageApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/fr");
  const bottoms = await page.locator('[data-slot="build-card"] dl dd').evaluateAll((dds) =>
    dds.slice(0, 2).map((dd) => dd.getBoundingClientRect().bottom),
  );
  expect(Math.abs(bottoms[0]! - bottoms[1]!)).toBeLessThanOrEqual(1);
});

test("keeps an erroring slot the height of a filled card", async ({ page }) => {
  await page.route("**/v1/**", (route) => route.fulfill({ status: 503, body: "{}" }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/fr");
  const heights = await page.locator("#configurations > div > article").evaluateAll((cards) =>
    cards.map((card) => card.getBoundingClientRect().height),
  );
  expect(new Set(heights.map((h) => Math.round(h))).size).toBe(1);
});
```

- [ ] **Step 6: Re-run and commit**

Run: `npm run test:e2e -- homepage-builds.spec.ts homepage-i18n.spec.ts`
Expected: PASS, and the existing Arabic price-at-end-edge assertion still holds (it feeds this task's Review Focus 3).

```bash
git add apps/web-v2/components/home/featured-build-card.tsx apps/web-v2/components/home/spec-pill.tsx apps/web-v2/tests/homepage/spec-pill.test.tsx apps/web-v2/e2e/homepage-builds.spec.ts
git commit -m "fix(web-v2): align the build card's score and price and unclamp spec pills"
```

---

### Task 5: The two untested breakpoints

**Files:**
- Modify: `apps/web-v2/e2e/homepage-i18n.spec.ts` (`BREAKPOINTS`)
- Modify: `apps/web-v2/e2e/configurator.spec.ts` (the 360 px bar test, extended to 1024)

**Interfaces:**
- Consumes: `stubHomepageApi`, `waitForSettledCards`, `horizontalOverflow` (unchanged).

- [ ] **Step 1: Write the failing test**

Add `{ width: 768, height: 1024 }` and `{ width: 1024, height: 768 }` to `BREAKPOINTS`; the existing loop then asserts overflow ≤ 0 for both locales at both widths.

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -- homepage-i18n.spec.ts --grep "never scrolls horizontally"`
Expected: PASS if the layout is already sound; a non-zero value names the offending width. Fix the offending element with tokens (`min-w-0`, `break-words`, `overflow-x-auto` on the pill row), never with a fixed pixel width.

- [ ] **Step 3: Assert the `lg` boundary itself**

```ts
test("keeps the three cards one row at 1024 and stacked at 1023", async ({ page }) => {
  await stubHomepageApi(page);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/fr");
  const wide = await page.locator("#configurations article").evaluateAll((cards) =>
    cards.map((card) => card.getBoundingClientRect().top),
  );
  expect(new Set(wide.map((top) => Math.round(top))).size).toBe(1);
  await page.setViewportSize({ width: 1023, height: 900 });
  await expect.poll(async () => new Set(await page.locator("#configurations article").evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)))).size).toBeGreaterThan(1);
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-v2/e2e/homepage-i18n.spec.ts apps/web-v2/e2e/configurator.spec.ts
git commit -m "test(web-v2): cover the 768 and 1024 breakpoints and the lg card boundary"
```

---

### Task 6: A gate for the RTL rule the design system already states

**Files:**
- Create: `apps/web-v2/tests/homepage/rtl-utilities.test.ts`
- Test: same file

**Interfaces:**
- Produces: a Vitest suite that reads every `.tsx` under `components/`, asserts none contains a physical-direction utility, and lists every offender by file and line.

**Why:** `DESIGN_SYSTEM.md` forbids `ml/mr/pl/pr`, `left/right`, `text-left/right`, `border-l/r`, `rounded-l/r`. Until now that rule was enforced by reviewer memory; the visual refinement pass is exactly when a physical utility slips in.

- [ ] **Step 1: Write the failing test**

```ts
const FORBIDDEN = /\b(?:ml|mr|pl|pr|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-(?:\[|[a-z0-9])|\b(?:left|right)-\[/g;

it("uses logical direction utilities in every component", async () => {
  const files = await glob("components/**/*.tsx");
  const offenders = files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(FORBIDDEN)].map((m) => `${file}: ${m[0]}`);
  });
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it and fix what it finds**

Run: `npx vitest run tests/homepage/rtl-utilities.test.ts`
Expected: PASS on today's tree (the Step 3 components were audited). Any hit is a real defect: replace with the logical counterpart. If `glob` needs a dependency, use `node:fs` `readdirSync(..., { recursive: true })` instead — **do not add a package**.

- [ ] **Step 3: Commit**

```ts
git add apps/web-v2/tests/homepage/rtl-utilities.test.ts
git commit -m "test(web-v2): enforce logical direction utilities across components"
```

---

### Task 7: Imagery decisions — documented, not invented

**Files:**
- Modify: `apps/web-v2/docs/sections/01-homepage.md` (Q-03 row / imagery note)
- Test: `apps/web-v2/e2e/homepage.spec.ts`

**Interfaces:**
- No component change. Every media slot stays the token gradient (`BuildMediaPlaceholder`, `HeroRigPreview`, `GuideCard`).

**Why:** the brief asks to prioritise real PC imagery "where approved assets are available". None are: the repository ships no photography and §1.2 forbids hot-linking the design file. Inventing stock imagery would violate "do not use unrelated stock imagery". The deliverable is therefore a recorded decision plus a guarantee that no external image dependency appeared.

- [ ] **Step 1: Write the failing test**

```ts
test("loads no external image and keeps every media slot decorative", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === "image" && url.origin !== "http://localhost:3210") external.push(url.href);
  });
  await stubHomepageApi(page);
  await page.goto("/fr");
  await expect(page.locator("#configurations article").first()).toBeVisible();
  expect(external).toEqual([]);
  await expect(page.locator("#configurations [aria-hidden='true']").first()).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -- homepage.spec.ts --grep "external image"`
Expected: PASS; if it fails, a component is hot-linking and the change is reverted, not stubbed.

- [ ] **Step 3: Record the decision**

In `01-homepage.md`, extend the imagery paragraph: asset supply is the owner's decision (Q-03), Step 3.4 ships no photography, and the three media slots keep one gradient treatment and one radius so the page reads as designed rather than as broken images. Name the exact assets a future pass needs: one hero rig shot (16:9 ≥1200 px), three build shots (4:3), four guide thumbnails (16:9).

- [ ] **Step 4: Commit**

```bash
git add apps/web-v2/docs/sections/01-homepage.md apps/web-v2/e2e/homepage.spec.ts
git commit -m "docs(web-v2): record the Step 3.4 imagery decision and pin it in a test"
```

---

### Task 8: After screenshots, gates, report

**Files:**
- Create: `apps/web-v2/docs/screenshots/step-3-4/after-*.png`
- Create: `docs/superpowers/specs/step-3-4-report.md`
- Modify: `apps/web-v2/README.md` (spec count if Task 5/7 added specs)

**Interfaces:**
- Consumes: `SCREENSHOT_OUTPUT_DIR` from Task 1.

- [ ] **Step 1: Capture the "after" set**

With the same API + server running as Task 1: `SCREENSHOT_OUTPUT_DIR=docs/screenshots/step-3-4/after npm run screenshots`. Expected: six files, `3 configuration card(s) visible` per locale. Keep `before/` untouched — never overwrite a baseline to hide a regression.

- [ ] **Step 2: Run every gate and record the real numbers**

```bash
cd apps/web-v2
npm run typecheck;            echo "TYPECHECK=$?"
npm run lint;                 echo "LINT=$?"
npm run format:check;         echo "FORMAT=$?"
npm run check:api-types;      echo "APITYPES=$?"
npm test;                     echo "UNIT=$?"
npm run test:e2e;             echo "E2E=$?"
npm run build;                echo "BUILD=$?"
```

Expected: every exit code 0; `npm test` reports the unit total (≥145 with Task 6's suite), `npm run test:e2e` the browser total (≥58 with the new specs). Copy the printed counts into the report — no rounded claims.

- [ ] **Step 3: Write the report**

`docs/superpowers/specs/step-3-4-report.md` (root, matching `step-3-1`…`step-3-3`; the brief's `apps/web-v2/docs/superpowers/…` path does not exist in this tree). Sections A–L exactly as the brief lists them, plus:
- §C must open with the Figma 429 and name the committed spec + Stitch screen as the measurable reference; no pixel-parity claim.
- §J must carry the open items: `HeroRigPreview` shows no preset (needs approval), the mobile discovery section is absent by Q-20, no photography (Q-03), Arabic copy unsigned, and any deviation deliberately not fixed.
- §K: baseline `3a65bad`, every commit of this step, `git status` clean, and "not pushed" unless the owner authorises it.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/step-3-4-report.md apps/web-v2/docs/screenshots/step-3-4/after apps/web-v2/README.md
git commit -m "docs(web-v2): record the Step 3.4 refinement and its measured gates"
```

---

## Not in this plan (needs owner approval first)

1. **`HeroRigPreview` renders no build.** The desktop hero's preview card is a text-only shell, so the hero's strongest visual anchor carries an eyebrow, a caption and a disabled link but no title, price or score. `Homepage.hero.preview.score` is authored and unused. Rendering the real rank-1 preset means turning the preview into a client consumer of the same query the cards use — a data/behaviour change, not a visual one.
2. **The mobile discovery section does not exist.** `DiscoveryPathways` is `hidden lg:block` and the frame's resolution tiles are deferred (Q-20), so 360–1023 px has no discovery affordance. Enabling it needs either the resolution `inputs_applied` gate or a mobile category variant.
3. **Photography.** Blocked on assets (Q-03), see Task 7.
4. **The hero heading's frame size.** The frame is 48 px/800; the shipped token is 40 px/700, approved as Q-02. Raising it is a token change and needs the design owner.
