import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FleetManager } from "./FleetManager";

describe("FleetManager", () => {
  it("renders a task home and opens the simplified task workspace", () => {
    render(<FleetManager />);

    expect(screen.getByText("Perceo Archfleet")).toBeInTheDocument();
    expect(screen.getByText("Run browser workflows on golden desktops.")).toBeInTheDocument();
    expect(screen.getByText("Portal login check")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /portal login check/i }));

    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Graph editor")).toBeInTheDocument();
    expect(screen.getByText("XRDP viewer")).toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Run" })).toBeInTheDocument();
  });
});
