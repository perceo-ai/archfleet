// Controller-side transport for the `computer_use_task` node. Agent S runs INSIDE
// the guest VM (it needs the display), so the controller drives it over SSH: push
// a task-slice JSON to the guest runner's stdin, read the structured report from
// stdout. Command construction + report parsing are pure and unit tested; the real
// process spawn is injected via ExecRunner.

export type ExecResult = { code: number; stdout: string; stderr: string };
export type ExecRunner = (
  executable: string,
  args: string[],
  stdin: string,
) => Promise<ExecResult>;

export type GuestReportStatus = "succeeded" | "failed" | "needs_human" | "timed_out";

export type GuestReport = {
  status: GuestReportStatus;
  reason: string;
  steps: number;
  artifacts: string[];
  structuredOutput?: unknown;
};

export type ComputerUseTask = {
  instruction: string;
  pastWork?: string;
  params?: Record<string, string | number | boolean | null>;
  limits?: {
    maxSteps?: number;
    /** Far-away ceiling on the whole slice. */
    timeoutS?: number;
    maxNoProgress?: number;
    /** How long ONE step may take. This is the limit that actually governs a
     * long task — a step is a planner call plus a grounding call, and either can
     * legitimately take minutes. */
    stepTimeoutS?: number;
  };
};

export type GuestConnection = {
  host: string;
  port: number;
  username: string;
  /** SSH private key for auth (key-based; BatchMode). */
  identityFile?: string;
  /** Python interpreter in the guest venv. */
  pythonPath?: string;
  /** Path to the guest runner CLI. */
  runnerPath?: string;
};

const DEFAULT_PYTHON = "/opt/agent/venv/bin/python";
const DEFAULT_RUNNER = "/opt/agent/agent-runner/cli.py";

/** Task JSON in the shape the guest cli.py expects (snake_case). */
export function serializeTask(task: ComputerUseTask): string {
  const limits = task.limits
    ? {
        max_steps: task.limits.maxSteps,
        timeout_s: task.limits.timeoutS,
        step_timeout_s: task.limits.stepTimeoutS,
        max_no_progress: task.limits.maxNoProgress,
      }
    : undefined;
  return JSON.stringify({
    instruction: task.instruction,
    past_work: task.pastWork ?? "",
    params: task.params ?? {},
    ...(limits ? { limits } : {}),
  });
}

export type GuestCommand = { executable: string; args: string[]; stdin: string };

/**
 * Build the SSH command that runs the guest runner. Planner/grounding config is
 * passed as per-process env (prefixed `env K=V`) so it is scoped to this run and
 * not written to the guest's global environment.
 */
export function buildGuestRunCommand(
  conn: GuestConnection,
  task: ComputerUseTask,
  env: Record<string, string> = {},
): GuestCommand {
  const python = conn.pythonPath ?? DEFAULT_PYTHON;
  const runner = conn.runnerPath ?? DEFAULT_RUNNER;

  const envPrefix = Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`);
  const remote = ["env", ...envPrefix, python, runner].join(" ");

  const args = [
    "-p",
    String(conn.port),
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes",
    ...(conn.identityFile ? ["-i", conn.identityFile, "-o", "IdentitiesOnly=yes"] : []),
    `${conn.username}@${conn.host}`,
    "--",
    remote,
  ];

  return { executable: "ssh", args, stdin: serializeTask(task) };
}

/**
 * Build the SSH command that steps a guest's clock to the controller's time.
 *
 * The warm snapshot is a RAM snapshot, so reverting restores the clock as it was
 * when the snapshot was taken. A desktop that has sat unused for a few weeks
 * wakes up that far in the past, and every TLS handshake inside the guest then
 * fails with "certificate is not yet valid" — the planner and grounding calls
 * included. The agent runner retries until its budget is gone, so the operator
 * sees an unexplained step timeout rather than a clock problem.
 *
 * Seconds-since-epoch avoids any date parsing or timezone handling in the guest,
 * and `hwclock` persists the correction so a later resume does not undo it.
 */
export function buildClockSyncCommand(
  conn: GuestConnection,
  nowMs: number,
): { executable: string; args: string[] } {
  const epochSeconds = Math.floor(nowMs / 1000);
  // `sudo -n` never waits on a prompt: on a guest without the sudo rule this
  // fails immediately instead of hanging the acquire path.
  //
  // Only the system clock gates the result — that is what every TLS handshake
  // in the guest reads. Writing it back to the RTC keeps a later resume honest,
  // but `hwclock` is not present on every desktop image, so it is probed and
  // swallowed: a missing RTC tool must never be the reason a desktop is refused.
  const remote =
    `sudo -n date -u -s @${epochSeconds} && ` +
    `{ command -v hwclock >/dev/null 2>&1 && sudo -n hwclock --systohc >/dev/null 2>&1 || true; }`;

  const args = [
    "-p",
    String(conn.port),
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "BatchMode=yes",
    // Bounded: this runs inside acquire, with a run already waiting on the lease.
    "-o",
    "ConnectTimeout=10",
    ...(conn.identityFile ? ["-i", conn.identityFile, "-o", "IdentitiesOnly=yes"] : []),
    `${conn.username}@${conn.host}`,
    "--",
    remote,
  ];

  return { executable: "ssh", args };
}

/**
 * Extract the runner's report. The runner prints exactly one report JSON line to
 * stdout, but Agent S internals may also chatter to stdout — so scan for the last
 * line that parses to an object carrying a `status`.
 */
export function parseGuestReport(stdout: string): GuestReport {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && typeof obj === "object" && typeof obj.status === "string") {
        return {
          status: obj.status,
          reason: obj.reason ?? "",
          steps: obj.steps ?? 0,
          artifacts: Array.isArray(obj.artifacts) ? obj.artifacts : [],
          structuredOutput: obj.structured_output ?? obj.structuredOutput,
        };
      }
    } catch {
      // not JSON — keep scanning
    }
  }
  throw new Error("no valid report JSON found in guest stdout");
}

/** Run a computer-use task on the guest and return its structured report. */
export async function runComputerUseTask(
  conn: GuestConnection,
  task: ComputerUseTask,
  exec: ExecRunner,
  env: Record<string, string> = {},
): Promise<GuestReport> {
  const cmd = buildGuestRunCommand(conn, task, env);
  const res = await exec(cmd.executable, cmd.args, cmd.stdin);
  if (res.code !== 0 && res.stdout.trim() === "") {
    throw new Error(`guest runner transport failed (code ${res.code}): ${res.stderr.trim()}`);
  }
  return parseGuestReport(res.stdout);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
