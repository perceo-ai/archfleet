import { spawn } from "node:child_process";
import type { VirshResult, VirshRunner } from "./virsh";

/** Real virsh runner: spawns the `virsh` binary. Never used in unit tests. */
export function execVirshRunner(binary = "virsh"): VirshRunner {
  return (args: string[]) =>
    new Promise<VirshResult>((resolve) => {
      const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => resolve({ code: 127, stdout, stderr: String(e) }));
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
}
