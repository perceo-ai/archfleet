// Group failed runs by cause instead of listing one row per failure. Seven runs
// broken by one moved button is one inbox item with one fix, not seven red rows.
// Pure function over run summaries so it works client-side without the events.

import type { RunSummary } from "./db/runs-repo";

export type FailureGroup = {
  /** Stable key for the group (failing step + normalized summary). */
  key: string;
  /** The newest run's summary, shown as the group's headline. */
  cause: string;
  /** Step the runs failed at, when they agree on one. */
  step?: string;
  runs: RunSummary[];
  /** Distinct automations hit by this cause. */
  automationIds: string[];
  /** ISO timestamps of the oldest and newest run in the group. */
  firstSeen: string;
  lastSeen: string;
};

/** Collapse run-specific detail (ids, counts, timings) so equivalent failures
 * land in the same bucket while genuinely different ones stay apart. */
export function normalizeCause(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{8,}\b/g, "#id")
    .replace(/\brun[-_]?\w{4,}\b/g, "#id")
    .replace(/\b\d+(\.\d+)?(ms|s|m|h)?\b/g, "#n")
    .replace(/\s+/g, " ")
    .trim();
}

export function groupFailures(runs: RunSummary[]): FailureGroup[] {
  const failed = runs.filter((r) => r.status === "failed");
  const groups = new Map<string, FailureGroup>();

  for (const run of failed) {
    const summary = run.resultSummary?.trim() || "Failed without a recorded reason.";
    const key = `${run.currentStep ?? ""}|${normalizeCause(summary)}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        cause: summary,
        step: run.currentStep,
        runs: [run],
        automationIds: run.automationId ? [run.automationId] : [],
        firstSeen: run.startedAt,
        lastSeen: run.startedAt,
      });
      continue;
    }
    existing.runs.push(run);
    if (run.automationId && !existing.automationIds.includes(run.automationId)) {
      existing.automationIds.push(run.automationId);
    }
    if (run.startedAt < existing.firstSeen) existing.firstSeen = run.startedAt;
    if (run.startedAt > existing.lastSeen) {
      existing.lastSeen = run.startedAt;
      existing.cause = summary;
    }
  }

  // Biggest blast radius first, then most recent.
  return [...groups.values()].sort(
    (a, b) => b.runs.length - a.runs.length || b.lastSeen.localeCompare(a.lastSeen),
  );
}
