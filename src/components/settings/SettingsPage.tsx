"use client";

// One page for everything you configure: what is set up, the models, where to
// be paged, the defaults new automations inherit, the fleet wiring, secrets,
// custom node types, and who has access.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePolling } from "@/lib/ui/api";
import { Tabs } from "@/components/ui/primitives";
import { SetupPanel } from "@/components/settings/SetupPanel";
import { SettingsGroup, type SettingValue } from "@/components/settings/SettingsGroup";
import { SecretsPanel } from "@/components/settings/SecretsPanel";
import { NodeTypesPanel } from "@/components/settings/NodeTypesPanel";
import { PeoplePanel } from "@/components/settings/PeoplePanel";
import type { SettingDef } from "@/lib/fleet/settings";

type Tab =
  | "setup"
  | "providers"
  | "notifications"
  | "behaviour"
  | "fleet"
  | "secrets"
  | "node-types"
  | "people";

const TABS: { key: Tab; label: string }[] = [
  { key: "setup", label: "Setup" },
  { key: "providers", label: "Providers" },
  { key: "notifications", label: "Notifications" },
  { key: "behaviour", label: "Behaviour" },
  { key: "fleet", label: "Fleet" },
  { key: "secrets", label: "Secrets" },
  { key: "node-types", label: "Node types" },
  { key: "people", label: "People & tokens" },
];

export function SettingsPage() {
  const router = useRouter();
  const params = useSearchParams();
  // The URL is the source of truth, so a deep link from the setup checklist
  // opens the right tab and the back button works.
  const requested = params.get("tab") as Tab | null;
  const [override, setOverride] = useState<Tab | null>(null);
  const fromUrl = requested && TABS.some((t) => t.key === requested) ? requested : null;
  const tab: Tab = fromUrl ?? override ?? "setup";

  const settings = usePolling<{ defs: SettingDef[]; values: SettingValue[] }>(
    "/api/settings",
    0,
  );

  const select = (next: Tab) => {
    setOverride(next);
    router.replace(`/settings?tab=${next}`, { scroll: false });
  };

  const group = (key: "providers" | "notifications" | "behaviour" | "fleet") =>
    settings.data ? (
      <SettingsGroup
        group={key}
        defs={settings.data.defs}
        values={settings.data.values}
        onSaved={() => settings.refresh()}
      />
    ) : (
      <p className="t-sm dimmer">{settings.error ?? "Loading settings…"}</p>
    );

  return (
    <div className="page-pad">
      <div className="page-head">
        <div className="grow">
          <h1 className="t-display">Settings</h1>
          <p>
            Everything this install runs on: the models it thinks with, where it pages you, what new
            automations inherit, and who can change it.
          </p>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Tabs label="Settings sections" value={tab} onChange={select} options={TABS} />
      </div>

      {tab === "setup" ? <SetupPanel /> : null}
      {tab === "providers" ? group("providers") : null}
      {tab === "notifications" ? group("notifications") : null}
      {tab === "behaviour" ? group("behaviour") : null}
      {tab === "fleet" ? group("fleet") : null}
      {tab === "secrets" ? <SecretsPanel /> : null}
      {tab === "node-types" ? <NodeTypesPanel /> : null}
      {tab === "people" ? <PeoplePanel /> : null}
    </div>
  );
}
