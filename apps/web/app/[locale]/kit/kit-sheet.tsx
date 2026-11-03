"use client";

import { useState } from "react";

import { Alert, Button } from "@/components/ui";
import { Sheet } from "@/components/ui/sheet";
import { formatMoney } from "@/lib/i18n/format";

/**
 * The gallery's Sheet states.
 *
 * Imported from `./sheet` directly rather than through the `@/components/ui`
 * barrel on purpose: the barrel's header promises hookless modules usable in
 * server components, and this primitive is a client island.
 *
 * Both sheets pass `trigger`, which is how Radix learns what to return focus to.
 * Three states, because a sheet is only proven by the ones that break: a short
 * body, a long scrolling body (max-height + scroll containment), and a footer
 * action row.
 */
export function KitSheet() {
  const [short, setShort] = useState(false);
  const [long, setLong] = useState(false);

  return (
    <div className="space-y-3 rounded-card border border-border bg-surface p-3.5">
      <div>
        <p className="mb-1.5 font-mono text-micro text-muted">feuille · corps court</p>
        <Sheet
          open={short}
          onOpenChange={setShort}
          title="Changer le processeur"
          description="Le reste de la configuration ne change pas."
          closeLabel="Fermer"
          trigger={
            <Button variant="secondary" className="w-full">
              Ouvrir la feuille
            </Button>
          }
        >
          <Alert tone="info">
            Échap ferme cette feuille et rend le focus au bouton qui l’a ouverte.
          </Alert>
        </Sheet>
      </div>

      <div>
        <p className="mb-1.5 font-mono text-micro text-muted">
          feuille · corps long (défilement) + actions
        </p>
        <Sheet
          open={long}
          onOpenChange={setLong}
          title="Détail du prix"
          description="D’où vient ce montant, et à quel point il est fiable."
          closeLabel="Fermer"
          trigger={
            <Button variant="secondary" className="w-full">
              Ouvrir avec actions
            </Button>
          }
          footer={
            <>
              <Button className="w-full">Confirmer</Button>
              <Button variant="secondary" className="w-full" onClick={() => setLong(false)}>
                Annuler
              </Button>
            </>
          }
        >
          <ul className="space-y-3 text-compact text-ink">
            {Array.from({ length: 12 }, (_, index) => (
              <li key={index} className="flex items-center justify-between gap-3">
                <span className="text-muted">Ligne {index + 1}</span>
                <span className="num-tabular">{formatMoney(1200 + index * 250, "fr")}</span>
              </li>
            ))}
          </ul>
        </Sheet>
      </div>
    </div>
  );
}
