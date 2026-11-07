import { Gift, ShieldCheck, Tag, type LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";

type PillarKey = "compatibility" | "prices" | "free";

const PILLARS: readonly { key: PillarKey; icon: LucideIcon; tile: string }[] = [
  { key: "compatibility", icon: ShieldCheck, tile: "bg-accent-soft text-accent-ink" },
  { key: "prices", icon: Tag, tile: "bg-primary-soft text-primary" },
  { key: "free", icon: Gift, tile: "bg-verified-soft text-verified" },
];

/**
 * "Why trust these numbers?" — three claims, no sales copy.
 *
 * One DOM for both frames: below `lg` the three pillars live inside a single
 * bordered card separated by hairlines; from `lg` each becomes its own card in
 * a three-column grid. The eyebrow and intro are desktop-only, per the mobile
 * frame.
 */
export async function TrustHighlights() {
  const t = await getTranslations("Homepage.trust");

  return (
    <section id="confiance" aria-labelledby="confiance-title" className="scroll-mt-24">
      <div className="text-center">
        <p className="hidden text-label-md font-semibold tracking-wide text-primary uppercase md:block">
          {t("eyebrow")}
        </p>
        <h2
          id="confiance-title"
          className="mt-1 text-headline-md text-balance text-foreground lg:text-headline-lg"
        >
          {t("title")}
        </h2>
        <p className="mx-auto mt-2 hidden max-w-2xl text-body-md text-muted md:block">
          {t("intro")}
        </p>
      </div>

      <ul className="mt-5 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-level-1 lg:mt-8 lg:grid lg:grid-cols-3 lg:gap-6 lg:divide-y-0 lg:overflow-visible lg:border-0 lg:bg-transparent lg:shadow-none">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;

          return (
            <li
              key={pillar.key}
              className="flex flex-col gap-2 p-5 lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-6 lg:shadow-level-1"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-14 items-center justify-center rounded-field",
                  pillar.tile,
                )}
              >
                <Icon className="size-6" />
              </span>
              <h3 className="text-headline-sm text-foreground">
                {t(`pillars.${pillar.key}.title`)}
              </h3>
              <p className="text-body-md text-muted">{t(`pillars.${pillar.key}.body`)}</p>
              <p className="mt-1 border-t border-border pt-2 text-body-sm text-subtle">
                {t(`pillars.${pillar.key}.foot`)}
              </p>
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
