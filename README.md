# archfleet

Local-first fleet manager for computer-use agents. Draw a task on a canvas or describe it in plain language, run it on an isolated desktop VM driven by an autonomous agent, watch every step, and take the keyboard yourself over XRDP when it gets stuck.

## About

Computer-use agents are unreliable exactly where it matters — logins, MFA, captchas, "does this look right?" archfleet wraps them in a durable, inspectable pipeline: real libvirt/QEMU VMs with warm-snapshot reset, encrypted secrets and runtime 2FA that flow to the agent without leaking into logs, and a `human_takeover` node that pauses the run, holds the VM, and pages you to finish the step on the same live desktop. Nothing leaves your machine unless you point it at a remote model.

## Part of the Perceo stack

Perceo is a local-first developer suite. archfleet is the computer-use fleet manager; it shares one SQLite database with its siblings:

- [Archductor](https://github.com/perceo-ai/conductor-arch) — orchestration
- [Archivum](https://github.com/perceo-ai/archivum) — knowledge and memory

Landing: **https://perceo.ai** · Docs: **https://docs.perceo.ai**

## Install

Requires Node 24. VM control additionally needs `libvirt`, `qemu`, and `guestfs-tools` on the host (the `virt/preflight.sh` script checks for them).

```bash
npm install
cp .env.example .env.local     # fill CUF_SECRET_KEY, etc.
npm run dev                    # http://localhost:3000
```

Run the checks:

```bash
npm run test     # vitest — domain logic + API assembly
npm run lint
npm run build
```

## Quickstart

You can exercise the entire pipeline — app → VM → guest → screenshot → report → artifact — without any model or GPU by using the mock backend:

```bash
CUF_AGENT_BACKEND=mock npm run dev
```

Open http://localhost:3000, open the seeded **Portal Login Check** automation, and hit **Run now**. The run is enqueued and drained by the built-in worker loop; the run page shows live status, the current step, events, and screenshot evidence.

To bring up a real VM (Ubuntu + XFCE + XRDP, provisioned and warm-snapshotted):

```bash
./virt/preflight.sh
AGENT_PASSWORD='…' ./virt/build-golden.sh        # staged, resumable
export CUF_GOLDEN_DOMAIN=cuf-golden CUF_SSH_KEY=$PWD/virt/.state/cuf_id
```

Then unset `CUF_AGENT_BACKEND` and set `OPENROUTER_API_KEY` + `CUF_GROUNDING_BASE_URL` for LLM-driven computer use, or stick to `script_task` / `browser_task` / `api_call` nodes, which need no model.

### Task profile VMs for 2FA-heavy sites

For portals that require a human login, MFA, captchas, device trust, browser extensions, or per-customer setup, use the dashboard's **Task Profile** panel. It drafts the setup workflow, starts the source VM, opens XRDP through the browser, waits for you to finish login, then captures and clones the prepared state. Update and recovery run from the same panel.

The underlying host command is still available:

```bash
AGENT_PASSWORD='…' npm run vm:prepare-profile -- --profile bank --clones 2
```

The script starts the source VM, prints the XRDP connection, waits while you log in and configure the desktop manually, snapshots that live source state, then copies the prepared disk into clone domains with distinct SSH/XRDP ports. It writes `virt/.state/bank.fleet.json` and an env snippet; workflows can target those VMs with `requiredLabels: ["profile:bank"]`.

What is preserved: installed apps, browser profiles/cookies, trusted-device state, downloaded files, and each clone's own warm snapshot after first boot. A live RAM snapshot preserves the exact open desktop only for the domain it was taken on; clones preserve disk-backed login state, and some services may still invalidate cloned sessions when device fingerprints change.

Update and recovery:

```bash
AGENT_PASSWORD='…' npm run vm:update-profile -- --profile bank --clones 2
AGENT_PASSWORD='…' npm run vm:recover-profile -- --profile bank --repair
```

`vm:update-profile` reopens the source task golden, lets you update logins/apps/site state, and rebuilds existing clones with `--replace`. `vm:recover-profile` reverts every clone in `virt/.state/bank.fleet.json` to its warm snapshot, waits for SSH, and runs the guest selftest; `--repair` recreates missing warm snapshots from the current clone state.

To create a draft Agent S setup workflow for a profile:

```bash
curl -X POST http://localhost:3000/api/profile-setup \
  -H 'content-type: application/json' \
  -d '{"profile":"bank","task":"Log into the bank portal and prepare monthly statement download","save":true}'
```

### Docker

```bash
docker build -t archfleet .
docker run -p 3000:3000 -v $PWD/data:/data \
  -v /var/run/libvirt:/var/run/libvirt \
  -v $PWD/virt/.state:/keys:ro \
  -e CUF_LIBVIRT_URI=qemu:///system \
  -e CUF_GOLDEN_DOMAIN=cuf-golden -e CUF_SSH_KEY=/keys/cuf_id \
  -e CUF_SECRET_KEY=… -e OPENROUTER_API_KEY=… archfleet
```

The image ships `virsh`/`ssh`; VM control needs the mounted libvirt socket. Health probe: `GET /api/health`.

### Home server deployment

Use the compose file when the home server hosts both archfleet and libvirt:

```bash
cp .env.example .env.local
./virt/preflight.sh
AGENT_PASSWORD='…' ./virt/build-golden.sh
HOST_BIND="$(ip -4 addr show docker0 | awk '/inet / {print $2}' | cut -d/ -f1)" \
FLEET_HOST=host.docker.internal \
AGENT_PASSWORD='…' npm run vm:prepare-profile -- --profile bank --clones 2
# add CUF_FLEET_JSON_FILE=/keys/bank.fleet.json to .env.local for Docker
# set CUF_GUEST_HOST=host.docker.internal when running in Docker bridge mode
# set CUF_GUACAMOLE_URL=http://guacamole:8080/guacamole, CUF_GUACAMOLE_PUBLIC_URL=http://SERVER:8080/guacamole, plus Guacamole credentials
# set GUACAMOLE_ADMIN_PASSWORD to a non-default value before enabling Guacamole
docker compose --env-file .env.local -f deploy/home-server.compose.yml -f deploy/guacamole.compose.yml up -d --build
```

Pass `--env-file .env.local` so Compose uses the same configuration for interpolation and container env. `CUF_LIBVIRT_URI` defaults to `qemu:///system` for the mounted host libvirt socket; set `CUF_LIBVIRT_URI=qemu:///session` in `.env.local` only if the container can reach your session daemon. In Docker bridge mode, set `CUF_GUEST_HOST=host.docker.internal` so the container can reach libvirt's host-forwarded SSH/XRDP ports. The compose file persists SQLite/artifacts under `./data`, mounts `./virt/.state` read-only for `CUF_SSH_KEY`, and mounts `/var/run/libvirt` so the app can reset and assign VMs.

VM host-forward ports bind to `127.0.0.1` by default. For Docker bridge deployment, set `HOST_BIND` to the Docker host-gateway address when building/preparing VMs and set `FLEET_HOST=host.docker.internal` so generated profile fleet JSON points the app container at that gateway without exposing clone ports on the LAN.

For browser-based desktop takeover, layer in `deploy/guacamole.compose.yml`, set `GUACAMOLE_ADMIN_PASSWORD`/`CUF_GUACAMOLE_PASSWORD` to the same non-default value, change `GUACAMOLE_POSTGRES_PASSWORD`, and set `CUF_GUACAMOLE_URL`, `CUF_GUACAMOLE_PUBLIC_URL`, and `CUF_GUACAMOLE_USERNAME=guacadmin`. Guacamole binds to `127.0.0.1` by default; set `GUACAMOLE_BIND_HOST=0.0.0.0` only when it is behind your trusted network or reverse proxy. The dashboard's **Open desktop** button will create the RDP session in Guacamole automatically; if those variables are not set, the same button downloads a `.rdp` file.

### Key environment variables

| var | purpose |
|-----|---------|
| `CUF_DB_PATH` | SQLite file (point at the shared Perceo DB) |
| `CUF_SECRET_KEY` | master key for secret encryption at rest (required to store secrets) |
| `CUF_GOLDEN_DOMAIN` | libvirt domain to bind as a fleet VM (single-VM shorthand) |
| `CUF_FLEET_JSON` | `[{domain,sshPort,rdpPort,…}]` — multi-VM fleet |
| `CUF_SSH_KEY` | controller SSH private key for the guest transport |
| `CUF_GUEST_HOST` | guest SSH/XRDP host; use `host.docker.internal` from Docker |
| `CUF_GUACAMOLE_URL` | internal Apache Guacamole API URL for built-in web XRDP takeover |
| `CUF_GUACAMOLE_PUBLIC_URL` | browser-reachable Apache Guacamole URL |
| `GUACAMOLE_ADMIN_PASSWORD` | non-default password used to rotate Guacamole's seeded `guacadmin` account |
| `GUACAMOLE_BIND_HOST` | host interface for Guacamole; defaults to `127.0.0.1` |
| `GUACAMOLE_POSTGRES_PASSWORD` | password for the bundled Guacamole PostgreSQL service |
| `CUF_AGENT_BACKEND` | `mock` = model-free full-stack run |
| `OPENROUTER_API_KEY` / `CUF_PLANNER_MODEL` | planner model |
| `CUF_GROUNDING_BASE_URL` | UI-TARS grounding endpoint |
| `CUF_NOTIFY_WEBHOOK` | Slack-style webhook paged when a run needs a human |
| `CUF_ALLOW_SHELL` | `1` = enable `shell_task` (controller commands) |

See `.env.example` for the full list.

## How it works

1. **Author.** Describe the task in plain language to the copilot in the automation workspace — archfleet drafts the whole automation (goal, graph, secrets, success criteria, risk notes) and lays it out as a graph for review. The graph *is* the automation: each node opens its own modal, the trigger sits above it and the “done means” criteria below. Power users can also draft a bare graph with `plan_workflow`.
2. **Prepare.** Name an environment and archfleet does the rest: it derives the fleet profile from the name, starts the source VM, and — when the desktop is up — the environment's own card asks *you* to sign in. Log in, pass 2FA, tick “trust this device”, hit capture, and it clones into ready desktops labelled `profile:<slug>`. That label is then a real constraint: an automation bound to this environment can only run on a desktop that carries it.
3. **Trigger.** Run manually (Run button / `POST /api/runs`), on a cron schedule, or via webhook (`POST /api/webhooks/:token`, whose JSON body becomes run params).
4. **Enqueue.** `POST /api/runs` returns `202` with a `queued` run. A worker drains the queue — the always-on server does it via the `instrumentation` loop; serverless/multi-instance hosts POST `/api/runs/process` on a cron. Claims are atomic, so multiple workers are safe.
5. **Acquire & reset.** The vm-daemon shells out to `virsh` to acquire an idle VM and restore its warm memory snapshot (~1–3s), giving each run a clean desktop.
6. **Execute.** The orchestrator dispatches each node: computer-use tasks run Agent S on the guest `:0` desktop over SSH; browser/script tasks run deterministic step lists; CLI-agent/shell/api tasks run on the controller. Every task resolves `{{secret.x}}` / `{{param.x}}` / `{{totp.x}}` at runtime, and all values are redacted from persisted logs.
7. **Ask a human.** On a `human_takeover` node — or any executor calling `POST /api/runs/:id/ask` / the `ask_human` MCP tool — the run stops and asks a *question*: a value, a choice, an approval, or just a hand. The VM is held (no reset) and archfleet pages `CUF_NOTIFY_WEBHOOK`. Answer it inline from the inbox; plain answers come back as `{{param.x}}`, answers marked secret as encrypted `{{secret.x}}`.
8. **Resume & review.** `POST /api/runs/:id/action` with `retry` / `resume` / `cancel`. Every step's screenshot is captured on the guest and scp-fetched to `data/artifacts/<runId>/`, shown as thumbnails and downloadable at `GET /api/runs/:id/artifacts/:name`.

9. **Lend the desktop out.** Other agents (OpenClaw, Hermes) get the same signed-in desktops through **sessions** — `POST /api/sessions` or the MCP tools. `run_task` hands archfleet a plain-language job and gets back a session to poll; `open_session(mode:"lease")` gives the agent the mouse and keyboard directly; `mode:"persist"` lets it sign into a *new* site on the profile's source desktop and `capture_session` makes that permanent. This is the point of the whole thing: until the internet is API-shaped, a logged-in desktop is the API.

See `RUNBOOK.md` for the full human-in-the-loop and 2FA playbook, and `ARCHITECTURE.md` for the layer/deploy topology.

## Features

- ✅ **Automations as the main object** — intent + workflow + trigger + prepared environment + success criteria + run history, drafted from plain language and reviewed before anything runs.
- ✅ **Inbox instead of a dashboard** — the landing page is the work queue: takeovers with inline resume, failed runs grouped by root cause (one fix, one retry), drafts awaiting activation.
- ✅ **State-dependent run view** — live desktop + current step while running; takeover reason, held desktop, operator notes while paused; criteria review + evidence when done; failure point + recovery paths on failure.
- ✅ **Evidence store** — screenshots/files/logs per run plus human pass/fail criteria reviews, queryable by run, automation, or associated PR/branch.
- ✅ **Automated evidence checks** — `text_found` / `url_reached` / `file_downloaded` / `screenshot_captured` assertions evaluated after every run and recorded as pass/fail evidence.
- ✅ **PR/branch association** — runs accept `branch`/`pr` (API body or webhook payload); semantic-test evidence is retrievable per PR for review (`GET /api/evidence?pr=42`).
- ✅ **Prepared environments** — the user-facing wrapper over profile VMs (logins, device trust, warm snapshots). Creating one starts its build and asks you for the one part that is yours: signing in. The environment then *decides* which desktop its automations may run on, rather than labelling them.
- ✅ **Computer-use sessions for other agents** — `run_task` (archfleet drives, with takeover/evidence/secrets included), `open_session(mode:"lease")` (the agent drives the mouse and keyboard), and `mode:"persist"` + `capture_session` (sign into a new site, or replace a session that expired, and fold it back into the profile). Over REST and MCP.
- ✅ **One desktop, one holder** — durable, expiring VM leases in SQLite, atomic across workers, so runs and agent sessions compete for capacity correctly and a killed controller frees its desktops instead of stranding them.
- ✅ **Graph-first workspace** — the automation is its graph, on its own full-viewport page (copilot left, canvas centre, live state right). The last run is painted onto the nodes, so a failure has a location, not just a step number.
- ✅ **Node types** — `computer_use_task` (Agent S, LLM), `script_task` (scripted pyautogui, no LLM), `browser_task` (Playwright step list, no LLM), `cli_agent_task` (Claude Code / Codex), `shell_task` (gated), `api_call`, `otp_email`, `human_takeover`, `condition`, `switch`, `wait`, `set_params`, `retry_wait`, plus any `custom` type you define.
- ✅ **A real rules engine** — every step's output is readable by later steps as `steps["Step name"]`, and `condition` / `switch` / `wait` / `set_params` branch on expressions (`steps["Fetch"].body.total > 1000 && params.region == "eu"`). Parsed and evaluated in-process — no `eval`, no prototype access — and validated when the workflow is saved, not at 3am.
- ✅ **Custom nodes without a deploy** — declare a node type's inputs and point it at an HTTP call, a shell command, or an expression. It appears in every automation's step palette immediately. Presets included for API calls, Slack posts, commands and computed values.
- ✅ **Async + durable runs** — atomic queue claim, backoff/retry when no VM is free, worker loop or external cron.
- ✅ **Triggers** — manual, cron schedule, and webhook (hashed token).
- ✅ **Settings that do something** — providers (planner + grounding models), notifications, behaviour defaults new automations inherit, and fleet wiring, all editable in the app. Stored value wins over the environment variable, which wins over the default, so existing deployments keep working and nothing needs a redeploy.
- ✅ **A setup flow that checks reality** — the Setup tab and the Inbox banner read actual state (is auth on, is the secret store working, is a model connected, are there desktops) and link straight to whatever is missing.
- ✅ **Encrypted secrets & params** — AES-256-GCM at rest (key derived from `CUF_SECRET_KEY`, kept out of the DB), redacted from all persisted events.
- ✅ **Runtime 2FA** — RFC 6238 `{{totp.seed}}` codes generated per run, plus an `otp_email` node that reads an IMAP inbox and extracts the code.
- ✅ **Human-in-the-loop for anything** — a run stops and asks a structured question (input / choice / approval / acknowledge); the answer flows back into it as a param or an encrypted secret. Not just logins: missing data, ambiguous choices, spend approvals.
- ✅ **XRDP human-takeover** — pause + hold VM + page operator; land on the same `:0` desktop the agent was driving.
- ✅ **Task profile operations** — browser-first setup, update, and recovery for logged-in task goldens.
- ✅ **Model-free demo backend** — `CUF_AGENT_BACKEND=mock` proves the whole stack end to end.
- ✅ **MCP server** — `npm run mcp` exposes every fleet op as stdio tools (`list_automations`, `draft_automation`, `run_automation`, `list_evidence`, `resolve_takeover`, `run_workflow`, `get_run`, `create_trigger`, `create_secret`, `list_vms`, …) plus the session surface (`run_task`, `open_session`, `session_act`, `get_session`, `close_session`, `capture_session`). Register it with any MCP client; see `mcp.json.example`.
- 🚧 **Real VM fleet (libvirt/QEMU)** — the vm-daemon, `virsh` control, and guest runners are implemented and tested; the initial base golden image still requires libvirt/qemu/guestfs-tools on the host.
- 🚧 **Multi-VM / scale-out** — safe by construction (atomic queue claim, `CUF_FLEET_JSON` fleet definition); exercised in unit tests, not yet run at scale.
- 🚧 **Operator UI polish** — the dashboard is functional (live fleet health, run history, secrets/triggers, XRDP copy) but not branded/marketing-grade; spacing, empty states, theming, and mobile are unpolished by design.

## MCP server

```bash
npm run mcp     # stdio MCP server over the fleet DB
```

Point any MCP client at it using `mcp.json.example` as a template.
