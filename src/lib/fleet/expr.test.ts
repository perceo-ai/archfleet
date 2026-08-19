import { describe, expect, it } from "vitest";
import { checkExpr, evalExpr, evalRule, type ExprContext } from "./expr";

const ctx: ExprContext = {
  params: { region: "eu", attempts: "2", threshold: 1000 },
  steps: {
    "Fetch invoices": { status: "success", body: { total: 2480, rows: [{ id: "a" }, { id: "b" }] } },
    "Sign in": { status: "success", stdout: "Welcome back, ap-bot" },
  },
  run: { id: "run_1", triggerSource: "schedule" },
};

const val = (src: string) => evalExpr(src, ctx);

describe("evalExpr", () => {
  it("reads nested paths, with brackets for names that need them", () => {
    expect(val('steps["Fetch invoices"].body.total')).toBe(2480);
    expect(val("steps.run")).toBe(null);
    expect(val('steps["Fetch invoices"].body.rows[1].id')).toBe("b");
  });

  it("returns null for anything missing instead of throwing", () => {
    expect(val("params.nope")).toBe(null);
    expect(val("steps.nope.deep.deeper")).toBe(null);
    expect(val("nothing")).toBe(null);
  });

  it("compares numbers and numeric strings the way a form would supply them", () => {
    expect(val("params.attempts == 2")).toBe(true);
    expect(val("params.attempts > 1")).toBe(true);
    expect(val('steps["Fetch invoices"].body.total > params.threshold')).toBe(true);
    expect(val('params.region == "eu"')).toBe(true);
    expect(val('params.region != "us"')).toBe(true);
  });

  it("does arithmetic, and concatenates when either side is text", () => {
    expect(val("params.attempts + 1")).toBe(3); // "2" + 1 — params arrive as strings
    expect(val('"5" + "5"')).toBe("55"); // two strings still concatenate
    expect(val('"run-" + params.region')).toBe("run-eu");
    expect(val("10 / 4")).toBe(2.5);
    expect(val("10 / 0")).toBe(null);
    expect(val("7 % 3")).toBe(1);
  });

  it("short-circuits boolean operators", () => {
    expect(val('params.region == "eu" && params.attempts > 1')).toBe(true);
    expect(val('params.nope && params.nope.deep == "x"')).toBe(null);
    expect(val('params.nope || "fallback"')).toBe("fallback");
    expect(val("!params.nope")).toBe(true);
  });

  it("supports a conditional", () => {
    expect(val('params.attempts > 1 ? "retry" : "first"')).toBe("retry");
  });

  it("has the string and collection helpers a rule usually needs", () => {
    expect(val('contains(lower(steps["Sign in"].stdout), "welcome")')).toBe(true);
    expect(val('startsWith(params.region, "e")')).toBe(true);
    expect(val('matches(steps["Sign in"].stdout, "ap-[a-z]+")')).toBe(true);
    expect(val('len(steps["Fetch invoices"].body.rows)')).toBe(2);
    expect(val("default(params.missing, 0)")).toBe(0);
    expect(val("has(params.region)")).toBe(true);
    expect(val('join(split("a,b,c", ","), "-")')).toBe("a-b-c");
    expect(val('replace("PO 1", " ", "-")')).toBe("PO-1");
    expect(val('json("{\\"a\\":1}").a')).toBe(1);
  });

  it("refuses to walk into the prototype chain", () => {
    expect(val("params.__proto__")).toBe(null);
    expect(val("params.constructor")).toBe(null);
    expect(val('params["prototype"]')).toBe(null);
  });

  it("does not treat inherited object properties as callable functions", () => {
    expect(() => val("constructor(1)")).toThrow(/unknown function/);
    expect(() => val("__proto__(1)")).toThrow(/unknown function/);
    expect(() => val('hasOwnProperty("len")')).toThrow(/unknown function/);
    expect(() => val("toString()")).toThrow(/unknown function/);
  });

  it("rejects malformed input rather than guessing", () => {
    expect(() => val("params.")).toThrow();
    expect(() => val("1 +")).toThrow();
    expect(() => val("nope(1)")).toThrow(/unknown function/);
    expect(() => val('"unterminated')).toThrow();
    expect(() => val("1 2")).toThrow();
  });
});

describe("evalRule", () => {
  it("is false, with a reason, when the expression is broken", () => {
    const bad = evalRule("params. ==", ctx);
    expect(bad.value).toBe(false);
    expect(bad.error).toBeTruthy();
  });

  it("treats empty, zero and empty lists as false", () => {
    expect(evalRule('""', ctx).value).toBe(false);
    expect(evalRule("0", ctx).value).toBe(false);
    expect(evalRule("params.missing", ctx).value).toBe(false);
    expect(evalRule('steps["Fetch invoices"].body.rows', ctx).value).toBe(true);
  });
});

describe("checkExpr", () => {
  it("reports a syntax error for the editor, or nothing when it parses", () => {
    expect(checkExpr('params.region == "eu"')).toBeUndefined();
    expect(checkExpr("params.region ==")).toBeTruthy();
  });

  it("rejects unknown functions at save time, exactly as evaluation would", () => {
    expect(checkExpr("nope(1)")).toMatch(/unknown function "nope"/);
    expect(checkExpr("constructor(1)")).toMatch(/unknown function "constructor"/);
    expect(checkExpr('contains(lower(params.region), "e")')).toBeUndefined();
  });
});
