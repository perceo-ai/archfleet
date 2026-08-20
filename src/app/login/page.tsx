"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/primitives";
import { Logo } from "@/components/ui/Logo";

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
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 16 }}>
      <form onSubmit={submit} className="card" style={{ width: "100%", maxWidth: 380 }}>
        <div className="card-head">
          <Logo size={30} />
          <div className="grow">
            <h2 className="wordmark" style={{ fontSize: 17 }}>
              Archfleet
            </h2>
            <p>Sign in to continue</p>
          </div>
        </div>

        <div className="card-body stack-s">
          {useToken ? (
            <Field label="Bootstrap token">
              <input
                className="input"
                type="password"
                aria-label="Bootstrap token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
            </Field>
          ) : (
            <>
              <Field label="Username">
                <input
                  className="input"
                  aria-label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Password">
                <input
                  className="input"
                  type="password"
                  aria-label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            </>
          )}

          {error ? (
            <p className="t-sm" style={{ color: "var(--danger)", margin: 0 }} role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setUseToken((v) => !v)}
            style={{ width: "100%" }}
          >
            {useToken ? "Use username and password" : "Use a bootstrap token"}
          </button>
        </div>
      </form>
    </main>
  );
}
