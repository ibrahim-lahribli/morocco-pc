import type { Metadata } from "next";
import Link from "next/link";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { LEGAL_UPDATED_AT, LegalPage } from "@/components/legal-page";
import { routing } from "@/i18n/routing";
import { formatDate, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { pageAlternates } from "@/lib/seo/site";
import { fill } from "@/lib/wizard/copy";

/**
 * `/fr/mentions-legales` — who publishes this site, and what it promises (S22).
 *
 * The page states what is TRUE today, including what is not known yet: there is
 * no company behind the project, no host chosen, no sale made. Inventing an ICE
 * number or a company address would be the one kind of copy a reader might rely
 * on, so the fields that must exist before commercial launch are named as such
 * in the prose instead of being filled with a plausible-looking placeholder
 * that nobody would ever replace.
 *
 * It is INDEXABLE and listed in the sitemap: a legal notice is a document a
 * reader may look for, unlike a result page.
 */
const PATH = "/mentions-legales";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "legal.mentions" });
  return {
    title: `morocco-pc — ${t("title")}`,
    // Stated here so the layout's HOME intro cannot describe a legal page.
    description: t("intro"),
    alternates: pageAlternates(safe, PATH),
  };
}

export default async function LegalNoticePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const appLocale: AppLocale = locale === "ar" ? "ar" : "fr";
  const t = await getTranslations({ locale, namespace: "legal.mentions" });
  const common = await getTranslations({ locale, namespace: "legal" });

  const sections = [
    { heading: t("publisherHeading"), body: t("publisherBody") },
    { heading: t("hostingHeading"), body: t("hostingBody") },
    { heading: t("pricesHeading"), body: t("pricesBody") },
    { heading: t("ipHeading"), body: t("ipBody") },
  ];

  return (
    <LegalPage
      eyebrow={t("eyebrow")}
      title={t("title")}
      intro={t("intro")}
      updated={fill(common("updated"), { date: formatDate(LEGAL_UPDATED_AT, appLocale) })}
      sections={sections}
      note={
        <Link
          href={localePath(locale, "/contact")}
          className="text-primary underline-offset-4 hover:underline"
        >
          {t("contactHint")}
        </Link>
      }
    />
  );
}
