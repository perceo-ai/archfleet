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

// Destroying a profile removes VMs and their disks, so the guards around it
// matter as much as the command itself.
describe("destroy", () => {
  it("is a dry run unless the caller confirms", () => {
    // A mistyped request must list what it would remove, never remove it.
    expect(buildProfileCommand({ action: "destroy", profile: "bank" })).toEqual([
      "virt/destroy-profile.sh",
      "--profile",
      "bank",
    ]);
  });

  it("confirming adds --yes", () => {
    expect(buildProfileCommand({ action: "destroy", profile: "bank", confirm: true })).toEqual([
      "virt/destroy-profile.sh",
      "--profile",
      "bank",
      "--yes",
    ]);
  });

  it("can keep the disks", () => {
    expect(
      buildProfileCommand({ action: "destroy", profile: "bank", confirm: true, keepDisks: true }),
    ).toContain("--keep-disks");
  });

  it("normalises the profile slug like every other action", () => {
    expect(buildProfileCommand({ action: "destroy", profile: "My Bank!" })).toContain("my-bank");
  });

  it("never surfaces a source desktop — there is nothing to sign in on", () => {
    expect(sourceVmForOperation({ action: "destroy", profile: "bank" }, "op1")).toBeUndefined();
  });
});
