import { redirect } from "next/navigation";

// People management moved into Settings, alongside everything else you configure.
export default function UsersPage() {
  redirect("/settings?tab=people");
}
