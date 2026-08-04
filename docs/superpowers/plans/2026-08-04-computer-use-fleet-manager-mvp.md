# Computer Use Fleet Manager MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first shippable local-first fleet manager UI with a visual workflow editor, mock local VM fleet, manual runs, logs, params/secrets, and Claude Code/Codex CLI adapter plumbing.

**Architecture:** Use a single Next.js App Router app for the MVP. Keep domain logic in pure TypeScript modules under `src/lib/fleet` and render a client-side dashboard/editor using seed data and local state. VM lifecycle is mocked but shaped around the future libvirt daemon contract.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, React Flow (`@xyflow/react`), Vitest, Testing Library, lucide-react.

## Global Constraints

- MVP manages multiple local VMs on one controller machine.
- Remote worker hosts are out of scope.
- Visual workflow editor is the primary authoring surface.
- YAML/JSON is an import/export and debugging escape hatch only.
- Prefer Claude Code CLI and Codex CLI non-interactive adapters before direct API usage.
- Direct model API is a fallback only.
- Secrets must be redacted from run logs.
- XRDP access must be visible for every VM.

---

### Task 1: Scaffold App And Test Harness

**Files:**
- Create/Modify: `package.json`
- Create/Modify: `next.config.ts`
- Create/Modify: `tsconfig.json`
- Create/Modify: `src/app/layout.tsx`
- Create/Modify: `src/app/page.tsx`
- Create/Modify: `src/app/globals.css`
- Create: `src/test/setup.ts`

**Interfaces:**
- Produces: Next.js app root and `npm run test`, `npm run lint`, `npm run build`.

- [ ] **Step 1: Generate the Next.js app**

Run:

```bash
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

- [ ] **Step 2: Install runtime and test dependencies**

Run:

```bash
npm install @xyflow/react lucide-react clsx tailwind-merge
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @vitejs/plugin-react
```

- [ ] **Step 3: Add test scripts**

Update `package.json` scripts to include:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 4: Add Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Run baseline checks**

Run:

```bash
npm run lint
npm run test
```

Expected: lint passes; tests pass or report no tests before feature tests exist.

### Task 2: Domain Model, Redaction, And Run Simulation

**Files:**
- Create: `src/lib/fleet/types.ts`
- Create: `src/lib/fleet/seed.ts`
- Create: `src/lib/fleet/redaction.test.ts`
- Create: `src/lib/fleet/redaction.ts`
- Create: `src/lib/fleet/runtime.test.ts`
- Create: `src/lib/fleet/runtime.ts`

**Interfaces:**
- Produces: `redactSecrets(text: string, secrets: Secret[]): string`
- Produces: `createManualRun(input: CreateRunInput): WorkflowRun`
- Produces: `getRunTimeline(run: WorkflowRun): RunEvent[]`

- [ ] **Step 1: Write failing redaction test**

`src/lib/fleet/redaction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redaction";
import type { Secret } from "./types";

describe("redactSecrets", () => {
  it("replaces secret values without hiding normal params", () => {
    const secrets: Secret[] = [
      { id: "sec_1", name: "portal_password", scope: "workflow", value: "swordfish" },
    ];

    expect(redactSecrets("login swordfish for customer Acme", secrets)).toBe(
      "login [REDACTED:portal_password] for customer Acme",
    );
  });
});
```

Run:

```bash
npm run test -- src/lib/fleet/redaction.test.ts
```

Expected: fails because `redactSecrets` does not exist.

- [ ] **Step 2: Implement redaction and types**

Create strict union types for workflows, nodes, VMs, secrets, params, runs, and events. Implement `redactSecrets` with exact value replacement and skip empty values.

- [ ] **Step 3: Write failing runtime test**

`src/lib/fleet/runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { seedFleetState } from "./seed";
import { createManualRun, getRunTimeline } from "./runtime";

