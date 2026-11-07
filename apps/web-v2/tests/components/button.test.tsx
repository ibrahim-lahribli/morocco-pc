import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders a non-submit button with the primary variant by default", () => {
    render(<Button>Action</Button>);
    const button = screen.getByRole("button", { name: "Action" });

    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("bg-primary");
  });

  it("honours an explicit submit type", () => {
    render(<Button type="submit">Envoyer</Button>);
    expect(screen.getByRole("button", { name: "Envoyer" })).toHaveAttribute("type", "submit");
  });

  it("supports disabled state", () => {
    render(<Button disabled>Action</Button>);
    expect(screen.getByRole("button", { name: "Action" })).toBeDisabled();
  });

  it("renders the child element with asChild", () => {
    render(
      <Button asChild variant="secondary">
        <a href="#lien">Lien</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Lien" });
    expect(link).toHaveAttribute("href", "#lien");
    expect(link.className).toContain("bg-accent-soft");
  });

  it("renders the saffron cta variant with readable on-accent text", () => {
    render(<Button variant="cta">Trouver mon PC</Button>);
    const button = screen.getByRole("button", { name: "Trouver mon PC" });

    expect(button.className).toContain("bg-accent");
    expect(button.className).toContain("text-on-accent");
  });
});
