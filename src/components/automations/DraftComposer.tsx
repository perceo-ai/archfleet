"use client";

// Prompt-to-automation: describe the task in plain language, review the drafted
// automation (not a silent workflow), provide secrets contextually, then save —
// with a strong nudge to run once before enabling any schedule.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJson, sendJson } from "@/lib/ui/api";
import { categoryLabel } from "@/lib/ui/format";
import { AutomationCopilot } from "@/components/automations/AutomationCopilot";
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  // Per-secret choice: type it now, reference a saved secret, or pause the run
  // for a human to enter it on the desktop (spec "Secrets and MFA UX").
  const [secretModes, setSecretModes] = useState<Record<string, "enter" | "saved" | "takeover">>({});
  const [savedSecrets, setSavedSecrets] = useState<string[]>([]);

  useEffect(() => {
    if (!draft) return;
    getJson<{ name: string }[]>("/api/secrets")
      .then((list) => setSavedSecrets(list.map((s) => s.name)))
      .catch(() => undefined);
  }, [draft]);

  const patchAutomation = (fields: Partial<AutomationDraft["automation"]>) =>
    setDraft((d) => (d ? { ...d, automation: { ...d.automation, ...fields } } : d));

  async function save(runOnce: boolean) {
    if (!draft) return;
    setBusy(runOnce ? "run" : "save");
    setError(null);
    try {
      // Save typed secrets. A failure here stops the save loudly — the user chose
      // "enter now", so silently dropping the value would break their runs later.
      for (const name of draft.automation.requiredSecrets) {
        const mode = secretModes[name] ?? "enter";
        const value = secretValues[name];
        if (mode !== "enter" || !value) continue;
        try {
          await sendJson("/api/secrets", "POST", { name, scope: "workflow", value });
        } catch (e) {
          throw new Error(
            `Could not save secret "${name}": ${String(e)}. Choose "pause for me" or clear the value to continue without it.`,
          );
        }
      }
      // Takeover-mode secrets become explicit human-takeover policy on the automation.
      const takeoverSecrets = draft.automation.requiredSecrets.filter(
        (name) => secretModes[name] === "takeover",
      );
      const automation = takeoverSecrets.length
        ? {
            ...draft.automation,
            takeoverPolicy: [
              draft.automation.takeoverPolicy,
              `Pause for a human to enter ${takeoverSecrets.map((s) => `"${s}"`).join(", ")} on the desktop.`,
            ]
              .filter(Boolean)
              .join(" "),
          }
        : draft.automation;
      await sendJson("/api/automations", "POST", {
        automation,
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
    <main className="mx-auto w-full max-w-7xl px-5 py-6 md:px-12">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Automation copilot</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Chat with the copilot, review the proposed automation, then run it once from here.
      </p>
      {error ? <p className="mt-3 text-sm text-[#fca5a5]">{error}</p> : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
        <AutomationCopilot onApplyDraft={setDraft} title="Chat to build" />

        {draft ? (
          <section className="glass glass-border rounded-[5px]">
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
                {draft.automation.requiredSecrets.map((name) => {
                  const mode = secretModes[name] ?? "enter";
                  const saved = savedSecrets.includes(name);
                  return (
                    <Field key={name} label={name}>
                      <select
                        aria-label={`How to provide ${name}`}
                        className={inputCls}
                        value={mode}
                        onChange={(e) =>
                          setSecretModes((m) => ({ ...m, [name]: e.target.value as typeof mode }))
                        }
                      >
                        <option value="enter">Enter it now</option>
                        <option value="saved">Use a saved secret</option>
                        <option value="takeover">Pause the run for me to type it</option>
                      </select>
                      {mode === "enter" ? (
                        <input
                          type="password"
                          className={inputCls}
                          placeholder="leave blank to provide later"
                          value={secretValues[name] ?? ""}
                          onChange={(e) => setSecretValues((s) => ({ ...s, [name]: e.target.value }))}
                        />
                      ) : null}
                      {mode === "saved" ? (
                        <span className={saved ? "text-xs text-[#8add84]" : "text-xs text-[#c4b5fd]"}>
                          {saved
                            ? `Runs will use the saved secret "${name}".`
                            : `No saved secret named "${name}" yet — add it on the Environments page first.`}
                        </span>
                      ) : null}
                      {mode === "takeover" ? (
                        <span className="text-xs text-white/45">
                          The run pauses and holds the desktop; you type it in, then resume.
                        </span>
                      ) : null}
                    </Field>
                  );
                })}
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
        ) : (
          <section className="glass glass-border grid min-h-[420px] place-items-center rounded-[5px] px-6 text-center">
            <div>
              <h2 className="text-sm font-semibold text-white">No proposal yet</h2>
              <p className="mt-2 max-w-sm text-sm text-white/45">
                Ask the copilot for the browser or desktop work you want. The proposed automation appears here for review before anything is saved.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
