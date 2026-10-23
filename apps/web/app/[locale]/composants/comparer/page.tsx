import type { Metadata } from "next";
import Link from "next/link";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { CompareTable } from "@/components/catalog/compare-table";
import { Alert, Badge } from "@/components/ui";
import { routing } from "@/i18n/routing";
import {
  buildComparison,
  commonCategory,
  comparePath,
  COMPARE_PATH,
  MAX_COMPARE,
  parseCompareSlugs,
  withoutSlug,
} from "@/lib/catalog/compare";
import { catalogCandidates, loadProductForCompareCached } from "@/lib/catalog/load";
import {
  catalogCategory,
  catalogProvenance,
  fromPrice,
  PROVENANCE_MESSAGE_KEY,
} from "@/lib/catalog/model";
import { SPEC_LABEL_KEYS, type SpecCopy } from "@/lib/catalog/specs";
import { formatMoney, type AppLocale } from "@/lib/i18n/format";
import { pageAlternates } from "@/lib/seo/site";

/**
 * `/{locale}/composants/comparer` — two or three products side by side (S23).
 *
 * **The URL is the whole state.** The selection is `?slugs=a,b`, so a shared
 * link reproduces the view, the Back button undoes an addition, and two people
 * holding the same URL see the same comparison. Nothing is stored: no cookie,
 * no localStorage, no client store, and therefore no client JavaScript either —
 * every control on this page is a link, which is also why it is keyboard-
 * operable by construction.
 *
 * **`force-dynamic`, on purpose.** A query-string-driven page has no one copy to
 * cache, and this route must not be prerendered at build time: CI builds with no
 * API, and a static render would either fail the build or freeze an empty
 * comparison into the HTML. The catalogue reads INSIDE it are still cached for
 * the component page's `revalidate` window — `loadProductForCompareCached()` and
 * `catalogCandidates()` go through the same fetch cache as S17.
 *
 * **A missing product is not a broken page.** Three ways the selection can be
 * wrong, each answered in words rather than by disappearing: a repeated slug, a
 * fourth slug, a slug the catalogue does not serve. A catalogue read that FAILS
 * (5xx, timeout, 429) is reported the same way — the other products still
 * render, because a comparison is a convenience surface and a sibling's hiccup
 * must not take the whole view down. Only the category rule stops the table:
 * two categories cannot be compared, and the page says so instead of drawing a
 * table of "inconnu".
 *
 * `index: false, follow: true` is S18's rule for a user-generated view: this is a
 * tool over catalogue data, not a document, and the canonical names the route
 * (not the selection) so a crawler is never told that two selections are one
 * page.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "catalog" });

  return {
    title: t("compare.metaTitle"),
    description: t("compare.metaDescription"),
    alternates: pageAlternates(safe, COMPARE_PATH),
    robots: { index: false, follow: true },
  };
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const appLocale = locale as AppLocale;
  const search = await searchParams;
  const selection = parseCompareSlugs(search.slugs);

  const t = await getTranslations({ locale, namespace: "catalog" });
  // Price words and the three badge words are the results page's (S12), reused
  // rather than re-written: one vocabulary for "this price is a placeholder".
  const tResult = await getTranslations({ locale, namespace: "result" });

  const outcomes = await Promise.all(
    selection.slugs.map((slug) => loadProductForCompareCached(slug)),
  );
  const products = outcomes.flatMap((outcome) =>
    outcome.kind === "ok" ? [outcome.product] : [],
  );
  const missing = outcomes.filter((outcome) => outcome.kind === "missing").length;
  const unavailable = outcomes.filter((outcome) => outcome.kind === "unavailable").length;

  const category = commonCategory(products);
  const mixed = products.length > 1 && category === null;

  /** A category as a word, never the contract's enum (the page's own rule). */
  const categoryLabel = (value: string): string => {
    const known = catalogCategory(value);
    return known === null ? t("categoryFallback") : t(`categories.${known}`);
  };

  // Candidates come from one page of the catalogue listing: the same category
  // once the selection has one, the whole first page when it is empty — which is
  // the only way into the view without a component page. A mixed category has no
  // sensible "add another", so the picker is withheld until one is removed.
  const candidates = mixed
    ? []
    : await catalogCandidates(
        products.length === 0 ? null : category,
        products.map((product) => product.slug),
      );

  const specCopy: SpecCopy & { unknown: string } = {
    labels: Object.fromEntries(SPEC_LABEL_KEYS.map((key) => [key, t(`specs.${key}`)])),
    units: { slots: t("specs.units.slots"), gb: t("specs.units.gb") },
    yes: t("specs.yes"),
    no: t("specs.no"),
    unknown: t("compare.unknown"),
  };
  const comparison =
    products.length > 1 && category !== null
      ? buildComparison(products, appLocale, specCopy)
      : null;

  const columns = products.map((product) => {
    const price = fromPrice(product);
    const provenance = catalogProvenance(product);
    return {
      slug: product.slug,
      name: product.display_name,
      priceText:
        price === null
          ? t("noPrice")
          : t("fromPrice", { amount: formatMoney(price, appLocale) }),
      provenance,
      provenanceLabel: tResult(PROVENANCE_MESSAGE_KEY[provenance]),
      removeHref: comparePath(locale, withoutSlug(selection.slugs, product.slug)),
    };
  });

  return (
    <section>
      <h1 className="mt-1 text-heading text-ink">{t("compare.title")}</h1>
      <p className="mt-2 text-compact text-muted">{t("compare.intro")}</p>

      <div className="mt-4 space-y-2">
        {selection.duplicates ? <Alert tone="warning">{t("compare.duplicates")}</Alert> : null}
        {selection.overflow ? <Alert tone="warning">{t("compare.overflow")}</Alert> : null}
        {missing > 0 ? <Alert tone="warning">{t("compare.missing")}</Alert> : null}
        {unavailable > 0 ? <Alert tone="warning">{t("compare.unavailable")}</Alert> : null}
        {mixed ? <Alert tone="warning">{t("compare.mixed")}</Alert> : null}
      </div>

      {products.length === 0 ? (
        <p className="mt-6 text-compact text-ink">{t("compare.empty")}</p>
      ) : (
        <>
          {/* The selection panel is where price, provenance and "Retirer" live:
              it exists in every non-empty state, including the two where no
              table can be drawn. */}
          <ul className="mt-6 divide-y divide-border rounded-card border border-border">
            {columns.map((column) => (
              <li key={column.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                {/* The name is DATA, but a `dir="auto"` on the BLOCK would take the
                    whole line with it: an LTR product name became a block aligned
                    away from the inline start. The block keeps the page's direction
                    (so `basis-full` stacks from the inline start) and the span
                    inside resolves the text's own order. */}
                <span className="min-w-0 basis-full text-compact text-ink sm:basis-auto sm:flex-1">
                  <span dir="auto" className="break-words">
                    {column.name}
                  </span>
                </span>
                <span className="num-tabular text-compact text-ink">{column.priceText}</span>
                <Badge tone={column.provenance}>{column.provenanceLabel}</Badge>
                <Link
                  href={column.removeHref}
                  className="text-compact text-primary underline-offset-4 hover:underline"
                >
                  {t("compare.remove")}
                  {/* Every "Retirer" link needs its OWN accessible name. */}
                  <span className="sr-only"> {column.name}</span>
                </Link>
              </li>
            ))}
          </ul>

          {comparison === null ? (
            products.length === 1 ? (
              <p className="mt-4 text-compact text-muted">{t("compare.oneHint")}</p>
            ) : null
          ) : (
            <>
              <p className="mt-4 text-compact text-ink">
                {t("compare.summary", {
                  same: comparison.summary.same,
                  different: comparison.summary.different,
                  total: comparison.summary.total,
                })}
              </p>
              <CompareTable
                columns={columns.map(({ slug, name }) => ({ slug, name }))}
                rows={comparison.rows}
                labels={{
                  caption: t("compare.caption", { count: products.length }),
                  specColumn: t("compare.specColumn"),
                  differs: t("compare.differs"),
                  unknown: t("compare.unknown"),
                }}
              />
            </>
          )}
        </>
      )}

      {candidates.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-subtitle text-ink">
            {products.length === 0 ? t("compare.catalogueTitle") : t("compare.addTitle")}
          </h2>
          {products.length >= MAX_COMPARE ? (
            <p className="mt-2 text-compact text-muted">{t("compare.full")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {candidates.map((candidate) => (
                <li
                  key={candidate.slug}
                  className="flex flex-wrap items-baseline justify-between gap-2"
                >
                  <Link
                    href={comparePath(locale, [
                      ...products.map((product) => product.slug),
                      candidate.slug,
                    ])}
                    className="text-compact text-primary underline-offset-4 hover:underline"
                  >
                    {t("compare.addItem", { name: candidate.display_name })}
                  </Link>
                  <span className="text-micro text-muted">
                    {categoryLabel(candidate.category)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}