describe("createManualRun", () => {
  it("assigns a matching idle VM and redacts secrets in log events", () => {
    const state = seedFleetState();
    const run = createManualRun({
      workflow: state.workflows[0],
      vms: state.vms,
      params: state.params,
      secrets: state.secrets,
    });

    expect(run.status).toBe("succeeded");
    expect(run.vmId).toBe("vm_ubuntu_1");
    expect(getRunTimeline(run).some((event) => event.message.includes("swordfish"))).toBe(false);
    expect(getRunTimeline(run).some((event) => event.message.includes("[REDACTED:portal_password]"))).toBe(true);
  });
});
```

Run:

```bash
npm run test -- src/lib/fleet/runtime.test.ts
```

Expected: fails because runtime is missing.

- [ ] **Step 4: Implement seed data and runtime**

Seed data must include:

- One workflow named `Portal Login Check`.
- Nodes: Start, CLI Agent Task, Human Takeover, End.
- Three VMs with XRDP metadata.
- One param named `portal_url`.
- One secret named `portal_password` with value `swordfish`.

Runtime must select the first idle matching VM and create deterministic logs.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test
```

Expected: all tests pass.

### Task 3: CLI Agent Command Builders

**Files:**
- Create: `src/lib/fleet/agent-adapters.test.ts`
- Create: `src/lib/fleet/agent-adapters.ts`

**Interfaces:**
- Consumes: `AgentProvider` and shared domain types from `src/lib/fleet/types.ts`.
- Produces: `buildAgentCommand(request: AgentCommandRequest): AgentCommand`

- [ ] **Step 1: Write failing adapter tests**

Tests must prove:

- Claude Code uses `claude --print`.
- Codex uses `codex exec`.
- Direct API provider is disabled unless `allowApiFallback` is true.
- Secrets are provided through env names, not interpolated into args.

- [ ] **Step 2: Implement command builders**

`buildAgentCommand` returns:

```ts
type AgentCommand = {
  executable: string;
  args: string[];
  env: Record<string, string>;
  stdin?: string;
};
```

For Claude Code:

```bash
claude --print --output-format stream-json
```

For Codex:

```bash
codex exec --json --skip-git-repo-check
```

- [ ] **Step 3: Run adapter tests**

Run:

```bash
npm run test -- src/lib/fleet/agent-adapters.test.ts
```

Expected: pass.

### Task 4: Build Fleet Manager UI

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Create: `src/components/fleet/FleetManager.tsx`
- Create: `src/components/fleet/WorkflowCanvas.tsx`
- Create: `src/components/fleet/FleetSidebar.tsx`
- Create: `src/components/fleet/RunPanel.tsx`
- Create: `src/components/fleet/SecretsParamsPanel.tsx`

**Interfaces:**
- Consumes: `seedFleetState`, `createManualRun`, `buildAgentCommand`.
- Produces: A browser UI for workflow editing, fleet viewing, run simulation, XRDP details, secrets, and params.

- [ ] **Step 1: Write failing render test**

Create `src/components/fleet/FleetManager.test.tsx` to render `<FleetManager />` and assert visible text:

- `Computer Use Fleet`
- `Portal Login Check`
- `XRDP`
- `Claude Code`
- `Codex`

Run:

```bash
npm run test -- src/components/fleet/FleetManager.test.tsx
```

Expected: fails because the component does not exist.

- [ ] **Step 2: Implement UI components**

UI requirements:

- Dense operational dashboard, not a marketing page.
- Visual React Flow workflow canvas.
- Left fleet sidebar with VM states and XRDP connection values.
- Main workflow canvas.
- Right run panel with trigger buttons, latest run status, logs, and provider order.
- Params/secrets panel with redacted secret display.
- Button with play icon to run the workflow simulation.
- No nested cards.

- [ ] **Step 3: Wire page route**

`src/app/page.tsx` renders `FleetManager`.

- [ ] **Step 4: Run component test**

Run:

```bash
npm run test -- src/components/fleet/FleetManager.test.tsx
```

Expected: pass.

### Task 5: Verify And Commit MVP

**Files:**
- Modify as needed only to fix verification failures.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: committed MVP.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm run test
```

Expected: pass.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: pass.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add .
git commit -m "feat: build computer use fleet manager mvp"
```

Expected: commit succeeds.
