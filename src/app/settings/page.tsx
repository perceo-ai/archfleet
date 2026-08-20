import { Suspense } from "react";
import { SettingsPage } from "@/components/settings/SettingsPage";

export default function Settings() {
  return (
    <Suspense fallback={<div className="page-pad" />}>
      <SettingsPage />
    </Suspense>
  );
}
