"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import { ExplainerSheet } from "@/components/ui/explainer-sheet";

/**
 * The gallery's ExplainerSheet state.
 *
 * State lives here, not in the primitive: the kit's contract is that the only
 * stateful thing on a screen is the screen. The trigger is passed so Radix owns
 * the focus return — the failure `e2e/kit.spec.ts` caught for `Sheet`.
 */
export function KitExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-card border border-border bg-surface p-3.5">
      <p className="mb-1.5 font-mono text-micro text-muted">
        feuille explicative · poignée + sur-titre + texte
      </p>
      <ExplainerSheet
        open={open}
        onOpenChange={setOpen}
        eyebrow="Prix"
        title="D’où vient ce montant"
        closeLabel="Fermer"
        description="Le prix affiché est la somme des pièces retenues."
        trigger={
          <Button variant="secondary" className="w-full">
            Ouvrir l’explication
          </Button>
        }
      >
        <p>
          Chaque pièce porte un prix issu d’une offre. Tant que cette offre n’a pas
          été relevée chez un marchand, le prix reste indicatif et le badge le dit.
        </p>
        <p className="mt-3">
          La même feuille sert aux filtres du catalogue : un seul mécanisme, un seul
          piège de focus, une seule restitution du focus.
        </p>
      </ExplainerSheet>
    </div>
  );
}
