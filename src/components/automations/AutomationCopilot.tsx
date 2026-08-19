"use client";

// The copilot column. It edits the automation directly: every reply that changes
// something arrives as a proposal you apply or dismiss, never as a silent edit.

import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { sendJson } from "@/lib/ui/api";
import type { AutomationDraft } from "@/lib/fleet/automation-draft";
import type { Automation, Workflow, WorkflowRun } from "@/lib/fleet/types";

type ChatMessage = { role: "user" | "assistant"; content: string };

const QUICK_PROMPTS = [
  "Make this pause for login or MFA instead of failing.",
  "Tighten the success criteria and evidence checks.",
  "Add screenshots after every important state change.",
];

function contextPrompt(
  message: string,
  automation?: Automation | null,
  workflow?: Workflow | null,
  run?: WorkflowRun | null,
): string {
  const context = {
    automation,
    workflow,
    run: run
      ? {
          id: run.id,
          status: run.status,
          currentStep: run.currentStep,
          resultSummary: run.resultSummary,
          events: run.events.slice(-12).map((e) => e.message),
          artifacts: (run.artifacts ?? []).map((a) => a.path),
        }
      : undefined,
  };
  if (!automation) return message;
  return [
    "Revise the existing automation below. Preserve its product intent unless I ask for a bigger change.",
    "Return a complete updated automation draft and workflow.",
    "",
    `Current context:\n${JSON.stringify(context, null, 2)}`,
    "",
    `User request:\n${message}`,
  ].join("\n");
}

function summarizeDraft(draft: AutomationDraft): string {
  return [
    `Drafted “${draft.automation.name}”.`,
    draft.automation.requiredSecrets.length
      ? `Needs ${draft.automation.requiredSecrets.join(", ")}.`
      : "No new secrets required.",
    draft.clarifyingQuestions.length ? `Questions: ${draft.clarifyingQuestions.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function AutomationCopilot({
  automation,
  workflow,
  run,
  onApplyDraft,
  title = "Copilot",
}: {
  automation?: Automation | null;
  workflow?: Workflow | null;
  run?: WorkflowRun | null;
  onApplyDraft: (draft: AutomationDraft) => void;
  title?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: automation
        ? "Tell me what should change. I can rewrite the graph, the checks and the takeover policy from this run's context."
        : "Describe what you want done in plain language. I'll lay out the graph, pick a desktop to run it on, and tell you what I still need from you.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<AutomationDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, proposal]);

  async function ask(text = input) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: trimmed }]);
    try {
      const draft = await sendJson<AutomationDraft>("/api/automations/draft", "POST", {
        prompt: contextPrompt(trimmed, automation, workflow, run),
      });
      setProposal(draft);
      setMessages((m) => [...m, { role: "assistant", content: summarizeDraft(draft) }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ws-left">
      <div className="ws-head">
        <span className="mark" style={{ width: 20, height: 20, borderRadius: 5, fontSize: 10 }}>
          A
        </span>
        <span className="strong t-sm grow">{title}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setMessages(messages.slice(0, 1));
            setProposal(null);
            setError(null);
          }}
        >
          Clear
        </button>
      </div>

      <div className="chat">
        {messages.map((m, i) => (
          <div key={`${m.role}-${i}`} className={`msg ${m.role === "user" ? "me" : "bot"}`}>
            <span className="av">{m.role === "user" ? "You" : "A"}</span>
            <div className="bubble">{m.content}</div>
          </div>
        ))}

        {busy ? (
          <div className="msg bot">
            <span className="av">A</span>
            <div className="bubble dimmer">Thinking…</div>
          </div>
        ) : null}

        {proposal ? (
          <div className="proposal">
            <div className="p-head">Proposed change</div>
            <div className="p-body">
              <div className="strong">{proposal.automation.name}</div>
              <div>{proposal.automation.goal}</div>
              <div className="t-xs faint">
                {proposal.workflow.nodes.length} nodes · {proposal.automation.successCriteria.length}{" "}
                criteria · {proposal.automation.evidenceChecks?.length ?? 0} checks
              </div>
              {proposal.clarifyingQuestions.map((q) => (
                <div key={q} className="t-xs" style={{ color: "var(--warn)" }}>
                  {q}
                </div>
              ))}
            </div>
            <div className="p-foot">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  onApplyDraft(proposal);
                  setProposal(null);
                }}
              >
                Apply
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProposal(null)}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="t-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        ) : null}

        {messages.length === 1 && !proposal ? (
          <div className="stack-s">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                className="btn btn-sm"
                style={{ justifyContent: "flex-start", height: "auto", padding: "6px 9px", textAlign: "left" }}
                disabled={busy}
                onClick={() => void ask(p)}
              >
                {p}
              </button>
            ))}
          </div>
        ) : null}

        <div ref={end} />
      </div>

      <div className="composer">
        <div className="composer-box">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask();
            }}
            placeholder={
              automation ? "Ask for a change, or describe what went wrong…" : "Every Monday, download last week's invoices from…"
            }
            aria-label="Message the copilot"
          />
          <div className="composer-actions">
            <span className="t-xs faint hstack" style={{ gap: 5 }}>
              <Paperclip className="ico" style={{ width: 12, height: 12 }} aria-hidden="true" />
              ⌘↵ to send
            </span>
            <div className="spacer" />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!input.trim() || busy}
              onClick={() => void ask()}
            >
              {busy ? "Thinking…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
