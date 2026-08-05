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

## Key env

| var | purpose |
|-----|---------|
| `CUF_DB_PATH` | SQLite file (point at the shared Perceo DB) |
| `CUF_SECRET_KEY` | master key for secret encryption at rest |
| `CUF_GOLDEN_DOMAIN` | libvirt domain to bind as a fleet VM |
| `OPENROUTER_API_KEY` | planner model (user-chosen via OpenRouter) |
| `CUF_GROUNDING_BASE_URL` | UI-TARS grounding endpoint |

Schedule triggers fire when something POSTs `/api/triggers/tick` (system cron, a
loop, or a platform cron).
