import { describe, expect, it } from "vitest";
import { authOk, isAuthExempt } from "./auth";

describe("auth", () => {
  it("disabled when no token configured", () => {
    expect(authOk(undefined, undefined, undefined)).toBe(true);
  });

  it("accepts a matching cookie or bearer header", () => {
    expect(authOk("s3cret", "s3cret")).toBe(true);
    expect(authOk("s3cret", undefined, "Bearer s3cret")).toBe(true);
  });

  it("rejects wrong / missing credentials when a token is set", () => {
    expect(authOk("s3cret", "nope")).toBe(false);
    expect(authOk("s3cret", undefined, undefined)).toBe(false);
    expect(authOk("s3cret", "")).toBe(false);
  });

  it("exempts the login flow + static assets", () => {
    expect(isAuthExempt("/login")).toBe(true);
    expect(isAuthExempt("/api/auth")).toBe(true);
    expect(isAuthExempt("/_next/static/x.js")).toBe(true);
    expect(isAuthExempt("/api/runs")).toBe(false);
    expect(isAuthExempt("/")).toBe(false);
  });
});
