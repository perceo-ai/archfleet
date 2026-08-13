"use client";

// Automation detail: the plain-language spec editor is the primary surface;
// the workflow graph lives under Advanced for power users and debugging.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { getJson, sendJson, usePolling } from "@/lib/ui/api";
import { timeAgo, duration, categoryLabel } from "@/lib/ui/format";
import {
  automationHealthTone,
  automationStatusTone,
  runStatusTone,
  statusLabel,
} from "@/components/fleet/status-colors";
import { WorkflowCanvas } from "@/components/fleet/WorkflowCanvas";
import { formatEvidenceChecks, parseEvidenceChecks } from "@/lib/fleet/evidence-checks";
import type { RunSummary } from "@/lib/fleet/db/runs-repo";
import type {
  Automation,
  AutomationHealth,
  PreparedEnvironment,
  Trigger,
  Workflow,
  WorkflowRun,
} from "@/lib/fleet/types";

type Detail = {
  automation: Automation;
  workflow?: Workflow;
  environment?: PreparedEnvironment;
  triggers: Trigger[];
  runs: RunSummary[];
  health: AutomationHealth;
  lastRun?: RunSummary;
};

type Tab = "spec" | "runs" | "advanced";

const inputCls =
  "rounded-[5px] border border-white/[0.08] bg-[#161616] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]/50";

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-white/60">
      <span className="font-semibold text-white/80">{props.label}</span>
      {props.children}
      {props.hint ? <span className="text-white/40">{props.hint}</span> : null}
    </label>
  );
}

