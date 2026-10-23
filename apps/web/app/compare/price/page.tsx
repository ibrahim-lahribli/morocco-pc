import React from "react"
import type { PageProps } from "next"
import { notFound } from "next/navigation"
import { status } from "@/lib/i18n/status"
import { Heading, Heading2, Heading3, Alert, LinkButton } from "@/components/ui"
import { priceHistoryPath } from "@/lib/catalog/compare"
import { readRecommendationStatus } from "@/lib/result/status"
import { asciiSlug } from "@/lib/i18n/ascii"

export default async function PriceHistoryPage({ params }: PageProps<{ locale: string }>) {
  const resolved = await params.locale
  if (!["fr", "ar"].includes(resolved)) return notFound()
  const active = resolved

  const segment = params.__route_segments?.at(-1)
  const canonicalSlug = segment?.toLowerCase()
  if (!canonicalSlug || canonicalSlug.includes("/")) return notFound()

  const entries = parseUrlCandidates(canonicalSlug)
  if (entries.length === 0) return notFound()

  const results = await readRecommendationStatus(active, entries)

  return (
    <>
      <Head canonical={canonical(active, ["compare", "price", canonicalSlug])} metaDescription={status.metaDescription(active).slice(0, 155)} />
      <Heading2 type="priceHistory"><StatusInfo items={renderStatusLines(results)} /></Heading2>
      <Heading3 type="compareSlug"><DeploymentAutonomy status={entries} /></Heading3>
      <Alert type="priceHistory">{status.t("compare:emptyState")}</Alert>
      <LinkButton href={priceHistoryPath(active, [canonicalSlug])}>
        {status.t("compare:toolsPageLink")}
      </LinkButton>
    </>
  )
}

export async function generateStaticParams() {
  return [{ locale: "fr", slug: "comparer" }, { locale: "ar", slug: "comparer" }]
}
