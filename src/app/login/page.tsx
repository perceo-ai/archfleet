"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [useToken, setUseToken] = useState(false);
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
        body: JSON.stringify(useToken ? { token } : { username, password }),
      });
      if (res.ok) router.push("/");
      else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Invalid credentials");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f4ef] px-4 text-zinc-950">
      <form onSubmit={submit} className="w-full max-w-sm rounded-md border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-sm bg-zinc-950 text-[11px] font-semibold uppercase text-white">
            pe
          </span>
          <div>
            <h1 className="text-sm font-semibold">Perceo Archfleet</h1>
            <p className="text-xs text-zinc-500">Sign in to continue</p>
          </div>
        </div>

        {useToken ? (
          <label className="block text-xs font-medium text-zinc-600">
            Bootstrap token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
              className="mt-1 h-9 w-full rounded-md border border-stone-300 px-2 text-sm outline-none focus:border-zinc-500"
            />
          </label>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-zinc-600">
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                className="mt-1 h-9 w-full rounded-md border border-stone-300 px-2 text-sm outline-none focus:border-zinc-500"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-stone-300 px-2 text-sm outline-none focus:border-zinc-500"
              />
            </label>
          </div>
        )}

        {error ? <p className="mt-3 rounded-sm bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 h-9 w-full rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => setUseToken((v) => !v)}
          className="mt-3 w-full text-center text-xs text-zinc-500 hover:text-zinc-900"
        >
          {useToken ? "Use username and password" : "Use bootstrap token"}
        </button>
      </form>
    </main>
  );
}
