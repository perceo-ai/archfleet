import { describe, expect, it, vi } from "vitest";
import { notifyRun, shouldNotify, buildNotification } from "./notify";
import type { WorkflowRun } from "./types";

function run(status: WorkflowRun["status"]): WorkflowRun {
  return { id: "r1", workflowId: "wf", workflowName: "Portal", status, startedAt: "t", events: [] };
}

describe("notify", () => {
  it("notifies on paused + failed, not on succeeded/queued", () => {
    expect(shouldNotify("paused")).toBe(true);
    expect(shouldNotify("failed")).toBe(true);
    expect(shouldNotify("succeeded")).toBe(false);
    expect(shouldNotify("queued")).toBe(false);
  });

  it("includes XRDP takeover details for paused runs", () => {
    const n = buildNotification(run("paused"), { host: "127.0.0.1", port: 13389, username: "agent" });
    expect(n.text).toContain("XRDP 127.0.0.1:13389");
    expect(n.xrdp).toEqual({ host: "127.0.0.1", port: 13389, username: "agent" });
  });

  it("POSTs to the webhook for a paused run", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const ok = await notifyRun(run("paused"), {
      webhookUrl: "https://hook",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      xrdp: { host: "h", port: 1, username: "u" },
    });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("no-ops without a webhook url or on success", async () => {
    expect(await notifyRun(run("paused"), {})).toBe(false);
    expect(await notifyRun(run("succeeded"), { webhookUrl: "https://hook" })).toBe(false);
  });
});
