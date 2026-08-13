"use client";

// Automation-first home: what needs a human, what's running, what failed, and the
// automations themselves. Fleet health is a compact status strip, not the landing
// experience (see docs/2026-08-12-archfleet-ux-backend-strategy.md, "Home UX").

import Link from "next/link";
import { Play, Plus } from "lucide-react";
import { usePolling } from "@/lib/ui/api";
import { timeAgo, categoryLabel } from "@/lib/ui/format";
import {
  automationHealthTone,
  automationStatusTone,
  environmentHealthTone,
  runStatusTone,
  statusLabel,
} from "@/components/fleet/status-colors";
import type { RunSummary } from "@/lib/fleet/db/runs-repo";
import type {
  Automation,
  AutomationHealth,
  FleetVm,
  HumanTakeover,
  PreparedEnvironment,
} from "@/lib/fleet/types";

type AutomationWithHealth = Automation & { health: AutomationHealth; lastRun?: RunSummary };

function SectionCard(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="glass glass-border rounded-[5px]">
      <div className="border-b border-white/[0.08] px-4 py-3">
        <h2 className="text-sm font-semibold text-white">{props.title}</h2>
        {props.subtitle ? <p className="mt-1 text-xs text-white/45">{props.subtitle}</p> : null}
      </div>
      {props.children}
    </section>
  );
}

