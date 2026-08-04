import { describe, expect, it } from "vitest";
import { buildAgentCommand } from "./agent-adapters";

describe("buildAgentCommand", () => {
  it("uses Claude Code print mode with stream JSON", () => {
    const command = buildAgentCommand({
      provider: "claude-code",
      prompt: "check the portal",
      secrets: { portal_password: "swordfish" },
      allowApiFallback: false,
    });

    expect(command.executable).toBe("claude");
    expect(command.args).toEqual(["--print", "--output-format", "stream-json"]);
    expect(command.stdin).toContain("check the portal");
    expect(command.args.join(" ")).not.toContain("swordfish");
    expect(command.env.PORTAL_PASSWORD).toBe("swordfish");
  });

  it("uses Codex exec JSON mode with repo check skipped for controlled workflow sandboxes", () => {
    const command = buildAgentCommand({
      provider: "codex",
      prompt: "summarize logs",
      secrets: {},
      allowApiFallback: false,
    });

    expect(command.executable).toBe("codex");
    expect(command.args).toEqual(["exec", "--json", "--skip-git-repo-check", "-"]);
    expect(command.stdin).toContain("summarize logs");
  });

  it("blocks direct API fallback unless explicitly allowed", () => {
    expect(() =>
      buildAgentCommand({
        provider: "api",
        prompt: "do the expensive thing",
        secrets: {},
        allowApiFallback: false,
      }),
    ).toThrow("Direct API provider is disabled");

    expect(
      buildAgentCommand({
        provider: "api",
        prompt: "do the expensive thing",
        secrets: {},
        allowApiFallback: true,
      }).executable,
    ).toBe("node");
  });
});
