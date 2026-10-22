import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { pageAlternates } from "@/lib/seo/site";
import type { AppLocale } from "@/lib/i18n/format";
import type { WizardCopy } from "@/lib/wizard/copy";
import { Wizard } from "./wizard";

/**
 * `/fr/configurer` — the wizard (S7).
 *
 * The route is STATIC: it reads `params` (a build-time fact) and nothing from
 * the request. The step and the answers live in the query string, which the
 * client component reads with `useSearchParams`; that hook needs a Suspense
 * boundary during prerender, so the static HTML is the skeleton below and the
 * wizard takes over on hydration. The alternative — reading `searchParams` on
 * the server — would make the page dynamic and every step a server round trip,
 * for a screen whose whole value is instant.
 *
 * The name is `configurer`, not `config`, because S11 owns `/fr/config/[id]` for
 * a committed result; keeping the wizard's URL distinct means no route is both
 * "the form" and "the parent of a result".
 *
 * Copy is read here, on the server, and handed to the client as one plain
 * object: no message catalogue reaches the browser (see `lib/wizard/copy.ts`).
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "wizard" });
  return {
    title: `morocco-pc — ${t("title")}`,
    description: t("intro"),
    // S18: a step is a query string on this one URL, so every step's canonical
    // is the wizard itself — without this the four steps compete as four pages.
    alternates: pageAlternates(safe, "/configurer"),
  };
}

function Fallback() {
  return (
    <div className="mt-6 space-y-3">
      <Skeleton className="h-4 w-28 rounded" />
      <Skeleton className="h-control w-full rounded-card" />
      <Skeleton className="h-control w-full rounded-card" />
      <Skeleton className="h-control w-full rounded-card" />
    </div>
  );
}

export default async function ConfigurerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "wizard" });
  const copy: WizardCopy = {
    title: t("title"),
    intro: t("intro"),
    progress: t("progress"),
    next: t("next"),
    back: t("back"),
    finish: t("finish"),
    loading: t("loading"),
    optionsError: t("optionsError"),
    retry: t("retry"),
    budgetLabel: t("budgetLabel"),
    budgetSuffix: t("budgetSuffix"),
    budgetHint: t("budgetHint"),
    budgetError: t("budgetError"),
    budgetSliderLabel: t("budgetSliderLabel"),
    budgetSnapNote: t("budgetSnapNote"),
    budgetClampMin: t("budgetClampMin"),
    budgetClampMax: t("budgetClampMax"),
    storedNotApplied: t("storedNotApplied"),
    submitAnnouncement: t("submitAnnouncement"),
    submitProgressLabel: t("submitProgressLabel"),
    submitProgressValueText: t("submitProgressValueText"),
    submitElapsed: t("submitElapsed"),
    errorTooLarge: t("errorTooLarge"),
    errorRateLimited: t("errorRateLimited"),
    errorRateLimitedNoWait: t("errorRateLimitedNoWait"),
    errorUnavailable: t("errorUnavailable"),
    errorServer: t("errorServer"),
    errorRequestId: t("errorRequestId"),
    errorFieldUnknown: t("errorFieldUnknown"),
    // One raw read, because the numbers are data: a catalogue that grows a
    // field must not need a code change, and an unknown one falls back in the
    // component.
    fieldErrors: t.raw("fieldErrors") as Record<string, string>,
    steps: {
      usage: { label: t("steps.usage.label"), legend: t("steps.usage.legend") },
      budget: { label: t("steps.budget.label"), legend: t("steps.budget.legend") },
      resolution: {
        label: t("steps.resolution.label"),
        legend: t("steps.resolution.legend"),
      },
      priority: { label: t("steps.priority.label"), legend: t("steps.priority.legend") },
    },
  };

  return (
    <section>
      <h1 className="text-heading text-ink">{copy.title}</h1>
      <p className="mt-3 max-w-prose text-body text-muted">{copy.intro}</p>
      <Suspense fallback={<Fallback />}>
        <Wizard copy={copy} locale={locale as AppLocale} />
      </Suspense>
    </section>
  );
}
