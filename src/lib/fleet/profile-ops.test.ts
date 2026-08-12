import { describe, expect, it } from "vitest";
import { buildProfileCommand, sourceVmForOperation } from "./profile-ops";

describe("profile operations", () => {
  it("builds prepare, update, and recover commands", () => {
    expect(buildProfileCommand({ action: "prepare", profile: "Bank Portal", clones: 3 })).toEqual([
      "virt/prepare-profile.sh",
      "--profile",
      "bank-portal",
      "--clones",
      "3",
    ]);
    expect(buildProfileCommand({ action: "update", profile: "bank", clones: 2 })).toEqual([
      "virt/update-profile.sh",
      "--profile",
      "bank",
      "--clones",
      "2",
    ]);
    expect(buildProfileCommand({ action: "recover", profile: "bank", repair: true })).toEqual([
      "virt/recover-profile.sh",
      "--profile",
      "bank",
      "--repair",
    ]);
  });

  it("exposes a source VM for interactive prepare/update operations", () => {
    const vm = sourceVmForOperation({ action: "prepare", profile: "bank", sourceRdpPort: 14400 }, "op1");
    expect(vm).toMatchObject({
      id: "profile_source_op1",
      name: "bank source",
      xrdp: { port: 14400, username: "agent", credentialSource: "env:AGENT_PASSWORD" },
      domain: "cuf-golden",
    });
  });
});
