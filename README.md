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

Open http://localhost:3000, pick the seeded `Portal Login Check` workflow, and hit Run. The run is enqueued and drained by the built-in worker loop; the run panel streams events, status, and screenshot thumbnails.

To bring up a real VM (Ubuntu + XFCE + XRDP, provisioned and warm-snapshotted):

```bash
./virt/preflight.sh
AGENT_PASSWORD='…' ./virt/build-golden.sh        # staged, resumable
export CUF_GOLDEN_DOMAIN=cuf-golden CUF_SSH_KEY=$PWD/virt/.state/cuf_id
```

Then unset `CUF_AGENT_BACKEND` and set `OPENROUTER_API_KEY` + `CUF_GROUNDING_BASE_URL` for LLM-driven computer use, or stick to `script_task` / `browser_task` / `api_call` nodes, which need no model.

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

### Key environment variables

| var | purpose |
|-----|---------|
| `CUF_DB_PATH` | SQLite file (point at the shared Perceo DB) |
| `CUF_SECRET_KEY` | master key for secret encryption at rest (required to store secrets) |
| `CUF_GOLDEN_DOMAIN` | libvirt domain to bind as a fleet VM (single-VM shorthand) |
| `CUF_FLEET_JSON` | `[{domain,sshPort,rdpPort,…}]` — multi-VM fleet |
| `CUF_SSH_KEY` | controller SSH private key for the guest transport |
| `CUF_AGENT_BACKEND` | `mock` = model-free full-stack run |
| `OPENROUTER_API_KEY` / `CUF_PLANNER_MODEL` | planner model |
| `CUF_GROUNDING_BASE_URL` | UI-TARS grounding endpoint |
| `CUF_NOTIFY_WEBHOOK` | Slack-style webhook paged when a run needs a human |
| `CUF_ALLOW_SHELL` | `1` = enable `shell_task` (controller commands) |

See `.env.example` for the full list.

## How it works

1. **Author.** Build a workflow on the React Flow canvas (`Start → tasks → End`), or draft one from a plain-language task with the planner (`plan_workflow`). Workflows are validated before they save.
2. **Trigger.** Run manually (Run button / `POST /api/runs`), on a cron schedule, or via webhook (`POST /api/webhooks/:token`, whose JSON body becomes run params).
3. **Enqueue.** `POST /api/runs` returns `202` with a `queued` run. A worker drains the queue — the always-on server does it via the `instrumentation` loop; serverless/multi-instance hosts POST `/api/runs/process` on a cron. Claims are atomic, so multiple workers are safe.
4. **Acquire & reset.** The vm-daemon shells out to `virsh` to acquire an idle VM and restore its warm memory snapshot (~1–3s), giving each run a clean desktop.
5. **Execute.** The orchestrator dispatches each node: computer-use tasks run Agent S on the guest `:0` desktop over SSH; browser/script tasks run deterministic step lists; CLI-agent/shell/api tasks run on the controller. Every task resolves `{{secret.x}}` / `{{param.x}}` / `{{totp.x}}` at runtime, and all values are redacted from persisted logs.
6. **Pause for a human.** On a `human_takeover` node — or a task failing into one — the run pauses, the VM is held (no reset), and archfleet pages `CUF_NOTIFY_WEBHOOK`. Take over on the same live desktop via `.rdp` download (`GET /api/vms/:id/rdp`), `./virt/connect-xrdp.sh`, or the copyable connection block in the sidebar.
7. **Resume & review.** `POST /api/runs/:id/action` with `retry` / `resume` / `cancel`. Every step's screenshot is captured on the guest and scp-fetched to `data/artifacts/<runId>/`, shown as thumbnails and downloadable at `GET /api/runs/:id/artifacts/:name`.

See `RUNBOOK.md` for the full human-in-the-loop and 2FA playbook, and `ARCHITECTURE.md` for the layer/deploy topology.

## Features

- ✅ **Visual workflow editor** — React Flow canvas, validated before save.
- ✅ **Node types** — `computer_use_task` (Agent S, LLM), `script_task` (scripted pyautogui, no LLM), `browser_task` (Playwright step list, no LLM), `cli_agent_task` (Claude Code / Codex), `shell_task` (gated), `api_call`, `otp_email`, `human_takeover`, `condition`, `retry_wait`.
- ✅ **Async + durable runs** — atomic queue claim, backoff/retry when no VM is free, worker loop or external cron.
- ✅ **Triggers** — manual, cron schedule, and webhook (hashed token).
- ✅ **Encrypted secrets & params** — AES-256-GCM at rest (key derived from `CUF_SECRET_KEY`, kept out of the DB), redacted from all persisted events.
- ✅ **Runtime 2FA** — RFC 6238 `{{totp.seed}}` codes generated per run, plus an `otp_email` node that reads an IMAP inbox and extracts the code.
- ✅ **XRDP human-takeover** — pause + hold VM + page operator; land on the same `:0` desktop the agent was driving.
- ✅ **Model-free demo backend** — `CUF_AGENT_BACKEND=mock` proves the whole stack end to end.
- ✅ **MCP server** — `npm run mcp` exposes every fleet op as stdio tools (`list_workflows`, `run_workflow`, `get_run`, `create_trigger`, `create_secret`, `list_vms`, …). Register it with any MCP client; see `mcp.json.example`.
- 🚧 **Real VM fleet (libvirt/QEMU)** — the vm-daemon, `virsh` control, and guest runners are implemented and tested; provisioning is scripted (`virt/build-golden.sh`), but standing up a live golden image requires libvirt/qemu/guestfs-tools on the host and remains the least turnkey path.
- 🚧 **Multi-VM / scale-out** — safe by construction (atomic queue claim, `CUF_FLEET_JSON` fleet definition); exercised in unit tests, not yet run at scale.
- 🚧 **Operator UI polish** — the dashboard is functional (live fleet health, run history, secrets/triggers, XRDP copy) but not branded/marketing-grade; spacing, empty states, theming, and mobile are unpolished by design.

## MCP server

```bash
npm run mcp     # stdio MCP server over the fleet DB
```

Point any MCP client at it using `mcp.json.example` as a template.
