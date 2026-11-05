/**
 * BottomTabBar — the five-item mobile navigation, board `accueil_morocco_pc`.
 *
 * The design's own geometry: a 80 px row (`h-20`) of five equal cells, each a
 * 56 px (`h-14`) column of icon over label, with the CENTRE item raised on a
 * 56 px circle that overlaps the bar's top edge. The active item is filled
 * primary and semibold; the others are muted.
 *
 * THE ACTIVE CUE IS A SHAPE, NOT A COLOUR (G3). The board draws the current
 * cell in primary at weight 600 and nothing else -- check its own
 * `accueil_morocco_pc/code.html`: `data-active-classes="text-primary
 * font-semibold"`, no indicator and no filled icon, because it has no active
 * state to draw beyond that. A weight step is a weak cue on a 12 px label and
 * disappears entirely in greyscale or at a glance, so the current cell also
 * carries a drawn INDICATOR: a 16 x 3 px pill under the label
 * (`data-tab-indicator`), which the other four do not have. It is ABSOLUTELY
 * positioned on purpose -- in flow it would add ~5 px to the cell and make the
 * icons jump as the user navigates -- and centred with `inset-x-0 mx-auto`, so
 * it mirrors under `dir="rtl"` for free. `bg-current` paints it in the cell's
 * own ink, so it stays a dark mark on a greyscale render. `aria-current="page"`
 * still carries the state for assistive tech; the bar is `aria-hidden`.
 *
 * Three decisions are load-bearing:
 *
 *   - **`current` is a prop, not `usePathname()`.** The kit's contract is that no
 *     primitive reads request state (see the barrel header); the shell knows
 *     which item is current, and the gallery has to be able to draw every state
 *     without navigating. A hook in here would make the primitive unrenderable
 *     anywhere but a client component, which is exactly the leak the barrel
 *     measurement just charged 1 410 B for.
 *   - **Labels are SHORT by contract.** Five labels across 360 px leave ~72 px
 *     each; "Enregistrements" does not fit (PLAN.md's tab-bar rule). The caller
 *     passes the short form from `messages/` — this file holds no words.
 *   - **`env(safe-area-inset-bottom)` is physical on purpose.** The cut-out is at
 *     the bottom edge in both directions, so the pad does not mirror under
 *     `dir="rtl"`; that is why it is an arbitrary utility here rather than a
 *     logical property. It only becomes non-zero with `viewport-fit=cover`,
 *     which `app/[locale]/layout.tsx` now exports.
 *
 * The page underneath MUST reserve room for this bar: it is `fixed`, so it
 * covers content rather than pushing it. `TAB_BAR_OFFSET` is the class the shell
 * puts on `<body>` so nothing that follows the main content can end up behind
 * the bar — the footer included, which is the case that found this.
 */
import Link from "next/link";

import { cn } from "./cn";
import { BookIcon, BookmarkIcon, ChipIcon, HomeIcon, SparklesIcon } from "./icons";

/** The icon vocabulary the five cells need. Closed on purpose: a sixth cell is a decision. */
export type TabBarIcon = "home" | "components" | "configure" | "guides" | "saved";

export interface TabBarItem {
  /** Stable key and the value matched against `current`. */
  key: string;
  href: string;
  /** Short label from `messages/` — five labels share 360 px. */
  label: string;
  icon: TabBarIcon;
  /** The centre cell: drawn as a raised circle, as the board draws it. */
  raised?: boolean;
}

export interface BottomTabBarProps {
  /** The bar's accessible name (`nav` landmark needs one). */
  label: string;
  items: readonly TabBarItem[];
  /** The item whose page is on screen; everything else is muted. */
  current?: string;
  className?: string;
}

const ICONS: Record<TabBarIcon, (props: { className?: string }) => React.JSX.Element> = {
  home: HomeIcon,
  components: ChipIcon,
  configure: SparklesIcon,
  guides: BookIcon,
  saved: BookmarkIcon,
};

/**
 * The room the shell must leave for the bar: its 80 px row, the 1 px top border
 * above it, and the device's bottom inset. Exported as a class so the shell and
 * this file cannot drift.
 */
export const TAB_BAR_OFFSET = "pb-[calc(5rem+1px+env(safe-area-inset-bottom,0px))]";

export function BottomTabBar({ label, items, current, className }: BottomTabBarProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md",
        "pb-[env(safe-area-inset-bottom,0px)] shadow-bar",
        className,
      )}
    >
      <ul className="mx-auto flex h-20 w-full max-w-5xl items-center justify-around px-1">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = item.key === current;
          return (
            <li key={item.key} className={cn("flex-1", item.raised && "-mt-5")}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // `relative` anchors the active indicator below (absolute, so
                  // the cell's height never changes with the state).
                  "relative flex min-w-12 flex-col items-center justify-center gap-0.5",
                  item.raised
                    ? // The raised cell is its own shape, so its label sits under it
                      // rather than inside a 56 px column.
                      "min-h-14"
                    : "h-14",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center",
                    item.raised
                      ? cn(
                          "h-14 w-14 rounded-pill ring-4 ring-surface",
                          active
                            ? "bg-primary-container text-on-primary"
                            : "bg-primary text-on-primary",
                        )
                      : "h-6 w-6",
                  )}
                >
                  <Icon className={item.raised ? "h-7 w-7" : "h-6 w-6"} />
                </span>
                <span
                  // A stable hook for the specs: the cell now holds TWO spans
                  // (label, then indicator), so "the last span" no longer names
                  // the label.
                  data-tab-label=""
                  className={cn(
                    // `text-tab`, not `text-micro`: PLAN.md's 12 px caption floor
                    // for the five labels, and 13 px on Arabic (D-30).
                    "text-tab tracking-tight",
                    active ? "font-semibold text-primary" : "font-medium text-muted",
                    item.raised && "mt-1",
                  )}
                >
                  {item.label}
                </span>
                {active ? (
                  <span
                    aria-hidden="true"
                    data-tab-indicator=""
                    className="absolute inset-x-0 bottom-1 mx-auto h-[3px] w-4 rounded-pill bg-current"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
