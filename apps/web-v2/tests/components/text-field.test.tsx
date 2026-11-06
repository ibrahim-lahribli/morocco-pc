import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TextField } from "@/components/ui/text-field";

describe("TextField", () => {
  it("associates the label with the input", () => {
    render(<TextField id="name" label="Nom" />);
    expect(screen.getByLabelText("Nom")).toHaveAttribute("id", "name");
  });

  it("describes the input with its hint", () => {
    render(<TextField id="name" label="Nom" hint="Visible en ligne" />);
    const input = screen.getByLabelText("Nom");

    expect(input).toHaveAttribute("aria-describedby", "name-hint");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("Visible en ligne")).toHaveAttribute("id", "name-hint");
  });

  it("marks the input invalid and links the error message", () => {
    render(<TextField id="email" label="E-mail" hint="Aide" error="Adresse invalide" />);
    const input = screen.getByLabelText("E-mail");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-hint email-error");
    expect(screen.getByText("Adresse invalide")).toHaveAttribute("id", "email-error");
  });

  it("supports a search input with a decorative icon", () => {
    render(
      <TextField id="search" type="search" label="Rechercher" leadingIcon={<span>icon</span>} />,
    );
    expect(screen.getByLabelText("Rechercher")).toHaveAttribute("type", "search");
  });
});
