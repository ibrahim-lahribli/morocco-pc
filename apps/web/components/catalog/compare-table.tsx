/**
 * components/catalog/compare-table.tsx — the comparison itself (S23).
 *
 * One semantic `<table>`, and the 360 px fallback is a LAYOUT of that table, not
 * a second copy of the data. Two renderings would mean every value on the page
 * twice: a screen reader would read the comparison twice and a stale copy could
 * disagree with the visible one. So the DOM stays a table with a caption, a
 * header row of `<th scope="col">` and a `<th scope="row">` per fact, and CSS
 * makes the rows stack below 640 px.
 *
 * Three consequences worth naming, because each one is deliberate:
 *
 * 1. **The roles are explicit.** Changing `display` on table elements drops
 *    their table semantics in some browsers' accessibility trees, so the roles
 *    are stated rather than inferred. That is the documented cost of a
 *    responsive table, and it is cheaper than a duplicated DOM.
 * 2. **Every stacked value carries its column's name.** The `<span>` before a
 *    value is `hidden` at wide widths — the column header already says whose
 *    value it is — and visible in the stack, where the header row is visually
 *    gone. It is `hidden`, not `sr-only`, so a wide screen reader does not hear
 *    each product's name once per cell on top of the header row.
 * 3. **A difference is a WORD.** The row marker reads "Diffère" (or its Arabic
 *    translation); colour only reinforces it. A reader who cannot see the
 *    warning tone, and a screen reader that never announces it, still get the
 *    signal — that is S23's "text, not colour alone" rule.
 *
 * The selection panel above the table is the PAGE's, not this component's: price,
 * provenance and the "Retirer" links have to exist in the states where a table
 * cannot be drawn (one product, mixed categories), so one panel serves them all.
 */
import type { CompareRow } from "@/lib/catalog/compare";

/** One compared product, as a column header. */
export interface CompareColumn {
  slug: string;
  name: string;
}

export interface CompareTableLabels {
  /** The table's caption, read before the rows. */
  caption: string;
  /** The word for the empty top-start cell. */
  specColumn: string;
  differs: string;
  unknown: string;
}

export interface CompareTableProps {
  columns: readonly CompareColumn[];
  rows: readonly CompareRow[];
  labels: CompareTableLabels;
}

export function CompareTable({ columns, rows, labels }: CompareTableProps) {
  // The stacked cell label repeats the column's name; one lookup keeps the name
  // from being re-derived per cell.
  const names = new Map(columns.map((column) => [column.slug, column.name]));

  return (
    <table role="table" className="mt-6 w-full border-collapse text-compact max-sm:block">
      <caption className="sr-only">{labels.caption}</caption>
      <thead role="rowgroup" className="max-sm:sr-only">
        <tr role="row">
          <th
            scope="col"
            className="border-b border-border px-3 py-2 text-start align-bottom font-medium text-muted"
          >
            <span className="sr-only">{labels.specColumn}</span>
          </th>
          {columns.map((column) => (
            <th
              key={column.slug}
              scope="col"
              className="border-b border-border px-3 py-2 text-start align-bottom font-medium text-ink"
            >
              <span dir="auto" className="break-words">
                {column.name}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup" className="max-sm:block">
        {rows.map((row) => (
          <tr
            key={row.key}
            role="row"
            className="align-top max-sm:mt-3 max-sm:block max-sm:rounded-card max-sm:border max-sm:border-border"
          >
            <th
              scope="row"
              role="rowheader"
              className="border-b border-border px-3 py-2 text-start font-normal text-muted max-sm:block max-sm:border-b-0 max-sm:pt-3 max-sm:pb-0"
            >
              {row.label}
              {row.differs ? (
                <>
                  {" "}
                  <span className="ms-2 text-caption font-medium text-warning">{labels.differs}</span>
                </>
              ) : null}
            </th>
            {row.cells.map((cell) => (
              <td
                key={cell.slug}
                role="cell"
                className="border-b border-border px-3 py-2 text-start text-ink max-sm:block max-sm:border-b-0 max-sm:py-1"
              >
                {/* Two lines in the stack, one line at wide widths: the label is
                    a BLOCK there, or a long product name would wrap around the
                    value and read as one run ("... Ventus 3X / 165 W Blanc"). */}
                <span className="hidden text-micro text-muted max-sm:block">
                  {names.get(cell.slug) ?? ""}
                </span>
                {/* The block keeps the CELL's direction, so the value still starts
                    at the inline edge in Arabic; only the inline span resolves its
                    own direction, because a spec is DATA — a Latin model name keeps
                    its order inside an RTL cell. */}
                <span className="max-sm:block">
                  <span dir="auto" className="break-words">
                    {cell.value ?? labels.unknown}
                  </span>
                </span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
