import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DraftComposer } from "./DraftComposer";
import { stubFetch } from "@/test/fetch-stub";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

const DRAFT = {
  automation: {
    id: "auto_x",
    name: "Report download",
    goal: "Download the weekly report",
    category: "report_download",
    target: "portal.example.com",
    specMarkdown: "1. Log in\n2. Download",
    workflowId: "wf_x",
    successCriteria: ["Report file downloaded"],
    requiredSecrets: ["portal_password"],
    mfaExpectation: "Email OTP possible",
    artifactPolicy: "",
    retryPolicy: "",
    takeoverPolicy: "",
    triggerSuggestion: "weekly",
    riskNotes: [],
    status: "draft",
    createdAt: "t",
    updatedAt: "t",
  },
  workflow: { id: "wf_x", name: "Report download", description: "", enabled: false, triggerKinds: ["manual"], nodes: [], edges: [] },
  clarifyingQuestions: ["Which report exactly?"],
  warnings: ["Run this automation once and review the evidence before enabling a schedule."],
  errors: [],
};

describe("DraftComposer", () => {
  it("drafts from a prompt and shows the review card", async () => {
    stubFetch({ "/api/automations/draft": DRAFT });
    render(<DraftComposer />);
    fireEvent.change(screen.getByPlaceholderText(/Log into portal/i), {
      target: { value: "download the weekly report" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Draft automation/i }));
    expect(await screen.findByText("Review the draft")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Download the weekly report")).toBeInTheDocument();
    expect(screen.getByText("Which report exactly?", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Secrets this automation needs/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save \+ run once/i })).toBeEnabled();
  });

  it("save + run once posts the automation then navigates to the run", async () => {
    stubFetch({
      "/api/automations/draft": DRAFT,
      "/api/automations/auto_x/run": { id: "run_1", status: "queued" },
      "/api/automations": { id: "auto_x" },
      "/api/secrets": { id: "sec_1" },
    });
    render(<DraftComposer />);
    fireEvent.change(screen.getByPlaceholderText(/Log into portal/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Draft automation/i }));
    await screen.findByText("Review the draft");
    fireEvent.click(screen.getByRole("button", { name: /Save \+ run once/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/runs/run_1"));
  });
});
