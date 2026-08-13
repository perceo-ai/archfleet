import { vi } from "vitest";

/** Stub global fetch: each key is matched against the request URL (startsWith,
 * longest key wins) and returns its value as JSON. Unmatched URLs 404. */
export function stubFetch(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = keys.find((k) => url.startsWith(k));
    if (key === undefined) {
      return new Response(JSON.stringify({ error: `no stub for ${url}` }), { status: 404 });
    }
    return new Response(JSON.stringify(routes[key]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
