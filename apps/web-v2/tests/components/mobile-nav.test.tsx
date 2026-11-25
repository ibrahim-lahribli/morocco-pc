import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MobileNav, type MobileNavItem } from "@/components/layout/mobile-nav";

const { pathname } = vi.hoisted(() => ({ pathname: { value: "/" } }));

vi.mock("@/i18n/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => pathname.value,
    Link: (props: {
      href: string;
      children?: React.ReactNode;
      "aria-current"?: string;
      "aria-label"?: string;
      className?: string;
    }) =>
      React.createElement(
        "a",
        {
          href: props.href,
          "aria-current": props["aria-current"],
          "aria-label": props["aria-label"],
          className: props.className,
        },
        props.children,
      ),
  };
});

const items: readonly MobileNavItem[] = [
  { key: "home", href: "#top", label: "Accueil" },
  { key: "components", label: "Composants" },
  { key: "configure", href: "/configurateur?step=1", label: "Configurer" },
  { key: "guides", href: "#guides", label: "Guides" },
  { key: "saved", label: "Enregistrés" },
];

const renderNav = (navItems: readonly MobileNavItem[] = items) =>
  render(<MobileNav label="Navigation mobile" items={navItems} />);

const fab = () => screen.getByRole("link", { name: "Configurer" });

beforeEach(() => {
  pathname.value = "/";
});

describe("MobileNav", () => {
  it("renders an anchor item as a plain link", () => {
    renderNav();

    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("href", "#top");
    expect(screen.getByRole("link", { name: "Guides" })).toHaveAttribute("href", "#guides");
  });

  it("renders a route item through the locale-aware Link", () => {
    renderNav();

    expect(fab()).toHaveAttribute("href", "/configurateur?step=1");
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

  it("marks the homepage current only on the homepage", () => {
    renderNav();

    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("aria-current", "page");
    expect(fab()).not.toHaveAttribute("aria-current");
  });

  it("marks Configurer current on the configurator, on every step", () => {
    // `usePathname()` is locale-stripped and query-less, so step=1 and step=2
    // URLs share the same pathname — one assertion covers both steps.
    pathname.value = "/configurateur";
    renderNav();

    expect(fab()).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Accueil" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the raised centre action's label and drops its href when there is none", () => {
    renderNav(
      items.map((item) => (item.key === "configure" ? { ...item, href: undefined } : item)),
    );

    expect(screen.queryByRole("link", { name: "Configurer" })).toBeNull();
    expect(screen.getByText("Configurer")).toBeVisible();

    const disabledFab = screen
      .getByText("Configurer")
      .parentElement?.querySelector("[aria-disabled]");
    expect(disabledFab).toHaveAttribute("aria-disabled", "true");
  });
});
