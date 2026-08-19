import { EnvironmentsPanel } from "@/components/environments/EnvironmentsPanel";

export default async function EnvironmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  // Secrets moved to Settings; an old link still lands somewhere sensible.
  const initialTab = tab === "capacity" ? "capacity" : "environments";
  return <EnvironmentsPanel initialTab={initialTab} />;
}
