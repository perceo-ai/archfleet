import { describe, expect, it } from "vitest";
import {
  acknowledgeAsk,
  parseAsk,
  splitAnswers,
  summarizeAnswers,
  validateAnswers,
} from "./human-ask";

describe("parseAsk", () => {
  it("turns a bare prompt into an acknowledge ask", () => {
    expect(parseAsk("Finish the login, then resume.")).toEqual({
      kind: "acknowledge",
      question: "Finish the login, then resume.",
      detail: undefined,
    });
  });

  it("parses a JSON string from a node config field", () => {
    const ask = parseAsk('{"question":"Which account?","options":["ops","finance"]}');
    expect(ask.kind).toBe("choice");
    expect(ask.options).toEqual([
      { value: "ops", label: "ops", tone: undefined },
      { value: "finance", label: "finance", tone: undefined },
    ]);
  });

  it("infers input when fields are present", () => {
    const ask = parseAsk({
      question: "What's the code?",
      fields: [{ name: "otp", label: "Code", type: "code", secret: true }],
    });
    expect(ask.kind).toBe("input");
    expect(ask.fields).toEqual([
      {
        name: "otp",
        label: "Code",
        type: "code",
        placeholder: undefined,
        secret: true,
        required: true,
        options: undefined,
      },
    ]);
  });

  it("defaults an approval to approve/reject", () => {
    const ask = parseAsk({ kind: "approval", question: "Send $2,480?" });
    expect(ask.options?.map((o) => o.value)).toEqual(["approved", "rejected"]);
    expect(ask.answerName).toBe("approval");
  });

  it("drops junk fields rather than rendering something broken", () => {
    const ask = parseAsk({
      question: "Fill these",
      fields: [{ label: "no name" }, { name: "bad name!" }, { name: "ok", type: "nonsense" }],
    });
    expect(ask.fields).toHaveLength(1);
    expect(ask.fields![0]).toMatchObject({ name: "ok", type: "text", label: "ok" });
  });

  it("falls back when there is nothing usable", () => {
    expect(parseAsk(undefined).kind).toBe("acknowledge");
    expect(parseAsk({ kind: "input", question: "?" }).kind).toBe("acknowledge");
    expect(parseAsk(42, "This run needs a human.").question).toBe("This run needs a human.");
  });
});

describe("validateAnswers", () => {
  const ask = parseAsk({
    question: "Details",
    fields: [
      { name: "code", label: "Code", type: "code" },
      { name: "count", label: "Count", type: "number", required: false },
      { name: "site", label: "Site", type: "url", required: false },
      { name: "who", label: "Who", type: "text", required: false, options: ["ops", "finance"] },
    ],
  });

  it("requires required fields", () => {
    expect(validateAnswers(ask, {})).toEqual(["Code is required."]);
  });

  it("type-checks what it can", () => {
    const errors = validateAnswers(ask, {
      code: "123456",
      count: "many",
      site: "not-a-url",
      who: "legal",
    });
    expect(errors).toEqual([
      "Count must be a number.",
      "Site must be a URL.",
      "Who must be one of: ops, finance.",
    ]);
  });

  it("insists on a real option for choices", () => {
    const choice = parseAsk({ question: "Which?", options: ["a", "b"] });
    expect(validateAnswers(choice, {})).toEqual(["Pick one of the options."]);
    expect(validateAnswers(choice, { choice: "c" })).toEqual(['"c" is not one of the options.']);
    expect(validateAnswers(choice, { choice: "a" })).toEqual([]);
  });

  it("accepts an acknowledge with no answers", () => {
    expect(validateAnswers(acknowledgeAsk("Done?"), {})).toEqual([]);
  });
});

describe("splitAnswers", () => {
  const ask = parseAsk({
    question: "Details",
    fields: [
      { name: "otp", label: "Code", type: "code", secret: true },
      { name: "note", label: "Note", type: "text", required: false },
    ],
  });

  it("routes secret fields away from run params", () => {
    expect(splitAnswers(ask, { otp: "123456", note: "typed it in" })).toEqual({
      params: { note: "typed it in" },
      secrets: { otp: "123456" },
    });
  });

  it("ignores answers the ask never requested", () => {
    expect(splitAnswers(ask, { smuggled: "value" })).toEqual({ params: {}, secrets: {} });
  });

  it("keeps a choice under its answer name", () => {
    const choice = parseAsk({ question: "Which?", options: ["a"], answerName: "account" });
    expect(splitAnswers(choice, { account: "a" })).toEqual({ params: { account: "a" }, secrets: {} });
  });
});

describe("summarizeAnswers", () => {
  it("records that a secret was supplied, never its value", () => {
    const ask = parseAsk({
      question: "Code",
      fields: [{ name: "otp", label: "Code", type: "code", secret: true }],
    });
    expect(summarizeAnswers(ask, { otp: "123456" })).toBe("otp=(supplied)");
  });

  it("says so when nothing was asked for", () => {
    expect(summarizeAnswers(acknowledgeAsk("ok?"), {})).toBe("acknowledged");
  });
});
