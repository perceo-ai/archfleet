"use client";

// A group of settings, rendered from the catalogue rather than hand-written per
// field — adding a setting is a line in settings.ts, not a form to maintain.
// Each field says where its current value comes from, because "why is this on?"
// should not require reading the compose file.

import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { sendJson } from "@/lib/ui/api";
import { Card, CardHead, Chip, Field, Pill } from "@/components/ui/primitives";
import type { SettingDef, SettingGroup } from "@/lib/fleet/settings";
import { GROUP_LABELS } from "@/lib/fleet/settings";

export type SettingValue = { key: string; value: string; isSet: boolean; source: string };

const SOURCE_NOTE: Record<string, string> = {
  stored: "set here",
  environment: "from the environment",
  default: "default",
  unset: "not set",
};

export function SettingsGroup({
  group,
  defs,
  values,
  onSaved,
}: {
  group: SettingGroup;
  defs: SettingDef[];
  values: SettingValue[];
  onSaved: () => void | Promise<void>;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const mine = defs.filter((d) => d.group === group);
  const valueOf = (key: string) => values.find((v) => v.key === key);
  const current = (def: SettingDef) => edits[def.key] ?? valueOf(def.key)?.value ?? "";
  const dirty = Object.keys(edits).length > 0;

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await sendJson("/api/settings", "PATCH", edits);
      setEdits({});
      setSaved(true);
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead
        title={GROUP_LABELS[group].title}
        subtitle={GROUP_LABELS[group].blurb}
        right={
          saved && !dirty ? (
            <Pill tone="ok">
              <Check className="ico" style={{ width: 11, height: 11 }} aria-hidden="true" />
              saved
            </Pill>
          ) : undefined
        }
      />
      <div className="card-body stack">
        {mine.map((def) => {
          const state = valueOf(def.key);
          const isSecret = def.kind === "secret";
          return (
            <div key={def.key} className="stack-s">
              <Field
                label={def.label}
                hint={
                  <>
                    {def.help}
                    {def.env ? (
                      <>
                        {" "}
                        Falls back to <code className="mono">{def.env}</code>.
                      </>
                    ) : null}
                  </>
                }
              >
                {def.kind === "boolean" ? (
                  <select
                    className="select"
                    aria-label={def.label}
                    value={current(def) === "true" ? "true" : "false"}
                    onChange={(e) => setEdits({ ...edits, [def.key]: e.target.value })}
                  >
                    <option value="false">Off</option>
                    <option value="true">On</option>
                  </select>
                ) : def.kind === "select" ? (
                  <select
                    className="select"
                    aria-label={def.label}
                    value={current(def)}
                    onChange={(e) => setEdits({ ...edits, [def.key]: e.target.value })}
                  >
                    <option value="">Not set</option>
                    {(def.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : def.kind === "textarea" ? (
                  <textarea
                    className="textarea"
                    rows={3}
                    aria-label={def.label}
                    value={current(def)}
                    placeholder={def.placeholder}
                    onChange={(e) => setEdits({ ...edits, [def.key]: e.target.value })}
                  />
                ) : (
                  <input
                    className="input"
                    aria-label={def.label}
                    type={isSecret ? "password" : def.kind === "number" ? "number" : "text"}
                    value={current(def)}
                    placeholder={
                      isSecret && state?.isSet ? "•••••••• (stored — type to replace)" : def.placeholder
                    }
                    onChange={(e) => setEdits({ ...edits, [def.key]: e.target.value })}
                  />
                )}
              </Field>

              <div className="hstack-w" style={{ gap: 6 }}>
                <Chip>{SOURCE_NOTE[state?.source ?? "unset"]}</Chip>
                {isSecret && state?.isSet ? <Pill tone="ok">stored</Pill> : null}
                {isSecret && !state?.isSet ? <Pill tone="idle">not set</Pill> : null}
                {def.danger ? (
                  <span className="t-xs hstack" style={{ color: "var(--warn)", gap: 5 }}>
                    <AlertTriangle className="ico" style={{ width: 12, height: 12 }} aria-hidden="true" />
                    {def.danger}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}

        {error ? (
          <p className="t-sm" style={{ color: "var(--danger)", margin: 0 }} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="card-foot hstack">
        <span className="t-xs faint">
          Blank a field to fall back to its environment variable or the default.
        </span>
        <div className="spacer" />
        {dirty ? (
          <button type="button" className="btn btn-sm" onClick={() => setEdits({})} disabled={busy}>
            Discard
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Card>
  );
}
