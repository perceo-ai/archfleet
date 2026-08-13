"use client";

// Prepared environments: the user-facing wrapper over fleet profiles — a reusable
// desktop that is already logged in / trusted, ready to run a kind of automation.
// Preparation itself (golden VM build, capture, clones) runs through the existing
// profile-ops flow embedded below.

import { useState } from "react";
import { sendJson, usePolling } from "@/lib/ui/api";
import { timeAgo } from "@/lib/ui/format";
import { environmentHealthTone, statusLabel } from "@/components/fleet/status-colors";
import { ProfileSetupPanel } from "@/components/fleet/ProfileSetupPanel";
import type { PreparedEnvironment } from "@/lib/fleet/types";

const inputCls =
  "rounded-[5px] border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]/50";

export function EnvironmentsPanel() {
  const environments = usePolling<PreparedEnvironment[]>("/api/environments", 10000);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profileRef, setProfileRef] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function createEnvironment() {
    setMessage(null);
    try {
      await sendJson("/api/environments", "POST", {
        name,
        description,
        profileRef: profileRef || undefined,
        labels: profileRef ? ["linux-desktop", "browser", `profile:${profileRef}`] : ["linux-desktop", "browser"],
      });
      setName("");
      setDescription("");
      setProfileRef("");
      await environments.refresh();
    } catch (e) {
      setMessage(String(e));
    }
  }

  const list = environments.data ?? [];

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-6 md:px-12">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Prepared environments</h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-400">
        A prepared environment is a reusable desktop with browser state, logins, and device trust
        already in place — the answer to repeated MFA. Automations pick one to run on.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_360px]">
        <section className="glass glass-border rounded-[5px]">
          <div className="border-b border-white/[0.08] px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Environments</h2>
          </div>
          <div className="divide-y divide-white/[0.08]">
            {list.length === 0 ? (
              <p className="px-4 py-8 text-sm text-white/45">No environments yet — create one on the right.</p>
            ) : (
              list.map((env) => (
                <div key={env.id} className="grid gap-2 px-4 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-base font-semibold text-white">{env.name}</h3>
                    <span className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${environmentHealthTone(env.health)}`}>
                      {statusLabel(env.health)}
                    </span>
                  </div>
                  {env.description ? <p className="text-sm text-zinc-400">{env.description}</p> : null}
                  <div className="flex flex-wrap gap-2 text-xs text-white/55">
                    {env.profileRef ? (
                      <span className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-0.5">
                        profile: {env.profileRef}
                      </span>
                    ) : null}
                    {env.snapshotState ? (
                      <span className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-0.5">
                        snapshot: {env.snapshotState}
                      </span>
                    ) : null}
                    <span>last used {timeAgo(env.lastUsedAt)}</span>
                    {env.recoveryState ? <span className="text-[#c4b5fd]">{env.recoveryState}</span> : null}
                  </div>
                  {env.setupNotes ? <p className="text-xs text-white/40">{env.setupNotes}</p> : null}
                </div>
              ))
            )}
          </div>
        </section>

        <aside className="grid content-start gap-3">
          <section className="glass rounded-[5px] p-4">
            <h2 className="text-sm font-semibold text-white">New environment</h2>
            <div className="mt-3 grid gap-2">
              <input
                aria-label="Environment name"
                className={inputCls}
                placeholder="Name (e.g. Portal — logged in)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                aria-label="Environment description"
                className={inputCls}
                placeholder="What state does it hold? (logins, extensions, files)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <input
                aria-label="Profile slug"
                className={inputCls}
                placeholder="Profile slug (optional, e.g. portal)"
                value={profileRef}
                onChange={(e) => setProfileRef(e.target.value)}
              />
              <button
                type="button"
                disabled={!name.trim()}
                onClick={() => void createEnvironment()}
                className="perceo-primary inline-flex h-9 items-center justify-center rounded-[5px] px-3 text-xs font-semibold disabled:opacity-50"
              >
                Create environment
              </button>
              {message ? <p className="text-xs text-[#fca5a5]">{message}</p> : null}
            </div>
          </section>
          <section className="glass rounded-[5px] p-4 text-xs leading-5 text-white/50">
            Preparing the underlying VM (golden build, manual login, capture, clones) happens in the
            setup flow below. Use the same profile slug so the environment maps to it.
          </section>
        </aside>
      </div>

      <section className="mt-6">
        <ProfileSetupPanel />
      </section>
    </main>
  );
}
