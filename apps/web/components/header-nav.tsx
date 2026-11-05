"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isTabPath, localeRest } from "@/components/shell/tab-match";
import { cn } from "@/components/ui/cn";
import { localePath } from "@/lib/i18n/paths";

/**
 * The header's page links, as a client component — because which page is
 * current is a property of the REQUEST PATH, and a server layout cannot see
 * it. The move is modeled on `locale-switcher.tsx` and draws the same line:
 * labels are passed in from the server (the shell owns the words), so this
 * component needs no i18n context and never ships the message catalogue; the
 * only client-side work it does over that is `usePathname()`.
 *
 * Every link is `min-w-tap` as well as `h-tap`: the floor is 44x44, not 44 tall.
 * `h-tap` alone left the shortest Arabic label content-sized at 43.4 px
 * (`الأدلة` at 768 px, measured in the G3 review pack) — 0.6 px under the floor,
 * because 27.4 px of text plus 2 x 8 px of padding is all that word needs. The
 * min-width is a FLOOR, so the longer labels are unchanged; `justify-center`
 * keeps a label whose text is narrower than the floor centred in the box rather
 * than pinned to the inline-start edge.
 *
 * The active link is marked `aria-current="page"` — the machine-readable way
 * to say "you are here", which screen readers announce before any colour or
 * typing could — plus the switcher's own selected treatment
 * (`bg-primary-soft text-primary`): one idiom for "current" on every shell
 * control. Matching is a section match, not an exact one: the compare page
 * (`/composants/comparer`) and a product page (`/composants/[slug]`) sit
 * UNDER Composants, so the section link says so. The section-boundary rule is
 * `isTabPath` in `components/shell/tab-match.ts` — the same function the bottom
 * tab bar uses, so the two navigations cannot disagree about which page is
 * current, and `/composants-x` lights nothing in either.
 *
 * `md+` ONLY (`hidden md:flex`), because that is what the design draws and
 * what PLAN.md specifies: at 360 px the Stitch header is the brand and the
 * language control, and the phone's navigation is the bottom tab bar, which
 * already carries these same three destinations. Visible, the links cost a
 * second wrapped row — a 118 px header measured at 360 px on 2026-11-03 —
 * on every phone page, duplicating three tab cells. A CSS breakpoint rather
 * than a conditional render: it cannot disagree with the tab bar's own
 * `md:hidden`, and the labels keep their home in one place either way.
 */
export function HeaderNav({
  locale,
  items,
}: {
  locale: string;
  items: Array<{ path: string; label: string }>;
}) {
  const pathname = usePathname() ?? "";
  const rest = localeRest(pathname, locale);

  return (
    <ul className="hidden items-center gap-x-1 md:flex">
      {items.map((item) => {
        const current = isTabPath(rest, item.path);
        return (
          <li key={item.path}>
            <Link
              href={localePath(locale, item.path)}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex h-tap min-w-tap items-center justify-center rounded-control px-2 text-compact",
                current ? "bg-primary-soft text-primary" : "text-muted hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
