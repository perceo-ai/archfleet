"use client";

// Tiny typed fetch helpers + a polling hook for the client pages. All UI data
// access goes through /api/* — components never import server-side fleet code.

import { useCallback, useEffect, useRef, useState } from "react";

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error ?? `${url} -> ${res.status}`);
  return data;
}

/** How often to re-fetch: a fixed number, or a function of the latest data so a
 * page can stop polling something that has settled (a finished run never
 * changes again). Return 0 to stop. */
export type PollInterval<T> = number | ((data: T | undefined) => number);

/** Fetch `url` on mount and on the polling schedule. `refresh()` re-fetches on
 * demand. Errors leave the previous data in place and surface via `error`. */
export function usePolling<T>(url: string, interval: PollInterval<T> = 0): {
  data: T | undefined;
  error: string | undefined;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const alive = useRef(true);
  const latest = useRef<T | undefined>(undefined);

  // Held in a ref so a caller can pass an inline arrow without restarting the
  // schedule on every render. Written in an effect, never during render.
  const intervalRef = useRef<PollInterval<T>>(interval);
  useEffect(() => {
    intervalRef.current = interval;
  }, [interval]);

  const refresh = useCallback(async () => {
    // An empty url means "nothing to load yet" (e.g. a drawer with no run open).
    if (!url) return;
    try {
      const next = await getJson<T>(url);
      if (alive.current) {
        latest.current = next;
        setData(next);
        setError(undefined);
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const nextDelay = () => {
      const spec = intervalRef.current;
      return typeof spec === "function" ? spec(latest.current) : spec;
    };

    const tick = async () => {
      await refresh();
      if (!alive.current) return;
      const delay = nextDelay();
      if (delay > 0) timer = setTimeout(() => void tick(), delay);
    };

    void tick();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  return { data, error, refresh };
}
