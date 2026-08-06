"use client";

import { useState } from "react";

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        setError("Invalid token");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-100 text-zinc-950">
      <form onSubmit={submit} className="w-80 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-950 text-xs font-bold text-white">
            af
          </span>
          <h1 className="text-sm font-semibold">archfleet</h1>
        </div>
        <label className="block text-xs text-zinc-500">Access token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoFocus
          className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
        />
        {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded bg-zinc-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {busy ? "…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
