"use client";

// Every run, live and historical, in one place. This is the audit trail — the
// thing finance and compliance ask for — not a second home page.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { usePolling } from "@/lib/ui/api";
import { duration, timeAgo } from "@/lib/ui/format";
import { runStatusTone, statusLabel, toneColor } from "@/components/fleet/status-colors";
import { Card, Empty, Pill, Segmented, StaleNotice, rowLinkProps } from "@/components/ui/primitives";
import type { RunSummary } from "@/lib/fleet/db/runs-repo";
import type { Automation, HumanTakeover } from "@/lib/fleet/types";

type View = "all" | "live" | "failed" | "human";

const HOURS = 24;

/** Runs per hour for the last day, coloured by the worst outcome in the bucket. */
function volumeByHour(runs: RunSummary[], now = Date.now()) {
  const buckets = Array.from({ length: HOURS }, () => ({ total: 0, failed: 0, human: 0 }));
  for (const run of runs) {
    const age = now - new Date(run.startedAt).getTime();
    const hour = Math.floor(age / 3_600_000);
    if (hour < 0 || hour >= HOURS) continue;
    const b = buckets[HOURS - 1 - hour];
    b.total++;
    if (run.status === "failed") b.failed++;
    if (run.status === "paused") b.human++;
  }
  return buckets;
}

export function ActivityPage() {
  const router = useRouter();
  const [limit, setLimit] = useState(50);
  const runs = usePolling<RunSummary[]>(`/api/runs?limit=${limit}`, 5000);
  const takeovers = usePolling<HumanTakeover[]>("/api/takeovers?status=open", 10000);
  const automations = usePolling<Automation[]>("/api/automations", 60000);
  const [view, setView] = useState<View>("all");

  const all = useMemo(() => runs.data ?? [], [runs.data]);
  const takeoverRunIds = new Set((takeovers.data ?? []).map((t) => t.runId));
  const nameById = new Map((automations.data ?? []).map((a) => [a.id, a.name]));

  const visible = all.filter((r) => {
    switch (view) {
      case "live":
        return r.status === "running" || r.status === "queued";
      case "failed":
        return r.status === "failed";
      case "human":
        return r.status === "paused" || takeoverRunIds.has(r.id);
      default:
        return true;
    }
  });

  const buckets = useMemo(() => volumeByHour(all), [all]);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.total));
  const failedCount = all.filter((r) => r.status === "failed").length;

  return (
    <div className="page-pad wide">
      <div className="page-head">
        <div className="grow">
          <h1 className="t-display">Activity</h1>
          <p>Every run across every automation. Each row keeps its evidence with it.</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => void runs.refresh()}>
          <RefreshCw className="ico" aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="hstack-w" style={{ marginBottom: 14 }}>
        <Segmented
          label="Filter runs"
          value={view}
          onChange={setView}
          options={[
            { key: "all", label: "All" },
            { key: "live", label: "Live" },
            { key: "failed", label: "Failed" },
            { key: "human", label: "Needed a human" },
          ]}
        />
      </div>

      <Card className="stack" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="grow">
            <h2>Last 24 hours</h2>
            <p>
              {all.length} runs · {failedCount} failed · {takeoverRunIds.size} needed a human
            </p>
          </div>
        </div>
        <div className="card-body">
          <div className="hstack" style={{ gap: 3, alignItems: "flex-end", height: 60 }}>
            {buckets.map((b, i) => (
              <i
                key={i}
                title={`${b.total} runs`}
                style={{
                  flex: 1,
                  height: Math.max(4, (b.total / maxBucket) * 56),
                  borderRadius: "3px 3px 0 0",
                  opacity: 0.85,
                  background: b.failed
                    ? toneColor("danger")
                    : b.human
                      ? toneColor("human")
                      : b.total
                        ? "var(--accent)"
                        : "var(--line-2)",
                }}
              />
            ))}
          </div>
          <div className="hstack t-xs faint" style={{ marginTop: 6 }}>
            <span>24h ago</span>
            <div className="spacer" />
            <span>now</span>
          </div>
        </div>
      </Card>

      <StaleNotice error={runs.error} onRetry={() => void runs.refresh()} />

      <Card>
        {visible.length === 0 ? (
          <Empty>No runs in this view.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th className="num" style={{ width: 92 }}>Started</th>
                <th style={{ width: "22%" }}>Automation</th>
                <th>Result</th>
                <th>Detail</th>
                <th className="num">Duration</th>
                <th className="num">Trigger</th>
                <th className="num">Desktop</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} {...rowLinkProps(() => router.push(`/runs/${r.id}`))}>
                  <td className="num t-num dimmer">{timeAgo(r.startedAt)}</td>
                  <td>
                    <span className="row-title truncate">
                      {(r.automationId && nameById.get(r.automationId)) || r.workflowName}
                    </span>
                  </td>
                  <td>
                    <Pill
                      tone={runStatusTone(r.status)}
                      live={r.status === "running" || r.status === "paused"}
                    >
                      {statusLabel(r.status)}
                    </Pill>
                  </td>
                  <td className="dim truncate">{r.resultSummary ?? r.currentStep ?? "—"}</td>
                  <td className="num t-num dim">{duration(r.startedAt, r.finishedAt)}</td>
                  <td className="num dimmer">{r.triggerSource ?? "manual"}</td>
                  <td className="num mono dimmer">{r.vmId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="hstack" style={{ marginTop: 12 }}>
        <p className="t-sm faint" style={{ margin: 0 }}>
          Showing the {all.length} most recent runs. <Link href="/">Inbox</Link> groups the failures by
          cause.
        </p>
        <div className="spacer" />
        {all.length >= limit && limit < 500 ? (
          <button type="button" className="btn btn-sm" onClick={() => setLimit((n) => Math.min(n + 100, 500))}>
            Load more
          </button>
        ) : null}
      </div>
    </div>
  );
}
