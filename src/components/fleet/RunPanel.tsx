import { Pause, Play, RotateCcw, TerminalSquare } from "lucide-react";
import { buildAgentCommand } from "@/lib/fleet/agent-adapters";
import { getRunTimeline } from "@/lib/fleet/runtime";
import { runStatusTone } from "./status-colors";
import type { Secret, WorkflowRun } from "@/lib/fleet/types";

export type RunSummary = {
  id: string;
  workflowName: string;
  status: string;
  startedAt: string;
  vmId?: string;
};

type RunPanelProps = {
  latestRun?: WorkflowRun;
  secrets: Secret[];
  onRun: () => void;
  running?: boolean;
  runs?: RunSummary[];
  onSelectRun?: (id: string) => void;
};

export function RunPanel({
  latestRun,
  secrets,
  onRun,
  running = false,
  runs = [],
  onSelectRun,
}: RunPanelProps) {
  const claude = buildAgentCommand({
    provider: "claude-code",
    prompt: "Run workflow node",
    secrets: Object.fromEntries(secrets.map((secret) => [secret.name, secret.value])),
    allowApiFallback: false,
  });
  const codex = buildAgentCommand({
    provider: "codex",
    prompt: "Run workflow node",
    secrets: {},
    allowApiFallback: false,
  });

  return (
    <aside className="min-h-0 border-l border-zinc-200 bg-white">
      <div className="flex h-14 items-center justify-between gap-2 border-b border-zinc-200 px-4">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-zinc-700" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-zinc-950">Run Control</h2>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex h-8 items-center gap-1.5 rounded bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {running ? "Running…" : "Run"}
        </button>
      </div>

      <div className="space-y-4 overflow-y-auto p-4">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Triggers</h3>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <button className="rounded border border-zinc-200 px-2 py-2 text-zinc-700">Manual</button>
            <button className="rounded border border-zinc-200 px-2 py-2 text-zinc-700">Cron</button>
            <button className="rounded border border-zinc-200 px-2 py-2 text-zinc-700">Webhook</button>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Provider Order</h3>
          <ol className="space-y-2 text-sm">
            <li className="rounded border border-zinc-200 p-2">
              <div className="font-medium text-zinc-950">Claude Code</div>
              <div className="mt-1 font-mono text-[11px] text-zinc-500">
                {claude.executable} {claude.args.join(" ")}
              </div>
            </li>
            <li className="rounded border border-zinc-200 p-2">
              <div className="font-medium text-zinc-950">Codex</div>
              <div className="mt-1 font-mono text-[11px] text-zinc-500">
                {codex.executable} {codex.args.join(" ")}
              </div>
            </li>
            <li className="rounded border border-zinc-200 p-2">
              <div className="font-medium text-zinc-950">Direct API fallback</div>
              <div className="mt-1 text-xs text-zinc-500">disabled unless workflow allows it</div>
            </li>
          </ol>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase text-zinc-500">Latest Run</h3>
            {latestRun ? (
              <span className={`rounded px-2 py-1 text-[11px] font-medium ${runStatusTone(latestRun.status)}`}>
                {latestRun.status}
              </span>
            ) : null}
          </div>
          {latestRun ? (
            <div className="space-y-2">
              <div className="rounded border border-zinc-200 p-2 text-xs">
                <div className="font-medium text-zinc-950">{latestRun.workflowName}</div>
                <div className="mt-1 text-zinc-500">VM: {latestRun.vmId}</div>
              </div>
              <div className="space-y-2">
                {getRunTimeline(latestRun).map((event) => (
                  <div key={event.id} className="rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-100">
                    <span className="text-emerald-300">{event.level}</span> {event.message}
                  </div>
                ))}
              </div>
              {latestRun.artifacts && latestRun.artifacts.length > 0 ? (
                <div className="rounded border border-zinc-200 p-2 text-xs">
                  <div className="mb-1 font-medium text-zinc-950">Artifacts</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {latestRun.artifacts.map((a) => {
                      const name = a.path.split("/").pop() ?? a.path;
                      const url = `/api/runs/${latestRun.id}/artifacts/${encodeURIComponent(name)}`;
                      const isImage = /\.(png|jpe?g)$/i.test(name);
                      return isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a key={a.id} href={url} target="_blank" rel="noreferrer" title={name}>
                          <img src={url} alt={name} className="h-16 w-full rounded border border-zinc-200 object-cover" />
                        </a>
                      ) : (
                        <a key={a.id} href={url} className="col-span-3 truncate font-mono text-[11px] text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                          {name}
                        </a>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded border border-dashed border-zinc-300 p-3 text-xs text-zinc-500">
              No run yet. Start manually or enable a trigger.
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Recent Runs</h3>
          {runs.length > 0 ? (
            <ul className="space-y-1.5 text-xs">
              {runs.slice(0, 6).map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRun?.(run.id)}
                    className="flex w-full items-center justify-between rounded border border-zinc-200 px-2 py-1.5 text-left hover:bg-zinc-50"
                  >
                    <span className="truncate text-zinc-700">{run.workflowName}</span>
                    <span className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${runStatusTone(run.status)}`}>
                      {run.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded border border-dashed border-zinc-300 p-2 text-xs text-zinc-500">
              No run history yet.
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-500">Human Takeover</h3>
          <div className="grid grid-cols-2 gap-2">
            <button className="inline-flex items-center justify-center gap-1 rounded border border-zinc-200 px-2 py-2 text-xs text-zinc-700">
              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              Pause
            </button>
            <button className="inline-flex items-center justify-center gap-1 rounded border border-zinc-200 px-2 py-2 text-xs text-zinc-700">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}
