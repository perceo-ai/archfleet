"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";

type User = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "operator" | "viewer";
  createdAt: string;
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<User["role"]>("operator");
  const [note, setNote] = useState<string>();

  async function refresh() {
    const res = await fetch("/api/users");
    if (res.ok) setUsers((await res.json()) as User[]);
    else setNote("Admin access required.");
  }

  async function create() {
    setNote(undefined);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, displayName, password, role }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setNote(body.error ?? "Could not create user.");
      return;
    }
    setUsername("");
    setDisplayName("");
    setPassword("");
    setNote("User created.");
    await refresh();
  }

  async function remove(id: string) {
    setNote(undefined);
    const res = await fetch(`/api/users?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setNote(body.error ?? "Could not delete user.");
      return;
    }
    await refresh();
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="grid-lines min-h-screen bg-[#312F2F] text-white">
      <header className="border-b border-white/[0.08] bg-[#312f2f]/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div>
            <h1 className="text-base font-semibold">User management</h1>
            <p className="text-xs text-white/45">Create accounts for people you want to share Archfleet with.</p>
          </div>
          <Link href="/" className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-xs font-semibold hover:bg-white/[0.08]">
            Back
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="glass glass-border rounded-[5px] p-4">
          <h2 className="text-sm font-semibold">Add user</h2>
          <div className="mt-4 space-y-3">
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" className="h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white placeholder:text-white/30" />
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="display name" className="h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white placeholder:text-white/30" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="temporary password" className="h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white placeholder:text-white/30" />
            <select value={role} onChange={(e) => setRole(e.target.value as User["role"])} className="h-9 w-full rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-white">
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
            <button type="button" onClick={() => void create()} className="perceo-primary inline-flex h-9 items-center gap-2 rounded-[5px] px-3 text-sm font-semibold">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create user
            </button>
          </div>
          {note ? <p className="mt-3 rounded-[5px] border border-[#8b5cf6]/30 bg-[#8b5cf6]/20 px-2 py-1 text-xs text-[#c4b5fd]">{note}</p> : null}
        </div>

        <div className="glass glass-border rounded-[5px]">
          <div className="border-b border-white/[0.08] px-4 py-3 text-sm font-semibold">Users</div>
          <div className="divide-y divide-white/[0.08]">
            {users.map((user) => (
              <div key={user.id} className="grid grid-cols-[1fr_100px_auto] items-center gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{user.displayName || user.username}</div>
                  <div className="text-xs text-white/45">{user.username}</div>
                </div>
                <span className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-center text-xs text-white/70">
                  {user.role}
                </span>
                <button type="button" onClick={() => void remove(user.id)} title="Delete user" className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-white/[0.08] text-white/70 hover:bg-white/[0.08]">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            {!users.length ? <div className="px-4 py-6 text-sm text-white/45">No users yet.</div> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
