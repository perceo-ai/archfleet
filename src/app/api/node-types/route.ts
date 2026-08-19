import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/fleet/db/db";
import { deleteNodeType, listNodeTypes, saveNodeType } from "@/lib/fleet/db/node-types-repo";
import { validateNodeType } from "@/lib/fleet/node-types";
import type { CustomNodeType } from "@/lib/fleet/node-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A node type is executable and shared by every automation — an http or shell
// definition runs on the controller — so changing one is an admin action.
// Reading them is not: the step palette needs them for everyone.

// GET /api/node-types — every node type someone has defined.
export async function GET() {
  return Response.json(listNodeTypes(getDb()));
}

// POST /api/node-types — create or replace one. Validated before it can be
// picked in the palette, so a broken definition fails here rather than mid-run.
export async function POST(req: Request) {
  const denied = await requireRole(req, ["admin"]);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Partial<CustomNodeType>;
  const errors = validateNodeType(body);
  if (errors.length) return Response.json({ error: errors.join(" "), errors }, { status: 400 });
  const saved = saveNodeType(getDb(), body as CustomNodeType);
  return Response.json(saved, { status: 201 });
}

// DELETE /api/node-types?id= — remove a definition. Workflows still referencing
// it will fail that node with "unknown node type", which is visible in the run.
export async function DELETE(req: Request) {
  const denied = await requireRole(req, ["admin"]);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  if (!deleteNodeType(getDb(), id)) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}
