import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BuildCard } from "@/components/result/build-card";
import { LinkButton } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { formatDate, formatMoney, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { loadPresetCached, presetsForBuild } from "@/lib/presets/load";
import { parsePresetSlug, presetIndexable } from "@/lib/presets/model";
import { pageAlternates } from "@/lib/seo/site";
import { orderBuilds } from "@/lib/result/model";
import { asVerifiedPricedBuild, jsonLdScript, productJsonLd } from "@/lib/result/structured-data";
import { toHref, type Answers } from "@/lib/wizard/model";

/**
 * `/fr/config-pc-gamer-{budget}-dh` — the SEO preset page (S16).
 *
 * The route segment is GENERIC (`[presetSlug]`) on purpose. Next has no partial
 * dynamic segment, and splitting the URL into `config-pc-gamer/9000/dh` would
 * change the address the DoD pins, so the whole slug is one parameter and
 * `parsePresetSlug()` decides whether it names a page. Anything it refuses is a
 * 404 — which also means a single-segment typo inside a locale never reaches the
 * catch-all, but lands on the same styled 404 through this page's `notFound()`.
 * Static siblings (`/configurer`, `/config/…`, `/kit`, …) still win: a concrete
 * segment always outranks a dynamic one.
 *
 * Three properties the sprint asks for, and how they are achieved:
 *
 *   - **Generated at build/ISR time, zero client fetch.** The page is a server
 *     component whose only data source is `loadPresetCached`, so the builds are in
 *     the first byte of HTML. `generateStaticParams` lists the committed fixtures
 *     (plus a configured API's ribbon), and `revalidate` below makes the result a
 *     cached page that refreshes in the background rather than a static snapshot
 *     that never changes. `dynamicParams` stays at its default `true`: a budget the
 *     ribbon gains AFTER this build is rendered on first request and then cached,
 *     which is the whole point of ISR here.
 *   - **It reuses the results page.** Each build is S11's `BuildCard` — the same
 *     card, badge, budget bar and component list. There is no second card
 *     implementation, and no second answer to "what does a build look like".
 *   - **noindex until the prices are real.** `presetIndexable()` allows an index
 *     only for an API-served page whose every build is `verified`; a fixture page
 *     is a demonstration and stays out of the index (W3).
 *
 * `revalidate` must be a LITERAL for Next to statically analyze it; it is the same
 * number as `PRESET_REVALIDATE_SECONDS` in `lib/presets/model.ts` (the fetch
 * cache lifetime). `e2e/preset.spec.ts` pins the resulting `s-maxage`, so the two
 * drifting apart is a red test instead of a page that silently never refreshes.
 */
export const revalidate = 3600;

/**
 * The pages a cold build can produce: the committed fixtures, plus the API's
 * ribbon only when an API base is explicitly configured (see `load.ts`).
 */
export async function generateStaticParams() {
  const presets = await presetsForBuild();
  return routing.locales.flatMap((locale) =>
    presets.map((preset) => ({ locale, presetSlug: preset.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; presetSlug: string }>;
}): Promise<Metadata> {
  const { locale, presetSlug } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const appLocale: AppLocale = safe === "ar" ? "ar" : "fr";
  const t = await getTranslations({ locale: safe, namespace: "presets" });

  // The same request-scoped read the page body makes: one API call per render.
  const outcome = await loadPresetCached(presetSlug);
  if (outcome.kind === "missing") {
    // The page is about to call notFound(); a 404 is noindex by nature, and
    // nothing here may promise a budget the build could not produce.
    return { robots: { index: false, follow: false } };
  }

  const page = outcome.page;
  const budget = formatMoney(page.budget, appLocale);
  return {
    title: t("title", { budget }),
    description: t("description", { budget }),
    // S18: self-referencing, with `fr` + `x-default` (V9; the `ar` alternate is
    // S20's, once every advertised URL exists in both locales).
    alternates: pageAlternates(safe, `/${presetSlug}`),
    robots: {
      index: presetIndexable(page.source, orderBuilds(page.recommendation.builds)),
      // While noindexed, the links out of this page are still worth following:
      // the family becomes indexable as a whole once the prices are real.
      follow: true,
    },
  };
}

export default async function PresetPage({
  params,
}: {
  params: Promise<{ locale: string; presetSlug: string }>;
}) {
  const { locale, presetSlug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const appLocale = locale as AppLocale;
  if (parsePresetSlug(presetSlug) === null) notFound();

  const outcome = await loadPresetCached(presetSlug);
  if (outcome.kind === "missing") notFound();

  const { page } = outcome;
  const t = await getTranslations({ locale, namespace: "presets" });
  const builds = orderBuilds(page.recommendation.builds);
  const budgetLabel = formatMoney(page.budget, appLocale);

  /**
   * S19's gate, on the page type that can actually rank.
   *
   * The predicate is `presetIndexable()` — the SAME one `generateMetadata`
   * hands to `robots` — so a page can never be readable by a crawler while its
   * price is unmarked, or marked up while it is noindexed. It is the conjunction
   * of "served by the API" and "every build verified"; a fixture page is a
   * demonstration and stays both out of the index and out of structured data.
   *
   * Two guards sit on top of the predicate, both taken from the results page
   * (S19) for the same reasons: a verified build with no recorded total must not
   * reach `asVerifiedPricedBuild()` (which throws — a crash is worse than no
   * markup), and a currency that is not a three-letter code is a data bug rather
   * than something to teach a crawler. The build itself still renders either way;
   * the gate is about the CLAIM.
   */
  const indexable = presetIndexable(page.source, builds);
  const primary = builds[0];
  const currency = page.recommendation.currency ?? page.family.currency;
  const structuredData =
    indexable &&
    primary !== undefined &&
    typeof primary.total_price === "number" &&
    Number.isFinite(primary.total_price) &&
    /^[A-Z]{3}$/.test(currency)
      ? productJsonLd(asVerifiedPricedBuild(primary), {
          // The page's own title sentence, so the crawled block and the h1 can
          // never advertise different budgets.
          name: t("title", { budget: budgetLabel }),
          description: t("description", { budget: budgetLabel }),
          currency,
        })
      : null;

  /**
   * The way forward is the wizard, pre-filled with this page's own answers, so a
   * reader can adjust the budget they arrived with instead of starting over. The
   * budget we pre-fill is the SLUG's — the number the page promised in its title
   * and its bar — never a pass's recorded budget that happened to differ.
   */
  const answers: Answers = { use_case: page.family.useCase, budget_amount: page.budget };
  const wizardHref = toHref(localePath(locale, "/configurer"), { step: "budget", answers });
  const resultHref = localePath(locale, `/config/${encodeURIComponent(page.recommendation.id)}`);
  const computedAt = page.recommendation.generated_at;

  return (
    <section>
      {/* `jsonLdScript()` escapes `<`, so no localized string can close the
          element early; the payload is JSON, not HTML (S19). */}
      {structuredData === null ? null : (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(structuredData) }}
        />
      )}
      <h1 className="text-heading text-ink">{t("title", { budget: budgetLabel })}</h1>
      <p className="mt-2 max-w-prose text-body text-muted">
        {t("intro", { budget: budgetLabel })}
      </p>

      <ol className="mt-6 space-y-4">
        {builds.map((build, index) => (
          <li key={`${build.rank}:${index}`}>
            <BuildCard
              build={build}
              budget={page.budget}
              generatedAt={computedAt}
              position={index + 1}
              primary={index === 0}
              locale={appLocale}
            />
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap gap-3">
        <LinkButton href={wizardHref}>{t("cta")}</LinkButton>
        <LinkButton href={resultHref} variant="secondary">
          {t("viewPass")}
        </LinkButton>
      </div>

      {/* The pass's own honesty line, exactly as the results page prints it;
          the per-card badge above is the per-price fact (V6). */}
      <p className="mt-4 text-micro text-muted">{page.recommendation.disclaimer}</p>
      {computedAt === null ? null : (
        <p className="mt-1 text-micro text-muted">
          {t("computedAt", { date: formatDate(computedAt, appLocale) })}
        </p>
      )}
    </section>
  );
}
