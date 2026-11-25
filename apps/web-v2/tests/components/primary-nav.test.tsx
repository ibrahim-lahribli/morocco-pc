import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrimaryNav, type PrimaryNavItem } from "@/components/layout/primary-nav";

const { pathname } = vi.hoisted(() => ({ pathname: { value: "/" } }));

vi.mock("@/i18n/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => pathname.value,
    Link: (props: {
      href: string;
      children?: React.ReactNode;
      "aria-current"?: string;
      className?: string;
    }) =>
      React.createElement(
        "a",
        { href: props.href, "aria-current": props["aria-current"], className: props.className },
        props.children,
      ),
  };
});

const items: readonly PrimaryNavItem[] = [
  { href: "#top", label: "Accueil" },
  { href: "/configurateur?step=1", label: "Configurer" },
  { href: "#guides", label: "Guides" },
];

const renderNav = (navItems: readonly PrimaryNavItem[] = items) =>
  render(<PrimaryNav label="Navigation" items={navItems} />);

const configure = () => screen.getByRole("link", { name: "Configurer" });

beforeEach(() => {
  pathname.value = "/";
});

describe("PrimaryNav", () => {
  it("renders anchors as plain links and routes through the locale-aware Link", () => {
    renderNav();

    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("href", "#top");
    expect(configure()).toHaveAttribute("href", "/configurateur?step=1");
  });

  it("marks the homepage current only on the homepage", () => {
    renderNav();

    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute("aria-current", "page");
    expect(configure()).not.toHaveAttribute("aria-current");
  });

  it("marks Configurer current on the configurator", () => {
    pathname.value = "/configurateur";
    renderNav();

    expect(configure()).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Accueil" })).not.toHaveAttribute("aria-current");
  });

  it("does not mark section anchors current away from the homepage", () => {
    pathname.value = "/configurateur";
    renderNav();

    expect(screen.getByRole("link", { name: "Guides" })).not.toHaveAttribute("aria-current");
  });
});
