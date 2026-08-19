"use client";

// Secrets. They used to live under Environments, which is where they are *used*
// but not where you go to manage them — configuration belongs in one place.

import { useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { sendJson, usePolling } from "@/lib/ui/api";
import { Card, CardHead, Chip, Empty, Field, StaleNotice } from "@/components/ui/primitives";

type SecretMeta = { id?: string; name: string; scope: string };

export function SecretsPanel() {
  const secrets = usePolling<SecretMeta[]>("/api/secrets", 30000);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState("workflow");
  const [note, setNote] = useState<string>();

  const list = secrets.data ?? [];
  // Provider keys are stored as secrets too; they belong on their own tab.
  const visible = list.filter((s) => !s.name.startsWith("provider.") && !s.name.startsWith("notify."));

  async function create() {
    setNote(undefined);
    try {
      await sendJson("/api/secrets", "POST", { name, scope, value });
      setName("");
      setValue("");
      setNote(`Saved "${name}" — encrypted at rest, and redacted from every log.`);
      await secrets.refresh();
    } catch (e) {
      setNote(String(e));
    }
  }

  return (
    <div className="stack">
      <StaleNotice error={secrets.error} onRetry={() => void secrets.refresh()} />
      {note ? (
        <p className="t-sm" style={{ color: "var(--text-2)" }} role="status">
          {note}
        </p>
      ) : null}

      <div className="grid-2" style={{ alignItems: "start" }}>
        <Card>
          <CardHead
            title="Secrets"
            subtitle="Write-only. Values are injected at run time and never come back to the browser."
          />
          {visible.length === 0 ? (
            <Empty>
              None yet. A step references one as <code className="mono">{"{{secret.name}}"}</code>.
            </Empty>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scope</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.name}>
                    <td className="mono">{s.name}</td>
                    <td>
                      <Chip>{s.scope}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardHead title="Add a secret" />
          <div className="card-body stack-s">
            <Field
              label="Name"
              hint={
                <>
                  Referenced as <code className="mono">{"{{secret.name}}"}</code>, or{" "}
                  <code className="mono">{"{{totp.name}}"}</code> when the value is an authenticator
                  seed.
                </>
              }
            >
              <input
                className="input mono"
                aria-label="Secret name"
                placeholder="portal_password"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Value">
              <input
                className="input"
                type="password"
                aria-label="Secret value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <Field label="Scope" hint="Global secrets are available to every automation.">
              <select
                className="select"
                aria-label="Secret scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="workflow">This fleet&apos;s automations</option>
                <option value="global">Global</option>
              </select>
            </Field>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!name.trim() || !value}
              onClick={() => void create()}
            >
              <Plus className="ico" aria-hidden="true" />
              Save secret
            </button>
            <p className="t-xs faint hstack" style={{ gap: 6, margin: 0 }}>
              <KeyRound className="ico" style={{ width: 12, height: 12 }} aria-hidden="true" />
              Requires CUF_SECRET_KEY on the server. Without it, saving fails rather than storing in
              the clear.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
