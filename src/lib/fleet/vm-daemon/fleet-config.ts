// Assembles the list of REAL (libvirt-domain-bound) VMs the daemon controls, from
// environment set by build-golden.sh / the operator. When no real VM is configured
// this returns [] and the daemon simply has nothing to acquire (runs queue).
//
// Env (all optional):
//   CUF_GOLDEN_DOMAIN     libvirt domain name (enables one real VM when set)
//   CUF_GOLDEN_LABELS     comma labels          (default: linux-desktop,browser)
//   CUF_GOLDEN_SNAPSHOT   warm snapshot name    (default: golden-warm)
//   CUF_GUEST_HOST        ssh/xrdp host         (default: 127.0.0.1)
//   CUF_GUEST_SSH_PORT    forwarded ssh port    (default: 10022)
//   CUF_GUEST_RDP_PORT    forwarded xrdp port   (default: 13389)
//   AGENT_USER            guest login user      (default: agent)

import type { FleetVm } from "../types";

export function realVmsFromEnv(env: Record<string, string | undefined> = process.env): FleetVm[] {
  const domain = env.CUF_GOLDEN_DOMAIN;
  if (!domain) return [];

  const host = env.CUF_GUEST_HOST ?? "127.0.0.1";
  const sshPort = Number(env.CUF_GUEST_SSH_PORT ?? "10022");
  const rdpPort = Number(env.CUF_GUEST_RDP_PORT ?? "13389");
  const user = env.AGENT_USER ?? "agent";
  const labels = (env.CUF_GOLDEN_LABELS ?? "linux-desktop,browser")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  return [
    {
      id: `vm_${domain}`,
      name: domain,
      status: "idle",
      labels,
      cpu: 0,
      memoryGb: Number(env.CUF_GOLDEN_MEM_GB ?? "4"),
      diskGb: Number(env.CUF_GOLDEN_DISK_GB ?? "25"),
      xrdp: {
        host,
        port: rdpPort,
        username: user,
        credentialSource: "env:AGENT_PASSWORD",
      },
      ssh: { host, port: sshPort, username: user },
      lastHealthAt: "",
      domain,
      warmSnapshot: env.CUF_GOLDEN_SNAPSHOT ?? "golden-warm",
    },
  ];
}
