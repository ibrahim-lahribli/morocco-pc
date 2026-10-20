import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Alert, Badge, Button, ChoiceCard, ProgressBar } from "@/components/ui";
import { formatDate, formatMoney, formatPercent } from "@/lib/i18n/format";

/**
 * The S2 proof sheet: every token in `globals.css`, rendered.
 *
 * It is not a product screen and is not linked from navigation - it exists so
 * the tokens can be seen and so `e2e/tokens.spec.ts` has something real to
 * measure. S3's component kit gets its own story route with per-state frames.
 *
 * **The states below are the KIT's, not copies of it.** This page used to
 * re-implement Button, ChoiceCard, Badge, ProgressBar and Alert as raw markup,
 * because it was written before those components existed. The copies drifted
 * almost immediately: the price pills lost their icons (leaving colour as the
 * only signal between démo / indicatif / vérifié), and the selected card used a
 * literal 2 px border, reintroducing the 1 px layout shift S3 rejected. A token
 * sheet that demonstrates a component which is not the component is worse than
 * no demonstration, so the page now imports `@/components/ui` and shows what
 * ships.
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
        Les états ci-dessous sont les composants du kit, importés — pas des copies.
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
          <Button className="w-full">Continuer</Button>
          <Button variant="secondary" className="w-full">
            Retour
          </Button>
          <Button disabled className="w-full">
            Indisponible
          </Button>
          <p className="text-caption text-muted">
            Hauteur 48 px. Anneau de focus 2 px, décalé de 2 px (voir le bouton
            au clavier).
          </p>
        </div>

        {/* A radio group needs a NAME, not just a heading above it: the
            <legend> is what a screen reader announces before "1 sur 3". */}
        <fieldset className="mt-3 space-y-2.5">
          <legend className="mb-1.5 font-mono text-micro text-muted">
            Sélection — un seul choix
          </legend>
          <ChoiceCard
            name="tokens-usage"
            value="jeu"
            title="Jeu"
            description="Vidéo, photo et 3D."
            defaultChecked
          />
          <ChoiceCard
            name="tokens-usage"
            value="bureau"
            title="Bureau"
            description="Traitement de texte, navigation."
          />
          <ChoiceCard
            name="tokens-usage"
            value="station"
            title="Station de travail"
            description="Non applicable avec vos critères."
            disabled
          />
        </fieldset>
      </Section>

      <Section id="price" title="Badges de prix">
        <ul className="space-y-2 rounded-card border border-border bg-surface p-3.5">
          <li>
            <Badge tone="demo">Démo</Badge>
          </li>
          <li>
            <Badge tone="indicative">Indicatif</Badge>
          </li>
          <li>
            <Badge tone="verified">
              Vérifié ·{" "}
              {formatDate("2026-10-12T09:00:00.000Z", "fr", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </Badge>
          </li>
        </ul>
      </Section>

      <Section id="budget" title="Barre de budget">
        <div className="space-y-4 rounded-card border border-border bg-surface p-3.5">
          <ProgressBar
            label="Normal (79 %)"
            value={79}
            tone="normal"
            valueText={formatPercent(79 / 100, "fr")}
            detail={`Reste ${formatMoney(2100, "fr")}`}
          />
          <ProgressBar
            label="Avertissement (99 %)"
            value={99}
            tone="warning"
            valueText={formatPercent(99 / 100, "fr")}
            detail={`Reste ${formatMoney(100, "fr")}`}
          />
          <ProgressBar
            label="Dépassement (104 %)"
            value={10400}
            max={10000}
            tone="over"
            valueText={formatPercent(10400 / 10000, "fr")}
            detail={`Dépasse de ${formatMoney(400, "fr")}`}
          />
        </div>
      </Section>

      <Section id="alerts" title="Bannières">
        <div className="space-y-2">
          <Alert tone="info">Douze configurations correspondent à votre budget.</Alert>
          <Alert tone="warning">
            Prix indicatifs : dernière vérification le{" "}
            {formatDate("2026-10-12T09:00:00.000Z", "fr", { day: "numeric", month: "long" })}.
          </Alert>
          <Alert tone="error">
            Aucune configuration compatible. Augmentez le budget pour continuer.
          </Alert>
        </div>
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
