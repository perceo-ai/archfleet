# archfleet

Local-first **fleet manager for computer-use agents**. Define a task visually or in
plain language, run it on an isolated local desktop VM driven by an autonomous
computer-use agent ([Agent S](https://github.com/simular-ai/Agent-S)), watch the
run, and take over via XRDP when it gets stuck.

Part of the Perceo stack (alongside Archductor, Archivum). Shares one SQLite DB.

## What it does

- **Visual workflows** — Start → computer-use / CLI-agent tasks → End (React Flow canvas).
- **Real VM fleet** — libvirt/QEMU VMs with a warm memory snapshot for ~1–3s per-run reset.
- **Autonomous computer-use** — Agent S drives the guest desktop (screenshot → plan → act)
  inside the VM, wrapped with a bounded loop that bails to human-takeover when stuck.
- **CLI-first agents** — Claude Code / Codex adapters preferred over direct API spend.
- **Triggers** — manual, cron schedule, and webhook (hashed token).
- **Secrets & params** — secrets AES-256-GCM encrypted at rest, redacted from logs.
- **XRDP takeover** — every VM exposes a connection profile for manual intervention.

## Architecture

```
Next.js app (UI + API routes)         Guest VM (Ubuntu + XFCE + XRDP)
  ├─ orchestrator ── SSH ─────────────▶ agent-runner (bounded Agent S loop)
  ├─ vm-daemon ── virsh ──▶ libvirt/QEMU (warm-snapshot reset)
  └─ SQLite (node:sqlite, cuf_ tables) UI-TARS grounding (local or cloud GPU)
```

- `src/lib/fleet/` — domain logic: orchestrator, vm-daemon, computer-use transport,
  redaction, agent adapters, db (schema/runs/secrets), triggers (cron/repo/runtime).
- `src/app/api/` — `runs`, `runs/:id`, `triggers`, `triggers/tick`, `webhooks/:token`, `secrets`.
- `virt/` — guest provisioning (`provision.sh`, `build-golden.sh`), the Python
  `agent-runner/`, and UI-TARS serving (`ui-tars/`).

## Develop

```bash
npm install
npm run test        # vitest (TS) — domain logic + API assembly
npm run lint
npm run build
(cd virt/agent-runner && python3 -m unittest)   # runner unit tests
```

## Bring up a real VM

```bash
./virt/preflight.sh                              # checks libvirt/qemu/guestfs-tools/kvm
AGENT_PASSWORD='...' ./virt/build-golden.sh      # Ubuntu image → provision → warm snapshot
export CUF_GOLDEN_DOMAIN=cuf-golden              # bind the VM into the fleet
```

Grounding (UI-TARS) runs locally or in a container — see `virt/ui-tars/`.

**Model-free demo:** set `CUF_AGENT_BACKEND=mock` to run the full pipeline
(app → VM → guest → screenshot → report → artifact) to a green success without any
model — proves the whole stack end to end.

## Key env

| var | purpose |
|-----|---------|
| `CUF_DB_PATH` | SQLite file (point at the shared Perceo DB) |
| `CUF_SECRET_KEY` | master key for secret encryption at rest |
| `CUF_GOLDEN_DOMAIN` | libvirt domain to bind as a fleet VM |
| `OPENROUTER_API_KEY` | planner model (user-chosen via OpenRouter) |
| `CUF_GROUNDING_BASE_URL` | UI-TARS grounding endpoint |

## Hosting (long-running tasks)

Computer-use runs take minutes, so runs are **async + durable**:
- `POST /api/runs` **enqueues** and returns `202` immediately with a queued run.
- A worker drains the queue: the always-on server does it via the `instrumentation`
  loop; serverless/multi-instance hosts POST `/api/runs/process` on a cron
  (`maxDuration=300`). Claims are atomic (`claimQueuedRun`), so multiple workers
  are safe; no-VM runs back off (`next_attempt_at`) and retry.
- Poll `GET /api/runs/:id` for status + events + artifacts.
- Schedule triggers fire when something POSTs `/api/triggers/tick` (the loop does
  this too; or a platform cron).

### Docker

```bash
docker build -t archfleet .
docker run -p 3000:3000 -v $PWD/data:/data \
  -v /var/run/libvirt:/var/run/libvirt \
  -v $PWD/virt/.state:/keys:ro \
  -e CUF_LIBVIRT_URI=qemu:///system \
  -e CUF_GOLDEN_DOMAIN=cuf-golden -e CUF_SSH_KEY=/keys/cuf_id \
  -e CUF_SECRET_KEY=... -e OPENROUTER_API_KEY=... archfleet
```

Health probe: `GET /api/health`. The image bundles `virsh`/`ssh`; VM control needs
the mounted libvirt socket. Run the VM host + UI-TARS wherever GPUs live.

## MCP server

`npm run mcp` starts a stdio MCP server exposing every fleet op as tools
(`list_workflows`, `run_workflow`, `get_run`, `create_trigger`, `create_secret`,
`list_vms`, …). Register it with any MCP client — see `mcp.json.example`.
