import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileSetupPanel } from "./ProfileSetupPanel";

describe("ProfileSetupPanel", () => {
  it("posts a task profile setup request and reports the workflow id", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ workflow: { id: "wf_profile_setup_bank", name: "Prepare bank profile" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSetupPanel />);
    fireEvent.change(screen.getByLabelText("Profile"), { target: { value: "bank" } });
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Log into the bank portal and prepare statements" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create setup workflow" }));

    await waitFor(() => expect(screen.getByText("wf_profile_setup_bank")).toBeInTheDocument());
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
});
