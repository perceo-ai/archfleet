import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiBearerToken, requireRole, signSession } from "./auth";

const SECRET = "test-secret-for-role-gating";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://archfleet.test/api/node-types", { headers });
}

describe("requireRole", () => {
  const previous = process.env.CUF_AUTH_SECRET;
  beforeEach(() => {
    process.env.CUF_AUTH_SECRET = SECRET;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.CUF_AUTH_SECRET;
    else process.env.CUF_AUTH_SECRET = previous;
  });

  async function cookieFor(role: "admin" | "operator" | "viewer") {
    const token = await signSession(SECRET, {
      sub: "u1",
      username: role,
      role,
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    return { cookie: `cuf_auth=${encodeURIComponent(token)}` };
  }

  it("lets an admin through", async () => {
    expect(await requireRole(request(await cookieFor("admin")), ["admin"])).toBeUndefined();
  });

  it("turns away an operator or viewer, saying what they are", async () => {
    for (const role of ["operator", "viewer"] as const) {
      const denied = await requireRole(request(await cookieFor(role)), ["admin"]);
      expect(denied?.status).toBe(403);
      expect(await denied!.clone().json()).toEqual({ error: `admin required — you are ${role}` });
    }
  });

  it("asks an anonymous caller to sign in", async () => {
    const denied = await requireRole(request(), ["admin"]);
    expect(denied?.status).toBe(401);
  });

  it("accepts an admin API bearer token, so agents can manage node types", async () => {
    const { token } = await createApiBearerToken(SECRET, { name: "agent", role: "admin" });
    expect(
      await requireRole(request({ authorization: `Bearer ${token}` }), ["admin"]),
    ).toBeUndefined();
  });

  it("rejects an operator bearer token", async () => {
    const { token } = await createApiBearerToken(SECRET, { name: "agent", role: "operator" });
    const denied = await requireRole(request({ authorization: `Bearer ${token}` }), ["admin"]);
    expect(denied?.status).toBe(403);
  });

  it("rejects a forged session", async () => {
    const forged = await signSession("not-the-real-secret", {
      sub: "u1",
      username: "mallory",
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const denied = await requireRole(
      request({ cookie: `cuf_auth=${encodeURIComponent(forged)}` }),
      ["admin"],
    );
    expect(denied?.status).toBe(401);
  });

  it("follows the configured posture when auth is switched off", async () => {
    delete process.env.CUF_AUTH_SECRET;
    expect(await requireRole(request(), ["admin"])).toBeUndefined();
    expect((await requireRole(request(), ["admin"], "deny"))?.status).toBe(403);
  });
});
