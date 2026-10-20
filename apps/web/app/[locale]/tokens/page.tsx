import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { formatDate, formatMoney } from "@/lib/i18n/format";

/**
 * The S2 proof sheet: every token in `globals.css`, rendered.
 *
 * It is not a product screen and is not linked from navigation - it exists so
 * the tokens can be seen and so `e2e/tokens.spec.ts` has something real to
 * measure. S3's component kit gets its own story route with per-state frames.
 *
 * Rules this page obeys because the whole app must:
 *   - no raw hex and no raw palette class (`stone-200`, `white`, `black`);
 *   - logical properties only (`ms/me`, `ps/pe`, `start/end`, `text-start`);
 *   - 48 px minimum for anything interactive.
 */

export const metadata: Metadata = {
  title: "Jetons de design — morocco-pc",
  robots: { index: false, follow: false },
};

type Swatch = { name: string; className: string; role: string; soft?: boolean };

const BRAND: Swatch[] = [
  { name: "primary", className: "bg-primary", role: "Actions, liens, sélection" },
  { name: "primary-soft", className: "bg-primary-soft", role: "Fond sélectionné", soft: true },
  { name: "primary-hover", className: "bg-primary-hover", role: "État pressé" },
  { name: "accent", className: "bg-accent", role: "Accent, jamais du texte" },
  { name: "whatsapp", className: "bg-whatsapp", role: "Partage WhatsApp" },
  { name: "surface", className: "bg-surface", role: "Cartes", soft: true },
];

const NEUTRAL: Swatch[] = [
  { name: "page", className: "bg-page", role: "Fond de page", soft: true },
  { name: "subtle", className: "bg-subtle", role: "Fond secondaire", soft: true },
  { name: "border", className: "bg-border", role: "Bordures, rails" },
  { name: "muted", className: "bg-muted", role: "Texte secondaire" },
  { name: "ink", className: "bg-ink", role: "Texte principal" },
  { name: "placeholder", className: "bg-placeholder", role: "Indications" },
];

const STATES: Swatch[] = [
  { name: "success", className: "bg-success", role: "Vérifié" },
  { name: "warning", className: "bg-warning", role: "Indicatif" },
  { name: "error", className: "bg-error", role: "Erreur, dépassement" },
  { name: "info", className: "bg-info", role: "Information" },
  { name: "success-soft", className: "bg-success-soft", role: "Fond vérifié", soft: true },
  { name: "warning-soft", className: "bg-warning-soft", role: "Fond indicatif", soft: true },
];

const TYPE = [
  { name: "display", className: "text-display", note: "30 / 1.25 / 700 · total, chiffre clé" },
  { name: "heading", className: "text-heading", note: "24 / 1.25 / 700" },
  { name: "title", className: "text-title", note: "20 / 1.25 / 700" },
  { name: "subtitle", className: "text-subtitle", note: "18 / 1.375 / 600" },
  { name: "body", className: "text-body", note: "16 / 1.5 / 400" },
  { name: "compact", className: "text-compact", note: "14 / 1.43 / 400" },
  { name: "caption", className: "text-caption", note: "12 / 1.33 / 400" },
  { name: "micro", className: "text-micro", note: "11 / 1.45 / 400 · libellés mono" },
];

