# Step 3.5 — the three owner decisions (Tasks 2, 3, 4)

**Status: answered — A / A / A, 2026-11-08.** The owner approved the recommended option for all
three tasks (mobile discovery tiles, card CTA to the configurator, mobile Guides anchor). All
three are implemented and merged (PR #17, merge commit `39a3ee0`), and each one's evidence is
the test named in its section. Written 2026-11-08 against `feature/v2-design-step-3-5`
(`70a4623`, `b46e1da`, `86da083`) on base `feature/v2-design` `58fe17c`.

**This is not product acceptance.** Approving a composition decision is not release signoff:
C11 (approved imagery), C12 (native Arabic review) and final owner acceptance of the homepage
remain open and are tracked in `docs/superpowers/specs/step-3-5-report.md`.

Each section states the question, the options, **one recommendation**, what each option costs, the
exact code that changes, and the check that proves it. Replying `Task 2: A`, `Task 3: A`,
`Task 4: A` is enough to unblock all three; a decline is recorded as an accepted limitation, never
as a pass.

**Why an owner, not an agent.** All three change composition a visitor sees, not correctness. The
approved screens are unavailable: Figma still answers HTTP 429, and the committed Stitch export is a
different generated design. So nothing here can be settled by measuring the source.

**What none of them changes.** No new route, no API call, no POST, no new dependency, no token value,
no `apps/web` or `apps/api` file, and no change to the 12 000 selection rule or the price-badge
source.

---

## Task 2 — should the three discovery tiles appear on a phone?

`#pathways` is `hidden` below `lg`. The desktop frame shows a tile row; the mobile frame shows
resolution shortcuts that Q-20 deferred, while the section spec §2.1 promises a mobile affordance
("2 tiles"). The contradiction is in the documents, so it needs a person.

### Options

| | Option | What the visitor gets | Cost |
| --- | --- | --- | --- |
| **A (recommended)** | Render the **three existing use-case tiles** stacked below `sm`, three across from `sm` | The same shortcut the desktop has, in one column | Two class strings, one test, one spec paragraph |
| B | Keep it desktop-only (today) | No discovery affordance on a phone; §2.1 stays unfulfilled | Nothing — but the gap is permanent |
| C | Horizontal scroll strip of the same tiles | A carousel feel the frames never show | New interaction, focus/overflow evidence, RTL scroll behaviour |

### Recommendation: A

It is the smallest change that gives mobile the affordance without inventing the deferred
resolution row, and it reuses the tile that already writes the store, scrolls to `#finder-usage`
and focuses it. The resolution tiles stay absent (Q-20 stays open).

### Consequences

- The section now renders between *Configurations* and *Confiance* on phones, adding roughly three
  tile rows (~200 px) to the mobile page. The existing bottom-nav clearance specs still bound it.
- Three more controls enter the mobile tab order. They are `min-h-11` (44 px), so the Task 6 target
  gate passes; the focus walk gains three stops.
- The heading becomes visible at 390 for the first time — already 22 px there since Task 5.
- Arabic at 360 must stay overflow-free: one column below `sm` is the safe shape.
- Nothing is posted, and the cards still narrow without a request.

### Exact code

`apps/web-v2/components/home/discovery-pathways.tsx`

```diff
- * The three use-case shortcuts, shown from `lg`.
+ * The three use-case shortcuts: one per row on a phone, three across from `sm`.
@@
-      className="hidden scroll-mt-24 lg:block"
+      className="block scroll-mt-24"
@@
-      <ul className="mt-4 grid grid-cols-3 gap-4">
+      <ul className="mt-4 grid gap-3 sm:grid-cols-3 lg:gap-4">
```

The component comment also gains one sentence: *the resolution tiles remain deferred (Q-20); the
three use-case tiles are the mobile affordance.*

`apps/web-v2/docs/sections/01-homepage.md` — §2.1's mobile Pathways cell and §7's mobile composition
paragraph each get: “the three use-case tiles render at every width, one per row below `sm` and
three across from `sm`; resolution tiles remain deferred (Q-20) — owner-approved `<date>`.”

`apps/web-v2/e2e/homepage-finder.spec.ts` — the plan's test, unchanged: at 390 the section is
visible, has exactly three buttons, no `Gaming 1080p` tile; clicking *Études & bureautique* checks
the OFFICE radio, focuses `#finder-usage`, narrows to one card, and posts nothing.

### Checks

```bash
npx playwright test e2e/homepage-finder.spec.ts        # red before, green after
npx playwright test e2e/homepage-i18n.spec.ts e2e/homepage-finder-ar.spec.ts
npx playwright test e2e/homepage-a11y.spec.ts
npm run typecheck && npm run lint && npm run format:check
```

**Acceptance:** `#pathways` visible at 390 and 1280, three labelled buttons, no resolution tile, the
focus move and the narrowing unchanged, no overflow at 360 in either locale, no new console error.

---

## Task 3 — should “Voir la configuration” open the configurator?

The card's call to action is an `aria-disabled` span. The configurator exists, and the URL contract
that seeds it (`buildConfiguratorHref`) is already used by the finder.

### Options

| | Option | What the visitor gets | Cost |
| --- | --- | --- | --- |
| **A (recommended)** | Link to `/{locale}/configurateur?use_case=<card>&budget=<served tier>` | The configuration the card is showing, opened | One prop, one link, two tests, one spec line |
| B | Keep it inert until a results route exists (Q-08) | Nothing — the page's most prominent action stays dead | Nothing |
| C | Link back to `#simulateur` | The finder again, not the build | Small, but duplicates the pathways' job and is less useful |

### Recommendation: A

The destination exists, the URL contract is already tested, and the link can carry exactly the tier
the card displays. It must carry the **served** tier, never the typed budget: a capped request
(20 000) opens 15 000, which is the build the visitor saw.

### Consequences

- Three links on desktop (one when the finder narrows), one per card; no POST, no analytics.
- **The Task 6 target gate will fail unless the link is 44 px tall at phone widths.** `#configurations a`
  is in the measured control list, and a bare text link is ~20 px. The link therefore needs the same
  geometry as the tile.
- The hero's “Détails specs” and the guide cards stay inert (Q-06 remains open for them); only build
  cards close.
- The retry button stays a sibling, so no nested interactive element appears.

### Exact code

`apps/web-v2/components/home/featured-build-card.tsx`

```diff
+import { Link } from "@/i18n/navigation";
+import { buildConfiguratorHref } from "@/lib/configurator/schema";
+import type { HomeUseCase } from "@/lib/homepage/builds";
@@
 export interface FeaturedBuildCardProps {
+  useCase: HomeUseCase;
@@
 export function FeaturedBuildCard({
+  useCase,
@@
-  const titleId = `build-${view.recommendationId}`;
+  const titleId = `build-${view.recommendationId}`;
+  // The served tier, never the visitor's typed amount: a capped request opens the
+  // build the card actually shows. `null` only for an out-of-contract amount.
+  const href = buildConfiguratorHref({ useCase, budgetAmount: view.budgetAmount });
@@
-          <span aria-disabled="true" className="text-label-lg text-primary">
-            {t("cta")}
-          </span>
+          {href === null ? (
+            <span aria-disabled="true" className="text-label-lg text-primary">
+              {t("cta")}
+            </span>
+          ) : (
+            <Link
+              href={href}
+              className="inline-flex min-h-11 items-center text-label-lg text-primary underline-offset-4 hover:underline"
+            >
+              {t("cta")}
+            </Link>
+          )}
```

`min-h-11` is not decoration: it is what keeps the Task 6 target assertion true on a phone.
`components/home/recommended-build-section.tsx` passes `useCase={useCase}` to `FeaturedBuildCard`
(the slot already has it).

`apps/web-v2/docs/sections/01-homepage.md` — §6 Interactions gains: “the details action is a real
link to `/{locale}/configurateur?use_case=…&budget=<served tier>`; it uses the served preset budget,
not the typed one; Q-06 is closed for build cards and stays open for the hero and guide cards —
owner-approved `<date>`.”

### Checks

```bash
npx playwright test e2e/homepage-builds.spec.ts        # red before, green after
npx playwright test e2e/homepage-a11y.spec.ts          # the 44 px target gate
npx playwright test e2e/homepage-builds.spec.ts e2e/homepage-finder.spec.ts
npm test && npm run typecheck && npm run lint && npm run format:check
```

**Acceptance:** every rendered card exposes one link with an accessible name; its `href` carries the
card's use case and served tier (`/fr/configurateur?use_case=GAMING&budget=12000`); a capped 20 000
request links 15 000; nothing is posted; the link measures at least 44 px tall at 390.

---

## Task 4 — should the mobile “Guides” tab scroll to the guides?

The mobile nav's Guides item is an `aria-disabled` span while `#guides` exists on the page. *Home*
and *Configurer* are already in-page anchors; Guides is the odd one out.

### Options

| | Option | What the visitor gets | Cost |
| --- | --- | --- | --- |
| **A (recommended)** | `href: "#guides"` — the same in-page anchor pattern as Home and Configurer | A working tab on the homepage | One property, one test, one spec paragraph |
| B | Make every mobile item a locale-aware `Link` (`/{locale}#guides`) so tabs also work from the configurator | A correct tab on every route | Touches all five items and the shared `MobileNav`, plus its unit test |
| C | Leave it disabled | Nothing | Nothing — one dead tab stays |

### Recommendation: A

It is consistent with the two tabs beside it: the mobile nav is a homepage-anchored bar today.
Option B is the better long-term shape, but it is a navigation change for all five items and belongs
in its own decision, not bundled with a one-line fix.

### Consequences

- On `/configurateur` the Guides tab, like Home and Configurer, points at an anchor that route does
  not have. A already shares that limitation; it does not add one. B is the fix if that matters.
- The item keeps its icon, label, height (56 px) and Arabic mirroring; it becomes focusable, so the
  Task 6 focus walk gains a stop at 390 (still well above its eight-stop minimum).
- No route is invented; Components, Saved, the guide cards, the methodology link and the footer
  links stay accepted placeholders (Q-06/Q-10/Q-11/Q-12).

### Exact code

`apps/web-v2/app/[locale]/layout.tsx`

```diff
   const mobileNavItems: readonly MobileNavItem[] = [
     { key: "home", href: "#top", label: t("nav.home"), current: true },
     // No route yet: visibly disabled rather than pointed somewhere unrelated.
     { key: "components", label: t("nav.components") },
     { key: "configure", href: "#simulateur", label: t("nav.configure") },
-    { key: "guides", label: t("nav.guides") },
+    { key: "guides", href: "#guides", label: t("nav.guides") },
     { key: "saved", label: t("nav.saved") },
   ];
```

The comment above the list is updated to say Guides is an in-page anchor and that Components and
Saved still have no route.

`apps/web-v2/docs/sections/01-homepage.md` — §3 and §11 record the anchor and list the remaining
placeholders as **accepted**, with the Q-numbers and the approval date.

### Checks

```bash
npx playwright test e2e/homepage.spec.ts -g "Guides item"   # red before, green after
npx playwright test e2e/homepage.spec.ts e2e/homepage-i18n.spec.ts
npm test                                                    # tests/components/mobile-nav.test.tsx
npm run typecheck && npm run lint && npm run format:check
```

**Acceptance:** at 390 the nav exposes a link named “Guides” with `href="#guides"`; Components and
Saved expose no link role and stay visible text; the nav still mirrors in Arabic and clears the
footer; clicking it lands on the guides heading, not under the sticky header (`scroll-mt-24` is
already on the section).

---

## Answer sheet

| Decision | A | B | C |
| --- | --- | --- | --- |
| Task 2 — mobile discovery | three tiles, stacked (**recommended**) | desktop-only | scroll strip |
| Task 3 — card CTA | link to configurator, served tier (**recommended**) | stay inert | link to `#simulateur` |
| Task 4 — mobile Guides | `#guides` anchor (**recommended**) | locale-aware links for all tabs | stay disabled |

**Answered 2026-11-08: A / A / A.** Everything else in the plan (Task 1, 5, 6) was already landed
and green; Task 7 still waits on photography and Task 8 on a native Arabic reviewer, neither of
which a decision can close.
