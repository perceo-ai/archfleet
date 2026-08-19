import { describe, expect, it } from "vitest";
import { authOk, createApiBearerToken, isAuthExempt, signSession, verifySession } from "./auth";

describe("auth", () => {
  it("disabled when no token configured", async () => {
    await expect(authOk(undefined, undefined, undefined)).resolves.toBe(true);
  });

  it("accepts a matching legacy cookie, bearer header, or signed session", async () => {
    const signed = await signSession("s3cret", {
      sub: "u1",
      username: "alice",
      role: "admin",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(authOk("s3cret", "s3cret")).resolves.toBe(true);
    await expect(authOk("s3cret", undefined, "Bearer s3cret")).resolves.toBe(true);
    await expect(authOk("s3cret", signed)).resolves.toBe(true);
    await expect(verifySession("s3cret", signed)).resolves.toMatchObject({ username: "alice" });
  });

  it("accepts a signed bearer API token", async () => {
    const { token, expiresAt } = await createApiBearerToken("s3cret", {
      name: "ci",
      role: "operator",
      ttlSeconds: 60,
    });
    await expect(authOk("s3cret", undefined, `Bearer ${token}`)).resolves.toBe(true);
    await expect(verifySession("s3cret", token)).resolves.toMatchObject({
      username: "token:ci",
      role: "operator",
    });
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
  });

  it("rejects wrong / missing credentials when a token is set", async () => {
    await expect(authOk("s3cret", "nope")).resolves.toBe(false);
    await expect(authOk("s3cret", undefined, undefined)).resolves.toBe(false);
    await expect(authOk("s3cret", "")).resolves.toBe(false);
  });

  it("exempts the login flow + static assets", () => {
    expect(isAuthExempt("/login")).toBe(true);
    expect(isAuthExempt("/api/auth")).toBe(true);
    expect(isAuthExempt("/_next/static/x.js")).toBe(true);
    expect(isAuthExempt("/api/runs")).toBe(false);
    expect(isAuthExempt("/")).toBe(false);
  });

  it("serves the branding assets to signed-out visitors and link crawlers", () => {
    // The login card shows the mark, the browser wants a tab icon, and an
    // unfurled link fetches the OG image — all before anyone has a session.
    for (const asset of ["/perceo-logo.png", "/icon.png", "/apple-icon.png", "/favicon.ico"]) {
      expect(isAuthExempt(asset)).toBe(true);
    }
    // but nothing else in public/ is a blanket hole
    expect(isAuthExempt("/globe.svg")).toBe(false);
    expect(isAuthExempt("/api/runs/r1/artifacts/screenshot.png")).toBe(false);
  });
});
