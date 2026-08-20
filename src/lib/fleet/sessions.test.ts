import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_ACTIONS,
  DEFAULT_SESSION_TTL_MS,
  MAX_SESSION_TTL_MS,
  clampTtlMs,
  compileTaskWorkflow,
  serializeActions,
  statusFromRun,
  validateActions,
} from "./sessions";
import { validateWorkflow } from "./workflow-validation";

describe("clampTtlMs", () => {
  it("defaults when unset or nonsense", () => {
    expect(clampTtlMs(undefined)).toBe(DEFAULT_SESSION_TTL_MS);
    expect(clampTtlMs(0)).toBe(DEFAULT_SESSION_TTL_MS);
    expect(clampTtlMs(-5)).toBe(DEFAULT_SESSION_TTL_MS);
    expect(clampTtlMs(Number.NaN)).toBe(DEFAULT_SESSION_TTL_MS);
  });

  it("caps what an agent can ask for", () => {
    // Otherwise one agent could hold a desktop out of the fleet indefinitely.
    expect(clampTtlMs(MAX_SESSION_TTL_MS * 10)).toBe(MAX_SESSION_TTL_MS);
    expect(clampTtlMs(60_000)).toBe(60_000);
  });
});

describe("validateActions", () => {
  it("accepts the guest's vocabulary", () => {
    expect(
      validateActions([{ click: [10, 20] }, { type: "hello" }, { key: "enter" }, { screenshot: true }]),
    ).toEqual([]);
  });

  it("names an unknown action and what was expected", () => {
    const errors = validateActions([{ click: [1, 2] }, { teleport: true }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("action 1");
    expect(errors[0]).toContain("teleport");
  });

  it("rejects a batch that is not a list of objects", () => {
    expect(validateActions("click")).toEqual(["actions must be an array"]);
    expect(validateActions([])).toEqual(["actions must not be empty"]);
    expect(validateActions([["click", 1, 2]])[0]).toContain("must be an object");
    expect(validateActions([null])[0]).toContain("must be an object");
  });

  it("reports every bad action, so one round trip fixes the batch", () => {
    expect(validateActions([{ nope: 1 }, { click: [1, 2] }, { alsoNope: 2 }])).toHaveLength(2);
  });

  it("covers exactly what desktop_runner.py accepts", () => {
    // Read the guest's own VALID set rather than restating it here. These must
    // stay in lockstep: a primitive we accept but the guest rejects would fail
    // mid-batch, after earlier actions had already landed.
    const source = readFileSync(
      join(__dirname, "../../../virt/agent-runner/desktop_runner.py"),
      "utf8",
    );
    const valid = /^VALID\s*=\s*\{([^}]*)\}/m.exec(source);
    if (!valid) throw new Error("could not find VALID in desktop_runner.py");
    const guestActions = [...valid[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect([...DESKTOP_ACTIONS].sort()).toEqual(guestActions.sort());
  });
});

describe("serializeActions", () => {
  it("produces the JSON array the guest parses", () => {
    const raw = serializeActions([{ click: [10, 20] }, { type: "hi" }]);
    expect(JSON.parse(raw)).toEqual([{ click: [10, 20] }, { type: "hi" }]);
  });
});

describe("compileTaskWorkflow", () => {
  const compiled = () =>
    compileTaskWorkflow({
      sessionId: "sess_1",
      task: "Book a room at the Ace for Tuesday",
      environmentName: "Travel — logged in",
      requiredLabels: ["profile:travel"],
    });

  it("is a workflow the engine will actually accept", () => {
    expect(validateWorkflow(compiled())).toEqual([]);
  });

  it("carries the task and the environment's desktop constraint", () => {
    const task = compiled().nodes.find((n) => n.type === "computer_use_task");
    expect(task?.config.prompt).toBe("Book a room at the Ace for Tuesday");
    expect(task?.config.requiredLabels).toEqual(["profile:travel"]);
  });

  it("stays disabled so it never becomes a thing the user maintains", () => {
    expect(compiled().enabled).toBe(false);
  });

  it("keeps the name readable for a long request", () => {
    const wf = compileTaskWorkflow({
      sessionId: "sess_2",
      task: "  Apply to every  backend role posted\n this week and tailor the cover letter each time  ",
      requiredLabels: [],
    });
    expect(wf.name.length).toBeLessThanOrEqual(75);
    expect(wf.name).not.toContain("\n");
  });
});

describe("statusFromRun", () => {
  it("maps the run vocabulary onto the session's", () => {
    expect(statusFromRun("queued")).toBe("starting");
    expect(statusFromRun("running")).toBe("active");
    // The agent needs to know a human is the blocker, not that it is just slow.
    expect(statusFromRun("paused")).toBe("waiting_for_human");
    expect(statusFromRun("succeeded")).toBe("closed");
    expect(statusFromRun("canceled")).toBe("closed");
    expect(statusFromRun("failed")).toBe("failed");
  });
});
