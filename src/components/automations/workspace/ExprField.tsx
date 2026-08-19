"use client";

// An expression input that tells you immediately whether it parses, and what it
// can see. Rules are the part of a workflow people get wrong silently, so the
// feedback is inline rather than at save time.

import { useMemo, useState } from "react";
import { EXPR_FUNCTIONS, checkExpr } from "@/lib/fleet/expr";
import type { Workflow } from "@/lib/fleet/types";

export function ExprField({
  label,
  hint,
  value,
  onChange,
  workflow,
  placeholder,
  rows = 2,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  /** Used to list the step names a rule can read. */
  workflow?: Workflow | null;
  placeholder?: string;
  rows?: number;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const problem = useMemo(() => (value.trim() ? checkExpr(value) : undefined), [value]);

  const stepNames = (workflow?.nodes ?? [])
    .filter((n) => n.type !== "start" && n.type !== "end")
    .map((n) => n.name);

  return (
    <div className="field">
      <span className="hstack" style={{ gap: 6 }}>
        {label}
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setShowHelp((s) => !s)}
          aria-expanded={showHelp}
        >
          {showHelp ? "Hide help" : "What can I use?"}
        </button>
      </span>

      <textarea
        className="textarea mono"
        rows={rows}
        spellCheck={false}
        aria-label={label}
        value={value}
        placeholder={placeholder ?? 'steps["Fetch invoices"].body.total > 1000'}
        onChange={(e) => onChange(e.target.value)}
        style={problem ? { borderColor: "var(--danger-line)" } : undefined}
      />

      {problem ? (
        <span className="t-xs" style={{ color: "var(--danger)" }} role="alert">
          {problem}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}

      {showHelp ? (
        <div
          className="stack-s t-xs"
          style={{
            marginTop: 6,
            padding: 10,
            borderRadius: "var(--radius)",
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
          }}
        >
          <div>
            <span className="t-label">Values</span>
            <div className="dim" style={{ marginTop: 3 }}>
              <code className="mono">params.name</code> · <code className="mono">run.id</code> ·{" "}
              <code className="mono">steps[&quot;Step name&quot;]</code> — a step&apos;s output, e.g.{" "}
              <code className="mono">.body</code>, <code className="mono">.status</code>,{" "}
              <code className="mono">.stdout</code>
            </div>
          </div>
          {stepNames.length > 0 ? (
            <div>
              <span className="t-label">Steps in this automation</span>
              <div className="hstack-w" style={{ marginTop: 4, gap: 4 }}>
                {stepNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="chip"
                    title={`Insert steps["${name}"]`}
                    onClick={() => onChange(`${value}steps["${name}"]`)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <span className="t-label">Operators</span>
            <div className="dim mono" style={{ marginTop: 3 }}>
              == != &gt; &gt;= &lt; &lt;= &amp;&amp; || ! + - * / % ? :
            </div>
          </div>
          <div>
            <span className="t-label">Functions</span>
            <div className="dim mono" style={{ marginTop: 3 }}>
              {EXPR_FUNCTIONS.join(" · ")}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
