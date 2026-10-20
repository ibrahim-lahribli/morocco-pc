import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { preload } from "react-dom";

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
 * Fonts: Inter (`--font-sans`) and Geist Mono (`--font-mono`) come from
 * `next/font`, because they are the document's faces for BOTH locales and their
 * preload is never wasted. The Arabic face does not: it is self-hosted from
 * `public/fonts/ibm-plex-sans-arabic/` with an `@font-face` in `globals.css`, and
 * the preload below is conditional on the direction.
 *
 * Why it is not `next/font` too: `next/font` preloads every face whose module is
 * evaluated, and this single layout serves `/fr` and `/ar`, so its Arabic face put
 * four subset files on every French page — measured 2026-10-20, `/fr` fetched
 * 206 KB of fonts to render one Latin family. Two repairs were measured and
 * rejected: a dynamic import of the face's module still leaves it in the layout's
 * build graph (the preloads remained), and `preload: false` loses CLS 0, because
 * the face then swaps after first layout and the switcher's Arabic label reflows
 * its neighbours by 3 px. Owning the file means owning the URL, so the preload
 * follows `dir`.
 *
 * After the change, measured on the production build: `/fr` downloads 70 KB
 * (Inter + Mono, no Arabic), `/ar` downloads 201 KB (three preloaded Arabic
 * weights + Inter + Mono), and `/fr/tokens` pulls ONE Arabic file on demand
 * because its type specimen really displays Arabic. `e2e/i18n.spec.ts` pins both
 * halves: CLS 0 on `/ar`, and zero Arabic preloads on `/fr`.
 *
 * `globals.css` still scopes the BODY face to `html[lang="ar"]`, so a French page
 * paints in Inter and never switches.
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

/**
 * The Arabic face's preload list, by weight. `globals.css` declares all four
 * weights of the self-hosted face; 400 / 500 / 600 are the ones the shell paints
 * (body text, the `font-medium` switcher, the `font-semibold` brand and heading),
 * so they are fetched while the HTML is parsed and the face is ready before the
 * first layout. 700 is declared for display type and nothing on an Arabic page
 * uses it yet, so it loads on demand rather than costing every visitor.
 *
 * These paths are stable (a `public/` file, not a hashed build asset), which is
 * the whole reason the face was vendored — see the header comment.
 */
const ARABIC_PRELOAD = ["400", "500", "600"] as const;

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
  const fonts = [inter.variable, geistMono.variable].join(" ");
  // React 19's resource API: emits ONE <link rel="preload"> in <head>.
  // Rendering <link> in the tree instead emits a second copy (measurable in the
  // built HTML), because React hoists the element and keeps its own as well.
  // Same-origin font fetches are CORS-mode, so `crossOrigin: "anonymous"` is
  // what makes the preload share its cache entry with the @font-face — a
  // mismatch downloads every file twice.
  if (dir === "rtl") {
    for (const weight of ARABIC_PRELOAD) {
      preload(`/fonts/ibm-plex-sans-arabic/ibm-plex-sans-arabic-${weight}.woff2`, {
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      });
    }
  }

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
