import { describe, expect, it } from "vitest";
import { authOk, isAuthExempt, signSession, verifySession } from "./auth";

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
});
