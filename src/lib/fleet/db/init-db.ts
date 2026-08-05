// One-time idempotent seeding: populate cuf_workflows from the seed state if the
// table is empty, so a fresh database has something to run + attach triggers to.

import type { Db } from "./db";
import { seedFleetState } from "../seed";
import { saveWorkflow } from "./workflows-repo";

export function ensureSeeded(db: Db, now = new Date().toISOString()): void {
  const { c } = db.prepare("SELECT COUNT(*) AS c FROM cuf_workflows").get() as { c: number };
  if (c > 0) return;
  for (const wf of seedFleetState().workflows) saveWorkflow(db, wf, now);
}
