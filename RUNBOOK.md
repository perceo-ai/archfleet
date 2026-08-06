# archfleet runbook — handling user interaction

End-to-end flow for a workflow that needs a human at some point (login, MFA,
captcha, "does this look right?"), plus where passwords live.

## 1. Store the password (encrypted)

Secrets are AES-256-GCM encrypted at rest (key = `CUF_SECRET_KEY`, kept out of the
DB). Create one from the dashboard (Secrets panel) or:

```
POST /api/secrets  { "name": "portal_password", "scope": "workflow", "value": "…" }
```

Reference it in a node prompt — it is resolved per-run and **redacted from all logs**:

```
"Log in as {{param.portal_user}} using password {{secret.portal_password}}"
```

> The value must reach the guest so the agent can *type* it (and, for the planner
> step, the model). Use params for anything non-sensitive; secrets are redacted
> from persisted events but do travel to the guest/model at run time.

## 2. Put a Human Takeover node where interaction is expected

In the visual builder add a **`human_takeover`** node (or let a task fail into a
`failure` edge that leads to one). Reaching it pauses the run and **holds the VM**
(no snapshot reset) so the desktop state is preserved for you.

Node palette also has: `computer_use_task` (pixel agent), `cli_agent_task`
(claude/codex), `shell_task`, `condition`, `retry_wait`, `end`.

## 3. Trigger it

- Manual: Run button / `POST /api/runs {workflowId}`
- Schedule: cron trigger (server tick fires it)
- Webhook: `POST /api/webhooks/:token` — the JSON body becomes run params

Runs are async: you get a `queued` run id immediately; a worker executes it.

## 4. Get paged when a human is needed

Set `CUF_NOTIFY_WEBHOOK` (Slack-compatible). When a run reaches `paused`
(human_takeover) or `failed`, archfleet POSTs:

```
archfleet: run <id> of "<workflow>" is paused — take over via XRDP 127.0.0.1:13389 (user agent)
```

Poll status anytime: `GET /api/runs/:id` (events + artifacts + status).

## 5. Take over the desktop (XRDP)

Any of:
- **Download** `.rdp`: `GET /api/vms/:id/rdp` → open in any RDP client
- **CLI**: `AGENT_PASSWORD=… ./virt/connect-xrdp.sh` (or `HOST/PORT/USER` overrides)
- **Copy** the connection block from the fleet sidebar (Copy button)

You land on the *same* `:0` desktop the agent was driving — finish the manual step
(enter MFA, solve captcha, fix state).

## 6. Resume / retry / cancel

```
POST /api/runs/:id/action  { "action": "retry" | "resume" | "cancel" }
```
(MCP: `retry_run`, `cancel_run`.) `retry`/`resume` re-queue the run; `cancel` stops it.

## 7. Review what happened

Every step's screenshot is captured on the guest and scp-fetched to the
controller (`data/artifacts/<runId>/`), shown as thumbnails in the run panel and
downloadable at `GET /api/runs/:id/artifacts/:name`.

## Choosing an executor per step

- **`computer_use_task`** — pixel/vision agent (Agent S + UI-TARS). Works on any
  app; best when there's no clean DOM. Slower, model-gated.
- **`cli_agent_task`** — Claude Code / Codex non-interactively (no desktop).
- **`shell_task`** — a controlled command (enable with `CUF_ALLOW_SHELL=1`).
- **`browser_task`** — deterministic Playwright browser script (see below), for
  precise/fast web steps; alternates freely with `computer_use_task` on the same VM.
