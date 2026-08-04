import type { AgentProvider } from "./types";

export type AgentCommandRequest = {
  provider: AgentProvider;
  prompt: string;
  secrets: Record<string, string>;
  allowApiFallback: boolean;
  cwd?: string;
};

export type AgentCommand = {
  executable: string;
  args: string[];
  env: Record<string, string>;
  stdin?: string;
  cwd?: string;
};

export function buildAgentCommand(request: AgentCommandRequest): AgentCommand {
  const env = toSecretEnv(request.secrets);
  const stdin = buildPrompt(request.prompt, Object.keys(env));

  if (request.provider === "claude-code") {
    return {
      executable: "claude",
      args: ["--print", "--output-format", "stream-json"],
      env,
      stdin,
      cwd: request.cwd,
    };
  }

  if (request.provider === "codex") {
    return {
      executable: "codex",
      args: ["exec", "--json", "--skip-git-repo-check", "-"],
      env,
      stdin,
      cwd: request.cwd,
    };
  }

  if (request.provider === "api" && !request.allowApiFallback) {
    throw new Error("Direct API provider is disabled unless API fallback is explicitly allowed.");
  }

  if (request.provider === "api") {
    return {
      executable: "node",
      args: ["scripts/run-direct-api-agent.mjs"],
      env,
      stdin,
      cwd: request.cwd,
    };
  }

  return {
    executable: "ollama",
    args: ["run", "gpt-oss"],
    env,
    stdin,
    cwd: request.cwd,
  };
}

function toSecretEnv(secrets: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(secrets).map(([name, value]) => [
      name
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase(),
      value,
    ]),
  );
}

function buildPrompt(prompt: string, secretEnvNames: string[]): string {
  const secretHint =
    secretEnvNames.length > 0
      ? `\n\nSecrets are available only as process environment variables: ${secretEnvNames.join(", ")}. Do not print them.`
      : "";

  return `${prompt}${secretHint}`;
}
