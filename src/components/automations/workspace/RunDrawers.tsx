"use client";

// A run opens over the workspace, never as a route jump — you keep the graph you
// were looking at. The full page at /runs/[id] is one click away for the detail.

import Link from "next/link";
import { Monitor } from "lucide-react";
import { sendJson, usePolling } from "@/lib/ui/api";
import { duration, timeAgo } from "@/lib/ui/format";
import { runStatusTone, statusLabel } from "@/components/fleet/status-colors";
import { Banner, Card, CardHead, Empty, Pill, rowLinkProps } from "@/components/ui/primitives";
import { AskPanel } from "@/components/inbox/AskPanel";
import { parseAsk } from "@/lib/fleet/human-ask";
import { Drawer } from "@/components/ui/Overlay";
import type { RunSummary } from "@/lib/fleet/db/runs-repo";
import type { HumanTakeover, WorkflowRun } from "@/lib/fleet/types";

const isImage = (path: string) => /\.(png|jpe?g)$/i.test(path);
const fileName = (path: string) => path.split("/").pop() ?? path;

export function RunDrawer({
  runId,
  open,
  onClose,
  onChanged,
}: {
  runId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const run = usePolling<WorkflowRun>(runId ? `/api/runs/${runId}` : "", open && runId ? 2500 : 0);
  const takeovers = usePolling<HumanTakeover[]>(
    "/api/takeovers?status=open",
    open && runId ? 5000 : 0,
  );
  const data = run.data;
  const takeover = (takeovers.data ?? []).find((t) => t.runId === runId);

  async function act(action: "resume" | "cancel" | "retry") {
    if (!runId) return;
    await sendJson(`/api/runs/${runId}/action`, "POST", { action }).catch(() => undefined);
    await run.refresh();
    onChanged?.();
  }

  /** Answering goes through the takeover so the values land in the run. */
  async function answer(action: "resume" | "cancel", answers?: Record<string, string>) {
    if (!takeover) return act(action);
    await sendJson(`/api/takeovers/${takeover.id}/resolve`, "POST", { action, answers }).catch(
      () => undefined,
    );
    await Promise.all([run.refresh(), takeovers.refresh()]);
    onChanged?.();
  }

  const artifacts = data?.artifacts ?? [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="hstack">
          <span>{data?.workflowName ?? "Run"}</span>
          {data ? (
            <Pill tone={runStatusTone(data.status)} live={data.status === "running" || data.status === "paused"}>
              {statusLabel(data.status)}
            </Pill>
          ) : null}
        </span>
      }
      subtitle={
        data
          ? `started ${timeAgo(data.startedAt)} · ${duration(data.startedAt, data.finishedAt)}${
              data.vmId ? ` · ${data.vmId}` : ""
            }`
          : undefined
      }
      actions={
        runId ? (
          <Link href={`/runs/${runId}`} className="btn btn-sm">
            Open full view
          </Link>
        ) : null
      }
    >
      {!data ? (
        <Empty>{run.error ?? "Loading run…"}</Empty>
      ) : (
        <div className="stack">
          {data.status === "paused" ? (
            <Banner
              tone="human"
              title={takeover?.ask?.question ?? data.pausedReason ?? "This run needs a human"}
            >
              <div className="stack-s" style={{ marginTop: 8 }}>
                <AskPanel
                  ask={parseAsk(
                    takeover?.ask ?? takeover?.requestedAction ?? data.pausedReason,
                    "This run needs a human.",
                  )}
                  onAnswer={(answers) => void answer("resume", answers)}
                  onCancel={() => void answer("cancel")}
                />
                <Link href={`/runs/${data.id}`} className="t-xs" style={{ color: "var(--accent-hi)" }}>
                  <Monitor className="ico" aria-hidden="true" style={{ verticalAlign: "-2px" }} /> open the
                  desktop in the full run view
                </Link>
              </div>
            </Banner>
          ) : null}

          {data.status === "failed" ? (
            <Banner
              tone="danger"
              title={`Failed${data.currentStep ? ` at “${data.currentStep}”` : ""}`}
              right={
                <button type="button" className="btn btn-sm" onClick={() => void act("retry")}>
                  Retry
                </button>
              }
            >
              {data.resultSummary ?? "No reason recorded."}
            </Banner>
          ) : null}

          <Card>
            <CardHead title="What it did" subtitle="Secrets are redacted before anything is written." />
            <div className="card-body">
              <div className="log">
                {data.events.length === 0 ? (
                  <span className="dimmer">No events yet.</span>
                ) : (
                  data.events.map((e) => (
                    <div key={e.id} className={`lv-${e.level === "error" ? "err" : e.level}`}>
                      <span className="ts">{new Date(e.timestamp).toLocaleTimeString()}</span> {e.message}
                    </div>
                  ))
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Evidence" subtitle={`${artifacts.length} captured`} />
            <div className="card-body">
              {artifacts.length === 0 ? (
                <Empty>Nothing captured yet.</Empty>
              ) : (
                <div className="evidence-grid">
                  {artifacts.map((a) => {
                    const name = fileName(a.path);
                    const url = `/api/runs/${data.id}/artifacts/${encodeURIComponent(name)}`;
                    return (
                      <a key={a.id} className="shot" href={url} target="_blank" rel="noreferrer">
                        {isImage(name) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={name} style={{ width: "100%", display: "block" }} />
                        ) : (
                          <div className="thumb" />
                        )}
                        <div className="cap truncate">{name}</div>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </Drawer>
  );
}

export function RunsDrawer({
  runs,
  open,
  onClose,
  onOpenRun,
}: {
  runs: RunSummary[];
  open: boolean;
  onClose: () => void;
  onOpenRun: (id: string) => void;
}) {
  const finished = runs.filter((r) => r.status === "succeeded" || r.status === "failed");
  const rate = finished.length
    ? Math.round((finished.filter((r) => r.status === "succeeded").length / finished.length) * 100)
    : undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(760px, 92vw)"
      title="Run history"
      subtitle={`${runs.length} runs${rate != null ? ` · ${rate}% succeeded` : ""}`}
      actions={
        <Link href="/activity" className="btn btn-sm">
          All activity
        </Link>
      }
    >
      <Card>
        {runs.length === 0 ? (
          <Empty>No runs yet. Run it once to build history.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Started</th>
                <th>Result</th>
                <th className="num">Duration</th>
                <th className="num">Trigger</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} {...rowLinkProps(() => onOpenRun(r.id))}>
                  <td className="t-num">{timeAgo(r.startedAt)}</td>
                  <td>
                    <Pill tone={runStatusTone(r.status)}>
                      {r.status === "failed" && r.currentStep
                        ? `failed at “${r.currentStep}”`
                        : statusLabel(r.status)}
                    </Pill>
                  </td>
                  <td className="num t-num dim">{duration(r.startedAt, r.finishedAt)}</td>
                  <td className="num dimmer">{r.triggerSource ?? "manual"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Drawer>
  );
}
