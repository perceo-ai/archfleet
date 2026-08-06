import type { RunStatus } from "@/lib/fleet/types";

// Consistent badge colors for run status, shared across the dashboard.
export function runStatusTone(status: RunStatus | string): string {
  switch (status) {
    case "succeeded":
      return "bg-emerald-100 text-emerald-800";
    case "failed":
      return "bg-red-100 text-red-800";
    case "paused":
      return "bg-amber-100 text-amber-800";
    case "running":
      return "bg-blue-100 text-blue-800";
    case "canceled":
      return "bg-zinc-200 text-zinc-600";
    case "queued":
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}
