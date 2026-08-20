// Is this install actually ready to do anything?
//
// Every check reads real state — a configured provider, a desktop that exists, a
// secret store that works — rather than asking the operator to tick boxes. Each
// one says what it unlocks and where to fix it, so the setup page is a to-do
// list with links rather than documentation.

export type SetupCheck = {
  id: string;
  title: string;
  /** What you cannot do until this is done. */
  unlocks: string;
  done: boolean;
  /** Blocking checks gate the product; the rest are strong recommendations. */
  required: boolean;
  detail: string;
  href: string;
  action: string;
};

export type SetupInput = {
  /** Auth secret configured (CUF_AUTH_TOKEN / CUF_AUTH_SECRET). */
  authConfigured: boolean;
  /** CUF_SECRET_KEY present, so secrets and secret answers can be stored. */
  secretStoreReady: boolean;
  /** A planner/grounding provider is configured. */
  plannerConfigured: boolean;
  groundingConfigured: boolean;
  /** Desktops the fleet knows about, and prepared environments. */
  desktopCount: number;
  environmentCount: number;
  /** Notification webhook configured. */
  notifyConfigured: boolean;
  automationCount: number;
  runCount: number;
};

export function setupChecks(input: SetupInput): SetupCheck[] {
  return [
    {
      id: "auth",
      title: "Lock the instance down",
      unlocks: "Anyone who can reach this URL can run automations until this is set.",
      done: input.authConfigured,
      required: true,
      detail: input.authConfigured
        ? "Sign-in is required."
        : "Set CUF_AUTH_SECRET (and an admin user) so the app is not open to the network.",
      href: "/settings?tab=people",
      action: "Add people",
    },
    {
      id: "secrets",
      title: "Turn on the secret store",
      unlocks: "Passwords, tokens and secret answers to questions.",
      done: input.secretStoreReady,
      required: true,
      detail: input.secretStoreReady
        ? "Secrets are encrypted at rest."
        : "Set CUF_SECRET_KEY. Without it a run cannot be given a password, and a secret answer is refused rather than stored in the clear.",
      href: "/settings?tab=secrets",
      action: "Open secrets",
    },
    {
      id: "provider",
      title: "Connect a model",
      unlocks: "Desktop steps that read the screen, and the copilot that drafts automations.",
      done: input.plannerConfigured,
      required: false,
      detail: input.plannerConfigured
        ? "A planner model is configured."
        : "Add an OpenRouter key, or point at your own gateway. Script, browser and API steps work without one.",
      href: "/settings?tab=providers",
      action: "Add a provider",
    },
    {
      id: "grounding",
      title: "Connect a grounding model",
      unlocks: "Turning a screenshot into somewhere to click.",
      done: input.groundingConfigured,
      required: false,
      detail: input.groundingConfigured
        ? "Grounding is configured."
        : "Usually a local GPU server. Only needed for desktop steps.",
      href: "/settings?tab=providers",
      action: "Configure grounding",
    },
    {
      id: "desktops",
      title: "Give it a desktop",
      unlocks: "Anything that drives a browser or an app.",
      done: input.desktopCount > 0,
      required: false,
      detail:
        input.desktopCount > 0
          ? `${input.desktopCount} ${input.desktopCount === 1 ? "desktop" : "desktops"} in the fleet.`
          : "Build a golden VM and point CUF_GOLDEN_DOMAIN at it, or add CUF_FLEET_JSON.",
      href: "/environments?tab=capacity",
      action: "Open capacity",
    },
    {
      id: "environment",
      title: "Prepare an environment",
      unlocks: "Runs that start already signed in, instead of logging in every time.",
      done: input.environmentCount > 0,
      required: false,
      detail:
        input.environmentCount > 0
          ? `${input.environmentCount} ready to use.`
          : "Sign in once on a held desktop and capture it; every run then starts from that state.",
      href: "/environments",
      action: "Prepare one",
    },
    {
      id: "notify",
      title: "Say where to reach you",
      unlocks: "Being told when a run stops and waits for you.",
      done: input.notifyConfigured,
      required: false,
      detail: input.notifyConfigured
        ? "Pages go to your webhook."
        : "Without it, a paused run waits silently in the inbox until someone looks.",
      href: "/settings?tab=notifications",
      action: "Add a webhook",
    },
    {
      id: "first-automation",
      title: "Build the first automation",
      unlocks: "Everything else here is scaffolding for this.",
      done: input.automationCount > 0,
      required: false,
      detail:
        input.automationCount > 0
          ? `${input.automationCount} built, ${input.runCount} runs recorded.`
          : "Describe a job in plain language and the copilot drafts the graph.",
      href: "/automations/new",
      action: "Describe a job",
    },
  ];
}

export type SetupSummary = {
  checks: SetupCheck[];
  done: number;
  total: number;
  /** Nothing required is outstanding. */
  ready: boolean;
  /** Fresh install: worth showing the setup flow prominently. */
  fresh: boolean;
};

export function summarizeSetup(input: SetupInput): SetupSummary {
  const checks = setupChecks(input);
  const done = checks.filter((c) => c.done).length;
  return {
    checks,
    done,
    total: checks.length,
    ready: checks.filter((c) => c.required).every((c) => c.done),
    fresh: input.automationCount === 0 && input.runCount === 0,
  };
}
