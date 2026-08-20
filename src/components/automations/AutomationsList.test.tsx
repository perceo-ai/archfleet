import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutomationsList } from "./AutomationsList";
import { stubFetch } from "@/test/fetch-stub";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
  it("filters by view and shows run history per row", async () => {
    stubFetch({
      "/api/automations": [
        { ...base, id: "a1", name: "Release smoke", category: "semantic_test", status: "active", health: "healthy" },
        { ...base, id: "a2", name: "Invoice pull", category: "report_download", status: "draft", health: "unknown" },
        { ...base, id: "a3", name: "Broken flow", category: "general", status: "active", health: "failing" },
      ],
      "/api/takeovers?status=open": [],
      "/api/runs": [
        { id: "r1", workflowId: "wf", workflowName: "Release smoke", status: "succeeded", startedAt: "2026-08-12T00:00:00Z", finishedAt: "2026-08-12T00:01:00Z", automationId: "a1" },
        { id: "r2", workflowId: "wf", workflowName: "Broken flow", status: "failed", startedAt: "2026-08-12T00:00:00Z", finishedAt: "2026-08-12T00:02:00Z", automationId: "a3" },
      ],
    });
    render(<AutomationsList />);
    const name = (text: string) => screen.queryByText(text);

    expect(await screen.findByText("Release smoke")).toBeInTheDocument();
    expect(name("Invoice pull")).toBeInTheDocument();
    // 1 of 1 finished run succeeded
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Tests/ }));
    expect(name("Release smoke")).toBeInTheDocument();
    expect(name("Invoice pull")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Needs attention/ }));
    expect(name("Broken flow")).toBeInTheDocument();
    expect(name("Release smoke")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Drafts/ }));
    expect(name("Invoice pull")).toBeInTheDocument();
  });
});
