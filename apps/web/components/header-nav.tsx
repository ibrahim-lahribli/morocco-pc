"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/cn";

/**
 * The header's page links, as a client component — because which page is
 * current is a property of the REQUEST PATH, and a server layout cannot see
 * it. The move is modeled on `locale-switcher.tsx` and draws the same line:
 * labels are passed in from the server (the shell owns the words), so this
 * component needs no i18n context and never ships the message catalogue; the
 * only client-side work it does over that is `usePathname()`.
 *
 * The active link is marked `aria-current="page"` — the machine-readable way
 * to say "you are here", which screen readers announce before any colour or
 * typing could — plus the switcher's own selected treatment
 * (`bg-primary-soft text-primary`): one idiom for "current" on every shell
 * control. Matching is a section match, not an exact one: the compare page
 * (`/composants/comparer`) and a product page (`/composants/[slug]`) sit
 * UNDER Composants, so the section link says so. The trailing-slash guard
 * keeps a prefix from matching a sibling ("/composant" would).
 */
export function HeaderNav({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname() ?? "";

  return (
    <ul className="flex max-sm:basis-full max-sm:order-last items-center gap-x-1">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex h-tap items-center rounded-control px-2 text-compact",
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
