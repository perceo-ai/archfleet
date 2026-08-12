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
    <main className="min-h-screen bg-[#f7f4ef] text-zinc-950">
      <header className="border-b border-stone-200 bg-[#fbfaf7]">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div>
            <h1 className="text-base font-semibold">User management</h1>
            <p className="text-xs text-zinc-500">Create accounts for people you want to share Archfleet with.</p>
          </div>
          <Link href="/" className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs font-semibold">
            Back
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-md border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Add user</h2>
          <div className="mt-4 space-y-3">
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" className="h-9 w-full rounded-md border border-stone-300 px-2 text-sm" />
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="display name" className="h-9 w-full rounded-md border border-stone-300 px-2 text-sm" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="temporary password" className="h-9 w-full rounded-md border border-stone-300 px-2 text-sm" />
            <select value={role} onChange={(e) => setRole(e.target.value as User["role"])} className="h-9 w-full rounded-md border border-stone-300 px-2 text-sm">
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
            <button type="button" onClick={() => void create()} className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create user
            </button>
          </div>
          {note ? <p className="mt-3 rounded-sm bg-amber-50 px-2 py-1 text-xs text-amber-900">{note}</p> : null}
        </div>

        <div className="rounded-md border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-4 py-3 text-sm font-semibold">Users</div>
          <div className="divide-y divide-stone-200">
            {users.map((user) => (
              <div key={user.id} className="grid grid-cols-[1fr_100px_auto] items-center gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{user.displayName || user.username}</div>
                  <div className="text-xs text-zinc-500">{user.username}</div>
                </div>
                <span className="rounded-sm border border-stone-200 bg-[#f7f4ef] px-2 py-1 text-center text-xs text-zinc-700">
                  {user.role}
                </span>
                <button type="button" onClick={() => void remove(user.id)} title="Delete user" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 text-zinc-700 hover:bg-stone-50">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            {!users.length ? <div className="px-4 py-6 text-sm text-zinc-500">No users yet.</div> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
