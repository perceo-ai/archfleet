"use client";

// The library. One row per automation, carrying enough history to judge it at a
// glance: the last five runs, success rate, median duration, trigger.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { usePolling } from "@/lib/ui/api";
import { cadenceLabel, categoryLabel, timeAgo } from "@/lib/ui/format";
import {
  automationHealthTone,
  automationStatusTone,
  statusLabel,
} from "@/components/fleet/status-colors";
import {
  Card,
  Chip,
  Empty,
  Pill,
  RunStrip,
  Segmented,
  StaleNotice,
  rowLinkProps,
} from "@/components/ui/primitives";
import type { RunSummary } from "@/lib/fleet/db/runs-repo";
import type {
  Automation,
  AutomationHealth,
  HumanTakeover,
  PreparedEnvironment,
  Trigger,
} from "@/lib/fleet/types";

type AutomationWithHealth = Automation & { health: AutomationHealth; lastRun?: RunSummary };

type View = "all" | "attention" | "active" | "drafts" | "tests";

const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "active", label: "Active" },
  { key: "drafts", label: "Drafts" },
  { key: "tests", label: "Tests" },
];

/** Median of a numeric list, or undefined when there is nothing to measure. */
function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function formatMs(ms: number | undefined): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function AutomationsList() {
  const router = useRouter();
  const automations = usePolling<AutomationWithHealth[]>("/api/automations", 10000);
  const runs = usePolling<RunSummary[]>("/api/runs", 10000);
  const takeovers = usePolling<HumanTakeover[]>("/api/takeovers?status=open", 10000);
  const environments = usePolling<PreparedEnvironment[]>("/api/environments", 60000);
  const triggers = usePolling<Trigger[]>("/api/triggers", 60000);
  const [view, setView] = useState<View>("all");

  const all = useMemo(() => automations.data ?? [], [automations.data]);
  const allRuns = useMemo(() => runs.data ?? [], [runs.data]);
  const needsHumanRunIds = new Set((takeovers.data ?? []).map((t) => t.runId));
  const envName = new Map((environments.data ?? []).map((e) => [e.id, e.name]));

  /** What actually fires each automation, in words rather than cron. */
  const triggerLabel = (workflowId: string) => {
    const mine = (triggers.data ?? []).filter((t) => t.workflowId === workflowId && t.enabled);
    if (mine.length === 0) return "manual";
    const schedule = mine.find((t) => t.type === "schedule");
    if (schedule) return cadenceLabel(schedule.cron) || "schedule";
    return mine[0].type;
  };

  /** Per-automation run stats, computed once for the whole table. */
  const stats = useMemo(() => {
    const byAutomation = new Map<
      string,
      { recent: boolean[]; success?: number; median?: number }
    >();
    for (const a of all) {
      const mine = allRuns.filter((r) => r.automationId === a.id);
      const finished = mine.filter((r) => r.status === "succeeded" || r.status === "failed");
      const durations = finished
        .filter((r) => r.finishedAt)
        .map((r) => new Date(r.finishedAt!).getTime() - new Date(r.startedAt).getTime())
        .filter((ms) => ms >= 0);
      byAutomation.set(a.id, {
        recent: finished.slice(0, 5).map((r) => r.status === "succeeded"),
        success: finished.length
          ? Math.round((finished.filter((r) => r.status === "succeeded").length / finished.length) * 100)
          : undefined,
        median: median(durations),
      });
    }
    return byAutomation;
  }, [all, allRuns]);

  const counts = {
    all: all.length,
    attention: all.filter(
      (a) =>
        a.health === "failing" ||
        a.health === "needs_attention" ||
        (a.lastRun ? needsHumanRunIds.has(a.lastRun.id) : false),
    ).length,
    active: all.filter((a) => a.status === "active").length,
    drafts: all.filter((a) => a.status === "draft").length,
    tests: all.filter((a) => a.category === "semantic_test").length,
  };

  const visible = all.filter((a) => {
    switch (view) {
      case "attention":
        return (
          a.health === "failing" ||
          a.health === "needs_attention" ||
          (a.lastRun ? needsHumanRunIds.has(a.lastRun.id) : false)
        );
      case "active":
        return a.status === "active";
      case "drafts":
        return a.status === "draft";
      case "tests":
        return a.category === "semantic_test";
      default:
        return true;
    }
  });

  return (
    <div className="page-pad wide">
      <div className="page-head">
        <div className="grow">
          <h1 className="t-display">Automations</h1>
          <p>
            Every automation is one object: intent, graph, the desktop it runs on, its triggers, and its
            whole run history.
          </p>
        </div>
        <Link href="/automations/new" className="btn btn-primary btn-lg">
          <Plus className="ico" aria-hidden="true" />
          New automation
        </Link>
      </div>

      <div className="hstack-w" style={{ marginBottom: 12 }}>
        <Segmented
          label="Views"
          value={view}
          onChange={setView}
          options={VIEWS.map((v) => ({
            key: v.key,
            label: (
              <>
                {v.label}{" "}
                <span
                  className="t-num"
                  style={{ color: v.key === "attention" && counts.attention ? "var(--human)" : "var(--text-3)" }}
                >
                  {counts[v.key]}
                </span>
              </>
            ),
          }))}
        />
      </div>

      <StaleNotice error={automations.error} onRetry={() => void automations.refresh()} />

      <Card>
        {visible.length === 0 ? (
          <Empty>
            {all.length === 0
              ? "No automations yet. Describe one in plain language to get started."
              : "Nothing in this view."}
          </Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: "32%" }}>Automation</th>
                <th>Status</th>
                <th>Last 5 runs</th>
                <th>Runs on</th>
                <th>Trigger</th>
                <th className="num">Success</th>
                <th className="num">Median</th>
                <th className="num">Last run</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const s = stats.get(a.id);
                return (
                  <tr key={a.id} {...rowLinkProps(() => router.push(`/automations/${a.id}`))}>
                    <td>
                      <div className="row-title truncate">{a.name}</div>
                      <div className="hstack" style={{ gap: 6, marginTop: 3 }}>
                        <Chip>{categoryLabel(a.category)}</Chip>
                        <span className="t-xs dimmer truncate">{a.goal}</span>
                      </div>
                    </td>
                    <td>
                      <div className="hstack" style={{ gap: 6 }}>
                        <Pill tone={automationStatusTone(a.status)}>{a.status}</Pill>
                        <Pill tone={automationHealthTone(a.health)}>{statusLabel(a.health)}</Pill>
                      </div>
                    </td>
                    <td>
                      <RunStrip results={s?.recent ?? []} />
                    </td>
                    <td className="dim truncate">
                      {a.environmentId ? (
                        envName.get(a.environmentId) ?? "—"
                      ) : (
                        <span className="faint">any desktop</span>
                      )}
                    </td>
                    <td className="dim truncate">{triggerLabel(a.workflowId)}</td>
                    <td className="num dim">{s?.success != null ? `${s.success}%` : "—"}</td>
                    <td className="num dim">{formatMs(s?.median)}</td>
                    <td className="num dimmer">
                      {a.lastRun ? timeAgo(a.lastRun.startedAt) : "never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <p className="t-sm faint" style={{ marginTop: 12 }}>
        Press <span className="kbd">⌘K</span> to jump to any automation, run or environment.
      </p>
    </div>
  );
}
