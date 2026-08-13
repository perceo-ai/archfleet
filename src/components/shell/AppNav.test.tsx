import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppNav } from "./AppNav";

const usePathname = vi.hoisted(() => vi.fn(() => "/automations"));
vi.mock("next/navigation", () => ({ usePathname }));

describe("AppNav", () => {
  it("renders the primary sections and marks the active one", () => {
    usePathname.mockReturnValue("/automations");
    render(<AppNav />);
    for (const label of ["Home", "Automations", "Environments", "Fleet", "Users"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Automations" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("hides itself on the login page", () => {
    usePathname.mockReturnValue("/login");
    const { container } = render(<AppNav />);
    expect(container).toBeEmptyDOMElement();
  });
});
