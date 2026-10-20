import type { Metadata } from "next";
import { Geist_Mono, IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/i18n/paths";
import Link from "next/link";

import "../globals.css";

/**
 * The root layout — and, since the app has no `app/layout.tsx`, the only one.
 * It is locale-shaped, which is why `lang` and `dir` are set here rather than in
 * a client effect: the direction has to be right in the FIRST byte of HTML, or
 * an Arabic page paints in the wrong direction and then flips.
 *
 * Fonts: Inter for Latin, IBM Plex Sans Arabic for Arabic. All three are
 * compiled by `next/font`, which self-hosts the files and injects
 * `size-adjust` fallback metrics (that is what makes the swap shift nothing).
 *
 * One cost is deliberate and KNOWN, measured 2026-10-20: there is one root
 * layout for both locales, so `preload` is decided for the document, not the
 * language. `/fr` therefore carries the Arabic face's preload tags — four subset
 * files, ~137 KB — for a page that renders no Arabic. Turning `preload` off was
 * tried and rejected in this review: it saves those bytes, but it also lets the
 * face swap AFTER first layout, and the Arabic label in the switcher then
 * reflows its neighbours by 3 px. `e2e/i18n.spec.ts` pins CLS at 0 (S5 scenario
 * 3), and a preloaded face is what makes that true. Closing the bytes needs
 * per-locale root layouts or a self-hosted face whose URL we can preload
 * conditionally; both are S6 budget work, not a one-line option.
 *
 * The variable class is applied for BOTH locales so the `--font-arabic` token
 * always resolves — without it, `font-arabic` is an undefined `var()` and silently
 * inherits Inter, which is what `/fr/tokens`' "IBM Plex Sans Arabic" specimen did
 * before this review. The BODY face stays locale-scoped in `globals.css`
 * (`html[lang="ar"] body`), so a French page paints in Inter.
 */

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  // Preloaded on BOTH locales because one layout serves both — 4 subset files,
  // ~137 KB, on every French page. See the header comment: removing `preload`
  // costs 0.0007 CLS, which the pinned scenario forbids.
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safe = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safe, namespace: "home" });
  return {
    title: `morocco-pc — ${t("title")}`,
    description: t("intro"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "shell" });
  const dir = locale === "ar" ? "rtl" : "ltr";
  // Both locales get all three classes: the Arabic class only defines a CSS
  // variable, and a face is downloaded only where an element uses the family.
  const fonts = [inter.variable, geistMono.variable, plexArabic.variable].join(" ");

  return (
    <html lang={locale} dir={dir} className={`${fonts} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-ink"
        >
          {t("skip")}
        </a>
        <header className="border-b border-border">
          <nav
            aria-label={t("navLabel")}
            className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3"
          >
            <Link href={localePath(locale, "/")} className="font-semibold text-ink">
              {t("brand")}
            </Link>
            <LocaleSwitcher
              label={t("language")}
              names={{ fr: t("switcher.fr"), ar: t("switcher.ar") }}
              active={locale}
            />
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-border">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 text-compact text-muted">
            <p>{t("footer")}</p>
            <Link
              href={localePath(locale, "/format")}
              className="mt-1 inline-block text-compact text-primary underline-offset-4 hover:underline"
            >
              {t("formats")}
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
