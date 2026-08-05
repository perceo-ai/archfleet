// VM registry persistence. Maps FleetVm to cuf_vms columns and back. Live health
// still comes from the daemon (virsh); this is the durable inventory.

import type { Db } from "./db";
import type { FleetVm, VmStatus } from "../types";

export function saveVm(db: Db, vm: FleetVm): void {
  db.prepare(
    `INSERT OR REPLACE INTO cuf_vms
       (id, name, status, labels_json, domain, warm_snapshot,
        xrdp_host, xrdp_port, ssh_host, ssh_port, username, last_health_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    vm.id,
    vm.name,
    vm.status,
    JSON.stringify(vm.labels),
    vm.domain ?? null,
    vm.warmSnapshot ?? null,
    vm.xrdp.host,
    vm.xrdp.port,
    vm.ssh?.host ?? null,
    vm.ssh?.port ?? null,
    vm.xrdp.username,
    vm.lastHealthAt,
  );
}

function rowToVm(row: Record<string, unknown>): FleetVm {
  return {
    id: row.id as string,
    name: row.name as string,
    status: row.status as VmStatus,
    labels: JSON.parse((row.labels_json as string) || "[]"),
    cpu: 0,
    memoryGb: 0,
    diskGb: 0,
    xrdp: {
      host: (row.xrdp_host as string) ?? "",
      port: (row.xrdp_port as number) ?? 0,
      username: (row.username as string) ?? "agent",
      credentialSource: "env:AGENT_PASSWORD",
    },
    ssh: row.ssh_host
      ? { host: row.ssh_host as string, port: row.ssh_port as number, username: (row.username as string) ?? "agent" }
      : undefined,
    domain: (row.domain as string) ?? undefined,
    warmSnapshot: (row.warm_snapshot as string) ?? undefined,
    lastHealthAt: (row.last_health_at as string) ?? "",
  };
}

export function listVms(db: Db): FleetVm[] {
  const rows = db.prepare("SELECT * FROM cuf_vms ORDER BY name").all() as Record<string, unknown>[];
  return rows.map(rowToVm);
}

export function getVm(db: Db, id: string): FleetVm | undefined {
  const row = db.prepare("SELECT * FROM cuf_vms WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToVm(row) : undefined;
}
