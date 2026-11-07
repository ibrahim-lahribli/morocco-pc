/**
 * The finder's form contract.
 *
 * One budget answer and one usage answer, both required, with NO default: a
 * first visit has nothing selected and the CTA stays disabled. The budget comes
 * from either a preset radio or the custom field, and `resolveBudgetAmount` is
 * the single place that decides which one wins.
 *
 * Messages arrive from the dictionary, never from this module: the schema is
 * built per locale so a French and an Arabic form validate identically but speak
 * their own language.
 */
import { z } from "zod";

import { BUDGET_OPTIONS } from "@/lib/demo/store";

import { HOME_USE_CASES, type HomeUseCase } from "./builds";

/** The frame's range floor: below it no configuration assembles. */
export const BUDGET_MIN = 3_500;

/** A sanity bound for a consumer build; the API allows up to 1 000 000. */
export const BUDGET_MAX = 100_000;

/** Matches the API's documented client snapping and keeps dedupe hits likely. */
export const BUDGET_STEP = 500;

export interface FinderMessages {
  /** `finder.error.required` */
  required: string;
  /** `finder.error.budgetRange`, already interpolated with min/max. */
  budgetRange: string;
}

export interface FinderValues {
  /** A preset radio, in dirhams. */
  budgetPreset: number | null;
  /** The custom field's raw text, so a partially typed value is not an error. */
  customBudget: string;
  useCase: HomeUseCase | null;
}

export const EMPTY_FINDER_VALUES: FinderValues = {
  budgetPreset: null,
  customBudget: "",
  useCase: null,
};

/**
 * Parse the custom field. Only digits are accepted — the API rejects numeric
 * strings and a comma, a space or a decimal point is a typo, not an amount.
 */
export function parseCustomBudget(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/** The answer the form would submit: the preset if one is chosen, else the field. */
export function resolveBudgetAmount(values: FinderValues): number | null {
  if (values.budgetPreset !== null) {
    return values.budgetPreset;
  }

  const parsed = parseCustomBudget(values.customBudget);
  if (parsed === null || parsed < BUDGET_MIN || parsed > BUDGET_MAX) {
    return null;
  }

  return parsed;
}

/**
 * Build the resolver schema for one locale.
 *
 * The checks are `superRefine` issues rather than field-level `min/max` so both
 * messages come from `FinderMessages` and either answer can be missing without
 * the other producing a second, unrelated error.
 */
export function createFinderSchema(messages: FinderMessages) {
  return z
    .object({
      budgetPreset: z.number().int().nullable(),
      customBudget: z.string(),
      useCase: z.enum(HOME_USE_CASES).nullable(),
    })
    .superRefine((values, ctx) => {
      if (values.useCase === null) {
        ctx.addIssue({ code: "custom", message: messages.required, path: ["useCase"] });
      }

      if (values.budgetPreset === null) {
        const parsed = parseCustomBudget(values.customBudget);
        if (parsed === null || parsed < BUDGET_MIN || parsed > BUDGET_MAX) {
          ctx.addIssue({ code: "custom", message: messages.budgetRange, path: ["customBudget"] });
        }
        return;
      }

      if (!(BUDGET_OPTIONS as readonly number[]).includes(values.budgetPreset)) {
        ctx.addIssue({ code: "custom", message: messages.budgetRange, path: ["budgetPreset"] });
      }
    });
}

export type FinderSchema = ReturnType<typeof createFinderSchema>;
