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

/** Fetch `url` on mount and every `intervalMs` (0 = no polling). `refresh()`
 * re-fetches on demand. Errors leave the previous data in place. */
export function usePolling<T>(url: string, intervalMs = 0): {
  data: T | undefined;
  error: string | undefined;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getJson<T>(url);
      if (alive.current) {
        setData(next);
        setError(undefined);
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = intervalMs > 0 ? setInterval(() => void refresh(), intervalMs) : undefined;
    return () => {
      alive.current = false;
      if (timer) clearInterval(timer);
    };
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}