function SwatchCard({ token }: { token: Swatch }) {
  return (
    <li className="rounded-card border border-border bg-surface p-2.5">
      <div className={`h-10 w-full rounded-control ${token.className} ${token.soft ? "border border-border" : ""}`} />
      <p className="mt-2 font-mono text-micro text-ink">{token.name}</p>
      <p className="text-caption text-muted">{token.role}</p>
    </li>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="mt-10">
      <h2 id={`${id}-title`} className="text-title text-ink">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// The proof sheets are French design documentation. Rendering them under
// `lang="ar"` would tell a screen reader to pronounce French as Arabic, so they
// exist only in `fr` — an honest 404 beats a mislabelled page. S20 translates
// the product screens; these are not product screens.
export function generateStaticParams() {
  return [{ locale: "fr" }];
}

export default async function TokensPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "fr") notFound();

  return (
    <article>
      <p className="font-mono text-caption uppercase tracking-wider text-primary">
        Système de design
      </p>
      <h1 className="mt-1 text-heading text-ink">Jetons de design</h1>
      <p className="mt-3 max-w-prose text-body text-muted">
        Extrait du tableau de design Stitch et rendu ici pour être mesuré. Les
        ratios de contraste ne sont pas estimés : ils sont calculés par
        <span className="font-mono text-compact text-ink"> e2e/tokens.spec.ts</span>.
      </p>

      <Section id="brand" title="Marque">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BRAND.map((token) => (
            <SwatchCard key={token.name} token={token} />
          ))}
        </ul>
      </Section>

      <Section id="neutral" title="Neutres">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {NEUTRAL.map((token) => (
            <SwatchCard key={token.name} token={token} />
          ))}
        </ul>
      </Section>

      <Section id="states" title="États sémantiques">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STATES.map((token) => (
            <SwatchCard key={token.name} token={token} />
          ))}
        </ul>
      </Section>

      <Section id="type" title="Typographie">
        <div className="rounded-card border border-border bg-surface p-4">
          <ul className="divide-y divide-border">
            {TYPE.map((step) => (
              <li key={step.name} className="py-2.5">
                <p className={`${step.className} text-ink`}>Config Gamer Équilibrée</p>
                <p className="mt-1 font-mono text-micro text-muted">
                  {step.name} · {step.note}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-border pt-3 text-compact text-muted">
            Inter (latin) ·{" "}
            {/* The specimen must be ARABIC text: the family's `unicode-range`
                covers the Arabic block only, so the Latin string "IBM Plex Sans
                Arabic" would render in Inter and prove nothing. This span is the
                one place on a French page that pulls the Arabic file — on demand,
                with no preload. */}
            <span lang="ar" dir="rtl" className="font-arabic text-ink">
              ميزانيتكم الحالية
            </span>{" "}
            (IBM Plex Sans Arabic) ·{" "}
            <span className="num-tabular text-ink">{formatMoney(12500, "fr")}</span> en chiffres
            tabulaires.
          </p>
        </div>
      </Section>

      <Section id="controls" title="Commandes">
        <div className="space-y-3 rounded-card border border-border bg-surface p-3.5">
          <button className="h-control w-full rounded-control bg-primary px-4 text-body font-medium text-surface active:bg-primary-hover">
            Continuer
          </button>
          <button className="h-control w-full rounded-control border border-border bg-surface px-4 text-body font-medium text-ink active:bg-page">
            Retour
          </button>
          <button
            disabled
            className="h-control w-full cursor-not-allowed rounded-control border border-border bg-subtle px-4 text-body font-medium text-muted/70"
          >
            Indisponible
          </button>
          <p className="text-caption text-muted">
            Hauteur 48 px. Anneau de focus 2 px, décalé de 2 px (voir le bouton
            au clavier).
          </p>
        </div>

        <ul className="mt-3 space-y-2.5">
          <li className="flex min-h-control items-start gap-3 rounded-card border-2 border-primary bg-primary-soft p-3.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary">
              <span className="h-2 w-2 rounded-full bg-surface" />
            </span>
            <span>
              <span className="block text-body font-semibold text-primary">Jeu</span>
              <span className="block text-caption text-muted">Vidéo, photo et 3D.</span>
            </span>
          </li>
          <li className="flex min-h-control items-start gap-3 rounded-card border border-border bg-surface p-3.5">
            <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-border" />
            <span>
              <span className="block text-body font-medium text-ink">Bureau</span>
              <span className="block text-caption text-muted">Traitement de texte, navigation.</span>
            </span>
          </li>
          <li className="flex min-h-control cursor-not-allowed items-start gap-3 rounded-card border border-dashed border-border bg-subtle p-3.5 opacity-60">
            <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-muted/40 bg-track" />
            <span>
              <span className="block text-body font-medium text-muted">Station de travail</span>
              <span className="block text-caption text-muted">Non applicable avec vos critères.</span>
            </span>
          </li>
        </ul>
      </Section>

      <Section id="price" title="Badges de prix">
        <ul className="space-y-2 rounded-card border border-border bg-surface p-3.5">
          <li>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-dashed border-muted/60 bg-subtle px-2.5 py-1 text-caption font-medium text-muted">
              Démo
            </span>
          </li>
          <li>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-warning/30 bg-warning-soft px-2.5 py-1 text-caption font-medium text-warning">
              Indicatif
            </span>
          </li>
          <li>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-success/30 bg-success-soft px-2.5 py-1 text-caption font-medium text-success">
              Vérifié · {formatDate("2026-10-12T09:00:00.000Z", "fr", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          </li>
        </ul>
      </Section>

      <Section id="budget" title="Barre de budget">
        <div className="space-y-4 rounded-card border border-border bg-surface p-3.5">
          <div>
            <div className="flex items-baseline justify-between text-caption">
              <span className="font-medium text-ink">Normal (79 %)</span>
              <span className="num-tabular font-semibold text-success">
                Reste {formatMoney(2100, "fr")}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-pill bg-track">
              <div className="h-full w-[79%] rounded-pill bg-primary" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between text-caption">
              <span className="font-medium text-ink">Avertissement (99 %)</span>
              <span className="num-tabular font-semibold text-warning">
                Reste {formatMoney(100, "fr")}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-pill bg-track">
              <div className="h-full w-[99%] rounded-pill bg-warning" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between text-caption">
              <span className="font-medium text-ink">Dépassement (104 %)</span>
              <span className="num-tabular font-semibold text-error">
                Dépasse de {formatMoney(400, "fr")}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-pill bg-track">
              <div className="h-full w-full rounded-pill bg-error" />
            </div>
          </div>
        </div>
      </Section>

      <Section id="alerts" title="Bannières">
        <ul className="space-y-2">
          <li className="flex items-start gap-2.5 rounded-control border border-info/20 bg-info-soft p-3">
            <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-info" />
            <p className="text-caption text-ink">
              Douze configurations correspondent à votre budget.
            </p>
          </li>
          <li className="flex items-start gap-2.5 rounded-control border border-warning/20 bg-warning-soft p-3">
            <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-warning" />
            <p className="text-caption text-ink">
              Prix indicatifs : la dernière vérification date du 12 octobre.
            </p>
          </li>
          <li className="flex items-start gap-2.5 rounded-control border border-error/20 bg-error-soft p-3">
            <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-error" />
            <p className="text-caption text-ink">
              Aucune configuration compatible. Augmentez le budget pour continuer.
            </p>
          </li>
        </ul>
      </Section>

      <Section id="rtl" title="Mise en page RTL">
        <div dir="rtl" lang="ar" className="rounded-card border border-border bg-surface p-3.5">
          <p className="text-body text-ink">ميزانيتكم</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-6 w-6 rounded-control bg-primary-soft" />
            <span className="ms-2 text-caption text-muted">
              الحشوة تتبع بداية السطر، لا اليسار.
            </span>
            <span className="ms-auto rounded-pill bg-primary-soft px-2 py-1 text-caption text-primary">
              ms-auto
            </span>
          </div>
        </div>
      </Section>
    </article>
  );
}
