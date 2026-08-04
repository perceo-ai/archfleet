# Computer Use Fleet Manager Design

## Goal

Build a local-first fleet manager for computer-use automation. A user can define a workflow visually, configure triggers, run the workflow on one of several local desktop VMs, inspect the run, and take over the VM through XRDP when needed.

The MVP optimizes for shipping a useful product fast:

- Multiple local VMs on one controller machine.
- Visual n8n-style workflow creation.
- Agent-assisted workflow creation from a plain-language task.
- Manual and scheduled execution.
- Secrets and run parameters.
- XRDP access to every computer-use VM.
- CLI-first agent execution using existing Claude Code and Codex subscriptions where possible before API-credit paths.

## Customer Impact

Customers get repeatable desktop automation without hand-running each task. They can start with a plain-language goal, review or edit the generated workflow visually, run it on an isolated VM, and intervene through XRDP when automation gets stuck.

The first customer-visible win is:

1. Create a workflow.
2. Attach secrets and params.
3. Run it on an available VM.
4. Watch logs/screenshots.
5. Open XRDP and take over if needed.

## Core Product

### Dashboard

The dashboard shows:

- Workflow list with status, last run, trigger state, and success rate.
- Fleet overview with VM name, status, assigned run, XRDP connection, health, CPU, memory, and disk usage.
- Run queue with active, queued, completed, failed, and canceled runs.
- Secrets and parameter sets.
- Trigger configuration.

### Visual Workflow Builder

The primary workflow surface is a visual graph editor. YAML/JSON is supported as import/export and advanced debugging, not as the default authoring experience.

Node types:

- **Start**: manual, schedule, webhook, or future event source.
- **Agent Planner**: takes a user goal and produces or updates a workflow graph.
- **Computer Use Task**: runs a desktop automation prompt on a selected VM.
- **CLI Agent Task**: runs Claude Code, Codex, or a configured local agent in non-interactive mode.
- **Shell Task**: runs a controlled command inside the VM or controller.
- **Human Takeover**: pauses execution and exposes XRDP instructions/button.
- **Condition**: branches on output, exit code, extracted data, or file presence.
- **Retry/Wait**: retries a failed node or waits for time/event.
- **Artifact**: collects files, screenshots, logs, downloads, or structured output.
- **End**: success/failure output.

Each node has:

- Inputs and outputs.
- Retry policy.
- Timeout.
- Required VM capabilities.
- Parameter references.
- Secret references.
- Log/artifact retention settings.

### Agent-Assisted Creation

The user can create a workflow two ways:

1. **Task-first**: describe the outcome, choose allowed apps/sites/tools, and let an agent propose a graph.
2. **Manual**: drag nodes, configure fields, and connect edges directly.

Agent-generated graphs are drafts. The user reviews and enables them explicitly.

### Triggers

MVP triggers:

- Manual run.
- Schedule/cron.
- Webhook URL with optional secret token.

Later triggers:

- File/drop folder.
- Email inbox.
- Slack/Linear/GitHub events.
- Run completion from another workflow.

### VM Fleet

The MVP manages multiple local VMs on one controller machine. Remote worker hosts are out of scope for the first build but should not be blocked by the design.

VM requirements:

- Local QEMU/KVM/libvirt VM lifecycle.
- Golden image/template support.
- Per-VM desktop user.
- XRDP service enabled.
- Health check agent or SSH check.
- Snapshot before run where possible.
- Reset/revert after run where possible.
- VM labels/capabilities, such as `linux-desktop`, `browser`, `office`, `gpu`, or `high-memory`.

VM states:

- `stopped`
- `starting`
- `idle`
- `assigned`
- `running`
- `needs_human`
- `resetting`
- `unhealthy`

### XRDP Access

Each VM has an XRDP connection profile:

- Host/IP.
- Port.
- Username.
- Credential source.
- Current assigned run.
- Connect/open action.

The app should show a one-click XRDP launch option where the OS/browser supports it and a copyable connection block everywhere else.

Human takeover flow:

1. Run pauses at a Human Takeover node or system-detected failure.
2. VM state becomes `needs_human`.
3. User opens XRDP.
4. User fixes the state manually.
5. User resumes, retries, or cancels the workflow.

### Secrets And Params

Secrets and params are first-class workflow inputs.

Params:

- Non-sensitive values.
- Can be set at workflow, trigger, or run level.
- Stored in plain database fields.
- Versioned with workflow revisions when defaults change.
- Examples: customer name, URL, search term, date range, output folder.

Secrets:

- Sensitive values.
- Stored encrypted at rest.
- Never shown after creation except by explicit reveal if supported.
- Injected only into the selected node runtime.
- Redacted from logs, screenshots metadata, agent prompts where possible, and run output.
- Examples: login password, API token, TOTP seed, license key.

Secret scopes:

- Global.
- Workflow.
- VM.
- Run override.

The runtime resolves values in this order:

1. Run override.
2. Trigger config.
3. Workflow defaults.
4. Global default.

## Cost Strategy: CLI Agents First

