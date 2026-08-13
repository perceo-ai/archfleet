// Automated evidence checks: explicit, machine-evaluated assertions that run
// against a finished run's events + artifacts. They complement (not replace)
// plain-language success criteria — criteria are the authoring interface, checks
// are the reliability layer power users add over time.

import type { WorkflowRun } from "./types";

export type EvidenceCheckType =
  | "text_found"
  | "url_reached"
  | "file_downloaded"
  | "screenshot_captured";

export type EvidenceCheck = {
  type: EvidenceCheckType;
  /** text_found: substring; url_reached: URL; file_downloaded: filename substring. */
  value?: string;
};

export type EvidenceCheckResult = {
  check: EvidenceCheck;
  verdict: "pass" | "fail";
  detail: string;
};

const CHECK_TYPES: EvidenceCheckType[] = [
  "text_found",
  "url_reached",
  "file_downloaded",
  "screenshot_captured",
];

const IMAGE_EXT = /\.(png|jpe?g)$/i;

export function evaluateEvidenceChecks(
  checks: EvidenceCheck[],
  run: WorkflowRun,
): EvidenceCheckResult[] {
  const eventText = run.events.map((e) => e.message).join("\n");
  const artifacts = run.artifacts ?? [];
  return checks.map((check) => {
    switch (check.type) {
      case "text_found": {
        const ok = !!check.value && eventText.toLowerCase().includes(check.value.toLowerCase());
        return {
          check,
          verdict: ok ? "pass" : "fail",
          detail: ok ? `"${check.value}" found in run events` : `"${check.value ?? ""}" not found in run events`,
        };
      }
      case "url_reached": {
        // api_call nodes emit `API <method> <url> -> <status>.`
        const ok =
          !!check.value &&
          new RegExp(`API \\w+ ${escapeRegExp(check.value)} -> 2\\d\\d`).test(eventText);
        return {
          check,
          verdict: ok ? "pass" : "fail",
          detail: ok ? `${check.value} returned 2xx` : `no successful request to ${check.value ?? ""}`,
        };
      }
      case "file_downloaded": {
        const files = artifacts.filter((a) => !IMAGE_EXT.test(a.path));
        const ok = check.value
          ? files.some((a) => a.path.toLowerCase().includes(check.value!.toLowerCase()))
          : files.length > 0;
        return {
          check,
          verdict: ok ? "pass" : "fail",
          detail: ok
            ? `matching file artifact captured`
            : `no file artifact${check.value ? ` matching "${check.value}"` : ""}`,
        };
      }
      case "screenshot_captured": {
        const ok = artifacts.some((a) => IMAGE_EXT.test(a.path));
        return {
          check,
          verdict: ok ? "pass" : "fail",
          detail: ok ? "screenshot artifact captured" : "no screenshot artifact",
        };
      }
    }
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse one check per line: `type: value` (value optional). Unknown types dropped. */
export function parseEvidenceChecks(text: string): EvidenceCheck[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): EvidenceCheck | undefined => {
      const [head, ...rest] = line.split(":");
      const type = head.trim() as EvidenceCheckType;
      if (!CHECK_TYPES.includes(type)) return undefined;
      const value = rest.join(":").trim();
      return value ? { type, value } : { type };
    })
    .filter((c): c is EvidenceCheck => !!c);
}

export function formatEvidenceChecks(checks: EvidenceCheck[]): string {
  return checks.map((c) => (c.value ? `${c.type}: ${c.value}` : c.type)).join("\n");
}
