import { redirect } from "next/navigation";

// Fleet folded into Environments — capacity is a tab there, not a sibling concept.
export default function FleetPage() {
  redirect("/environments?tab=capacity");
}