The system should prefer user-authenticated CLI agents before direct API-credit usage.

Default provider order:

1. Claude Code CLI in non-interactive mode.
2. Codex CLI in non-interactive mode.
3. Local OSS provider through the selected CLI where configured.
4. Direct model API only when the workflow explicitly chooses it or no CLI provider is available.

This matters because Claude Code and Codex can use subscription or locally authenticated access in many developer workflows, reducing direct API-credit spend.

### Claude Code Adapter

Use Claude Code non-interactively through `claude -p` / `claude --print`.

Supported capabilities:

- Prompt as command argument.
- Piped stdin for large context.
- `--output-format json` or `--output-format stream-json` for machine-readable runs.
- `--json-schema` for structured final output.
- Tool allow-lists such as `--allowedTools`.
- `--continue` or resume/session options when a workflow node continues prior context.

Do not use `--bare` by default because bare mode does not use OAuth/keychain subscription login. Offer it as an advanced option for deterministic CI-style runs where API-key auth is expected.

Official reference: https://code.claude.com/docs/en/headless

### Codex Adapter

Use Codex non-interactively through `codex exec`.

Supported capabilities:

- Prompt as command argument or stdin through `codex exec -`.
- JSONL event stream through `--json`.
- Final-message output through `--output-last-message`.
- Structured output through `--output-schema`.
- Explicit sandbox selection.
- Resume through `codex exec resume`.
- ChatGPT-managed CLI auth or a one-invocation API key if needed.

For non-repo workflow workspaces, use `--skip-git-repo-check` only inside controlled VM/controller sandboxes.

Official reference: https://learn.chatgpt.com/docs/non-interactive-mode

### Agent Adapter Interface

All agent providers implement one internal interface:

```ts
type AgentRunRequest = {
  provider: "claude-code" | "codex" | "local" | "api";
  prompt: string;
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  outputSchema?: unknown;
  allowedTools?: string[];
  secrets: Record<string, string>;
  params: Record<string, string | number | boolean | null>;
};

type AgentRunResult = {
  status: "succeeded" | "failed" | "timed_out" | "canceled";
  stdout: string;
  stderr: string;
  structuredOutput?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  };
  artifacts: string[];
};
```

The app stores stdout/stderr after redaction. Raw secret-bearing process environments are never persisted.

## Architecture

Recommended MVP stack:

- Next.js + TypeScript web app.
- Tailwind + shadcn/ui for UI.
- React Flow or equivalent for the visual workflow canvas.
- PostgreSQL/Supabase-compatible schema for app state.
- Local worker daemon on the controller machine.
- libvirt/QEMU/KVM for VM lifecycle.
- XRDP inside guest VMs.
- Node.js task runner for workflow orchestration.

### Components

**Web App**

- Workflow builder.
- Fleet dashboard.
- Run detail page.
- Secrets/params management.
- Trigger management.

**API Server**

- CRUD for workflows, revisions, triggers, runs, VMs, secrets, params.
- Webhook trigger endpoint.
- Run queue endpoints.
- Logs/artifacts endpoints.

**Workflow Runtime**

- Loads immutable workflow revision.
- Resolves params and secrets.
- Schedules nodes.
- Assigns available VM.
- Executes node adapters.
- Emits logs/artifacts/events.
- Handles retries, timeout, pause/resume, cancel.

**Local VM Daemon**

- Starts/stops/resets VMs.
- Reports VM health.
- Manages snapshots.
- Exposes XRDP connection metadata.
- Runs guest setup scripts.

**Agent Runner**

- Wraps Claude Code CLI, Codex CLI, local agents, and direct APIs behind adapters.
- Streams progress to run logs.
- Enforces timeouts.
- Redacts secrets.

**Artifact Store**

- Stores screenshots, logs, downloads, structured outputs, and run files.
- MVP can use local filesystem storage with database metadata.

## Data Model

Core tables/entities:

- `workflows`: id, name, description, current_revision_id, enabled, created_at, updated_at.
- `workflow_revisions`: id, workflow_id, graph_json, created_by, created_at.
- `triggers`: id, workflow_id, type, config_json, enabled, secret_token_hash, next_run_at.
- `runs`: id, workflow_id, revision_id, trigger_id, status, params_json, started_at, finished_at.
- `run_nodes`: id, run_id, node_id, status, attempts, started_at, finished_at, output_json, error.
- `vms`: id, name, provider, status, labels_json, xrdp_host, xrdp_port, username, last_health_at.
- `vm_assignments`: id, vm_id, run_id, status, assigned_at, released_at.
- `secrets`: id, name, scope_type, scope_id, encrypted_value, created_at, updated_at.
- `params`: id, name, scope_type, scope_id, value_json, created_at, updated_at.
- `artifacts`: id, run_id, node_id, type, path, metadata_json, created_at.
- `events`: id, run_id, node_id, level, message, metadata_json, created_at.

Workflow graph shape:

