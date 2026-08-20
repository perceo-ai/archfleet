// The rules half of the engine: conditions, switches, waits, computed params,
// and user-defined node types. None of these need a VM or a model, so they run
// entirely on fakes.

import { describe, expect, it, vi } from "vitest";
import { runWorkflow, type OrchestratorDeps } from "./orchestrator";
import type { CustomNodeType } from "./node-types";
import type { Workflow, WorkflowNode, WorkflowEdge } from "./types";

function node(id: string, type: WorkflowNode["type"], config: WorkflowNode["config"] = {}): WorkflowNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, config };
}

function edge(from: string, to: string, condition: WorkflowEdge["condition"] = "success"): WorkflowEdge {
  return { id: `${from}->${to}-${condition}`, from, to, condition };
}

function wf(nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow {
  return {
    id: "wf",
    name: "rules",
    description: "",
    enabled: true,
    triggerKinds: ["manual"],
    nodes: [node("start", "start"), ...nodes, node("end", "end")],
    edges,
  };
}

/** No VM, no ssh — these workflows never touch a desktop. */
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

const run = (workflow: Workflow, over: Partial<OrchestratorDeps> = {}) =>
  runWorkflow({ workflow, secrets: [], params: [], runId: "r1" }, deps(over));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("condition with an expression", () => {
  it("branches on what an earlier step produced", async () => {
    const workflow = wf(
      [
        node("Fetch", "api_call", { prompt: '{"url":"https://x/invoices"}' }),
        node("Big?", "condition", { expr: "steps.Fetch.body.total > 1000" }),
        node("Escalate", "set_params", { assign: { route: '"escalate"' } }),
        node("File", "set_params", { assign: { route: '"file"' } }),
      ],
      [
        edge("start", "Fetch"),
        edge("Fetch", "Big?"),
        edge("Big?", "Escalate", "success"),
        edge("Big?", "File", "failure"),
        edge("Escalate", "end"),
        edge("File", "end"),
      ],
    );
    const result = await run(workflow, {
      httpFetch: vi.fn(async () => jsonResponse({ total: 2480 })) as unknown as typeof fetch,
    });
    expect(result.status).toBe("succeeded");
    expect(result.events.some((e) => e.message.includes('Condition "Big?" -> success'))).toBe(true);
    expect(result.events.some((e) => e.message.includes('Set "Escalate": route'))).toBe(true);
  });

  it("takes the failure edge when the rule is false", async () => {
    const workflow = wf(
      [
        node("Fetch", "api_call", { prompt: '{"url":"https://x"}' }),
        node("Big?", "condition", { expr: "steps.Fetch.body.total > 1000" }),
        node("Small", "set_params", { assign: { route: '"small"' } }),
      ],
      [edge("start", "Fetch"), edge("Fetch", "Big?"), edge("Big?", "Small", "failure"), edge("Small", "end")],
    );
    const result = await run(workflow, {
      httpFetch: vi.fn(async () => jsonResponse({ total: 12 })) as unknown as typeof fetch,
    });
    expect(result.events.some((e) => e.message.includes('Condition "Big?" -> failure'))).toBe(true);
    expect(result.status).toBe("succeeded");
  });

  it("treats a broken rule as false and says so", async () => {
    const workflow = wf([node("Bad", "condition", { expr: "steps. ==" })], [edge("start", "Bad")]);
    const result = await run(workflow);
    expect(result.events.some((e) => e.level === "warn" && e.message.includes("treated as false"))).toBe(true);
    expect(result.status).toBe("failed");
  });
});

describe("switch", () => {
  const workflow = wf(
    [
      node("Route", "switch", {
        cases: [
          { label: "large", expr: "number(params.amount) > 1000" },
          { label: "medium", expr: "number(params.amount) > 100" },
          { label: "small", expr: "true" },
        ],
      }),
      node("Large", "set_params", { assign: { path: '"large"' } }),
      node("Medium", "set_params", { assign: { path: '"medium"' } }),
      node("Small", "set_params", { assign: { path: '"small"' } }),
    ],
    [
      edge("start", "Route"),
      edge("Route", "Large", "case:large"),
      edge("Route", "Medium", "case:medium"),
      edge("Route", "Small", "case:small"),
      edge("Large", "end"),
      edge("Medium", "end"),
      edge("Small", "end"),
    ],
  );

  const withAmount = (amount: string) =>
    runWorkflow(
      {
        workflow,
        secrets: [],
        params: [{ id: "p", name: "amount", scope: "run", value: amount }],
        runId: "r1",
      },
      deps(),
    );

  it("takes the first matching case", async () => {
    const result = await withAmount("2480");
    expect(result.events.some((e) => e.message.includes('Switch "Route" -> "large"'))).toBe(true);
    expect(result.events.some((e) => e.message.includes('Set "Large"'))).toBe(true);
  });

  it("falls through to a later case", async () => {
    const result = await withAmount("250");
    expect(result.events.some((e) => e.message.includes('-> "medium"'))).toBe(true);
  });

  it("reports when nothing matched", async () => {
    const bare = wf(
      [node("Route", "switch", { cases: [{ label: "never", expr: "false" }] })],
      [edge("start", "Route"), edge("Route", "end", "case:never")],
    );
    const result = await run(bare);
    expect(result.events.some((e) => e.message.includes("no case matched"))).toBe(true);
    expect(result.status).toBe("failed");
  });
});

describe("wait", () => {
  it("sleeps for a fixed delay", async () => {
    const sleep = vi.fn(async () => {});
    const workflow = wf([node("Pause", "wait", { waitMs: 5000 })], [edge("start", "Pause"), edge("Pause", "end")]);
    const result = await run(workflow, { sleep });
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(result.status).toBe("succeeded");
  });

  it("polls a probe request until its response satisfies the rule", async () => {
    let calls = 0;
    const httpFetch = vi.fn(async () =>
      jsonResponse({ state: ++calls < 3 ? "running" : "done" }),
    );
    const sleep = vi.fn(async () => {});
    const workflow = wf(
      [
        node("Export ready?", "wait", {
          prompt: '{"url":"https://x/export/status"}',
          untilExpr: 'steps["Export ready?"].body.state == "done"',
          waitMs: 1000,
          timeoutMs: 60_000,
        }),
      ],
      [edge("start", "Export ready?"), edge("Export ready?", "end")],
    );
    const result = await run(workflow, { httpFetch: httpFetch as unknown as typeof fetch, sleep });
    expect(result.status).toBe("succeeded");
    expect(httpFetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("refuses to spin when the rule can never change", async () => {
    const sleep = vi.fn(async () => {});
    const workflow = wf(
      [node("Never", "wait", { untilExpr: "params.nope == 1", timeoutMs: 60_000 })],
      [edge("start", "Never"), edge("Never", "end")],
    );
    const result = await run(workflow, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    expect(result.events.some((e) => e.message.includes("nothing to poll"))).toBe(true);
    expect(result.status).toBe("failed");
  });

  it("gives up at the timeout instead of polling forever", async () => {
    const workflow = wf(
      [
        node("Never", "wait", {
          prompt: '{"url":"https://x/status"}',
          untilExpr: "false",
          waitMs: 1000,
          timeoutMs: 3000,
        }),
      ],
      [edge("start", "Never"), edge("Never", "end")],
    );
    const result = await run(workflow, {
      httpFetch: vi.fn(async () => jsonResponse({ state: "running" })) as unknown as typeof fetch,
    });
    expect(result.events.some((e) => e.message.includes("timed out"))).toBe(true);
    expect(result.status).toBe("failed");
  });
});

describe("set_params", () => {
  it("computes a param later steps can use", async () => {
    const workflow = wf(
      [
        node("Fetch", "api_call", { prompt: '{"url":"https://x"}' }),
        node("Derive", "set_params", {
          assign: { label: 'steps.Fetch.body.total > 1000 ? "large" : "small"', doubled: "steps.Fetch.body.total * 2" },
        }),
        node("Report", "shell_task", { prompt: "echo {{param.label}} {{param.doubled}}" }),
      ],
      [edge("start", "Fetch"), edge("Fetch", "Derive"), edge("Derive", "Report"), edge("Report", "end")],
    );
    const shellExec = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await run(workflow, {
      httpFetch: vi.fn(async () => jsonResponse({ total: 2000 })) as unknown as typeof fetch,
      shellExec,
    });
    expect(shellExec).toHaveBeenCalledWith("echo large 4000", expect.anything());
  });
});

describe("custom node types", () => {
  const slack: CustomNodeType = {
    id: "slack",
    name: "Post to Slack",
    description: "",
    base: "http",
    fields: [
      { name: "webhook", label: "Webhook", type: "secret", required: true },
      { name: "text", label: "Message", type: "textarea", required: true },
    ],
    template:
      '{"url": "{{field.webhook}}", "method": "POST", "headers": {"content-type":"application/json"}, "body": {"text": "{{field.text}}"}}',
    createdAt: "t",
    updatedAt: "t",
  };

  it("runs a user-defined HTTP node with its fields templated in", async () => {
    // First call is the Fetch node, second is the custom Slack node.
    let call = 0;
    const httpFetch = vi.fn(async () => (call++ === 0 ? jsonResponse({ total: 2480 }) : jsonResponse({ ok: true })));
    const workflow = wf(
      [
        node("Fetch", "api_call", { prompt: '{"url":"https://x"}' }),
        node("Notify", "custom", {
          customTypeId: "slack",
          fields: { webhook: "https://hooks.example/abc", text: "Total {{= steps.Fetch.body.total }}" },
        }),
      ],
      [edge("start", "Fetch"), edge("Fetch", "Notify"), edge("Notify", "end")],
    );
    const result = await run(workflow, {
      httpFetch: httpFetch as unknown as typeof fetch,
      customNodeTypes: { slack },
    });
    expect(result.status).toBe("succeeded");
    const [url, init] = httpFetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example/abc");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Total 2480" });
  });

  it("fails its own node when a required field is blank", async () => {
    const workflow = wf(
      [node("Notify", "custom", { customTypeId: "slack", fields: { webhook: "" } })],
      [edge("start", "Notify")],
    );
    const result = await run(workflow, {
      httpFetch: vi.fn(async () => jsonResponse({})) as unknown as typeof fetch,
      customNodeTypes: { slack },
    });
    expect(result.status).toBe("failed");
    expect(result.events.some((e) => e.message.includes("missing Webhook, Message"))).toBe(true);
  });

  it("says so when the type is not installed", async () => {
    const workflow = wf([node("Notify", "custom", { customTypeId: "gone" })], [edge("start", "Notify")]);
    const result = await run(workflow, { customNodeTypes: {} });
    expect(result.events.some((e) => e.message.includes('unknown node type "gone"'))).toBe(true);
  });

  it("supports an expression-only node type", async () => {
    const overBudget: CustomNodeType = {
      id: "over_budget",
      name: "Over budget?",
      description: "",
      base: "expression",
      fields: [{ name: "limit", label: "Limit", type: "number", default: "1000" }],
      template: "steps.Fetch.body.total > number(field.limit)",
      createdAt: "t",
      updatedAt: "t",
    };
    const workflow = wf(
      [
        node("Fetch", "api_call", { prompt: '{"url":"https://x"}' }),
        node("Over?", "custom", { customTypeId: "over_budget", fields: { limit: "1000" } }),
        node("Escalate", "set_params", { assign: { route: '"escalate"' } }),
      ],
      [edge("start", "Fetch"), edge("Fetch", "Over?"), edge("Over?", "Escalate", "success"), edge("Escalate", "end")],
    );
    const result = await run(workflow, {
      httpFetch: vi.fn(async () => jsonResponse({ total: 2480 })) as unknown as typeof fetch,
      customNodeTypes: { over_budget: overBudget },
    });
    expect(result.status).toBe("succeeded");
    expect(result.events.some((e) => e.message.includes('Set "Escalate"'))).toBe(true);
  });

  it("honours a definition's own success rule", async () => {
    const strict: CustomNodeType = {
      id: "strict",
      name: "Strict call",
      description: "",
      base: "http",
      fields: [],
      template: '{"url": "https://x", "method": "GET"}',
      // 200 is not enough: the body has to say ok.
      successExpr: 'steps["Call"].body.state == "done"',
      createdAt: "t",
      updatedAt: "t",
    };
    const workflow = wf(
      [node("Call", "custom", { customTypeId: "strict" })],
      [edge("start", "Call"), edge("Call", "end")],
    );
    const result = await run(workflow, {
      httpFetch: vi.fn(async () => jsonResponse({ state: "pending" })) as unknown as typeof fetch,
      customNodeTypes: { strict },
    });
    expect(result.status).toBe("failed");
  });
});
