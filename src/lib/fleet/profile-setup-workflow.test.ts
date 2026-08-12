import { describe, expect, it } from "vitest";
import { createProfileSetupWorkflow } from "./profile-setup-workflow";

describe("createProfileSetupWorkflow", () => {
  it("builds a reviewable Agent S setup workflow for a task profile", () => {
    const wf = createProfileSetupWorkflow({
      id: "wf_profile_bank",
      profile: "bank",
      task: "Log into the bank portal and prepare monthly statement download",
    });

    expect(wf.enabled).toBe(false);
    expect(wf.name).toBe("Prepare bank profile");
    expect(wf.nodes.map((n) => n.type)).toEqual([
      "start",
      "computer_use_task",
      "human_takeover",
      "end",
    ]);
    expect(wf.nodes[1].config.requiredLabels).toEqual(["profile:bank"]);
    expect(wf.nodes[1].config.prompt).toContain("Log into the bank portal");
    expect(wf.nodes[2].name).toContain("Manual login");
  });
});
