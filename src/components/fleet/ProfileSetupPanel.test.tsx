import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSetupPanel } from "./ProfileSetupPanel";

describe("ProfileSetupPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("asks the LLM planner for a task workflow draft", async () => {
    const planned = {
      id: "wf_draft_bank",
      name: "Bank statement download",
      description: "Drafted by the agent planner.",
      enabled: false,
      triggerKinds: ["manual"],
      nodes: [
        { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "login", type: "computer_use_task", name: "Open portal", position: { x: 1, y: 0 }, config: { prompt: "open portal" } },
        { id: "end", type: "end", name: "Complete", position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", from: "start", to: "login", condition: "always" },
        { id: "e2", from: "login", to: "end", condition: "success" },
      ],
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/profile-ops") return { ok: true, json: async () => ({ operations: [] }) };
      if (url === "/api/plan") return { ok: true, json: async () => ({ workflow: planned, errors: [] }) };
      return {
        ok: true,
        json: async () => ({ workflow: { id: "wf_profile_setup_bank", name: "Prepare bank profile" } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSetupPanel />);
    fireEvent.change(screen.getByLabelText("Profile"), { target: { value: "bank" } });
    fireEvent.change(screen.getByLabelText("Task Brief for the Model"), {
      target: { value: "Log into the bank portal and prepare statements" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft with LLM" }));

    await waitFor(() => expect(screen.getByText("LLM drafted Bank statement download")).toBeInTheDocument());
    expect(screen.getByText("Open portal")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/plan",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Log into the bank portal and prepare statements"),
      }),
    );
  });

  it("starts setup and can capture an interactive profile operation", async () => {
    const op = {
      id: "profile_op_1",
      action: "prepare",
      profile: "bank",
      clones: 2,
      status: "waiting_for_capture",
      logs: ["Press Enter when the VM is ready to capture..."],
      sourceVm: { id: "source", xrdp: { host: "127.0.0.1", port: 13389, username: "agent" } },
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/profile-ops" && init?.method === "POST") {
        return { ok: true, json: async () => ({ operation: op }) };
      }
      if (url === "/api/profile-ops/profile_op_1/continue") {
        return { ok: true, json: async () => ({ operation: { ...op, status: "running", logs: ["Capture confirmed"] } }) };
      }
      if (url === "/api/profile-setup") {
        return { ok: true, json: async () => ({ workflow: { id: "wf_profile_setup_bank", name: "Prepare bank profile" } }) };
      }
      return { ok: true, json: async () => ({ operations: [op] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSetupPanel />);
    fireEvent.change(screen.getByLabelText("Profile"), { target: { value: "bank" } });
    fireEvent.change(screen.getByLabelText("Task Brief for the Model"), {
      target: { value: "Log into the bank portal and prepare statements" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare Golden VM" }));

    await waitFor(() => expect(screen.getByText("waiting for capture")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/profile-setup", expect.objectContaining({ method: "POST" }));
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/profile-ops/profile_op_1/continue", { method: "POST" }),
    );
  });
});
