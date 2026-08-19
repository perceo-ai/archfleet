"use client";

// Latest screenshot per run, for the places that show a thumbnail of what the
// agent is looking at (inbox takeovers, the workspace live card). Runs are
// fetched once each and cached for the life of the page — a handful of runs at
// most, and only the ones actually on screen.

import { useEffect, useState } from "react";
import { getJson } from "@/lib/ui/api";
import type { WorkflowRun } from "@/lib/fleet/types";

const isImage = (path: string) => /\.(png|jpe?g)$/i.test(path);

export function latestScreenshotUrl(run: WorkflowRun | undefined): string | undefined {
  const shots = (run?.artifacts ?? []).filter((a) => isImage(a.path));
  const last = shots[shots.length - 1];
  if (!last || !run) return undefined;
  const name = last.path.split("/").pop() ?? last.path;
  return `/api/runs/${run.id}/artifacts/${encodeURIComponent(name)}`;
}

/** Map of runId -> latest screenshot URL. Missing keys mean "none yet". */
export function useRunThumbnails(runIds: string[], intervalMs = 15000): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const key = runIds.join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return;
    let alive = true;

    const load = async () => {
      const found = new Map<string, string>();
      await Promise.all(
        ids.map(async (id) => {
          const run = await getJson<WorkflowRun>(`/api/runs/${id}`).catch(() => undefined);
          const url = latestScreenshotUrl(run);
          if (url) found.set(id, url);
        }),
      );
      if (alive) setUrls(found);
    };

    void load();
    const timer = intervalMs > 0 ? setInterval(() => void load(), intervalMs) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [key, intervalMs]);

  return urls;
}
