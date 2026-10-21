import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { LinkButton } from "@/components/ui";
import { GUIDE_MDX_COMPONENTS } from "@/components/guides/mdx-components";
import { routing } from "@/i18n/routing";
import { findGuide, GUIDES } from "@/lib/guides/registry";
import { formatDate, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";

/**
 * `/{locale}/guides/{slug}` — one editorial guide, from MDX (S17).
 *
 * The route is STATIC: `generateStaticParams` comes from the committed registry
 * and `dynamicParams` is false, so an unknown slug is a 404 decided at build
 * time, and `/ar/guides/...` never renders a French body inside an Arabic frame.
 * S20 owns the Arabic translation; until then the section is French-only and the
 * index says so.
 *
 * Three things are deliberately the page's, not the prose's:
 *
 *   - **the h1.** The MDX body starts at `##` (S17's DoD pins the hierarchy), and
 *     `mdx-components.tsx` downgrades a stray `#` so a body can never create a
 *     second page title.
 *   - **the date.** `formatDate()` on the registry's own `updated`, never a build
 *     timestamp: a deploy is not an edit.
 *   - **the typography.** The components map is passed in here because MDX
 *     imported into a page does NOT inherit the file-based convention; passing it
 *     also makes the styling explicit at the one call site that renders prose.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ locale: "fr", slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const guide = findGuide(slug);
  if (guide === null || safe !== "fr") {
    return { robots: { index: false, follow: false } };
  }
  return { title: guide.title, description: guide.description };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale) || locale !== "fr") notFound();

  const guide = findGuide(slug);
  if (guide === null) notFound();

  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale, namespace: "guides" });
  const { Body } = guide;

  return (
    <article>
      <header>
        <h1 className="text-heading text-ink">{guide.title}</h1>
        <p className="mt-1 text-micro text-muted">
          {t("updated", { date: formatDate(guide.updated, appLocale) })}
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
