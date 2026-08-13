"use client";

// All automations with lenses — automations are first-class objects filtered by
// perspective (category, status, health, needs-human), not folders.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { usePolling } from "@/lib/ui/api";
import { timeAgo, categoryLabel } from "@/lib/ui/format";
import {
  automationHealthTone,
  automationStatusTone,
  statusLabel,
} from "@/components/fleet/status-colors";
import type { RunSummary } from "@/lib/fleet/db/runs-repo";
import type { Automation, AutomationHealth, HumanTakeover } from "@/lib/fleet/types";
import clsx from "clsx";

type AutomationWithHealth = Automation & { health: AutomationHealth; lastRun?: RunSummary };

const FIXED_LENSES = [
  { key: "all", label: "All" },
  { key: "semantic_tests", label: "Semantic tests" },
  { key: "drafts", label: "Drafts" },
  { key: "active", label: "Active" },
  { key: "failing", label: "Recently failed" },
  { key: "needs_human", label: "Needs human" },
] as const;

type LensKey = (typeof FIXED_LENSES)[number]["key"] | `cat:${string}`;

export function AutomationsList() {
  const automations = usePolling<AutomationWithHealth[]>("/api/automations", 10000);
  const takeovers = usePolling<HumanTakeover[]>("/api/takeovers?status=open", 10000);
  const [lens, setLens] = useState<LensKey>("all");

  const all = useMemo(() => automations.data ?? [], [automations.data]);
  const needsHumanRunIds = new Set((takeovers.data ?? []).map((t) => t.runId));

  const categories = useMemo(
    () => [...new Set(all.map((a) => a.category))].filter((c) => c !== "semantic_test").sort(),
    [all],
  );

  const visible = all.filter((a) => {
    switch (lens) {
      case "all":
        return true;
      case "semantic_tests":
        return a.category === "semantic_test";
      case "drafts":
        return a.status === "draft";
      case "active":
        return a.status === "active";
      case "failing":
        return a.health === "failing";
      case "needs_human":
        return a.health === "needs_attention" || (a.lastRun ? needsHumanRunIds.has(a.lastRun.id) : false);
      default:
        return lens.startsWith("cat:") ? a.category === lens.slice(4) : true;
    }
  });

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-6 md:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">All automations</h1>
          <p className="mt-1 text-sm text-zinc-400">
            One object per job-to-be-done: intent, workflow, environment, criteria, history.
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

      <div role="tablist" aria-label="Lenses" className="mt-5 flex flex-wrap gap-2">
        {[...FIXED_LENSES, ...categories.map((c) => ({ key: `cat:${c}` as LensKey, label: categoryLabel(c) }))].map(
          (item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={lens === item.key}
              onClick={() => setLens(item.key as LensKey)}
              className={clsx(
                "rounded-[5px] border px-3 py-1.5 text-xs font-semibold transition",
                lens === item.key
                  ? "border-[#8b5cf6]/50 bg-[#8b5cf6]/20 text-[#c4b5fd]"
                  : "border-white/[0.08] bg-white/[0.05] text-white/60 hover:text-white",
              )}
            >
              {item.label}
            </button>
          ),
        )}
      </div>

      <section className="glass glass-border mt-4 rounded-[5px]">
        <div className="divide-y divide-white/[0.08]">
          {visible.length === 0 ? (
            <p className="px-4 py-8 text-sm text-white/45">Nothing matches this lens.</p>
          ) : (
            visible.map((a) => (
              <Link
                key={a.id}
                href={`/automations/${a.id}`}
                className="grid w-full gap-2 px-4 py-4 text-left transition hover:bg-white/[0.05]"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-base font-semibold text-white">{a.name}</h3>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${automationHealthTone(a.health)}`}>
                      {statusLabel(a.health)}
                    </span>
                    <span className={`rounded-[5px] px-2 py-0.5 text-xs font-semibold ${automationStatusTone(a.status)}`}>
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
                    <span className="rounded-[5px] border border-white/[0.08] bg-white/[0.05] px-2 py-0.5">{a.target}</span>
                  ) : null}
                  <span>{a.lastRun ? `last run ${timeAgo(a.lastRun.startedAt)}` : "never run"}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
