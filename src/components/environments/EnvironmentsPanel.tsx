"use client";

// Environments, capacity and secrets used to be three top-level ideas for one
// thing: "a desktop that is ready to do this work". They are one page now —
// environments are the object, the machines under them are a tab.

import { useState } from "react";
import { KeyRound, Monitor, Plus, RefreshCw } from "lucide-react";
import { sendJson, usePolling } from "@/lib/ui/api";
import { timeAgo } from "@/lib/ui/format";
import {
  environmentHealthTone,
  statusLabel,
  vmStatusTone,
} from "@/components/fleet/status-colors";
import { ProfileSetupPanel } from "@/components/fleet/ProfileSetupPanel";
import { Drawer } from "@/components/ui/Overlay";
import { Viewport } from "@/components/ui/Viewport";
import {
  Banner,
  Card,
  CardHead,
  Chip,
  Empty,
  Field,
  Meter,
  Pill,
  Stat,
  Tabs,
} from "@/components/ui/primitives";
import type { FleetVm, PreparedEnvironment } from "@/lib/fleet/types";

type Tab = "environments" | "capacity";

type ProfileStatus = {
  profiles: Record<
    string,
    { ready: boolean; vms: { vmId: string; state: string; snapshot: string; snapshotPresent: boolean; ready: boolean }[] }
  >;
  vmCount: number;
};

type Health = {
  queuedRuns: number;
  metrics?: { runs: number; avgQueuedMs?: number; avgExecutionMs?: number };
};

const splitList = (raw: string) =>
  raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** "ops@example.com @ portal.example.com" or just "portal.example.com". */
function parseAccounts(raw: string): { site: string; username?: string }[] {
  return splitList(raw).map((entry) => {
    const [left, right] = entry.split("@@").length > 1 ? entry.split("@@") : entry.split(" @ ");
    return right ? { site: right.trim(), username: left.trim() } : { site: entry };
  });
}

const asMinSec = (ms: number | undefined) =>
  ms == null ? "—" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;

