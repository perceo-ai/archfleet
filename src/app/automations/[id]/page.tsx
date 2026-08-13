import { AutomationDetail } from "@/components/automations/AutomationDetail";

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AutomationDetail id={id} />;
}
