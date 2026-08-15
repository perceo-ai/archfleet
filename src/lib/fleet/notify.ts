// Operator notifications. When a run needs a human (paused) or fails, POST a
// compact message to CUF_NOTIFY_WEBHOOK (Slack-compatible `text`, plus structured
// fields). Best-effort — never throws into the run path.

import type { HumanTakeover, WorkflowRun } from "./types";

export type NotifyOpts = {
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
  xrdp?: { host: string; port: number; username: string };
};

/** True when a run reaching this status is worth paging an operator about. */
export function shouldNotify(status: WorkflowRun["status"]): boolean {
  return status === "paused" || status === "failed";
}

export function buildNotification(run: WorkflowRun, xrdp?: NotifyOpts["xrdp"]) {
  const takeover =
    run.status === "paused" && xrdp
      ? ` — take over via XRDP ${xrdp.host}:${xrdp.port} (user ${xrdp.username})`
      : "";
  return {
    text: `archfleet: run ${run.id} of "${run.workflowName}" is ${run.status}${takeover}`,
    runId: run.id,
    workflow: run.workflowName,
    status: run.status,
    xrdp: run.status === "paused" ? xrdp : undefined,
  };
}

export async function notifyRun(run: WorkflowRun, opts: NotifyOpts = {}): Promise<boolean> {
  const url = opts.webhookUrl ?? process.env.CUF_NOTIFY_WEBHOOK;
  if (!url || !shouldNotify(run.status)) return false;
  return post(url, buildNotification(run, opts.xrdp), opts.fetchImpl);
}

/** Reminder page for a takeover nobody has responded to. Best-effort. */
export async function notifyTakeoverEscalation(
  takeover: HumanTakeover,
  waitedMinutes: number,
  opts: NotifyOpts = {},
): Promise<boolean> {
  const url = opts.webhookUrl ?? process.env.CUF_NOTIFY_WEBHOOK;
  if (!url) return false;
  return post(
    url,
    {
      text: `archfleet: run ${takeover.runId} is STILL waiting for a human after ${waitedMinutes} min — ${takeover.requestedAction}`,
      runId: takeover.runId,
      takeoverId: takeover.id,
      status: "escalated",
      waitedMinutes,
    },
    opts.fetchImpl,
  );
}

async function post(url: string, body: unknown, fetchImpl?: typeof fetch): Promise<boolean> {
  const doFetch = fetchImpl ?? fetch;
  try {
    await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return true;
  } catch {
    return false; // notifications are best-effort
  }
}
