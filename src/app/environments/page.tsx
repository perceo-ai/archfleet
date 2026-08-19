import { EnvironmentsPanel } from "@/components/environments/EnvironmentsPanel";

export default async function EnvironmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab = tab === "capacity" || tab === "secrets" ? tab : "environments";
  return <EnvironmentsPanel initialTab={initialTab} />;
}
