import { KeyRound, SlidersHorizontal } from "lucide-react";
import type { Secret, WorkflowParam } from "@/lib/fleet/types";

type SecretsParamsPanelProps = {
  params: WorkflowParam[];
  secrets: Secret[];
};

export function SecretsParamsPanel({ params, secrets }: SecretsParamsPanelProps) {
  return (
    <section className="border-t border-zinc-200 bg-white">
      <div className="grid gap-0 md:grid-cols-2">
        <div className="border-b border-zinc-200 p-4 md:border-r md:border-b-0">
          <div className="mb-3 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-zinc-700" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-zinc-950">Params</h2>
          </div>
          <div className="space-y-2">
            {params.map((param) => (
              <div
                key={param.id}
                className="grid grid-cols-[120px_1fr_80px] items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-xs"
              >
                <span className="font-medium text-zinc-800">{param.name}</span>
                <span className="truncate font-mono text-zinc-600">{String(param.value)}</span>
                <span className="text-right text-zinc-400">{param.scope}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-zinc-700" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-zinc-950">Secrets</h2>
          </div>
          <div className="space-y-2">
            {secrets.map((secret) => (
              <div
                key={secret.id}
                className="grid grid-cols-[120px_1fr_80px] items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-xs"
              >
                <span className="font-medium text-zinc-800">{secret.name}</span>
                <span className="font-mono text-zinc-600">[REDACTED]</span>
                <span className="text-right text-zinc-400">{secret.scope}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
