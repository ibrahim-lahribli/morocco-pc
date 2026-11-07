import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BudgetUsageFinder } from "@/components/home/budget-usage-finder";
import { FeaturedGuides } from "@/components/home/featured-guides";
import { HomepageHero } from "@/components/home/homepage-hero";
import { TrustHighlights } from "@/components/home/trust-highlights";
import { routing } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "Metadata" });

  return {
    title: `${t("title")} — morocco-pc`,
    description: t("description"),
  };
}

/**
 * The homepage.
 *
 * A server component composing the static sections, with the finder island in
 * the hero's end column. Nothing here fetches: the cards that read the API are
 * a later task, so loading the page issues no request. The page's only `<h1>`
 * lives in `HomepageHero`.
 */
export default async function Homepage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "Homepage.hero" });

  return (
    <div className="flex flex-col gap-12 lg:gap-16">
      <HomepageHero
        eyebrow={t("eyebrow")}
        titleLead={t("titleLead")}
        titleAccent={t("titleAccent")}
        intro={t("intro")}
        chips={[t("chip.time"), t("chip.free"), t("chip.noAccount")]}
        previewEyebrow={t("preview.eyebrow")}
        previewCaption={t("preview.caption")}
        previewDetails={t("preview.details")}
      >
        <BudgetUsageFinder />
      </HomepageHero>

      <TrustHighlights />
      <FeaturedGuides />
    </div>
  );
}
