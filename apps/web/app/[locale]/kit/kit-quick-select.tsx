"use client";

import { useState } from "react";

import { BudgetPicker } from "@/components/ui/budget-picker";
import { ChoicePills } from "@/components/ui/choice-pills";
import { formatMoney, formatNumber } from "@/lib/i18n/format";

/**
 * The gallery's quick-select states: budget presets and a usage row.
 *
 * State lives here, not in the primitives — the kit's contract is that the only
 * stateful thing on a screen is the screen.
 */
export function KitQuickSelect() {
  const [budget, setBudget] = useState(8000);
  const [usage, setUsage] = useState("GAMING");

  return (
    <div className="space-y-5 rounded-card border border-border bg-surface p-3.5">
      <BudgetPicker
        name="kit-budget-preset"
        label="Votre budget"
        presets={[5000, 8000, 12000, 15000]}
        format={(amount) => formatNumber(amount, "fr")}
        value={budget}
        onChange={setBudget}
        hint={`Choisi : ${formatMoney(budget, "fr")} · l’entrée exacte reste dans le configurateur.`}
      />

      <ChoicePills
        name="kit-usage-pills"
        legend="Usage"
        options={[
          { value: "GAMING", label: "Jeux vidéo" },
          { value: "OFFICE", label: "Bureautique" },
          { value: "WORKSTATION", label: "Travail pro" },
          { value: "ML", label: "IA — bientôt", disabled: true },
        ]}
        value={usage}
        onChange={setUsage}
      />
    </div>
  );
}
