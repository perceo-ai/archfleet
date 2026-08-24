// Sessions: the general computer-use surface an outside agent (OpenClaw, Hermes)
// gets on a prepared environment. Everything here is pure — compile, validate,
// describe — so it tests without libvirt, ssh, or a database. The I/O lives in
// session-runtime.ts.
//
// Three modes, one object:
//
//   task     archfleet drives. The request compiles to an ephemeral workflow and
//            goes through runWorkflow, so it inherits takeover, evidence,
//            secrets and redaction instead of reimplementing them.
//   lease    the agent drives. It holds a clean clone and sends batches of
//            desktop primitives until it closes.
//   persist  the agent drives the profile's SOURCE desktop with the warm revert
//            skipped, so a new sign-in survives and can be captured back.

import type { Workflow } from "./types";

export type SessionMode = "task" | "lease" | "persist";

export type SessionStatus =
  | "starting"
  | "active"
  | "waiting_for_human"
  | "closing"
  | "closed"
  | "failed";

export type Session = {
  id: string;
  environmentId: string;
  /** Environment name at open time — sessions outlive renames and still read. */
  environmentName?: string;
  mode: SessionMode;
  status: SessionStatus;
  /** What the agent asked for, in its own words (task mode). */
  task?: string;
  /** task mode: the run this compiled to. */
  runId?: string;
  /** lease/persist: the desktop being held. */
  vmId?: string;
  domain?: string;
  /** Who opened it, for the audit trail: "hermes", "openclaw", a token name. */
  openedBy?: string;
  expiresAt: string;
  openedAt: string;
  updatedAt: string;
  closedAt?: string;
  /** Why it ended, or why it failed. */
  resultSummary?: string;
  /** persist: whether the desktop was promoted back into the profile on close. */
  capturedAt?: string;
};

/** How long a hold lives without a renew. Every `act` renews, so this is really
 * "how long after an agent walks away before the desktop comes back". */
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
export const MAX_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function clampTtlMs(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) return DEFAULT_SESSION_TTL_MS;
  return Math.min(Math.floor(requested), MAX_SESSION_TTL_MS);
}

export function isOpen(session: Session): boolean {
  return session.status !== "closed" && session.status !== "failed";
}

// --------------------------------------------------------------------------- //
// Desktop primitives (lease + persist)
// --------------------------------------------------------------------------- //

/** The action vocabulary `virt/agent-runner/desktop_runner.py` accepts. Kept in
 * lockstep with the VALID set there — a primitive we accept but the guest does
 * not would fail mid-batch, after earlier actions had already landed. */
export const DESKTOP_ACTIONS = [
  "click",
  "doubleclick",
  "rightclick",
  "move",
  "type",
  "text",
  "key",
  "press",
  "hotkey",
  "scroll",
  "wait",
  "screenshot",
] as const;

export type DesktopAction = Record<string, unknown>;

/** Reject a batch before any of it runs. A half-applied batch is the worst
 * outcome — the agent's model of the screen silently diverges from the screen. */
export function validateActions(actions: unknown): string[] {
  if (!Array.isArray(actions)) return ["actions must be an array"];
  if (actions.length === 0) return ["actions must not be empty"];
  const valid = new Set<string>(DESKTOP_ACTIONS);
  const errors: string[] = [];
  actions.forEach((action, i) => {
    if (typeof action !== "object" || action === null || Array.isArray(action)) {
      errors.push(`action ${i} must be an object, e.g. {"click":[x,y]}`);
      return;
    }
    const keys = Object.keys(action as object);
    const known = keys.filter((k) => valid.has(k));
    if (known.length === 0) {
      errors.push(
        `action ${i}: unknown action ${JSON.stringify(keys)} — expected one of ${DESKTOP_ACTIONS.join(", ")}`,
      );
    }
  });
  return errors;
}

/** The instruction string desktop_runner.py parses (a JSON action array). */
export function serializeActions(actions: DesktopAction[]): string {
  return JSON.stringify(actions);
}

/** Guest path of the scripted-desktop runner — the same one `script_task` uses. */
export const DESKTOP_RUNNER_PATH = "/opt/agent/agent-runner/desktop_runner.py";

// --------------------------------------------------------------------------- //
// Task mode
// --------------------------------------------------------------------------- //

export type TaskCompileInput = {
  sessionId: string;
  task: string;
  environmentName?: string;
  /** Profile labels the environment demands, e.g. ["profile:portal"]. */
  requiredLabels: string[];
  timeoutMs?: number;
};

/** Compile an agent's plain-language request into a one-step workflow.
 *
 * Deliberately minimal: start → computer_use_task → end. Anything richer is an
 * automation the user should see and keep, not something an outside agent
 * conjures per call. The graph is `enabled: false` so it never picks up a
 * trigger and never shows up as a thing the user has to maintain. */
export function compileTaskWorkflow(input: TaskCompileInput): Workflow {
  return {
    id: `wf_session_${input.sessionId}`,
    name: `Agent task — ${truncate(input.task, 60)}`,
    description: input.environmentName
      ? `Ad-hoc agent request on "${input.environmentName}".`
      : "Ad-hoc agent request.",
    enabled: false,
    triggerKinds: ["manual"],
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
      {
        id: "task",
        type: "computer_use_task",
        name: "Do what was asked",
        position: { x: 1, y: 0 },
        config: {
          prompt: input.task,
          requiredLabels: input.requiredLabels,
          timeoutMs: input.timeoutMs ?? 900_000,
        },
      },
      { id: "end", type: "end", name: "Done", position: { x: 2, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e_start_task", from: "start", to: "task", condition: "always" },
      { id: "e_task_end", from: "task", to: "end", condition: "success" },
    ],
  };
}

/** Map a run's status onto the session's, so an agent polls one vocabulary. */
export function statusFromRun(runStatus: string): SessionStatus {
  switch (runStatus) {
    case "queued":
      return "starting";
    case "running":
      return "active";
    case "paused":
      return "waiting_for_human";
    case "succeeded":
    case "canceled":
      return "closed";
    case "failed":
      return "failed";
    default:
      return "active";
  }
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
