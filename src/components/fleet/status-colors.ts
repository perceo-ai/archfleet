import type {
  AutomationHealth,
  AutomationStatus,
  EnvironmentHealth,
  RunStatus,
  TakeoverStatus,
} from "@/lib/fleet/types";

// Single source of truth for status badge colors across the app (dark theme).

export function runStatusTone(status: RunStatus | string): string {
  switch (status) {
    case "succeeded":
      return "bg-[#4ade80]/20 text-[#8add84] ring-1 ring-[#4ade80]/30";
    case "failed":
      return "bg-[#f87171]/20 text-[#fca5a5] ring-1 ring-[#f87171]/30";
    case "paused":
      return "bg-[#8b5cf6]/20 text-[#c4b5fd] ring-1 ring-[#8b5cf6]/30";
    case "running":
      return "bg-[#60a5fa]/20 text-[#9ec5fb] ring-1 ring-[#60a5fa]/30";
    case "canceled":
      return "bg-white/10 text-white/60 ring-1 ring-white/10";
    case "queued":
    default:
      return "bg-white/10 text-white/70 ring-1 ring-white/10";
  }
}

export function automationHealthTone(health: AutomationHealth | string): string {
  switch (health) {
    case "healthy":
      return "bg-[#4ade80]/20 text-[#8add84] ring-1 ring-[#4ade80]/30";
    case "failing":
      return "bg-[#f87171]/20 text-[#fca5a5] ring-1 ring-[#f87171]/30";
    case "needs_attention":
      return "bg-[#8b5cf6]/20 text-[#c4b5fd] ring-1 ring-[#8b5cf6]/30";
    case "unknown":
    default:
      return "bg-white/10 text-white/60 ring-1 ring-white/10";
  }
}

export function automationStatusTone(status: AutomationStatus | string): string {
  switch (status) {
    case "active":
      return "bg-[#4ade80]/20 text-[#8add84] ring-1 ring-[#4ade80]/30";
    case "draft":
      return "bg-[#60a5fa]/20 text-[#9ec5fb] ring-1 ring-[#60a5fa]/30";
    case "disabled":
    default:
      return "bg-white/10 text-white/60 ring-1 ring-white/10";
  }
}

export function environmentHealthTone(health: EnvironmentHealth | string): string {
  switch (health) {
    case "ready":
      return "bg-[#4ade80]/20 text-[#8add84] ring-1 ring-[#4ade80]/30";
    case "degraded":
      return "bg-[#f87171]/20 text-[#fca5a5] ring-1 ring-[#f87171]/30";
    case "recovering":
      return "bg-[#8b5cf6]/20 text-[#c4b5fd] ring-1 ring-[#8b5cf6]/30";
    case "unknown":
    default:
      return "bg-white/10 text-white/60 ring-1 ring-white/10";
  }
}

export function takeoverStatusTone(status: TakeoverStatus | string): string {
  return status === "open"
    ? "bg-[#8b5cf6]/20 text-[#c4b5fd] ring-1 ring-[#8b5cf6]/30"
    : "bg-white/10 text-white/60 ring-1 ring-white/10";
}

/** Human-friendly label for machine statuses ("needs_attention" -> "needs attention"). */
export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
