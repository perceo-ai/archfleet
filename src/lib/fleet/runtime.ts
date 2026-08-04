import { redactSecrets } from "./redaction";
import type { FleetVm, RunEvent, Secret, Workflow, WorkflowParam, WorkflowRun } from "./types";

export type CreateRunInput = {
  workflow: Workflow;
  vms: FleetVm[];
  params: WorkflowParam[];
  secrets: Secret[];
};

export function createManualRun(input: CreateRunInput): WorkflowRun {
  const nodeRequiringVm = input.workflow.nodes.find((node) => node.config.requiredLabels?.length);
  const requiredLabels = nodeRequiringVm?.config.requiredLabels ?? [];
  const vm = input.vms.find(
    (candidate) =>
      candidate.status === "idle" &&
      requiredLabels.every((label) => candidate.labels.includes(label)),
  );

  if (!vm) {
    return {
      id: "run_manual_001",
      workflowId: input.workflow.id,
      workflowName: input.workflow.name,
      status: "queued",
      startedAt: "2026-08-04T16:10:00.000Z",
      events: [
        {
          id: "evt_no_vm",
          level: "warn",
          timestamp: "2026-08-04T16:10:00.000Z",
          message: `Queued ${input.workflow.name}: no matching VM is idle.`,
        },
      ],
    };
  }

  const portalUrl = input.params.find((param) => param.name === "portal_url")?.value;
  const portalPassword = input.secrets.find((secret) => secret.name === "portal_password")?.value;
  const rawEvents: RunEvent[] = [
    {
      id: "evt_assigned",
      level: "info",
      timestamp: "2026-08-04T16:10:00.000Z",
      message: `Assigned ${input.workflow.name} to ${vm.name} over XRDP ${vm.xrdp.host}:${vm.xrdp.port}.`,
    },
    {
      id: "evt_agent",
      level: "info",
      timestamp: "2026-08-04T16:10:06.000Z",
      message: `Claude Code opened ${portalUrl} with password ${portalPassword} and confirmed the dashboard loaded.`,
    },
    {
      id: "evt_artifact",
      level: "info",
      timestamp: "2026-08-04T16:10:12.000Z",
      message: "Saved screenshot artifact artifacts/run_manual_001/dashboard.png.",
    },
  ];
  const events = rawEvents.map((event) => ({
    ...event,
    message: redactSecrets(event.message, input.secrets),
  }));

  return {
    id: "run_manual_001",
    workflowId: input.workflow.id,
    workflowName: input.workflow.name,
    status: "succeeded",
    vmId: vm.id,
    startedAt: "2026-08-04T16:10:00.000Z",
    finishedAt: "2026-08-04T16:10:12.000Z",
    events,
  };
}

export function getRunTimeline(run: WorkflowRun): RunEvent[] {
  return run.events;
}
