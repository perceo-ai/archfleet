import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FleetManager } from "./FleetManager";

describe("FleetManager", () => {
  it("renders the workflow, XRDP fleet, and CLI provider order", () => {
    render(<FleetManager />);

    expect(screen.getByText("Computer Use Fleet")).toBeInTheDocument();
    expect(screen.getByText("Portal Login Check")).toBeInTheDocument();
    expect(screen.getAllByText("XRDP").length).toBeGreaterThan(0);
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });
});
