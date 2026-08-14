import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutomationsList } from "./AutomationsList";
import { stubFetch } from "@/test/fetch-stub";

afterEach(() => vi.unstubAllGlobals());

const base = {
  goal: "goal",
  target: "",
  specMarkdown: "",
  workflowId: "wf",
  successCriteria: [],
  requiredSecrets: [],
  artifactPolicy: "",
  retryPolicy: "",
  takeoverPolicy: "",
  riskNotes: [],
  createdAt: "2026-08-12T00:00:00Z",
  updatedAt: "2026-08-12T00:00:00Z",
};

describe("AutomationsList", () => {
  it("filters by lens", async () => {
    stubFetch({
      "/api/automations": [
        { ...base, id: "a1", name: "Release smoke", category: "semantic_test", status: "active", health: "healthy" },
        { ...base, id: "a2", name: "Report download", category: "report_download", status: "draft", health: "unknown" },
        { ...base, id: "a3", name: "Broken flow", category: "general", status: "active", health: "failing" },
      ],
      "/api/takeovers?status=open": [],
    });
    render(<AutomationsList />);
    const name = (text: string) => screen.queryByRole("heading", { level: 3, name: text });
    expect(await screen.findByRole("heading", { level: 3, name: "Release smoke" })).toBeInTheDocument();
    expect(name("Report download")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Semantic tests" }));
    expect(name("Release smoke")).toBeInTheDocument();
    expect(name("Report download")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Recently failed" }));
    expect(name("Broken flow")).toBeInTheDocument();
    expect(name("Release smoke")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Drafts" }));
    expect(name("Report download")).toBeInTheDocument();
  });
});
