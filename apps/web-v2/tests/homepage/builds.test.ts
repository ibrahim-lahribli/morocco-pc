import { describe, expect, it } from "vitest";

import type { Preset } from "@/lib/api/types";
import {
  HOMEPAGE_BUDGET_CEILING,
  resolvePriceBadge,
  selectPresetAtOrBelow,
  specPillNames,
  toBuildCardView,
} from "@/lib/homepage/builds";

const preset = (budget_amount: number, extra: Partial<Preset> = {}): Preset => ({
  budget_amount,
  recommendation_id: `rec-${budget_amount}`,
  build_score: 61.25,
  price_status: "indicative",
  ...extra,
});

describe("selectPresetAtOrBelow", () => {
  const ladder = [5_000, 8_000, 12_000, 15_000].map((budget) => preset(budget));

  it("selects the highest preset at or below the 12 000 ceiling", () => {
    expect(selectPresetAtOrBelow(ladder, HOMEPAGE_BUDGET_CEILING)?.budget_amount).toBe(12_000);
  });

  it("never selects the 15 000 preset for the ceiling", () => {
    const chosen = selectPresetAtOrBelow(ladder, HOMEPAGE_BUDGET_CEILING);

    expect(chosen).not.toBeNull();
    expect(chosen?.budget_amount).toBeLessThanOrEqual(HOMEPAGE_BUDGET_CEILING);
  });

  it("does not fall back to the median of the ladder", () => {
    const odd = [4_000, 6_000, 12_000].map((budget) => preset(budget));

    expect(selectPresetAtOrBelow(odd, HOMEPAGE_BUDGET_CEILING)?.budget_amount).toBe(12_000);
  });

  it("is independent of the response order", () => {
    const shuffled = [15_000, 8_000, 12_000, 5_000].map((budget) => preset(budget));

    expect(selectPresetAtOrBelow(shuffled, HOMEPAGE_BUDGET_CEILING)?.budget_amount).toBe(12_000);
  });

  it("includes the ceiling and excludes one dirham above it", () => {
    expect(
      selectPresetAtOrBelow([preset(12_000), preset(12_001)], HOMEPAGE_BUDGET_CEILING)
        ?.budget_amount,
    ).toBe(12_000);
    expect(selectPresetAtOrBelow([preset(12_001)], HOMEPAGE_BUDGET_CEILING)).toBeNull();
  });

  it("returns null when no preset qualifies", () => {
    expect(selectPresetAtOrBelow([], HOMEPAGE_BUDGET_CEILING)).toBeNull();
    expect(selectPresetAtOrBelow([preset(15_000)], HOMEPAGE_BUDGET_CEILING)).toBeNull();
  });
});

describe("resolvePriceBadge", () => {
  const build = (price_status: unknown) => ({ price_status }) as never;

  it("maps a verified rank-1 build to verified", () => {
    expect(resolvePriceBadge([build("verified")])).toBe("verified");
  });

  it("maps an indicative rank-1 build to indicative", () => {
    expect(resolvePriceBadge([build("indicative")])).toBe("indicative");
  });

  it("returns null for a null or unknown status even though the contract forbids it", () => {
    expect(resolvePriceBadge([build(null)])).toBeNull();
    expect(resolvePriceBadge([build("unknown")])).toBeNull();
  });

  it("returns null for an empty build list", () => {
    expect(resolvePriceBadge([])).toBeNull();
  });
});

describe("toBuildCardView", () => {
  const verifiedPreset = preset(12_000, { price_status: "verified" });

  it("never takes the badge from the preset when there is no build", () => {
    expect(toBuildCardView(verifiedPreset, undefined).badge).toBeNull();
    expect(toBuildCardView(verifiedPreset, { builds: [] } as never).badge).toBeNull();
  });

  it("keeps the budget line but renders no price when total_price is null", () => {
    const view = toBuildCardView(verifiedPreset, {
      currency: "MAD",
      builds: [
        {
          total_price: null,
          build_score: 70,
          price_status: "verified",
          components: [],
          explanation: null,
        },
      ],
    } as never);

    expect(view.totalPrice).toBeNull();
    expect(view.budgetAmount).toBe(12_000);
  });

  it("takes the build's own status when a build exists", () => {
    const view = toBuildCardView(preset(12_000, { price_status: null }), {
      currency: "MAD",
      builds: [
        {
          total_price: 11_500,
          build_score: 70,
          price_status: "indicative",
          components: [],
          explanation: null,
        },
      ],
    } as never);

    expect(view.badge).toBe("indicative");
  });

  it("orders the spec pills by role and caps them at four", () => {
    const names = specPillNames([
      { role: "PSU", name: "PSU 650W" },
      { role: "SSD_BOOT", name: "NVMe 1TB" },
      { role: "GPU", name: "RTX 4060" },
      { role: "CASE", name: "Case" },
      { role: "RAM", name: "32 Go" },
      { role: "CPU", name: "Ryzen 5 5600" },
    ] as never);

    expect(names).toEqual(["Ryzen 5 5600", "RTX 4060", "32 Go", "NVMe 1TB"]);
  });

  it("reports an empty build list as no complete build", () => {
    expect(toBuildCardView(verifiedPreset, { builds: [] } as never).hasCompleteBuild).toBe(false);
  });
});
