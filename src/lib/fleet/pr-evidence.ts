// PR/branch evidence reporting — the Archductor-facing half of semantic testing.
// Builds a markdown summary of every run associated with a PR/branch (status,
// criteria reviews, automated checks, artifacts) and optionally publishes it as a
// GitHub PR comment. Pure summary logic is separated from the GitHub I/O so it is
// unit tested without network.

import type { Db } from "./db/db";
import { listRuns, type RunSummary } from "./db/runs-repo";
import { listEvidenceByRun } from "./db/evidence-repo";
import type { EvidenceItem } from "./types";

export type PrEvidenceFilter = { prRef?: string; branchRef?: string };

export type PrEvidenceSummary = {
  markdown: string;
  runs: { run: RunSummary; evidence: EvidenceItem[] }[];
  counts: { total: number; succeeded: number; failed: number; other: number };
};

const statusEmoji: Record<string, string> = {
  succeeded: "✅",
  failed: "❌",
  paused: "⏸️",
  running: "🏃",
  queued: "⏳",
  canceled: "🚫",
};

/** Summarize all runs (and their evidence) associated with a PR or branch. */
export function buildPrEvidenceSummary(db: Db, filter: PrEvidenceFilter): PrEvidenceSummary {
  const runs = listRuns(db, 100, { prRef: filter.prRef, branchRef: filter.branchRef });
  const withEvidence = runs.map((run) => ({ run, evidence: listEvidenceByRun(db, run.id) }));
  const counts = {
    total: runs.length,
    succeeded: runs.filter((r) => r.status === "succeeded").length,
    failed: runs.filter((r) => r.status === "failed").length,
    other: runs.filter((r) => r.status !== "succeeded" && r.status !== "failed").length,
  };

  const ref = filter.prRef ? `PR ${filter.prRef}` : `branch \`${filter.branchRef}\``;
  const lines: string[] = [
    `## archfleet evidence for ${ref}`,
    "",
    counts.total === 0
      ? "No runs are associated with this change yet."
      : `${counts.succeeded}/${counts.total} runs succeeded${counts.failed ? `, ${counts.failed} failed` : ""}${counts.other ? `, ${counts.other} in progress or waiting` : ""}.`,
  ];
  for (const { run, evidence } of withEvidence) {
    const reviews = evidence.filter((e) => e.type === "criteria_review");
    const checks = evidence.filter((e) => e.type === "check");
    const screenshots = evidence.filter((e) => e.type === "screenshot").length;
    lines.push(
      "",
      `### ${statusEmoji[run.status] ?? ""} ${run.workflowName} — ${run.status}`,
      `Run \`${run.id}\`${run.resultSummary ? ` — ${run.resultSummary}` : ""}`,
    );
    if (reviews.length) {
      lines.push("", "**Criteria (human-reviewed):**");
      for (const r of reviews) lines.push(`- ${r.verdict === "pass" ? "✅" : "❌"} ${r.description}`);
    }
    if (checks.length) {
      lines.push("", "**Automated checks:**");
      for (const c of checks) lines.push(`- ${c.verdict === "pass" ? "✅" : "❌"} ${c.description}`);
    }
    if (screenshots) lines.push("", `${screenshots} screenshot${screenshots === 1 ? "" : "s"} captured.`);
  }
  return { markdown: lines.join("\n"), runs: withEvidence, counts };
}

export type PrCommentResult = {
  posted: boolean;
  markdown: string;
  /** Why the comment was not posted (missing token/repo/pr, or the API error). */
  reason?: string;
};

/** Resolve "org/repo#42" / plain "42" into repo + issue number. */
export function parsePrRef(prRef: string, fallbackRepo?: string): { repo?: string; number?: string } {
  const match = /^([^#\s]+\/[^#\s]+)#(\d+)$/.exec(prRef);
  if (match) return { repo: match[1], number: match[2] };
  if (/^\d+$/.test(prRef)) return { repo: fallbackRepo, number: prRef };
  return { repo: fallbackRepo };
}

/** Publish the evidence summary as a PR comment. Needs CUF_GITHUB_TOKEN and a
 * repo (from an `org/repo#N` prRef or the CUF_GITHUB_REPO allowlist). Comments
 * only go to repos in CUF_GITHUB_REPO (comma-separated) — callers pick the PR,
 * the operator picks where the token may write. Without token/repo it still
 * returns the markdown so the caller can post it through its own channel. */
export async function publishPrComment(
  db: Db,
  prRef: string,
  opts: { repo?: string; env?: Record<string, string | undefined>; httpFetch?: typeof fetch } = {},
): Promise<PrCommentResult> {
  const env = opts.env ?? process.env;
  const { markdown } = buildPrEvidenceSummary(db, { prRef });
  const token = env.CUF_GITHUB_TOKEN ?? env.GITHUB_TOKEN;
  const allowedRepos = (env.CUF_GITHUB_REPO ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const { repo, number } = parsePrRef(prRef, opts.repo ?? allowedRepos[0]);
  if (!token) return { posted: false, markdown, reason: "no CUF_GITHUB_TOKEN configured" };
  if (!repo || !number) {
    return { posted: false, markdown, reason: "no repo — pass org/repo#N or set CUF_GITHUB_REPO" };
  }
  if (!allowedRepos.includes(repo)) {
    return {
      posted: false,
      markdown,
      reason: `repo ${repo} is not in the CUF_GITHUB_REPO allowlist`,
    };
  }
  const doFetch = opts.httpFetch ?? fetch;
  const res = await doFetch(`https://api.github.com/repos/${repo}/issues/${number}/comments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ body: markdown }),
  });
  if (!res.ok) {
    return { posted: false, markdown, reason: `GitHub API ${res.status}: ${await res.text()}` };
  }
  return { posted: true, markdown };
}
