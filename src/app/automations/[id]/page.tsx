import { AutomationWorkspace } from "@/components/automations/workspace/AutomationWorkspace";

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // /automations/new is the same workspace with nothing in it yet.
  return <AutomationWorkspace id={id === "new" ? undefined : id} />;
}
