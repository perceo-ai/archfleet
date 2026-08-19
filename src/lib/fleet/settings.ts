// What an operator can configure, declared once.
//
// Configuration used to be env-only, which meant a redeploy to change a model or
// a webhook, and no way to see what was set. Each setting below can be stored in
// the database and falls back to its environment variable, so an existing
// deployment keeps working untouched and anything set in the UI wins from the
// next run onwards.
//
// Values marked `secret` never come back to the browser — the store returns
// whether they are set, not what they are.

export type SettingGroup = "providers" | "behaviour" | "fleet" | "notifications";

export type SettingKind = "text" | "url" | "number" | "boolean" | "select" | "secret" | "textarea";

export type SettingDef = {
  /** Stable key, also the database key. */
  key: string;
  group: SettingGroup;
  label: string;
  help: string;
  kind: SettingKind;
  /** Environment variable consulted when nothing is stored. */
  env?: string;
  default?: string;
  options?: string[];
  placeholder?: string;
  /** Shown as a warning next to the field — for the ones that carry real risk. */
  danger?: string;
};

export const SETTING_DEFS: SettingDef[] = [
  /* ------------------------------------------------------------ providers */
  {
    key: "provider.openrouter_api_key",
    group: "providers",
    label: "OpenRouter API key",
    help: "Used by the planner that drives desktop steps. Without it, only script, browser and API steps can run.",
    kind: "secret",
    env: "OPENROUTER_API_KEY",
  },
  {
    key: "provider.planner_model",
    group: "providers",
    label: "Planner model",
    help: "The model that decides what to do on screen.",
    kind: "text",
    env: "CUF_PLANNER_MODEL",
    default: "anthropic/claude-sonnet-4-6",
    placeholder: "anthropic/claude-sonnet-4-6",
  },
  {
    key: "provider.openrouter_base_url",
    group: "providers",
    label: "OpenRouter base URL",
    help: "Point at a proxy or a self-hosted gateway if you do not call OpenRouter directly.",
    kind: "url",
    env: "CUF_OPENROUTER_BASE_URL",
    default: "https://openrouter.ai/api/v1",
  },
  {
    key: "provider.grounding_base_url",
    group: "providers",
    label: "Grounding model URL",
    help: "The vision model that turns a screenshot into coordinates. Usually a local GPU server.",
    kind: "url",
    env: "CUF_GROUNDING_BASE_URL",
    placeholder: "http://127.0.0.1:8080/v1",
  },
  {
    key: "provider.grounding_model",
    group: "providers",
    label: "Grounding model",
    help: "Model name the grounding server expects.",
    kind: "text",
    env: "CUF_GROUNDING_MODEL",
  },
  {
    key: "provider.grounding_api_key",
    group: "providers",
    label: "Grounding API key",
    help: "Only if your grounding server requires one.",
    kind: "secret",
    env: "CUF_GROUNDING_API_KEY",
  },
  {
    key: "provider.agent_backend",
    group: "providers",
    label: "Desktop agent backend",
    help: "Which agent implementation runs on the guest desktop.",
    kind: "text",
    env: "CUF_AGENT_BACKEND",
  },

  /* -------------------------------------------------------- notifications */
  {
    key: "notify.webhook",
    group: "notifications",
    label: "Notification webhook",
    help: "Where archfleet pages you when a run needs a human or fails. Slack-compatible.",
    kind: "secret",
    env: "CUF_NOTIFY_WEBHOOK",
    placeholder: "https://hooks.slack.com/services/…",
  },
  {
    key: "notify.escalate_after_minutes",
    group: "notifications",
    label: "Chase an unanswered question after",
    help: "Minutes before a second page goes out for a takeover nobody has answered.",
    kind: "number",
    env: "CUF_TAKEOVER_ESCALATE_MIN",
    default: "30",
  },

  /* ------------------------------------------------------------ behaviour */
  {
    key: "behaviour.retry_policy",
    group: "behaviour",
    label: "Default retry policy",
    help: "Applied to new automations. Individual automations can override it.",
    kind: "text",
    default: "Retry twice, two minutes apart, then ask a human.",
  },
  {
    key: "behaviour.takeover_policy",
    group: "behaviour",
    label: "Default: when to ask a human",
    help: "Applied to new automations.",
    kind: "text",
    default: "Pause and ask when login, a verification code or a captcha blocks the run.",
  },
  {
    key: "behaviour.artifact_policy",
    group: "behaviour",
    label: "Default: what to capture",
    help: "Applied to new automations.",
    kind: "text",
    default: "Capture a screenshot at every step, plus any file the run downloads.",
  },
  {
    key: "behaviour.evidence_retention_days",
    group: "behaviour",
    label: "Keep evidence for",
    help: "Days to keep screenshots and files. Shown on the run view so nobody is surprised.",
    kind: "number",
    default: "90",
  },
  {
    key: "behaviour.allow_shell",
    group: "behaviour",
    label: "Allow shell steps",
    help: "Lets workflows and custom node types run commands on the controller.",
    kind: "boolean",
    env: "CUF_ALLOW_SHELL",
    default: "false",
    danger: "A shell step runs as the archfleet process. Only enable it if you trust everyone who can edit an automation.",
  },

  /* ---------------------------------------------------------------- fleet */
  {
    key: "fleet.libvirt_uri",
    group: "fleet",
    label: "libvirt URI",
    help: "Where the desktops live.",
    kind: "text",
    env: "CUF_LIBVIRT_URI",
    default: "qemu:///system",
  },
  {
    key: "fleet.guest_host",
    group: "fleet",
    label: "Guest host",
    help: "Host the controller reaches guest SSH/RDP on. Use host.docker.internal from a container.",
    kind: "text",
    env: "CUF_GUEST_HOST",
  },
  {
    key: "fleet.guacamole_url",
    group: "fleet",
    label: "Guacamole URL",
    help: "Set this and desktop takeover opens in the browser instead of downloading an .rdp file.",
    kind: "url",
    env: "CUF_GUACAMOLE_URL",
  },
];

