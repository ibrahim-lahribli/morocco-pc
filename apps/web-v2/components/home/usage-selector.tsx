"use client";

import { Check, Gamepad2, GraduationCap, Palette, Plus, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import type { HomeUseCase } from "@/lib/homepage/builds";
import { cn } from "@/lib/utils";

/**
 * The three use cases, as native radios in the approved display order.
 *
 * The labels come from the dictionary, never from the API's French labels; the
 * API value is the radio's value. The three options are peers — nothing here
 * marks one as recommended, and the order never follows a score.
 *
 * Composition and states are the Stitch frame's `usage-card` markup: a leading
 * icon tile, a text block that may shrink (`min-w-0`, one truncated line each)
 * and a status indicator — an outlined plus when unselected, a filled primary
 * check when selected. The card border carries the state (`primary-container`
 * when selected, `surface-container-highest` otherwise) and the frame paints no
 * ring, so the only outline is the keyboard focus ring.
 */
const OPTIONS: readonly {
  value: HomeUseCase;
  key: string;
  Icon: LucideIcon;
}[] = [
  { value: "GAMING", key: "gaming", Icon: Gamepad2 },
  { value: "OFFICE", key: "office", Icon: GraduationCap },
  { value: "WORKSTATION", key: "creation", Icon: Palette },
];

export interface UsageSelectorProps {
  value: HomeUseCase | null;
  onChange: (useCase: HomeUseCase) => void;
}

export function UsageSelector({ value, onChange }: UsageSelectorProps) {
  const t = useTranslations("Homepage.finder.usage");

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        const Icon = option.Icon;

        return (
          <label
            key={option.value}
            className={cn(
              "flex min-w-0 cursor-pointer items-center gap-2.5 rounded-field border p-2.5 transition-colors",
              // Keyboard focus only: `focus-within` also matched a mouse click,
              // which painted a second outline around the selected card.
              "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-primary/40 has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background",
              selected
                ? "border-primary bg-surface-sunken"
                : "border-surface-sunken bg-surface-muted hover:bg-surface-sunken/60",
            )}
          >
            <input
              type="radio"
              name="homepage-use-case"
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-foreground"
            >
              <Icon aria-hidden="true" className="size-[18px]" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-label-md font-bold text-foreground">
                {t(`${option.key}.title`)}
              </span>
              <span className="truncate text-body-sm font-normal text-muted">
                {t(`${option.key}.body`)}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-pill border",
                selected
                  ? "border-primary bg-primary text-on-primary"
                  : "border-outline text-subtle",
              )}
            >
              {selected ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
            </span>
          </label>
        );
      })}
    </div>
  );
}
