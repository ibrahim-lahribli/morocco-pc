import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Alert, Badge, Button, ChoiceCard, ProgressBar, Skeleton, SkeletonCard, TextField } from "@/components/ui";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/i18n/format";
import { KitInteractive } from "./kit-interactive";

/**
 * The S3 story route: every component, every state the board draws.
 *
 * It is a proof sheet, not a screen — `noindex`, unlinked from navigation, and
 * each state labelled with the frame that defines it. S3's definition of done
 * asks for a per-state record; that record is this page plus
 * `docs/design/COMPONENTS.md`, which lists the geometry each state was measured
 * against, and `e2e/kit.spec.ts`, which asserts the parts a screenshot cannot
 * (roles, keyboard behaviour, target sizes, contrast).
 *
 * The page obeys the app's own rules on purpose: tokens only, logical
 * properties only, French copy in sentence case. If the story route cheated, the
 * token gate would have to exclude the one place a component is really used.
 */

export const metadata: Metadata = {
  title: "Kit de composants — morocco-pc",
  robots: { index: false, follow: false },
};

/**
 * The proof sheet is French, so it formats with the `fr` helpers from S5 rather
 * than typing an amount. The helper also settles the separator question S3
 * left open: `fr-MA` groups with a point, which reads as a decimal separator to
 * a French reader, so the shared helper normalizes grouping to a narrow
 * no-break space and writes the unit as `DH` — space-separated groups, as the
 * board draws them.
 */
const mad = (amount: number): string => formatMoney(amount, "fr");