export const SETTING_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));

export const GROUP_LABELS: Record<SettingGroup, { title: string; blurb: string }> = {
  providers: {
    title: "Providers",
    blurb: "The models that read the screen and decide what to do.",
  },
  notifications: {
    title: "Notifications",
    blurb: "Where archfleet reaches you when a run stops.",
  },
  behaviour: {
    title: "Behaviour",
    blurb: "Defaults new automations start from, and what the fleet is allowed to do.",
  },
  fleet: { title: "Fleet", blurb: "Where the desktops are and how to reach them." },
};

/** True for settings whose value is stored encrypted and never returned. */
export function isSecretSetting(key: string): boolean {
  return SETTING_BY_KEY.get(key)?.kind === "secret";
}

/** Resolve one setting: stored value first, then environment, then default. */
export function resolveSetting(
  key: string,
  stored: Record<string, string | undefined>,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const def = SETTING_BY_KEY.get(key);
  const fromStore = stored[key];
  if (fromStore != null && fromStore !== "") return fromStore;
  const fromEnv = def?.env ? env[def.env] : undefined;
  if (fromEnv != null && fromEnv !== "") return fromEnv;
  return def?.default;
}

/** Where a value is actually coming from — shown in the UI so "why is this on?"
 * has an answer. */
export function settingSource(
  key: string,
  stored: Record<string, string | undefined>,
  env: Record<string, string | undefined> = process.env,
): "stored" | "environment" | "default" | "unset" {
  const def = SETTING_BY_KEY.get(key);
  if (stored[key] != null && stored[key] !== "") return "stored";
  if (def?.env && env[def.env]) return "environment";
  if (def?.default != null) return "default";
  return "unset";
}

export function asBoolean(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function asNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Reject values that would break at run time, before they are stored. */
export function validateSetting(key: string, value: string): string | undefined {
  const def = SETTING_BY_KEY.get(key);
  if (!def) return `unknown setting "${key}"`;
  if (value === "") return undefined; // clearing is always allowed
  if (def.kind === "url" && !/^https?:\/\/\S+$/i.test(value)) {
    return `${def.label} must be a URL starting with http:// or https://`;
  }
  if (def.kind === "number" && !Number.isFinite(Number(value))) {
    return `${def.label} must be a number`;
  }
  if (def.kind === "boolean" && !["true", "false"].includes(value)) {
    return `${def.label} must be true or false`;
  }
  if (def.kind === "select" && def.options && !def.options.includes(value)) {
    return `${def.label} must be one of: ${def.options.join(", ")}`;
  }
  return undefined;
}
