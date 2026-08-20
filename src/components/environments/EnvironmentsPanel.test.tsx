import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EnvironmentsPanel } from "./EnvironmentsPanel";
import { stubFetch } from "@/test/fetch-stub";

afterEach(() => vi.unstubAllGlobals());

function stub() {
  return stubFetch({
    "/api/environments": [
      {
        id: "env_portal",
        name: "Portal — logged in",
        description: "Trusted Chrome session",
        labels: ["profile:portal"],
        profileRef: "portal",
        health: "ready",
        snapshotState: "golden-warm",
        lastUsedAt: "2026-08-12T00:00:00Z",
        setupNotes: "",
        createdAt: "t",
        updatedAt: "t",
      },
    ],
    "/api/vms": [
      {
        id: "vm1",
        name: "vm-01",
        status: "idle",
        labels: ["profile:portal"],
        cpu: 2,
        memoryGb: 4,
        diskGb: 40,
        xrdp: { host: "10.0.0.1", port: 3389, username: "agent", credentialSource: "env" },
        lastHealthAt: "2026-08-12T00:00:00Z",
      },
    ],
    "/api/profile-ops": { operations: [] },
    "/api/profile-status": { profiles: {}, vmCount: 1 },
    "/api/health": { queuedRuns: 0 },
    "/api/secrets": [{ name: "portal_password", scope: "workflow" }],
  });
}

describe("EnvironmentsPanel", () => {
  it("lists environments with health and the preparation flow", async () => {
    stub();
    render(<EnvironmentsPanel />);
    expect(await screen.findByText("Portal — logged in")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText(/profile portal/)).toBeInTheDocument();
    // the embedded profile setup flow is present
    expect(screen.getByText(/LLM Setup Flow/i)).toBeInTheDocument();
  });

  it("folds fleet capacity in as a tab", async () => {
    stub();
    render(<EnvironmentsPanel />);
    expect(await screen.findByText("Portal — logged in")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Capacity/ }));
    expect(await screen.findByText("vm-01")).toBeInTheDocument();
    expect(screen.getByText("Profile readiness")).toBeInTheDocument();
  });

  it("leaves secrets to Settings rather than owning a second copy", async () => {
    stub();
    render(<EnvironmentsPanel />);
    await screen.findByText("Portal — logged in");
    expect(screen.queryByRole("tab", { name: /Secrets/ })).not.toBeInTheDocument();
  });

  it("opens the prepare-an-environment drawer", async () => {
    stub();
    render(<EnvironmentsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Prepare an environment/i }));
    expect(screen.getByLabelText("Environment name")).toBeInTheDocument();
  });

  // Creating an environment used to leave you to type a profile slug and then go
  // run the build somewhere else. Naming it is now the whole ask.
  it("starts the build on create, deriving the profile from the name", async () => {
    const fetchMock = stub();
    render(<EnvironmentsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Prepare an environment/i }));

    fireEvent.change(screen.getByLabelText("Environment name"), {
      target: { value: "Travel — logged in" },
    });
    fireEvent.change(screen.getByLabelText("Desktop count"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Create and start building/i }));

    await screen.findByText("Portal — logged in");
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).startsWith("/api/environments") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeTruthy();
    const body = JSON.parse((post![1] as RequestInit).body as string);
    expect(body.name).toBe("Travel — logged in");
    expect(body.prepare).toEqual({ clones: 3, task: undefined });
    // The slug is the server's to derive — the UI must not send one.
    expect(body.profileRef).toBeUndefined();
  });

  it("asks for the sign-in on the environment's own card when the build is waiting", async () => {
    stubFetch({
      "/api/environments": [
        {
          id: "env_travel",
          name: "Travel — logged in",
          description: "",
          labels: ["profile:travel"],
          profileRef: "travel",
          health: "unknown",
          setupStage: "building",
          profileOpId: "profile_op_1",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
      "/api/vms": [],
      "/api/profile-ops": {
        operations: [{ id: "profile_op_1", profile: "travel", status: "waiting_for_capture", logs: [] }],
      },
      "/api/profile-status": { profiles: {}, vmCount: 0 },
      "/api/health": { queuedRuns: 0 },
    });
    render(<EnvironmentsPanel />);

    expect(await screen.findByText(/waiting for you to sign in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open desktop to sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /capture it/i })).toBeInTheDocument();
  });

  it("shows a build in progress without asking anything of the user", async () => {
    stubFetch({
      "/api/environments": [
        {
          id: "env_travel",
          name: "Travel — logged in",
          description: "",
          labels: [],
          profileRef: "travel",
          health: "unknown",
          setupStage: "building",
          profileOpId: "profile_op_1",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
      "/api/vms": [],
      "/api/profile-ops": {
        operations: [{ id: "profile_op_1", profile: "travel", status: "running", logs: [] }],
      },
      "/api/profile-status": { profiles: {}, vmCount: 0 },
      "/api/health": { queuedRuns: 0 },
    });
    render(<EnvironmentsPanel />);

    expect(await screen.findByText(/building the desktop/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open desktop to sign in/i })).not.toBeInTheDocument();
  });
});
