import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { preload } from "react-dom";

import { Analytics } from "@/components/analytics";
import { HeaderNav } from "@/components/header-nav";
import { ChipIcon } from "@/components/ui/icons";
import { TabNav, type TabNavItem } from "@/components/shell/tab-nav";
import { TAB_BAR_OFFSET } from "@/components/ui/bottom-tab-bar";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/i18n/paths";
import { siteOrigin } from "@/lib/seo/site";
import Link from "next/link";

import "../globals.css";

/**
 * The root layout — and, since the app has no `app/layout.tsx`, the only one.
 * It is locale-shaped, which is why `lang` and `dir` are set here rather than in
 * a client effect: the direction has to be right in the FIRST byte of HTML, or
 * an Arabic page paints in the wrong direction and then flips.
 *
 * Fonts: THREE faces, and exactly ONE of them is preloaded on every document.
 * Inter (`--font-sans`) is, because both locales paint it. The other two are not,
 * for the same reason `preload` is a document-level decision: a document that
 * does not paint a face should not fetch it.
 *
 *  - **Geist Mono** (`--font-mono`) stays on `next/font` with `preload: false`.
 *    Only the eyebrow labels and the token sheet use it, so its preload paid
 *    23 KB on `/fr` and `/ar`, which never paint it — measured 2026-10-20: `/fr`
 *    70 KB → 47 KB in one request. The `@font-face` still ships in the
 *    stylesheet, so the pages that DO use `font-mono` fetch the file on demand.
 *  - **IBM Plex Sans Arabic** is self-hosted from
 *    `public/fonts/ibm-plex-sans-arabic/` with an `@font-face` in `globals.css`,
 *    because `next/font` has no way to preload conditionally at all and this
 *    face is needed by `ar` alone.
 *
 * Why it is not `next/font` too: `next/font` preloads every face whose module is
 * evaluated, and this single layout serves `/fr` and `/ar`, so its Arabic face put
 * four subset files on every French page — measured 2026-10-20, `/fr` fetched
 * 206 KB of fonts to render one Latin family. Two repairs were measured and
 * rejected: a dynamic import of the face's module still leaves it in the layout's
 * build graph (the preloads remained), and `preload: false` on THAT face loses
 * CLS 0, because it then swaps after first layout and the switcher's Arabic label
 * reflows its neighbours by 3 px. Mono is the opposite case and is why the flag
 * is not a general rule: no element on `/fr` or `/ar` paints it, so nothing can
 * move when it arrives late. Owning the file means owning the URL, so the Arabic
 * preload follows `dir`.
 *
 * After the change, measured on the production build at 360×800: `/fr` downloads
 * 47 KB in ONE request (Inter, no mono, no Arabic), `/ar` 178 KB in four (Inter
 * plus three preloaded Arabic weights), and `/fr/tokens` 112 KB in three — the
 * token sheet is the one French page that paints both the Arabic specimen and
 * the mono labels, so it pulls both files on demand. `e2e/i18n.spec.ts` pins the
 * split: CLS 0 on `/ar`, zero Arabic preloads on every French page, and the mono
 * face loaded only where it is painted.
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
  // NOT preloaded: only this app's eyebrow labels and the token sheet use the
  // mono face, so a document-level preload pays 23 KB on pages that never paint
  // it (`/fr`, `/ar`). The @font-face still ships in the stylesheet, so a page
  // that does use `font-mono` fetches it lazily, and `next/font`'s
  // metric-adjusted fallback absorbs the swap — measured CLS 0 on `/fr/tokens`,
  // `/fr/kit` and `/fr/format`, which is what `e2e/i18n.spec.ts` pins.
  preload: false,
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

/**
 * The mobile tab bar's five cells (Phase 3). SHORT labels only: five of them
 * share 360 px, so the design's own rule is that "Enregistrements" cannot be
 * one of them — it is "Gardés" on the bar and keeps its long name in the
 * header, the footer and its own page's h1.
 *
 * `path` is locale-less on purpose: `TabNav` matches it against the URL and
 * builds the href with `localePath`, so this table has no idea which locale is
 * being rendered and cannot fork the rule.
 */
type TabItemRow = Omit<TabNavItem, "label"> & { labelKey: string };

