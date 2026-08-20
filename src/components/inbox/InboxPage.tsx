"use client";

// The landing page is the work queue, not a dashboard of links. Everything here
// is stuck, broken, or waiting on a decision — clear it and the fleet runs itself.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Hand, Plus, RefreshCw } from "lucide-react";
import { sendJson, usePolling } from "@/lib/ui/api";
import { duration, timeAgo } from "@/lib/ui/format";
import { groupFailures } from "@/lib/fleet/failure-groups";
import {
  Banner,
  Card,
  Chip,
  Empty,
  Meter,
  Pill,
  SectionHead,
  Sparkline,
  StaleNotice,
  Stat,
} from "@/components/ui/primitives";
import { AskPanel } from "@/components/inbox/AskPanel";
import { SetupBanner } from "@/components/settings/SetupPanel";
import { parseAsk } from "@/lib/fleet/human-ask";
import { Viewport } from "@/components/ui/Viewport";
import { useRunThumbnails } from "@/lib/ui/thumbnails";
import { bucketRunsByHour, successTrend } from "@/lib/fleet/run-trends";
import type { RunSummary } from "@/lib/fleet/db/runs-repo";
import type {
  Automation,
  AutomationHealth,
  FleetVm,
  HumanTakeover,
  PreparedEnvironment,
} from "@/lib/fleet/types";

type AutomationWithHealth = Automation & { health: AutomationHealth; lastRun?: RunSummary };

