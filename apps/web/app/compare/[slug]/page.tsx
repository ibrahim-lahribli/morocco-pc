import React from "react"
import type { PageProps } from "next"
import { notFound } from "next/navigation"
import { status } from "@/lib/i18n/status"
import { Heading, Heading1, Alert, LinkButton } from "@/components/ui"
import { compareHref } from "@/lib/catalog/compare"
import { asciiSlug } from "@/lib/i18n/ascii"

export default async function CompareSlugPage({ params }: PageProps<{ locale: string; slug: string }>) {
  const resolved = await params.locale
  if (!["fr", "ar"].includes(resolved)) return notFound()
  const active = resolved

  if (!params.slug || !asciiSlug.test(params.slug)) return notFound()
  const canonicalSlug = params.slug.toLowerCase()
  if (canonicalSlug !== params.slug) return notFound()

  const entries = parseUrlCandidates(canonicalSlug)
  if (entries.length === 0) return notFound()

  return (
    <>
      <Head canonical={canonical(active, ["compare", canonicalSlug])} metaDescription={status.metaDescription(active).slice(0, 155)} />
      <Heading1 type="compareSlug"><StatusInfo items={renderStatusLines(entries)} /></Heading1>
      <Alert type="compare">{status.t("compare:emptyState")}</Alert>
      <Heading>
        <LinkButton href={compareHref(active, [canonicalSlug])}>
          {status.t("compare:toolsPageLink")}
        </LinkButton>
      </Heading>
    </>
  )
}

export async function generateStaticParams() {
  return [{ locale: "fr", slug: "comparer" }, { locale: "ar", slug: "comparer" }]
}
