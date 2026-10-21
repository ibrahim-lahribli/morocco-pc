import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Alert, LinkButton } from "@/components/ui";
import { BuildCard } from "@/components/result/build-card";
import { routing } from "@/i18n/routing";
import { formatMoney, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { orderBuilds } from "@/lib/result/model";
import { loadRecommendation } from "@/lib/result/load";
import { toHref, type Answers } from "@/lib/wizard/model";

/**
 * `/fr/config/[id]` — the results page (S11).
 *
 * The page is a SERVER component that fetches `GET /v1/recommendations/:id` and
 * renders the persisted pass. Three consequences, all intended:
 *
 *   - **It is DYNAMIC.** The id is data, so there is nothing to prerender, and
 *     the fetch is `cache: "no-store"` (`getRecommendationForServer`): a result
 *     id is a durable reference, and a stale copy of someone's build is worse
 *     than a slower page.
 *   - **Nothing reaches the browser but HTML.** No client fetch, no hydrated
 *     list, no skeleton that waits for a second request — the builds are in the
 *     first byte. S15's share previews depend on that, and so does a slow phone.
 *   - **`noindex`, permanently.** A result id names one person's query. A search
 *     result pointing at it would be a data leak dressed as a page (S18 keeps
 *     this when it adds the crawl surface).
 *
 * What the page decides, and what it delegates:
 *
 *   - `builds[]` is 1..N (V13), so this maps the array and never pads it. Rank
 *     order comes from `orderBuilds()` rather than from the response's own
 *     ordering, because "the first card" must mean rank 1.
 *   - a zero-build pass is a RESULT, not an error (V2): it renders its own state
 *     with a way back to the budget step, pre-filled from the pass. S14 owns the
 *     `budget_floor` advice ("budget minimum conseillé") and its caveat; this
 *     page deliberately does not invent that number.
 *   - a total past the budget is drawn as over (the bar's `over` tone plus an
 *     alert), never as a full-but-fine bar.
 *   - a price is two facts (V6), and this page shows both: each card carries the
 *     `démo | indicatif | vérifié` badge (S12) derived from `price_status` AND
 *     the components' `offer_class`, while the response's own `disclaimer` is
 *     printed once at the foot. The badge dates the CALCULATION (`generated_at`)
 *     and only for `verified`; the contract has no per-offer observed date, so
 *     nothing here claims a shop surveyed that price on that day (CD-6).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "result" });
  return {
    title: `morocco-pc — ${t("title")}`,
    robots: { index: false, follow: false },
  };
}

export default async function ConfigPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale, namespace: "result" });

  const outcome = await loadRecommendation(id);
  if (outcome.kind === "missing") notFound();

  if (outcome.kind === "unavailable") {
    // Logged where it is actionable, never rendered: the user gets a sentence.
    console.error("result: could not load recommendation", id, outcome.cause);
    return (
      <section>
        <h1 className="text-heading text-ink">{t("errorTitle")}</h1>
        <div className="mt-4 max-w-prose">
          <Alert tone="error">{t("errorBody")}</Alert>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {/* A retry must re-run this render, so it is a document navigation
              (`reload`), not a router push to the URL already in the bar. */}
          <LinkButton
            reload
            href={localePath(locale, `/config/${encodeURIComponent(id)}`)}
            variant="secondary"
          >
            {t("errorRetry")}
          </LinkButton>
          <LinkButton href={localePath(locale, "/configurer")} variant="ghost">
            {t("back")}
          </LinkButton>
        </div>
      </section>
    );
  }

  const recommendation = outcome.recommendation;
  const builds = orderBuilds(recommendation.builds);

  /**
   * The budget the bar is measured against. `budget_amount` is the query's own
   * number; the floor repeats it (`computeBudgetFloor` copies it in) and is the
   * fallback for a pass whose column is NULL. NULL here means "not recorded",
   * and a bar is simply not drawn — never a 0 denominator.
   */
  const budget = recommendation.budget_amount ?? recommendation.budget_floor?.budget_amount ?? null;

  /** The answers this pass was made with, so a way back does not lose them. */
  const answers: Answers = {
    use_case: recommendation.use_case ?? undefined,
    budget_amount: recommendation.budget_amount ?? undefined,
  };
  const wizardAt = (step: "usage" | "budget") =>
    toHref(localePath(locale, "/configurer"), { step, answers });

  return (
    <section>
      <header>
        <h1 className="text-heading text-ink">{t("title")}</h1>
        {budget === null ? null : (
          <p className="mt-2 max-w-prose text-body text-muted">
            {t("intro", { budget: formatMoney(budget, appLocale) })}
          </p>
        )}
      </header>

      {builds.length === 0 ? (
        <div className="mt-6 rounded-card border border-border bg-subtle p-4">
          <h2 className="text-subtitle text-ink">{t("zeroTitle")}</h2>
          <p className="mt-2 max-w-prose text-body text-ink">{t("zeroBody")}</p>
          <div className="mt-4">
            <LinkButton href={wizardAt("budget")}>{t("zeroBack")}</LinkButton>
          </div>
        </div>
      ) : (
        <ol className="mt-6 space-y-4">
          {builds.map((build, index) => (
            <li key={`${build.rank}:${index}`}>
              <BuildCard
                build={build}
                budget={budget}
                generatedAt={recommendation.generated_at}
                position={index + 1}
                primary={index === 0}
                locale={appLocale}
              />
            </li>
          ))}
        </ol>
      )}

      <p className="mt-4 text-micro text-muted">{recommendation.disclaimer}</p>

      <div className="mt-6">
        <LinkButton href={wizardAt("usage")} variant="secondary">
          {t("back")}
        </LinkButton>
      </div>
    </section>
  );
}