export function InboxPage() {
  const router = useRouter();
  const takeovers = usePolling<HumanTakeover[]>("/api/takeovers?status=open", 5000);
  const runs = usePolling<RunSummary[]>("/api/runs", 5000);
  const automations = usePolling<AutomationWithHealth[]>("/api/automations", 15000);
  const environments = usePolling<PreparedEnvironment[]>("/api/environments", 30000);
  const vms = usePolling<FleetVm[]>("/api/vms", 15000);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);


  const allRuns = useMemo(() => runs.data ?? [], [runs.data]);
  const allAutomations = automations.data ?? [];
  const openTakeovers = takeovers.data ?? [];
  const vmList = vms.data ?? [];

  const active = allRuns.filter((r) => r.status === "running" || r.status === "queued");
  const drafts = allAutomations.filter((a) => a.status === "draft");
  const failing = allAutomations.filter((a) => a.health === "failing");
  const groups = useMemo(() => groupFailures(allRuns), [allRuns]);
  const attentionEnvs = (environments.data ?? []).filter(
    (e) => e.health === "degraded" || e.health === "recovering",
  );

  const finished = allRuns.filter((r) => r.status === "succeeded" || r.status === "failed");
  const successRate = finished.length
    ? Math.round((finished.filter((r) => r.status === "succeeded").length / finished.length) * 100)
    : 100;
  const busyVms = vmList.filter((v) => v.status === "running" || v.status === "assigned").length;

  // Sparklines read the same hourly buckets the activity strip does.
  const buckets = useMemo(() => bucketRunsByHour(allRuns, 12), [allRuns]);
  const thumbnails = useRunThumbnails(openTakeovers.map((t) => t.runId));

  const automationName = (id: string | undefined) =>
    allAutomations.find((a) => a.id === id)?.name ?? "";

  async function answerTakeover(
    t: HumanTakeover,
    action: "resume" | "cancel",
    answers?: Record<string, string>,
  ) {
    setBusy(t.id);
    setMessage(null);
    try {
      await sendJson(`/api/takeovers/${t.id}/resolve`, "POST", { action, answers });
      await Promise.all([takeovers.refresh(), runs.refresh()]);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function activate(a: Automation) {
    setBusy(a.id);
    setMessage(null);
    try {
      await sendJson(`/api/automations/${a.id}`, "PATCH", { status: "active" });
      await automations.refresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function retryGroup(runIds: string[]) {
    setBusy(runIds[0]);
    setMessage(null);
    const results = await Promise.allSettled(
      runIds.map((id) => sendJson(`/api/runs/${id}/action`, "POST", { action: "retry" })),
    );
    const requeued = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - requeued;
    setMessage(
      failed === 0
        ? `Re-queued ${requeued} ${requeued === 1 ? "run" : "runs"}.`
        : `Re-queued ${requeued} of ${results.length}. ${failed} could not be retried — open one to see why.`,
    );
    await runs.refresh();
    setBusy(null);
  }

  const nothingToDo =
    openTakeovers.length === 0 && groups.length === 0 && drafts.length === 0 && attentionEnvs.length === 0;

  return (
    <div className="page-pad">
      <div className="page-head">
        <div className="grow">
          <h1 className="t-display">Inbox</h1>
          <p>Everything that is stuck, broken, or waiting on a decision.</p>
        </div>
        <div className="hstack">
          <button type="button" className="btn btn-sm" onClick={() => void runs.refresh()}>
            <RefreshCw className="ico" aria-hidden="true" />
            Refresh
          </button>
          <Link href="/automations/new" className="btn btn-primary">
            <Plus className="ico" aria-hidden="true" />
            New automation
          </Link>
        </div>
      </div>

      <SetupBanner />

      <div className="stats" style={{ marginBottom: 22 }}>
        <Stat value={openTakeovers.length} label="Waiting on you">
          <Sparkline values={buckets.map((b) => b.paused)} tone="var(--human-base)" />
        </Stat>
        <Stat value={active.length} label="Running now">
          <Sparkline values={buckets.map((b) => b.total)} tone="var(--accent)" />
        </Stat>
        <Stat value={`${successRate}%`} label="Recent success">
          <Sparkline values={successTrend(buckets)} tone="var(--ok-base)" />
        </Stat>
        <Stat value={failing.length} label="Failing automations">
          <Sparkline values={buckets.map((b) => b.failed)} tone="var(--danger-base)" />
        </Stat>
        <Stat value={`${busyVms}/${vmList.length}`} label="Desktops in use">
          <div style={{ marginTop: 11 }}>
            <Meter
              value={vmList.length ? (busyVms / vmList.length) * 100 : 0}
              tone={vmList.length && busyVms / vmList.length > 0.85 ? "warn" : undefined}
            />
          </div>
        </Stat>
      </div>

      <StaleNotice error={runs.error ?? takeovers.error} onRetry={() => void runs.refresh()} />
      {message ? (
        <p className="t-sm" style={{ color: "var(--text-2)" }} role="status">
          {message}
        </p>
      ) : null}

      <div className="stack-l">
        {openTakeovers.length > 0 ? (
          <section>
            <SectionHead
              tone="var(--human-base)"
              title="Needs a human"
              note={`${openTakeovers.length} ${openTakeovers.length === 1 ? "run is" : "runs are"} waiting on an answer. Any desktop involved is held until you reply.`}
            />
            <Card>
              <div className="rows">
                {openTakeovers.map((t) => (
                  <div className="row" key={t.id} style={{ alignItems: "flex-start" }}>
                    <Link href={`/runs/${t.runId}`} style={{ width: 132, flexShrink: 0 }}>
                      <Viewport
                        src={thumbnails.get(t.runId)}
                        alt={`Desktop held for ${t.reason}`}
                        style={{ borderRadius: "var(--radius)" }}
                        tag={
                          t.vmId ? (
                            <Pill tone="human" live className="t-xs">
                              desktop held
                            </Pill>
                          ) : undefined
                        }
                      />
                    </Link>
                    <div className="grow">
                      <div className="hstack-w">
                        <Link href={`/runs/${t.runId}`} className="row-title">
                          {t.reason}
                        </Link>
                        {t.vmId ? <Chip>{t.vmId}</Chip> : null}
                      </div>
                      <p className="t-sm dim" style={{ margin: "5px 0 0" }}>
                        {t.ask?.question ?? t.requestedAction}
                      </p>
                      <div className="row-sub" style={{ marginTop: 7 }}>
                        <span>paused {timeAgo(t.openedAt)}</span>
                        <span className="sep">·</span>
                        <span>held {duration(t.openedAt)}</span>
                        {t.notifiedAt ? (
                          <>
                            <span className="sep">·</span>
                            <span>operator paged {timeAgo(t.notifiedAt)}</span>
                          </>
                        ) : null}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <AskPanel
                          compact
                          ask={parseAsk(t.ask ?? t.requestedAction, t.reason)}
                          busy={busy === t.id}
                          onAnswer={(answers) => void answerTakeover(t, "resume", answers)}
                          onCancel={() => void answerTakeover(t, "cancel")}
                          onTakeOver={() => router.push(`/runs/${t.runId}`)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        ) : null}

        {groups.length > 0 ? (
          <section>
            <SectionHead
              tone="var(--danger-base)"
              title="Broken"
              note={`Grouped by cause — ${groups.reduce((n, g) => n + g.runs.length, 0)} failed runs, ${groups.length} ${groups.length === 1 ? "cause" : "causes"}.`}
            />
            <Card>
              <div className="rows">
                {groups.map((g) => (
                  <div className="row" key={g.key} style={{ alignItems: "flex-start" }}>
                    <div className="b-ico" style={{ background: "var(--danger-dim)", color: "var(--danger)" }}>
                      <AlertTriangle className="ico" aria-hidden="true" />
                    </div>
                    <div className="grow">
                      <Link href={`/runs/${g.runs[0].id}`} className="row-title">
                        {g.cause}
                      </Link>
                      <div className="row-sub">
                        <span className="strong" style={{ color: "var(--danger)" }}>
                          {g.runs.length} {g.runs.length === 1 ? "run" : "runs"}
                        </span>
                        {g.step ? (
                          <>
                            <span className="sep">·</span>
                            <span>at “{g.step}”</span>
                          </>
                        ) : null}
                        {g.automationIds.length ? (
                          <>
                            <span className="sep">·</span>
                            <span className="truncate">
                              {g.automationIds.map(automationName).filter(Boolean).join(", ")}
                            </span>
                          </>
                        ) : null}
                        <span className="sep">·</span>
                        <span>first seen {timeAgo(g.firstSeen)}</span>
                      </div>
                    </div>
                    <div className="hstack">
                      <Link href={`/runs/${g.runs[0].id}`} className="btn btn-sm">
                        Diagnose
                      </Link>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy === g.runs[0].id}
                        onClick={() => void retryGroup(g.runs.map((r) => r.id))}
                      >
                        Retry {g.runs.length}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        ) : null}

        {drafts.length > 0 ? (
          <section>
            <SectionHead
              tone="var(--accent)"
              title="Waiting on your review"
              note="Drafts activate once a run has passed."
            />
            <Card>
              <div className="rows">
                {drafts.map((a) => (
                  <div className="row" key={a.id}>
                    <div className="grow">
                      <Link href={`/automations/${a.id}`} className="row-title">
                        {a.name}
                      </Link>
                      <div className="row-sub">
                        <span className="truncate">{a.goal}</span>
                        {a.lastRun ? (
                          <>
                            <span className="sep">·</span>
                            <span>last run {timeAgo(a.lastRun.startedAt)}</span>
                          </>
                        ) : (
                          <>
                            <span className="sep">·</span>
                            <span>never run</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="hstack">
                      <Link href={`/automations/${a.id}`} className="btn btn-sm">
                        Open
                      </Link>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy === a.id}
                        onClick={() => void activate(a)}
                      >
                        Activate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        ) : null}

        {attentionEnvs.length > 0 ? (
          <Banner
            tone="warn"
            icon={<Hand className="ico" aria-hidden="true" />}
            title={`${attentionEnvs.length} ${attentionEnvs.length === 1 ? "environment needs" : "environments need"} attention`}
            right={
              <Link href="/environments" className="btn btn-sm">
                Open environments
              </Link>
            }
          >
            {attentionEnvs.map((e) => e.name).join(", ")} — runs on {attentionEnvs.length === 1 ? "it" : "them"} will
            fail on login until the session is re-captured.
          </Banner>
        ) : null}

        {nothingToDo ? (
          <div style={{ border: "1px dashed var(--line-2)", borderRadius: "var(--radius-lg)" }}>
            <Empty>
              {allAutomations.length === 0
                ? "No automations yet. Describe one in plain language to get started."
                : `Nothing needs you. ${allAutomations.length} automations are running unattended.`}
            </Empty>
          </div>
        ) : null}

        {active.length > 0 ? (
          <section>
            <SectionHead tone="var(--info-base)" title="In flight" />
            <Card>
              <div className="rows">
                {active.map((r) => (
                  <Link className="row" key={r.id} href={`/runs/${r.id}`}>
                    <div className="grow">
                      <div className="row-title">{r.workflowName}</div>
                      <div className="row-sub">
                        <span>{r.currentStep ?? "starting"}</span>
                        <span className="sep">·</span>
                        <span>{duration(r.startedAt)}</span>
                      </div>
                    </div>
                    <Pill tone={r.status === "running" ? "info" : "idle"} live={r.status === "running"}>
                      {r.status}
                    </Pill>
                  </Link>
                ))}
              </div>
            </Card>
          </section>
        ) : null}
      </div>
    </div>
  );
}
