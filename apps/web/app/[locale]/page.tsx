import type { Metadata } from "next";
import Link from "next/link";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Badge, LinkButton } from "@/components/ui";
import { BuildCard } from "@/components/result/build-card";
import { routing } from "@/i18n/routing";
import { formatDate, formatMoney, formatNumber, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { pageAlternates } from "@/lib/seo/site";
import { loadPresetCached, presetsForBuild } from "@/lib/presets/load";
import { orderBuilds, priceProvenance, type Build, type PriceProvenance } from "@/lib/result/model";

/**
 * The home page: before this change it was a bare CTA, and its whole viewport
 * was dead space. Now it is the shop window the rest of the site already
 * deserves, from data that ALREADY exists — no new API surface, no new kit:
 *
 * - **Trust strip** — the price-provenance vocabulary the cards and preset
 *   pages already carry, named once where a first-time visitor decides whether
 *   to stay. The three badges are the SAME states, so the strip cannot invent
 *   a fourth by re-wording one.
 * - **Preset shortcut cards** — the ribbon pages S16 generates. The data comes
 *   from `presetsForBuild()` + `loadPresetCached()`, the SAME request-memoized
 *   loader and revalidation window the preset pages use, so a home card can
 *   never promise a budget the preset page itself cannot serve. A ribbon entry
 *   whose pass cannot be read right now is skipped, not rendered as an empty
 *   card: the preset page itself would answer 404, and a broken link with
 *   nicer styling is worse than a shorter list.
 * - **Example build teaser** — the cheapest preset's rank-1 build, rendered by
 *   the SAME `BuildCard` the preset page reuses (the standing "reuse the
 *   results card, not a second implementation" rule), so a visitor sees a real
 *   compatibility-vetted build — badge, bar and explanation included — before
 *   touching the wizard.
 *
 * Two rules carry over unchanged: navigation is a LINK, and no sentence a
 * translator would need lives in a component — `check:i18n`'s locale-parity
 * gate reads the new keys in both catalogues.
 */
/**
 * S18: the canonical is `/fr` (or `/ar`), self-referencing, with `fr` +
 * `x-default` hreflang. The title and description stay the layout's — Next
 * merges a page's metadata over its layout's, so this adds the crawl surface
 * without restating copy that already lives in one place.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  return { alternates: pageAlternates(safe, "/") };
}

/** One preset shortcut card's display facts: what this page can promise. */
interface PresetCard {
  slug: string;
  budget: number;
  buildCount: number;
  provenance: PriceProvenance;
  /** The cheapest build's total, or null when the pass did not record one. */
  cheapestTotal: number | null;
}

/**
 * The whole page's data, in one walk. Every read goes through
 * `loadPresetCached()`, so a visitor costs ONE API read per budget even when
 * the card list and the teaser want the same pass — the same memoization the
 * preset pages rely on.
 */
async function readPages() {
  const pages = await presetsForBuild();
  const cards: PresetCard[] = [];
  /** The FIRST renderable page's primary build — `pages` is budget-sorted. */
  let example: {
    id: string;
    budget: number;
    generatedAt: string | null;
    build: Build;
  } | null = null;

  for (const entry of pages) {
    const outcome = await loadPresetCached(entry.slug);
    if (outcome.kind !== "ok") continue;
    const builds = orderBuilds(outcome.page.recommendation.builds);
    const primary = builds[0];
    if (primary === undefined) continue;
    cards.push({
      slug: entry.slug,
      budget: entry.budget,
      buildCount: builds.length,
      provenance: priceProvenance(primary),
      cheapestTotal: typeof primary.total_price === "number" ? primary.total_price : null,
    });
    if (example === null) {
      example = {
        id: outcome.page.recommendation.id,
        budget: outcome.page.budget,
        generatedAt: outcome.page.recommendation.generated_at,
        build: primary,
      };
    }
  }

  return { cards, example };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale, namespace: "home" });
  // The badge words are the RESULT's vocabulary, read from the same namespace
  // the cards print them from — the strip re-states them, never re-words them.
  const tResult = await getTranslations({ locale, namespace: "result" });

  const { cards, example } = await readPages();

  return (
    <section>
      <h1 className="text-2xl font-semibold text-balance">{t("title")}</h1>
      <p className="mt-4 max-w-prose">{t("intro")}</p>
      <div className="mt-6">
        <LinkButton href={localePath(locale, "/configurer")}>{t("cta")}</LinkButton>
      </div>

      {/* The trust strip: the engine's actual guarantees, in words a shopper
          reads before any number. */}
      <section aria-labelledby="home-trust" className="mt-10">
        <h2 id="home-trust" className="text-title font-semibold text-ink">
          {t("trustTitle")}
        </h2>
        <ul className="mt-4 space-y-3">
          <li className="text-body text-muted">{t("trustCompatibility")}</li>
          <li className="text-body text-muted">
            {t("trustProvenance")}
            <span className="mt-2 flex flex-wrap gap-2">
              <Badge tone="verified">{tResult("provenance.verified")}</Badge>
              <Badge tone="indicative">{tResult("provenance.indicative")}</Badge>
              <Badge tone="demo">{tResult("provenance.demo")}</Badge>
            </span>
          </li>
          <li className="text-body text-muted">{t("trustNoAccount")}</li>
        </ul>
      </section>

      {/* Preset shortcuts, cheapest first. The whole card is one link, so the
          touch and keyboard target is one; the visible CTA line is the label
          each card repeats for itself. */}
      {cards.length > 0 ? (
        <section aria-labelledby="home-presets" className="mt-10">
          <h2 id="home-presets" className="text-title font-semibold text-ink">
            {t("presetsTitle")}
          </h2>
          <p className="mt-2 max-w-prose text-body text-muted">{t("presetsIntro")}</p>
          <ul className="mt-4 space-y-3">
            {cards.map((card) => (
              <li key={card.slug}>
                <Link
                  href={localePath(locale, `/${card.slug}`)}
                  className="block rounded-control border border-border bg-surface p-4 hover:border-primary/60"
                >
                  <h3 className="num-tabular text-body font-semibold text-ink">
                    {formatMoney(card.budget, appLocale)}
                  </h3>
                  <p className="num-tabular mt-1 text-caption text-muted">
                    {t("presetBuilds", { count: formatNumber(card.buildCount, appLocale) })}
                  </p>
                  {card.cheapestTotal === null ? null : (
                    <p className="num-tabular mt-1 text-caption text-muted">
                      {formatMoney(card.cheapestTotal, appLocale)}
                    </p>
                  )}
                  <p className="mt-2 flex flex-wrap items-center gap-2">
                    {/* One key per state, resolved explicitly: a template
                        literal key would hide the lookup from the catalogue
                        check and risk a runtime MISSING_MESSAGE on `/ar`. */}
                    <Badge tone={card.provenance}>
                      {card.provenance === "verified"
                        ? tResult("provenance.verified")
                        : card.provenance === "indicative"
                          ? tResult("provenance.indicative")
                          : tResult("provenance.demo")}
                    </Badge>
                    <span className="text-caption text-primary">{t("presetCta")}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* The example build: one REAL vetted build rendered by the results card
          itself, and always the cheapest page's build — the one a first-visit
          sceptic can afford to check. */}
      {example === null ? null : (
        <section aria-labelledby="home-example" className="mt-10">
          <h2 id="home-example" className="text-title font-semibold text-ink">
            {t("exampleEyebrow")}
          </h2>
          <p className="mt-2 max-w-prose text-body text-muted">
            {t("exampleIntro", { budget: formatMoney(example.budget, appLocale) })}
          </p>
          <div className="mt-2">
            <BuildCard
              build={example.build}
              resultId={example.id}
              budget={example.budget}
              generatedAt={example.generatedAt}
              position={1}
              primary={false}
              locale={appLocale}
            />
          </div>
          {example.generatedAt === null ? null : (
            <p className="mt-2 text-micro text-muted">
              {formatDate(example.generatedAt, appLocale)}
            </p>
          )}
        </section>
      )}
    </section>
  );
}
