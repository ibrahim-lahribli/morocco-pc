import { Gift, ShieldCheck, Tag, type LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

import { SectionHeading } from "./section-heading";

type PillarKey = "compatibility" | "prices" | "free";

const PILLARS: readonly { key: PillarKey; icon: LucideIcon; tone: string }[] = [
  { key: "compatibility", icon: ShieldCheck, tone: "text-accent-ink" },
  { key: "prices", icon: Tag, tone: "text-primary" },
  { key: "free", icon: Gift, tone: "text-verified" },
];

/**
 * "Why trust these numbers?" — three claims, no sales copy.
 *
 * One shared bordered card holding three compact rows: a small icon in a fixed
 * first column, the claim and its one-line description beside it. The flex row
 * mirrors under `dir="rtl"` on its own — gap and column widths are
 * direction-agnostic.
 */
export async function TrustHighlights() {
  const t = await getTranslations("Homepage.trust");

  return (
    <section id="confiance" aria-labelledby="confiance-title" className="scroll-mt-24">
      <SectionHeading
        id="confiance-title"
        eyebrow={t("eyebrow")}
        title={t("title")}
        intro={t("intro")}
        align="center"
      />

      <ul className="mt-5 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-level-1 lg:mt-8">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;

          return (
            <li key={pillar.key} className="flex items-center gap-4 p-4 sm:px-6 sm:py-5">
              <span aria-hidden="true" className="flex w-8 shrink-0 justify-center">
                <Icon className={cn("size-5", pillar.tone)} />
              </span>
              <div className="min-w-0">
                <h3 className="text-headline-sm text-foreground">
                  {t(`pillars.${pillar.key}.title`)}
                </h3>
                <p className="mt-0.5 text-body-sm text-muted">{t(`pillars.${pillar.key}.body`)}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 text-start md:text-center">
        <span aria-disabled="true" className="text-label-lg text-primary">
          {t("methodologyLink")}
        </span>
      </p>
    </section>
  );
}
