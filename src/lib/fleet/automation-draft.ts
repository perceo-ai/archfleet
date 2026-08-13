// Prompt-to-automation drafting: turn a plain-language description into a draft
// Automation (goal, spec, criteria, secrets, policies) plus a disabled workflow
// graph, in one CLI-agent call. The agent call is injected (AgentExec) so this is
// unit tested with a fake. Drafts are for review — they never auto-enable.

import { runCliAgent, type AgentExec } from "./cli-agent-runner";
import { normalizeWorkflow } from "./planner";
import { validateWorkflow } from "./workflow-validation";
import type { AgentProvider, Automation, Workflow } from "./types";

export const DRAFT_SYSTEM = `You design draft automations for a computer-use platform.
Given a user's description, output ONLY a JSON object (no prose) with these fields:
{
  "name": string,                       // short automation name
  "goal": string,                       // one-sentence intent
  "category": string,                   // one of: general, semantic_test, data_extraction, form_fill, account_setup, report_download, marketing
  "target": string,                     // the site/app/system it operates on
  "spec_markdown": string,              // the steps in plain language, numbered
  "nodes": [{"id","type","name","config":{"prompt"?,"requiredLabels"?,"provider"?}}],
  "edges": [{"from","to","condition"}], // condition: "success"|"failure"|"always"
  "required_secrets": string[],         // secret names this needs (e.g. portal_password)
  "mfa_expectation": string|null,       // when/if MFA or device trust will appear
  "success_criteria": string[],         // plain-language checks a human can verify from evidence
  "trigger_suggestion": string|null,    // e.g. "daily at 9am UTC", "on every release"
  "artifact_policy": string,            // what to capture (screenshots, files)
  "retry_policy": string,
  "takeover_policy": string,            // when to pause for a human
  "risk_notes": string[],               // fragility/risk warnings
  "clarifying_questions": string[]      // ask instead of guessing when underspecified
}
Node types: start, computer_use_task, cli_agent_task, shell_task, condition, human_takeover, retry_wait, end.
Insert a human_takeover node wherever login/MFA/captcha/device-trust will likely block the agent.
Rules: exactly one start and one end; every node reachable from start.`;

export type AutomationDraft = {
  automation: Automation;
  workflow: Workflow;
  clarifyingQuestions: string[];
  warnings: string[];
  errors: string[];
};

type RawDraft = Record<string, unknown>;

/** Widest {...} span in the agent output that parses as an object. */
function extractDraft(structuredOutput: unknown, stdout: string): RawDraft | undefined {
  const isObj = (v: unknown): v is RawDraft => !!v && typeof v === "object" && !Array.isArray(v);
  if (isObj(structuredOutput)) return structuredOutput;
  for (const text of [typeof structuredOutput === "string" ? structuredOutput : "", stdout]) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        const p = JSON.parse(text.slice(first, last + 1));
        if (isObj(p)) return p;
      } catch {
        /* try the next source */
      }
    }
  }
  return undefined;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function slugify(text: string): string {
  return text.slice(0, 24).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "draft";
}

export async function draftAutomation(
  prompt: string,
  agentExec: AgentExec,
  opts: { id?: string; provider?: AgentProvider; now?: () => string } = {},
): Promise<AutomationDraft> {
  const now = opts.now ?? (() => new Date().toISOString());
  const slug = opts.id ?? slugify(prompt);
  const automationId = `auto_${slug}`;
  const workflowId = `wf_${slug}`;

  const result = await runCliAgent(
    {
      provider: opts.provider ?? "claude-code",
      prompt: `${DRAFT_SYSTEM}\n\nUser description:\n${prompt}`,
      secrets: {},
      allowApiFallback: false,
    },
    agentExec,
  );

  const raw = extractDraft(result.structuredOutput, result.stdout) ?? {};
  const gotGraph = Array.isArray(raw.nodes);
  const workflow = normalizeWorkflow(
    { name: str(raw.name, prompt.slice(0, 60)), nodes: gotGraph ? (raw.nodes as never[]) : [], edges: (raw.edges as never[]) ?? [] },
    workflowId,
  );
  const errors = gotGraph ? validateWorkflow(workflow) : ["drafter did not return a workflow graph"];

  const timestamp = now();
  const automation: Automation = {
    id: automationId,
    name: str(raw.name, prompt.slice(0, 60) || "Untitled automation"),
    goal: str(raw.goal, prompt),
    category: str(raw.category, "general") || "general",
    target: str(raw.target),
    specMarkdown: str(raw.spec_markdown),
    workflowId: workflow.id,
    successCriteria: strList(raw.success_criteria),
    requiredSecrets: strList(raw.required_secrets),
    mfaExpectation: str(raw.mfa_expectation) || undefined,
    artifactPolicy: str(raw.artifact_policy, "Capture a screenshot at every task step."),
    retryPolicy: str(raw.retry_policy, "No automatic retries until reviewed."),
    takeoverPolicy: str(raw.takeover_policy, "Pause for a human on login, MFA, or captcha."),
    triggerSuggestion: str(raw.trigger_suggestion) || undefined,
    riskNotes: strList(raw.risk_notes),
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    automation,
    workflow,
    clarifyingQuestions: strList(raw.clarifying_questions),
    warnings: [
      ...automation.riskNotes,
      "Run this automation once and review the evidence before enabling a schedule.",
    ],
    errors,
  };
}
