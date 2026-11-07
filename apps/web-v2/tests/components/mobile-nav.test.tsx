import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MobileNav, type MobileNavItem } from "@/components/layout/mobile-nav";

const items: readonly MobileNavItem[] = [
  { key: "home", href: "#top", label: "Accueil", current: true },
  { key: "components", label: "Composants" },
  { key: "configure", href: "#simulateur", label: "Configurer" },
  { key: "guides", label: "Guides" },
  { key: "saved", label: "Enregistrés" },
];

const renderNav = (navItems: readonly MobileNavItem[] = items) =>
  render(<MobileNav label="Navigation mobile" items={navItems} />);

describe("MobileNav", () => {
  it("renders an item with an href as a link", () => {
    renderNav();

    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("href", "#top");
  });

  it("renders an item without an href as non-focusable, disabled markup", () => {
    renderNav();

    expect(screen.queryByRole("link", { name: "Composants" })).toBeNull();

    const disabled = screen.getByText("Composants").closest("[aria-disabled]");
    expect(disabled).not.toBeNull();
    expect(disabled?.tagName).toBe("SPAN");
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled).not.toHaveAttribute("href");
    expect(disabled).not.toHaveAttribute("tabindex");
  });

  it("marks the current destination", () => {
    renderNav();

    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the raised centre action's label and drops its href when there is none", () => {
    renderNav(
      items.map((item) => (item.key === "configure" ? { ...item, href: undefined } : item)),
    );

    expect(screen.queryByRole("link", { name: "Configurer" })).toBeNull();
    expect(screen.getByText("Configurer")).toBeVisible();

    const fab = screen.getByText("Configurer").parentElement?.querySelector("[aria-disabled]");
    expect(fab).toHaveAttribute("aria-disabled", "true");
  });
});
