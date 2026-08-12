import type { RunStatus } from "@/lib/fleet/types";

// Consistent badge colors for run status, shared across the dashboard.
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
