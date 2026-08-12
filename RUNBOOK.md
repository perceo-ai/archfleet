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

## Passing 2FA at runtime (data sources)

Two built-in ways to feed a fresh code to the agent mid-run:

**Authenticator (TOTP)** — store the base32 seed as a secret, reference it inline:
```
"Enter the 2FA code {{totp.mfa_seed}}"      # live RFC-6238 code, generated per run
```

**Email OTP** — an `otp_email` node reads the inbox, extracts the code, and stores
it in a run param that later nodes type:
```
otp_email node config (JSON):
  {"host":"imap.gmail.com","user":"{{secret.mail_user}}","pass":"{{secret.mail_pass}}",
   "fromContains":"bank.com","regex":"\\b(\\d{6})\\b","param":"otp"}
next node prompt: "type {{param.otp}} and submit"
```
(SMS/other sources: land the code via a webhook trigger → run param, or an
`api_call` to the provider, then reference `{{param.otp}}`.)

All of these resolve at execution time and are redacted from persisted logs.

## Preparing reusable logged-in VM profiles

Preferred path: use the dashboard's **Task Profile** panel. Enter the profile,
task, clone count, and agent password, then use **Draft workflow**, **Start
setup**, **Open source**, and **Capture**. The panel runs the same host scripts
below and streams their logs.

For sites where the right answer is "a person logs in once, completes MFA, trusts
the device, installs extensions, and leaves the browser ready", create a manual
profile fleet:

```
AGENT_PASSWORD='…' npm run vm:prepare-profile -- --profile bank --clones 2
```

To draft the Agent S setup workflow for that profile from a task description:

```
POST /api/profile-setup
{"profile":"bank","task":"Log into the bank portal and prepare monthly statement download","save":true}
```

The generated workflow runs an Agent S setup pass on `profile:bank`, then pauses
for manual login/2FA so the VM can be captured and cloned.

The script:
- starts the source domain (`cuf-golden` by default)
- prints the XRDP endpoint so you can log in and complete 2FA manually
- captures a live source snapshot named `profile-bank-manual`
- shuts down the source before copying its disk consistently
- defines clone domains such as `cuf-bank-1`, `cuf-bank-2`
- starts each clone and creates its `golden-warm` snapshot for per-run resets
- writes `virt/.state/bank.fleet.json` and `virt/.state/bank.env`

Use `--clones 0` when you only want a single prepared source domain snapshot.
Use `--replace` to intentionally overwrite existing clone domains/disks.

Workflow targeting:
```
requiredLabels: ["profile:bank"]
```

Practical limits: the live RAM snapshot preserves the exact open desktop for the
source domain. Clones preserve disk-backed state such as browser cookies, device
trust, installed apps, and config; each clone then has its own warm RAM snapshot.
Some services bind sessions to device or network fingerprints and may force a new
MFA check after cloning.

Clone exactness model:
- The source domain is the task golden for that profile.
- Clone disks are copied from the shut-down source disk after manual setup.
- Clone libvirt XML is generated from the source domain XML, preserving hardware
  shape and changing only domain name, disk path, generated UUID/MAC identity,
  and host-forwarded SSH/XRDP ports.
- Do not manually log into individual clones unless a site forces it; update the
  source profile, then regenerate clones with `--replace`.

## Updating a task golden profile

When a website session expires, Firefox needs an extension update, or an app/site
setup changes, update the source task golden and regenerate clones:

```
AGENT_PASSWORD='…' npm run vm:update-profile -- --profile bank --clones 2
```

This wrapper calls `prepare-profile.sh --replace`. The update process is:
- open the source VM over XRDP
- refresh the site login / 2FA / app state
- press Enter in the terminal
- replace existing clone domains and disks from the updated source disk
- rewrite `virt/.state/bank.fleet.json`

After updating, run recovery validation:

```
AGENT_PASSWORD='…' npm run vm:recover-profile -- --profile bank
```

## Recovering a profile fleet

Use recovery after host reboot, libvirt restart, failed run cleanup, or before
starting a batch:

```
AGENT_PASSWORD='…' npm run vm:recover-profile -- --profile bank
```

The recovery script reads `virt/.state/bank.fleet.json` and for each clone:
- checks that the libvirt domain exists
- checks that the configured warm snapshot exists
- reverts the clone to that snapshot with `--running`
- waits for SSH
- runs `/opt/agent/agent-runner/cli.py --selftest`

