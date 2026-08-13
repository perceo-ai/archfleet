import { describe, expect, it } from "vitest";
import { FLEET_TOOLS } from "./tools";
import { openDb } from "../lib/fleet/db/db";
import { ensureSeeded } from "../lib/fleet/db/init-db";

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
