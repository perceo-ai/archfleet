# archfleet architecture

## How to run

```bash
npm install
cp .env.example .env.local          # fill CUF_SECRET_KEY etc.
npm run dev                         # http://localhost:3000
```

Bring up a real VM (needs libvirt/qemu/guestfs-tools — see preflight):

```bash
./virt/preflight.sh
AGENT_PASSWORD='…' ./virt/build-golden.sh          # staged, resumable
export CUF_GOLDEN_DOMAIN=cuf-golden CUF_SSH_KEY=$PWD/virt/.state/cuf_id
```

Then set models (`OPENROUTER_API_KEY`, `CUF_GROUNDING_BASE_URL`) for LLM
computer-use, or use `script_task`/`browser_task`/`api_call` which need no model.
Production: `docker build -t archfleet . && docker run …` (see README).

## Layers (today: one Next.js app, cleanly separable)

```
 Browser (React client components)        ← frontend, only talks to /api/* via fetch
   │
 Next.js API routes (Node runtime)        ← the "API server"
   │      instrumentation worker loop      ← drains the run queue + fires schedule triggers
   ▼
 src/lib/fleet/  (pure domain, no React)   ← the ORCHESTRATOR + repos + adapters
   ├─ orchestrator.ts   graph engine (branch/pause/retry, per-node dispatch)
   ├─ vm-daemon/*       virsh control + acquire/reset
   ├─ computer-use.ts   SSH transport to the guest runners
   ├─ cli-agent-runner  claude/codex
   ├─ db/*              node:sqlite repos (runs/workflows/secrets/vms/triggers)
   └─ triggers/*, planner.ts, notify.ts, templating.ts
   │  virsh / ssh
   ▼
 libvirt/QEMU VMs  →  guest runner (cli.py / desktop_runner.py / browser_runner.py) on :0
```

### Frontend ↔ orchestrator segmentation

- **Frontend is already decoupled at the API boundary** — every component talks to
  the server only through `/api/*` (fetch). It holds no orchestration logic.
- **The orchestrator is pure server-side code** in `src/lib/fleet/` with zero React
  imports; it's driven by API routes + the worker loop, and is injected with all
  I/O (VM control, exec, http) so it unit-tests without infrastructure.
- **To split into two services**: keep `src/lib/fleet` + `src/app/api` as an
  "orchestrator service" (Node, needs libvirt/ssh), and serve the React UI
  separately (static/edge) pointed at that service's URL. No orchestration code
  moves — only the deploy topology. Today they ship together for simplicity.

### What runs where

| Piece | Where it must run |
|---|---|
| Frontend (React) | anywhere (static) — just needs the API URL |
| API + orchestrator + worker | a Node server **with libvirt + ssh access to the VM host** |
| VMs + guest runners | the libvirt/QEMU host (can be the same box or remote) |
| UI-TARS grounding | wherever the GPU is (local or cloud) — reached by URL |
| SQLite | one shared file (`CUF_DB_PATH`) — point at the Perceo DB |

Scale-out: multiple API/worker instances are safe (atomic queue claim); add VM
hosts by expanding `CUF_FLEET_JSON`.

## Node types (executors)

| Node | Needs a model? | Runs where |
|---|---|---|
| `computer_use_task` | yes (Agent S + UI-TARS) | guest :0 desktop |
| `script_task` | **no** — scripted pyautogui actions | guest :0 desktop |
| `browser_task` | **no** — Playwright step list | guest :0 desktop |
| `cli_agent_task` | uses claude/codex CLI | controller |
| `shell_task` | no | controller (gated) |
| `api_call` | no — HTTP request | controller |
| `human_takeover` | — pauses + pages operator | — |
| `condition` / `retry_wait` | no — control flow | — |

All task nodes resolve `{{secret.x}}` / `{{param.x}}` at runtime, so passwords and
tokens flow to Agent S (typed), Playwright (`fill`), scripts, and API headers —
and are redacted from logs.

## Frontend maturity (honest)

The UI is a **functional operational dashboard** (Tailwind + React Flow): live
fleet health, editable workflow canvas, run history + screenshot thumbnails,
secrets/triggers management, XRDP copy. It is **not** branded/marketing-grade —
spacing, empty states, theming, and mobile are unpolished. It's built for an
operator, not a landing page. Polishing it is a distinct, sizeable design pass.
