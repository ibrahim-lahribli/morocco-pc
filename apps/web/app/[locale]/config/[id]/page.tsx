import type { Metadata } from "next";
import { headers } from "next/headers";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Alert, LinkButton } from "@/components/ui";
import { BuildCard } from "@/components/result/build-card";
import { ShareBar } from "@/components/result/share-bar";
import { routing } from "@/i18n/routing";
import { formatMoney, formatNumber, type AppLocale } from "@/lib/i18n/format";
import { localePath } from "@/lib/i18n/paths";
import { orderBuilds, priceProvenance, zeroBuildAdvice } from "@/lib/result/model";
import { loadRecommendationCached } from "@/lib/result/load";
import { asVerifiedPricedBuild, jsonLdScript, productJsonLd } from "@/lib/result/structured-data";
import { absoluteResultUrl, originFromHeaders, waMeHref } from "@/lib/result/share";
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
 *     with a way back to the budget step, pre-filled from the pass. The
 *     `budget_floor` advice ("budget minimum conseillé") and its caveat are S14's
 *     `zeroBuildAdvice()` decision: the RECORDED number only, and guidance
 *     without a number where the floor could not be priced or was never
     *     computed.
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
  const { locale, id } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "result" });
  const appLocale: AppLocale = safe === "ar" ? "ar" : "fr";

  // The shared preview needs the pass's own facts (S15), so it reads the SAME
  // request-scoped loader the page body calls again: one API read per render,
  // and one canonical URL the og:url and every share button agree on.
  const outcome = await loadRecommendationCached(id);

  // The og:title says the REAL total with the badge's honesty word, per the
  // DoD — a preview advertising numbers it cannot answer is the V6 lie in
  // another room. No priced primary build, no number and no word (a missing
  // price must not read as 0, and a zero-build pass has none to vouch for).
  // One origin for BOTH decisions that need it: metadataBase (image route
  // resolution) must be the bare origin, not the long result URL — a base
  // with a path would resolve Next's relative image reference against the
  // result path and hollow the og:image out of its own segment.
  const origin = originFromHeaders(await headers());
  const url = absoluteResultUrl(origin, locale, id);
  const primary = outcome.kind === "ok" ? orderBuilds(outcome.recommendation.builds)[0] : undefined;
  const total =
    primary !== undefined && typeof primary.total_price === "number"
      ? primary.total_price
      : null;
  const budget =
    outcome.kind === "ok"
      ? outcome.recommendation.budget_amount ?? outcome.recommendation.budget_floor?.budget_amount ?? null
      : null;
  const word =
    primary !== undefined
      ? t("share.words." + priceProvenance(primary))
      : null;
  const ogTitle =
    total !== null && budget !== null && word !== null
      ? t("share.ogTitle", {
          total: formatMoney(total, appLocale),
          budget: formatMoney(budget, appLocale),
          word,
        })
      : t("share.ogTitlePlain");
  const ogDescription =
    outcome.kind === "ok" ? t("share.ogDescription") : t("errorBody");
  const robots = { index: false, follow: false };
  // S18: this page is noindex by design, and its canonical is the URL the
  // request named — the SAME origin the share bar and og:url use, because a
  // result is a per-request address, not a document with a configured home. No
  // `languages` set: a page that must not be indexed has no language cluster to
  // declare, and emitting one would advertise a URL the crawler may not keep.

  // `description` is set here so the layout's HOME intro cannot leak onto
  // a searched result page, and metadataBase is the ONE origin every
  // absolute preview URL resolves from (S15's own origin decision).
  return {
    metadataBase: new URL(origin),
    title: `morocco-pc — ${t("title")}`,
    description: ogDescription,
    robots,
    alternates: { canonical: url },
    openGraph: {
      siteName: "morocco-pc",
      type: "website",
      locale: appLocale === "ar" ? "ar_MA" : "fr_MA",
      alternateLocale: appLocale === "ar" ? "fr_MA" : "ar_MA",
      url,
      title: ogTitle,
      description: ogDescription,
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
    },
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

  const outcome = await loadRecommendationCached(id);
  if (outcome.kind === "missing") notFound();

  if (outcome.kind === "unavailable") {
    // Logged where it is actionable, never rendered: the user gets a sentence.
    console.error("result: could not load recommendation", id, outcome.cause);
    // The 429 keeps the numbers the API served (S14 scenario 4): Retry-After is
    // rendered as the countdown seconds, statically — a server component has no
    // client timer, and the honest fact is the moment the API named, not an
    // invented ticking one. No usable Retry-After, no number. 503 and every
    // other failure get the generic retry. Both render in the SAME Alert
    // primitive, and both ways out are links (keyboard reachable by nature).
    const body =
      outcome.status === 429
        ? outcome.retryAfterSeconds === null
          ? t("rateLimitedNoWait")
          : t("rateLimitedBody", { seconds: formatNumber(outcome.retryAfterSeconds, appLocale) })
        : t("errorBody");
    return (
      <section>
        <h1 className="text-heading text-ink">{t("errorTitle")}</h1>
        <div className="mt-4 max-w-prose">
          <Alert tone="error">{body}</Alert>
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
   * Which zero-build copy the floor leads to (S14). Decided by the model, so
   * the page can neither print the floor where none was priced nor repeat the
   * 0 that NULL must never become.
   */
  const advice = zeroBuildAdvice(recommendation.budget_floor);

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

  /**
   * The share surface (S15): one canonical URL for every channel, the
   * badge's OWN honesty word for the primary build, and every amount
   * formatted by the helper. A pass whose primary build carries no price
   * shares a numberless sentence — the payload cannot advertise what the
   * cards cannot answer.
   */
  const origin = originFromHeaders(await headers());
  const shareUrl = absoluteResultUrl(origin, locale, id);
  const primary = builds[0];
  const provenance = primary !== undefined ? priceProvenance(primary) : null;
  const primaryTotal =
    primary !== undefined && typeof primary.total_price === "number"
      ? primary.total_price
      : null;
  const totalLabel =
    primaryTotal !== null && budget !== null ? formatMoney(primaryTotal, appLocale) : null;
  const budgetLabel = budget !== null ? formatMoney(budget, appLocale) : null;
  const wordLabel = provenance !== null ? t("share.words." + provenance) : null;
  const priced = totalLabel !== null && budgetLabel !== null && wordLabel !== null;
  const shareText = priced
    ? t("share.text", { total: totalLabel as string, budget: budgetLabel as string, word: wordLabel as string })
    : t("share.textPlain");
  const waText = priced
    ? t("share.waText", {
        total: totalLabel as string,
        budget: budgetLabel as string,
        word: wordLabel as string,
        url: shareUrl,
      })
    : t("share.waTextPlain", { url: shareUrl });
  const whatsappHref = waMeHref(waText);

  /**
   * S19's structured data — the one place a price may become markup for a
   * crawler. Two gates are already decided above: the primary build's
   * provenance must be `verified` (not the API's `price_status`, which cannot
   * tell an all-seed pass from a half-quoted one), and the currency must be a
   * three-letter code. A malformed currency is a data bug, so the block is
   * skipped rather than teaching a crawler a currency this page does not mean.
   * `asVerifiedPricedBuild()` is the only way into the serializer, and it
   * throws on anything else — a demo price is unrepresentable, not merely
   * undisplayed.
   *
   * The name reuses the og:title's own sentence, so the card a chat app
   * unfurls and the block a crawler reads cannot advertise different amounts.
   */
  const currency = recommendation.currency;
  const structuredData =
    primary !== undefined &&
    provenance === "verified" &&
    currency !== null &&
    /^[A-Z]{3}$/.test(currency)
      ? productJsonLd(asVerifiedPricedBuild(primary), {
          name: priced
            ? t("share.ogTitle", {
                total: totalLabel as string,
                budget: budgetLabel as string,
                word: wordLabel as string,
              })
            : t("share.ogTitlePlain"),
          description: t("share.ogDescription"),
          currency,
        })
      : null;

  return (
    <section>
      {/* `jsonLdScript()` escapes `<`, so no localized string can close this
          element early. The payload is JSON, not HTML. */}
      {structuredData === null ? null : (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(structuredData) }}
        />
      )}
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
          {/* One Alert primitive for every zero-build voice (DoD): the priced
              floor shows its number and the lower-bound caveat, an unpriced
              floor talks instead of inventing one, and an absent floor is the
              generic "budget insuffisant". Only the priced floor repeats the
              general zero-body guidance after it. */}
          <div className="mt-3 max-w-prose">
            {advice.kind === "floor" ? (
              <Alert tone="warning">
                <p>{t("zeroFloorAdvice", { amount: formatMoney(advice.cheapestTotal, appLocale) })}</p>
                <p>{t("zeroFloorCaveat")}</p>
              </Alert>
            ) : advice.kind === "unknown-floor" ? (
              <Alert tone="warning">{t("zeroNoFloorGuidance")}</Alert>
            ) : (
              <Alert tone="warning">{t("zeroNoAdvice")}</Alert>
            )}
          </div>
          {advice.kind === "floor" ? (
            <p className="mt-3 max-w-prose text-body text-ink">{t("zeroBody")}</p>
          ) : null}
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

      {builds.length > 0 ? (
        <div className="mt-6">
          <ShareBar
            shareUrl={shareUrl}
            whatsappHref={whatsappHref}
            shareText={shareText}
            labels={{
              label: t("share.group"),
              whatsapp: t("share.whatsapp"),
              copy: t("share.copy"),
              share: t("share.native"),
              copied: t("share.copied"),
            }}
          />
        </div>
      ) : null}

      <p className="mt-4 text-micro text-muted">{recommendation.disclaimer}</p>

      <div className="mt-6">
        <LinkButton href={wizardAt("usage")} variant="secondary">
          {t("back")}
        </LinkButton>
      </div>
    </section>
  );
}
