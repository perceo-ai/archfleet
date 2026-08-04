import { Monitor, Network, Server } from "lucide-react";
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
  return (
    <aside className="min-h-0 border-r border-zinc-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-4">
        <Server className="h-4 w-4 text-zinc-700" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-zinc-950">Local VM Fleet</h2>
      </div>

      <div className="space-y-3 overflow-y-auto p-3">
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
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-800">
                <Network className="h-3.5 w-3.5" aria-hidden="true" />
                XRDP
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
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
