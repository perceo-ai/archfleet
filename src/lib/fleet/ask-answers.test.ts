import { describe, expect, it } from "vitest";
import { openDb } from "./db/db";
import { saveRun } from "./db/runs-repo";
import { applyAskAnswers } from "./ask-answers";
import { parseAsk } from "./human-ask";

function dbWithRun() {
  const db = openDb(":memory:");
  saveRun(db, {
    id: "r1",
    workflowId: "wf",
    workflowName: "wf",
    status: "paused",
    startedAt: "2026-08-12T00:00:00Z",
    events: [],
  });
  return db;
}

const ask = parseAsk({
  question: "Details?",
  fields: [
    { name: "po", label: "PO", type: "text" },
    { name: "pin", label: "PIN", type: "code", secret: true },
  ],
});

describe("applyAskAnswers", () => {
  it("writes plain answers into the run's params", () => {
    const db = dbWithRun();
    const report = applyAskAnswers(db, "r1", ask, { po: "PO-1", pin: "1234" });
    const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get("r1") as {
      params_json: string;
    };
    expect(JSON.parse(row.params_json).po).toBe("PO-1");
    // the secret never lands in params
    expect(JSON.parse(row.params_json).pin).toBeUndefined();
    expect(report.params).toEqual(["po"]);
    db.close();
  });

  it("reports a secret it could not encrypt instead of dropping it silently", () => {
    const previous = process.env.CUF_SECRET_KEY;
    delete process.env.CUF_SECRET_KEY;
    const db = dbWithRun();
    const report = applyAskAnswers(db, "r1", ask, { po: "PO-1", pin: "1234" });
    expect(report.dropped).toEqual(["pin"]);
    expect(report.secrets).toEqual([]);
    db.close();
    if (previous !== undefined) process.env.CUF_SECRET_KEY = previous;
  });

  it("stores a secret answer encrypted when a key is configured", () => {
    const previous = process.env.CUF_SECRET_KEY;
    process.env.CUF_SECRET_KEY = "test-key-for-ask-answers";
    const db = dbWithRun();
    const report = applyAskAnswers(db, "r1", ask, { po: "PO-1", pin: "1234" });
    expect(report.secrets).toEqual(["pin"]);
    expect(report.dropped).toEqual([]);
    const row = db.prepare("SELECT encrypted_value FROM cuf_secrets WHERE name='pin'").get() as {
      encrypted_value: string;
    };
    expect(row.encrypted_value).not.toContain("1234");
    db.close();
    if (previous === undefined) delete process.env.CUF_SECRET_KEY;
    else process.env.CUF_SECRET_KEY = previous;
  });

  it("keeps existing run params when adding new ones", () => {
    const db = dbWithRun();
    db.prepare("UPDATE cuf_runs SET params_json=? WHERE id=?").run('{"existing":"kept"}', "r1");
    applyAskAnswers(db, "r1", ask, { po: "PO-2" });
    const row = db.prepare("SELECT params_json FROM cuf_runs WHERE id=?").get("r1") as {
      params_json: string;
    };
    expect(JSON.parse(row.params_json)).toEqual({ existing: "kept", po: "PO-2" });
    db.close();
  });
});
