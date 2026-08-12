import type { Workflow } from "./types";

export type ProfileSetupInput = {
  id: string;
  profile: string;
  task: string;
};

export function createProfileSetupWorkflow(input: ProfileSetupInput): Workflow {
  const profileLabel = `profile:${input.profile}`;
  return {
    id: input.id,
    name: `Prepare ${input.profile} profile`,
    description: `Draft setup workflow for task profile "${input.profile}".`,
    enabled: false,
    triggerKinds: ["manual"],
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
      {
        id: "agent_setup",
        type: "computer_use_task",
        name: "Agent setup pass",
        position: { x: 1, y: 0 },
        config: {
          requiredLabels: [profileLabel],
          timeoutMs: 900000,
          prompt: [
            "Prepare this VM profile so the task can run repeatedly from a clean warm snapshot.",
            "Install or open required apps, configure Firefox, inspect the target site, and stop before any step that requires private human-only input.",
            `Task: ${input.task}`,
            "If login, 2FA, captcha, or device trust is needed, leave the browser on the exact page where a human should continue.",
          ].join("\n"),
        },
      },
      {
        id: "manual_login",
        type: "human_takeover",
        name: "Manual login / 2FA",
        position: { x: 2, y: 0 },
        config: {
          prompt:
            "Complete login, 2FA, captcha, trusted-device prompts, and any final app/site setup. Leave the desktop exactly as future runs should start.",
        },
      },
      { id: "end", type: "end", name: "Ready for capture", position: { x: 3, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e_start_setup", from: "start", to: "agent_setup", condition: "always" },
      { id: "e_setup_manual", from: "agent_setup", to: "manual_login", condition: "always" },
      { id: "e_manual_end", from: "manual_login", to: "end", condition: "success" },
    ],
  };
}
