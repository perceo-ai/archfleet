// One-time idempotent seeding: populate cuf_workflows from the seed state if the
// table is empty, so a fresh database has something to run + attach triggers to.
// Likewise seed one prepared environment + one automation wrapping the seed
// workflow, so the automation-first UI has a real object on first boot.

import type { Db } from "./db";
import { seedFleetState } from "../seed";
import { saveWorkflow } from "./workflows-repo";
import { ensureAdminFromEnv } from "./users-repo";
import { saveAutomation } from "./automations-repo";
import { saveEnvironment } from "./environments-repo";

export function ensureSeeded(db: Db, now = new Date().toISOString()): void {
  ensureAdminFromEnv(db);
  db.prepare("DELETE FROM cuf_vms WHERE id IN ('vm_ubuntu_1', 'vm_ubuntu_2', 'vm_gpu_1')").run();
  const state = seedFleetState();
  const { c } = db.prepare("SELECT COUNT(*) AS c FROM cuf_workflows").get() as { c: number };
  if (c === 0) {
    for (const wf of state.workflows) saveWorkflow(db, wf, now);
  }
  const { a } = db.prepare("SELECT COUNT(*) AS a FROM cuf_automations").get() as { a: number };
  if (a === 0) {
    saveEnvironment(db, {
      id: "env_default",
      name: "Default runner desktop",
      description: "The standard Linux desktop with a browser — no logged-in state.",
      labels: ["linux-desktop", "browser"],
      health: "unknown",
      snapshotState: "golden-warm",
      setupNotes: "Prepare a profile from the Environments page to add logged-in state.",
      createdAt: now,
      updatedAt: now,
    });
    const wf = state.workflows[0];
    saveAutomation(db, {
      id: "auto_portal_login",
      name: wf.name,
      goal: wf.description,
      category: "semantic_test",
      target: "portal.example.test",
      specMarkdown:
        "1. Open the portal URL\n2. Log in with the portal account\n3. Confirm the dashboard loads and capture a screenshot",
      workflowId: wf.id,
      environmentId: "env_default",
      successCriteria: ["The dashboard is visible after login"],
      requiredSecrets: ["portal_password"],
      mfaExpectation: undefined,
      artifactPolicy: "Screenshot of the dashboard after login.",
      retryPolicy: "No automatic retries.",
      takeoverPolicy: "Pause for a human if login fails.",
      triggerSuggestion: "Run before each release",
      riskNotes: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }
}
