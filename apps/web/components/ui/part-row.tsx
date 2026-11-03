/**
 * PartRow — one component inside a build, board `d_tail_configuration_quilibr`.
 *
 * The detail screen lists eight parts under a total; each row is role, name and
 * price, with the per-part verdict slot (if one ever exists) at the end. The row
 * is a `<li>` because every use is a list item, and the list it belongs to
 * supplies the `aria-label` — a row that names its own group would say the same
 * thing eight times.
 *
 * Why the role label is a separate line rather than a table column: at 360 px a
 * three-column row gives the product name ~120 px, which truncates exactly the
 * distinguishing part of a hardware name ("RTX 4060 **Ti**"). Stacking role over
 * name keeps the whole name legible and the price on its own baseline.
 *
 * `priceLabel` is REQUIRED to be pre-formatted: a row that formatted its own
 * number would be a second owner of the locale rules (`lib/i18n/format.ts`), and
 * the Arabic unit (`د.م.`) lives there. Pass `null` for a part with no recorded
 * price — the row then renders no number rather than an invented 0.
 *
 * Server-safe: no hooks. Not in the `@/components/ui` barrel — see the barrel's
 * measured reason (Phase 2 T6: a new export costs 1 410 B on routes that never
 * render it).
 */
import type { ReactNode } from "react";

import { cn } from "./cn";

export interface PartRowProps {
  /** The role's localized name, e.g. "Processeur". */
  role: string;
  /** The product's name as the catalogue holds it. */
  name: string;
  /** A supporting fact — socket, capacity, wattage. Optional. */
  detail?: string;
  /** The selected price, pre-formatted; `null` when the part has none. */
  priceLabel: string | null;
  /**
   * The per-part verdict, when one exists. `null` today on every build: the API
   * persists compatibility at BUILD level only (D-11 / `API_REQUESTS.md` §1), so
   * a row must be able to render without one.
   */
  status?: ReactNode;
  /** An in-row action slot (the swap control, once Phase 4 wires it). */
  action?: ReactNode;
  className?: string;
}

export function PartRow({
  role,
  name,
  detail,
  priceLabel,
  status,
  action,
  className,
}: PartRowProps) {
  return (
    <li
      data-part-row=""
      className={cn("flex items-start justify-between gap-3 py-2.5", className)}
    >
      <div className="min-w-0">
        <p className="text-micro tracking-wider text-muted uppercase">{role}</p>
        <p className="mt-0.5 text-compact font-medium text-ink">{name}</p>
        {detail === undefined ? null : (
          <p className="mt-0.5 text-caption text-muted">{detail}</p>
        )}
        {status === undefined ? null : <p className="mt-1.5">{status}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {priceLabel === null ? null : (
          <span className="num-tabular text-compact font-medium text-ink">{priceLabel}</span>
        )}
        {action}
      </div>
    </li>
  );
}
