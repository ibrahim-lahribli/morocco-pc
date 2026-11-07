import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SectionHeading } from "@/components/home/section-heading";

describe("SectionHeading", () => {
  it("renders one h2 carrying the id its section points at", () => {
    render(<SectionHeading id="guides-title" eyebrow="Conseils" title="Titre" />);

    const heading = screen.getByRole("heading", { level: 2, name: "Titre" });
    expect(heading).toHaveAttribute("id", "guides-title");
    expect(screen.getByText("Conseils")).toBeInTheDocument();
  });

  it("hides the eyebrow and the intro below md by default", () => {
    render(<SectionHeading id="h" eyebrow="Conseils" title="Titre" intro="Intro" />);

    expect(screen.getByText("Conseils")).toHaveClass("hidden", "md:block");
    expect(screen.getByText("Intro")).toHaveClass("hidden", "md:block");
  });

  it("shows both at every width when from is base", () => {
    render(
      <SectionHeading id="h" eyebrow="Configurations" title="Titre" intro="Intro" from="base" />,
    );

    expect(screen.getByText("Configurations")).not.toHaveClass("hidden");
    expect(screen.getByText("Intro")).not.toHaveClass("hidden");
  });

  it("centres the block and keeps the intro on one measure", () => {
    const { container } = render(
      <SectionHeading id="h" eyebrow="E" title="Titre" intro="Intro" align="center" />,
    );

    expect(container.querySelector(".text-center")).not.toBeNull();
    expect(screen.getByText("Intro")).toHaveClass("mx-auto", "max-w-prose");
  });

  it("renders the action on the same row from lg", () => {
    const { container } = render(
      <SectionHeading id="h" eyebrow="E" title="Titre" action={<span>all</span>} />,
    );

    expect(screen.getByText("all")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("flex", "lg:flex-row", "lg:justify-between");
  });

  it("is programmatically focusable only when the section asks", () => {
    const { rerender } = render(<SectionHeading id="h" eyebrow="E" title="Titre" />);
    expect(screen.getByRole("heading", { level: 2 })).not.toHaveAttribute("tabindex");

    rerender(<SectionHeading id="h" eyebrow="E" title="Titre" focusableHeading />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("tabindex", "-1");
  });
});
