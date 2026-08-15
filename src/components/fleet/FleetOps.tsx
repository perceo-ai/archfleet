"use client";

// Operator surface: raw fleet health — VMs, capacity, profile readiness. Normal
// users live on the automation pages; this is where infrastructure is visible.

import { useState } from "react";
import { sendJson, usePolling } from "@/lib/ui/api";
import { timeAgo } from "@/lib/ui/format";
import { statusLabel, vmStatusTone } from "@/components/fleet/status-colors";
import type { FleetVm } from "@/lib/fleet/types";

type ProfileStatus = {
  profiles: Record<string, { ready: boolean; vms: { vmId: string; state: string; snapshot: string; snapshotPresent: boolean; ready: boolean }[] }>;
  vmCount: number;
};

type Health = {
  queuedRuns: number;
  metrics?: { runs: number; avgQueuedMs?: number; avgExecutionMs?: number };
};

const asMinSec = (ms: number | undefined) =>
  ms == null ? "—" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;

export function FleetOps() {
  const vms = usePolling<FleetVm[]>("/api/vms", 8000);
  const profiles = usePolling<ProfileStatus>("/api/profile-status", 30000);
  const health = usePolling<Health>("/api/health", 30000);
  const [message, setMessage] = useState<string | null>(null);

  const list = vms.data ?? [];
  const online = list.filter((v) => v.status !== "stopped" && v.status !== "unhealthy");
  const busy = list.filter((v) => v.status === "running" || v.status === "assigned");

  async function openDesktop(vm: FleetVm) {
    setMessage(null);
    try {
      const res = await sendJson<{ mode: string; launchUrl?: string; downloadUrl?: string }>(
        `/api/vms/${vm.id}/takeover`,
        "POST",
      );
      if (res.mode === "guacamole" && res.launchUrl) window.open(res.launchUrl, "_blank");
      else if (res.downloadUrl) window.open(res.downloadUrl, "_blank");
    } catch (e) {
      setMessage(String(e));
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-6 md:px-12">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Fleet operations</h1>
      <p className="mt-1 text-sm text-zinc-400">
        VM capacity, profile readiness, and direct desktop access. Operator territory.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "VMs configured", value: list.length },
          { label: "Online", value: online.length },
          { label: "Busy", value: busy.length },
          { label: "Queued runs", value: health.data?.queuedRuns ?? "—" },
          { label: "Avg queue wait (24h)", value: asMinSec(health.data?.metrics?.avgQueuedMs) },
          { label: "Avg run time (24h)", value: asMinSec(health.data?.metrics?.avgExecutionMs) },
        ].map((s) => (
          <div key={s.label} className="glass rounded-[5px] p-4">
            <div className="text-2xl font-semibold text-white">{s.value}</div>
            <div className="mt-1 text-xs text-white/45">{s.label}</div>
          </div>
        ))}
      </div>

      {message ? <p className="mt-3 text-sm text-[#fca5a5]">{message}</p> : null}

      <section className="glass glass-border mt-5 rounded-[5px]">
        <div className="border-b border-white/[0.08] px-4 py-3">
          <h2 className="text-sm font-semibold text-white">VMs</h2>
        </div>
        <div className="divide-y divide-white/[0.08]">
          {list.length === 0 ? (
            <p className="px-4 py-8 text-sm text-white/45">
              No VMs configured. Set CUF_GOLDEN_DOMAIN / CUF_FLEET_JSON, or build one from the
              Environments page.
            </p>
          ) : (
            list.map((vm) => (
              <div key={vm.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{vm.name}</span>
                    <span className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${vmStatusTone(vm.status)}`}>
                      {statusLabel(vm.status)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-white/45">
                    {vm.domain ? <span>domain {vm.domain}</span> : <span>mock</span>}
                    <span>
                      xrdp {vm.xrdp.host}:{vm.xrdp.port}
                    </span>
                    {vm.labels.map((l) => (
                      <span key={l} className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-1.5 py-0.5">
                        {l}
                      </span>
                    ))}
                    <span>health {timeAgo(vm.lastHealthAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void openDesktop(vm)}
                    className="inline-flex h-8 items-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-semibold text-white hover:bg-white/[0.08]"
                  >
                    Open desktop
                  </button>
                  <a
                    href={`/api/vms/${vm.id}/rdp`}
                    className="inline-flex h-8 items-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-semibold text-white hover:bg-white/[0.08]"
                  >
                    .rdp
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="glass glass-border mt-5 rounded-[5px]">
        <div className="border-b border-white/[0.08] px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Profile readiness</h2>
          <p className="mt-1 text-xs text-white/45">
            Warm snapshots present and domains reachable, per profile.
          </p>
        </div>
        <div className="px-4 py-3 text-sm text-zinc-400">
          {!profiles.data ? (
            <p className="text-white/40">{profiles.error ? "Profile status unavailable (libvirt not reachable)." : "Checking…"}</p>
          ) : Object.keys(profiles.data.profiles).length === 0 ? (
            <p>No profile-labeled VMs.</p>
          ) : (
            <ul className="grid gap-2">
              {Object.entries(profiles.data.profiles).map(([slug, p]) => (
                <li key={slug} className="flex items-center gap-2">
                  <span
                    className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${
                      p.ready
                        ? "bg-[#4ade80]/20 text-[#8add84] ring-1 ring-[#4ade80]/30"
                        : "bg-[#f87171]/20 text-[#fca5a5] ring-1 ring-[#f87171]/30"
                    }`}
                  >
                    {p.ready ? "ready" : "not ready"}
                  </span>
                  <span className="text-white">{slug}</span>
                  <span className="text-xs text-white/45">
                    {p.vms.map((v) => `${v.vmId} (${v.state}${v.snapshotPresent ? "" : ", no snapshot"})`).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
