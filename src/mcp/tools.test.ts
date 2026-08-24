import { describe, expect, it } from "vitest";
import { FLEET_TOOLS } from "./tools";
import { openDb } from "../lib/fleet/db/db";
import { getRun, saveRun } from "../lib/fleet/db/runs-repo";
import { ensureSeeded } from "../lib/fleet/db/init-db";
import { saveEnvironment } from "../lib/fleet/db/environments-repo";

function tool(name: string) {
  const t = FLEET_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

describe("fleet MCP tools", () => {
  it("every tool has a unique name + description + shape", () => {
    const names = FLEET_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of FLEET_TOOLS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.shape).toBe("object");
    }
  });

  it("list_workflows returns seeded workflows", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const out = (await tool("list_workflows").run(db, {})) as unknown[];
    expect(out.length).toBeGreaterThan(0);
    db.close();
  });

  it("run_workflow enqueues + get_run reads it back", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const run = (await tool("run_workflow").run(db, {})) as { id: string; status: string };
    expect(run.status).toBe("queued");
    const got = (await tool("get_run").run(db, { id: run.id })) as { status: string };
    expect(got.status).toBe("queued");
    db.close();
  });

  it("create_trigger (webhook) returns a one-time token", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const res = (await tool("create_trigger").run(db, {
      workflowId: "wf_portal_login",
      type: "webhook",
    })) as { webhookToken?: string };
    expect(typeof res.webhookToken).toBe("string");
    db.close();
  });

  it("create_secret encrypts; list_secrets hides values", async () => {
    const db = openDb(":memory:");
    const KEY = "test-key";
    process.env.CUF_SECRET_KEY = KEY;
    await tool("create_secret").run(db, { name: "tok", scope: "global", value: "sesame" });
    const meta = (await tool("list_secrets").run(db, {})) as unknown[];
    expect(JSON.stringify(meta)).not.toContain("sesame");
    delete process.env.CUF_SECRET_KEY;
    db.close();
  });

  it("list_vms works with no real VM configured", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const vms = (await tool("list_vms").run(db, {})) as unknown[];
    expect(Array.isArray(vms)).toBe(true);
    db.close();
  });
});

describe("automation-era MCP tools", () => {
  it("list_automations returns the seeded automation with health", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const out = (await tool("list_automations").run(db, {})) as { id: string; health: string }[];
    expect(out.map((a) => a.id)).toContain("auto_portal_login");
    expect(out[0].health).toBeDefined();
    db.close();
  });

  it("run_automation links the run; list_takeovers/resolve_takeover round-trip", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const run = (await tool("run_automation").run(db, { id: "auto_portal_login" })) as {
      id: string;
      automationId: string;
      status: string;
    };
    expect(run.status).toBe("queued");
    expect(run.automationId).toBe("auto_portal_login");

    const { openTakeover } = await import("../lib/fleet/db/takeovers-repo");
    openTakeover(db, {
      id: "tk_1",
      runId: run.id,
      reason: "MFA",
      requestedAction: "approve",
      status: "open",
      openedAt: "2026-08-12T00:00:00Z",
    });
    const open = (await tool("list_takeovers").run(db, { status: "open" })) as { id: string }[];
    expect(open.map((t) => t.id)).toContain("tk_1");
    const resolved = (await tool("resolve_takeover").run(db, {
      id: "tk_1",
      operatorNotes: "done",
      action: "cancel",
    })) as { ok: boolean; takeover: { status: string } };
    expect(resolved.ok).toBe(true);
    expect(resolved.takeover.status).toBe("resolved");
    const got = (await tool("get_run").run(db, { id: run.id })) as { status: string };
    expect(got.status).toBe("canceled");
    db.close();
  });

  it("upsert_automation + get_automation + list_environments + list_evidence", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const up = (await tool("upsert_automation").run(db, {
      automation: { id: "auto_x", name: "X", workflowId: "wf_portal_login", category: "general" },
    })) as { ok: boolean };
    expect(up.ok).toBe(true);
    const got = (await tool("get_automation").run(db, { id: "auto_x" })) as {
      automation: { name: string };
      health: string;
    };
    expect(got.automation.name).toBe("X");
    const envs = (await tool("list_environments").run(db, {})) as { id: string }[];
    expect(envs.map((e) => e.id)).toContain("env_default");

    const { addEvidence } = await import("../lib/fleet/db/evidence-repo");
    addEvidence(db, {
      id: "ev_1",
      runId: "r1",
      automationId: "auto_x",
      type: "screenshot",
      description: "shot",
      createdAt: "2026-08-12T00:00:00Z",
    });
    const evidence = (await tool("list_evidence").run(db, { automationId: "auto_x" })) as unknown[];
    expect(evidence).toHaveLength(1);
    db.close();
  });
});

