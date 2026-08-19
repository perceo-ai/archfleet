import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";
import { SETTING_DEFS } from "@/lib/fleet/settings";
import { stubFetch } from "@/test/fetch-stub";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  search = "";
});

function stub(overrides: Record<string, unknown> = {}) {
  return stubFetch({
    "/api/settings": {
      defs: SETTING_DEFS,
      values: SETTING_DEFS.map((d) => ({
        key: d.key,
        value: d.kind === "secret" ? "" : (d.default ?? ""),
        isSet: d.key === "provider.openrouter_api_key",
        source: d.key === "provider.openrouter_api_key" ? "stored" : d.default ? "default" : "unset",
      })),
    },
    "/api/setup": {
      done: 3,
      total: 8,
      ready: false,
      fresh: false,
      checks: [
        {
          id: "auth",
          title: "Lock the instance down",
          unlocks: "Anyone can run automations until this is set.",
          done: false,
          required: true,
          detail: "Set CUF_AUTH_SECRET.",
          href: "/settings?tab=people",
          action: "Add people",
        },
      ],
    },
    "/api/users": [],
    "/api/secrets": [],
    "/api/node-types": [],
    ...overrides,
  });
}

describe("SettingsPage", () => {
  it("opens on setup and shows what is still outstanding", async () => {
    stub();
    render(<SettingsPage />);
    expect(await screen.findByText("Lock the instance down")).toBeInTheDocument();
    expect(screen.getByText("3 of 8 done")).toBeInTheDocument();
    expect(screen.getByText("needed")).toBeInTheDocument();
  });

  it("opens the tab named in the URL, so setup links land in the right place", async () => {
    search = "tab=providers";
    stub();
    render(<SettingsPage />);
    expect(await screen.findByLabelText("Planner model")).toBeInTheDocument();
  });

  it("shows a provider key as stored without ever rendering its value", async () => {
    search = "tab=providers";
    stub();
    render(<SettingsPage />);
    const field = (await screen.findByLabelText("OpenRouter API key")) as HTMLInputElement;
    expect(field.type).toBe("password");
    expect(field.value).toBe("");
    expect(field.placeholder).toMatch(/stored/i);
    expect(screen.getAllByText("stored").length).toBeGreaterThan(0);
  });

  it("saves only what changed, and says where a value comes from", async () => {
    search = "tab=providers";
    const fetchMock = stub();
    render(<SettingsPage />);
    const field = await screen.findByLabelText("Planner model");
    fireEvent.change(field, { target: { value: "openai/gpt-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({
        "provider.planner_model": "openai/gpt-5",
      });
    });
    expect(screen.getAllByText("default").length).toBeGreaterThan(0);
  });

  it("warns next to the setting that lets workflows run commands", async () => {
    search = "tab=behaviour";
    stub();
    render(<SettingsPage />);
    expect(await screen.findByLabelText("Allow shell steps")).toBeInTheDocument();
    expect(screen.getByText(/runs as the archfleet process/i)).toBeInTheDocument();
  });

  it("keeps every configuration surface reachable from one page", async () => {
    stub();
    render(<SettingsPage />);
    for (const label of [
      "Setup",
      "Providers",
      "Notifications",
      "Behaviour",
      "Fleet",
      "Secrets",
      "Node types",
      "People & tokens",
    ]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });
});
