/**
 * lib/result/swap.ts — S24's decisions, as pure functions.
 *
 * The build card's swap panel is the app's first control that asks the API a
 * question AFTER the page rendered, so the rules it needs are stated here and
 * not in the JSX: which roles may be swapped, which catalogue rows become
 * choices, and what each field of the answer MEANS.
 *
 * ## 1. A role is swappable when the ENGINE can assemble it
 *
 * `SWAP_ROLE_ORDER` is Engine 3's `EXPANSION_ORDER` (`assembly/assemble.js`), in
 * its order. The panel offers the intersection of that list with the roles THIS
 * build actually carries: a swap question is "what if this slot held something
 * else", so a slot the build does not have is not a swap (and `SSD_SECONDARY`,
 * which a build can store but the engine never assembles, is deliberately
 * absent — the API refuses it too).
 *
 * ## 2. A GPU is chosen by its SKU, everything else by its product
 *
 * Engine 2B is variant-keyed for GPUs: a candidate IS a `(product, variant)`
 * pair, and the preview endpoint requires `product_variant_id` for role GPU and
 * refuses it for every other role. The catalogue now publishes `variants`, so
 * this module turns each GPU VARIANT into one choice and each non-GPU PRODUCT
 * into one, and the request it builds can name exactly what the engine keys on.
 * A GPU product whose `variants` array is empty offers no choice at all: there
 * is nothing addressable to send.
 *
 * ## 3. The current part is not offered back
 *
 * Choosing the component already installed would produce a confident "no
 * change", which answers a question nobody asked. The card passes the product
 * id it is rendering, and this module drops it.
 *
 * ## 4. UNKNOWN is its own state, never a shade of PASS
 *
 * The engine's three-state vocabulary is load-bearing: a relationship that
 * could not be checked is not one that holds. `verdictOf()` passes the API's
 * status through unchanged, and the panel renders `UNKNOWN` with its own word
 * and its own sentence — it is never folded into "compatible".
 *
 * ## 5. Nothing here recomputes the answer
 *
 * `delta`, `within_budget` and the total are the API's numbers. This module
 * narrows them (`priceFigures`, `budgetFigures`) so a component can render
 * without asserting non-nullness, and it formats nothing: money and numbers go
 * through `lib/i18n/format.ts` at the call site, because this module has no
 * locale.
 */
import {
  ApiError,
  type CatalogListResponse,
  type SwapCommitResponse,
  type SwapPreviewResponse,
} from "@/lib/api/client";

import type { PriceProvenance } from "./model";

/**
 * The swappable roles, in Engine 3's assembly order (`EXPANSION_ORDER`).
 *
 * Restated rather than imported: `apps/web` must not import the engine (it is a
 * separate package with its own lockfile), and the order is a CONTRACT the API
 * validates against — a role outside it is a 422. The list is pinned by
 * `e2e/swap.spec.ts` (which swaps a CPU and a GPU) and by the API's own 422.
 */
export const SWAP_ROLE_ORDER = [
  "CPU",
  "MOTHERBOARD",
  "RAM",
  "GPU",
  "PSU",
  "CASE",
  "CPU_COOLER",
  "SSD_BOOT",
] as const;

/** The role whose catalogue rows are variant-keyed (Engine 2B). */
export const GPU_ROLE = "GPU";

/**
 * The roles of THIS build that may be swapped, in assembly order.
 *
 * `roles` are the build's own component roles, which arrive in assembly order but
 * are not guaranteed to: the order here is the engine's, so the picker reads the
 * same way on every card and an unknown role is simply not offered.
 */
export function swappableRoles(roles: readonly string[]): string[] {
  const present = new Set(roles);
  return SWAP_ROLE_ORDER.filter((role) => present.has(role));
}

/** One choice in the "new component" picker. */
export interface SwapOption {
  /** Stable React key and `<option>` value: product, or product + variant. */
  key: string;
  role: string;
  productId: string;
  /** Set for a GPU (and only then): the SKU the engine keys the candidate on. */
  productVariantId: string | undefined;
  /** The catalogue's display name — data, printed verbatim. */
  name: string;
  /** The SKU, when the choice is a variant. */
  sku: string | null;
  /** The catalogue's own `from_price`, or null when it has no eligible offer. */
  price: number | null;
}

