import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/fleet/db/db";
import { saveSettings, settingsForDisplay } from "@/lib/fleet/db/settings-repo";
import { SETTING_BY_KEY, SETTING_DEFS, validateSetting } from "@/lib/fleet/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/settings — the catalogue plus each setting's current state. Secret
// values are reported as set/unset, never returned.
export async function GET(req: Request) {
  const denied = await requireRole(req, ["admin", "operator"]);
  if (denied) return denied;
  return Response.json({ defs: SETTING_DEFS, values: settingsForDisplay(getDb()) });
}

// PATCH /api/settings — store a partial update. An empty string clears a value,
// falling back to the environment variable or the built-in default.
export async function PATCH(req: Request) {
  const denied = await requireRole(req, ["admin"]);
  if (denied) return denied;
  const patch = (await req.json().catch(() => ({}))) as Record<string, string>;

  const errors = Object.entries(patch)
    .map(([key, value]) => validateSetting(key, String(value)))
    .filter((e): e is string => !!e);
  if (errors.length) return Response.json({ error: errors.join(" "), errors }, { status: 400 });

  const db = getDb();
  const report = saveSettings(
    db,
    Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])),
  );

  // Everything storable was stored; say plainly which values could not be, and
  // why, rather than failing the whole save.
  if (report.skippedSecrets.length) {
    const names = report.skippedSecrets
      .map((k) => SETTING_BY_KEY.get(k)?.label ?? k)
      .join(", ");
    return Response.json(
      {
        error: `Saved the rest, but ${names} could not be stored — set CUF_SECRET_KEY on the server so secrets can be encrypted.`,
        skipped: report.skippedSecrets,
        values: settingsForDisplay(db),
      },
      { status: 503 },
    );
  }
  return Response.json({ values: settingsForDisplay(db) });
}
