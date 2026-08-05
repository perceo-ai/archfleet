import { describe, expect, it } from "vitest";
import {
  buildGuestRunCommand,
  parseGuestReport,
  runComputerUseTask,
  serializeTask,
  type ExecResult,
  type ExecRunner,
  type GuestConnection,
} from "./computer-use";

const conn: GuestConnection = { host: "127.0.0.1", port: 10022, username: "agent" };

describe("serializeTask", () => {
  it("maps camelCase task fields to the guest snake_case contract", () => {
    const json = JSON.parse(
      serializeTask({
        instruction: "log in",
        pastWork: "opened browser",
        params: { url: "x" },
        limits: { maxSteps: 10, timeoutS: 30, maxNoProgress: 2 },
      }),
    );
    expect(json).toEqual({
      instruction: "log in",
      past_work: "opened browser",
      params: { url: "x" },
      limits: { max_steps: 10, timeout_s: 30, max_no_progress: 2 },
    });
  });
});

describe("buildGuestRunCommand", () => {
  it("targets the forwarded ssh port and default guest runner path", () => {
    const cmd = buildGuestRunCommand(conn, { instruction: "do it" });
    expect(cmd.executable).toBe("ssh");
    expect(cmd.args).toContain("-p");
    expect(cmd.args).toContain("10022");
    expect(cmd.args).toContain("agent@127.0.0.1");
    const remote = cmd.args[cmd.args.length - 1];
    expect(remote).toContain("/opt/agent/venv/bin/python");
    expect(remote).toContain("/opt/agent/cli.py");
  });

  it("injects env as a per-process prefix, quoted, not into args", () => {
    const cmd = buildGuestRunCommand(conn, { instruction: "x" }, { OPENROUTER_API_KEY: "sk-abc" });
    const remote = cmd.args[cmd.args.length - 1];
    expect(remote).toContain("env OPENROUTER_API_KEY='sk-abc'");
  });
});

describe("parseGuestReport", () => {
  it("parses the report line and maps structured_output", () => {
    const report = parseGuestReport(
      '{"status":"succeeded","reason":"agent_reported_done","steps":3,"artifacts":["a.png"],"structured_output":{"ok":1}}',
    );
    expect(report.status).toBe("succeeded");
    expect(report.steps).toBe(3);
    expect(report.artifacts).toEqual(["a.png"]);
    expect(report.structuredOutput).toEqual({ ok: 1 });
  });

  it("ignores agent chatter and finds the last report line", () => {
    const stdout = [
      "loading model...",
      "grounding ready",
      '{"status":"needs_human","reason":"no_progress","steps":40,"artifacts":[]}',
    ].join("\n");
    expect(parseGuestReport(stdout).status).toBe("needs_human");
  });

  it("throws when no report json is present", () => {
    expect(() => parseGuestReport("just logs\nnothing here")).toThrow(/no valid report/);
  });
});

describe("runComputerUseTask", () => {
  const okExec =
    (result: ExecResult): ExecRunner =>
    async () =>
      result;

  it("runs the guest command and returns the parsed report", async () => {
    const report = await runComputerUseTask(
      conn,
      { instruction: "log in" },
      okExec({
        code: 0,
        stdout: '{"status":"succeeded","reason":"done","steps":2,"artifacts":[]}',
        stderr: "",
      }),
    );
    expect(report.status).toBe("succeeded");
  });

  it("passes task JSON to stdin", async () => {
    let seenStdin = "";
    const exec: ExecRunner = async (_e, _a, stdin) => {
      seenStdin = stdin;
      return { code: 0, stdout: '{"status":"succeeded","reason":"d","steps":1,"artifacts":[]}', stderr: "" };
    };
    await runComputerUseTask(conn, { instruction: "hello" }, exec);
    expect(JSON.parse(seenStdin).instruction).toBe("hello");
  });

  it("throws on transport failure with empty stdout", async () => {
    await expect(
      runComputerUseTask(
        conn,
        { instruction: "x" },
        okExec({ code: 255, stdout: "", stderr: "ssh: connect refused" }),
      ),
    ).rejects.toThrow(/transport failed/);
  });
});
