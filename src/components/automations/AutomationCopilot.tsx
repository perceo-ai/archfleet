"use client";

import { useState } from "react";
import { Bot, Sparkles, User } from "lucide-react";
import { sendJson } from "@/lib/ui/api";
import type { AutomationDraft } from "@/lib/fleet/automation-draft";
import type { Automation, Workflow, WorkflowRun } from "@/lib/fleet/types";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AutomationCopilotProps = {
  automation?: Automation | null;
  workflow?: Workflow | null;
  run?: WorkflowRun | null;
  onApplyDraft: (draft: AutomationDraft) => void;
  title?: string;
};

const quickPrompts = [
  "Make this pause for login or MFA instead of failing.",
  "Tighten the success criteria and evidence checks.",
  "Add screenshots after every important state change.",
  "Turn this into a resilient smoke test I can rerun.",
];

function contextPrompt(message: string, automation?: Automation | null, workflow?: Workflow | null, run?: WorkflowRun | null): string {
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
  const bits = [
    `Proposed "${draft.automation.name}".`,
    draft.automation.requiredSecrets.length
      ? `Needs ${draft.automation.requiredSecrets.join(", ")}.`
      : "No new secrets required.",
    draft.clarifyingQuestions.length
      ? `Questions: ${draft.clarifyingQuestions.join(" ")}`
      : "Ready for review.",
  ];
  return bits.join(" ");
}

export function AutomationCopilot({
  automation,
  workflow,
  run,
  onApplyDraft,
  title = "Copilot",
}: AutomationCopilotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: automation
        ? "Tell me what should change. I can rewrite the spec, checks, takeover policy, and workflow from this run context."
        : "Describe the work you want automated. I will draft the automation for you.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<AutomationDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function askCopilot(text = input) {
    const trimmed = text.trim();
    if (!trimmed) return;
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
    <section className="glass glass-border rounded-[5px]">
      <div className="border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#c4b5fd]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-white">{title}</h2>
        </div>
      </div>

      <div className="max-h-[340px] space-y-3 overflow-auto p-4">
        {messages.map((m, i) => (
          <div key={`${m.role}-${i}`} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" ? <Bot className="mt-1 h-4 w-4 shrink-0 text-[#c4b5fd]" aria-hidden="true" /> : null}
            <p
              className={`max-w-[85%] rounded-[5px] px-3 py-2 text-sm leading-5 ${
                m.role === "user" ? "bg-[#8b5cf6]/25 text-white" : "bg-white/[0.05] text-white/75"
              }`}
            >
              {m.content}
            </p>
            {m.role === "user" ? <User className="mt-1 h-4 w-4 shrink-0 text-white/45" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>

      <div className="border-t border-white/[0.08] p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {quickPrompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void askCopilot(p)}
              disabled={busy}
              className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-left text-[11px] font-semibold text-white/60 hover:text-white disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <textarea
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={automation ? "Ask for a change, then apply the proposal..." : "What should this automation do?"}
            className="rounded-[5px] border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={() => void askCopilot()}
            disabled={!input.trim() || busy}
            className="perceo-primary h-10 rounded-[5px] px-4 text-sm font-semibold disabled:opacity-50 sm:self-end"
          >
            {busy ? "Thinking..." : "Ask"}
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-[#fca5a5]">{error}</p> : null}
      </div>

      {proposal ? (
        <div className="border-t border-white/[0.08] bg-[#161616]/50 p-4">
          <div className="text-sm font-semibold text-white">{proposal.automation.name}</div>
          <p className="mt-1 text-sm text-white/70">{proposal.automation.goal}</p>
          <div className="mt-2 text-xs text-white/45">
            {proposal.automation.successCriteria.length} criteria · {proposal.automation.evidenceChecks?.length ?? 0} checks ·{" "}
            {proposal.workflow.nodes.length} workflow steps
          </div>
          <button
            type="button"
            onClick={() => onApplyDraft(proposal)}
            className="perceo-primary mt-3 h-9 rounded-[5px] px-3 text-xs font-semibold"
          >
            Apply proposal
          </button>
        </div>
      ) : null}
    </section>
  );
}
