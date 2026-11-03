/**
 * RetailerRow — "Où acheter", REDUCED to what the API can actually answer (D-10).
 *
 * The board draws a merchant row: seller name, place ("Rabat"), the seller's own
 * price, and a "Voir chez le vendeur" button that opens the shop. **None of that
 * is servable.** `components[]` in the recommendation payload carries
 * `store_offer_id` and a price; it carries no merchant name, no `product_url` and
 * no per-offer price (`docs/web-v2/API_REQUESTS.md` §3, and `store_offer` is not
 * joined at all). So this row deliberately has **no `href` prop**: a row that
 * could not be clicked is honest, a row that pretends to be a link and lands
 * nowhere is not.
 *
 * What it renders instead is the price's PROVENANCE, which is the question a
 * shopper actually asks at this point: is this number a real shelf price, an
 * indicative one, or an estimate? The `status` slot takes the same `Badge` the
 * cards use, so the vocabulary cannot fork; `note` takes the explaining sentence
 * (a translated `messages/` string).
 *
 * It becomes a real merchant row the day `API_REQUESTS.md` §3 is served — at
 * which point the addition is a `href` prop and a seller line, and this header
 * changes. Until then, rendering the board's row would mean inventing a seller.
 *
 * Server-safe: no hooks, no state, no navigation.
 */
import type { ReactNode } from "react";

import { cn } from "./cn";

export interface RetailerRowProps {
  /** What the row is about, e.g. the component's role. */
  label: string;
  /** The price, pre-formatted; `null` renders no number (never a 0). */
  priceLabel: string | null;
  /** The provenance badge — pass `Badge`, so the vocabulary stays one set. */
  status?: ReactNode;
  /** The sentence that says what the badge means here. */
  note?: string;
  className?: string;
}

export function RetailerRow({
  label,
  priceLabel,
  status,
  note,
  className,
}: RetailerRowProps) {
  return (
    <li
      data-retailer-row=""
      className={cn(
        "flex items-center justify-between gap-3 rounded-md bg-subtle p-3",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-compact font-medium text-ink">{label}</p>
        {note === undefined ? null : <p className="mt-0.5 text-caption text-muted">{note}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {priceLabel === null ? null : (
          <span className="num-tabular text-compact font-medium text-ink">{priceLabel}</span>
        )}
        {status}
      </div>
    </li>
  );
}
