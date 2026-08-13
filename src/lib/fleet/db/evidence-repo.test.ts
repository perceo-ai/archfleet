import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { addEvidence, listEvidenceByAutomation, listEvidenceByRun } from "./evidence-repo";
import type { EvidenceItem } from "../types";

function evidence(id: string, overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id,
    runId: "r1",
    automationId: "auto_1",
    type: "screenshot",
    artifactRef: "shot.png",
    stepId: "task1",
    description: "Screenshot after login",
    createdAt: "2026-08-12T01:00:00.000Z",
    ...overrides,
  };
}

describe("evidence repo", () => {
  it("adds and lists evidence by run", () => {
    const db = openDb(":memory:");
    addEvidence(db, evidence("ev_1"));
    addEvidence(db, evidence("ev_2", { type: "criteria_review", verdict: "pass", artifactRef: undefined }));
    const items = listEvidenceByRun(db, "r1");
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(evidence("ev_1"));
    expect(items[1].verdict).toBe("pass");
    db.close();
  });

  it("lists by automation with type filter", () => {
    const db = openDb(":memory:");
    addEvidence(db, evidence("ev_1"));
    addEvidence(db, evidence("ev_2", { runId: "r2", type: "log" }));
    addEvidence(db, evidence("ev_3", { automationId: "auto_other" }));
    expect(listEvidenceByAutomation(db, "auto_1")).toHaveLength(2);
    expect(listEvidenceByAutomation(db, "auto_1", { type: "log" }).map((e) => e.id)).toEqual(["ev_2"]);
    db.close();
  });
});
