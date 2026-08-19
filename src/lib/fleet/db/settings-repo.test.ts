import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db";
import {
  behaviourDefaults,
  effectiveSettings,
  saveSettings,
  settingFlag,
  settingNumber,
  settingValue,
  settingsForDisplay,
  storedSettings,
} from "./settings-repo";

const KEY = "test-key-for-settings";
const previous = process.env.CUF_SECRET_KEY;
afterEach(() => {
  if (previous === undefined) delete process.env.CUF_SECRET_KEY;
  else process.env.CUF_SECRET_KEY = previous;
});

describe("settings resolution", () => {
  it("prefers a stored value over the environment and the default", () => {
    const db = openDb(":memory:");
    const env = { CUF_PLANNER_MODEL: "from/env" };
    expect(settingValue(db, "provider.planner_model", env)).toBe("from/env");

    saveSettings(db, { "provider.planner_model": "stored/model" });
    expect(settingValue(db, "provider.planner_model", env)).toBe("stored/model");
    db.close();
  });

  it("falls back to the environment, then the built-in default", () => {
    const db = openDb(":memory:");
    expect(settingValue(db, "provider.planner_model", {})).toBe("anthropic/claude-sonnet-4-6");
    expect(settingValue(db, "fleet.libvirt_uri", { CUF_LIBVIRT_URI: "qemu:///session" })).toBe(
      "qemu:///session",
    );
    db.close();
  });

  it("clearing a value returns to the environment rather than blanking it", () => {
    const db = openDb(":memory:");
    const env = { CUF_LIBVIRT_URI: "qemu:///session" };
    saveSettings(db, { "fleet.libvirt_uri": "qemu:///custom" });
    expect(settingValue(db, "fleet.libvirt_uri", env)).toBe("qemu:///custom");
    saveSettings(db, { "fleet.libvirt_uri": "" });
    expect(storedSettings(db)["fleet.libvirt_uri"]).toBeUndefined();
    expect(settingValue(db, "fleet.libvirt_uri", env)).toBe("qemu:///session");
    db.close();
  });

  it("reads booleans and numbers", () => {
    const db = openDb(":memory:");
    expect(settingFlag(db, "behaviour.allow_shell")).toBe(false);
    saveSettings(db, { "behaviour.allow_shell": "true" });
    expect(settingFlag(db, "behaviour.allow_shell")).toBe(true);
    expect(settingNumber(db, "notify.escalate_after_minutes", 30)).toBe(30);
    saveSettings(db, { "notify.escalate_after_minutes": "5" });
    expect(settingNumber(db, "notify.escalate_after_minutes", 30)).toBe(5);
    db.close();
  });

  it("hands new automations their behaviour defaults", () => {
    const db = openDb(":memory:");
    expect(behaviourDefaults(db).retryPolicy).toContain("Retry twice");
    saveSettings(db, { "behaviour.retry_policy": "Never retry." });
    expect(behaviourDefaults(db).retryPolicy).toBe("Never retry.");
    db.close();
  });
});

describe("secret settings", () => {
  it("stores an API key encrypted and never returns it for display", () => {
    process.env.CUF_SECRET_KEY = KEY;
    const db = openDb(":memory:");
    saveSettings(db, { "provider.openrouter_api_key": "sk-live-abc123" });

    // the runtime can read it
    expect(settingValue(db, "provider.openrouter_api_key", {})).toBe("sk-live-abc123");
    // the plain settings table never sees it
    expect(storedSettings(db)["provider.openrouter_api_key"]).toBeUndefined();
    // and the browser is told only that it is set
    const shown = settingsForDisplay(db, {}).find((v) => v.key === "provider.openrouter_api_key")!;
    expect(shown.value).toBe("");
    expect(shown.isSet).toBe(true);
    expect(shown.source).toBe("stored");

    const row = db
      .prepare("SELECT encrypted_value FROM cuf_secrets WHERE name=?")
      .get("provider.openrouter_api_key") as { encrypted_value: string };
    expect(row.encrypted_value).not.toContain("sk-live-abc123");
    db.close();
  });

  it("clearing a secret removes it", () => {
    process.env.CUF_SECRET_KEY = KEY;
    const db = openDb(":memory:");
    saveSettings(db, { "notify.webhook": "https://hooks.example/x" });
    expect(settingValue(db, "notify.webhook", {})).toBe("https://hooks.example/x");
    saveSettings(db, { "notify.webhook": "" });
    expect(settingValue(db, "notify.webhook", {})).toBeUndefined();
    db.close();
  });

  it("skips a secret it cannot encrypt without losing the rest of the patch", () => {
    delete process.env.CUF_SECRET_KEY;
    const db = openDb(":memory:");
    const report = saveSettings(db, {
      "provider.planner_model": "openai/gpt-5",
      "provider.openrouter_api_key": "sk-live-abc123",
    });
    expect(report.stored).toEqual(["provider.planner_model"]);
    expect(report.skippedSecrets).toEqual(["provider.openrouter_api_key"]);
    // the plain setting still landed
    expect(settingValue(db, "provider.planner_model", {})).toBe("openai/gpt-5");
    // and nothing was written in the clear
    expect(db.prepare("SELECT count(*) c FROM cuf_secrets").get()).toEqual({ c: 0 });
    db.close();
  });

  it("degrades to the environment when no encryption key is configured", () => {
    delete process.env.CUF_SECRET_KEY;
    const db = openDb(":memory:");
    const env = { OPENROUTER_API_KEY: "sk-from-env" };
    expect(settingValue(db, "provider.openrouter_api_key", env)).toBe("sk-from-env");
    db.close();
  });
});

describe("settingsForDisplay", () => {
  it("says where each value comes from", () => {
    const db = openDb(":memory:");
    saveSettings(db, { "provider.planner_model": "stored/model" });
    const rows = settingsForDisplay(db, { CUF_LIBVIRT_URI: "qemu:///session" });
    const source = (key: string) => rows.find((r) => r.key === key)!.source;
    expect(source("provider.planner_model")).toBe("stored");
    expect(source("fleet.libvirt_uri")).toBe("environment");
    expect(source("behaviour.evidence_retention_days")).toBe("default");
    expect(source("provider.grounding_model")).toBe("unset");
    db.close();
  });

  it("covers every setting in the catalogue", () => {
    const db = openDb(":memory:");
    expect(Object.keys(effectiveSettings(db, {})).length).toBe(settingsForDisplay(db, {}).length);
    db.close();
  });
});
