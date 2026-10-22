import type { Metadata } from "next";
import Link from "next/link";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { GUIDE_MANIFEST, guideText } from "@/lib/guides/manifest";
import { formatDate, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { pageAlternates } from "@/lib/seo/site";

/**
 * `/{locale}/guides` — the editorial index (S17; one list for both locales since
 * S20).
 *
 * S17 shipped this page with two states: French listed the guides, and `ar` said
 * — in Arabic — that the guides were French and stayed `noindex`, because an
 * Arabic `h1` around French bodies would have been worse than saying so plainly.
 * S20 translated both bodies, so the second state is gone: there is one list now,
 * rendered in the route's language, and both URLs are indexable. That is the whole
 * reason the guides are `hreflang`-paired today — the `ar` page exists.
 *
 * Each row is a link, a sentence and the date the PROSE changed
 * (`GuideText.updated`) IN THAT LOCALE, so the index cannot claim a guide is newer
 * than it is, nor that the French text changed on the day it was translated.
 *
 * This is a server component with no data fetch: the registry is committed
 * content, so the page is a static route under each locale.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "guides" });

  return {
    title: t("title"),
    description: t("intro"),
    alternates: pageAlternates(safe, "/guides"),
  };
}

export default async function GuidesIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale, namespace: "guides" });

  return (
    <section>
      <h1 className="text-heading text-ink">{t("title")}</h1>
      <p className="mt-2 max-w-prose text-body text-muted">{t("intro")}</p>

      <ul className="mt-6 space-y-4">
        {GUIDE_MANIFEST.map((guide) => {
          const text = guideText(guide, appLocale);
          return (
            <li key={guide.slug} className="rounded-card border border-border bg-surface p-4">
              <h2 className="text-subtitle text-ink">
                <Link
                  href={localePath(locale, `/guides/${guide.slug}`)}
                  className="underline-offset-4 hover:underline"
                >
                  {text.title}
                </Link>
              </h2>
              <p className="mt-1 text-compact text-muted">{text.description}</p>
              <p className="mt-2 text-micro text-muted">
                {t("updated", { date: formatDate(text.updated, appLocale) })}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
