export type VmStatus =
  | "stopped"
  | "starting"
  | "idle"
  | "assigned"
  | "running"
  | "needs_human"
  | "resetting"
  | "unhealthy";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "paused" | "canceled";

export type NodeKind =
  | "start"
  | "agent_planner"
  | "computer_use_task"
  | "cli_agent_task"
  | "shell_task"
  | "human_takeover"
  | "condition"
  | "retry_wait"
  | "artifact"
  | "end";

export type TriggerKind = "manual" | "schedule" | "webhook";

export type AgentProvider = "claude-code" | "codex" | "local" | "api";

export type WorkflowNode = {
  id: string;
  type: NodeKind;
  name: string;
  position: { x: number; y: number };
  config: {
    prompt?: string;
    timeoutMs?: number;
    requiredLabels?: string[];
    provider?: AgentProvider;
  };
};

export type WorkflowEdge = {
  id: string;
  from: string;
  to: string;
  condition: "success" | "failure" | "always";
};

export type Workflow = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggerKinds: TriggerKind[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type XrdpConnection = {
  host: string;
  port: number;
  username: string;
  credentialSource: string;
};

export type FleetVm = {
  id: string;
  name: string;
  status: VmStatus;
  labels: string[];
  cpu: number;
  memoryGb: number;
  diskGb: number;
  xrdp: XrdpConnection;
  /** SSH endpoint the controller uses to drive the guest runner (distinct from
   * the XRDP port, which is for human takeover). Absent for pure-mock VMs. */
  ssh?: { host: string; port: number; username: string };
  assignedRunId?: string;
  lastHealthAt: string;
  /** libvirt domain name this VM maps to. Absent for pure-mock seed VMs. */
  domain?: string;
  /** Warm snapshot to revert to for a fast per-run reset. */
  warmSnapshot?: string;
};

export type Trigger = {
  id: string;
  workflowId: string;
  type: TriggerKind;
  config: Record<string, unknown>;
  enabled: boolean;
  /** Cron expression for schedule triggers. */
  cron?: string;
  /** Next fire time (ISO) for schedule triggers. */
  nextRunAt?: string;
  createdAt: string;
};

export type Secret = {
  id: string;
  name: string;
  scope: "global" | "workflow" | "vm" | "run";
  value: string;
};

export type WorkflowParam = {
  id: string;
  name: string;
  scope: "global" | "workflow" | "trigger" | "run";
  value: string | number | boolean | null;
};

export type RunEvent = {
  id: string;
  level: "info" | "warn" | "error";
  timestamp: string;
  message: string;
};

export type RunArtifact = {
  id: string;
  runId: string;
  nodeId?: string;
  type: string;
  path: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type WorkflowRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  vmId?: string;
  triggerId?: string;
  startedAt: string;
  finishedAt?: string;
  events: RunEvent[];
  artifacts?: RunArtifact[];
};

export type FleetState = {
  workflows: Workflow[];
  vms: FleetVm[];
  params: WorkflowParam[];
  secrets: Secret[];
};
