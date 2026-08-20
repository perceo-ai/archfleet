"use client";

// The three node detours: a workflow node, the "done means" node, and the
// trigger. Each is the only place its settings live — nothing expands inline.

import { useState } from "react";
import { Clock, Flag, Play, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Overlay";
import { Field, Pill } from "@/components/ui/primitives";
import { formatEvidenceChecks, parseEvidenceChecks } from "@/lib/fleet/evidence-checks";
import { SCHEDULE_PRESETS, cadenceLabel, timeAgo } from "@/lib/ui/format";
import { parseAsk, type AskField, type AskKind, type HumanAsk } from "@/lib/fleet/human-ask";
import { ExprField } from "@/components/automations/workspace/ExprField";
import type { CustomNodeType } from "@/lib/fleet/node-types";
import type { Workflow } from "@/lib/fleet/types";
import type { Automation, Trigger, WorkflowNode } from "@/lib/fleet/types";

export function NodeModal({
  node,
  open,
  onClose,
  onSave,
  onDelete,
  onTest,
  failures,
  workflow,
  nodeTypes,
}: {
  node: WorkflowNode | undefined;
  open: boolean;
  onClose: () => void;
  onSave: (node: WorkflowNode) => Promise<void> | void;
  onDelete?: (nodeId: string) => Promise<void> | void;
  onTest?: (nodeId: string) => void;
  failures?: number;
  workflow?: Workflow | null;
  nodeTypes?: CustomNodeType[];
}) {
  // Parents pass `key={node.id}` so a different node remounts with fresh state
  // instead of syncing props into state in an effect.
  const [draft, setDraft] = useState<WorkflowNode | undefined>(node);

  if (!draft) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft.name}
      subtitle={draft.type.replace(/_/g, " ")}
      footer={
        <>
          {onTest ? (
            <button type="button" className="btn btn-sm" onClick={() => onTest(draft.id)}>
              <Play className="ico" aria-hidden="true" />
              Test just this node
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void onDelete(draft.id)}
            >
              <Trash2 className="ico" aria-hidden="true" />
              Delete node
            </button>
          ) : null}
          <div className="spacer" />
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void onSave(draft)}
          >
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        {failures ? (
          <Pill tone="danger">
            {failures} recent {failures === 1 ? "run" : "runs"} failed here
          </Pill>
        ) : null}

        <Field label="Name">
          <input
            className="input"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>

        {draft.type === "human_takeover" ? (
          <AskEditor
            ask={parseAsk(draft.config.ask ?? draft.config.prompt, "This run needs a human.")}
            onChange={(ask) =>
              setDraft({ ...draft, config: { ...draft.config, ask, prompt: ask.question } })
            }
          />
        ) : draft.type === "condition" ? (
          <ExprField
            label="Continue when this is true"
            hint="False takes the failure edge. The rule can read any earlier step's output."
            workflow={workflow}
            value={draft.config.expr ?? ""}
            onChange={(expr) => setDraft({ ...draft, config: { ...draft.config, expr } })}
          />
        ) : draft.type === "switch" ? (
          <SwitchEditor
            cases={draft.config.cases ?? []}
            workflow={workflow}
            onChange={(cases) => setDraft({ ...draft, config: { ...draft.config, cases } })}
          />
        ) : draft.type === "wait" ? (
          <WaitEditor
            config={draft.config}
            workflow={workflow}
            onChange={(config) => setDraft({ ...draft, config: { ...draft.config, ...config } })}
          />
        ) : draft.type === "set_params" ? (
          <AssignEditor
            assign={draft.config.assign ?? {}}
            workflow={workflow}
            onChange={(assign) => setDraft({ ...draft, config: { ...draft.config, assign } })}
          />
        ) : draft.type === "custom" ? (
          <CustomFieldsEditor
            type={nodeTypes?.find((t) => t.id === draft.config.customTypeId)}
            values={draft.config.fields ?? {}}
            onChange={(fields) => setDraft({ ...draft, config: { ...draft.config, fields } })}
          />
        ) : (
          <Field
            label="What it does"
            hint="Plain language for agent steps; JSON config for api_call, script and shell nodes."
          >
            <textarea
              className="textarea"
              rows={5}
              value={draft.config.prompt ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, config: { ...draft.config, prompt: e.target.value } })
              }
            />
          </Field>
        )}

        <div className="grid-2">
          <Field label="Give up after" hint="Milliseconds; blank uses the fleet default.">
            <input
              className="input"
              inputMode="numeric"
              value={draft.config.timeoutMs ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    timeoutMs: e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
            />
          </Field>
          <Field label="Needs a desktop labelled" hint="Comma-separated fleet labels.">
            <input
              className="input"
              value={(draft.config.requiredLabels ?? []).join(", ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  config: {
                    ...draft.config,
                    requiredLabels: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** switch: an ordered list of labelled rules; the first true one wins. */
function SwitchEditor({
  cases,
  workflow,
  onChange,
}: {
  cases: { label: string; expr: string }[];
  workflow?: Workflow | null;
  onChange: (cases: { label: string; expr: string }[]) => void;
}) {
  const set = (i: number, patch: Partial<{ label: string; expr: string }>) =>
    onChange(cases.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="stack-s">
      <p className="t-xs faint" style={{ margin: 0 }}>
        Checked top to bottom — the first rule that holds picks its branch. Each label needs an edge out
        of this node.
      </p>
      {cases.map((branch, i) => (
        <div className="item" key={i} style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <span className="idx">{i + 1}</span>
          <input
            className="input"
            style={{ maxWidth: 150 }}
            aria-label={`Case ${i + 1} label`}
            placeholder="label"
            value={branch.label}
            onChange={(e) => set(i, { label: e.target.value })}
          />
          <div className="grow" style={{ minWidth: 220 }}>
            <ExprField
              label={`When`}
              workflow={workflow}
              rows={1}
              value={branch.expr}
              onChange={(expr) => set(i, { expr })}
            />
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Remove case ${i + 1}`}
            onClick={() => onChange(cases.filter((_, j) => j !== i))}
          >
            <Trash2 className="ico" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-sm"
        style={{ justifySelf: "start" }}
        onClick={() => onChange([...cases, { label: `case_${cases.length + 1}`, expr: "true" }])}
      >
        <Plus className="ico" aria-hidden="true" />
        Add a case
      </button>
    </div>
  );
}

/** wait: a plain delay, or poll something until a rule holds. */
function WaitEditor({
  config,
  workflow,
  onChange,
}: {
  config: WorkflowNode["config"];
  workflow?: Workflow | null;
  onChange: (config: Partial<WorkflowNode["config"]>) => void;
}) {
  const polling = !!config.untilExpr?.trim();
  return (
    <div className="stack-s">
      <Field label="What kind of wait?">
        <select
          className="select"
          value={polling ? "until" : "delay"}
          onChange={(e) =>
            onChange(
              e.target.value === "until"
                ? { untilExpr: config.untilExpr || 'steps["Check"].body.state == "done"' }
                : { untilExpr: undefined },
            )
          }
        >
          <option value="delay">Pause for a fixed time</option>
          <option value="until">Keep checking until something is true</option>
        </select>
      </Field>

      <Field label={polling ? "Check every" : "Pause for"} hint="Seconds.">
        <input
          className="input"
          type="number"
          min={0}
          value={Math.round((config.waitMs ?? 0) / 1000)}
          onChange={(e) => onChange({ waitMs: Math.max(0, Number(e.target.value)) * 1000 })}
        />
      </Field>

      {polling ? (
        <>
          <Field
            label="Request to re-check (JSON)"
            hint="Polled each interval; its response is this step's output. Without it there is nothing to re-check."
          >
            <textarea
              className="textarea mono"
              rows={3}
              spellCheck={false}
              value={config.prompt ?? ""}
              placeholder='{"url": "https://api.example.com/export/{{param.export_id}}"}'
              onChange={(e) => onChange({ prompt: e.target.value })}
            />
          </Field>
          <ExprField
            label="Stop waiting when"
            workflow={workflow}
            value={config.untilExpr ?? ""}
            onChange={(untilExpr) => onChange({ untilExpr })}
          />
          <Field label="Give up after" hint="Seconds. Then the step fails and takes the failure edge.">
            <input
              className="input"
              type="number"
              min={1}
              value={Math.round((config.timeoutMs ?? 300_000) / 1000)}
              onChange={(e) => onChange({ timeoutMs: Math.max(1, Number(e.target.value)) * 1000 })}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}

/** set_params: name -> expression, the workflow's variables. */
function AssignEditor({
  assign,
  workflow,
  onChange,
}: {
  assign: Record<string, string>;
  workflow?: Workflow | null;
  onChange: (assign: Record<string, string>) => void;
}) {
  const entries = Object.entries(assign);
  const rename = (from: string, to: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of entries) next[k === from ? to : k] = v;
    onChange(next);
  };

  return (
    <div className="stack-s">
      <p className="t-xs faint" style={{ margin: 0 }}>
        Each value is an expression. Later steps read them as{" "}
        <code className="mono">{"{{param.name}}"}</code>.
      </p>
      {entries.map(([name, source], i) => (
        <div className="item" key={i} style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <input
            className="input"
            style={{ maxWidth: 150 }}
            aria-label={`Param ${i + 1} name`}
            placeholder="param name"
            value={name}
            onChange={(e) => rename(name, e.target.value)}
          />
          <div className="grow" style={{ minWidth: 220 }}>
            <ExprField
              label="Set to"
              workflow={workflow}
              rows={1}
              value={source}
              placeholder='steps["Fetch"].body.total * 2'
              onChange={(expr) => onChange({ ...assign, [name]: expr })}
            />
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Remove ${name}`}
            onClick={() => onChange(Object.fromEntries(entries.filter(([k]) => k !== name)))}
          >
            <Trash2 className="ico" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-sm"
        style={{ justifySelf: "start" }}
        onClick={() => onChange({ ...assign, [`value_${entries.length + 1}`]: '""' })}
      >
        <Plus className="ico" aria-hidden="true" />
        Add a value
      </button>
    </div>
  );
}

/** custom: the form its own definition declared. */
function CustomFieldsEditor({
  type,
  values,
  onChange,
}: {
  type: CustomNodeType | undefined;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  if (!type) {
    return (
      <p className="t-sm" style={{ color: "var(--danger)" }}>
        This node uses a type that is no longer installed. Re-create it under Settings › Node types, or
        delete the node.
      </p>
    );
  }
  return (
    <div className="stack-s">
      <p className="t-xs faint" style={{ margin: 0 }}>
        {type.description || `Runs as ${type.base}.`} Values accept{" "}
        <code className="mono">{"{{param.x}}"}</code>, <code className="mono">{"{{secret.x}}"}</code> and{" "}
        <code className="mono">{"{{= expression }}"}</code>.
      </p>
      {type.fields.map((field) => (
        <Field key={field.name} label={field.label + (field.required ? " *" : "")}>
          {field.type === "select" ? (
            <select
              className="select"
              aria-label={field.label}
              value={values[field.name] ?? field.default ?? ""}
              onChange={(e) => onChange({ ...values, [field.name]: e.target.value })}
            >
              {(field.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : field.type === "textarea" ? (
            <textarea
              className="textarea"
              rows={3}
              aria-label={field.label}
              placeholder={field.placeholder}
              value={values[field.name] ?? field.default ?? ""}
              onChange={(e) => onChange({ ...values, [field.name]: e.target.value })}
            />
          ) : (
            <input
              className="input"
              type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
              aria-label={field.label}
              placeholder={field.placeholder}
              value={values[field.name] ?? field.default ?? ""}
              onChange={(e) => onChange({ ...values, [field.name]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </div>
  );
}

const ASK_KINDS: { key: AskKind; label: string; hint: string }[] = [
  { key: "acknowledge", label: "Just tell me", hint: "The run waits until someone says it's handled." },
  { key: "input", label: "Ask for values", hint: "Each answer becomes a param later steps can use." },
  { key: "choice", label: "Ask to pick one", hint: "The choice lands in a param." },
  { key: "approval", label: "Ask to approve", hint: "Approve continues; reject stops the run." },
];

const FIELD_TYPES: AskField["type"][] = [
  "text",
  "textarea",
  "password",
  "code",
  "number",
  "url",
  "email",
];

/** Author what the run should ask a human for. This is the whole point of the
 * takeover node: any question, not a hardcoded login prompt. */
function AskEditor({ ask, onChange }: { ask: HumanAsk; onChange: (ask: HumanAsk) => void }) {
  const setField = (index: number, patch: Partial<AskField>) => {
    const fields = [...(ask.fields ?? [])];
    fields[index] = { ...fields[index], ...patch };
    onChange({ ...ask, fields });
  };

  return (
    <div className="stack-s">
      <Field label="What should it ask?">
        <textarea
          className="textarea"
          rows={2}
          value={ask.question}
          onChange={(e) => onChange({ ...ask, question: e.target.value })}
        />
      </Field>

      <Field label="Extra context" hint="What the run tried, what it saw — shown under the question.">
        <input
          className="input"
          value={ask.detail ?? ""}
          onChange={(e) => onChange({ ...ask, detail: e.target.value || undefined })}
        />
      </Field>

      <Field label="What does it need back?">
        <select
          className="select"
          value={ask.kind}
          onChange={(e) => {
            const kind = e.target.value as AskKind;
            onChange(
              parseAsk({
                ...ask,
                kind,
                fields:
                  kind === "input"
                    ? ask.fields?.length
                      ? ask.fields
                      : [{ name: "answer", label: "Answer", type: "text" }]
                    : undefined,
                options:
                  kind === "choice"
                    ? ask.options?.length
                      ? ask.options
                      : [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
                    : kind === "approval"
                      ? ask.options
                      : undefined,
              }),
            );
          }}
        >
          {ASK_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        <span className="hint">{ASK_KINDS.find((k) => k.key === ask.kind)?.hint}</span>
      </Field>

      {ask.kind === "input" ? (
        <div className="stack-s">
          {(ask.fields ?? []).map((field, i) => (
            <div className="item" key={i} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ maxWidth: 130 }}
                aria-label={`Field ${i + 1} name`}
                placeholder="param name"
                value={field.name}
                onChange={(e) => setField(i, { name: e.target.value })}
              />
              <input
                className="input"
                style={{ maxWidth: 160 }}
                aria-label={`Field ${i + 1} label`}
                placeholder="label shown to the human"
                value={field.label}
                onChange={(e) => setField(i, { label: e.target.value })}
              />
              <select
                className="select"
                style={{ width: "auto" }}
                aria-label={`Field ${i + 1} type`}
                value={field.type}
                onChange={(e) => setField(i, { type: e.target.value as AskField["type"] })}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <label className="hstack t-xs" style={{ gap: 5 }}>
                <input
                  type="checkbox"
                  checked={field.secret === true}
                  onChange={(e) => setField(i, { secret: e.target.checked })}
                />
                secret
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Remove field ${i + 1}`}
                onClick={() =>
                  onChange({ ...ask, fields: (ask.fields ?? []).filter((_, j) => j !== i) })
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
              onChange({
                ...ask,
                fields: [
                  ...(ask.fields ?? []),
                  { name: `answer_${(ask.fields?.length ?? 0) + 1}`, label: "Answer", type: "text" },
                ],
              })
            }
          >
            <Plus className="ico" aria-hidden="true" />
            Add a field
          </button>
          <p className="t-xs faint" style={{ margin: 0 }}>
            Answers arrive as <code className="mono">{"{{param.name}}"}</code>; anything marked secret
            arrives as <code className="mono">{"{{secret.name}}"}</code> and never reaches a log.
          </p>
        </div>
      ) : null}

      {ask.kind === "choice" ? (
        <Field label="Options" hint="One per line. The chosen value lands in a param.">
          <textarea
            className="textarea"
            rows={3}
            value={(ask.options ?? []).map((o) => o.value).join("\n")}
            onChange={(e) =>
              onChange({
                ...ask,
                options: e.target.value
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean)
                  .map((v) => ({ value: v, label: v })),
              })
            }
          />
        </Field>
      ) : null}
    </div>
  );
}

export function DoneModal({
  automation,
  open,
  onClose,
  onSave,
}: {
  automation: Automation;
  open: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Automation>) => Promise<void> | void;
}) {
  const [criteria, setCriteria] = useState(automation.successCriteria.join("\n"));
  const [checks, setChecks] = useState(formatEvidenceChecks(automation.evidenceChecks ?? []));

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={
        <span className="gicon" style={{ background: "var(--ok-dim)", color: "var(--ok)" }}>
          <Flag className="ico" aria-hidden="true" />
        </span>
      }
      title="Done means"
      subtitle="Checked against the evidence after every run"
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              void onSave({
                successCriteria: criteria.split("\n").map((s) => s.trim()).filter(Boolean),
                evidenceChecks: parseEvidenceChecks(checks),
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Success criteria" hint="One per line — reviewed against the run's evidence.">
          <textarea
            className="textarea"
            rows={4}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
        </Field>
        <Field
          label="Automated checks"
          hint="One per line: text_found: <text> · url_reached: <url> · file_downloaded: <name> · screenshot_captured · element_visible: <element> · form_submitted[: <form>] · email_received · output_extracted[: <name>] · visual_state_changed"
        >
          <textarea
            className="textarea"
            rows={4}
            value={checks}
            onChange={(e) => setChecks(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

export function TriggerModal({
  triggers,
  open,
  onClose,
  onAdd,
  webhookToken,
}: {
  triggers: Trigger[];
  open: boolean;
  onClose: () => void;
  onAdd: (type: "schedule" | "webhook", cron?: string) => Promise<void> | void;
  webhookToken?: string | null;
}) {
  const [scheduleKey, setScheduleKey] = useState("daily");
  const [customCron, setCustomCron] = useState("0 9 * * *");

  const cron =
    scheduleKey === "custom"
      ? customCron
      : SCHEDULE_PRESETS.find((p) => p.key === scheduleKey)?.cron;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={
        <span className="gicon" style={{ background: "var(--accent-dim)", color: "var(--accent-hi)" }}>
          <Clock className="ico" aria-hidden="true" />
        </span>
      }
      title="Trigger"
      subtitle="What starts this automation"
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="card">
          <div className="rows">
            <div className="row">
              <div className="grow">
                <div className="t-sm strong">Manual</div>
                <div className="t-xs faint">Anyone with access can press Run now.</div>
              </div>
              <Pill tone="ok">on</Pill>
            </div>
            {triggers.map((t) => (
              <div className="row" key={t.id}>
                <div className="grow">
                  <div className="t-sm strong">
                    {t.type === "schedule" ? cadenceLabel(t.cron) : "Webhook"}
                  </div>
                  <div className="t-xs faint">
                    {t.nextRunAt ? `next ${timeAgo(t.nextRunAt)}` : t.type}
                  </div>
                </div>
                <Pill tone={t.enabled ? "ok" : "idle"}>{t.enabled ? "on" : "off"}</Pill>
              </div>
            ))}
          </div>
        </div>

        {webhookToken ? (
          <p className="t-xs mono" style={{ color: "var(--accent-hi)", wordBreak: "break-all" }}>
            Webhook token (shown once): {webhookToken} — POST /api/webhooks/{webhookToken}
          </p>
        ) : null}

        <div className="hstack-w">
          <select
            className="select"
            style={{ width: "auto" }}
            aria-label="Schedule cadence"
            value={scheduleKey}
            onChange={(e) => setScheduleKey(e.target.value)}
          >
            {SCHEDULE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom (cron)</option>
          </select>
          {scheduleKey === "custom" ? (
            <input
              className="input"
              style={{ width: 150 }}
              aria-label="Cron expression"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
            />
          ) : null}
          <button type="button" className="btn btn-sm" onClick={() => void onAdd("schedule", cron)}>
            Add schedule
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void onAdd("webhook")}>
            Add webhook
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function SettingsModal({
  automation,
  environments,
  open,
  onClose,
  onSave,
  onDelete,
}: {
  automation: Automation;
  environments: { id: string; name: string }[];
  open: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Automation>) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(automation);

  const patch = (fields: Partial<Automation>) => setDraft((d) => ({ ...d, ...fields }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle={automation.name}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              void onSave({
                name: draft.name,
                goal: draft.goal,
                category: draft.category,
                target: draft.target,
                environmentId: draft.environmentId,
                requiredSecrets: draft.requiredSecrets,
                retryPolicy: draft.retryPolicy,
                takeoverPolicy: draft.takeoverPolicy,
                artifactPolicy: draft.artifactPolicy,
              })
            }
          >
            Save settings
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Goal">
          <textarea
            className="textarea"
            rows={2}
            value={draft.goal}
            onChange={(e) => patch({ goal: e.target.value })}
          />
        </Field>

        <div className="grid-2">
          <Field label="Name">
            <input className="input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Category">
            <input
              className="input"
              value={draft.category}
              onChange={(e) => patch({ category: e.target.value })}
            />
          </Field>
          <Field label="Target site or app">
            <input
              className="input"
              value={draft.target}
              onChange={(e) => patch({ target: e.target.value })}
            />
          </Field>
          <Field label="Runs on" hint="The prepared desktop this automation uses.">
            <select
              className="select"
              value={draft.environmentId ?? ""}
              onChange={(e) => patch({ environmentId: e.target.value || undefined })}
            >
              <option value="">none</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="sep-y" />

        <div className="grid-2">
          <Field label="Retry" hint="Then it lands in your inbox instead of failing silently.">
            <input
              className="input"
              value={draft.retryPolicy}
              onChange={(e) => patch({ retryPolicy: e.target.value })}
            />
          </Field>
          <Field label="Ask a human when" hint="The desktop is held warm while it waits.">
            <input
              className="input"
              value={draft.takeoverPolicy}
              onChange={(e) => patch({ takeoverPolicy: e.target.value })}
            />
          </Field>
          <Field label="Artifacts to capture">
            <input
              className="input"
              value={draft.artifactPolicy}
              onChange={(e) => patch({ artifactPolicy: e.target.value })}
            />
          </Field>
          <Field label="Required secrets" hint="Comma-separated names.">
            <input
              className="input"
              value={draft.requiredSecrets.join(", ")}
              onChange={(e) =>
                patch({
                  requiredSecrets: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
        </div>

        {onDelete ? (
          <>
            <div className="sep-y" />
            <div className="hstack">
              <div className="grow">
                <div className="t-sm strong">Danger zone</div>
                <div className="t-xs faint">Deleting removes the automation; its evidence stays with the runs.</div>
              </div>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void onDelete()}>
                Delete
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
