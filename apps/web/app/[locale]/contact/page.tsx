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
 * `/fr/contact` — where a question, a wrong price or a broken layout goes (S22).
 *
 * There is no mail address to print yet, and this page says so rather than
 * inventing one or hiding behind a form that goes nowhere. What it CAN do is
 * make the eventual channel useful: a price report needs the configuration's
 * address, the shop and the price seen, and that is written down while someone
 * is looking at the wrong number.
 */
const PATH = "/contact";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "legal.contact" });
  return {
    title: `morocco-pc — ${t("title")}`,
    description: t("intro"),
    alternates: pageAlternates(safe, PATH),
  };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const appLocale: AppLocale = locale === "ar" ? "ar" : "fr";
  const t = await getTranslations({ locale, namespace: "legal.contact" });
  const common = await getTranslations({ locale, namespace: "legal" });
  const shell = await getTranslations({ locale, namespace: "shell.legal" });

  const sections = [
    { heading: t("channelHeading"), body: t("channelBody") },
    { heading: t("priceHeading"), body: t("priceBody") },
    { heading: t("displayHeading"), body: t("displayBody") },
    { heading: t("dataHeading"), body: t("dataBody") },
  ];

  return (
    <LegalPage
      eyebrow={t("eyebrow")}
      title={t("title")}
      intro={t("intro")}
      updated={fill(common.raw("updated"), { date: formatDate(LEGAL_UPDATED_AT, appLocale) })}
      sections={sections}
      note={
        <Link
          href={localePath(locale, "/confidentialite")}
          className="text-primary underline-offset-4 hover:underline"
        >
          {shell("privacy")}
        </Link>
      }
    />
  );
}
