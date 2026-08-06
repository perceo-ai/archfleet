// Operator notifications. When a run needs a human (paused) or fails, POST a
// compact message to CUF_NOTIFY_WEBHOOK (Slack-compatible `text`, plus structured
// fields). Best-effort — never throws into the run path.

import type { WorkflowRun } from "./types";

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
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildNotification(run, opts.xrdp)),
    });
    return true;
  } catch {
    return false; // notifications are best-effort
  }
}
