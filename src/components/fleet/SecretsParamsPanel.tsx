"use client";

import { useEffect, useState } from "react";
import { KeyRound, Plus, SlidersHorizontal, Webhook } from "lucide-react";
import type { Secret, WorkflowParam } from "@/lib/fleet/types";

type SecretsParamsPanelProps = {
  params: WorkflowParam[];
  secrets: Secret[];
  workflowId: string;
};

export function SecretsParamsPanel({ params, secrets, workflowId }: SecretsParamsPanelProps) {
  const [names, setNames] = useState<string[]>(secrets.map((s) => s.name));
  useEffect(() => {
    // Merge in persisted secret names (metadata only — never values).
    void fetch("/api/secrets")
      .then((r) => (r.ok ? r.json() : []))
      .then((meta: { name: string }[]) =>
        setNames((n) => [...new Set([...n, ...meta.map((m) => m.name)])]),
      )
      .catch(() => {});
  }, []);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [note, setNote] = useState<string>();

  async function createSecret() {
    if (!newName || !newValue) return;
    const res = await fetch("/api/secrets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName, scope: "workflow", value: newValue }),
    });
    if (res.ok) {
      setNames((n) => [...new Set([...n, newName])]);
      setNewName("");
      setNewValue("");
      setNote("Secret saved (encrypted).");
    } else {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setNote(b.error ?? "Failed (set CUF_SECRET_KEY).");
    }
  }

  async function createWebhook() {
    const res = await fetch("/api/triggers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflowId, type: "webhook" }),
    });
    const b = (await res.json().catch(() => ({}))) as { webhookToken?: string };
    setNote(b.webhookToken ? `Webhook token (shown once): ${b.webhookToken}` : "Webhook created.");
  }

  return (
    <section className="bg-[#232323]/70">
      <div className="grid gap-px bg-white/[0.08] lg:grid-cols-2">
        <div className="bg-[#232323]/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-[#8b5cf6]" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-white">Params &amp; Triggers</h2>
            </div>
            <button
              type="button"
              onClick={createWebhook}
              className="inline-flex h-8 items-center gap-1 rounded-[5px] border border-white/[0.08] px-2 text-[11px] font-semibold text-white/75 hover:bg-white/[0.08]"
            >
              <Webhook className="h-3 w-3" aria-hidden="true" />
              New webhook
            </button>
          </div>
          <div className="space-y-2">
            {params.length ? (
              params.map((param) => (
                <div
                  key={param.id}
                  className="grid grid-cols-[120px_1fr_80px] items-center gap-2 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-1.5 text-xs"
                >
                  <span className="font-medium text-white">{param.name}</span>
                  <span className="truncate font-mono text-white/60">{String(param.value)}</span>
                  <span className="text-right text-white/35">{param.scope}</span>
                </div>
              ))
            ) : (
              <div className="rounded-[5px] border border-dashed border-white/[0.12] p-3 text-xs text-white/45">
                No workflow params yet.
              </div>
            )}
          </div>
          {note ? <p className="mt-2 break-all font-mono text-[11px] text-white/45">{note}</p> : null}
        </div>

        <div className="bg-[#161616]/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[#8b5cf6]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-white">Secrets</h2>
          </div>
          <div className="space-y-2">
            {names.length ? (
              names.map((name) => (
                <div
                  key={name}
                  className="grid grid-cols-[120px_1fr_80px] items-center gap-2 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-1.5 text-xs"
                >
                  <span className="font-medium text-white">{name}</span>
                  <span className="font-mono text-white/60">[REDACTED]</span>
                  <span className="text-right text-white/35">workflow</span>
                </div>
              ))
            ) : (
              <div className="rounded-[5px] border border-dashed border-white/[0.12] bg-white/[0.05] p-3 text-xs text-white/45">
                Add an encrypted workflow secret.
              </div>
            )}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr_auto]">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="name"
              aria-label="Secret name"
              className="h-8 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-xs text-white outline-none placeholder:text-white/30 focus:border-[#8b5cf6]"
            />
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              type="password"
              aria-label="Secret value"
              className="h-8 rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-xs text-white outline-none placeholder:text-white/30 focus:border-[#8b5cf6]"
            />
            <button
              type="button"
              onClick={createSecret}
              className="perceo-primary inline-flex h-8 items-center justify-center gap-1 rounded-[5px] px-3 text-[11px] font-semibold"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              Add
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