describe("greptile fixes", () => {
  it("resolve_takeover keeps the takeover open when the run transition is rejected", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const { saveRun } = await import("../lib/fleet/db/runs-repo");
    saveRun(db, {
      id: "r_done",
      workflowId: "wf_portal_login",
      workflowName: "Portal",
      status: "succeeded", // already finished — cannot be resumed or canceled
      startedAt: "2026-08-12T00:00:00Z",
      events: [],
      artifacts: [],
    });
    const { openTakeover, getTakeover } = await import("../lib/fleet/db/takeovers-repo");
    openTakeover(db, {
      id: "tk_race",
      runId: "r_done",
      reason: "MFA",
      requestedAction: "approve",
      status: "open",
      openedAt: "2026-08-12T00:01:00Z",
    });
    const res = (await tool("resolve_takeover").run(db, { id: "tk_race", action: "resume" })) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not in a state to resume/);
    expect(getTakeover(db, "tk_race")?.status).toBe("open"); // NOT resolved
    db.close();
  });

  it("run_automation reports an error when the automation's workflow is missing", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    await tool("upsert_automation").run(db, {
      automation: { id: "auto_orphan", name: "Orphan", workflowId: "wf_portal_login" },
    });
    db.prepare("UPDATE cuf_automations SET workflow_id='wf_gone' WHERE id='auto_orphan'").run();
    const res = (await tool("run_automation").run(db, { id: "auto_orphan" })) as { error?: string };
    expect(res.error).toMatch(/wf_gone not found/);
    db.close();
  });
});

describe("upsert_automation workflow guard", () => {
  it("rejects an automation whose workflow does not exist", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const res = (await tool("upsert_automation").run(db, {
      automation: { id: "auto_bad", name: "Bad", workflowId: "wf_missing" },
    })) as { ok: boolean; errors?: string[] };
    expect(res.ok).toBe(false);
    expect(res.errors?.[0]).toMatch(/wf_missing not found/);
    expect(await tool("get_automation").run(db, { id: "auto_bad" })).toEqual({ error: "not found" });
    db.close();
  });
});

describe("actionless takeover resolution", () => {
  it("refuses to close a takeover while its run is still paused", async () => {
    const db = openDb(":memory:");
    ensureSeeded(db);
    const { saveRun } = await import("../lib/fleet/db/runs-repo");
    saveRun(db, {
      id: "r_paused",
      workflowId: "wf_portal_login",
      workflowName: "Portal",
      status: "paused",
      startedAt: "2026-08-12T00:00:00Z",
      events: [],
      artifacts: [],
    });
    const { openTakeover, getTakeover } = await import("../lib/fleet/db/takeovers-repo");
    openTakeover(db, {
      id: "tk_open",
      runId: "r_paused",
      reason: "MFA",
      requestedAction: "approve",
      status: "open",
      openedAt: "2026-08-12T00:01:00Z",
    });
    const noAction = (await tool("resolve_takeover").run(db, { id: "tk_open" })) as {
      ok: boolean;
      error?: string;
    };
    expect(noAction.ok).toBe(false);
    expect(noAction.error).toMatch(/still paused/);
    expect(getTakeover(db, "tk_open")?.status).toBe("open");

    const resumed = (await tool("resolve_takeover").run(db, { id: "tk_open", action: "resume" })) as {
      ok: boolean;
    };
    expect(resumed.ok).toBe(true);
    expect(getTakeover(db, "tk_open")?.status).toBe("resolved");
    db.close();
  });
});

