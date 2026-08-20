"use client";

// One renderer for everything a run can ask a human. The run decides the shape
// — a code, a PO number, a choice between accounts, an approval, or just "go
// look at this" — and this draws it. Nothing here knows what MFA is.

import { useState } from "react";
import { Check, Monitor, X } from "lucide-react";
import type { AskField, HumanAsk } from "@/lib/fleet/human-ask";
import { validateAnswers } from "@/lib/fleet/human-ask";

const INPUT_TYPE: Record<AskField["type"], string> = {
  text: "text",
  textarea: "text",
  password: "password",
  code: "text",
  number: "number",
  url: "url",
  email: "email",
};

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: AskField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.options?.length) {
    return (
      <select
        className="select"
        aria-label={field.label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "textarea") {
    return (
      <textarea
        className="textarea"
        rows={3}
        aria-label={field.label}
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      className="input"
      type={INPUT_TYPE[field.type]}
      inputMode={field.type === "code" || field.type === "number" ? "numeric" : undefined}
      autoComplete={field.secret ? "off" : undefined}
      aria-label={field.label}
      placeholder={field.placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function AskPanel({
  ask,
  busy,
  compact,
  onAnswer,
  onCancel,
  onTakeOver,
}: {
  ask: HumanAsk;
  busy?: boolean;
  /** Inbox rows use the tighter layout; the run view gets the roomy one. */
  compact?: boolean;
  onAnswer: (answers: Record<string, string>) => void;
  onCancel?: () => void;
  onTakeOver?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);

  const set = (name: string, value: string) => setAnswers((a) => ({ ...a, [name]: value }));

  const submit = (extra: Record<string, string> = {}) => {
    const merged = { ...answers, ...extra };
    const found = validateAnswers(ask, merged);
    setErrors(found);
    if (found.length === 0) onAnswer(merged);
  };

  const answerName = ask.answerName ?? (ask.kind === "approval" ? "approval" : "choice");

  return (
    <div className="stack-s">
      {ask.detail ? <p className="t-sm dim" style={{ margin: 0 }}>{ask.detail}</p> : null}

      {ask.kind === "input" ? (
        <div className={compact ? "hstack-w" : "grid-2"}>
          {(ask.fields ?? []).map((field) => (
            <label className="field" key={field.name} style={compact ? { maxWidth: 260 } : undefined}>
              <span>
                {field.label}
                {field.secret ? <span className="faint"> · kept secret</span> : null}
              </span>
              <FieldInput
                field={field}
                value={answers[field.name] ?? ""}
                onChange={(v) => set(field.name, v)}
              />
            </label>
          ))}
        </div>
      ) : null}

      <div className="hstack-w">
        {ask.kind === "choice" || ask.kind === "approval" ? (
          (ask.options ?? []).map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                option.tone === "danger"
                  ? "btn btn-danger btn-sm"
                  : option.tone === "ok"
                    ? "btn btn-primary btn-sm"
                    : "btn btn-sm"
              }
              disabled={busy}
              onClick={() => submit({ [answerName]: option.value })}
            >
              {option.label}
            </button>
          ))
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => submit()}
          >
            <Check className="ico" aria-hidden="true" />
            {ask.kind === "input" ? "Send & resume" : "Done — resume"}
          </button>
        )}

        {onTakeOver ? (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onTakeOver}>
            <Monitor className="ico" aria-hidden="true" />
            Open the desktop
          </button>
        ) : null}

        {onCancel ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
            <X className="ico" aria-hidden="true" />
            Stop the run
          </button>
        ) : null}
      </div>

      {errors.length > 0 ? (
        <p className="t-xs" style={{ color: "var(--danger)", margin: 0 }} role="alert">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
