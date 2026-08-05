"use client";

import { useState } from "react";
import { KeyRound, Plus, SlidersHorizontal, Webhook } from "lucide-react";
import type { Secret, WorkflowParam } from "@/lib/fleet/types";

type SecretsParamsPanelProps = {
  params: WorkflowParam[];
  secrets: Secret[];
  workflowId: string;
};

export function SecretsParamsPanel({ params, secrets, workflowId }: SecretsParamsPanelProps) {
  const [names, setNames] = useState<string[]>(secrets.map((s) => s.name));
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
    <section className="border-t border-zinc-200 bg-white">
      <div className="grid gap-0 md:grid-cols-2">
        <div className="border-b border-zinc-200 p-4 md:border-r md:border-b-0">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-zinc-700" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-zinc-950">Params &amp; Triggers</h2>
            </div>
            <button
              type="button"
              onClick={createWebhook}
              className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50"
            >
              <Webhook className="h-3 w-3" aria-hidden="true" />
              New webhook
            </button>
          </div>
          <div className="space-y-2">
            {params.map((param) => (
              <div
                key={param.id}
                className="grid grid-cols-[120px_1fr_80px] items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-xs"
              >
                <span className="font-medium text-zinc-800">{param.name}</span>
                <span className="truncate font-mono text-zinc-600">{String(param.value)}</span>
                <span className="text-right text-zinc-400">{param.scope}</span>
              </div>
            ))}
          </div>
          {note ? <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">{note}</p> : null}
        </div>

        <div className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-zinc-700" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-zinc-950">Secrets</h2>
          </div>
          <div className="space-y-2">
            {names.map((name) => (
              <div
                key={name}
                className="grid grid-cols-[120px_1fr_80px] items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-xs"
              >
                <span className="font-medium text-zinc-800">{name}</span>
                <span className="font-mono text-zinc-600">[REDACTED]</span>
                <span className="text-right text-zinc-400">workflow</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="name"
              className="w-24 rounded border border-zinc-200 px-1.5 py-1 text-xs"
            />
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              type="password"
              className="flex-1 rounded border border-zinc-200 px-1.5 py-1 text-xs"
            />
            <button
              type="button"
              onClick={createSecret}
              className="inline-flex items-center gap-1 rounded bg-zinc-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-zinc-800"
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
