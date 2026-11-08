import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { AnnouncementBanner } from "@/components/home/announcement-banner";
import type { PrimaryNavItem } from "@/components/layout/primary-nav";
import { MobileNav, type MobileNavItem } from "@/components/layout/mobile-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ApiProvider } from "@/components/providers/api-provider";
import { routing, type AppLocale } from "@/i18n/routing";

import "../globals.css";

/**
 * Root layout — the app has no `app/layout.tsx`, so this is the only one.
 * `lang` and `dir` are set from the route segment, in the FIRST byte of HTML:
 * an Arabic document must never paint LTR and then flip.
 *
 * Fonts: Inter is preloaded because both locales paint its Latin glyphs. IBM
 * Plex Sans Arabic is NOT preloaded — this layout serves both locales, and a
 * preload is document-level, so preloading the Arabic face would cost every
 * French visitor its files. `globals.css` applies it only under
 * `html[lang="ar"]`, which is where it is downloaded.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const arabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
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
  const t = await getTranslations({ locale: safe, namespace: "Metadata" });

  return {
    title: `${t("title")} — morocco-pc`,
    description: t("description"),
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

  const t = await getTranslations({ locale, namespace: "Shell" });
  const tBanner = await getTranslations({ locale, namespace: "Homepage.banner" });
  const tFooter = await getTranslations({ locale, namespace: "Homepage.footer" });
  const messages = (await import(`../../messages/${locale}.json`)).default;
  const dir = locale === "ar" ? "rtl" : "ltr";
  const appLocale = locale as AppLocale;

  // Anchors only: every destination is a section of this page, so the nav never
  // points at a route that does not exist.
  const primaryNavItems: readonly PrimaryNavItem[] = [
    { href: "#top", label: t("nav.home"), current: true },
    { href: "#simulateur", label: t("nav.configure") },
    { href: "#guides", label: t("nav.guides") },
  ];

  const mobileNavItems: readonly MobileNavItem[] = [
    { key: "home", href: "#top", label: t("nav.home"), current: true },
    // Components and Saved have no route yet: visibly disabled rather than
    // pointed somewhere unrelated.
    { key: "components", label: t("nav.components") },
    { key: "configure", href: "#simulateur", label: t("nav.configure") },
    { key: "guides", href: "#guides", label: t("nav.guides") },
    { key: "saved", label: t("nav.saved") },
  ];

  return (
    <html lang={locale} dir={dir} className={`${inter.variable} ${arabic.variable}`}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-foreground focus:shadow-level-2"
        >
          {t("skip")}
        </a>

        <NextIntlClientProvider locale={locale} messages={messages}>
          <ApiProvider>
            <AnnouncementBanner label={tBanner("label")} arabicBadge={tBanner("arabicBadge")} />

            <SiteHeader
              locale={appLocale}
              brand={t("brand")}
              navLabel={t("primaryNav")}
              languageLabel={t("language")}
              labels={{ fr: t("languageShort.fr"), ar: t("languageShort.ar") }}
              ariaLabels={{
                fr: t("switchTo", { language: t("languages.fr") }),
                ar: t("switchTo", { language: t("languages.ar") }),
              }}
              navItems={primaryNavItems}
            />

            <main
              id="main"
              className="mx-auto w-full max-w-page px-margin-mobile pb-24 md:px-margin lg:pb-16"
            >
              {children}
            </main>

            <div className="pb-24 lg:pb-0">
              <SiteFooter
                brand={t("brand")}
                tagline={t("footerTagline")}
                copyright={t("footerCopyright")}
                location={tFooter("location")}
                links={[
                  tFooter("links.about"),
                  tFooter("links.stores"),
                  tFooter("links.methodology"),
                  tFooter("links.contact"),
                ]}
              />
            </div>

            <MobileNav label={t("mobileNav")} items={mobileNavItems} />
          </ApiProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
