"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import type { HomeUseCase } from "@/lib/homepage/builds";
import { useHomepageStore } from "@/lib/homepage/store";
import { cn } from "@/lib/utils";

/**
 * The three use-case shortcuts: one per row on a phone, three across from `sm`.
 *
 * They are the mobile discovery affordance, not the deferred resolution row:
 * Q-20's Gaming/creation resolution tiles still render at no width.
 *
 * They are shortcuts into the finder, not a second way to choose: a tile writes
 * the use case through the same store the radios write, so the finder's own
 * radio follows and the cards narrow without a request.
 *
 * The frame's two Gaming resolution shortcuts are deliberately absent (Q-20):
 * presets cannot be filtered by resolution and there is no POST this release, so
 * a resolution tile would reach no served card. The keys stay authored in the
 * dictionary for the step that enables them.
 */
const TILES = [
  { value: "GAMING", key: "gaming" },
  { value: "OFFICE", key: "office" },
  { value: "WORKSTATION", key: "workstation" },
] as const;

export function DiscoveryPathways() {
  const t = useTranslations("Homepage.pathways");
  const selected = useHomepageStore((state) => state.useCase);
  const setUseCase = useHomepageStore((state) => state.setUseCase);

  const selectUseCase = (useCase: HomeUseCase) => {
    setUseCase(useCase);

    const usageGroup = document.getElementById("finder-usage");
    if (usageGroup === null) {
      return;
    }

    usageGroup.scrollIntoView({ behavior: "smooth", block: "start" });
    usageGroup.tabIndex = -1;
    usageGroup.focus();
  };

  return (
    <section id="pathways" aria-labelledby="pathways-title" className="block scroll-mt-24">
      <h2
        id="pathways-title"
        className="text-headline-md text-balance text-foreground lg:text-headline-lg"
      >
        {t("eyebrow")}
      </h2>

      <ul className="mt-4 grid gap-3 sm:grid-cols-3 lg:gap-4">
        {TILES.map((tile) => {
          const pressed = selected === tile.value;

          return (
            <li key={tile.value}>
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => selectUseCase(tile.value)}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-2 rounded-card border p-4 text-start text-label-lg transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  pressed
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border bg-surface text-foreground hover:bg-surface-muted",
                )}
              >
                {t(tile.key)}
                <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