function Section({
  id,
  title,
  source,
  children,
}: {
  id: string;
  title: string;
  source: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="mt-10">
      <h2 id={`${id}-title`} className="text-title text-ink">
        {title}
      </h2>
      <p className="mt-0.5 font-mono text-micro uppercase tracking-wider text-muted">{source}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 font-mono text-micro text-muted">{children}</p>;
}

// French-only, like `/tokens`: these are design proof sheets, not product
// screens. Serving them under `lang="ar"` would mispronounce French copy, and
// translating documentation nobody reads in Arabic is not the work.
export function generateStaticParams() {
  return [{ locale: "fr" }];
}

export default async function KitPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "fr") notFound();

  return (
    <article>
      <p className="font-mono text-caption uppercase tracking-wider text-primary">
        Système de design · S3
      </p>
      <h1 className="mt-1 text-heading text-ink">Kit de composants</h1>
      <p className="mt-3 max-w-prose text-body text-muted">
        Les huit composants de base, dans chaque état dessiné sur le tableau
        Stitch. Les mesures de contraste et les tailles sont vérifiées par les
        tests, pas à l’œil.
      </p>

      <Section id="buttons" title="Boutons" source="Tableau §4 — 48 px · rayon 8 px">
        <div className="space-y-3 rounded-card border border-border bg-surface p-3.5">
          <div>
            <StateLabel>primaire · actif</StateLabel>
            <Button className="w-full">Continuer</Button>
          </div>
          <div>
            <StateLabel>secondaire</StateLabel>
            <Button variant="secondary" className="w-full">
              Retour
            </Button>
          </div>
          <div>
            <StateLabel>lien / texte</StateLabel>
            <Button variant="ghost" className="w-full">
              Modifier le budget
            </Button>
          </div>
          <div>
            <StateLabel>whatsapp · partage</StateLabel>
            <Button variant="whatsapp" className="w-full">
              Partager sur WhatsApp
            </Button>
          </div>
          <div>
            <StateLabel>désactivé — bordure, pas seulement l’opacité</StateLabel>
            <Button disabled className="w-full">
              Indisponible
            </Button>
          </div>
          <div>
            <StateLabel>compact · 44 px — actions secondaires dans une carte</StateLabel>
            <Button variant="secondary" size="compact">
              Changer
            </Button>
          </div>
        </div>
      </Section>

      <Section id="interactive" title="Budget : champ, curseur, barre" source="Tableau §8 et §10 — synchronisés">
        <KitInteractive />
      </Section>

      <Section id="text-field" title="Champ de texte" source="Tableau §8 — 48 px · unité MAD dans le champ">
        <div className="space-y-4 rounded-card border border-border bg-surface p-3.5">
          <div>
            <StateLabel>rempli · paliers de 500 MAD</StateLabel>
            <TextField
              id="kit-budget"
              label="Votre enveloppe cible"
              suffix="MAD"
              defaultValue={formatNumber(8500, "fr")}
              inputMode="numeric"
              hint="Paliers de 500 MAD."
            />
          </div>
          <div>
            <StateLabel>erreur · valeur sous le plancher</StateLabel>
            <TextField
              id="kit-budget-error"
              label="Votre enveloppe cible"
              suffix="MAD"
              defaultValue={formatNumber(1500, "fr")}
              inputMode="numeric"
              error={`Le budget minimal est de ${mad(3000)}.`}
            />
          </div>
          <div>
            <StateLabel>sans unité · libellé seul</StateLabel>
            <TextField id="kit-query" label="Nom du profil" placeholder="Ex. Gamer équilibré" />
          </div>
        </div>
      </Section>

      <Section id="choice-cards" title="Cartes d’option" source="Tableau §6 — radio natif · 48 px minimum">
        {/* The group's NAME comes from a <legend>, not from the paragraph a
            sighted user reads above it. This is the pattern S7 must copy. */}
        <fieldset className="space-y-2.5">
          <legend className="mb-1.5 font-mono text-micro text-muted">
            Usage — flèches pour changer, Tab pour sortir
          </legend>
          <ChoiceCard
            name="kit-usage"
            value="jeu"
            title="Jeu"
            description="Vidéo, photo et 3D."
            defaultChecked
          />
          <ChoiceCard name="kit-usage" value="bureau" title="Bureau" description="Traitement de texte, navigation." />
          <ChoiceCard
            name="kit-usage"
            value="station"
            title="Station de travail"
            description="Non applicable avec vos critères précédents."
            disabled
          />
        </fieldset>
      </Section>

      <Section id="badges" title="Badges de prix" source="Tableau §9 — pilule · icône + texte">
        <ul className="space-y-3 rounded-card border border-border bg-surface p-3.5">
          <li className="flex items-center justify-between gap-3">
            <span className="text-caption text-muted">Exemple initial</span>
            <Badge tone="demo">Démo</Badge>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span className="text-caption text-muted">Estimation courante</span>
            <Badge tone="indicative">Indicatif</Badge>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span className="text-caption text-muted">Prix validé</span>
            <Badge tone="verified">
              <span className="num-tabular">
                Vérifié · {formatDate("2026-10-12T09:00:00.000Z", "fr", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </Badge>
          </li>
        </ul>
      </Section>

      <Section id="budget-bar" title="Barre de budget" source="Tableau §10 — rail 10 px · trois tons">
        <div className="space-y-5 rounded-card border border-border bg-surface p-3.5">
          <ProgressBar
            label="Normal (79 %)"
            value={79}
            tone="normal"
            valueText={formatPercent(79 / 100, "fr")}
            detail={`Reste ${mad(2100)}`}
            caption={`${mad(7900)} engagés · budget ${mad(10000)}`}
          />
          <ProgressBar
            label="Avertissement (99 %)"
            value={99}
            tone="warning"
            valueText={formatPercent(99 / 100, "fr")}
            detail={`Reste ${mad(100)}`}
            caption={`${mad(9900)} engagés · budget ${mad(10000)}`}
          />
          <ProgressBar
            label="Dépassement (104 %)"
            value={10400}
            max={10000}
            tone="over"
            valueText={formatPercent(10400 / 10000, "fr")}
            detail={`Dépasse de ${mad(400)}`}
            caption={`${mad(10400)} engagés · budget ${mad(10000)}`}
          />
        </div>
      </Section>

      <Section id="skeleton" title="Squelette" source="Tableau §15 — blocs track · pulsation désactivable">
        <div className="space-y-3">
          <SkeletonCard />
          <div className="space-y-3 rounded-card border border-border bg-surface p-3.5">
            <Skeleton className="h-4 w-1/3 rounded" />
            <Skeleton className="h-3 w-3/4 rounded" />
          </div>
        </div>
      </Section>

      <Section id="alerts" title="Bannières" source="Tableau §16 — 12 px · bordure à 20 %">
        <div className="space-y-2">
          <Alert tone="info">
            Les prix affichés sont des exemples tant qu’ils ne sont pas marqués Vérifié.
          </Alert>
          <Alert tone="warning">
            Votre budget est presque atteint : il reste {mad(100)}.
          </Alert>
          <Alert tone="error">
            Aucune configuration compatible. Augmentez le budget pour continuer.
          </Alert>
          <Alert tone="info" role="status">
            Douze configurations correspondent à votre budget.
          </Alert>
        </div>
      </Section>
    </article>
  );
}