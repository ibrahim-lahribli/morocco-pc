import type { Metadata } from "next";
import { Check, Clock, Cpu, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { BuildCardPreview } from "@/components/demo/build-card-preview";
import { BudgetPicker } from "@/components/demo/budget-picker";
import { SearchDemo } from "@/components/demo/search-demo";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  TextField,
  type BadgeTone,
} from "@/components/ui";
import { routing } from "@/i18n/routing";
import { formatPrice } from "@/lib/format/price";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "Metadata" });

  return {
    title: `${t("title")} — morocco-pc`,
    description: t("description"),
  };
}

/** A titled demo section sharing the page's rhythm and anchor offsets. */
function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2 id={`${id}-title`} className="text-headline-md text-foreground lg:text-headline-lg">
        {title}
      </h2>
      <p className="mt-1.5 max-w-prose text-body-md text-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function FoundationPreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "Home" });
  const tPrice = await getTranslations({ locale, namespace: "Price" });
  const currency = tPrice("currency");

  const statuses: readonly { tone: BadgeTone; label: string; text: string }[] = [
    { tone: "verified", label: t("status.verified"), text: t("status.verifiedText") },
    { tone: "indicative", label: t("status.indicative"), text: t("status.indicativeText") },
    { tone: "estimated", label: t("status.estimated"), text: t("status.estimatedText") },
  ];

  const palette = [
    { label: t("tokens.labels.primary"), hex: "#3730A3", swatch: "bg-primary" },
    { label: t("tokens.labels.primaryDeep"), hex: "#1F108E", swatch: "bg-primary-deep" },
    { label: t("tokens.labels.accent"), hex: "#F59E0B", swatch: "bg-accent" },
    { label: t("tokens.labels.background"), hex: "#F8F9FF", swatch: "bg-background" },
    { label: t("tokens.labels.surface"), hex: "#FFFFFF", swatch: "bg-surface" },
    { label: t("tokens.labels.verified"), hex: "#ECFDF5", swatch: "bg-verified-soft" },
    { label: t("tokens.labels.indicative"), hex: "#FFFBEB", swatch: "bg-indicative-soft" },
    { label: t("tokens.labels.text"), hex: "#0B1C30", swatch: "bg-foreground" },
    { label: t("tokens.labels.muted"), hex: "#464553", swatch: "bg-muted" },
  ] as const;

  const typeScale = [
    { name: "display-lg", className: "text-display-lg" },
    { name: "headline-lg", className: "text-headline-lg" },
    { name: "headline-md", className: "text-headline-md" },
    { name: "headline-sm", className: "text-headline-sm" },
    { name: "body-lg", className: "text-body-lg" },
    { name: "body-md", className: "text-body-md" },
    { name: "label-md", className: "text-label-md" },
  ] as const;

  const radii = [
    { label: t("tokens.radiusLabels.control"), className: "rounded-control" },
    { label: t("tokens.radiusLabels.field"), className: "rounded-field" },
    { label: t("tokens.radiusLabels.card"), className: "rounded-card" },
    { label: t("tokens.radiusLabels.sheet"), className: "rounded-sheet" },
    { label: t("tokens.radiusLabels.pill"), className: "rounded-pill" },
  ] as const;

  const spacing = [
    { name: "xs", className: "w-space-xs" },
    { name: "sm", className: "w-space-sm" },
    { name: "md", className: "w-space-md" },
    { name: "lg", className: "w-space-lg" },
    { name: "xl", className: "w-space-xl" },
  ] as const;

  return (
    <div className="flex flex-col gap-12 pt-8 lg:gap-16 lg:pt-12">
      {/* HERO */}
      <section id="top" aria-labelledby="top-title" className="scroll-mt-24">
        <Badge tone="primary">
          <Sparkles aria-hidden="true" />
          {t("eyebrow")}
        </Badge>
        <h1
          id="top-title"
          className="mt-3 max-w-3xl text-display text-balance text-foreground lg:text-display-lg"
        >
          {t("title")}
        </h1>
        <p className="mt-3 max-w-2xl text-body-lg text-muted">{t("intro")}</p>
      </section>

      {/* QUICK START / BUDGET */}
      <section id="configurer" aria-labelledby="configurer-title" className="scroll-mt-24">
        <Card className="w-full max-w-2xl">
          <CardHeader className="gap-1 pb-0">
            <CardTitle id="configurer-title" className="text-headline-sm">
              {t("budget.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BudgetPicker currency={currency} />
          </CardContent>
        </Card>
      </section>

      {/* BUTTONS */}
      <Section id="composants" title={t("buttons.title")} description={t("buttons.description")}>
        <Card>
          <CardContent className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button>{t("buttons.primary")}</Button>
              <Button variant="secondary">{t("buttons.secondary")}</Button>
              <Button variant="outline">{t("buttons.outline")}</Button>
              <Button variant="ghost">{t("buttons.ghost")}</Button>
              <Button disabled>{t("buttons.disabled")}</Button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">{t("buttons.primary")}</Button>
              <Button size="md">{t("buttons.primary")}</Button>
              <Button size="lg">{t("buttons.primary")}</Button>
              <Button size="icon" aria-label={t("buttons.iconLabel")}>
                <Sparkles aria-hidden="true" className="size-5" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button>
                {t("buttons.withIcon")}
                <Check aria-hidden="true" className="size-4" />
              </Button>
              <Button variant="secondary">
                <Clock aria-hidden="true" className="size-4" />
                {t("buttons.secondary")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* INPUTS */}
      <Section id="inputs" title={t("inputs.title")} description={t("inputs.description")}>
        <Card>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <SearchDemo />

            <TextField
              id="build-name"
              label={t("inputs.text.label")}
              placeholder={t("inputs.text.placeholder")}
              hint={t("inputs.text.hint")}
              leadingIcon={<Cpu />}
            />

            <TextField
              id="email"
              type="email"
              label={t("inputs.error.label")}
              placeholder={t("inputs.error.placeholder")}
              error={t("inputs.error.message")}
              leadingIcon={<Mail />}
            />
          </CardContent>
        </Card>
      </Section>

      {/* STATUS BADGES */}
      <Section id="status" title={t("status.title")} description={t("status.description")}>
        <div className="grid gap-3 lg:grid-cols-3">
          {statuses.map((status) => (
            <Card key={status.tone} variant="muted">
              <CardContent className="flex flex-col gap-2">
                <Badge tone={status.tone} className="self-start">
                  {status.tone === "verified" ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Clock aria-hidden="true" />
                  )}
                  {status.label}
                </Badge>
                <p className="text-body-sm text-muted">{status.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {/* CARDS */}
      <Section id="cartes" title={t("cards.title")} description={t("cards.description")}>
        <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
          <BuildCardPreview
            title={t("cards.builds.gaming.title")}
            specs={t("cards.builds.gaming.specs")}
            price={formatPrice(7450, currency)}
            statusLabel={t("status.verified")}
            statusTone="verified"
            actionLabel={t("cards.buildCta")}
          />
          <BuildCardPreview
            title={t("cards.builds.creator.title")}
            specs={t("cards.builds.creator.specs")}
            price={formatPrice(11890, currency)}
            statusLabel={t("status.indicative")}
            statusTone="indicative"
            actionLabel={t("cards.buildCta")}
          />
        </div>
      </Section>

      {/* SAVED BUILD */}
      <Section id="enregistres" title={t("saved.title")} description={t("saved.description")}>
        <Card className="max-w-2xl">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-control bg-primary-soft text-primary">
                <Cpu aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-label-lg text-foreground">{t("saved.name")}</p>
                <p className="text-body-sm text-muted">{t("saved.meta")}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone="indicative">{t("status.indicative")}</Badge>
              <span className="text-label-lg font-bold text-foreground tabular-nums">
                {formatPrice(7990, currency)}
              </span>
              <Button variant="outline" size="sm">
                {t("saved.view")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* COMPONENT RULES */}
      <Section id="guides" title={t("guides.title")} description={t("guides.description")}>
        <Card variant="muted">
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-3">
              {[t("guides.rules.tokens"), t("guides.rules.logical"), t("guides.rules.strings")].map(
                (rule) => (
                  <li key={rule} className="flex items-start gap-2.5 text-body-md text-muted">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill bg-surface text-verified">
                      <Check aria-hidden="true" className="size-3.5" />
                    </span>
                    {rule}
                  </li>
                ),
              )}
            </ul>
            <p className="border-t border-border pt-3 text-body-sm text-subtle">
              {t("guides.docs")}
            </p>
          </CardContent>
        </Card>
      </Section>

      {/* TOKENS */}
      <Section id="tokens" title={t("tokens.title")} description={t("tokens.description")}>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-headline-sm">{t("tokens.palette")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {palette.map((entry) => (
                <div key={entry.hex} className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`size-9 shrink-0 rounded-control border border-border ${entry.swatch}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-label-md font-semibold text-foreground">
                      {entry.label}
                    </span>
                    <span className="block text-body-sm text-subtle tabular-nums">{entry.hex}</span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-headline-sm">{t("tokens.type")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {typeScale.map((entry) => (
                  <div key={entry.name} className="flex items-baseline justify-between gap-3">
                    <span className={`${entry.className} text-foreground`}>Aa 8 594</span>
                    <span className="text-body-sm text-subtle">{entry.name}</span>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
                  <span className="text-price text-foreground tabular-nums">
                    {formatPrice(8594, currency)}
                  </span>
                  <span className="text-body-sm text-subtle">price</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-headline-sm">{t("tokens.radius")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-4">
                {radii.map((entry) => (
                  <div key={entry.label} className="flex flex-col items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`h-10 w-14 border border-outline bg-surface-sunken ${entry.className}`}
                    />
                    <span className="text-body-sm text-muted">{entry.label}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-headline-sm">{t("tokens.spacing")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {spacing.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`h-3 rounded-pill bg-primary ${entry.className}`}
                    />
                    <span className="text-body-sm text-subtle">{entry.name}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-headline-sm">{t("tokens.elevation")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <div className="rounded-card bg-surface p-3 shadow-level-1">
                  <span className="text-body-sm text-muted">{t("tokens.elevationLabels.one")}</span>
                </div>
                <div className="rounded-card bg-surface p-3 shadow-level-2">
                  <span className="text-body-sm text-muted">{t("tokens.elevationLabels.two")}</span>
                </div>
                <div className="rounded-card bg-surface p-3 shadow-level-3">
                  <span className="text-body-sm text-muted">
                    {t("tokens.elevationLabels.three")}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </Section>

      {/* Closing note */}
      <p className="flex items-center justify-center gap-2 pb-4 text-center text-body-sm text-subtle">
        <ShieldCheck aria-hidden="true" className="size-4" />
        {t("budget.note")}
      </p>
    </div>
  );
}