/** A list row, as `GET /v1/catalog/products` serves it (contract v1.9). */
type CatalogRow = CatalogListResponse["products"][number];

/**
 * The choices for one role, from one catalogue page.
 *
 * Non-GPU: one choice per product, `productVariantId` undefined — the endpoint
 * REFUSES a variant for those roles, so sending one would be a 422.
 *
 * GPU: one choice per VARIANT, because that is what the engine's candidate is.
 * A GPU product with no variants is skipped rather than sent without one: the
 * endpoint requires it for role GPU, so offering the product would only produce
 * a refusal. `installedProductId` (the part already in the build) is dropped.
 *
 * The catalogue's order is kept (slug order, from the API) rather than sorted
 * here: the picker must read the same way twice for the same page.
 */
export function swapOptions(
  role: string,
  products: readonly CatalogRow[],
  installedProductId: string | null,
): SwapOption[] {
  const offered = products.filter((product) => product.id !== installedProductId);
  if (role !== GPU_ROLE) {
    return offered.map((product) => ({
      key: product.id,
      role,
      productId: product.id,
      productVariantId: undefined,
      name: product.display_name,
      sku: null,
      price: product.from_price,
    }));
  }
  return offered.flatMap((product) =>
    product.variants.map((variant) => ({
      key: `${product.id}:${variant.id}`,
      role,
      productId: product.id,
      productVariantId: variant.id,
      name: product.display_name,
      sku: variant.sku,
      price: product.from_price,
    })),
  );
}

/** The engine's three-state compatibility vocabulary. */
export type SwapVerdict = "PASS" | "UNKNOWN" | "FAIL";

/**
 * The API's aggregate verdict, passed through (never re-derived).
 *
 * A COMMIT answers with the same shape - and, after Decision 56, the whole
 * build's verdict rather than the role's - so both answers are read here.
 */
export function verdictOf(response: SwapPreviewResponse | SwapCommitResponse): SwapVerdict {
  return response.compatibility.status;
}

/**
 * Whether the reader may ask the API to KEEP this answer (Decision 56).
 *
 * A `FAIL` verdict is refused by the commit route (409 `SWAP_NOT_COMMITTABLE`),
 * so offering the button would promise an action the server cannot perform. PASS
 * and UNKNOWN both commit: a pass persists UNKNOWN builds too, and a reader who
 * understands "nobody checked this relation" may still want the replacement.
 */
export function canCommit(response: SwapPreviewResponse): boolean {
  return verdictOf(response) !== "FAIL";
}

/** How many relationships could not be checked (the API's own count). */
export function unknownPairwiseCount(response: SwapPreviewResponse): number {
  return response.compatibility.unknown_pairwise_count;
}

/**
 * The eligibility failure, when the candidate was not evaluable at all.
 *
 * The API reports "this product cannot be swapped in" as a synthetic pair named
 * `eligibility` — it is not a pairwise relation, and its `partner_role` is null.
 * A caller that treated it as one would ask the panel to name a partner that
 * does not exist, so it is separated here, once.
 */
export function eligibilityFailure(
  response: SwapPreviewResponse,
): SwapPreviewResponse["compatibility"]["pairs"][number] | null {
  return response.compatibility.pairs.find((pair) => pair.check === "eligibility") ?? null;
}

/**
 * The message key for an eligibility reason.
 *
 * Three codes, and they are distinguishable ON PURPOSE: the product is not a
 * candidate at all, it is a candidate with no price, or it is incompatible with
 * this build. Anything else (a future rule's code) gets the generic
 * "incompatible" sentence rather than printing a code at a user.
 */
export type EligibilityReasonKey = "NO_ELIGIBLE_OFFER" | "PRODUCT_NOT_CANDIDATE" | "INCOMPATIBLE";

