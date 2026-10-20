import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/i18n/format";

/**
 * The formatting proof sheet, like `/tokens` and `/kit`: a `noindex` page whose
 * only purpose is to make the helpers measurable from a browser.
 *
 * The date is a CONSTANT, not `new Date()`: a page that reads the clock cannot
 * be statically rendered, and its HTML would differ on every build for no
 * product reason. Real dates arrive from the API with the offer.
 */

export const metadata: Metadata = {
  title: "Formats — morocco-pc",
  robots: { index: false, follow: false },
};

const VERIFIED_AT = "2026-10-12T09:00:00.000Z";
const INDICATIVE_PRICE = 7300;
const TOTAL_BUDGET = 10000;

export default async function FormatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "formats" });

  const rows = [
    { label: t("moneyLabel"), value: formatMoney(INDICATIVE_PRICE, locale) },
    { label: t("dateLabel"), value: formatDate(VERIFIED_AT, locale) },
    { label: t("numberLabel"), value: formatNumber(1234567, locale) },
    { label: t("percentLabel"), value: formatPercent(INDICATIVE_PRICE / TOTAL_BUDGET, locale) },
  ];

  return (
    <article>
      <p className="font-mono text-caption uppercase tracking-wider text-primary">
        {t("eyebrow")}
      </p>
      <h1 className="mt-1 text-heading text-ink">{t("title")}</h1>
      <p className="mt-3 max-w-prose text-body text-muted">{t("intro")}</p>

      <dl className="mt-6 divide-y divide-border rounded-card border border-border bg-surface">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 p-3.5">
            <dt className="text-compact text-muted">{row.label}</dt>
            <dd className="num-tabular text-body font-semibold text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
