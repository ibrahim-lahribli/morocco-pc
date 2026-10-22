import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { LinkButton } from "@/components/ui";
import { GUIDE_MDX_COMPONENTS } from "@/components/guides/mdx-components";
import { routing } from "@/i18n/routing";
import { findGuide, guideStaticParams, guideText } from "@/lib/guides/registry";
import { formatDate, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { pageAlternates } from "@/lib/seo/site";

/**
 * `/{locale}/guides/{slug}` — one editorial guide, from MDX (S17; translated in
 * S20).
 *
 * The route is STATIC: `generateStaticParams` is the cross product of the
 * committed registry and the two locales, and `dynamicParams` is false, so an
 * unknown slug — or a locale a guide has no body for — is a 404 decided at build
 * time, never a French body inside an Arabic frame.
 *
 * Three things are deliberately the page's, not the prose's:
 *
 *   - **the h1.** The MDX body starts at `##` (S17's DoD pins the hierarchy), and
 *     `mdx-components.tsx` downgrades a stray `#` so a body can never create a
 *     second page title.
 *   - **the date.** `formatDate()` on the registry's own per-locale `updated`,
 *     never a build timestamp: a deploy is not an edit, and a translation is not
 *     an edit of the French text.
 *   - **the typography.** The components map is passed in here because MDX
 *     imported into a page does NOT inherit the file-based convention; passing it
 *     also makes the styling explicit at the one call site that renders prose.
 *
 * S20's addition is that the PROSE is per locale while the LAYOUT is not: the
 * same components map renders Arabic, because direction comes from the document's
 * `dir` and the prose components already use logical properties. Nothing in this
 * file knows which language the body is in, which is the property that keeps a
 * third locale cheap.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return guideStaticParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const guide = findGuide(slug);
  if (guide === null) {
    return { robots: { index: false, follow: false } };
  }
  const text = guideText(guide, safe as AppLocale);
  return {
    title: text.title,
    description: text.description,
    // Both locales have a body (S20), so the page names itself and advertises
    // the pair — the hreflang is only legal because the `ar` route EXISTS.
    alternates: pageAlternates(safe, `/guides/${guide.slug}`),
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const guide = findGuide(slug);
  if (guide === null) notFound();

  const appLocale = locale as AppLocale;
  const text = guideText(guide, appLocale);
  const Body = guide.bodies[appLocale];
  const t = await getTranslations({ locale, namespace: "guides" });

  return (
    <article>
      <header>
        <h1 className="text-heading text-ink">{text.title}</h1>
        <p className="mt-1 text-micro text-muted">
          {t("updated", { date: formatDate(text.updated, appLocale) })}
        </p>
      </header>

      <div className="mt-4 max-w-prose">
        <Body components={GUIDE_MDX_COMPONENTS} />
      </div>

      <div className="mt-6">
        <LinkButton href={localePath(locale, "/guides")} variant="ghost">
          {t("all")}
        </LinkButton>
      </div>
    </article>
  );
}
