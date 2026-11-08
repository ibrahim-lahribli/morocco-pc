import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  presets: vi.fn(),
  detail: vi.fn(),
  meta: vi.fn(),
  locale: vi.fn(() => "fr"),
}));

vi.mock("@/lib/homepage/use-presets", () => ({
  useMetaOptions: () => mocks.meta(),
  usePresets: () => mocks.presets(),
  useRecommendationDetail: () => mocks.detail(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => mocks.locale(),
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

const build = {
  build_score: 72.5,
  total_price: 11_500,
  price_status: "verified",
  components: [
    { role: "CPU", product_id: "cpu", name: "AMD Ryzen 5 5600", slug: "cpu", variant: null },
  ],
};

const success = { data: { builds: [build] }, isPending: false, error: null };

function arrange(
  presets: { data?: unknown; isPending: boolean },
  detail: { data?: unknown; isPending: boolean; error?: unknown },
  locale = "fr",
) {
  mocks.meta.mockReturnValue({ currency: "MAD", useCases: [] });
  mocks.presets.mockReturnValue(presets);
  mocks.detail.mockReturnValue({ error: null, ...detail });
  mocks.locale.mockReturnValue(locale);
  render(<HeroRigPreview {...shell} />);
}

describe("HeroRigPreview", () => {
  it("stays busy and shows no numbers while the ladder is pending", () => {
    arrange({ data: undefined, isPending: true }, success);

    expect(screen.getByRole("status")).toHaveTextContent("Homepage.builds.loading");
    expect(screen.queryByText(/72/)).not.toBeInTheDocument();
    expect(screen.queryByText(/11\s?500/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ryzen/)).not.toBeInTheDocument();
  });

  it("stays busy while the selected preset's detail loads", () => {
    arrange(ladder, { data: undefined, isPending: true });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/72/)).not.toBeInTheDocument();
    expect(screen.queryByText(/11\s?500/)).not.toBeInTheDocument();
  });

  it("keeps the text shell when the ladder is empty", () => {
    arrange({ data: { catalog_version: "v1", presets: [] }, isPending: false }, success);

    expect(screen.getByText("DET")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/72/)).not.toBeInTheDocument();
    expect(screen.queryByText(/11\s?500/)).not.toBeInTheDocument();
  });

  it("shows no score or price for a zero-build detail", () => {
    arrange(ladder, { data: { builds: [] }, isPending: false });

    expect(screen.getByText("Homepage.builds.category.gaming")).toBeInTheDocument();
    expect(screen.getByText("DET")).toBeInTheDocument();
    expect(screen.queryByText(/72/)).not.toBeInTheDocument();
    expect(screen.queryByText(/11\s?500/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("invents nothing when the detail 404s", () => {
    arrange(ladder, {
      data: undefined,
      isPending: false,
      error: Object.assign(new Error("404"), { status: 404 }),
    });

    expect(screen.getByText("DET")).toBeInTheDocument();
    expect(screen.queryByText(/72/)).not.toBeInTheDocument();
    expect(screen.queryByText(/11\s?500/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("invents nothing when the detail request fails", () => {
    arrange(ladder, {
      data: undefined,
      isPending: false,
      error: Object.assign(new Error("500"), { status: 500 }),
    });

    expect(screen.getByText("DET")).toBeInTheDocument();
    expect(screen.queryByText(/72/)).not.toBeInTheDocument();
    expect(screen.queryByText(/11\s?500/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders the served score with the French decimal comma", () => {
    arrange(ladder, success, "fr");

    expect(screen.getByText(/72,5/)).toBeInTheDocument();
    expect(screen.queryByText(/72\.5/)).not.toBeInTheDocument();
    expect(screen.getByText(/11\s?500/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders the served score with the Arabic decimal point", () => {
    arrange(ladder, success, "ar");

    expect(screen.getByText(/72\.5/)).toBeInTheDocument();
    expect(screen.queryByText(/72,5/)).not.toBeInTheDocument();
  });
});
