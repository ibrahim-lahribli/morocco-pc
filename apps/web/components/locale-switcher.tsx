"use client";

import { usePathname } from "next/navigation";

import { routing } from "@/i18n/routing";
import { cn } from "@/components/ui/cn";

/**
 * The locale switcher, as two plain <a> elements.
 *
 * Why not next-intl's `Link` or `useLocale` here: both read the i18n context in
 * a client component, which means wrapping the app in
 * `NextIntlClientProvider` — that ships the whole message catalogue to the
 * browser so two links can know which one is current. The locale is already
 * known on the server; it arrives as `active`. The only client-side work is
 * reading the current path, and `next/navigation` gives that with no context.
 *
 * The href is computed from `active` + the current path, because the routing is
 * `localePrefix: "always"` (`/fr/...`, `/ar/...`). A full navigation — not a
 * client-side transition — is correct for a language switch: it is a different
 * document with its own `lang` and `dir`, and `router.push` would have to
 * re-render the root layout anyway.
 *
 * Language names stay endonyms ("Français", "العربية"): a translator never
 * translates them, and a user who cannot read the current language must still
 * recognise their own.
 */
export function LocaleSwitcher({
  label,
  names,
  active,
}: {
  label: string;
  names: Record<string, string>;
  active: string;
}) {
  const pathname = usePathname() ?? "/";
  // "/fr/format" -> "/format"; "/fr" -> "".
  const rest = pathname.startsWith(`/${active}`)
    ? pathname.slice(active.length + 1)
    : pathname;

  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-control border border-border bg-surface p-1"
    >
      {routing.locales.map((code) => {
        const current = code === active;
        return (
          <a
            key={code}
            href={`/${code}${rest === "/" ? "" : rest}`}
            hrefLang={code}
            lang={code}
            aria-current={current ? "true" : undefined}
            className={cn(
              "inline-flex h-tap items-center justify-center rounded-control px-3 text-compact font-medium",
              current ? "bg-primary-soft text-primary" : "text-muted hover:text-ink",
            )}
          >
            {names[code] ?? code}
          </a>
        );
      })}
    </div>
  );
}
