import { getLocale, getTranslations } from "next-intl/server";

import { Skeleton, SkeletonCard } from "@/components/ui";

/**
 * `/fr/config/[id]/loading.tsx` — the route's loading boundary.
 *
 * The results page is a server component whose fetch is `no-store`, so a
 * client navigation (the wizard's `router.push` after `POST
 * /v1/recommendations`, or the page's own retry/reload links) spends the
 * server render with NOTHING new on screen: without a boundary, the wizard's
 * submit panel stays mounted — whose clock keeps lying once the POST is over —
 * or the address bar moves ahead of an empty `<main>`. This fallback replaces
 * that dead gap with the page's real shape, so a hand-off reads as one
 * continuous state — bar → skeleton → cards — instead of everything
 * disappearing and reappearing (the 2026-10-31 flow review's closing gap).
 *
 * Deliberate properties, inherited from the primitives:
 *
 *   - **Server component, zero client code.** The skeletons are static
 *     markup, exactly the `SkeletonCard`s the wizard's submit panel shows;
 *     the `prefers-reduced-motion` block in `globals.css` collapses their
 *     pulse, so no variant is needed here either.
 *   - **One announcement, in the page's own words.** `aria-hidden` is
 *     Skeleton's own, so the rectangles never reach a reader. The single
 *     `loadingStatus` sentence does, through a polite live region — with the
 *     caveat the wizard's own `role="status"` comment records: a region
 *     mounted WITH its message is announced inconsistently across browsers.
 *     It is the only sentence a server-rendered fallback can carry, and
 *     speaking it sometimes is better than never.
 *   - **The real layout, not a re-design.** Title, intro, three cards drawn
 *     in `<ol>`/`<li>` like the build list it stands in for, the share row a
 *     >0-build pass serves, and the fine-print disclaimer that closes the
 *     page. Widths approximate; the ORDER mirrors `config/[id]/page.tsx`,
 *     which is what makes the swap invisible rather than surprising.
 *   - **RTL-safe by symmetry.** Every block is a full-width bar or a fixed-width
 *     pill inside a flex row, and no positioning depends on direction, so the
 *     Arabic fallback mirrors without a `dir` branch.
 *
 * One contract note: an App Router `loading.tsx` receives NO props — not even
 * `params` — so the locale is not destructured here. `getLocale()` resolves the
 * request's locale through next-intl's request config, which falls back to the
 * `[locale]` route param (`i18n/request.ts`), so the fallback speaks the page's
 * language on both `/fr` and `/ar` without server-side plumbing.
 */

export default async function Loading() {
  const t = await getTranslations({ locale: await getLocale(), namespace: "result" });

  return (
    <section aria-busy="true">
      <p role="status" aria-live="polite" className="sr-only">
        {t("loadingStatus")}
      </p>

      <header>
        <Skeleton className="h-7 w-56 rounded" />
        <Skeleton className="mt-2 h-4 w-64 rounded" />
      </header>

      <ol className="mt-6 space-y-4">
        {[0, 1, 2].map((row) => (
          <li key={row}>
            <SkeletonCard />
          </li>
        ))}
      </ol>

      <div className="mt-6 flex gap-2">
        <Skeleton className="h-9 w-28 rounded-pill" />
        <Skeleton className="h-9 w-36 rounded-pill" />
      </div>

      <Skeleton className="mt-4 h-2.5 w-1/2 rounded" />
    </section>
  );
}
