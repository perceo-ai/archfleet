import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redaction";

describe("redactSecrets", () => {
  it("replaces secret values without hiding normal params", () => {
    const secrets = [
      {
        id: "sec_1",
        name: "portal_password",
        scope: "workflow" as const,
        value: "swordfish",
      },
    ];

    expect(redactSecrets("login swordfish for customer Acme", secrets)).toBe(
      "login [REDACTED:portal_password] for customer Acme",
    );
  });
});
