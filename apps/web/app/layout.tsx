import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "morocco-pc — Configurateur de PC",
  description:
    "Configurez votre PC sur mesure au Maroc : configurations compatibles, adaptées à votre budget et à votre usage, prix en dirhams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-black"
        >
          Aller au contenu principal
        </a>
        <header className="border-b border-neutral-200">
          <nav
            aria-label="Navigation principale"
            className="mx-auto w-full max-w-5xl px-4 py-4"
          >
            <Link href="/fr" className="font-semibold">
              morocco-pc
            </Link>
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-neutral-200">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-neutral-600">
            morocco-pc — configurateur de PC pour le marché marocain. Prix en
            dirhams (DH).
          </div>
        </footer>
      </body>
    </html>
  );
}
