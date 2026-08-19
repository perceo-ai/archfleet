"use client";

// Settings: people and API tokens. Same design system as the rest of the app —
// it used to be the one page still wearing the old skin.

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { sendJson, usePolling } from "@/lib/ui/api";
import { Card, CardHead, Chip, Empty, Field, StaleNotice, Tabs } from "@/components/ui/primitives";
import { NodeTypesPanel } from "@/components/settings/NodeTypesPanel";

type Role = "admin" | "operator" | "viewer";

type User = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt: string;
};

const ROLES: Role[] = ["operator", "viewer", "admin"];

type SettingsTab = "people" | "node-types";

export default function UsersPage() {
  const [tab, setTab] = useState<SettingsTab>("people");
  const users = usePolling<User[]>("/api/users", 30000);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [note, setNote] = useState<string>();

  const [tokenName, setTokenName] = useState("");
  const [tokenRole, setTokenRole] = useState<Role>("operator");
  const [ttlDays, setTtlDays] = useState(90);
  const [apiToken, setApiToken] = useState<{ token: string; expiresAt: string }>();

  const list = users.data ?? [];

  async function create() {
    setNote(undefined);
    try {
      await sendJson("/api/users", "POST", { username, displayName, password, role });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setNote("User created.");
      await users.refresh();
    } catch (e) {
      setNote(String(e));
    }
  }

  async function remove(id: string) {
    setNote(undefined);
    try {
      await sendJson(`/api/users?id=${encodeURIComponent(id)}`, "DELETE");
      await users.refresh();
    } catch (e) {
      setNote(String(e));
    }
  }

  async function createToken() {
    setNote(undefined);
    setApiToken(undefined);
    try {
      const body = await sendJson<{ token: string; expiresAt: string }>("/api/tokens", "POST", {
        name: tokenName || "automation-api",
        role: tokenRole,
        ttlDays,
      });
      setApiToken(body);
      setTokenName("");
      setNote("Token created — copy it now, it is shown once.");
    } catch (e) {
      setNote(String(e));
    }
  }

  return (
    <div className="page-pad">
      <div className="page-head">
        <div className="grow">
          <h1 className="t-display">Settings</h1>
          <p>Who can use Archfleet, the tokens that call it, and the node types your automations can use.</p>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <Tabs
          label="Settings sections"
          value={tab}
          onChange={setTab}
          options={[
            { key: "people", label: "People & tokens" },
            { key: "node-types", label: "Node types" },
          ]}
        />
      </div>

      {tab === "node-types" ? <NodeTypesPanel /> : null}

      {tab === "people" ? (
        <>
      <StaleNotice error={users.error} onRetry={() => void users.refresh()} />
      {note ? (
        <p className="t-sm" style={{ color: "var(--text-2)", marginBottom: 12 }} role="status">
          {note}
        </p>
      ) : null}

      <div className="grid-2" style={{ alignItems: "start" }}>
        <Card>
          <CardHead title="People" subtitle={`${list.length} with access`} />
          {list.length === 0 ? (
            <Empty>No users yet — add the first one on the right.</Empty>
          ) : (
            <div className="rows">
              {list.map((user) => (
                <div className="row" key={user.id}>
                  <div className="grow">
                    <div className="row-title">{user.displayName || user.username}</div>
                    <div className="row-sub">{user.username}</div>
                  </div>
                  <Chip>{user.role}</Chip>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={`Remove ${user.username}`}
                    onClick={() => void remove(user.id)}
                  >
                    <Trash2 className="ico" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="stack">
          <Card>
            <CardHead title="Add someone" />
            <div className="card-body stack-s">
              <Field label="Username">
                <input
                  className="input"
                  aria-label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>
              <Field label="Display name">
                <input
                  className="input"
                  aria-label="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </Field>
              <Field label="Temporary password" hint="They should change it after first sign-in.">
                <input
                  className="input"
                  type="password"
                  aria-label="Temporary password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Role">
                <select
                  className="select"
                  aria-label="Role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!username.trim() || !password}
                onClick={() => void create()}
              >
                <Plus className="ico" aria-hidden="true" />
                Create user
              </button>
            </div>
          </Card>

          <Card>
            <CardHead
              title="API token"
              subtitle="A bearer token for scripts, webhooks or agents that call Archfleet."
            />
            <div className="card-body stack-s">
              <Field label="Name">
                <input
                  className="input"
                  aria-label="Token name"
                  placeholder="automation-api"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                />
              </Field>
              <div className="grid-2">
                <Field label="Role">
                  <select
                    className="select"
                    aria-label="Token role"
                    value={tokenRole}
                    onChange={(e) => setTokenRole(e.target.value as Role)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Expires in (days)">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={365}
                    aria-label="Token lifetime in days"
                    value={ttlDays}
                    onChange={(e) => setTtlDays(Number(e.target.value))}
                  />
                </Field>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void createToken()}>
                <Plus className="ico" aria-hidden="true" />
                Create token
              </button>
              {apiToken ? (
                <div
                  className="stack-s"
                  style={{
                    padding: 10,
                    borderRadius: "var(--radius)",
                    background: "var(--ok-dim)",
                    border: "1px solid var(--ok-line)",
                  }}
                >
                  <span className="t-xs" style={{ color: "var(--ok)" }}>
                    Shown once · expires {new Date(apiToken.expiresAt).toLocaleDateString()}
                  </span>
                  <code className="mono" style={{ wordBreak: "break-all" }}>
                    {apiToken.token}
                  </code>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
        </>
      ) : null}
    </div>
  );
}
