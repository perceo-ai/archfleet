// Failure diagnosis: turn a failed run's event log into a suggested cause and a
// recovery hint. Pattern-based and honest — when nothing matches, it says so
// rather than inventing a cause. Pure function, usable from server or client.

import type { WorkflowRun } from "./types";

export type FailureDiagnosis = {
  /** One-line suggested cause, e.g. "The agent timed out waiting for the page." */
  cause: string;
  /** What to try first, matching the recovery affordances in the run view. */
  suggestion: string;
  /** True when a pattern matched; false for the generic fallback. */
  confident: boolean;
};

const PATTERNS: { test: RegExp; cause: string; suggestion: string }[] = [
  {
    test: /no VM available|no_matching_vm/i,
    cause: "No prepared environment was available to run on.",
    suggestion: "Check environment health on the Environments page, then retry.",
  },
  {
    test: /transport error|ECONNREFUSED|ETIMEDOUT|ssh/i,
    cause: "The controller could not reach the environment's desktop (connection problem).",
    suggestion: "Recover the environment, then retry the run.",
  },
  {
    test: /timed_out|timeout/i,
    cause: "A step timed out before it finished — the site may be slow or the step may be stuck.",
    suggestion: "Retry from the failed step; if it repeats, raise the step timeout or split the step.",
  },
  {
    test: /retries exhausted/i,
    cause: "The step kept failing after all configured retries.",
    suggestion: "Edit the automation's steps — the instructions may no longer match the site.",
  },
  {
    test: /captcha|robot|verification challenge/i,
    cause: "The site presented a captcha or bot check the agent cannot pass.",
    suggestion: "Add a takeover point before this step so a human can clear the check.",
  },
  {
    test: /login|password|credential|sign.?in|authenticat/i,
    cause: "The step failed around login/credentials.",
    suggestion:
      "Check the required secrets, or add a takeover point so a human can log in once on the environment.",
  },
  {
    test: /mfa|otp|2fa|verification code/i,
    cause: "The step hit an MFA/verification prompt it could not complete.",
    suggestion: "Add a takeover point, or use a prepared environment with device trust.",
  },
  {
    test: /no OTP found/i,
    cause: "No verification email arrived in the configured mailbox.",
    suggestion: "Check the mailbox configuration, then retry from the failed step.",
  },
  {
    test: /API \w+ \S+ -> [45]\d\d/,
    cause: "An API call returned an error status.",
    suggestion: "Check the API endpoint/credentials in the step, then retry from the failed step.",
  },
  {
    test: /invalid .* (spec|config)/i,
    cause: "A step's configuration is invalid (malformed JSON spec).",
    suggestion: "Edit the automation's Advanced workflow and fix the step configuration.",
  },
  {
    test: /shell .* exited [1-9]/i,
    cause: "A shell step exited with an error.",
    suggestion: "Check the command in the step, then retry.",
  },
  {
    test: /exceeded max steps/i,
    cause: "The workflow looped without reaching an end state.",
    suggestion: "Edit the automation's Advanced workflow — its edges likely form a cycle.",
  },
];

/** Suggest a cause for a failed run from its error/warn events (latest first). */
export function diagnoseFailure(run: WorkflowRun): FailureDiagnosis {
  const messages = run.events
    .filter((e) => e.level === "error" || e.level === "warn")
    .map((e) => e.message)
    .reverse();
  for (const message of messages) {
    const match = PATTERNS.find((p) => p.test.test(message));
    if (match) return { cause: match.cause, suggestion: match.suggestion, confident: true };
  }
  return {
    cause: run.currentStep
      ? `The run failed at "${run.currentStep}" without a recognizable cause.`
      : "The run failed without a recognizable cause.",
    suggestion: "Read the events and screenshot below, then retry or edit the automation.",
    confident: false,
  };
}
