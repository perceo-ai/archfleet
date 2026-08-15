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
  | "browser_task"
  | "script_task"
  | "cli_agent_task"
  | "shell_task"
  | "api_call"
  | "otp_email"
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
    /** retry_wait: how many times to re-run the preceding task node. */
    maxAttempts?: number;
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
  /** Automation this run belongs to (runs can also target a bare workflow). */
  automationId?: string;
  environmentId?: string;
  triggerSource?: TriggerSource;
  /** Name of the node currently executing (live progress). */
  currentStep?: string;
  /** Why the run paused — set when status is "paused". */
  pausedReason?: string;
  /** One-line outcome written when the run finishes. */
  resultSummary?: string;
  /** Branch this run is associated with (semantic tests / Archductor triggers). */
  branchRef?: string;
  /** PR this run is associated with, e.g. "42" or "org/repo#42". */
  prRef?: string;
};

export type AutomationStatus = "draft" | "active" | "disabled";

export type AutomationHealth = "healthy" | "failing" | "needs_attention" | "unknown";

export type TriggerSource = "manual" | "schedule" | "webhook" | "api";

export type EnvironmentHealth = "ready" | "degraded" | "recovering" | "unknown";

export type TakeoverStatus = "open" | "resolved";

export type EvidenceType = "screenshot" | "file" | "log" | "criteria_review" | "check";

/** The user-facing object: intent + workflow + environment + criteria + policy.
 * The workflow graph lives underneath (`workflowId`); the automation is what
 * users create, edit, run, and schedule. */
export type Automation = {
  id: string;
  name: string;
  goal: string;
  /** Purpose bucket, e.g. "general" | "semantic_test" | "data_extraction" | "form_fill" | "report_download". */
  category: string;
  /** Target site/app/system in plain language. */
  target: string;
  /** Plain-language spec: the steps as the user would describe them. */
  specMarkdown: string;
  workflowId: string;
  environmentId?: string;
  /** Plain-language success criteria, reviewed by humans against run evidence. */
  successCriteria: string[];
  requiredSecrets: string[];
  mfaExpectation?: string;
  artifactPolicy: string;
  retryPolicy: string;
  takeoverPolicy: string;
  triggerSuggestion?: string;
  riskNotes: string[];
  /** Machine-evaluated assertions run after each execution (see evidence-checks.ts). */
  evidenceChecks?: import("./evidence-checks").EvidenceCheck[];
  status: AutomationStatus;
  createdAt: string;
  updatedAt: string;
};

/** A logged-in account the environment holds. Display metadata only — the
 * credential itself lives in the secret store under `secretRef`. */
export type EnvironmentAccount = {
  /** Site/app the account belongs to, e.g. "portal.example.com". */
  site: string;
  /** Username/email shown to the user (never the password). */
  username?: string;
  /** Saved-secret name holding the credential, if one exists. */
  secretRef?: string;
  /** MFA behavior on this site, e.g. "email OTP" or "device-trusted, no prompt". */
  mfa?: string;
};

/** Structured description of what a prepared environment actually holds — what
 * makes it "ready to run this kind of automation" beyond a name and a profile. */
export type EnvironmentState = {
  /** Browser + session state, e.g. "Chromium with saved portal session". */
  browser?: string;
  /** Accounts already logged in on this desktop. */
  accounts?: EnvironmentAccount[];
  /** Sites/apps that trust this device (no repeated MFA). */
  deviceTrust?: string[];
  /** Browser extensions installed. */
  extensions?: string[];
  /** Desktop apps installed/configured. */
  apps?: string[];
  /** Files present on the desktop (downloads, templates, working files). */
  files?: string[];
  /** Saved-secret names automations on this environment can reference. */
  secretRefs?: string[];
  /** Where MFA can still appear despite the prepared state. */
  mfaExpectations?: string[];
};

/** A reusable, ready-to-run environment (browser state, logins, device trust).
 * Backed by the fleet's profile/warm-snapshot machinery via `profileRef`. */
export type PreparedEnvironment = {
  id: string;
  name: string;
  description: string;
  labels: string[];
  /** Fleet profile slug this environment maps to (label `profile:<slug>`). */
  profileRef?: string;
  health: EnvironmentHealth;
  snapshotState?: string;
  lastUsedAt?: string;
  recoveryState?: string;
  setupNotes?: string;
  /** What the environment holds: logins, device trust, extensions, files, MFA. */
  state?: EnvironmentState;
  /** Warm snapshot name used for fast per-run resets. */
  warmSnapshot?: string;
  /** Environment this one was cloned from, if any. */
  clonedFrom?: string;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceItem = {
  id: string;
  runId: string;
  automationId?: string;
  type: EvidenceType;
  /** Artifact name servable via /api/runs/:id/artifacts/:name, or external ref. */
  artifactRef?: string;
  stepId?: string;
  description: string;
  /** Human review outcome for criteria_review evidence. */
  verdict?: "pass" | "fail";
  createdAt: string;
};

export type HumanTakeover = {
  id: string;
  runId: string;
  environmentId?: string;
  vmId?: string;
  reason: string;
  requestedAction: string;
  status: TakeoverStatus;
  openedAt: string;
  resolvedAt?: string;
  operatorNotes?: string;
  /** When the operator webhook was actually paged about this takeover. */
  notifiedAt?: string;
  /** When a reminder page was sent because nobody responded. */
  escalatedAt?: string;
};

export type FleetState = {
  workflows: Workflow[];
  vms: FleetVm[];
  params: WorkflowParam[];
  secrets: Secret[];
};
