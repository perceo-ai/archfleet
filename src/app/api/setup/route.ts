import { getDb } from "@/lib/fleet/db/db";
import { listAutomations } from "@/lib/fleet/db/automations-repo";
import { listEnvironments } from "@/lib/fleet/db/environments-repo";
import { listRuns } from "@/lib/fleet/db/runs-repo";
import { listVms } from "@/lib/fleet/db/vms-repo";
import { realVmsFromEnv } from "@/lib/fleet/vm-daemon/fleet-config";
import { settingValue } from "@/lib/fleet/db/settings-repo";
import { summarizeSetup } from "@/lib/fleet/setup-status";
import { authSecretFromEnv } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/setup — how ready this install is, computed from real state.
export async function GET() {
  const db = getDb();
  const real = realVmsFromEnv();
  const realIds = new Set(real.map((v) => v.id));
  const desktopCount = real.length + listVms(db).filter((v) => !realIds.has(v.id)).length;

  return Response.json(
    summarizeSetup({
      authConfigured: Boolean(authSecretFromEnv()),
      secretStoreReady: Boolean(process.env.CUF_SECRET_KEY),
      plannerConfigured: Boolean(settingValue(db, "provider.openrouter_api_key")),
      groundingConfigured: Boolean(settingValue(db, "provider.grounding_base_url")),
      desktopCount,
      environmentCount: listEnvironments(db).length,
      notifyConfigured: Boolean(settingValue(db, "notify.webhook")),
      automationCount: listAutomations(db).length,
      runCount: listRuns(db, 1).length,
    }),
  );
}
