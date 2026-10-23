import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ComparePicker, CompareView } from "@/components/compare-view";
import { Alert } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { COMPARE_MIN, parseCompareSlugs } from "@/lib/catalog/compare";
import { catalogueProductsForPickerCached, loadCompareProductsCached } from "@/lib/catalog/load";
import type { AppLocale } from "@/lib/i18n/format";

/**
 * `/{locale}/composants/comparer` — S23's comparison.
 *
 * ## The address bar is the state
 *
 * `?composants=a,b,c` is parsed leniently (`parseCompareSlugs`: blanks dropped,
 * duplicates dropped keeping the first, capped at three) and rendered in the order
 * it names, so sharing a link reproduces the columns exactly — the DoD's first
 * scenario. There is no client component on this page: every change is a
 * navigation to the next URL, built by one helper (`compareHref`), which is why
 * Back works and nothing has to be kept in sync.
 *
 * A static segment outranks the sibling `[slug]` dynamic segment, so this route is
 * reached without touching the product routes — a product named "comparer" would
 * still lose to this page, which is the one reservation the URL space makes.
 *
 * ## Three states, and none of them is an error
 *
 *   0 or 1 resolved products — the page says two are needed and shows the picker,
 *                              because a single product is a product page, not a
 *                              comparison.
 *   2 or 3 resolved products — the comparison, then the picker.
 *   a dead slug in the URL   — that column is dropped and the page SAYS SO
 *                              (`loadCompareProducts` reports it): a shared link is
 *                              a working document, and the picker beside the note is
 *                              how the reader repairs it. One dead token must not
 *                              cost them the comparison that still exists.
 *
 * ## `noindex`
 *
 * The variant space is unbounded and every variant is a subset of pages that are
 * indexable — or not — on their own merits, so this page would only ever compete
 * with them. `follow` stays on: the product links lead where a reader wants to go.
 * `/sitemap.xml` enumerates route types explicitly, so it needs no change to leave
 * this one out.
 *
 * The two reads run in parallel, and the picker's own loader already degrades to a
 * shorter list instead of throwing: a sick catalogue list costs the page its picker,
 * never the comparison.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "catalog" });

  return {
    title: t("compare.title"),
    robots: { index: false, follow: true },
  };
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const appLocale = locale as AppLocale;
  const { composants } = await searchParams;
  const slugs = parseCompareSlugs(composants);

  const [{ products, missing }, catalogue] = await Promise.all([
    loadCompareProductsCached(slugs),
    catalogueProductsForPickerCached(),
  ]);
  const t = await getTranslations({ locale, namespace: "catalog" });

  // The picker carries the slugs that RESOLVED, so a dead token is never forwarded
  // into the next URL the reader clicks.
  const selection = products.map((product) => product.slug);

  return (
    <section>
      <h1 className="text-heading text-ink">{t("compare.title")}</h1>
      <p className="mt-2 text-compact text-muted">{t("compare.intro")}</p>

      {missing.length > 0 ? (
        <Alert tone="warning" className="mt-3">
          {t("compare.missing")}
        </Alert>
      ) : null}

      {products.length >= COMPARE_MIN ? (
        <CompareView products={products} locale={appLocale} />
      ) : (
        <p className="mt-3 text-compact text-ink">{t("compare.needTwo")}</p>
      )}

      <ComparePicker slugs={selection} products={catalogue} locale={appLocale} />
    </section>
  );
}
