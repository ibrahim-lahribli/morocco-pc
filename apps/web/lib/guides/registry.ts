/**
 * lib/guides/registry.ts — the manifest plus each guide's compiled MDX body, per
 * locale (S17, and S20's Arabic pass).
 *
 * This is the only module that imports `content/guides/*.mdx`, which is why the
 * metadata lives in `manifest.ts` instead: a spec can read the slugs and titles
 * without dragging an MDX file through Playwright's TypeScript transform.
 *
 * The join is explicit and checked, in BOTH directions this time. A manifest
 * entry with no body is a build-time mistake, not a runtime possibility, so it
 * fails HERE with the slug and the locale in the message rather than rendering
 * an empty `<article>`. S20 added the second direction: the table is keyed by
 * locale, so a slug translated into French and forgotten in Arabic fails the
 * build instead of 404-ing on `/ar` — which is what let `pageAlternates()` emit
 * an `ar` `hreflang` for every guide without an exception list.
 *
 * The body's `components` map is passed by the route (`GUIDE_MDX_COMPONENTS` from
 * `components/guides/mdx-components.tsx`) — MDX imported into a page does not
 * inherit the file-based convention, so the styling is explicit at the one call
 * site that renders prose. Direction is NOT part of that map: the prose flows in
 * whatever direction `<html dir>` carries, so the Arabic bodies needed
 * translations, not a second stylesheet.
 */
import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";

import BudgetGuideAr from "../../content/guides/budget-pc-gamer.ar.mdx";
import BudgetGuideFr from "../../content/guides/budget-pc-gamer.mdx";
import GpuGuideAr from "../../content/guides/choisir-un-gpu.ar.mdx";
import GpuGuideFr from "../../content/guides/choisir-un-gpu.mdx";

import type { AppLocale } from "../i18n/format";
import { GUIDE_MANIFEST, findGuideEntry, guideText, type GuideEntry, type GuideText } from "./manifest";

export type { GuideEntry, GuideText };
export { findGuideEntry, guideText };

type GuideBody = ComponentType<{ components?: MDXComponents }>;

/** slug -> compiled body, per locale. Every manifest entry must appear in both. */
const BODIES: Record<AppLocale, Record<string, GuideBody>> = {
  fr: {
    "budget-pc-gamer": BudgetGuideFr,
    "choisir-un-gpu": GpuGuideFr,
  },
  ar: {
    "budget-pc-gamer": BudgetGuideAr,
    "choisir-un-gpu": GpuGuideAr,
  },
};

export interface Guide extends GuideEntry {
  /** Each locale's compiled prose. Both are present, checked at module load. */
  bodies: Record<AppLocale, GuideBody>;
}

export const GUIDES: readonly Guide[] = GUIDE_MANIFEST.map((entry) => {
  const bodies = {} as Record<AppLocale, GuideBody>;
  for (const locale of ["fr", "ar"] as const) {
    const body = BODIES[locale][entry.slug];
    if (body === undefined) {
      throw new Error(`guide "${entry.slug}" has no ${locale} MDX body`);
    }
    bodies[locale] = body;
  }
  return { ...entry, bodies };
});

/** One guide (metadata AND bodies) by slug, or null. */
export function findGuide(slug: string): Guide | null {
  const entry = findGuideEntry(slug);
  if (entry === null) return null;
  return GUIDES.find((guide) => guide.slug === entry.slug) ?? null;
}

/** Every `{ locale, slug }` pair the guide route prerenders — the cross product. */
export function guideStaticParams(): { locale: AppLocale; slug: string }[] {
  return (["fr", "ar"] as const).flatMap((locale) =>
    GUIDES.map((guide) => ({ locale, slug: guide.slug })),
  );
}
