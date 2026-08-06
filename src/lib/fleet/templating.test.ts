import { describe, expect, it } from "vitest";
import { resolveTemplate, referencedSecrets } from "./templating";

const values = {
  secrets: { portal_password: "swordfish" },
  params: { portal_url: "https://x", count: 3 },
};

describe("resolveTemplate", () => {
  it("substitutes secret + param placeholders", () => {
    expect(resolveTemplate("go to {{param.portal_url}} and type {{secret.portal_password}}", values)).toBe(
      "go to https://x and type swordfish",
    );
  });

  it("stringifies non-string params", () => {
    expect(resolveTemplate("n={{param.count}}", values)).toBe("n=3");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(resolveTemplate("{{secret.missing}} {{param.nope}}", values)).toBe("{{secret.missing}} {{param.nope}}");
  });

  it("tolerates whitespace inside braces", () => {
    expect(resolveTemplate("{{ secret.portal_password }}", values)).toBe("swordfish");
  });
});

describe("referencedSecrets", () => {
  it("lists only secret names referenced", () => {
    expect(referencedSecrets("{{secret.a}} {{param.b}} {{secret.c}}").sort()).toEqual(["a", "c"]);
  });
});