If a clone is defined but its warm snapshot is missing, recreate it from the
current clone state:

```
AGENT_PASSWORD='…' npm run vm:recover-profile -- --profile bank --repair
```

Use `--skip-selftest` only when you need a fast libvirt/SSH check and do not need
to prove the guest runner is healthy.

## Home server deployment checklist

On the server that owns the VMs:

```
cp .env.example .env.local
./virt/preflight.sh
HOST_BIND="$(ip -4 addr show docker0 | awk '/inet / {print $2}' | cut -d/ -f1)" AGENT_PASSWORD='…' ./virt/build-golden.sh
HOST_BIND="$(ip -4 addr show docker0 | awk '/inet / {print $2}' | cut -d/ -f1)" FLEET_HOST=host.docker.internal AGENT_PASSWORD='…' npm run vm:prepare-profile -- --profile bank --clones 2
AGENT_PASSWORD='…' npm run vm:recover-profile -- --profile bank
```

Use `HOST_BIND=127.0.0.1` for host-only development. Use the Docker host-gateway address for Docker bridge deployment; this keeps forwarded guest ports off the LAN while allowing the app container to connect through `host.docker.internal`.

Set `CUF_SECRET_KEY`, model/notification variables, and the generated fleet file.
For Docker Compose, use the container path mounted from `virt/.state`. Pass `--env-file .env.local` to Compose so values set here also affect compose interpolation:

```
CUF_LIBVIRT_URI=qemu:///system
CUF_SSH_KEY=/keys/cuf_id
CUF_FLEET_JSON_FILE=/keys/bank.fleet.json
# Docker bridge mode: use the host gateway for QEMU host-forwarded guest ports.
CUF_GUEST_HOST=host.docker.internal
# Optional browser-based XRDP takeover through Apache Guacamole + QuickConnect.
CUF_GUACAMOLE_URL=http://guacamole:8080/guacamole
CUF_GUACAMOLE_PUBLIC_URL=http://SERVER:8080/guacamole
CUF_GUACAMOLE_USERNAME=guacadmin
CUF_GUACAMOLE_PASSWORD=...
GUACAMOLE_ADMIN_PASSWORD=...
GUACAMOLE_BIND_HOST=127.0.0.1
GUACAMOLE_POSTGRES_PASSWORD=...
```

Set `GUACAMOLE_ADMIN_PASSWORD` and `CUF_GUACAMOLE_PASSWORD` to the same non-default value. The Guacamole compose stack refuses to start with the upstream `guacadmin` password and rotates the seeded admin account before exposing the web service. Keep the default `GUACAMOLE_BIND_HOST=127.0.0.1` unless Guacamole is behind a trusted network boundary or reverse proxy.

Start the app:

```
docker compose --env-file .env.local -f deploy/home-server.compose.yml -f deploy/guacamole.compose.yml up -d --build
docker compose --env-file .env.local -f deploy/home-server.compose.yml logs -f archfleet
```

The compose file persists:
- SQLite DB and artifacts: `./data`
- VM controller key mounted read-only in the container: `./virt/.state/cuf_id`
- libvirt access through `/var/run/libvirt`
- Guacamole PostgreSQL state and one-time init SQL: `./data/guacamole`

Quick checks:
```
curl -H "Authorization: Bearer $CUF_AUTH_TOKEN" http://127.0.0.1:3000/api/health
curl -H "Authorization: Bearer $CUF_AUTH_TOKEN" http://127.0.0.1:3000/api/profile-status
docker compose -f deploy/home-server.compose.yml ps
```

When Guacamole is configured, click **Open desktop** in the VM sidebar to launch
the selected XRDP desktop in the browser. If Guacamole is unavailable, the button
falls back to the `.rdp` download route.

## Choosing an executor per step

- **`computer_use_task`** — pixel/vision agent (Agent S + UI-TARS). Works on any
  app; best when there's no clean DOM. Slower, model-gated.
- **`cli_agent_task`** — Claude Code / Codex non-interactively (no desktop).
- **`condition`** — branches on prior workflow context. With `provider` set
  (`claude-code`, `codex`, `local`, or `api`) it asks a CLI model to return a
  `success`/`failure` decision; without `provider` it does simple text matching.
- **`shell_task`** — a controlled command (enable with `CUF_ALLOW_SHELL=1`).
- **`browser_task`** — deterministic Playwright browser script (see below), for
  precise/fast web steps; alternates freely with `computer_use_task` on the same VM.