const TAB_ITEMS: readonly TabItemRow[] = [
  { key: "home", path: "/", labelKey: "tabItems.home", icon: "home", raised: false },
  { key: "components", path: "/composants", labelKey: "tabItems.components", icon: "components", raised: false },
  { key: "configure", path: "/configurer", labelKey: "tabItems.configure", icon: "configure", raised: true },
  { key: "guides", path: "/guides", labelKey: "tabItems.guides", icon: "guides", raised: false },
  { key: "saved", path: "/enregistrements", labelKey: "tabItems.saved", icon: "saved", raised: false },
] as const satisfies readonly (Omit<TabNavItem, "label"> & { labelKey: string })[];

/**
 * The footer's link set (S22), in reading order: the three legal pages, then the
 * formats sheet. Declared as data so the list and its labels cannot drift apart,
 * and so a test can walk the same list the page renders.
 */
const FOOTER_LINKS = [
  { key: "legal.mentions", path: "/mentions-legales" },
  { key: "legal.privacy", path: "/confidentialite" },
  { key: "legal.contact", path: "/contact" },
  { key: "formats", path: "/format" },
] as const;

/**
 * T7: `viewport-fit=cover` is what makes `env(safe-area-inset-*)` non-zero on a
 * notched phone — without it the bottom tab bar and the sticky action bar sit
 * under the home indicator (review finding P2), and the `Sheet`'s footer row
 * with them. The bars own a `pb-[env(safe-area-inset-bottom,0px)]` class; this
 * export is what makes that class mean anything.
 *
 * Deliberately minimal: no `themeColor` (that would decide dark mode, D6,
 * by accident) and no `maximumScale` (locking zoom is an accessibility failure).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

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
    // S18: the ONE origin every absolute URL resolves from — file-based OG
    // images, and any relative metadata a future page adds. Deliberately
    // configuration (`lib/seo/site.ts`), never the request: a canonical built
    // from a Host header tells a crawler that a preview deployment is the
    // document and production is its duplicate. Each page still states its own
    // absolute canonical, so this is a base, not the answer.
    metadataBase: new URL(siteOrigin()),
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
  // The shelf's OWN words, not a second copy of them: the footer link and the
  // page's h1 must not be able to disagree about what the page is called.

  // The header's short nav labels (shell.navItems) are shell-owned: a header
  // link is a label, not the page's h1, and the shell already names sets of
  // links this way (`legalNav`, `savedNav`). The three destinations keep their
  // long names on their own pages.
  const tSaved = await getTranslations({ locale, namespace: "saved" });
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
      <body className={`flex min-h-full flex-col md:pb-0 ${TAB_BAR_OFFSET}`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-ink"
        >
          {t("skip")}
        </a>
        {/*
         * T6 RESTYLE (2026-11-03) — this block owns the header row.
         *
         * The row is the design's 64 px (`h-16`); the bar carries `shadow-card-1`
         * instead of a `border-b` (the export draws a soft shadow and no hairline),
         * and it pads for the TOP safe area the way the tab bar pads for the bottom
         * one — `env()` is physical on purpose in both places, and it only becomes
         * non-zero because the layout exports `viewportFit: "cover"`.
         *
         * The brand tile is DRAWN (D-22), not the export's remote placeholder
         * `<img>`, and it sits in this SERVER component so it costs HTML rather than
         * bundle bytes — the same glyph inside the client island would have shipped
         * in the chunk. The wordmark uses the design's `label-lg` step (14 px).
         *
         * The design's page subtitle is deliberately absent (D-23): it would be a
         * second owner of the page's name. The header stays in normal flow rather
         * than `fixed` (D-24), because `fixed` changes the scroll and paint path on
         * both measured routes.
         */}
        <header className="bg-surface pt-[env(safe-area-inset-top,0px)] shadow-card-1">
          <nav
            aria-label={t("navLabel")}
            className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-2 px-4"
          >
            <Link
              href={localePath(locale, "/")}
              className="flex h-tap items-center gap-2 rounded-control font-semibold text-primary"
            >
              {/* The mark is DRAWN, in the server tree: it renders in the first
                  byte of HTML and costs no script. The export's mark is a remote
                  placeholder <img> on lh3.googleusercontent.com (D-22). */}
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-control bg-primary text-on-primary"
              >
                <ChipIcon className="h-5 w-5" />
              </span>
              <span className="text-compact tracking-tight">{t("brand")}</span>
            </Link>
            {/*
             * The inline page links, as a list (they are navigation, not
             * prose). They are `md+` ONLY, which is the design's own header
             * and PLAN.md's "`md+` top nav": at 360 px the Stitch header
             * is the brand and the language control, and the phone's
             * navigation is the bottom tab bar — which already carries these
             * same three destinations. Visible at 360 px they cost a wrapped
             * second row (a 118 px header, measured 2026-11-03), duplicating
             * three tab cells on every phone page; `header-nav.tsx` owns the
             * breakpoint class. `px-2`, not `px-3`: the three links are
             * 307 px against the ~313 px a 360 px viewport offers after the
             * scrollbar, so px-3 overflowed by ~3 px, the horizontal
             * overflow S1 forbids — the tighter padding stays for the md row
             * they now occupy. Each link is `h-tap` (44 px, the
             * accessibility floor) with the same hover and focus
             * treatment as the locale switcher beside it, and no
             * direction-specific class anywhere: `dir` on <html> flips the
             * whole flex row, so the RTL mirror is free. The list is a
             * client component (`header-nav.tsx`) because "which page is
             * current" is request-path knowledge a server layout lacks — the
             * component owns the breakpoint, tap and aria-current logic; the
             * LABELS stay here, shell-owned, passed in as props.
             */}
            <HeaderNav
              locale={locale}
              items={[
                { path: "/composants", label: t("navItems.components") },
                { path: "/guides", label: t("navItems.guides") },
                { path: "/enregistrements", label: t("navItems.saved") },
              ]}
            />
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
        {/* Phase 3: the phone's navigation. Hidden from 768 px, where the
            header's own nav is on screen — two navigations with the same
            destinations is one too many. Its reserved space is released at the
            same breakpoint by the <body> padding above, so the last card is
            never behind the bar and no page is padded twice. */}
        <TabNav
          locale={locale}
          label={t("tabNav")}
          items={TAB_ITEMS.map((item) => ({
            key: item.key,
            path: item.path,
            icon: item.icon,
            raised: item.raised,
            label: t(item.labelKey),
          }))}
        />
        {/**
         * S22: the footer is the ONE place every page — the 404 included, since
         * that renders inside this layout — carries the legal links. A `nav`
         * with its own name, because a footer is a landmark and the links in it
         * are a set rather than a paragraph: a screen reader can jump to
         * "Informations légales" instead of tabbing through the page. The
         * formats sheet stays here as a fifth link — it is a demonstration
         * page, and the footer is where demonstration pages belong.
         *
         * S25: the shelf gets its OWN nav above that one, because it is not a
         * legal document and putting it in the "Informations légales" set would
         * make that landmark misdescribe itself. It now also has a header link
         * (visible from 768 px, like the header's other page links); the
         * footer copy STAYS, deliberately duplicated, because the footer is
         * the one place every page carries — the 404 included — and a user who
         * scrolled past the header still reaches the shelf from here.
         *
         * T7 RESTYLE (2026-11-03): the block is the export's centred column —
         * brand wordmark, then the link rows, then the price line — with NO
         * hairline (`border-t` is gone; the export draws none) and centred
         * inside the shell's measure rather than edge-aligned to it. The export
         * puts a `·` between the legal links. It is a decorative, `aria-hidden`
         * span that TRAILS its item rather than a `before:` pseudo-element: drawn
         * as a pseudo-element the separator belonged to the item that STARTED the
         * line, so a wrapped row began with a dangling `·` at 360 px in both
         * locales. Trailing it keeps one link per item — what `legal.spec.ts`
         * reads and `saved.spec.ts` scopes around — and a wrapped line starts
         * with a link.
         * The price line keeps the descriptive sentence rather than the export's
         * bare `© 2026` line (D-26: no clock read in the shell, and the sentence
         * already states the unit that line exists to state), and the two NAMED
         * landmarks stay so neither misdescribes its own set (the S25 rationale above).
         */}
        <footer className="mt-10 flex flex-col items-center gap-3 pb-4 pt-6 text-center">
          <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-4">
            <span className="text-compact font-bold text-primary">{t("brand")}</span>
            <nav aria-label={t("savedNav")}>
              <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-compact">
                <li>
                  <Link
                    href={localePath(locale, "/enregistrements")}
                    className="text-ink underline-offset-4 hover:text-primary hover:underline"
                  >
                    {tSaved("title")}
                  </Link>
                </li>
              </ul>
            </nav>
            <nav aria-label={t("legalNav")}>
              <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-compact">
                {FOOTER_LINKS.map((link, index) => (
                  <li key={link.key}>
                    <Link
                      href={localePath(locale, link.path)}
                      className="text-ink underline-offset-4 hover:text-primary hover:underline"
                    >
                      {t(link.key)}
                    </Link>
                    {index < FOOTER_LINKS.length - 1 ? (
                      <span aria-hidden="true" className="ms-3 text-outline-variant">·</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </nav>
            <p className="text-caption text-muted">{t("footer")}</p>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
