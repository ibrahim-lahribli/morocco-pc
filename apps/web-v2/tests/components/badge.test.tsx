import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders the verified tone with the emerald token classes", () => {
    render(<Badge tone="verified">Vérifié</Badge>);
    const badge = screen.getByText("Vérifié");

    expect(badge.className).toContain("bg-verified-soft");
    expect(badge.className).toContain("text-verified");
    expect(badge).toHaveClass("rounded-pill");
  });

  it("renders the indicative tone with the amber token classes", () => {
    render(<Badge tone="indicative">Indicatif</Badge>);
    expect(screen.getByText("Indicatif").className).toContain("bg-indicative-soft");
  });

  it("renders no status icon by itself", () => {
    render(<Badge tone="estimated">Estimé</Badge>);
    expect(screen.getByText("Estimé").querySelector("svg")).toBeNull();
  });
});
