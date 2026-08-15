import { getDb } from "@/lib/fleet/db/db";
import { buildPrEvidenceSummary, publishPrComment } from "@/lib/fleet/pr-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/evidence/pr-comment?pr=org/repo%2342 | ?branch=... — the evidence
// summary (markdown + per-run evidence) Archductor or CI can pull for review.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pr = url.searchParams.get("pr");
  const branch = url.searchParams.get("branch");
  if (!pr && !branch) return Response.json({ error: "pr or branch is required" }, { status: 400 });
  return Response.json(
    buildPrEvidenceSummary(getDb(), { prRef: pr ?? undefined, branchRef: branch ?? undefined }),
  );
}

// POST /api/evidence/pr-comment — publish the summary as a GitHub PR comment.
// Body: { pr, repo? }. Needs CUF_GITHUB_TOKEN, and the resolved repo must be in
// the CUF_GITHUB_REPO allowlist (comma-separated) — callers cannot point the
// token at arbitrary repos. Otherwise returns the markdown unposted so the
// caller can publish it through its own channel.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { pr?: string | number; repo?: string };
  if (body.pr == null) return Response.json({ error: "pr is required" }, { status: 400 });
  const result = await publishPrComment(getDb(), String(body.pr), { repo: body.repo });
  return Response.json(result, { status: result.posted ? 201 : 200 });
}
