"use client";

// Build a node type without deploying anything: name it, declare its inputs,
// and point it at one of three primitives. It appears in every automation's
// step palette immediately.

import { useState } from "react";
import { Blocks, Plus, Trash2 } from "lucide-react";
import { sendJson, usePolling } from "@/lib/ui/api";
import { Card, CardHead, Chip, Empty, Field, StaleNotice } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Overlay";
import { ExprField } from "@/components/automations/workspace/ExprField";
import {
  NODE_TYPE_PRESETS,
  validateNodeType,
  type CustomNodeType,
  type NodeTypeField,
} from "@/lib/fleet/node-types";

const FIELD_TYPES: NodeTypeField["type"][] = [
  "text",
  "textarea",
  "number",
  "secret",
  "select",
  "boolean",
];

const BASE_HELP: Record<CustomNodeType["base"], string> = {
  http: 'JSON with url, method, headers and body — e.g. {"url": "{{field.endpoint}}", "method": "POST"}',
  shell: "A command line. Field values are substituted before it runs.",
  expression: "An expression. Its value becomes the step's output, and decides success.",
};

const blank = (): CustomNodeType => ({
  id: "",
  name: "",
  description: "",
  base: "http",
  fields: [],
  template: "",
  createdAt: "",
  updatedAt: "",
});

