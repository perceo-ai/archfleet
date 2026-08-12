// Assembles the list of REAL (libvirt-domain-bound) VMs the daemon controls, from
// environment. Two forms, both optional (combined + de-duped by domain):
//
//   CUF_GOLDEN_DOMAIN=cuf-golden        single-VM shorthand (uses CUF_GUEST_* + AGENT_USER)
//   CUF_FLEET_JSON=[{domain,...}, ...]  full multi-VM fleet
//   CUF_FLEET_JSON_FILE=/path/fleet.json profile fleet file emitted by prepare-profile.sh
//
// A fleet spec: { domain, name?, labels?(csv or []), host?, sshPort?, rdpPort?,
//   user?, snapshot?, memGb?, diskGb?, profile? }.
//
// With neither set this returns [] and the daemon has nothing to acquire.

import type { FleetVm } from "../types";
import { readFileSync } from "node:fs";

type VmSpec = {
  domain: string;
  name?: string;
  labels?: string[] | string;
  host?: string;
  sshPort?: number;
  rdpPort?: number;
  user?: string;
  snapshot?: string;
  memGb?: number;
  diskGb?: number;
  profile?: string;
};

function toLabels(labels: string[] | string | undefined, fallback: string): string[] {
  if (Array.isArray(labels)) return labels;
  return (labels ?? fallback)
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
}

function buildVm(spec: VmSpec): FleetVm {
  const host = spec.host ?? "127.0.0.1";
  const user = spec.user ?? "agent";
  const sshPort = spec.sshPort ?? 10022;
  const rdpPort = spec.rdpPort ?? 13389;
  const labels = toLabels(spec.labels, "linux-desktop,browser");
  const profile = spec.profile?.trim();
  const profileLabel = profile ? `profile:${profile}` : "";
  if (profileLabel && !labels.includes(profileLabel)) labels.push(profileLabel);
  return {
    id: `vm_${spec.domain}`,
    name: spec.name ?? (profile ? `${profile} / ${spec.domain}` : spec.domain),
    status: "idle",
    labels,
    cpu: 0,
    memoryGb: spec.memGb ?? 4,
    diskGb: spec.diskGb ?? 25,
    xrdp: { host, port: rdpPort, username: user, credentialSource: "env:AGENT_PASSWORD" },
    ssh: { host, port: sshPort, username: user },
    lastHealthAt: "",
    domain: spec.domain,
    warmSnapshot: spec.snapshot ?? "golden-warm",
  };
}

export function realVmsFromEnv(env: Record<string, string | undefined> = process.env): FleetVm[] {
  const specs: VmSpec[] = [];

  if (env.CUF_GOLDEN_DOMAIN) {
    specs.push({
      domain: env.CUF_GOLDEN_DOMAIN,
      labels: env.CUF_GOLDEN_LABELS,
      host: env.CUF_GUEST_HOST,
      sshPort: env.CUF_GUEST_SSH_PORT ? Number(env.CUF_GUEST_SSH_PORT) : undefined,
      rdpPort: env.CUF_GUEST_RDP_PORT ? Number(env.CUF_GUEST_RDP_PORT) : undefined,
      user: env.AGENT_USER,
      snapshot: env.CUF_GOLDEN_SNAPSHOT,
      memGb: env.CUF_GOLDEN_MEM_GB ? Number(env.CUF_GOLDEN_MEM_GB) : undefined,
      diskGb: env.CUF_GOLDEN_DISK_GB ? Number(env.CUF_GOLDEN_DISK_GB) : undefined,
    });
  }

  if (env.CUF_FLEET_JSON) {
    try {
      const parsed = JSON.parse(env.CUF_FLEET_JSON) as VmSpec[];
      for (const s of parsed) if (s && s.domain) specs.push(s);
    } catch {
      // ignore malformed fleet config
    }
  }

  if (env.CUF_FLEET_JSON_FILE) {
    try {
      const parsed = JSON.parse(readFileSync(env.CUF_FLEET_JSON_FILE, "utf8")) as VmSpec[];
      for (const s of parsed) if (s && s.domain) specs.push(s);
    } catch {
      // ignore missing/malformed fleet config files
    }
  }

  // De-dupe by domain (shorthand + JSON may overlap); first wins.
  const byDomain = new Map<string, FleetVm>();
  for (const s of specs) if (!byDomain.has(s.domain)) byDomain.set(s.domain, buildVm(s));
  return [...byDomain.values()];
}