```json
{
  "nodes": [
    {
      "id": "node_1",
      "type": "computer_use_task",
      "name": "Log into portal",
      "config": {
        "prompt": "Open the portal and log in using {{secret.portal_username}}.",
        "timeoutMs": 600000,
        "requiredLabels": ["linux-desktop", "browser"]
      }
    }
  ],
  "edges": [
    { "from": "node_1", "to": "node_2", "condition": "success" }
  ]
}
```

## Key Flows

### Create Workflow From Task

1. User clicks New Workflow.
2. User enters task goal and optional apps/sites/files.
3. Agent Planner drafts graph.
4. User edits graph visually.
5. User maps required params/secrets.
6. User saves workflow revision.
7. User runs manually or adds trigger.

### Manual Run

1. User clicks Run.
2. User confirms params.
3. Runtime chooses idle VM matching labels.
4. VM daemon starts/resets VM.
5. Runtime executes graph.
6. Logs, screenshots, outputs, and artifacts stream to run page.
7. VM is released or held for inspection based on policy.

### Scheduled Run

1. Scheduler finds due trigger.
2. Runtime creates run from workflow current revision.
3. Params/secrets resolve from trigger/workflow/global scopes.
4. Run executes on available VM or waits in queue.
5. Trigger schedules next run.

### Human Takeover

1. Node fails, times out, or reaches Human Takeover.
2. Runtime pauses run.
3. Fleet manager exposes XRDP connection.
4. User connects to VM and fixes state.
5. User resumes, retries current node, skips node, or cancels.

## Security

- Encrypt secrets at rest with an app-level key stored outside the database.
- Redact secret values from logs before persistence.
- Avoid injecting secrets into global process env; inject per process/node only.
- Use per-run temp directories.
- Prefer VM snapshots/reset after runs.
- Keep XRDP reachable only from the controller/local network by default.
- Do not expose XRDP credentials in logs.
- Audit secret access and workflow run actions.
- Treat CLI auth files such as `~/.codex/auth.json` and Claude Code keychain/OAuth credentials as sensitive host credentials, not workflow secrets.

## MVP Scope

Included:

- Visual workflow editor.
- Agent-assisted graph draft.
- Manual/schedule/webhook triggers.
- Multiple local VMs on one machine.
- XRDP connection management.
- Secrets and params.
- Run queue.
- Run logs and artifacts.
- Claude Code and Codex CLI adapters.
- Direct API adapter only as fallback.

Not included:

- Remote worker hosts.
- Multi-tenant SaaS hosting.
- Billing.
- Team RBAC beyond a single local/admin user.
- Marketplace integrations.
- Complex workflow version diffing.
- Windows guest support unless already easy through the local VM template.

## Error Handling

- If no VM is available, run remains queued with reason `no_matching_vm`.
- If VM health check fails, mark VM `unhealthy` and retry assignment on another VM.
- If XRDP is unavailable, show diagnostics and keep run paused.
- If a secret is missing, fail before starting the node.
- If CLI provider is unavailable, use the next configured provider only when allowed by workflow policy.
- If a node times out, apply retry policy; after retries, pause or fail based on node config.
- If redaction detects a secret in output, store redacted output and emit a warning event.

## Testing Strategy

Unit tests:

- Workflow graph validation.
- Param/secret resolution order.
- Secret redaction.
- Agent adapter command construction.
- Run state transitions.

Integration tests:

- Manual workflow run with fake VM provider.
- Scheduled trigger creates run.
- Webhook trigger validates token and creates run.
- Agent adapter parses JSON/JSONL output.
- Human takeover pause/resume.

Local system tests:

- Start a template VM.
- Verify XRDP port is reachable.
- Run a simple browser task.
- Capture screenshot/artifact.
- Reset VM after run.

## Open Decisions

- Exact visual graph library.
- Exact database: local Postgres vs Supabase local stack.
- VM guest OS template.
- Whether the first computer-use executor is browser-only or full desktop from day one.
- How much direct remote-control streaming to build beyond XRDP.

## Phased Delivery

### Phase 1: Thin Vertical Slice

- App shell.
- VM registry with manual VM entries.
- Visual workflow with Start -> CLI Agent Task -> End.
- Manual run.
- Logs.
- Claude Code and Codex adapters.

### Phase 2: Local VM Automation

- libvirt VM lifecycle.
- XRDP connection display.
- VM assignment.
- Snapshot/reset hooks.
- Computer Use Task node.

### Phase 3: Real Workflow Operations

- Params/secrets UI.
- Schedule/webhook triggers.
- Artifacts.
- Human takeover.
- Retry/timeout/condition nodes.

### Phase 4: Polish And Extensibility

- Agent Planner graph generation.
- Better run replay/debugging.
- Workflow import/export.
- Remote worker host prep.
- More integrations.

## Spec Self-Review

- Marker scan: no unresolved scaffold text remains.
- Internal consistency: MVP is one controller with multiple local VMs; remote workers are later.
- Scope check: this is broad but still one product spec. Implementation should be split into phased plans.
- Ambiguity check: CLI agents are explicitly preferred over direct API usage; visual workflow is the primary editor.
