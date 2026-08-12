import { listProfileOperations, startProfileOperation, type ProfileOperationAction } from "@/lib/fleet/profile-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ operations: listProfileOperations() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: ProfileOperationAction;
    profile?: string;
    task?: string;
    clones?: number;
    agentPassword?: string;
    repair?: boolean;
  };
  try {
    if (!body.profile) return Response.json({ error: "profile is required" }, { status: 400 });
    const operation = startProfileOperation({
      action: body.action ?? "prepare",
      profile: body.profile,
      task: body.task,
      clones: body.clones,
      agentPassword: body.agentPassword,
      repair: body.repair,
    });
    return Response.json({ operation });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
