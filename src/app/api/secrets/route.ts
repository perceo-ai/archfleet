import { getDb } from "@/lib/fleet/db/db";
import { listSecretMeta, saveSecret } from "@/lib/fleet/db/secrets-repo";
import type { Secret } from "@/lib/fleet/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/secrets — names + scopes only, never values.
export async function GET() {
  return Response.json(listSecretMeta(getDb()));
}

// POST /api/secrets — create an encrypted secret. Body: { name, scope, value, scopeId? }.
// Requires CUF_SECRET_KEY; the value is AES-256-GCM encrypted before storage.
export async function POST(req: Request) {
  const body = (await req.json()) as {
    name?: string;
    scope?: Secret["scope"];
    value?: string;
    scopeId?: string;
  };
  if (!body.name || !body.scope || body.value == null) {
    return Response.json({ error: "name, scope and value are required" }, { status: 400 });
  }
  try {
    const id = saveSecret(getDb(), {
      name: body.name,
      scope: body.scope,
      value: body.value,
      scopeId: body.scopeId,
    });
    return Response.json({ id, name: body.name, scope: body.scope }, { status: 201 });
  } catch (e) {
    // Most likely CUF_SECRET_KEY missing.
    return Response.json({ error: String(e) }, { status: 400 });
  }
}
