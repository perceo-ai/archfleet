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
   ├─ orchestrator.ts   graph engine (branch/pause/retry, per-node dispatch, live progress)
   ├─ automation-draft  prompt → draft automation (goal/spec/criteria/graph/questions)
   ├─ vm-daemon/*       virsh control + acquire/reset
   ├─ computer-use.ts   SSH transport to the guest runners
   ├─ cli-agent-runner  claude/codex
   ├─ db/*              node:sqlite repos (automations/environments/evidence/takeovers/
   │                     runs/workflows/secrets/vms/triggers)
   └─ triggers/*, planner.ts, notify.ts, templating.ts
   │  virsh / ssh
   ▼
 libvirt/QEMU VMs  →  guest runner (cli.py / desktop_runner.py / browser_runner.py) on :0
```

## The flow

    1. Create an environment    →  naming it derives the fleet profile and starts the build
    2. Sign in on it            →  its own card asks you; you log in, then capture
    3. Build automations on it  →  the environment decides which desktop they run on
    4. Lend it to agents        →  sessions: general computer use for OpenClaw / Hermes

**An environment owns its profile lifecycle.** `POST /api/environments` with
`prepare` derives the `profile:<slug>` from the environment's own name, starts
`prepare-profile.sh`, and records the operation on the row (`profileOpId`,
`setupStage`). Nobody types a slug in two places and hopes they match.

**The environment is a real constraint, not a label.** A run resolves
`environmentId → profileRef → profile:<slug>` (`environmentLabels` in
`server-runtime.ts`) and the orchestrator unions that with the node's own
`requiredLabels` before acquiring. Union, not replace: the environment narrows
which desktop is acceptable; a node can still demand a capability the
environment never mentioned. A run with nowhere to go stays `queued` and says
which environment wanted what, rather than reporting a bare `no_matching_vm`.

**One desktop, one holder.** `cuf_vm_leases` + `LeaseStore`
(`vm-daemon/lease-store.ts`) is injected into `createVmDaemon`. A daemon is
built per run *and* per session call, so a process-local map could never have
excluded anything — two concurrent runs would each think the fleet was free.
Claims are one conditional upsert, so they are atomic across workers. Leases
expire: a controller killed mid-run frees its desktops on the TTL instead of
removing them from the fleet permanently. The lease is taken **before** the
snapshot revert — losing the claim race must mean never having touched the
domain.

### Sessions — general computer use for other agents

`lib/fleet/sessions.ts` (pure) + `session-runtime.ts` (I/O). One object, three
modes, over REST (`/api/sessions/*`) and MCP (`run_task`, `open_session`,
`session_act`, `get_session`, `close_session`, `capture_session`).

| Mode | Who drives | Desktop | What it is for |
|---|---|---|---|
| `task` | archfleet | a clean clone | "book a room at the Ace" — the default |
| `lease` | the agent | a clean clone | the agent wants the mouse and keyboard |
| `persist` | the agent | the profile **source**, state kept | sign into a new site; replace a dead cookie |

**`task` compiles to a workflow** (start → `computer_use_task` → end) and goes
through `runWorkflow`, so an outside agent's ad-hoc request inherits takeover,
evidence, secrets and redaction instead of reimplementing them. The session is a
view over the run — one object to poll, and `waiting_for_human` tells the agent a
person is the blocker rather than that it is being slow.

**`lease`/`persist` speak the primitives `desktop_runner.py` already accepts**
(`click`, `type`, `key`, `hotkey`, `scroll`, `screenshot`, …) — the same runner
`script_task` uses, so the guest needed no changes. A batch is validated whole
before any of it runs: a half-applied batch would leave the agent's model of the
screen silently wrong. Screenshots come back through `scpFetch`. Every `act`
renews the lease; a lost lease is a 409, never a write onto somebody else's
desktop.

**`persist` is how a profile stays alive.** Every acquire normally reverts the
warm snapshot, so nothing survives — right for repeatability, useless when a
cookie dies six weeks in. A persist session runs on the source desktop with the
revert skipped, and `capture_session` folds it back through the existing
`update-profile.sh` re-snapshot and re-clone. Ephemeral stays the default;
persist is explicit, one desktop at a time, and ends in the same human-confirmed
capture that already existed.

Sessions whose holder walks away are swept by the worker loop and their desktops
handed back.

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
| `human_takeover` | — pauses and **asks a human** (see below) | — |
| `condition` / `switch` / `wait` / `set_params` / `retry_wait` | no — rules + control flow | controller |
| `custom` | depends on its definition (http / shell / expression) | controller |

All task nodes resolve `{{secret.x}}` / `{{param.x}}` at runtime, so passwords and
tokens flow to Agent S (typed), Playwright (`fill`), scripts, and API headers —
and are redacted from logs.

## Frontend (graph-first, four surfaces)

Four nav items and one workspace. Static HTML demos of every screen live in
`.context/design/` (untracked) — open `.context/design/index.html` for the rationale and the design system.

| Route | Surface |
|---|---|
| `/` | **Inbox** — the work queue: takeovers with inline resume, failures grouped by cause (`lib/fleet/failure-groups.ts`), drafts awaiting activation, a fleet-pulse stat strip |
| `/automations` | The library: one row per automation with its last five runs, success rate, median duration, saved views |
| `/automations/[id]`, `/automations/new` | **The workspace** — its own full-viewport page (no app rail): copilot left, the graph in the middle, live state right. Same screen empty for a new automation |
| `/activity` | Every run, live and historical, with a 24h volume strip — the audit trail |
| `/runs/[id]` | One layout, state-dependent: paused (takeover), failed (diagnosis + recovery), succeeded (criteria + evidence). The run is also painted back onto the graph |
| `/environments` | Environments and **capacity** (the old `/fleet`) as tabs. `/fleet` redirects here |
| `/settings` | Everything you configure: setup checklist, providers, notifications, behaviour defaults, fleet wiring, secrets, node types, people and tokens. `/users` redirects here |

The user-facing object is the **Automation**, and the automation *is* its graph.
Every node is a button that opens its own modal — a workflow node, the synthetic
**trigger** node above the flow, or the synthetic **done means** node below it
(which holds the success criteria and evidence checks). Nothing expands inline,
so the middle column never grows.

### Configuration and setup

Configuration used to be environment-only, which meant a redeploy to change a
model and no way to see what was set. `lib/fleet/settings.ts` declares the
catalogue once — key, group, kind, help, the env var it falls back to — and that
one declaration drives both the Settings UI and the runtime:

    stored value  →  environment variable  →  built-in default

So an existing deployment behaves exactly as before until someone sets something
in the app. Values marked `secret` (API keys, the notification webhook) are kept
in the encrypted secret store, never in `cuf_settings`, and never returned to the
browser — the UI is told only whether one is set, and where the effective value
comes from.

What is actually wired, not just displayed: provider settings become the guest
runner's environment for the planner and grounding models; the notification
webhook and escalation window are read per run; `behaviour.allow_shell` decides
whether `shell_task` and shell-backed custom nodes execute at all; and the
behaviour defaults seed every new automation's retry, takeover and artifact
policy. A secret that cannot be encrypted (no `CUF_SECRET_KEY`) is reported and
skipped — the rest of the save still lands.

`lib/fleet/setup-status.ts` computes readiness from real state (auth configured,
secret store working, a provider connected, desktops and environments that
exist, a webhook, a first automation). It drives the Setup tab and a banner on
the Inbox, and every unfinished item links to the page that fixes it.

### Rules, data flow and custom nodes

Every node's result is readable by every later node. The orchestrator keeps a
`steps` map keyed by node name, so a rule can say what it means:

```
steps["Fetch invoices"].body.total > 1000 && params.region == "eu"
```

- **Expressions** (`lib/fleet/expr.ts`) are a hand-written parser + evaluator —
  no `eval`, no `Function`, and property access cannot reach a prototype. A
  missing path is `null`, so a rule about data that has not arrived is just
  false. Malformed rules are rejected at **save** time by `validateWorkflow`.
- **`condition`** takes `config.expr` — deterministic branching that costs
  nothing, instead of asking a model to decide. (The model-backed condition is
  still there for genuinely fuzzy calls.)
- **`switch`** takes ordered `config.cases`; the first true one wins and its
  label selects the `case:<label>` edge.
- **`wait`** pauses (`waitMs`) or polls a probe request until `untilExpr` holds,
  giving up at `timeoutMs`. A wait with a rule but nothing to poll fails
  immediately rather than spinning — the answer could never change.
- **`set_params`** computes params from expressions, so later steps read them as
  `{{param.x}}`.
- Templates understand `{{param.x}}`, `{{secret.x}}`, `{{totp.x}}`,
  `{{field.x}}` and the general `{{= any expression }}`.

**Custom node types** (`lib/fleet/node-types.ts`, `cuf_node_types`) are how the
palette grows without a deploy. A definition is data: a name, declared inputs,
and one of three primitives to run — `http` (template is JSON with url/method/
headers/body), `shell` (a command), or `expression` (a pure value). The
orchestrator compiles it per run: field values are templated, then the type's
template is templated with them. A definition can also declare `successExpr` to
override "2xx means success". Build them under **Settings › Node types** (with
presets) or over MCP (`upsert_node_type`); `eval_expression` checks a rule
before it goes into a graph.

### Asking a human for anything

A run that gets stuck does not "request a takeover" — it **asks a question**, and
the answer comes back into the run. The ask is data (`lib/fleet/human-ask.ts`):

```jsonc
{ "kind": "input",                       // input | choice | approval | acknowledge
  "question": "Which PO should this be filed under?",
  "detail": "The header has no PO and this vendor has three open ones.",
  "fields": [{ "name": "po", "label": "PO number", "type": "text" },
             { "name": "pin", "label": "Portal PIN", "type": "code", "secret": true }] }
```

Where asks come from:

- a `human_takeover` node's `config.ask` — authored in the node modal, no JSON required;
- `POST /api/runs/:id/ask` — any executor can stop mid-run and ask;
- the `ask_human` MCP tool — the same thing for a CLI agent driving a run.

What happens to the answer (`lib/fleet/ask-answers.ts`): plain values become run
params, so later nodes resolve `{{param.po}}`; values the ask marked `secret`
become run-scoped encrypted secrets (`{{secret.pin}}`) and are redacted from
every log. A secret that cannot be encrypted (no `CUF_SECRET_KEY`) is **reported,
not dropped** — the run stays paused rather than resuming without the value it
asked for. One component (`AskPanel`) renders every kind, so the inbox, the run
view and the workspace drawer all answer the same way.

Supporting pure modules, all unit-tested without React:

- `lib/fleet/graph-layout.ts` — deterministic layered layout (stored node
  positions are not trusted) plus the two synthetic nodes.
- `lib/fleet/run-node-states.ts` — reads per-node state out of a run's own
  events, so a node the orchestrator never mentioned shows as "not reached"
  rather than being guessed green.
- `lib/fleet/failure-groups.ts` — collapses N failed runs with one cause into
  one inbox item.
- `lib/fleet/human-ask.ts` — parse/validate/split any ask, however it arrives.
- `lib/fleet/node-timings.ts`, `lib/fleet/run-trends.ts` — per-node durations and
  hourly run buckets, both read from data the run already records.

The design system lives in `src/app/globals.css` as tokens plus component
classes (`.card`, `.pill`, `.gnode`, `.modal`, …). Status has one vocabulary —
green ok, red failed, blue in flight, violet needs-a-human, amber stale, grey
idle — carried over from the palette the app already used. Dark by default; the
token layer has a light override but the app ships dark.
