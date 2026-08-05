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
