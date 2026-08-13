"use client";

// Prompt-to-automation: describe the task in plain language, review the drafted
// automation (not a silent workflow), provide secrets contextually, then save —
// with a strong nudge to run once before enabling any schedule.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { sendJson } from "@/lib/ui/api";
import { categoryLabel } from "@/lib/ui/format";
import type { AutomationDraft } from "@/lib/fleet/automation-draft";
import type { WorkflowRun } from "@/lib/fleet/types";

const CATEGORIES = [
  "general",
  "semantic_test",
  "data_extraction",
  "form_fill",
  "account_setup",
  "report_download",
  "marketing",
];

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-white/60">
      <span className="font-semibold text-white/80">{props.label}</span>
      {props.children}
      {props.hint ? <span className="text-white/40">{props.hint}</span> : null}
    </label>
  );
}

const inputCls =
  "rounded-[5px] border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]/50";

export function DraftComposer() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});

  const patchAutomation = (fields: Partial<AutomationDraft["automation"]>) =>
    setDraft((d) => (d ? { ...d, automation: { ...d.automation, ...fields } } : d));

  async function createDraft() {
    setBusy("draft");
    setError(null);
    try {
      const result = await sendJson<AutomationDraft>("/api/automations/draft", "POST", { prompt });
      setDraft(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function save(runOnce: boolean) {
    if (!draft) return;
    setBusy(runOnce ? "run" : "save");
    setError(null);
    try {
      // Save any secrets the user typed (best-effort: needs CUF_SECRET_KEY server-side).
      for (const [name, value] of Object.entries(secretValues)) {
        if (!value) continue;
        await sendJson("/api/secrets", "POST", { name, scope: "workflow", value }).catch(() => undefined);
      }
      await sendJson("/api/automations", "POST", {
        automation: draft.automation,
        workflow: draft.workflow,
      });
      if (runOnce) {
        const run = await sendJson<WorkflowRun>(`/api/automations/${draft.automation.id}/run`, "POST", {});
        router.push(`/runs/${run.id}`);
      } else {
        router.push(`/automations/${draft.automation.id}`);
      }
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-6 md:px-12">
      <h1 className="text-2xl font-semibold tracking-tight text-white">New automation</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Describe the browser or desktop task in plain language. You review a draft before anything
        is saved or run.
      </p>

      <section className="glass glass-border mt-5 rounded-[5px] p-4">
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-white">What should this automation do?</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. Log into portal.example.com, download the weekly usage report, and confirm the totals page renders."
            className={inputCls}
          />
        </label>
        <button
          type="button"
          disabled={!prompt.trim() || busy === "draft"}
          onClick={() => void createDraft()}
          className="perceo-primary mt-3 inline-flex h-10 items-center gap-2 rounded-[5px] px-4 text-sm font-semibold disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {busy === "draft" ? "Drafting…" : "Draft automation"}
        </button>
        {error ? <p className="mt-3 text-sm text-[#fca5a5]">{error}</p> : null}
      </section>

      {draft ? (
        <section className="glass glass-border mt-5 rounded-[5px]">
          <div className="border-b border-white/[0.08] px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Review the draft</h2>
            <p className="mt-1 text-xs text-white/45">
              Edit anything below. The workflow graph underneath stays editable later from the
              automation&apos;s Advanced tab.
            </p>
          </div>

          {draft.clarifyingQuestions.length > 0 ? (
            <div className="border-b border-white/[0.08] bg-[#8b5cf6]/10 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#c4b5fd]">
                The drafter needs more detail
              </h3>
              <ul className="mt-2 grid gap-1 text-sm text-white/80">
                {draft.clarifyingQuestions.map((q) => (
                  <li key={q}>• {q}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-white/50">
                Answer by refining your description above and re-drafting, or edit the fields below.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
            <Field label="Name">
              <input
                className={inputCls}
                value={draft.automation.name}
                onChange={(e) => patchAutomation({ name: e.target.value })}
              />
            </Field>
            <Field label="Category">
              <select
                className={inputCls}
                value={draft.automation.category}
                onChange={(e) => patchAutomation({ category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Goal">
              <input
                className={inputCls}
                value={draft.automation.goal}
                onChange={(e) => patchAutomation({ goal: e.target.value })}
              />
            </Field>
            <Field label="Target site / app">
              <input
                className={inputCls}
                value={draft.automation.target}
                onChange={(e) => patchAutomation({ target: e.target.value })}
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Steps (plain language)">
                <textarea
                  className={inputCls}
                  rows={6}
                  value={draft.automation.specMarkdown}
                  onChange={(e) => patchAutomation({ specMarkdown: e.target.value })}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field
                label="Success criteria"
                hint="One per line. Reviewed by a human against the run's screenshots and artifacts."
              >
                <textarea
                  className={inputCls}
                  rows={3}
                  value={draft.automation.successCriteria.join("\n")}
                  onChange={(e) =>
                    patchAutomation({ successCriteria: e.target.value.split("\n").filter(Boolean) })
                  }
                />
              </Field>
            </div>
            <Field label="Trigger suggestion" hint="Nothing is scheduled until you add a trigger yourself.">
              <input
                className={inputCls}
                value={draft.automation.triggerSuggestion ?? ""}
                onChange={(e) => patchAutomation({ triggerSuggestion: e.target.value || undefined })}
              />
            </Field>
            <Field label="MFA / takeover expectation">
              <input
                className={inputCls}
                value={draft.automation.mfaExpectation ?? ""}
                onChange={(e) => patchAutomation({ mfaExpectation: e.target.value || undefined })}
              />
            </Field>
          </div>

          {draft.automation.requiredSecrets.length > 0 ? (
            <div className="border-t border-white/[0.08] px-4 py-4">
              <h3 className="text-sm font-semibold text-white">Secrets this automation needs</h3>
              <p className="mt-1 text-xs text-white/45">
                Enter them now or later. Values are typed into the remote desktop during runs and
                never appear in logs. If the site uses device trust or repeated MFA, prefer a
                prepared environment that is already logged in.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {draft.automation.requiredSecrets.map((name) => (
                  <Field key={name} label={name}>
                    <input
                      type="password"
                      className={inputCls}
                      placeholder="leave blank to provide later"
                      value={secretValues[name] ?? ""}
                      onChange={(e) => setSecretValues((s) => ({ ...s, [name]: e.target.value }))}
                    />
                  </Field>
                ))}
              </div>
            </div>
          ) : null}

          {draft.warnings.length > 0 ? (
            <div className="border-t border-white/[0.08] px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Before you rely on this
              </h3>
              <ul className="mt-2 grid gap-1 text-sm text-zinc-400">
                {draft.warnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {draft.errors.length > 0 ? (
            <div className="border-t border-white/[0.08] bg-[#f87171]/10 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#fca5a5]">
                Draft problems
              </h3>
              <ul className="mt-2 grid gap-1 text-sm text-[#fca5a5]">
                {draft.errors.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.08] px-4 py-4">
            <button
              type="button"
              disabled={busy !== null || draft.errors.length > 0}
              onClick={() => void save(true)}
              className="perceo-primary inline-flex h-10 items-center rounded-[5px] px-4 text-sm font-semibold disabled:opacity-50"
            >
              {busy === "run" ? "Starting…" : "Save + run once"}
            </button>
            <button
              type="button"
              disabled={busy !== null || draft.errors.length > 0}
              onClick={() => void save(false)}
              className="inline-flex h-10 items-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-4 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50"
            >
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <span className="text-xs text-white/45">
              Drafts stay disabled until you have watched one run succeed.
            </span>
          </div>
        </section>
      ) : null}
    </main>
  );
}
