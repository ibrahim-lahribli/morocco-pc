"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import type { HomeUseCase } from "@/lib/homepage/builds";
import { cn } from "@/lib/utils";

/**
 * The three use cases, as native radios in the approved display order.
 *
 * The labels come from the dictionary, never from the API's French labels; the
 * API value is the radio's value. The three options are peers — nothing here
 * marks one as recommended, and the order never follows a score.
 */
const OPTIONS = [
  { value: "GAMING", key: "gaming" },
  { value: "OFFICE", key: "office" },
  { value: "WORKSTATION", key: "creation" },
] as const;

export interface UsageSelectorProps {
  value: HomeUseCase | null;
  onChange: (useCase: HomeUseCase) => void;
}

export function UsageSelector({ value, onChange }: UsageSelectorProps) {
  const t = useTranslations("Homepage.finder.usage");

  return (
    <div className="flex flex-col gap-2">
      {OPTIONS.map((option) => {
        const selected = option.value === value;

        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-card border p-3 transition-colors",
              "focus-within:ring-2 focus-within:ring-primary/40 focus-within:ring-offset-2 focus-within:ring-offset-background",
              selected
                ? "border-primary bg-primary-soft ring-2 ring-primary ring-offset-2 ring-offset-background"
                : "border-border bg-surface hover:bg-surface-muted",
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
            <span className="flex flex-col gap-0.5">
              <span className="text-label-lg font-semibold text-foreground">
                {t(`${option.key}.title`)}
              </span>
              <span className="text-label-md font-normal text-muted">
                {t(`${option.key}.body`)}
              </span>
            </span>
            {selected ? (
              <Check aria-hidden="true" className="ms-auto size-4 shrink-0 text-primary" />
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
