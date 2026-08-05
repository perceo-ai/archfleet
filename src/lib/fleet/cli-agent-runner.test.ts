import { describe, expect, it } from "vitest";
import { parseAgentOutput, runCliAgent, type AgentExec } from "./cli-agent-runner";
import type { Secret } from "./types";

const secrets: Secret[] = [{ id: "s1", name: "token", scope: "workflow", value: "sk-secret" }];

describe("parseAgentOutput", () => {
  it("extracts result + usage from a claude stream-json tail", () => {
    const stdout = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":"working"}',
      '{"type":"result","result":"done ok","usage":{"input_tokens":10,"output_tokens":5},"total_cost_usd":0.002}',
    ].join("\n");
    const { structuredOutput, usage } = parseAgentOutput(stdout);
    expect(structuredOutput).toBe("done ok");
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5, costUsd: 0.002 });
  });

  it("ignores non-json chatter", () => {
    expect(parseAgentOutput("loading...\nno json here").structuredOutput).toBeUndefined();
  });
});

describe("runCliAgent", () => {
  const okExec =
    (res: { code: number; stdout: string; stderr: string }): AgentExec =>
    async () =>
      res;

  it("returns succeeded + structured output on exit 0", async () => {
    const result = await runCliAgent(
      { provider: "claude-code", prompt: "hi", secrets: {}, allowApiFallback: false },
      okExec({ code: 0, stdout: '{"type":"result","result":"ok"}', stderr: "" }),
    );
    expect(result.status).toBe("succeeded");
    expect(result.structuredOutput).toBe("ok");
  });

  it("returns failed on non-zero exit", async () => {
    const result = await runCliAgent(
      { provider: "codex", prompt: "hi", secrets: {}, allowApiFallback: false },
      okExec({ code: 1, stdout: "", stderr: "boom" }),
    );
    expect(result.status).toBe("failed");
  });

  it("redacts secrets from captured output", async () => {
    const result = await runCliAgent(
      { provider: "claude-code", prompt: "hi", secrets: {}, allowApiFallback: false },
      okExec({ code: 0, stdout: "leaked sk-secret here", stderr: "also sk-secret" }),
      secrets,
    );
    expect(result.stdout).not.toContain("sk-secret");
    expect(result.stdout).toContain("[REDACTED:token]");
    expect(result.stderr).not.toContain("sk-secret");
  });

  it("throws for disabled api provider via buildAgentCommand", async () => {
    await expect(
      runCliAgent(
        { provider: "api", prompt: "x", secrets: {}, allowApiFallback: false },
        okExec({ code: 0, stdout: "", stderr: "" }),
      ),
    ).rejects.toThrow(/API fallback/);
  });
});