describe("ask_human", () => {
  function runningRun(db: ReturnType<typeof openDb>, id: string, status = "running") {
    ensureSeeded(db);
    saveRun(db, {
      id,
      workflowId: "wf_seed",
      workflowName: "seeded",
      status: status as "running",
      startedAt: "2026-08-12T00:00:00Z",
      currentStep: "File the invoice",
      events: [],
    });
  }

  it("pauses the run and records a structured question", async () => {
    const db = openDb(":memory:");
    runningRun(db, "run_ask");

    const res = (await tool("ask_human").run(db, {
      runId: "run_ask",
      question: "Which PO should this be filed under?",
      fields: [{ name: "po", label: "PO number", type: "text" }],
    })) as { ok: boolean; takeover: { ask: { kind: string; fields: { name: string }[] } } };

    expect(res.ok).toBe(true);
    expect(res.takeover.ask.kind).toBe("input");
    expect(res.takeover.ask.fields[0].name).toBe("po");
    expect(getRun(db, "run_ask")?.status).toBe("paused");
    db.close();
  });

  it("refuses on a run that already finished", async () => {
    const db = openDb(":memory:");
    runningRun(db, "run_done", "succeeded");
    const res = (await tool("ask_human").run(db, { runId: "run_done", question: "?" })) as {
      ok: boolean;
    };
    expect(res.ok).toBe(false);
    db.close();
  });

  it("hands the answer back to the run as a param", async () => {
    const db = openDb(":memory:");
    runningRun(db, "run_ans");
    const asked = (await tool("ask_human").run(db, {
      runId: "run_ans",
      question: "Which PO?",
      fields: [{ name: "po", label: "PO", type: "text" }],
    })) as { takeover: { id: string } };

    const res = (await tool("resolve_takeover").run(db, {
      id: asked.takeover.id,
      action: "resume",
      answers: { po: "PO-4821" },
    })) as { ok: boolean };

    expect(res.ok).toBe(true);
    const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get("run_ans") as {
      params_json: string;
    };
    expect(JSON.parse(row.params_json).po).toBe("PO-4821");
    db.close();
  });

  it("rejects an answer that does not satisfy the ask", async () => {
    const db = openDb(":memory:");
    runningRun(db, "run_bad");
    const asked = (await tool("ask_human").run(db, {
      runId: "run_bad",
      question: "Which PO?",
      fields: [{ name: "po", label: "PO", type: "text" }],
    })) as { takeover: { id: string } };

    const res = (await tool("resolve_takeover").run(db, {
      id: asked.takeover.id,
      action: "resume",
      answers: {},
    })) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/required/i);
    db.close();
  });
});

