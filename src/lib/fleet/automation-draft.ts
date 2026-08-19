// Prompt-to-automation drafting: turn a plain-language description into a draft
// Automation (goal, spec, criteria, secrets, policies) plus a disabled workflow
// graph, in one CLI-agent call. The agent call is injected (AgentExec) so this is
// unit tested with a fake. Drafts are for review — they never auto-enable.

import { runCliAgent, type AgentExec } from "./cli-agent-runner";
import { normalizeWorkflow } from "./planner";
import { validateWorkflow } from "./workflow-validation";
import { CHECK_TYPES, type EvidenceCheck } from "./evidence-checks";
import type { AgentProvider, Automation, Workflow } from "./types";

function checkList(v: unknown): EvidenceCheck[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (c): c is EvidenceCheck =>
        !!c && typeof c === "object" && CHECK_TYPES.includes((c as EvidenceCheck).type),
    )
    .map((c) => (typeof c.value === "string" && c.value ? { type: c.type, value: c.value } : { type: c.type }));
}

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
  "clarifying_questions": string[],     // ask instead of guessing when underspecified
  "evidence_checks": [{"type":"text_found"|"url_reached"|"file_downloaded"|"screenshot_captured"|"element_visible"|"form_submitted"|"email_received"|"output_extracted"|"visual_state_changed","value"?:string}]
}
Node types: start, browser_task, computer_use_task, cli_agent_task, shell_task, api_call,
condition, switch, wait, set_params, human_takeover, retry_wait, end.
Insert a human_takeover node wherever the agent will likely be blocked (login, a verification
code, an ambiguous choice, a spend that needs approval). Its config.ask states what to ask for:
{"kind":"input|choice|approval|acknowledge","question":"...","fields":[{"name":"po","label":"PO number","type":"text","secret":false}]}
Answers come back as {{param.<name>}} (or {{secret.<name>}} when the field is secret).

Rules and data flow — prefer these over asking a model to decide:
- Every node's result is readable by later nodes as steps["Node name"], e.g.
  steps["Fetch invoices"].body.total, steps["Sign in"].stdout, steps["Call"].status.
- condition: config.expr is a rule, e.g. steps["Fetch"].body.total > 1000 && params.region == "eu".
  True follows the success edge, false the failure edge.
- switch: config.cases is [{"label":"large","expr":"..."}]; the first true case wins and its edge
  is condition "case:large". Every case needs its own outgoing edge.
- wait: config.waitMs pauses; or config.untilExpr plus config.prompt (a JSON request) polls that
  request until the rule holds, giving up after config.timeoutMs.
- set_params: config.assign maps a param name to an expression, e.g. {"total":"steps[\"Fetch\"].body.total * 2"}.
Operators: == != > >= < <= && || ! + - * / % ? : — functions: len lower upper trim contains
startsWith endsWith matches number string default has json split join replace round abs min max.

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

function extractTarget(prompt: string): string {
  return (prompt.match(/https?:\/\/[^\s,)]+/i)?.[0] ?? "").replace(/[)\].,;!?]+$/, "");
}

function fallbackGraph(prompt: string): RawDraft {
  const target = extractTarget(prompt);
  const evidenceChecks: EvidenceCheck[] = [{ type: "screenshot_captured" }, { type: "visual_state_changed" }];
  const taskNode = target
    ? {
        id: "run_task",
        type: "browser_task",
        name: "Open and inspect page",
        config: {
          prompt: JSON.stringify([{ goto: target }, { wait: 1000 }]),
          requiredLabels: ["browser"],
        },
      }
    : {
        id: "run_task",
        type: "computer_use_task",
        name: "Run requested task",
        config: {
          prompt: [
            prompt,
            "Capture screenshots as evidence.",
            "Pause for a human if login, MFA, captcha, or device trust blocks progress.",
          ].join("\n"),
          requiredLabels: ["browser"],
        },
      };
  return {
    name: prompt.slice(0, 60) || "Draft automation",
    goal: prompt,
    category: target ? "semantic_test" : "general",
    target,
    spec_markdown: `1. Open ${target || "the target app"}.\n2. Complete the requested task: ${prompt}\n3. Capture evidence and verify the success criteria.`,
    nodes: [
      { id: "start", type: "start", name: "Start" },
      taskNode,
      { id: "end", type: "end", name: "End" },
    ],
    edges: [
      { from: "start", to: "run_task", condition: "always" },
      { from: "run_task", to: "end", condition: "success" },
    ],
    required_secrets: [],
    mfa_expectation: null,
    success_criteria: [`The requested task is complete: ${prompt}`],
    artifact_policy: "Capture screenshots at important state changes and at completion.",
    retry_policy: "Retry once only after reviewing the first failed run.",
    takeover_policy: "Pause for a human on login, MFA, captcha, or device trust.",
    risk_notes: ["The copilot used a generic computer-use workflow because the drafter did not return a complete graph."],
    clarifying_questions: [],
    evidence_checks: evidenceChecks,
  };
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
  const gotGraph = Array.isArray(raw.nodes) && raw.nodes.length > 0;
  const fallback = fallbackGraph(prompt);
  const effectiveRaw = gotGraph ? raw : { ...fallback, ...raw, nodes: fallback.nodes, edges: fallback.edges };
  const workflow = normalizeWorkflow(
    {
      name: str(effectiveRaw.name, prompt.slice(0, 60)),
      nodes: (effectiveRaw.nodes as never[]) ?? [],
      edges: (effectiveRaw.edges as never[]) ?? [],
    },
    workflowId,
  );
  const errors = validateWorkflow(workflow);

  const timestamp = now();
  const automation: Automation = {
    id: automationId,
    name: str(effectiveRaw.name, prompt.slice(0, 60) || "Untitled automation"),
    goal: str(effectiveRaw.goal, prompt),
    category: str(effectiveRaw.category, "general") || "general",
    target: str(effectiveRaw.target),
    specMarkdown: str(effectiveRaw.spec_markdown),
    workflowId: workflow.id,
    successCriteria: strList(effectiveRaw.success_criteria),
    requiredSecrets: strList(effectiveRaw.required_secrets),
    mfaExpectation: str(effectiveRaw.mfa_expectation) || undefined,
    artifactPolicy: str(effectiveRaw.artifact_policy, "Capture a screenshot at every task step."),
    retryPolicy: str(effectiveRaw.retry_policy, "No automatic retries until reviewed."),
    takeoverPolicy: str(effectiveRaw.takeover_policy, "Pause for a human on login, MFA, or captcha."),
    triggerSuggestion: str(effectiveRaw.trigger_suggestion) || undefined,
    riskNotes: strList(effectiveRaw.risk_notes),
    evidenceChecks: checkList(effectiveRaw.evidence_checks),
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    automation,
    workflow,
    clarifyingQuestions: strList(effectiveRaw.clarifying_questions),
    warnings: [
      ...automation.riskNotes,
      "Run this automation once and review the evidence before enabling a schedule.",
    ],
    errors,
  };
}
