/**
 * app/sitemap.ts — `/sitemap.xml` (S18; bilingual since S20).
 *
 * ## What it lists, and why each entry has to prove itself
 *
 * The DoD is one sentence — "lists only indexable pages" — and the hard half is
 * the "only". Being listed is an invitation to a crawler, so an entry whose page
 * answers `noindex` is a contradiction: Search Console reports it as "Excluded
 * by 'noindex' tag", and the site has told two systems two different things. So
 * no page is listed by virtue of existing; each one is listed because the SAME
 * predicate that writes its `robots` tag said yes — and for the two page types
 * that have one, that means literally ONE call (`presetPageIndexable()`,
 * `componentPageIndexable()`), not a second spelling of the rule:
 *
 *   - **presets** — `presetPageIndexable()`, S16's conjunction (API-sourced AND
 *     every build verified) applied to the loader outcome. A committed fixture is
 *     a demonstration and stays out; an API page with one indicative card stays
 *     out with it.
 *   - **components** — `indexableComponentSlugs()`, which asks the same
 *     `componentPageIndexable()` the product page asks, confirmed through the
 *     product read. A catalogue product with a placeholder offer is not listed
 *     even when the list endpoint's single `offer_class` looks verified.
 *   - **guides** — every guide is indexable prose, in both locales since S20.
 *   - **the legal pages** (S22) — indexable on purpose: a legal notice, a
 *     privacy page and a contact page are documents a reader may search for,
 *     and none of them carries anyone's data.
 *   - **home and the wizard** — the two pages that set no `robots` at all, so the
 *     crawler's default applies and both are listed. The wizard's four steps are
 *     query strings on ONE url, which is why it contributes one entry.
 *
 * `/config/[id]` is absent and must stay absent: it is a per-visitor result,
 * `noindex` by design, and no sitemap may suggest otherwise. That is an invariant
 * rather than an omission, so `e2e/seo.spec.ts` asserts it.
 *
 * ## Both locales, one pair at a time (S20 closed V9)
 *
 * V9 withheld `ar` URLs until the Arabic side was a translated surface; listing a
 * half-translated page would have been a claim the site could not keep. Every
 * route is bilingual now, so each page contributes TWO `<url>` entries — its
 * `fr` and its `ar` address — and each entry carries the same
 * `xhtml:link rel="alternate"` set the page's own `<head>` carries
 * (`localeAlternates()`, the one function both callers use). The pair is built
 * together on purpose: a page that is listed in one locale while its sibling is
 * omitted is the shape a mistake takes here, and it cannot happen when a single
 * call emits both.
 *
 * ## Dynamic, not a build artifact
 *
 * A metadata route is static by default, and for this one that would be wrong in
 * a way that is invisible: the catalog and the ribbon are read at BUILD time, and
 * a CI build has no API — so the artifact would be a truthful sitemap of a site
 * that does not yet exist, frozen until the next deploy. `force-dynamic` renders
 * it per request instead, and the reads UNDER it are still cached for
 * `CATALOG_REVALIDATE_SECONDS` / `PRESET_REVALIDATE_SECONDS`, so a crawl costs a
 * few cached API reads, not a fresh pipeline. The catalogue walk is BOUNDED as
 * well — one wall-clock budget and four product reads at a time
 * (`indexableComponentSlugs`) — so a large catalogue shortens this document
 * instead of holding a crawler's request open. It also cannot 500 on an API blip:
 * both loaders degrade to fewer entries (see `indexableComponentSlugs` and
 * `presetsForBuild`) rather than throwing, and a shorter list is the honest
 * failure for a document whose whole contract is "only what is indexable".
 *
 * Order is deterministic — home, the wizard, the guide index, the guides in
 * manifest order, presets cheapest first, components in keyset order, each locale
 * immediately after its sibling — so regenerating an unchanged site emits an
 * unchanged document.
 */
import type { MetadataRoute } from "next";

import { indexableComponentSlugs } from "@/lib/catalog/load";
import { GUIDE_MANIFEST, guideText } from "@/lib/guides/manifest";
import { localePath } from "@/lib/i18n/paths";
import { loadPresetCached, presetsForBuild } from "@/lib/presets/load";
import { presetPageIndexable } from "@/lib/presets/model";
import { absoluteUrl, CONTENT_LOCALES, localeAlternates } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

export interface PageMeta {
  changeFrequency?: ChangeFrequency;
  priority?: number;
  /** Per locale: a guide's date is the date ITS prose changed. */
  lastModified?: Partial<Record<(typeof CONTENT_LOCALES)[number], string>>;
}

/**
 * One logical page as its per-locale `<url>` entries, each carrying the SAME
 * `alternates` map the page's `<head>` carries — the reason the pair is emitted
 * by one call instead of two loops that could drift.
 */
function perLocale(path: string, meta: PageMeta = {}): MetadataRoute.Sitemap {
  const languages = localeAlternates(path);
  return CONTENT_LOCALES.map((locale) => {
    const lastModified = meta.lastModified?.[locale];
    return {
      url: absoluteUrl(localePath(locale, path)),
      ...(lastModified === undefined ? {} : { lastModified }),
      ...(meta.changeFrequency === undefined ? {} : { changeFrequency: meta.changeFrequency }),
      ...(meta.priority === undefined ? {} : { priority: meta.priority }),
      alternates: { languages },
    };
  });
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    ...perLocale("/", { changeFrequency: "weekly", priority: 1 }),
    // The wizard is indexable (it overrides no `robots`) and is the page a search
    // for "configurer un pc" should land on, so leaving it out would be the
    // listing disagreeing with the tag in the harmless direction — still a
    // disagreement, and the cheap one to fix. `/ar/configurer` is the same page
    // in Arabic, not a second one.
    ...perLocale("/configurer", { changeFrequency: "monthly", priority: 0.9 }),
    ...perLocale("/guides", { changeFrequency: "monthly", priority: 0.8 }),
    // S22's three legal pages. `yearly` is what their prose actually does:
    // these are not surveys of a fast-moving catalogue, and a `weekly` claim
    // would invite a crawler to re-read text that has not changed.
    ...perLocale("/mentions-legales", { changeFrequency: "yearly", priority: 0.3 }),
    ...perLocale("/confidentialite", { changeFrequency: "yearly", priority: 0.3 }),
    ...perLocale("/contact", { changeFrequency: "yearly", priority: 0.3 }),
  ];

  for (const guide of GUIDE_MANIFEST) {
    entries.push(
      ...perLocale(`/guides/${guide.slug}`, {
        // The PROSE's date per locale, not a build timestamp: a deploy is not an
        // edit, and a translation is not an edit of the original.
        lastModified: { fr: guideText(guide, "fr").updated, ar: guideText(guide, "ar").updated },
      }),
    );
  }

  // Cheapest first, as `presetsForBuild()` returns them. A preset the ribbon does
  // not name is not listed; one whose page would say `noindex` is not either —
  // and that is decided by the SAME call the page's `robots` tag makes.
  for (const preset of await presetsForBuild()) {
    const outcome = await loadPresetCached(preset.slug);
    if (outcome.kind !== "ok" || !presetPageIndexable(outcome)) continue;
    const generated = outcome.page.recommendation.generated_at ?? undefined;
    entries.push(
      ...perLocale(`/${preset.slug}`, {
        lastModified: generated === undefined ? undefined : { fr: generated, ar: generated },
      }),
    );
  }

  for (const slug of await indexableComponentSlugs()) {
    entries.push(...perLocale(`/composants/${slug}`));
  }

  return entries;
}