export function AutomationDetail({ id }: { id: string }) {
  const router = useRouter();
  const detail = usePolling<Detail>(`/api/automations/${id}`, 8000);
  const [tab, setTab] = useState<Tab>("spec");
  const [edit, setEdit] = useState<Automation | null>(null);
  const [environments, setEnvironments] = useState<PreparedEnvironment[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [cron, setCron] = useState("0 9 * * *");

  const automation = detail.data?.automation;
  useEffect(() => {
    // Adopt the fetched automation into the edit buffer once (don't clobber edits).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEdit((prev) => prev ?? automation ?? null);
  }, [automation]);
  useEffect(() => {
    getJson<PreparedEnvironment[]>("/api/environments")
      .then(setEnvironments)
      .catch(() => undefined);
  }, []);

  if (!detail.data || !edit) {
    return (
      <main className="mx-auto w-full max-w-5xl px-5 py-10 md:px-12">
        <p className="text-sm text-white/45">{detail.error ?? "Loading automation…"}</p>
      </main>
    );
  }
  const { workflow, environment, triggers, runs, health } = detail.data;

  const patch = (fields: Partial<Automation>) => setEdit((e) => (e ? { ...e, ...fields } : e));

  async function saveSpec() {
    if (!edit) return;
    setMessage(null);
    try {
      await sendJson(`/api/automations/${id}`, "PATCH", edit);
      setMessage("Saved.");
      await detail.refresh();
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function setStatus(status: Automation["status"]) {
    await sendJson(`/api/automations/${id}`, "PATCH", { status }).catch((e) => setMessage(String(e)));
    patch({ status });
    await detail.refresh();
  }

  async function runNow() {
    try {
      const run = await sendJson<WorkflowRun>(`/api/automations/${id}/run`, "POST", {});
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function addTrigger(type: "schedule" | "webhook") {
    if (!edit) return;
    setMessage(null);
    try {
      const res = await sendJson<{ trigger: Trigger; webhookToken?: string }>("/api/triggers", "POST", {
        workflowId: edit.workflowId,
        type,
        cron: type === "schedule" ? cron : undefined,
      });
      if (res.webhookToken) setWebhookToken(res.webhookToken);
      await detail.refresh();
    } catch (e) {
      setMessage(String(e));
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-6 md:px-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-white">{edit.name}</h1>
            <span className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${automationHealthTone(health)}`}>
              {statusLabel(health)}
            </span>
            <span className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${automationStatusTone(edit.status)}`}>
              {edit.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            {categoryLabel(edit.category)}
            {edit.target ? ` · ${edit.target}` : ""}
            {environment ? ` · ${environment.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {edit.status === "draft" ? (
            <button
              type="button"
              onClick={() => void setStatus("active")}
              className="inline-flex h-10 items-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-4 text-sm font-semibold text-white hover:bg-white/[0.08]"
            >
              Activate
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void setStatus(edit.status === "disabled" ? "active" : "disabled")}
              className="inline-flex h-10 items-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-4 text-sm font-semibold text-white hover:bg-white/[0.08]"
            >
              {edit.status === "disabled" ? "Enable" : "Disable"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void runNow()}
            className="perceo-primary inline-flex h-10 items-center gap-2 rounded-[5px] px-4 text-sm font-semibold"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Run now
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Automation views" className="mt-5 flex gap-2">
        {(
          [
            { key: "spec", label: "Spec" },
            { key: "runs", label: `Runs (${runs.length})` },
            { key: "advanced", label: "Advanced" },
          ] as { key: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-[5px] border px-3 py-1.5 text-xs font-semibold transition ${
              tab === t.key
                ? "border-[#8b5cf6]/50 bg-[#8b5cf6]/20 text-[#c4b5fd]"
                : "border-white/[0.08] bg-white/[0.05] text-white/60 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message ? <p className="mt-3 text-sm text-white/60">{message}</p> : null}

      {tab === "spec" ? (
        <section className="glass glass-border mt-4 rounded-[5px]">
          <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
            <Field label="Name">
              <input className={inputCls} value={edit.name} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label="Goal">
              <input className={inputCls} value={edit.goal} onChange={(e) => patch({ goal: e.target.value })} />
            </Field>
            <Field label="Category">
              <input className={inputCls} value={edit.category} onChange={(e) => patch({ category: e.target.value })} />
            </Field>
            <Field label="Target site / app">
              <input className={inputCls} value={edit.target} onChange={(e) => patch({ target: e.target.value })} />
            </Field>
            <Field label="Prepared environment" hint="The reusable logged-in desktop this runs on.">
              <select
                className={inputCls}
                value={edit.environmentId ?? ""}
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
            <Field label="Required secrets" hint="Comma-separated names; add values on the run or Environments page.">
              <input
                className={inputCls}
                value={edit.requiredSecrets.join(", ")}
                onChange={(e) =>
                  patch({ requiredSecrets: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                }
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Steps (plain language)">
                <textarea
                  className={inputCls}
                  rows={7}
                  value={edit.specMarkdown}
                  onChange={(e) => patch({ specMarkdown: e.target.value })}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Success criteria" hint="One per line — reviewed against run evidence.">
                <textarea
                  className={inputCls}
                  rows={3}
                  value={edit.successCriteria.join("\n")}
                  onChange={(e) => patch({ successCriteria: e.target.value.split("\n").filter(Boolean) })}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field
                label="Automated evidence checks"
                hint="One per line, evaluated after each run: text_found: <text> · url_reached: <url> · file_downloaded: <name> · screenshot_captured"
              >
                <textarea
                  className={inputCls}
                  rows={3}
                  value={formatEvidenceChecks(edit.evidenceChecks ?? [])}
                  onChange={(e) => patch({ evidenceChecks: parseEvidenceChecks(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="Artifacts to capture">
              <input className={inputCls} value={edit.artifactPolicy} onChange={(e) => patch({ artifactPolicy: e.target.value })} />
            </Field>
            <Field label="Retry behavior">
              <input className={inputCls} value={edit.retryPolicy} onChange={(e) => patch({ retryPolicy: e.target.value })} />
            </Field>
            <Field label="Human takeover points">
              <input className={inputCls} value={edit.takeoverPolicy} onChange={(e) => patch({ takeoverPolicy: e.target.value })} />
            </Field>
            <Field label="MFA expectation">
              <input
                className={inputCls}
                value={edit.mfaExpectation ?? ""}
                onChange={(e) => patch({ mfaExpectation: e.target.value || undefined })}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3 border-t border-white/[0.08] px-4 py-3">
            <button
              type="button"
              onClick={() => void saveSpec()}
              className="perceo-primary inline-flex h-9 items-center rounded-[5px] px-4 text-sm font-semibold"
            >
              Save spec
            </button>
          </div>

          <div className="border-t border-white/[0.08] px-4 py-4">
            <h3 className="text-sm font-semibold text-white">Triggers</h3>
            {edit.triggerSuggestion ? (
              <p className="mt-1 text-xs text-white/45">Suggestion from the draft: {edit.triggerSuggestion}</p>
            ) : null}
            <ul className="mt-2 grid gap-1 text-sm text-zinc-400">
              {triggers.length === 0 ? <li>Manual only — no schedule or webhook yet.</li> : null}
              {triggers.map((t) => (
                <li key={t.id}>
                  {t.type}
                  {t.cron ? ` · ${t.cron}` : ""}
                  {t.nextRunAt ? ` · next ${timeAgo(t.nextRunAt)}` : ""}
                  {!t.enabled ? " · disabled" : ""}
                </li>
              ))}
            </ul>
            {webhookToken ? (
              <p className="mt-2 break-all rounded-[5px] bg-[#161616] px-3 py-2 text-xs text-[#c4b5fd]">
                Webhook token (shown once): {webhookToken} — POST /api/webhooks/{webhookToken}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                aria-label="Cron expression"
                className={`${inputCls} w-36`}
                value={cron}
                onChange={(e) => setCron(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void addTrigger("schedule")}
                className="inline-flex h-9 items-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-semibold text-white hover:bg-white/[0.08]"
              >
                Add schedule
              </button>
              <button
                type="button"
                onClick={() => void addTrigger("webhook")}
                className="inline-flex h-9 items-center rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-semibold text-white hover:bg-white/[0.08]"
              >
                Add webhook
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "runs" ? (
        <section className="glass glass-border mt-4 rounded-[5px]">
          <div className="divide-y divide-white/[0.08]">
            {runs.length === 0 ? (
              <p className="px-4 py-8 text-sm text-white/45">No runs yet. Run it once to build history.</p>
            ) : (
              runs.map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-white/[0.05]"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">
                      {timeAgo(r.startedAt)} · {duration(r.startedAt, r.finishedAt)}
                    </div>
                    <div className="truncate text-xs text-white/45">{r.resultSummary ?? r.currentStep ?? r.id}</div>
                  </div>
                  <span className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${runStatusTone(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
      ) : null}

      {tab === "advanced" ? (
        <section className="mt-4">
          <p className="mb-3 text-xs text-white/45">
            The workflow graph the automation executes. Most edits belong in the Spec tab; use this
            for debugging and precise control.
          </p>
          {workflow ? (
            <WorkflowCanvas
              workflow={workflow}
              onSave={async (wf) => {
                const res = await fetch("/api/workflows", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(wf),
                });
                const data = await res.json().catch(() => ({}));
                return res.ok ? { ok: true } : { ok: false, errors: (data.errors as string[]) ?? [data.error] };
              }}
              className="h-[560px]"
            />
          ) : (
            <p className="text-sm text-[#fca5a5]">Workflow {edit.workflowId} not found.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
