import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  presets: vi.fn(),
  detail: vi.fn(),
  meta: vi.fn(),
}));

vi.mock("@/lib/homepage/use-presets", () => ({
  useMetaOptions: () => mocks.meta(),
  usePresets: () => mocks.presets(),
  useRecommendationDetail: () => mocks.detail(),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) =>
    (key: string, values?: Record<string, unknown>): string =>
      values === undefined
        ? `${namespace}.${key}`
        : `${namespace}.${key}:${JSON.stringify(values)}`,
}));

import { HeroRigPreview } from "@/components/home/hero-rig-preview";

const shell = { eyebrow: "EB", caption: "CAP", details: "DET" };

const ladder = {
  data: {
    catalog_version: "v1",
    presets: [
      {
        budget_amount: 12_000,
        recommendation_id: "rec-GAMING-12000",
        build_score: 72.5,
        price_status: "verified",
      },
    ],
  },
  isPending: false,
};

describe("HeroRigPreview", () => {
  it("stays busy and shows no numbers while the ladder is pending", () => {
    mocks.meta.mockReturnValue({ currency: "MAD", useCases: [] });
    mocks.presets.mockReturnValue({ data: undefined, isPending: true });
    mocks.detail.mockReturnValue({ data: undefined });

    render(<HeroRigPreview {...shell} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
  });

  it("renders the served score and price for the 12 000 ceiling preset", () => {
    mocks.meta.mockReturnValue({ currency: "MAD", useCases: [] });
    mocks.presets.mockReturnValue(ladder);
    mocks.detail.mockReturnValue({
      data: {
        builds: [
          {
            build_score: 72.5,
            total_price: 11_500,
            price_status: "verified",
            components: [],
          },
        ],
      },
    });

    render(<HeroRigPreview {...shell} />);

    expect(screen.getByText(/72\.5/)).toBeInTheDocument();
    expect(screen.getByText(/11\s?500/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to the text shell when no preset qualifies", () => {
    mocks.meta.mockReturnValue({ currency: "MAD", useCases: [] });
    mocks.presets.mockReturnValue({
      data: { catalog_version: "v1", presets: [] },
      isPending: false,
    });
    mocks.detail.mockReturnValue({ data: undefined });

    render(<HeroRigPreview {...shell} />);

    expect(screen.getByText("EB")).toBeInTheDocument();
    expect(screen.getByText("DET")).toBeInTheDocument();
    expect(screen.queryByText(/72/)).not.toBeInTheDocument();
  });

  it("shows no score for a zero-build detail", () => {
    mocks.meta.mockReturnValue({ currency: "MAD", useCases: [] });
    mocks.presets.mockReturnValue(ladder);
    mocks.detail.mockReturnValue({ data: { builds: [] } });

    render(<HeroRigPreview {...shell} />);

    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
    expect(screen.getByText("DET")).toBeInTheDocument();
  });
});
