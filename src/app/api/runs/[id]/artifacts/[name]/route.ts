import { readFile } from "node:fs/promises";
import { artifactBaseDir, safeArtifactPath, contentTypeFor } from "@/lib/fleet/artifact-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/runs/:id/artifacts/:name — serve a fetched artifact file (screenshot, etc).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  const path = safeArtifactPath(artifactBaseDir(), id, name);
  if (!path) return Response.json({ error: "invalid path" }, { status: 400 });
  try {
    const data = await readFile(path);
    return new Response(new Uint8Array(data), {
      headers: { "content-type": contentTypeFor(name), "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "artifact not found" }, { status: 404 });
  }
}
