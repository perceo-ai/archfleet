import { spawn } from "node:child_process";
import type { ExecResult, ExecRunner, GuestConnection } from "./computer-use";
import type { AgentExec } from "./cli-agent-runner";

/** Copy one file from the guest to a local path via scp. */
export function scpFetch(
  conn: GuestConnection,
  remotePath: string,
  localPath: string,
): Promise<{ code: number; stderr: string }> {
  const args = [
    "-P",
    String(conn.port),
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes",
    ...(conn.identityFile ? ["-i", conn.identityFile, "-o", "IdentitiesOnly=yes"] : []),
    `${conn.username}@${conn.host}:${remotePath}`,
    localPath,
  ];
  return new Promise((resolve) => {
    const child = spawn("scp", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ code: 127, stderr: String(e) }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/** Real AgentExec: spawns a CLI agent command with its env + stdin. */
export const spawnAgentExec: AgentExec = (cmd) =>
  new Promise((resolve) => {
    const child = spawn(cmd.executable, cmd.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: cmd.cwd,
      env: { ...process.env, ...cmd.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ code: 127, stdout, stderr: String(e) }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (cmd.stdin) child.stdin.write(cmd.stdin);
    child.stdin.end();
  });

/** Real ExecRunner: spawns a process (e.g. ssh) and pipes stdin. I/O layer, not
 * unit tested — the orchestrator is tested with fake runners instead. */
export const spawnExecRunner: ExecRunner = (executable, args, stdin) =>
  new Promise<ExecResult>((resolve) => {
    const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => resolve({ code: 127, stdout, stderr: String(e) }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
