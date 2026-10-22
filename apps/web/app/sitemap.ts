/**
 * app/sitemap.ts — `/sitemap.xml` (S18).
 *
 * ## What it lists, and why each entry has to prove itself
 *
 * The DoD is one sentence — "lists only indexable pages" — and the hard half is
 * the "only". Being listed is an invitation to a crawler, so an entry whose page
 * answers `noindex` is a contradiction: Search Console reports it as "Excluded
 * by 'noindex' tag", and the site has told two systems two different things. So
 * no page is listed by virtue of existing; each one is listed because the SAME
 * predicate that writes its `robots` tag said yes:
 *
 *   - **presets** — `presetIndexable()`, the S16 conjunction (API-sourced AND
 *     every build verified). A committed fixture is a demonstration and stays out;
 *     an API page with one indicative card stays out with it.
 *   - **components** — `indexableComponentSlugs()` (F17's `componentIndexable()`,
 *     confirmed through the product read). A catalogue product with a placeholder
 *     offer is not listed even when the list endpoint's single `offer_class`
 *     looks verified.
 *   - **guides** — every guide is indexable prose, French-only by S17's own rule.
 *   - **home** — the one page that is always indexable.
 *
 * `/config/[id]` is absent and must stay absent: it is a per-visitor result,
 * `noindex` by design, and no sitemap may suggest otherwise. That is an invariant
 * rather than an omission, so `e2e/seo.spec.ts` asserts it.
 *
 * ## French URLs only, until S20
 *
 * V9: this sitemap lists the `fr` URLs. The `ar` routes exist for most pages, but
 * S20 is what makes the Arabic side a translated surface with its own URLs,
 * alternates and gate; listing half-translated `ar` pages now would be a claim
 * the site cannot keep. S20 adds them.
 *
 * ## Dynamic, not a build artifact
 *
 * A metadata route is static by default, and for this one that would be wrong in
 * a way that is invisible: the catalog and the ribbon are read at BUILD time, and
 * a CI build has no API — so the artifact would be a truthful sitemap of a site
 * that does not yet exist, frozen until the next deploy. `force-dynamic` renders
 * it per request instead, and the reads UNDER it are still cached for
 * `CATALOG_REVALIDATE_SECONDS` / `PRESET_REVALIDATE_SECONDS`, so a crawl costs a
 * few cached API reads, not a fresh pipeline. It also cannot 500 on an API blip:
 * both loaders degrade to fewer entries (see `indexableComponentSlugs` and
 * `presetsForBuild`) rather than throwing, and a shorter list is the honest
 * failure for a document whose whole contract is "only what is indexable".
 *
 * Order is deterministic — home, the guide index, the guides in manifest order,
 * presets cheapest first, components in keyset order — so regenerating an
 * unchanged site emits an unchanged document.
 */
import type { MetadataRoute } from "next";

import { indexableComponentSlugs } from "@/lib/catalog/load";
import { GUIDE_MANIFEST } from "@/lib/guides/manifest";
import { localePath } from "@/lib/i18n/paths";
import { loadPresetCached, presetsForBuild } from "@/lib/presets/load";
import { presetIndexable } from "@/lib/presets/model";
import { orderBuilds } from "@/lib/result/model";
import { absoluteUrl } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl(localePath("fr", "/")), changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl(localePath("fr", "/guides")), changeFrequency: "monthly", priority: 0.8 },
  ];

  for (const guide of GUIDE_MANIFEST) {
    entries.push({
      url: absoluteUrl(localePath("fr", `/guides/${guide.slug}`)),
      // The PROSE's date, not a build timestamp: a deploy is not an edit.
      lastModified: guide.updated,
    });
  }

  // Cheapest first, as `presetsForBuild()` returns them. A preset the ribbon does
  // not name is not listed; one whose page would say `noindex` is not either.
  for (const preset of await presetsForBuild()) {
    const outcome = await loadPresetCached(preset.slug);
    if (outcome.kind !== "ok") continue;
    const builds = orderBuilds(outcome.page.recommendation.builds);
    if (!presetIndexable(outcome.page.source, builds)) continue;
    entries.push({
      url: absoluteUrl(localePath("fr", `/${preset.slug}`)),
      lastModified: outcome.page.recommendation.generated_at ?? undefined,
    });
  }

  for (const slug of await indexableComponentSlugs()) {
    entries.push({ url: absoluteUrl(localePath("fr", `/composants/${slug}`)) });
  }

  return entries;
}
