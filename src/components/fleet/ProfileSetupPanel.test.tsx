import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSetupPanel } from "./ProfileSetupPanel";

describe("ProfileSetupPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts a task profile setup request and reports the workflow id", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/profile-ops") return { ok: true, json: async () => ({ operations: [] }) };
      return {
        ok: true,
        json: async () => ({ workflow: { id: "wf_profile_setup_bank", name: "Prepare bank profile" } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSetupPanel />);
    fireEvent.change(screen.getByLabelText("Profile"), { target: { value: "bank" } });
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Log into the bank portal and prepare statements" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft workflow" }));

    await waitFor(() => expect(screen.getByText("Drafted wf_profile_setup_bank")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/profile-setup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          profile: "bank",
          task: "Log into the bank portal and prepare statements",
          save: true,
        }),
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
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Log into the bank portal and prepare statements" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));

    await waitFor(() => expect(screen.getByText("waiting for capture")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/profile-setup", expect.objectContaining({ method: "POST" }));
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/profile-ops/profile_op_1/continue", { method: "POST" }),
    );
  });
});
