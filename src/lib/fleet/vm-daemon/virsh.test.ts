import { describe, expect, it } from "vitest";
import { createVirshClient, type VirshResult, type VirshRunner } from "./virsh";

/** Records the argv virsh was called with and replays queued fake results. */
function fakeRunner(results: VirshResult[]): { runner: VirshRunner; calls: string[][] } {
  const calls: string[][] = [];
  const queue = [...results];
  const runner: VirshRunner = async (args) => {
    calls.push(args);
    return queue.shift() ?? { code: 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

const ok = (stdout = ""): VirshResult => ({ code: 0, stdout, stderr: "" });
const err = (stderr: string, code = 1): VirshResult => ({ code, stdout: "", stderr });

describe("virsh client argv construction", () => {
  it("prefixes the connection URI on every call", async () => {
    const { runner, calls } = fakeRunner([ok("6.0.0")]);
    const client = createVirshClient(runner, "qemu:///session");
    await client.isReachable();
    expect(calls[0]).toEqual(["-c", "qemu:///session", "version"]);
  });

  it("reverts a warm snapshot with --running", async () => {
    const { runner, calls } = fakeRunner([ok()]);
    const client = createVirshClient(runner, "qemu:///system");
    await client.revertSnapshot("cuf-golden", "golden-warm");
    expect(calls[0]).toEqual([
      "-c",
      "qemu:///system",
      "snapshot-revert",
      "cuf-golden",
      "golden-warm",
      "--running",
    ]);
  });

  it("lists domains by name only", async () => {
    const { runner, calls } = fakeRunner([ok("cuf-golden\ncuf-worker-1\n")]);
    const client = createVirshClient(runner);
    const names = await client.listDomains();
    expect(calls[0]).toEqual(["-c", "qemu:///session", "list", "--all", "--name"]);
    expect(names).toEqual(["cuf-golden", "cuf-worker-1"]);
  });
});

describe("virsh output parsing", () => {
  it("parses a running domain state", async () => {
    const { runner } = fakeRunner([ok("running\n")]);
    const client = createVirshClient(runner);
    expect(await client.domainState("cuf-golden")).toBe("running");
  });

  it("maps a missing domain to 'absent'", async () => {
    const { runner } = fakeRunner([err("error: failed to get domain 'nope'")]);
    const client = createVirshClient(runner);
    expect(await client.domainState("nope")).toBe("absent");
  });

  it("maps an unrecognized non-zero failure to 'unknown'", async () => {
    const { runner } = fakeRunner([err("error: some other libvirt problem")]);
    const client = createVirshClient(runner);
    expect(await client.domainState("weird")).toBe("unknown");
  });

  it("throws with stderr context on a failed start", async () => {
    const { runner } = fakeRunner([err("error: Requested operation is not valid")]);
    const client = createVirshClient(runner);
    await expect(client.start("cuf-golden")).rejects.toThrow(/not valid/);
  });
});
