"use client";

import { useState } from "react";
import { Copy, Download, ExternalLink, Monitor, Network, Server } from "lucide-react";
import type { FleetVm } from "@/lib/fleet/types";

type FleetSidebarProps = {
  vms: FleetVm[];
};

const statusTone: Record<FleetVm["status"], string> = {
  stopped: "bg-zinc-200 text-zinc-700",
  starting: "bg-sky-100 text-sky-800",
  idle: "bg-emerald-100 text-emerald-800",
  assigned: "bg-amber-100 text-amber-800",
  running: "bg-blue-100 text-blue-800",
  needs_human: "bg-rose-100 text-rose-800",
  resetting: "bg-violet-100 text-violet-800",
  unhealthy: "bg-red-100 text-red-800",
};

export function FleetSidebar({ vms }: FleetSidebarProps) {
  const [busyVmId, setBusyVmId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function openDesktop(vm: FleetVm) {
    setBusyVmId(vm.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/vms/${encodeURIComponent(vm.id)}/takeover`, { method: "POST" });
      const body = (await res.json()) as
        | { mode: "guacamole"; launchUrl: string }
        | { mode: "rdp_file"; downloadUrl: string; reason?: string }
        | { error?: string };
      if ("error" in body && body.error) throw new Error(body.error);
      if (!("mode" in body)) throw new Error("Invalid takeover response.");
      if (body.mode === "guacamole") {
        window.open(body.launchUrl, "_blank", "noopener,noreferrer");
        return;
      }
      window.open(body.downloadUrl, "_blank", "noopener,noreferrer");
      setMessage(body.reason ? `Downloaded .rdp: ${body.reason}` : "Downloaded .rdp file.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not open desktop.");
    } finally {
      setBusyVmId(null);
    }
  }

  return (
    <aside className="min-h-0 border-r border-zinc-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-4">
        <Server className="h-4 w-4 text-zinc-700" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-zinc-950">Local VM Fleet</h2>
      </div>

      <div className="space-y-3 overflow-y-auto p-3">
        {message ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {message}
          </div>
        ) : null}
        {vms.map((vm) => (
          <section key={vm.id} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                  <h3 className="text-sm font-medium text-zinc-950">{vm.name}</h3>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {vm.cpu} CPU / {vm.memoryGb} GB / {vm.diskGb} GB
                </p>
              </div>
              <span
                className={`rounded px-2 py-1 text-[11px] font-medium ${statusTone[vm.status]}`}
              >
                {vm.status.replace("_", " ")}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-1">
              {vm.labels.map((label) => (
                <span
                  key={label}
                  className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-600"
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="mt-3 border-t border-zinc-200 pt-3">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-800">
                <span className="flex items-center gap-2">
                  <Network className="h-3.5 w-3.5" aria-hidden="true" />
                  XRDP
                </span>
                <button
                  type="button"
                  title="Copy connection"
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      `${vm.xrdp.host}:${vm.xrdp.port} user=${vm.xrdp.username}`,
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-normal text-zinc-500 hover:bg-white"
                >
                  <Copy className="h-3 w-3" aria-hidden="true" />
                  Copy
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-[56px_1fr] gap-y-1 text-xs">
                <dt className="text-zinc-500">Host</dt>
                <dd className="font-mono text-zinc-800">
                  {vm.xrdp.host}:{vm.xrdp.port}
                </dd>
                <dt className="text-zinc-500">User</dt>
                <dd className="font-mono text-zinc-800">{vm.xrdp.username}</dd>
                <dt className="text-zinc-500">Cred</dt>
                <dd className="truncate font-mono text-zinc-800">{vm.xrdp.credentialSource}</dd>
              </dl>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <button
                  type="button"
                  onClick={() => void openDesktop(vm)}
                  disabled={busyVmId === vm.id}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-zinc-900 bg-zinc-950 px-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  {busyVmId === vm.id ? "Opening" : "Open desktop"}
                </button>
                <a
                  href={`/api/vms/${encodeURIComponent(vm.id)}/rdp`}
                  title="Download .rdp file"
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
