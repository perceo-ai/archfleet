// Runs a CLI agent node (Claude Code / Codex / local / api) by executing the
// command built by buildAgentCommand and parsing its machine-readable output into
// an AgentRunResult. Process execution is injected so this is unit tested with a
// fake exec; secrets are redacted from captured stdout/stderr before returning.

import { buildAgentCommand, type AgentCommand, type AgentCommandRequest } from "./agent-adapters";
import { redactSecrets } from "./redaction";
import type { Secret } from "./types";

export type AgentRunResult = {
  status: "succeeded" | "failed" | "timed_out" | "canceled";
  stdout: string;
  stderr: string;
  structuredOutput?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  artifacts: string[];
};

export type AgentExecResult = { code: number; stdout: string; stderr: string };
export type AgentExec = (cmd: AgentCommand) => Promise<AgentExecResult>;

/** Parse a Claude Code / Codex stream-json or json stdout for the final result +
 * usage. Tolerant: scans for the last JSON line carrying a result/usage. */
export function parseAgentOutput(stdout: string): {
  structuredOutput?: unknown;
  usage?: AgentRunResult["usage"];
} {
  let structuredOutput: unknown;
  let usage: AgentRunResult["usage"];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      // Claude Code final event: {type:"result", result:..., usage:{...}}
      if (obj.type === "result" || "result" in obj) {
        structuredOutput = obj.result ?? obj.structuredOutput ?? structuredOutput;
      }
      if (obj.usage && typeof obj.usage === "object") {
        const u = obj.usage as Record<string, number>;
        usage = {
          inputTokens: u.input_tokens ?? u.inputTokens,
          outputTokens: u.output_tokens ?? u.outputTokens,
          costUsd: (obj.total_cost_usd as number) ?? (obj.cost_usd as number) ?? usage?.costUsd,
        };
      }
    } catch {
      // partial/non-json line — ignore
    }
  }
  return { structuredOutput, usage };
}

export async function runCliAgent(
  request: AgentCommandRequest,
  exec: AgentExec,
  secrets: Secret[] = [],
): Promise<AgentRunResult> {
  const cmd = buildAgentCommand(request);
  const res = await exec(cmd);
  const { structuredOutput, usage } = parseAgentOutput(res.stdout);
  return {
    status: res.code === 0 ? "succeeded" : "failed",
    stdout: redactSecrets(res.stdout, secrets),
    stderr: redactSecrets(res.stderr, secrets),
    structuredOutput,
    usage,
    artifacts: [],
  };
}
