import type { Metadata } from "next";
import Link from "next/link";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { LinkButton } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { GUIDE_MANIFEST } from "@/lib/guides/manifest";
import { formatDate, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { pageAlternates } from "@/lib/seo/site";

/**
 * `/{locale}/guides` — the editorial index (S17).
 *
 * Two states, and the difference is a translation budget, not a layout:
 *
 *   - **fr** lists the guides. Each row is a link, a sentence and the date the
 *     PROSE changed (`GuideEntry.updated`), so the index cannot claim a guide is
 *     newer than it is.
 *   - **ar** says — in Arabic — that the guides are currently French, and links
 *     to them. An Arabic `h1` wrapped around French bodies would be worse than
 *     saying so plainly, and a bare 404 would make the language switcher look
 *     broken from a page that exists. The note is thin, so it is `noindex` while
 *     the French index is not. S20 owns the translation.
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

  if (safe !== "fr") {
    // The Arabic note is thin and untranslated, so it stays out of the index —
    // but it is still a page, and a page names itself (S18).
    return {
      title: t("frOnlyTitle"),
      robots: { index: false, follow: true },
      alternates: pageAlternates(safe, "/guides"),
    };
  }
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

  if (locale !== "fr") {
    return (
      <section>
        <h1 className="text-heading text-ink">{t("frOnlyTitle")}</h1>
        <p className="mt-2 max-w-prose text-body text-muted">{t("frOnlyBody")}</p>
        <div className="mt-6">
          <LinkButton href="/fr/guides" variant="secondary">
            {t("frOnlyCta")}
          </LinkButton>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-heading text-ink">{t("title")}</h1>
      <p className="mt-2 max-w-prose text-body text-muted">{t("intro")}</p>

      <ul className="mt-6 space-y-4">
        {GUIDE_MANIFEST.map((guide) => (
          <li key={guide.slug} className="rounded-card border border-border bg-surface p-4">
            <h2 className="text-subtitle text-ink">
              <Link
                href={localePath(locale, `/guides/${guide.slug}`)}
                className="underline-offset-4 hover:underline"
              >
                {guide.title}
              </Link>
            </h2>
            <p className="mt-1 text-compact text-muted">{guide.description}</p>
            <p className="mt-2 text-micro text-muted">
              {t("updated", { date: formatDate(guide.updated, appLocale) })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