export function eligibilityReasonKey(
  pair: Pick<SwapPreviewResponse["compatibility"]["pairs"][number], "reason">,
): EligibilityReasonKey {
  if (pair.reason === "NO_ELIGIBLE_OFFER") return "NO_ELIGIBLE_OFFER";
  if (pair.reason === "PRODUCT_NOT_CANDIDATE") return "PRODUCT_NOT_CANDIDATE";
  return "INCOMPATIBLE";
}

/** The price facts, narrowed: each is the API's number or null, never a 0. */
export interface PriceFigures {
  previous: number | null;
  next: number | null;
  delta: number | null;
}

export function priceFigures(price: SwapPreviewResponse["price"]): PriceFigures {
  return {
    previous: finiteOrNull(price.previous),
    next: finiteOrNull(price.next),
    delta: finiteOrNull(price.delta),
  };
}

/**
 * The provenance of the price the swap would pay.
 *
 * The same precedence `priceProvenance()` applies to a whole build (V6), for ONE
 * price: an all-seed offer is "démo" even though the API's derived
 * `price_status` cannot say so, and a price with no class at all (no eligible
 * offer) has NO state rather than a default one.
 */
export function offerProvenance(price: SwapPreviewResponse["price"]): PriceProvenance | null {
  if (price.offer_class === null) return null;
  if (price.offer_class === "SEED_UNVERIFIED") return "demo";
  return price.price_status === "verified" ? "verified" : "indicative";
}

/** The budget facts, narrowed to the two positive numbers a bar needs. */
export function swapBar(
  budget: SwapPreviewResponse["budget"],
): { total: number; budget: number } | null {
  const total = finiteOrNull(budget.total);
  const amount = finiteOrNull(budget.budget_amount);
  if (total === null || amount === null || total <= 0 || amount <= 0) return null;
  return { total, budget: amount };
}

/** The API's own verdict on the budget, or null when it could not decide. */
export function withinBudget(budget: SwapPreviewResponse["budget"]): boolean | null {
  return typeof budget.within_budget === "boolean" ? budget.within_budget : null;
}

/** A number the API actually sent, or null. Types, not guesses. */
function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The things a failed preview can be, as words a reader can act on. */
export type SwapErrorKey = "notEvaluable" | "rateLimited" | "invalid" | "generic";

/**
 * The COMMIT's own failures (Decision 56).
 *
 * `alreadyCommitted` is the one a reader can act on without changing anything:
 * the build holds one replacement, and this is the page telling them so. The
 * other 409s (`SWAP_NOT_COMMITTABLE`, `SWAP_ROLE_ABSENT`) mean the answer moved -
 * the catalogue disagreed with what was on screen - which reads as `refused`.
 */
export type SwapCommitErrorKey = SwapErrorKey | "alreadyCommitted" | "refused";

/**
 * Which sentence a failed commit gets.
 *
 * The status alone separates the build-level failures; the `code` separates the
 * two 409s, because "already swapped" and "would not fit" ask for different
 * next actions (look at the build vs. pick another part).
 */
export function swapCommitErrorKey(error: unknown): SwapCommitErrorKey {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return error.code === "SWAP_ALREADY_COMMITTED" ? "alreadyCommitted" : "refused";
    }
    if (error.status === 404) return "notEvaluable";
    if (error.status === 429) return "rateLimited";
    if (error.status === 422) return "invalid";
  }
  return "generic";
}

/**
 * Which sentence a failed preview gets.
 *
 * The API distinguishes 404 `BUILD_NOT_EVALUABLE` (the live catalogue no longer
 * reconstructs this build — retired product, expired offer) from a genuine
 * failure, and 422 from a throttle. Each one asks the reader to do something
 * different, so each gets its own sentence; anything unrecognized is the
 * generic one, because inventing a cause is worse than admitting none is known.
 */
export function swapErrorKey(error: unknown): SwapErrorKey {
  if (error instanceof ApiError) {
    if (error.status === 404) return "notEvaluable";
    if (error.status === 429) return "rateLimited";
    if (error.status === 422) return "invalid";
  }
  return "generic";
}
