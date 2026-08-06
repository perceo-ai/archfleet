import { describe, expect, it } from "vitest";
import { extractOtp, pickOtpFromMessages, fetchEmailOtp, type EmailMessage } from "./otp-email";

describe("extractOtp", () => {
  it("pulls a standalone 4-8 digit code by default", () => {
    expect(extractOtp("Your code is 483920. Expires soon.")).toBe("483920");
  });
  it("honours a custom regex", () => {
    expect(extractOtp("token=ABZ9", "token=([A-Z0-9]+)")).toBe("ABZ9");
  });
  it("returns null when no code present", () => {
    expect(extractOtp("no codes here")).toBeNull();
  });
});

describe("pickOtpFromMessages", () => {
  const msgs: EmailMessage[] = [
    { from: "noreply@bank.com", subject: "Your login code", text: "Code: 123456", date: 2 },
    { from: "friend@x.com", subject: "hi", text: "call me at 5551234", date: 1 },
  ];
  it("filters by sender + subject before extracting", () => {
    expect(pickOtpFromMessages(msgs, { host: "h", user: "u", pass: "p", fromContains: "bank", subjectContains: "code" })).toBe(
      "123456",
    );
  });
  it("skips non-matching senders", () => {
    expect(pickOtpFromMessages(msgs, { host: "h", user: "u", pass: "p", fromContains: "nomatch" })).toBeNull();
  });
});

describe("fetchEmailOtp", () => {
  it("uses the injected fetcher then extracts", async () => {
    const code = await fetchEmailOtp({ host: "h", user: "u", pass: "p", fromContains: "bank" }, async () => [
      { from: "x@bank.com", subject: "code", text: "your otp is 998877", date: 1 },
    ]);
    expect(code).toBe("998877");
  });
});
