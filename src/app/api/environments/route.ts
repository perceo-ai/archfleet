import { getDb } from "@/lib/fleet/db/db";
import {
  getEnvironment,
  listEnvironments,
  saveEnvironment,
  setEnvironmentHealth,
} from "@/lib/fleet/db/environments-repo";
import { checkProfileFleet } from "@/lib/fleet/profile-status";
import { realVmsFromEnv } from "@/lib/fleet/vm-daemon/fleet-config";
import { createVirshClient } from "@/lib/fleet/vm-daemon/virsh";
import { execVirshRunner } from "@/lib/fleet/vm-daemon/exec-runner";
import type { PreparedEnvironment } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Best-effort: refresh environment health from live profile/warm-snapshot state.
 * Only touches environments with a profileRef; silently no-ops without libvirt. */
async function syncHealthFromFleet(): Promise<void> {
  const db = getDb();
  const withProfiles = listEnvironments(db).filter((e) => e.profileRef);
  const vms = realVmsFromEnv();
  if (!withProfiles.length || !vms.length) return;
  try {
    const client = createVirshClient(execVirshRunner(), process.env.CUF_LIBVIRT_URI ?? "qemu:///session");
    const status = await checkProfileFleet(vms, client);
    for (const env of withProfiles) {
      const profile = status.profiles[env.profileRef!];
      if (!profile) continue;
      setEnvironmentHealth(db, env.id, profile.ready ? "ready" : "degraded");
    }
  } catch {
    // libvirt unreachable — keep stored health
  }
}

// GET /api/environments?live=1 — prepared environments (user-facing wrapper over
// profiles). live=1 first refreshes health from libvirt/warm-snapshot state.
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("live") === "1") await syncHealthFromFleet();
  return Response.json(listEnvironments(getDb()));
}

// POST /api/environments — create or replace a prepared environment.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<PreparedEnvironment>;
  if (!body.name) return Response.json({ error: "name is required" }, { status: 400 });
  const now = new Date().toISOString();
  const id = body.id ?? `env_${body.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
  const env: PreparedEnvironment = {
    id,
    name: body.name,
    description: body.description ?? "",
    labels: body.labels ?? [],
    profileRef: body.profileRef,
    health: body.health ?? "unknown",
    snapshotState: body.snapshotState,
    lastUsedAt: body.lastUsedAt,
    recoveryState: body.recoveryState,
    setupNotes: body.setupNotes,
    createdAt: body.createdAt ?? now,
    updatedAt: now,
  };
  saveEnvironment(getDb(), env);
  return Response.json(env, { status: 201 });
}

// PATCH /api/environments — partial update. Body: { id, ...fields }.
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<PreparedEnvironment> & {
    id?: string;
  };
  if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
  const db = getDb();
  const existing = getEnvironment(db, body.id);
  if (!existing) return Response.json({ error: "environment not found" }, { status: 404 });
  const updated: PreparedEnvironment = {
    ...existing,
    ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  saveEnvironment(db, updated);
  return Response.json(updated);
}
