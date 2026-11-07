/**
 * The configurator's URL and form contract.
 *
 * The route is entered from a homepage handoff, so every answer may arrive as
 * text in `searchParams`. Parsing is per field: one bad value produces one
 * visible error and never discards a valid neighbour. Values are never clamped
 * and the URL is never rewritten here.
 *
 * The form schema receives its messages from the dictionary, exactly like the
 * homepage finder, so both locales validate identically but speak their own
 * language.
 */
import { z } from "zod";

import { HOME_USE_CASES, type HomeUseCase } from "@/lib/homepage/builds";
import { BUDGET_MAX, BUDGET_MIN } from "@/lib/homepage/finder-schema";

export type ConfiguratorUseCase = HomeUseCase;

export type ConfiguratorErrorCode =
  "USE_CASE_INVALID" | "BUDGET_INVALID" | "BUDGET_RANGE" | "FROM_INVALID";

export type ConfiguratorField = "useCase" | "budget" | "from";

/** What the server hands the client shell; serialisable and already validated. */
export interface ConfiguratorSeed {
  useCase: ConfiguratorUseCase | null;
  budgetAmount: number | null;
  /** Raw budget text when the URL supplied an invalid one; null otherwise. */
  budgetText: string | null;
  recommendationId: string | null;
  fieldErrors: Partial<Record<ConfiguratorField, ConfiguratorErrorCode>>;
}

/** `searchParams` as Next.js supplies them: one value, repeated values, or absent. */
export type RawSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface RequirementsValues {
  useCase: ConfiguratorUseCase | null;
  /** The field's raw text, so a partially typed amount is not erased. */
  budget: string;
}

export interface RequirementsMessages {
  useCaseRequired: string;
  budgetRequired: string;
  budgetRange: string;
}

/** Canonical 8-4-4-4-12 hex; the contract declares no `format: uuid`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBudget(raw: string): {
  value: number | null;
  error: ConfiguratorErrorCode | null;
} {
  if (!/^\d+$/.test(raw)) {
    return { value: null, error: "BUDGET_INVALID" };
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < BUDGET_MIN || value > BUDGET_MAX) {
    return { value: null, error: "BUDGET_RANGE" };
  }

  return { value, error: null };
}

export function parseBudgetInput(raw: string): number | null {
  const parsed = parseBudget(raw.trim());
  return parsed.error === null ? parsed.value : null;
}

export function parseConfiguratorSearchParams(params: RawSearchParams): ConfiguratorSeed {
  const fieldErrors: ConfiguratorSeed["fieldErrors"] = {};

  const useCaseRaw = params.use_case;
  let useCase: ConfiguratorUseCase | null = null;
  if (useCaseRaw !== undefined) {
    if (
      typeof useCaseRaw === "string" &&
      (HOME_USE_CASES as readonly string[]).includes(useCaseRaw)
    ) {
      useCase = useCaseRaw as ConfiguratorUseCase;
    } else {
      fieldErrors.useCase = "USE_CASE_INVALID";
    }
  }

  const budgetRaw = params.budget;
  let budgetAmount: number | null = null;
  let budgetText: string | null = null;
  if (budgetRaw !== undefined) {
    if (typeof budgetRaw !== "string") {
      fieldErrors.budget = "BUDGET_INVALID";
    } else {
      const parsed = parseBudget(budgetRaw);
      budgetAmount = parsed.value;
      if (parsed.error !== null) {
        fieldErrors.budget = parsed.error;
        budgetText = budgetRaw;
      }
    }
  }

  const fromRaw = params.from;
  let recommendationId: string | null = null;
  if (fromRaw !== undefined) {
    if (typeof fromRaw === "string" && UUID_PATTERN.test(fromRaw)) {
      recommendationId = fromRaw.toLowerCase();
    } else {
      fieldErrors.from = "FROM_INVALID";
    }
  }

  return { useCase, budgetAmount, budgetText, recommendationId, fieldErrors };
}

export function createRequirementsSchema(
  messages: RequirementsMessages,
): z.ZodType<RequirementsValues, RequirementsValues> {
  return z
    .object({
      useCase: z.enum(HOME_USE_CASES).nullable(),
      budget: z.string(),
    })
    .superRefine((values, ctx) => {
      if (values.useCase === null) {
        ctx.addIssue({ code: "custom", message: messages.useCaseRequired, path: ["useCase"] });
      }

      const raw = values.budget.trim();
      if (raw === "") {
        ctx.addIssue({ code: "custom", message: messages.budgetRequired, path: ["budget"] });
        return;
      }

      if (parseBudgetInput(raw) === null) {
        ctx.addIssue({ code: "custom", message: messages.budgetRange, path: ["budget"] });
      }
    });
}

export function resolveRequirementsBudget(values: RequirementsValues): number | null {
  return parseBudgetInput(values.budget);
}
