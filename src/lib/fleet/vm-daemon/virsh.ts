// Thin, testable wrapper over the `virsh` CLI. All process execution goes through
// an injected `VirshRunner`, so command construction and output parsing are unit
// testable with a fake runner and the real binary is only touched in smoke tests.

export type VirshResult = { code: number; stdout: string; stderr: string };

/** Runs `virsh <args>` and resolves its result. Injected for testability. */
export type VirshRunner = (args: string[]) => Promise<VirshResult>;

/** libvirt domain states as reported by `virsh domstate`, plus `absent`/`unknown`. */
export type DomainState =
  | "running"
  | "paused"
  | "shut off"
  | "in shutdown"
  | "crashed"
  | "pmsuspended"
  | "idle"
  | "absent"
  | "unknown";

const KNOWN_STATES: DomainState[] = [
  "running",
  "paused",
  "shut off",
  "in shutdown",
  "crashed",
  "pmsuspended",
  "idle",
];

export type VirshClient = ReturnType<typeof createVirshClient>;

export function createVirshClient(runner: VirshRunner, uri = "qemu:///session") {
  const base = ["-c", uri];

  async function run(cmd: string[]): Promise<VirshResult> {
    return runner([...base, ...cmd]);
  }

  /** Throws with stderr context when a command exits non-zero. */
  async function runOk(cmd: string[]): Promise<VirshResult> {
    const res = await run(cmd);
    if (res.code !== 0) {
      throw new Error(`virsh ${cmd.join(" ")} failed (code ${res.code}): ${res.stderr.trim()}`);
    }
    return res;
  }

  return {
    /** Connectivity probe. True if `virsh version` succeeds against the URI. */
    async isReachable(): Promise<boolean> {
      const res = await run(["version"]);
      return res.code === 0;
    },

    /** All defined domain names (running + shut off). */
    async listDomains(): Promise<string[]> {
      const res = await runOk(["list", "--all", "--name"]);
      return res.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    },

    /** State of a single domain. Returns `absent` when the domain is undefined. */
    async domainState(name: string): Promise<DomainState> {
      const res = await run(["domstate", name]);
      if (res.code !== 0) {
        // virsh prints "failed to get domain" / "Domain not found" to stderr.
        if (/not found|failed to get domain/i.test(res.stderr)) return "absent";
        return "unknown";
      }
      const value = res.stdout.trim().toLowerCase();
      return (KNOWN_STATES.find((s) => s === value) as DomainState) ?? "unknown";
    },

    async start(name: string): Promise<void> {
      await runOk(["start", name]);
    },

    async shutdown(name: string): Promise<void> {
      await runOk(["shutdown", name]);
    },

    async destroy(name: string): Promise<void> {
      await runOk(["destroy", name]);
    },

    /** Revert to a snapshot and leave the domain running (warm reset). */
    async revertSnapshot(name: string, snapshot: string): Promise<void> {
      await runOk(["snapshot-revert", name, snapshot, "--running"]);
    },

    /** Snapshot names for a domain, newest-last per virsh ordering. */
    async listSnapshots(name: string): Promise<string[]> {
      const res = await runOk(["snapshot-list", name, "--name"]);
      return res.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    },
  };
}
