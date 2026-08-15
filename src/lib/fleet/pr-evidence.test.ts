import { describe, expect, it, vi } from "vitest";
import { openDb } from "./db/db";
import { saveRun } from "./db/runs-repo";
import { addEvidence } from "./db/evidence-repo";
import { buildPrEvidenceSummary, parsePrRef, publishPrComment } from "./pr-evidence";
import type { WorkflowRun } from "./types";

function seed(db: ReturnType<typeof openDb>) {
  const run: WorkflowRun = {
    id: "r1",
    workflowId: "wf1",
    workflowName: "Signup flow test",
    status: "succeeded",
    startedAt: "2026-08-12T01:00:00Z",
    events: [],
    artifacts: [],
    automationId: "auto_1",
    prRef: "acme/app#42",
    branchRef: "feature/signup",
    resultSummary: "succeeded — onboarding completed",
  };
  saveRun(db, run);
  addEvidence(db, {
    id: "ev1",
    runId: "r1",
    automationId: "auto_1",
    type: "criteria_review",
    description: "Onboarding completes after signup",
    verdict: "pass",
    createdAt: "2026-08-12T01:10:00Z",
  });
  addEvidence(db, {
    id: "ev2",
    runId: "r1",
    automationId: "auto_1",
    type: "check",
    description: "text_found: welcome — found",
    verdict: "fail",
    createdAt: "2026-08-12T01:10:01Z",
  });
  addEvidence(db, {
    id: "ev3",
    runId: "r1",
    automationId: "auto_1",
    type: "screenshot",
    artifactRef: "shot.png",
    description: "Captured",
    createdAt: "2026-08-12T01:10:02Z",
  });
}

describe("buildPrEvidenceSummary", () => {
  it("summarizes runs, reviews, checks, and screenshots for a PR", () => {
    const db = openDb(":memory:");
    seed(db);
    const summary = buildPrEvidenceSummary(db, { prRef: "acme/app#42" });
    expect(summary.counts).toEqual({ total: 1, succeeded: 1, failed: 0, other: 0 });
    expect(summary.markdown).toContain("PR acme/app#42");
    expect(summary.markdown).toContain("Signup flow test");
    expect(summary.markdown).toContain("✅ Onboarding completes after signup");
    expect(summary.markdown).toContain("❌ text_found: welcome — found");
    expect(summary.markdown).toContain("1 screenshot captured");
    db.close();
  });

  it("says so when nothing is associated", () => {
    const db = openDb(":memory:");
    const summary = buildPrEvidenceSummary(db, { branchRef: "nope" });
    expect(summary.counts.total).toBe(0);
    expect(summary.markdown).toContain("No runs are associated");
    db.close();
  });
});

describe("parsePrRef", () => {
  it("handles org/repo#N, bare numbers, and fallbacks", () => {
    expect(parsePrRef("acme/app#42")).toEqual({ repo: "acme/app", number: "42" });
    expect(parsePrRef("42", "acme/app")).toEqual({ repo: "acme/app", number: "42" });
    expect(parsePrRef("garbage")).toEqual({ repo: undefined });
  });
});

describe("publishPrComment", () => {
  it("returns the markdown unposted when no token is configured", async () => {
    const db = openDb(":memory:");
    seed(db);
    const result = await publishPrComment(db, "acme/app#42", { env: {} });
    expect(result.posted).toBe(false);
    expect(result.reason).toMatch(/CUF_GITHUB_TOKEN/);
    expect(result.markdown).toContain("Signup flow test");
    db.close();
  });

  it("posts to the GitHub issues comment API when configured", async () => {
    const db = openDb(":memory:");
    seed(db);
    const httpFetch = vi.fn(async () => new Response("{}", { status: 201 }));
    const result = await publishPrComment(db, "acme/app#42", {
      env: { CUF_GITHUB_TOKEN: "tok", CUF_GITHUB_REPO: "acme/app" },
      httpFetch: httpFetch as unknown as typeof fetch,
    });
    expect(result.posted).toBe(true);
    const [url, init] = httpFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/app/issues/42/comments");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string).body).toContain("archfleet evidence");
    db.close();
  });

  it("surfaces GitHub API errors without throwing", async () => {
    const db = openDb(":memory:");
    seed(db);
    const httpFetch = vi.fn(async () => new Response("bad creds", { status: 401 }));
    const result = await publishPrComment(db, "acme/app#42", {
      env: { CUF_GITHUB_TOKEN: "tok", CUF_GITHUB_REPO: "acme/app" },
      httpFetch: httpFetch as unknown as typeof fetch,
    });
    expect(result.posted).toBe(false);
    expect(result.reason).toContain("401");
    db.close();
  });

  it("refuses to post to repos outside the CUF_GITHUB_REPO allowlist", async () => {
    const db = openDb(":memory:");
    seed(db);
    const httpFetch = vi.fn(async () => new Response("{}", { status: 201 }));
    // Caller-supplied repo that the operator never allowed.
    const denied = await publishPrComment(db, "evil/elsewhere#1", {
      env: { CUF_GITHUB_TOKEN: "tok", CUF_GITHUB_REPO: "acme/app" },
      httpFetch: httpFetch as unknown as typeof fetch,
    });
    expect(denied.posted).toBe(false);
    expect(denied.reason).toContain("allowlist");
    expect(httpFetch).not.toHaveBeenCalled();
    // Token configured but no allowlist at all — nothing is ever posted.
    const noList = await publishPrComment(db, "acme/app#42", {
      env: { CUF_GITHUB_TOKEN: "tok" },
      httpFetch: httpFetch as unknown as typeof fetch,
    });
    expect(noList.posted).toBe(false);
    expect(httpFetch).not.toHaveBeenCalled();
    db.close();
  });
});
