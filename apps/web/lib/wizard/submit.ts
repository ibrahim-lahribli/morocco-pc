/**
 * The submit path's two pure decisions (S10): is this body one the contract
 * accepts, and what does a failure MEAN to the screen.
 *
 * Both are here, and not in the component, for the reason `model.ts` exists:
 * a rule that only fails on the last screen of a flow is caught four screens
 * later, in a test that also has to render a page and fake a network.
 *
 * ## Validation mirrors the CONTRACT, not the wizard
 *
 * `apps/api/src/contracts/recommendations.js` is the authority:
 *
 *   - `budget_amount` is a NUMBER (exclusive minimum 0, maximum 1 000 000) —
 *     the engine's loader is strict, and the API refuses a numeric string;
 *   - `currency` is exactly three characters;
 *   - `use_case` is a non-empty string;
 *   - `resolution` and `priority` are optional; priority is an INTEGER 1..5;
 *   - unknown fields are REJECTED (`additionalProperties: false`), never
 *     silently dropped, so a typo is a 422 rather than a mystery.
 *
 * The wizard's own narrowing (500 MAD..1 000 000, priorities 1/3/5) lives in
 * `model.ts` and is STRICTER than this — deliberately. This module is the last
 * line before the wire, so it checks what the API checks and nothing else: if
 * the two ever disagree, the API's answer is the one that decides, and a
 * mismatch here would be a client-side bug reported as a server error.
 *
 * Scenario 1 of the sprint is why it exists at all: a body that carries
 * `budget_amount: "7300"` must be caught HERE, as a 422 would have been, and
 * never reach the network.
 *
 * ## Failures are meanings, not status codes
 *
 * `mapSubmitFailure` turns whatever came back into one of five states a screen
 * can render, because a component that switches on `status === 429` will
 * eventually forget 503, and because the difference between "the service is
 * down" (retry) and "we sent something wrong" (fix it) is a UX decision, not a
 * number. Two mappings are deliberate:
 *
 *   - a NETWORK failure (status 0) is "unavailable", the same as a 503: from
 *     the user's side there is no difference between our service being down and
 *     their connection dropping, and both are worth a retry;
 *   - a 422 with no `details[]` is still a field failure with an EMPTY list, so
 *     the screen falls back to its general sentence instead of inventing which
 *     field was wrong.
 */
import { ApiError } from "@/lib/api/client";

/** The contract's body fields, in the order they are reported. */
export const REQUEST_FIELDS = [
  "budget_amount",
  "currency",
  "use_case",
  "resolution",
  "priority",
] as const;

export type RequestField = (typeof REQUEST_FIELDS)[number];

/** The contract's own ceiling (`budget_amount.maximum`). */
const BUDGET_CEILING = 1_000_000;

/** The contract's priority range. The wizard only offers three of these. */
const PRIORITY_MIN = 1;
const PRIORITY_MAX = 5;

function isRequestField(value: string): value is RequestField {
  return (REQUEST_FIELDS as readonly string[]).includes(value);
}

/**
 * Every field the API would reject, in canonical order, or an empty array.
 *
 * Unknown keys are reported by their own name (they are not `RequestField`s),
 * which is what lets the screen say something honest about a field it has no
 * control for instead of quietly dropping it.
 */
export function validateRequest(input: unknown): string[] {
  if (typeof input !== "object" || input === null) {
    return ["budget_amount", "currency", "use_case"];
  }
  const body = input as Record<string, unknown>;
  const problems: string[] = [];

  const budget = body.budget_amount;
  if (
    typeof budget !== "number" ||
    !Number.isSafeInteger(budget) ||
    budget <= 0 ||
    budget > BUDGET_CEILING
  ) {
    problems.push("budget_amount");
  }

  const currency = body.currency;
  if (typeof currency !== "string" || currency.length !== 3) {
    problems.push("currency");
  }

  const useCase = body.use_case;
  if (typeof useCase !== "string" || useCase.length === 0) {
    problems.push("use_case");
  }

  const resolution = body.resolution;
  if (resolution !== undefined && (typeof resolution !== "string" || resolution.length === 0)) {
    problems.push("resolution");
  }

  const priority = body.priority;
  if (
    priority !== undefined &&
    !(
      typeof priority === "number" &&
      Number.isInteger(priority) &&
      priority >= PRIORITY_MIN &&
      priority <= PRIORITY_MAX
    )
  ) {
    problems.push("priority");
  }

  for (const key of Object.keys(body)) {
    if (!isRequestField(key)) problems.push(key);
  }

  return problems;
}

/**
 * One of five states, and the screen owns the words for each.
 *
 * `retryAfterSeconds` is null when the 429 carried no usable `Retry-After`:
 * a countdown the API never gave us would be invented, so the screen shows a
 * plain retry instead of a number.
 */
export type SubmitFailure =
  | { kind: "fields"; fields: string[] }
  | { kind: "too-large" }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "unavailable" }
  | { kind: "server"; requestId: string | null };

/** Turn a thrown value from `createRecommendation` into something renderable. */
export function mapSubmitFailure(error: unknown): SubmitFailure {
  if (!(error instanceof ApiError)) {
    // Not one of ours: a bug in the client, not a server answer. Keep the
    // generic state and its retry, so the screen never shows a stack trace.
    return { kind: "server", requestId: null };
  }

  switch (error.status) {
    case 413:
      return { kind: "too-large" };
    case 422:
      return {
        kind: "fields",
        // Deduplicated: the API may report two problems for one field, and the
        // inline error under that control must be one sentence.
        fields: [...new Set(error.details.map((detail) => detail.field))],
      };
    case 429:
      return { kind: "rate-limited", retryAfterSeconds: error.retryAfterSeconds };
    case 503:
      return { kind: "unavailable" };
    case 0:
      return { kind: "unavailable" };
    default:
      return { kind: "server", requestId: error.requestId };
  }
}
