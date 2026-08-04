import type { FleetState } from "./types";

export function seedFleetState(): FleetState {
  return {
    workflows: [
      {
        id: "wf_portal_login",
        name: "Portal Login Check",
        description: "Verify portal login and collect a status screenshot.",
        enabled: true,
        triggerKinds: ["manual", "schedule", "webhook"],
        nodes: [
          {
            id: "node_start",
            type: "start",
            name: "Manual / Trigger",
            position: { x: 0, y: 120 },
            config: {},
          },
          {
            id: "node_cli",
            type: "cli_agent_task",
            name: "CLI Agent Task",
            position: { x: 260, y: 80 },
            config: {
              provider: "claude-code",
              prompt:
                "Open {{param.portal_url}}, log in with the portal secret, and report whether the dashboard loads.",
              timeoutMs: 300000,
              requiredLabels: ["linux-desktop", "browser"],
            },
          },
          {
            id: "node_takeover",
            type: "human_takeover",
            name: "XRDP Takeover",
            position: { x: 540, y: 180 },
            config: {
              timeoutMs: 900000,
              requiredLabels: ["linux-desktop"],
            },
          },
          {
            id: "node_end",
            type: "end",
            name: "Artifact Saved",
            position: { x: 820, y: 120 },
            config: {},
          },
        ],
        edges: [
          { id: "edge_start_cli", from: "node_start", to: "node_cli", condition: "success" },
          { id: "edge_cli_end", from: "node_cli", to: "node_end", condition: "success" },
          {
            id: "edge_cli_takeover",
            from: "node_cli",
            to: "node_takeover",
            condition: "failure",
          },
          {
            id: "edge_takeover_end",
            from: "node_takeover",
            to: "node_end",
            condition: "success",
          },
        ],
      },
    ],
    vms: [
      {
        id: "vm_ubuntu_1",
        name: "ubuntu-desktop-01",
        status: "idle",
        labels: ["linux-desktop", "browser"],
        cpu: 4,
        memoryGb: 8,
        diskGb: 80,
        xrdp: {
          host: "127.0.0.1",
          port: 3391,
          username: "agent",
          credentialSource: "secret.vm_ubuntu_1_password",
        },
        lastHealthAt: "2026-08-04T16:00:00.000Z",
      },
      {
        id: "vm_ubuntu_2",
        name: "ubuntu-desktop-02",
        status: "idle",
        labels: ["linux-desktop", "browser", "office"],
        cpu: 6,
        memoryGb: 12,
        diskGb: 120,
        xrdp: {
          host: "127.0.0.1",
          port: 3392,
          username: "agent",
          credentialSource: "secret.vm_ubuntu_2_password",
        },
        lastHealthAt: "2026-08-04T16:01:00.000Z",
      },
      {
        id: "vm_gpu_1",
        name: "gpu-desktop-01",
        status: "running",
        labels: ["linux-desktop", "browser", "gpu", "high-memory"],
        cpu: 10,
        memoryGb: 32,
        diskGb: 240,
        xrdp: {
          host: "127.0.0.1",
          port: 3393,
          username: "agent",
          credentialSource: "secret.vm_gpu_1_password",
        },
        assignedRunId: "run_active_gpu",
        lastHealthAt: "2026-08-04T16:02:00.000Z",
      },
    ],
    params: [
      {
        id: "param_portal_url",
        name: "portal_url",
        scope: "workflow",
        value: "https://portal.example.test",
      },
    ],
    secrets: [
      {
        id: "sec_portal_password",
        name: "portal_password",
        scope: "workflow",
        value: "swordfish",
      },
    ],
  };
}
