"use client";

import { useState } from "react";
import { WandSparkles } from "lucide-react";

type SetupResponse = {
  workflow?: { id: string; name: string };
  error?: string;
};

export function ProfileSetupPanel() {
  const [profile, setProfile] = useState("");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/profile-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: profile.trim(), task: task.trim(), save: true }),
      });
      const body = (await res.json().catch(() => ({}))) as SetupResponse;
      if (!res.ok || !body.workflow) {
        setMessage(body.error ?? "setup workflow failed");
        return;
      }
      setMessage(body.workflow.id);
    } catch {
      setMessage("setup workflow failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-zinc-200 bg-white px-4 py-3">
      <div className="mb-3 flex items-center gap-2">
        <WandSparkles className="h-4 w-4 text-zinc-700" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-zinc-950">Task Profile Setup</h2>
      </div>
      <div className="grid grid-cols-[160px_minmax(0,1fr)_auto] gap-2">
        <label className="grid gap-1 text-xs font-medium text-zinc-700">
          Profile
          <input
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            placeholder="bank"
            className="h-9 rounded border border-zinc-300 px-2 text-sm text-zinc-950 outline-none focus:border-zinc-500"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-700">
          Task
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Log into the portal and prepare statement download"
            className="h-9 rounded border border-zinc-300 px-2 text-sm text-zinc-950 outline-none focus:border-zinc-500"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !profile.trim() || !task.trim()}
          className="mt-5 h-9 rounded bg-zinc-950 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {busy ? "Creating..." : "Create setup workflow"}
        </button>
      </div>
      {message ? <p className="mt-2 font-mono text-xs text-zinc-600">{message}</p> : null}
    </section>
  );
}
