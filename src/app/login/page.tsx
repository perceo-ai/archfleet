"use client";

import Image from "next/image";
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
    <main className="grid-lines relative grid min-h-screen place-items-center overflow-hidden bg-[#312F2F] px-4 text-white">
      <div className="dot-pattern dot-pattern-fade z-0" aria-hidden="true" />
      <form onSubmit={submit} className="glass glass-border relative z-10 w-full max-w-sm rounded-[5px] p-6">
        <div className="mb-5 flex items-center gap-3">
          <Image src="/perceo-logo.png" alt="" width={32} height={32} className="rounded-[6px]" />
          <div>
            <h1 className="font-serif text-xl font-bold italic tracking-tight">Archfleet</h1>
            <p className="text-xs text-white/45">Sign in to continue</p>
          </div>
        </div>

        {useToken ? (
          <label className="block text-xs font-medium text-white/60">
            Bootstrap token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
              className="mt-1 h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white outline-none focus:border-[#8b5cf6]"
            />
          </label>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-white/60">
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                className="mt-1 h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white outline-none focus:border-[#8b5cf6]"
              />
            </label>
            <label className="block text-xs font-medium text-white/60">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white outline-none focus:border-[#8b5cf6]"
              />
            </label>
          </div>
        )}

        {error ? <p className="mt-3 rounded-[5px] border border-[#f87171]/30 bg-[#f87171]/20 px-2 py-1 text-xs text-[#fca5a5]">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="perceo-primary mt-4 h-9 w-full rounded-[5px] px-3 text-sm font-semibold disabled:opacity-60"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => setUseToken((v) => !v)}
          className="mt-3 w-full text-center text-xs text-white/45 hover:text-white"
        >
          {useToken ? "Use username and password" : "Use bootstrap token"}
        </button>
      </form>
    </main>
  );
}
