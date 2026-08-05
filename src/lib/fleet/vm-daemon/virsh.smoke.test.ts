import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createVirshClient } from "./virsh";
import { execVirshRunner } from "./exec-runner";

/** True when the virsh binary is on PATH. Smoke tests skip otherwise. */
function virshPresent(): boolean {
  try {
    execSync("command -v virsh", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const maybe = virshPresent() ? describe : describe.skip;

maybe("virsh smoke (real binary)", () => {
  it("reaches the session URI and lists domains without throwing", async () => {
    const client = createVirshClient(execVirshRunner(), "qemu:///session");
    const reachable = await client.isReachable();
    expect(typeof reachable).toBe("boolean");
    if (reachable) {
      const domains = await client.listDomains();
      expect(Array.isArray(domains)).toBe(true);
    }
  });
});