/** Suggest an id from the name so nobody has to invent a slug. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

export function NodeTypesPanel() {
  const types = usePolling<CustomNodeType[]>("/api/node-types", 30000);
  const [draft, setDraft] = useState<CustomNodeType | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [note, setNote] = useState<string>();

  const list = types.data ?? [];
  const editing = draft !== null;

  const open = (type?: CustomNodeType) => {
    setErrors([]);
    setDraft(type ? { ...type } : blank());
  };

  async function save() {
    if (!draft) return;
    const candidate = { ...draft, id: draft.id || slug(draft.name) };
    const found = validateNodeType(candidate);
    setErrors(found);
    if (found.length) return;
    try {
      await sendJson("/api/node-types", "POST", candidate);
      setDraft(null);
      setNote(`Saved "${candidate.name}" — it is in the step palette now.`);
      await types.refresh();
    } catch (e) {
      setErrors([String(e)]);
    }
  }

  async function remove(id: string) {
    try {
      await sendJson(`/api/node-types?id=${encodeURIComponent(id)}`, "DELETE");
      await types.refresh();
    } catch (e) {
      setNote(String(e));
    }
  }

  const setField = (index: number, patch: Partial<NodeTypeField>) =>
    setDraft((d) =>
      d ? { ...d, fields: d.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : d,
    );

  return (
    <div className="stack">
      <StaleNotice error={types.error} onRetry={() => void types.refresh()} />
      {note ? (
        <p className="t-sm" style={{ color: "var(--text-2)" }} role="status">
          {note}
        </p>
      ) : null}

      <Card>
        <CardHead
          title="Node types"
          subtitle="Steps your team defined. They appear in every automation's palette."
          right={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => open()}>
              <Plus className="ico" aria-hidden="true" />
              New node type
            </button>
          }
        />
        {list.length === 0 ? (
          <Empty>
            None yet. Start from a preset — an API call, a Slack post, a command, or a computed value.
          </Empty>
        ) : (
          <div className="rows">
            {list.map((type) => (
              <div className="row" key={type.id}>
                <div className="b-ico" style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
                  <Blocks className="ico" aria-hidden="true" />
                </div>
                <div className="grow">
                  <div className="row-title">{type.name}</div>
                  <div className="row-sub">
                    <span className="mono">{type.id}</span>
                    <span className="sep">·</span>
                    <span>{type.description || `runs as ${type.base}`}</span>
                  </div>
                </div>
                <Chip>{type.base}</Chip>
                <Chip>
                  {type.fields.length} {type.fields.length === 1 ? "input" : "inputs"}
                </Chip>
                <button type="button" className="btn btn-sm" onClick={() => open(type)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label={`Delete ${type.name}`}
                  onClick={() => void remove(type.id)}
                >
                  <Trash2 className="ico" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Drawer
        open={editing}
        onClose={() => setDraft(null)}
        width="min(680px, 94vw)"
        title={draft?.name || "New node type"}
        subtitle="Declare its inputs, then say what runs."
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
            Save node type
          </button>
        }
      >
        {draft ? (
          <div className="stack">
            {errors.length > 0 ? (
              <p className="t-sm" style={{ color: "var(--danger)" }} role="alert">
                {errors.join(" ")}
              </p>
            ) : null}

            {!draft.id && !draft.name ? (
              <div className="stack-s">
                <span className="t-label">Start from</span>
                <div className="itemlist">
                  {NODE_TYPE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="item"
                      onClick={() =>
                        setDraft({
                          ...blank(),
                          ...preset.type,
                          id: slug(preset.type.name),
                        })
                      }
                    >
                      <div className="grow" style={{ textAlign: "left" }}>
                        <div className="strong t-sm">{preset.label}</div>
                        <div className="t-xs faint">{preset.hint}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="sep-y" />
                <span className="t-xs faint">…or fill it in from scratch below.</span>
              </div>
            ) : null}

            <div className="grid-2">
              <Field label="Name">
                <input
                  className="input"
                  aria-label="Node type name"
                  value={draft.name}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      name: e.target.value,
                      id: draft.id || slug(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Id" hint="Referenced by workflows. Cannot be changed casually.">
                <input
                  className="input mono"
                  aria-label="Node type id"
                  value={draft.id}
                  onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                />
              </Field>
            </div>

            <Field label="What it does">
              <input
                className="input"
                aria-label="Description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>

            <Field label="What runs it">
              <select
                className="select"
                aria-label="Base"
                value={draft.base}
                onChange={(e) => setDraft({ ...draft, base: e.target.value as CustomNodeType["base"] })}
              >
                <option value="http">An HTTP request</option>
                <option value="shell">A shell command</option>
                <option value="expression">An expression (no I/O)</option>
              </select>
              <span className="hint">{BASE_HELP[draft.base]}</span>
            </Field>

            <div className="stack-s">
              <span className="t-label">Inputs</span>
              {draft.fields.map((field, i) => (
                <div className="item" key={i} style={{ flexWrap: "wrap", gap: 8 }}>
                  <input
                    className="input"
                    style={{ maxWidth: 120 }}
                    aria-label={`Input ${i + 1} name`}
                    placeholder="name"
                    value={field.name}
                    onChange={(e) => setField(i, { name: e.target.value })}
                  />
                  <input
                    className="input"
                    style={{ maxWidth: 150 }}
                    aria-label={`Input ${i + 1} label`}
                    placeholder="label"
                    value={field.label}
                    onChange={(e) => setField(i, { label: e.target.value })}
                  />
                  <select
                    className="select"
                    style={{ width: "auto" }}
                    aria-label={`Input ${i + 1} type`}
                    value={field.type}
                    onChange={(e) => setField(i, { type: e.target.value as NodeTypeField["type"] })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {field.type === "select" ? (
                    <input
                      className="input"
                      style={{ maxWidth: 160 }}
                      aria-label={`Input ${i + 1} options`}
                      placeholder="option, option"
                      value={(field.options ?? []).join(", ")}
                      onChange={(e) =>
                        setField(i, {
                          options: e.target.value
                            .split(",")
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  ) : null}
                  <label className="hstack t-xs" style={{ gap: 5 }}>
                    <input
                      type="checkbox"
                      checked={field.required === true}
                      onChange={(e) => setField(i, { required: e.target.checked })}
                    />
                    required
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove input ${i + 1}`}
                    onClick={() =>
                      setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 className="ico" aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-sm"
                style={{ justifySelf: "start" }}
                onClick={() =>
                  setDraft({
                    ...draft,
                    fields: [
                      ...draft.fields,
                      { name: `input_${draft.fields.length + 1}`, label: "Input", type: "text" },
                    ],
                  })
                }
              >
                <Plus className="ico" aria-hidden="true" />
                Add an input
              </button>
            </div>

            <Field
              label="Template"
              hint={`Use {{field.name}} for this node's inputs, plus {{param.x}}, {{secret.x}} and {{= expression }}.`}
            >
              <textarea
                className="textarea mono"
                rows={5}
                spellCheck={false}
                aria-label="Template"
                value={draft.template}
                onChange={(e) => setDraft({ ...draft, template: e.target.value })}
              />
            </Field>

            <ExprField
              label="Counts as success when (optional)"
              hint="Leave blank to use the natural outcome — a 2xx response, or exit code 0."
              rows={1}
              value={draft.successExpr ?? ""}
              placeholder='steps["This step"].body.state == "done"'
              onChange={(successExpr) => setDraft({ ...draft, successExpr: successExpr || undefined })}
            />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