export function EnvironmentsPanel({ initialTab = "environments" }: { initialTab?: Tab }) {
  const environments = usePolling<PreparedEnvironment[]>("/api/environments?live=1", 30000);
  const vms = usePolling<FleetVm[]>("/api/vms", 8000);
  const profiles = usePolling<ProfileStatus>("/api/profile-status", 30000);
  const health = usePolling<Health>("/api/health", 30000);

  const [tab, setTab] = useState<Tab>(initialTab);
  const [prepOpen, setPrepOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accounts, setAccounts] = useState("");
  const [deviceTrust, setDeviceTrust] = useState("");
  const [mfaExpectations, setMfaExpectations] = useState("");
  const [profileRef, setProfileRef] = useState("");


  const list = environments.data ?? [];
  const vmList = vms.data ?? [];
  const online = vmList.filter((v) => v.status !== "stopped" && v.status !== "unhealthy");
  const busy = vmList.filter((v) => v.status === "running" || v.status === "assigned");
  const needsAttention = list.filter((e) => e.health === "degraded" || e.health === "recovering");

  /** Desktops backing an environment, via its `profile:<slug>` fleet label. */
  const desktopsFor = (profileRef: string | undefined) => {
    if (!profileRef) return { total: 0, busy: 0 };
    const mine = vmList.filter((v) => v.labels.includes(`profile:${profileRef}`));
    return {
      total: mine.length,
      busy: mine.filter((v) => v.status === "running" || v.status === "assigned").length,
    };
  };

  async function createEnvironment() {
    setMessage(null);
    const state = {
      accounts: parseAccounts(accounts),
      deviceTrust: splitList(deviceTrust),
      mfaExpectations: splitList(mfaExpectations),
    };
    try {
      await sendJson("/api/environments", "POST", {
        name,
        description,
        profileRef: profileRef || undefined,
        labels: profileRef
          ? ["linux-desktop", "browser", `profile:${profileRef}`]
          : ["linux-desktop", "browser"],
        state:
          state.accounts.length || state.deviceTrust.length || state.mfaExpectations.length
            ? state
            : undefined,
      });
      setName("");
      setDescription("");
      setAccounts("");
      setDeviceTrust("");
      setMfaExpectations("");
      setProfileRef("");
      setPrepOpen(false);
      await environments.refresh();
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function openDesktop(vm: FleetVm) {
    setMessage(null);
    try {
      const res = await sendJson<{ mode: string; launchUrl?: string; downloadUrl?: string }>(
        `/api/vms/${vm.id}/takeover`,
        "POST",
      );
      if (res.mode === "guacamole" && res.launchUrl) window.open(res.launchUrl, "_blank");
      else if (res.downloadUrl) window.open(res.downloadUrl, "_blank");
    } catch (e) {
      setMessage(String(e));
    }
  }

  return (
    <div className="page-pad wide">
      <div className="page-head">
        <div className="grow">
          <h1 className="t-display">Environments</h1>
          <p>
            A desktop that is already signed in, trusted, and ready for a kind of work. Automations
            pick one; the machines underneath are capacity, not something you name.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => setPrepOpen(true)}>
          <Plus className="ico" aria-hidden="true" />
          Prepare an environment
        </button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Tabs
          label="Environment views"
          value={tab}
          onChange={setTab}
          options={[
            { key: "environments", label: "Environments", count: list.length },
            { key: "capacity", label: "Capacity", count: vmList.length },
          ]}
        />
      </div>

      {message ? (
        <p className="t-sm" style={{ color: "var(--danger)", marginBottom: 12 }}>
          {message}
        </p>
      ) : null}

      {tab === "environments" ? (
        <div className="stack">
          {needsAttention.length > 0 ? (
            <Banner
              tone="warn"
              title={`${needsAttention.length} ${needsAttention.length === 1 ? "environment needs" : "environments need"} attention`}
            >
              {needsAttention.map((e) => e.name).join(", ")} — runs will fail on login until the session
              is re-captured.
            </Banner>
          ) : null}

          {list.length === 0 ? (
            <Card>
              <Empty>No environments yet. Prepare one to give automations a logged-in desktop.</Empty>
            </Card>
          ) : (
            <div className="grid-2">
              {list.map((env) => {
                const desktops = desktopsFor(env.profileRef);
                return (
                <Card key={env.id}>
                  <CardHead
                    title={env.name}
                    subtitle={env.description}
                    right={
                      <Pill tone={environmentHealthTone(env.health)}>{statusLabel(env.health)}</Pill>
                    }
                  />
                  <div className="card-body stack-s">
                    <div className="hstack-w">
                      {(env.state?.accounts ?? []).map((a) => (
                        <Chip key={`${a.site}-${a.username ?? ""}`}>
                          <KeyRound className="ico" aria-hidden="true" />
                          {a.username ? `${a.username} @ ` : ""}
                          {a.site}
                        </Chip>
                      ))}
                      {(env.state?.deviceTrust ?? []).map((site) => (
                        <Chip key={site}>trusted: {site}</Chip>
                      ))}
                      {(env.state?.mfaExpectations ?? []).map((m) => (
                        <Chip key={m}>can interrupt: {m}</Chip>
                      ))}
                      {env.state?.browser ? <Chip>{env.state.browser}</Chip> : null}
                    </div>
                    {desktops.total > 0 ? (
                      <>
                        <div className="hstack" style={{ marginTop: 4 }}>
                          <span className="t-xs faint grow">Desktops in use</span>
                          <span className="t-xs t-num dim">
                            {desktops.busy} of {desktops.total}
                          </span>
                        </div>
                        <Meter
                          value={(desktops.busy / desktops.total) * 100}
                          tone={desktops.busy / desktops.total > 0.85 ? "warn" : undefined}
                        />
                      </>
                    ) : null}
                    <div className="t-xs faint">
                      last used {timeAgo(env.lastUsedAt)}
                      {env.recoveryState ? ` · ${env.recoveryState}` : ""}
                      {env.profileRef ? ` · profile ${env.profileRef}` : ""}
                    </div>
                  </div>
                  <div className="card-foot hstack-w">
                    {(() => {
                      const vm = vmList.find(
                        (v) => env.profileRef && v.labels.includes(`profile:${env.profileRef}`),
                      );
                      return vm ? (
                        <button type="button" className="btn btn-sm" onClick={() => void openDesktop(vm)}>
                          <Monitor className="ico" aria-hidden="true" />
                          Open a desktop
                        </button>
                      ) : null;
                    })()}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        void environments.refresh();
                        void profiles.refresh();
                      }}
                    >
                      <RefreshCw className="ico" aria-hidden="true" />
                      Re-check health
                    </button>
                    <div className="spacer" />
                    <span className="t-xs faint">
                      {desktops.total > 0 ? `${desktops.total} desktops` : "no desktops yet"}
                    </span>
                  </div>
                </Card>
                );
              })}
            </div>
          )}

          <Card>
            <CardHead
              title="Preparation"
              subtitle="Golden build, manual login, capture, clones — the flow that produces the desktops above."
            />
            <div className="card-body">
              <ProfileSetupPanel />
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "capacity" ? (
        <div className="stack">
          <div className="stats">
            <Stat value={vmList.length} label="Desktops" />
            <Stat value={online.length} label="Online" />
            <Stat value={busy.length} label="Busy" />
            <Stat value={health.data?.queuedRuns ?? "—"} label="Queued runs" />
            <Stat value={asMinSec(health.data?.metrics?.avgQueuedMs)} label="Avg wait (24h)" />
            <Stat value={asMinSec(health.data?.metrics?.avgExecutionMs)} label="Avg run (24h)" />
          </div>

          <Card>
            <CardHead
              title="Desktops"
              subtitle="Operator view — normal users never need this tab."
              right={
                <button type="button" className="btn btn-sm" onClick={() => void vms.refresh()}>
                  <RefreshCw className="ico" aria-hidden="true" />
                  Refresh
                </button>
              }
            />
            {vmList.length === 0 ? (
              <Empty>
                No desktops configured. Set CUF_GOLDEN_DOMAIN / CUF_FLEET_JSON, or build one from the
                preparation flow.
              </Empty>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Desktop</th>
                    <th>State</th>
                    <th>Doing</th>
                    <th className="num">Health</th>
                    <th className="num" />
                  </tr>
                </thead>
                <tbody>
                  {vmList.map((vm) => (
                    <tr key={vm.id}>
                      <td>
                        <div className="row-title">{vm.name}</div>
                        <div className="t-xs faint mono">
                          {vm.domain ?? "mock"} · {vm.xrdp.host}:{vm.xrdp.port}
                        </div>
                      </td>
                      <td>
                        <Pill tone={vmStatusTone(vm.status)}>{statusLabel(vm.status)}</Pill>
                      </td>
                      <td className="dim truncate">
                        {vm.assignedRunId ? (
                          <a href={`/runs/${vm.assignedRunId}`}>{vm.assignedRunId}</a>
                        ) : (
                          <span className="faint">{vm.labels.join(", ") || "idle"}</span>
                        )}
                      </td>
                      <td className="num dimmer">{timeAgo(vm.lastHealthAt)}</td>
                      <td className="num">
                        <div className="hstack" style={{ justifyContent: "flex-end" }}>
                          <button type="button" className="btn btn-sm" onClick={() => void openDesktop(vm)}>
                            <Monitor className="ico" aria-hidden="true" />
                            Open
                          </button>
                          <a className="btn btn-sm" href={`/api/vms/${vm.id}/rdp`}>
                            .rdp
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <CardHead
              title="Profile readiness"
              subtitle="Warm snapshots present and domains reachable, per profile."
            />
            <div className="card-body">
              {!profiles.data ? (
                <p className="t-sm faint">
                  {profiles.error ? "Profile status unavailable (libvirt not reachable)." : "Checking…"}
                </p>
              ) : Object.keys(profiles.data.profiles).length === 0 ? (
                <p className="t-sm faint">No profile-labelled desktops.</p>
              ) : (
                <div className="stack-s">
                  {Object.entries(profiles.data.profiles).map(([slug, p]) => (
                    <div className="hstack" key={slug}>
                      <Pill tone={p.ready ? "ok" : "danger"}>{p.ready ? "ready" : "not ready"}</Pill>
                      <span className="strong t-sm">{slug}</span>
                      <span className="t-xs faint truncate">
                        {p.vms
                          .map((v) => `${v.vmId} (${v.state}${v.snapshotPresent ? "" : ", no snapshot"})`)
                          .join(", ")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      ) : null}


      <Drawer
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        width="min(620px, 94vw)"
        title="Prepare an environment"
        subtitle="You only do the signing-in part."
      >
        {/* Three steps, and only the middle one is yours: sign in on a desktop we
            hold. Naming it and cloning it are ours. */}
        <div className="timeline">
          <div className={`tl-item ${name.trim() ? "done" : "active"}`}>
            <div className="tl-title">1 · Name it and say what it&apos;s for</div>
            <div className="tl-meta">Automations pick this name from a list.</div>
            <div className="stack-s" style={{ marginTop: 10 }}>
              <Field label="Name">
                <input
                  className="input"
                  aria-label="Environment name"
                  placeholder="Portal — logged in"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="What it holds">
                <input
                  className="input"
                  aria-label="Environment description"
                  placeholder="Logins, extensions, files"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field label="Logged-in accounts" hint="e.g. ops@acme.com @ portal.acme.com">
                <input
                  className="input"
                  aria-label="Logged-in accounts"
                  value={accounts}
                  onChange={(e) => setAccounts(e.target.value)}
                />
              </Field>
              <Field label="Sites that trust this device" hint="Comma-separated.">
                <input
                  className="input"
                  aria-label="Trusted-device sites"
                  value={deviceTrust}
                  onChange={(e) => setDeviceTrust(e.target.value)}
                />
              </Field>
              <Field label="Where MFA can still appear" hint="Comma-separated.">
                <input
                  className="input"
                  aria-label="MFA expectations"
                  value={mfaExpectations}
                  onChange={(e) => setMfaExpectations(e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className={`tl-item ${name.trim() ? "active" : ""}`}>
            <div className="tl-title">2 · Sign in on the desktop we hold for you</div>
            <div className="tl-meta">
              We open a clean desktop; you log in, pass MFA, tick “trust this device”, then capture.
              Nothing you type is recorded — only the resulting session state is kept.
            </div>
            <div style={{ marginTop: 10 }}>
              <Viewport
                alt="A prepared desktop"
                tag={<Pill tone="accent">your session</Pill>}
                bar={
                  <span className="grow t-sm">
                    {name.trim() ? "Ready when you are." : "Name the environment first."}
                  </span>
                }
              />
            </div>
            <Field
              label="Profile slug"
              hint="Ties this environment to a fleet profile — use the same slug in the capture flow below."
            >
              <input
                className="input"
                aria-label="Profile slug"
                value={profileRef}
                onChange={(e) => setProfileRef(e.target.value)}
              />
            </Field>
          </div>

          <div className="tl-item">
            <div className="tl-title">3 · We clone it into ready desktops</div>
            <div className="tl-meta">
              Usually a few minutes. After that any automation can pick this environment. Run the
              capture and clone stages from the preparation panel on this page.
            </div>
          </div>
        </div>

        <div className="hstack" style={{ marginTop: 18 }}>
          <div className="spacer" />
          <button type="button" className="btn btn-sm" onClick={() => setPrepOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!name.trim()}
            onClick={() => void createEnvironment()}
          >
            Create environment
          </button>
        </div>
      </Drawer>
    </div>
  );
}
