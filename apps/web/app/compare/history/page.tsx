import React from "react"
import type { PageProps } from "next"
import { notFound } from "next/navigation"
import { status } from "@/lib/i18n/status"
import { Heading, Heading2, Alert, LinkButton } from "@/components/ui"
import { formatClearance } from "@/lib/i18n/format"
import { priceHistoryPath } from "@/lib/catalog/compare"
import { readRecommendationStatus } from "@/lib/result/status"
import { asciiSlug } from "@/lib/i18n/ascii"

export default async function CompareHistoryPage({ params }: PageProps<{ locale: string; slug: string }>) {
  const resolved = await params.locale
  if (!["fr", "ar"].includes(resolved)) return notFound()
  const active = resolved

  const segments = params.__route_segments
  const segment = segments?.at(-1)
  const canonicalSlug = segment?.toLowerCase()
  if (!canonicalSlug || canonicalSlug.includes("/")) return notFound()

  const entries = parseUrlCandidates(canonicalSlug)
  if (entries.length === 0) return notFound()

  const results = await readRecommendationStatus(active, entries)

  return (
    <>
      <Head canonical={canonical(active, ["compare", "history", canonicalSlug])} metaDescription={status.metaDescription(active).slice(0, 155)} />
      <Heading2 type="compareHistory"><StatusInfo items={renderStatusLines(results)} /></Heading2>
      <Alert type="compareHistory">{status.t("compare:emptyState")}</Alert>
      <LinkButton href={priceHistoryPath(active, [canonicalSlug])}>
        {status.t("compare:toolsPageLink")}
      </LinkButton>
    </>
  )
}

export async function generateStaticParams() {
  return [{ locale: "fr", slug: "comparer" }, { locale: "ar", slug: "comparer" }]
}
