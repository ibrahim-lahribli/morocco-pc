import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { StepOnePlaceholder } from "@/components/configurator/step-one-placeholder";
import { StepTwoPlaceholder } from "@/components/configurator/step-two-placeholder";
import { routing } from "@/i18n/routing";
import { parseConfiguratorSearchParams } from "@/lib/configurator/schema";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "Configurator.metadata" });

  return {
    title: `${t("title")} — morocco-pc`,
    description: t("description"),
  };
}

/**
 * The configurator route — one page, two steps.
 *
 * The server resolves which step renders from the URL alone, so the choice is
 * stateless per request and a refresh always lands back on the same step:
 *
 * - `step=2` renders Step 2 only with a complete, valid handoff
 *   (`use_case` + `budget`); otherwise the page renders Step 1 content while
 *   keeping the URL the visitor arrived with — nothing is rewritten.
 * - A missing or invalid `step` renders Step 1.
 *
 * The page is dynamic by definition (it reads `searchParams`); the
 * placeholders fetch no data and fire no API request.
 */
export default async function ConfiguratorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const seed = parseConfiguratorSearchParams(await searchParams);

  return seed.step === 2 ? <StepTwoPlaceholder /> : <StepOnePlaceholder />;
}
