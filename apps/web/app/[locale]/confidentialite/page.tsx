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
 * `/fr/confidentialite` — what the site records, and what it does not (S22).
 *
 * This page is the written form of S22's two analytic rules, which is why it is
 * specific where most policies are vague: no cookies, no account, no form, and
 * — when a deployment turns analytics on — three named events and a page view
 * whose query string is stripped before it leaves the browser. The copy follows
 * the code in `lib/analytics.ts`; if the events map changes, this page is part
 * of the same edit (`docs/design/STATES.md` records the pair).
 *
 * It also says the one thing a reader of a shared result link needs to know: the
 * id in the address is unguessable, the page is not indexed, and anyone holding
 * the link can open it.
 */
const PATH = "/confidentialite";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "legal.privacy" });
  return {
    title: `morocco-pc — ${t("title")}`,
    description: t("intro"),
    alternates: pageAlternates(safe, PATH),
  };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const appLocale: AppLocale = locale === "ar" ? "ar" : "fr";
  const t = await getTranslations({ locale, namespace: "legal.privacy" });
  const common = await getTranslations({ locale, namespace: "legal" });
  const shell = await getTranslations({ locale, namespace: "shell.legal" });

  // Order is the reader's: what is dropped, what is never asked for, what IS
  // measured, then what the identifier in a shared link means.
  const sections = [
    { heading: t("cookiesHeading"), body: t("cookiesBody") },
    { heading: t("accountsHeading"), body: t("accountsBody") },
    { heading: t("analyticsHeading"), body: [t("analyticsBody"), t("analyticsQueryBody")] },
    { heading: t("resultsHeading"), body: t("resultsBody") },
    { heading: t("logsHeading"), body: t("logsBody") },
    { heading: t("rightsHeading"), body: t("rightsBody") },
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
          href={localePath(locale, "/mentions-legales")}
          className="text-primary underline-offset-4 hover:underline"
        >
          {shell("mentions")}
        </Link>
      }
    />
  );
}
