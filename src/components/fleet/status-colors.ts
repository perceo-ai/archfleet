import type {
  AutomationHealth,
  AutomationStatus,
  EnvironmentHealth,
  RunStatus,
  TakeoverStatus,
  VmStatus,
} from "@/lib/fleet/types";
import type { Tone } from "@/components/ui/primitives";

// Single status vocabulary for the whole app:
//   ok green · danger red · info blue (in flight) · human violet (needs a person)
//   warn amber (stale, not broken yet) · idle grey.
// Violet is also the brand accent, so it is only ever used for "a human is
// needed" — primary actions are the gradient button, not a pill.

export function runStatusTone(status: RunStatus | string): Tone {
  switch (status) {
    case "succeeded":
      return "ok";
    case "failed":
      return "danger";
    case "paused":
      return "human";
    case "running":
      return "info";
    default:
      return "idle";
  }
}

export function automationHealthTone(health: AutomationHealth | string): Tone {
  switch (health) {
    case "healthy":
      return "ok";
    case "failing":
      return "danger";
    case "needs_attention":
      return "human";
    default:
      return "idle";
  }
}

export function automationStatusTone(status: AutomationStatus | string): Tone {
  switch (status) {
    case "active":
      return "ok";
    case "draft":
      return "info";
    default:
      return "idle";
  }
}

export function environmentHealthTone(health: EnvironmentHealth | string): Tone {
  switch (health) {
    case "ready":
      return "ok";
    case "degraded":
      return "danger";
    case "recovering":
      return "human";
    default:
      return "idle";
  }
}

export function takeoverStatusTone(status: TakeoverStatus | string): Tone {
  return status === "open" ? "human" : "idle";
}

export function vmStatusTone(status: VmStatus | string): Tone {
  switch (status) {
    case "idle":
      return "ok";
    case "running":
    case "assigned":
    case "starting":
      return "info";
    case "needs_human":
    case "resetting":
      return "human";
    case "unhealthy":
      return "danger";
    default:
      return "idle";
  }
}

/** CSS colour for solid marks (dots, bars) rather than tinted pills. */
export function toneColor(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "var(--ok-base)";
    case "danger":
      return "var(--danger-base)";
    case "info":
      return "var(--info-base)";
    case "human":
      return "var(--human-base)";
    case "warn":
      return "var(--warn-base)";
    case "accent":
      return "var(--accent)";
    default:
      return "var(--idle)";
  }
}

/** Human-friendly label for machine statuses ("needs_attention" -> "needs attention"). */
export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
