import { describe, expect, it } from "vitest";
import { generateTotp } from "./totp";

// RFC 6238 test seed: ASCII "12345678901234567890" in base32.
const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("generateTotp", () => {
  it("matches the RFC 6238 vector (T=59, SHA1, 8 digits)", () => {
    expect(generateTotp(SEED, { timeMs: 59_000, digits: 8 })).toBe("94287082");
  });

  it("gives a 6-digit code by default", () => {
    const code = generateTotp(SEED, { timeMs: 1_111_111_109_000 });
    expect(code).toMatch(/^\d{6}$/);
  });

  it("is stable within a 30s window and changes across windows", () => {
    const a = generateTotp(SEED, { timeMs: 60_000 });
    const b = generateTotp(SEED, { timeMs: 75_000 }); // same 30s window (60-90)
    const c = generateTotp(SEED, { timeMs: 95_000 }); // next window
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("rejects an invalid base32 seed", () => {
    expect(() => generateTotp("not!base32")).toThrow();
  });
});
