"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { BUDGET_OPTIONS } from "@/lib/demo/store";
import { formatPrice } from "@/lib/format/price";
import { cn } from "@/lib/utils";

/**
 * The four budget presets: 2x2 on mobile, one row of four from `sm`.
 *
 * They are native radios, not buttons with `aria-pressed`, so a screen reader
 * announces "2 of 4" and arrow keys move within the group. The visible chip
 * shows the formatted amount and the input carries `finder.budget.presetLabel`
 * as its accessible name. Selection is never colour-only: the chosen chip also
 * gets a check icon.
 *
 * The two states are the Stitch frame's own (`budget-preset-btn` in the mobile
 * source): unselected is a light `surface-container-low` chip with a
 * `surface-container-highest` border and the normal foreground, selected is the
 * solid `primary-container` fill with `on-primary` type. The frame paints no
 * ring, so neither state carries one — the only outline a chip can show is the
 * keyboard focus ring, which is subtracted from the selected state.
 *
 * A preset is a budget, not a promise of a card — the builds section decides
 * what is served at or below it.
 */
export interface BudgetPresetGridProps {
  /** The selected preset in dirhams, or null before the visitor answers. */
  value: number | null;
  onChange: (amount: number) => void;
}

export function BudgetPresetGrid({ value, onChange }: BudgetPresetGridProps) {
  const t = useTranslations("Homepage.finder.budget");
  const currency = useTranslations("Price")("currency");

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {BUDGET_OPTIONS.map((option) => {
        const selected = option === value;
        const amount = formatPrice(option, currency);

        return (
          <label
            key={option}
            className={cn(
              "flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-field border px-2 text-label-lg transition-colors",
              // Keyboard focus only: `focus-within` also matched a mouse click,
              // which painted a second outline around the selected chip.
              "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-primary/40 has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background",
              selected
                ? "border-primary bg-primary text-on-primary"
                : "border-surface-sunken bg-surface-muted text-foreground hover:border-primary",
            )}
          >
            <input
              type="radio"
              name="homepage-budget"
              value={option}
              checked={selected}
              aria-label={t("presetLabel", { amount })}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            <span aria-hidden="true" className="truncate">
              {amount}
            </span>
            {selected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
          </label>
        );
      })}
    </div>
  );
}
