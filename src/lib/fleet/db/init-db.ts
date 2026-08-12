// One-time idempotent seeding: populate cuf_workflows from the seed state if the
// table is empty, so a fresh database has something to run + attach triggers to.

import type { Db } from "./db";
import { seedFleetState } from "../seed";
import { saveWorkflow } from "./workflows-repo";
import { ensureAdminFromEnv } from "./users-repo";

export function ensureSeeded(db: Db, now = new Date().toISOString()): void {
  ensureAdminFromEnv(db);
  db.prepare("DELETE FROM cuf_vms WHERE id IN ('vm_ubuntu_1', 'vm_ubuntu_2', 'vm_gpu_1')").run();
  const { c } = db.prepare("SELECT COUNT(*) AS c FROM cuf_workflows").get() as { c: number };
  if (c > 0) return;
  const state = seedFleetState();
  for (const wf of state.workflows) saveWorkflow(db, wf, now);
}
