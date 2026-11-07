import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpecPill } from "@/components/home/spec-pill";

describe("SpecPill", () => {
  it("keeps a long component name readable instead of truncating it", () => {
    render(<SpecPill>AMD Ryzen 5 5600G (6 cœurs, 12 threads, 3,9 GHz)</SpecPill>);

    const text = screen.getByText(/AMD Ryzen 5 5600G/);
    expect(text).toHaveClass("break-words");
    expect(text).not.toHaveClass("truncate");
  });

  it("can still shrink inside a narrow card", () => {
    render(<SpecPill>Gigabyte B550M DS3H AC</SpecPill>);

    expect(screen.getByText("Gigabyte B550M DS3H AC").parentElement).toHaveClass("max-w-full");
  });
});
