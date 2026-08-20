// Long workflows. The short tests prove each node kind in isolation; these run
// the kind of graph someone actually builds — twenty-plus steps, branches that
// rejoin, retries, a takeover in the middle, data threaded from the first step
// to the last — because that is where an engine breaks.

import { describe, expect, it, vi } from "vitest";
import { runWorkflow, type OrchestratorDeps } from "./orchestrator";
import { validateWorkflow } from "./workflow-validation";
import type { CustomNodeType } from "./node-types";
import type { Workflow, WorkflowEdge, WorkflowNode } from "./types";

function node(id: string, type: WorkflowNode["type"], config: WorkflowNode["config"] = {}): WorkflowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, config };
}

function edge(from: string, to: string, condition: WorkflowEdge["condition"] = "success"): WorkflowEdge {
  return { id: `${from}->${to}-${condition}`, from, to, condition };
}

function wf(nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow {
  return {
    id: "wf_long",
    name: "long",
    description: "",
    enabled: true,
    triggerKinds: ["manual"],
    nodes,
    edges,
  };
}

function deps(over: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  let t = 0;
  return {
    daemon: {
      acquire: vi.fn(async () => ({ ok: false as const, reason: "no_matching_vm" as const })),
      release: vi.fn(async () => {}),
    } as unknown as OrchestratorDeps["daemon"],
    exec: vi.fn() as unknown as OrchestratorDeps["exec"],
    now: () => new Date(1770000000000 + t++ * 1000).toISOString(),
    sleep: vi.fn(async () => {}),
    ...over,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const said = (r: { events: { message: string }[] }, needle: string) =>
  r.events.some((e) => e.message.includes(needle));

/* ------------------------------------------------------------------ */

describe("a long linear pipeline", () => {
  /** 20 shell steps, each reading the value the previous one computed. */
  function pipeline(steps: number): Workflow {
    const nodes: WorkflowNode[] = [node("start", "start")];
    const edges: WorkflowEdge[] = [];
    let previous = "start";
    for (let i = 1; i <= steps; i++) {
      const id = `step_${i}`;
      nodes.push(
        node(id, "set_params", {
          assign: { counter: i === 1 ? "1" : "number(params.counter) + 1", last: `"${id}"` },
        }),
      );
      edges.push(edge(previous, id));
      previous = id;
    }
    nodes.push(node("check", "condition", { expr: `number(params.counter) == ${steps}` }));
    edges.push(edge(previous, "check"));
    nodes.push(node("end", "end"));
    edges.push(edge("check", "end", "success"));
    return wf(nodes, edges);
  }

  it("runs twenty chained steps and threads a value through all of them", async () => {
    const workflow = pipeline(20);
    expect(validateWorkflow(workflow)).toEqual([]);

    const result = await runWorkflow(
      { workflow, secrets: [], params: [], runId: "r_long" },
      deps(),
    );

    expect(result.status).toBe("succeeded");
    expect(said(result, 'Condition "check" -> success')).toBe(true);
    expect(result.currentStep).toBe("end");
  });

  it("does not trip the cycle guard on a long-but-acyclic graph", async () => {
    // maxSteps is derived from node count; a 40-step chain must still finish.
    const result = await runWorkflow(
      { workflow: pipeline(40), secrets: [], params: [], runId: "r_long" },
      deps(),
    );
    expect(result.status).toBe("succeeded");
    expect(said(result, "exceeded max steps")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe("a realistic invoice run, end to end", () => {
  /**
   * trigger → fetch → switch(3 branches) → per-branch work → rejoin → retrying
   * a flaky upload → notify via a custom node → verify → done.
   */
  function invoiceWorkflow(): Workflow {
    return wf(
      [
        node("start", "start"),
        node("Fetch invoices", "api_call", { prompt: '{"url":"https://billing/invoices"}' }),
        node("Size", "switch", {
          cases: [
            { label: "large", expr: 'steps["Fetch invoices"].body.total > 1000' },
            { label: "small", expr: 'steps["Fetch invoices"].body.total > 0' },
            { label: "empty", expr: "true" },
          ],
        }),
        node("Flag for review", "set_params", {
          assign: { route: '"review"', amount: 'steps["Fetch invoices"].body.total' },
        }),
        node("File it", "set_params", {
          assign: { route: '"file"', amount: 'steps["Fetch invoices"].body.total' },
        }),
        node("Stop early", "set_params", { assign: { route: '"none"' } }),
        node("Upload", "shell_task", { prompt: "upload --amount {{param.amount}}" }),
        node("Retry upload", "retry_wait", { maxAttempts: 3 }),
        node("Notify", "custom", {
          customTypeId: "slack",
          fields: { text: "Filed {{param.route}} for {{param.amount}}" },
        }),
        node("Verify", "condition", { expr: 'steps["Notify"].ok == true' }),
        node("end", "end"),
      ],
      [
        edge("start", "Fetch invoices"),
        edge("Fetch invoices", "Size"),
        edge("Size", "Flag for review", "case:large"),
        edge("Size", "File it", "case:small"),
        edge("Size", "Stop early", "case:empty"),
        edge("Flag for review", "Upload"),
        edge("File it", "Upload"),
        edge("Stop early", "end", "always"),
        edge("Upload", "Notify", "success"),
        edge("Upload", "Retry upload", "failure"),
        edge("Retry upload", "Notify", "success"),
        edge("Notify", "Verify"),
        edge("Verify", "end", "success"),
      ],
    );
  }

  const slack: CustomNodeType = {
    id: "slack",
    name: "Post to Slack",
    description: "",
    base: "http",
    fields: [{ name: "text", label: "Message", type: "textarea", required: true }],
    template: '{"url": "https://hooks.test/x", "method": "POST", "body": {"text": "{{field.text}}"}}',
    createdAt: "t",
    updatedAt: "t",
  };

  it("validates as a graph before anything runs", () => {
    expect(validateWorkflow(invoiceWorkflow())).toEqual([]);
  });

  it("takes the large branch, uploads, notifies and verifies", async () => {
    const shellExec = vi.fn(async () => ({ code: 0, stdout: "ok", stderr: "" }));
    const httpFetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("hooks.test") ? json({ ok: true }) : json({ total: 2480 }),
    );

    const result = await runWorkflow(
      { workflow: invoiceWorkflow(), secrets: [], params: [], runId: "r_inv" },
      deps({
        shellExec,
        httpFetch: httpFetch as unknown as typeof fetch,
        customNodeTypes: { slack },
      }),
    );

    expect(result.status).toBe("succeeded");
    expect(said(result, 'Switch "Size" -> "large"')).toBe(true);
    // the branch's computed amount reached the shell step
    expect(shellExec).toHaveBeenCalledWith("upload --amount 2480", expect.anything());
    // and the custom node's message was templated from a param set two nodes earlier
    const slackCall = httpFetch.mock.calls.find(([u]) => String(u).includes("hooks.test")) as
      | [string, RequestInit]
      | undefined;
    expect(JSON.parse(String(slackCall?.[1]?.body))).toEqual({
      text: "Filed review for 2480",
    });
  });

  it("recovers through the retry branch when the upload is flaky", async () => {
    let attempts = 0;
    const shellExec = vi.fn(async () => {
      attempts++;
      return attempts < 3
        ? { code: 1, stdout: "", stderr: "network blip" }
        : { code: 0, stdout: "ok", stderr: "" };
    });
    const httpFetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("hooks.test") ? json({ ok: true }) : json({ total: 12 }),
    );

    const result = await runWorkflow(
      { workflow: invoiceWorkflow(), secrets: [], params: [], runId: "r_inv" },
      deps({
        shellExec,
        httpFetch: httpFetch as unknown as typeof fetch,
        customNodeTypes: { slack },
      }),
    );

    expect(said(result, 'Switch "Size" -> "small"')).toBe(true);
    expect(said(result, 'Node "Retry upload": retry 1/3')).toBe(true);
    expect(attempts).toBeGreaterThan(1);
    expect(result.status).toBe("succeeded");
  });

  it("stops on the empty branch without touching the uploader", async () => {
    const shellExec = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const result = await runWorkflow(
      { workflow: invoiceWorkflow(), secrets: [], params: [], runId: "r_inv" },
      deps({
        shellExec,
        httpFetch: vi.fn(async () => json({ total: 0 })) as unknown as typeof fetch,
        customNodeTypes: { slack },
      }),
    );
    expect(said(result, 'Switch "Size" -> "empty"')).toBe(true);
    expect(shellExec).not.toHaveBeenCalled();
    expect(result.status).toBe("succeeded");
  });
});

/* ------------------------------------------------------------------ */

describe("a long run that pauses in the middle and resumes", () => {
  const workflow = wf(
    [
      node("start", "start"),
      node("Sign in", "shell_task", { prompt: "login" }),
      node("Ask", "human_takeover", {
        ask: {
          kind: "input",
          question: "Which PO?",
          fields: [{ name: "po", label: "PO", type: "text", required: true }],
        },
      }),
      node("File under PO", "shell_task", { prompt: "file --po {{param.po}}" }),
      node("Confirm", "condition", { expr: 'contains(steps["File under PO"].stdout, "filed")' }),
      node("end", "end"),
    ],
    [
      edge("start", "Sign in"),
      edge("Sign in", "Ask"),
      edge("Ask", "File under PO"),
      edge("File under PO", "Confirm"),
      edge("Confirm", "end", "success"),
    ],
  );

  it("pauses at the ask, carrying the question as the reason", async () => {
    const result = await runWorkflow(
      { workflow, secrets: [], params: [], runId: "r_pause" },
      deps({ shellExec: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })) }),
    );
    expect(result.status).toBe("paused");
    expect(result.currentStep).toBe("Ask");
    expect(result.pausedReason).toBe("Which PO?");
  });

  it("resumes past the ask with the answer in hand and finishes", async () => {
    const shellExec = vi.fn(async () => ({ code: 0, stdout: "filed", stderr: "" }));
    // The takeover resolve writes the answer into run params, then the worker
    // restarts traversal after the pause point — this is that second attempt.
    const result = await runWorkflow(
      {
        workflow,
        secrets: [],
        params: [{ id: "p", name: "po", scope: "run", value: "PO-4821" }],
        runId: "r_pause",
        startNodeId: "File under PO",
      },
      deps({ shellExec }),
    );
    expect(result.status).toBe("succeeded");
    expect(shellExec).toHaveBeenCalledWith("file --po PO-4821", expect.anything());
    expect(said(result, 'Resuming from "File under PO"')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("long-run failure behaviour", () => {
  it("still stops a genuine cycle instead of running forever", async () => {
    const workflow = wf(
      [
        node("start", "start"),
        node("A", "set_params", { assign: { n: "number(default(params.n, 0)) + 1" } }),
        node("B", "set_params", { assign: { m: "1" } }),
        node("end", "end"),
      ],
      [edge("start", "A"), edge("A", "B"), edge("B", "A", "always")],
    );
    const result = await runWorkflow(
      { workflow, secrets: [], params: [], runId: "r_cycle" },
      deps(),
    );
    expect(result.status).toBe("failed");
    expect(said(result, "exceeded max steps")).toBe(true);
  });

  it("carries a failure through several nodes to an unhandled dead end", async () => {
    const workflow = wf(
      [
        node("start", "start"),
        node("One", "set_params", { assign: { a: "1" } }),
        node("Two", "api_call", { prompt: '{"url":"https://x"}' }),
        node("Three", "set_params", { assign: { b: "2" } }),
        node("end", "end"),
      ],
      [edge("start", "One"), edge("One", "Two"), edge("Two", "Three", "success"), edge("Three", "end")],
    );
    const result = await runWorkflow(
      { workflow, secrets: [], params: [], runId: "r_dead" },
      deps({ httpFetch: vi.fn(async () => json({ error: "nope" }, 500)) as unknown as typeof fetch }),
    );
    // No failure edge out of "Two": the run fails there rather than silently
    // continuing down the success path.
    expect(result.status).toBe("failed");
    expect(result.currentStep).toBe("Two");
    expect(said(result, 'Set "Three"')).toBe(false);
  });

  it("keeps every step's output addressable at the end of a long run", async () => {
    const workflow = wf(
      [
        node("start", "start"),
        node("A", "api_call", { prompt: '{"url":"https://x/a"}' }),
        node("B", "api_call", { prompt: '{"url":"https://x/b"}' }),
        node("C", "api_call", { prompt: '{"url":"https://x/c"}' }),
        node("Sum", "set_params", {
          assign: { total: "steps.A.body.n + steps.B.body.n + steps.C.body.n" },
        }),
        node("Check", "condition", { expr: "number(params.total) == 6" }),
        node("end", "end"),
      ],
      [
        edge("start", "A"),
        edge("A", "B"),
        edge("B", "C"),
        edge("C", "Sum"),
        edge("Sum", "Check"),
        edge("Check", "end", "success"),
      ],
    );
    let n = 0;
    const result = await runWorkflow(
      { workflow, secrets: [], params: [], runId: "r_sum" },
      deps({ httpFetch: vi.fn(async () => json({ n: ++n })) as unknown as typeof fetch }),
    );
    expect(said(result, 'Condition "Check" -> success')).toBe(true);
    expect(result.status).toBe("succeeded");
  });
});

describe("the question a human is shown", () => {
  it("resolves templates in the ask, so nobody reads {{param.x}}", async () => {
    const workflow = wf(
      [
        node("start", "start"),
        node("Total", "set_params", { assign: { amount: "2480", vendor: '"Acme"' } }),
        node("Approve", "human_takeover", {
          ask: {
            kind: "approval",
            question: "Send ${{param.amount}} to {{param.vendor}}?",
            detail: "Above the {{param.limit}} policy threshold.",
            options: [
              { value: "approved", label: "Approve {{param.vendor}}" },
              { value: "rejected", label: "Reject" },
            ],
          },
        }),
        node("end", "end"),
      ],
      [edge("start", "Total"), edge("Total", "Approve"), edge("Approve", "end", "always")],
    );

    const result = await runWorkflow(
      {
        workflow,
        secrets: [],
        params: [{ id: "p", name: "limit", scope: "run", value: "$1,000" }],
        runId: "r_ask",
      },
      deps(),
    );

    expect(result.status).toBe("paused");
    expect(result.pausedReason).toBe("Send $2480 to Acme?");
    expect(result.pausedAsk?.question).toBe("Send $2480 to Acme?");
    expect(result.pausedAsk?.detail).toBe("Above the $1,000 policy threshold.");
    expect(result.pausedAsk?.options?.[0].label).toBe("Approve Acme");
  });

  it("never shows a secret in the question it asks", async () => {
    const workflow = wf(
      [
        node("start", "start"),
        node("Ask", "human_takeover", {
          ask: { kind: "acknowledge", question: "Sign in with {{secret.portal_password}} and continue." },
        }),
        node("end", "end"),
      ],
      [edge("start", "Ask"), edge("Ask", "end", "always")],
    );
    const result = await runWorkflow(
      {
        workflow,
        secrets: [{ id: "s", name: "portal_password", scope: "workflow", value: "hunter2" }],
        params: [],
        runId: "r_secret",
      },
      deps(),
    );
    expect(result.pausedAsk?.question).not.toContain("hunter2");
    expect(result.pausedReason).not.toContain("hunter2");
  });

  it("still falls back to the legacy prompt when there is no ask", async () => {
    const workflow = wf(
      [
        node("start", "start"),
        node("Old", "human_takeover", { prompt: "Finish the login, then resume." }),
        node("end", "end"),
      ],
      [edge("start", "Old"), edge("Old", "end", "always")],
    );
    const result = await runWorkflow({ workflow, secrets: [], params: [], runId: "r_old" }, deps());
    expect(result.pausedReason).toBe("Finish the login, then resume.");
  });
});

describe("values computed before a pause", () => {
  const workflow = wf(
    [
      node("start", "start"),
      node("Work it out", "set_params", { assign: { total: "40 + 2", label: '"invoice"' } }),
      node("Ask", "human_takeover", {
        ask: { kind: "acknowledge", question: "Total is {{param.total}} — carry on?" },
      }),
      node("Use it", "shell_task", { prompt: "file --{{param.label}} {{param.total}}" }),
      node("end", "end"),
    ],
    [edge("start", "Work it out"), edge("Work it out", "Ask"), edge("Ask", "Use it"), edge("Use it", "end")],
  );

  it("reports every computed param so the caller can persist it", async () => {
    const onParam = vi.fn();
    const result = await runWorkflow(
      { workflow, secrets: [], params: [], runId: "r_persist" },
      deps({ onParam }),
    );
    expect(result.status).toBe("paused");
    expect(onParam.mock.calls).toEqual([
      ["total", 42],
      ["label", "invoice"],
    ]);
    // and the question the human reads already has the computed value in it
    expect(result.pausedAsk?.question).toBe("Total is 42 — carry on?");
  });

  it("still has those values after resuming past the question", async () => {
    const shellExec = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    // Second attempt: the caller fed the persisted params back in.
    const result = await runWorkflow(
      {
        workflow,
        secrets: [],
        params: [
          { id: "p1", name: "total", scope: "run", value: 42 },
          { id: "p2", name: "label", scope: "run", value: "invoice" },
        ],
        runId: "r_persist",
        startNodeId: "Use it",
      },
      deps({ shellExec }),
    );
    expect(result.status).toBe("succeeded");
    expect(shellExec).toHaveBeenCalledWith("file --invoice 42", expect.anything());
  });
});