function RunRow({ run }: { run: RunSummary }) {
  return (
    <Link
      href={`/runs/${run.id}`}
      className="grid gap-1 px-4 py-3 transition hover:bg-white/[0.05]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-white">{run.workflowName}</span>
        <span className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${runStatusTone(run.status)}`}>
          {statusLabel(run.status)}
        </span>
      </div>
      <div className="text-xs text-white/45">
        {run.currentStep ? `${run.currentStep} · ` : ""}
        {timeAgo(run.startedAt)}
        {run.resultSummary ? ` · ${run.resultSummary}` : ""}
      </div>
    </Link>
  );
}

export function HomeDashboard() {
  const automations = usePolling<AutomationWithHealth[]>("/api/automations", 8000);
  const runs = usePolling<RunSummary[]>("/api/runs", 5000);
  const takeovers = usePolling<HumanTakeover[]>("/api/takeovers?status=open", 5000);
  const environments = usePolling<PreparedEnvironment[]>("/api/environments", 30000);
  const vms = usePolling<FleetVm[]>("/api/vms", 15000);

  const allRuns = runs.data ?? [];
  const active = allRuns.filter((r) => r.status === "running" || r.status === "queued");
  const failed = allRuns.filter((r) => r.status === "failed").slice(0, 5);
  const allAutomations = automations.data ?? [];
  const drafts = allAutomations.filter((a) => a.status === "draft");
  const semanticTests = allAutomations.filter((a) => a.category === "semantic_test");
  const attentionEnvs = (environments.data ?? []).filter(
    (e) => e.health === "degraded" || e.health === "recovering",
  );
  const openTakeovers = takeovers.data ?? [];
  const vmList = vms.data ?? [];
  const vmsOnline = vmList.filter((v) => v.status !== "stopped" && v.status !== "unhealthy").length;

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-6 md:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-white/40">Automations</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
            Describe a task. Watch it run. Keep the evidence.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Automations run browser and desktop work on prepared environments, pause for you on
            login or MFA, and save screenshots and artifacts from every run.
          </p>
        </div>
        <Link
          href="/automations/new"
          className="perceo-primary inline-flex h-10 items-center gap-2 rounded-[5px] px-4 text-sm font-semibold"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New automation
        </Link>
      </div>

      {openTakeovers.length > 0 ? (
        <SectionCard
          title="Needs your input"
          subtitle="These runs are paused on a held desktop, waiting for a human."
        >
          <div className="divide-y divide-white/[0.08]">
            {openTakeovers.map((t) => (
              <Link
                key={t.id}
                href={`/runs/${t.runId}`}
                className="grid gap-1 px-4 py-3 transition hover:bg-white/[0.05]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-white">{t.reason}</span>
                  <span className="rounded-[5px] bg-[#8b5cf6]/20 px-2 py-0.5 text-xs font-semibold text-[#c4b5fd] ring-1 ring-[#8b5cf6]/30">
                    take over
                  </span>
                </div>
                <div className="text-xs text-white/45">
                  {t.requestedAction} · {timeAgo(t.openedAt)}
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_360px]">
        <div className="grid content-start gap-5">
          <SectionCard title="Your automations" subtitle="Most recently updated first.">
            <div className="divide-y divide-white/[0.08]">
              {allAutomations.length === 0 ? (
                <p className="px-4 py-6 text-sm text-white/45">
                  No automations yet. Describe one in plain language to get started.
                </p>
              ) : (
                allAutomations.slice(0, 8).map((a) => (
                  <Link
                    key={a.id}
                    href={`/automations/${a.id}`}
                    className="grid w-full gap-2 px-4 py-4 text-left transition hover:bg-white/[0.05]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-base font-semibold text-white">{a.name}</h3>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${automationHealthTone(a.health)}`}
                        >
                          {statusLabel(a.health)}
                        </span>
                        <span
                          className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${automationStatusTone(a.status)}`}
                        >
                          {a.status}
                        </span>
                      </div>
                    </div>
                    <p className="truncate text-sm text-zinc-400">{a.goal}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-white/55">
                      <span className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-0.5">
                        {categoryLabel(a.category)}
                      </span>
                      {a.target ? (
                        <span className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-0.5">
                          {a.target}
                        </span>
                      ) : null}
                      {a.lastRun ? (
                        <span>last run {timeAgo(a.lastRun.startedAt)}</span>
                      ) : (
                        <span>never run</span>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
            <div className="border-t border-white/[0.08] px-4 py-2">
              <Link href="/automations" className="text-xs font-semibold text-[#c4b5fd] hover:text-white">
                All automations →
              </Link>
            </div>
          </SectionCard>

          {semanticTests.length > 0 ? (
            <SectionCard
              title="Semantic tests"
              subtitle="Product-flow checks that run like release gates."
            >
              <div className="divide-y divide-white/[0.08]">
                {semanticTests.slice(0, 4).map((a) => (
                  <Link
                    key={a.id}
                    href={`/automations/${a.id}`}
                    className="flex items-center justify-between gap-2 px-4 py-3 transition hover:bg-white/[0.05]"
                  >
                    <span className="truncate text-sm font-medium text-white">{a.name}</span>
                    <span
                      className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${automationHealthTone(a.health)}`}
                    >
                      {statusLabel(a.health)}
                    </span>
                  </Link>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </div>

        <aside className="grid content-start gap-3">
          <SectionCard title="Running now">
            {active.length === 0 ? (
              <p className="px-4 py-4 text-sm text-white/45">Nothing running.</p>
            ) : (
              <div className="divide-y divide-white/[0.08]">
                {active.slice(0, 5).map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </div>
            )}
          </SectionCard>

          {failed.length > 0 ? (
            <SectionCard title="Recent failures">
              <div className="divide-y divide-white/[0.08]">
                {failed.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </div>
            </SectionCard>
          ) : null}

          {drafts.length > 0 ? (
            <SectionCard title="Drafts" subtitle="Review, run once, then activate.">
              <div className="divide-y divide-white/[0.08]">
                {drafts.slice(0, 4).map((a) => (
                  <Link
                    key={a.id}
                    href={`/automations/${a.id}`}
                    className="flex items-center justify-between gap-2 px-4 py-3 transition hover:bg-white/[0.05]"
                  >
                    <span className="truncate text-sm font-medium text-white">{a.name}</span>
                    <Play className="h-4 w-4 text-white/40" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {attentionEnvs.length > 0 ? (
            <SectionCard title="Environments needing attention">
              <div className="divide-y divide-white/[0.08]">
                {attentionEnvs.map((e) => (
                  <Link
                    key={e.id}
                    href="/environments"
                    className="flex items-center justify-between gap-2 px-4 py-3 transition hover:bg-white/[0.05]"
                  >
                    <span className="truncate text-sm font-medium text-white">{e.name}</span>
                    <span
                      className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${environmentHealthTone(e.health)}`}
                    >
                      {statusLabel(e.health)}
                    </span>
                  </Link>
                ))}
              </div>
            </SectionCard>
          ) : null}

          <section className="glass rounded-[5px] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">Fleet</h2>
              <Link href="/fleet" className="text-xs font-semibold text-[#c4b5fd] hover:text-white">
                Operate →
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/55">
              <div>
                <div className="text-lg font-semibold text-white">{vmsOnline}</div>
                <div>VMs online</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-white">{active.length}</div>
                <div>active runs</div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