describe("rules + custom node types", () => {
  it("checks an expression before it goes into a graph", async () => {
    const db = openDb(":memory:");
    const ok = (await tool("eval_expression").run(db, {
      expression: "steps.Fetch.body.total > 1000",
      context: { steps: { Fetch: { body: { total: 2480 } } } },
    })) as { ok: boolean; value: unknown };
    expect(ok).toEqual({ ok: true, value: true });

    const bad = (await tool("eval_expression").run(db, { expression: "steps. ==" })) as {
      ok: boolean;
      error: string;
    };
    expect(bad.ok).toBe(false);
    db.close();
  });

  it("round-trips a custom node type and rejects a broken one", async () => {
    const db = openDb(":memory:");
    const saved = (await tool("upsert_node_type").run(db, {
      id: "notify",
      name: "Notify",
      base: "http",
      template: '{"url":"{{field.hook}}","method":"POST"}',
      fields: [{ name: "hook", label: "Hook", type: "secret", required: true }],
    })) as { ok: boolean };
    expect(saved.ok).toBe(true);
    expect(((await tool("list_node_types").run(db, {})) as unknown[]).length).toBe(1);

    const broken = (await tool("upsert_node_type").run(db, {
      id: "bad",
      name: "Bad",
      base: "http",
      template: "not json",
    })) as { ok: boolean; errors: string[] };
    expect(broken.ok).toBe(false);
    expect(broken.errors.join(" ")).toMatch(/must be JSON/);

    expect((await tool("delete_node_type").run(db, { id: "notify" })) as { ok: boolean }).toEqual({
      ok: true,
    });
    db.close();
  });
});

// The session tools are how an outside agent (OpenClaw, Hermes) does general
// computer use on a signed-in desktop, so their contract matters as much as the
// automation tools'.
describe("session MCP tools", () => {
  function seeded() {
    const db = openDb(":memory:");
    ensureSeeded(db);
    saveEnvironment(db, {
      id: "env_portal",
      name: "Portal — logged in",
      description: "",
      labels: ["linux-desktop", "browser", "profile:portal"],
      profileRef: "portal",
      health: "ready",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
    });
    return db;
  }

  it("exposes the whole session surface", () => {
    const names = FLEET_TOOLS.map((t) => t.name);
    for (const expected of [
      "run_task",
      "open_session",
      "get_session",
      "list_sessions",
      "session_act",
      "close_session",
      "capture_session",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("run_task turns a plain-language request into a run on that environment", async () => {
    const db = seeded();
    const res = (await tool("run_task").run(db, {
      environmentId: "env_portal",
      task: "Book a room at the Ace for Tuesday",
    })) as { ok: boolean; session: { id: string; runId: string; mode: string } };

    expect(res.ok).toBe(true);
    expect(res.session.mode).toBe("task");
    expect(getRun(db, res.session.runId)?.environmentId).toBe("env_portal");

    const view = (await tool("get_session").run(db, { id: res.session.id })) as {
      status: string;
      run?: { status: string };
    };
    expect(view.run?.status).toBe("queued");
    db.close();
  });

  it("run_task on an unknown environment fails without creating anything", async () => {
    const db = seeded();
    const res = (await tool("run_task").run(db, { environmentId: "nope", task: "x" })) as {
      ok: boolean;
      error: string;
    };
    expect(res.ok).toBe(false);
    expect((await tool("list_sessions").run(db, {})) as unknown[]).toHaveLength(0);
    db.close();
  });

  it("session_act refuses a task session and says what to do instead", async () => {
    const db = seeded();
    const opened = (await tool("run_task").run(db, {
      environmentId: "env_portal",
      task: "x",
    })) as { session: { id: string } };
    const res = (await tool("session_act").run(db, {
      id: opened.session.id,
      actions: [{ click: [1, 2] }],
    })) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("lease");
    db.close();
  });

  it("capture_session only applies to a persist session", async () => {
    const db = seeded();
    const opened = (await tool("run_task").run(db, {
      environmentId: "env_portal",
      task: "x",
    })) as { session: { id: string } };
    const res = (await tool("capture_session").run(db, { id: opened.session.id })) as {
      ok: boolean;
      error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("persist");
    db.close();
  });

  it("close_session cancels the run behind a task session", async () => {
    const db = seeded();
    const opened = (await tool("run_task").run(db, {
      environmentId: "env_portal",
      task: "x",
    })) as { session: { id: string; runId: string } };
    const res = (await tool("close_session").run(db, { id: opened.session.id })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(getRun(db, opened.session.runId)?.status).toBe("canceled");
    db.close();
  });
});
