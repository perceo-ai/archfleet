# Profile-first flow: prepare once, automate forever, lend the desktop out

## The flow this exists to make real

    1. Create a VM profile      →  a desktop that will exist repeatedly
    2. Sign in on it            →  logins, MFA, device trust, extensions, files
    3. Build automations on it  →  repeated tasks: apply to jobs, book rooms
    4. Lend it to agents        →  OpenClaw / Hermes do general computer use on it

Stages 1 and 2 exist but are operator-raw and disconnected from the object stage 3
names. Stage 3's binding is decorative. Stage 4 does not exist. This design closes
all three gaps.

## What is actually broken today

**The environment→desktop binding does nothing.** `automation.environmentId` is
stored and threaded into the run (`server-runtime.ts`), but `orchestrator.ts:194`
picks the desktop from `node.config.requiredLabels`:

```ts
const requiredLabels =
  workflow.nodes.find((n) => runsOnVm(n.type))?.config.requiredLabels ?? [];
acquired = await deps.daemon.acquire({ requiredLabels, runId });
```

An automation bound to "Portal — logged in" lands on whatever desktop is free
unless someone hand-typed `profile:portal` into every node. The environment is a
label on a page, not a constraint on execution.

**VM exclusion is per-run.** `buildRunDeps` builds a fresh `createVmDaemon` per
run and `assignments` is an in-process `Map`. Nothing stops two concurrent runs
from reverting and driving the same domain. Today the serial worker loop hides
it; a session that holds a desktop across many HTTP requests would expose it
immediately.

**Two objects joined by a hand-typed string.** `PreparedEnvironment.profileRef`
is typed into a drawer by the user; the profile it names is created somewhere
else entirely (`ProfileSetupPanel`). Nothing checks they match.

**No ad-hoc surface.** All 30 MCP tools are workflow-shaped. An agent that wants
a logged-in desktop for one task must author, save, and run a workflow.

## Decisions taken

| # | Question | Decision |
|---|---|---|
| 1 | What does an external agent get? | **Both.** Task handoff is the default; a raw lease is the escape hatch. |
| 2 | Merge environment and profile? | **Keep two, auto-join.** `profileRef` stays a real seam so the fleet layer stays swappable; the user never types it. |
| 3 | How does state get back into a profile? | **Promotable session now, auto re-auth later.** A `persist` session runs on the source desktop and can capture back. |
| 4 | External agent auth | Existing bearer tokens. Session routes sit behind the same check; MCP tools wrap the same handlers. |
| 5 | Task handoff implementation | Compiles to an ephemeral workflow through `runWorkflow`, inheriting takeover, evidence, secrets and redaction. |

## Architecture

Three layers, built in order. Each is useful alone.

```
 A. Durable leases          cuf_vm_leases + LeaseStore injected into createVmDaemon
      ▲                     one desktop, one holder, process-wide and crash-safe
      │
 B. Environment binding     run.environmentId → profileRef → profile:<slug> label
      ▲                     the automation's environment decides the desktop
      │
 C. Sessions                task | lease | persist, over REST and MCP
                            the general computer-use surface for outside agents
```

### A. Durable leases

`createVmDaemon` gains an optional injected `LeaseStore`. The default is the
current in-memory `Map`, so existing behaviour and tests are unchanged.

```ts
export type LeaseStore = {
  /** Atomically claim `domain` for `holder`. False if someone else holds it. */
  claim(domain: string, holder: string, expiresAt: string): boolean;
  release(domain: string, holder?: string): void;
  heldDomains(now: string): string[];
  /** Extend a live lease; false if it was lost (expired and re-claimed). */
  renew(domain: string, holder: string, expiresAt: string): boolean;
};
```

The SQLite store makes `claim` atomic with a conditional insert, so it is correct
across worker instances — the same property `claimQueuedRun` already relies on:

```sql
INSERT INTO cuf_vm_leases (domain, holder, acquired_at, expires_at) VALUES (?,?,?,?)
  ON CONFLICT(domain) DO UPDATE SET holder=excluded.holder, ...
  WHERE cuf_vm_leases.expires_at < :now
```

Leases expire. A run or session that dies without releasing frees its desktop
after the TTL instead of stranding it. The worker loop sweeps expired rows.

**Why a TTL and not just release-on-exit:** the controller can be killed mid-run.
Without expiry, one `SIGKILL` permanently removes a desktop from the fleet.

### B. Environment binding

`RunWorkflowInput` gains `requiredLabels?: string[]`. The orchestrator unions
them with the node's own:

```ts
const nodeLabels = workflow.nodes.find((n) => runsOnVm(n.type))?.config.requiredLabels ?? [];
const requiredLabels = [...new Set([...(input.requiredLabels ?? []), ...nodeLabels])];
```

`executeRunById` resolves them from the run's environment
(`environmentId → profileRef → profile:<slug>`). A run bound to an environment
whose desktops do not exist stays `queued` with an event naming the environment
and profile, not a bare `no_matching_vm`.

Union, not replace: a node may legitimately demand a capability the environment
does not mention (`gpu`, `windows`). The environment narrows, it does not override.

### C. Sessions

One object, three modes. Persisted in `cuf_sessions`.

```ts
export type SessionMode = "task" | "lease" | "persist";
export type Session = {
  id: string;
  environmentId: string;
  mode: SessionMode;
  status: "starting" | "active" | "waiting_for_human" | "closing" | "closed" | "failed";
  runId?: string;        // task mode: the run it compiled to
  vmId?: string;         // lease/persist: the desktop held
  domain?: string;
  expiresAt: string;
  ...
};
```

**Task mode** — the default path. Compiles the request into an ephemeral
workflow and enqueues it:

    start → computer_use_task { prompt: task, requiredLabels: env } → end

The session is then a thin view over the run: status, events, artifacts, and any
open ask. An agent polls it, and answers a takeover through the ask API it
already has. Everything the engine does for a saved automation — secrets,
redaction, evidence, escalation — applies unchanged, because it *is* a run.

**Lease mode** — the escape hatch. Claims a desktop, returns its identity and an
RDP launch URL, then accepts batches of primitives:

    POST /api/sessions/:id/act { actions: [{click:[x,y]}, {type:"..."}, {screenshot:true}] }

Actions go over the existing SSH transport to `desktop_runner.py`, whose action
vocabulary is already exactly this. Screenshots come back through `scpFetch` as
artifacts. Every `act` renews the lease.

**Persist mode** — a lease against the profile's **source** desktop with the warm
revert skipped, so changes survive. Closing it offers a capture, which runs the
existing `update-profile.sh` to re-snapshot and re-clone. This is how a dead
cookie gets replaced six weeks in without rebuilding anything.

Ephemeral is the default everywhere. Persist is explicit, one desktop at a time,
and ends in the same human-confirmed capture step that exists today.

### Surface

| Route | Purpose |
|---|---|
| `POST /api/sessions` | Open. `{environmentId, mode, task?, ttlMs?}` |
| `GET /api/sessions/:id` | Status; for task mode, the run underneath |
| `POST /api/sessions/:id/act` | Lease/persist: run a batch of primitives |
| `POST /api/sessions/:id/close` | Release the desktop |
| `POST /api/sessions/:id/capture` | Persist: promote back into the profile |
| `GET /api/sessions` | List |

MCP tools wrapping the same handlers: `open_session`, `session_act`,
`get_session`, `close_session`, `capture_session`, and `run_task` as the
one-call task-mode shorthand. `list_environments` already exists and is how an
agent discovers what it can be signed in as.

### Environment creation owns the profile

`POST /api/environments` accepts `prepare: { clones, task, agentPassword }`. It
derives the slug from the name, writes the environment, starts the profile
operation, and stores `profileOpId` on the row. The drawer becomes the live
flow — name it, sign in on the desktop we open, capture, clones appear, ready —
and `ProfileSetupPanel` is rewritten onto the design system as the per-environment
operator view rather than a separate page-level concept.

`PreparedEnvironment` gains `profileOpId?: string` and `setupStage?: string`.

## Error handling

- **No desktop for the environment** — run stays `queued` (already the honest
  state) with an event naming the environment and profile.
- **Lease lost** (expired, re-claimed) — `act` returns 409 with the reason; the
  agent reopens rather than driving someone else's desktop.
- **Session outlives its TTL** — swept by the worker loop, desktop reverted.
- **Capture without `CUF_SECRET_KEY`** — reported, not silently skipped, matching
  how `applyAskAnswers` already handles unencryptable values.
- **Guest unreachable** — `act` surfaces the SSH failure verbatim; the lease is
  kept so the agent can retry or close deliberately.

## Testing

Everything below the API boundary is pure or injected, so it tests without
libvirt — the pattern the repo already uses.

- `LeaseStore` — claim/expiry/renew/steal against a `:memory:` db, including two
  concurrent claimants.
- Daemon — acquire honours the store; a held domain is not a candidate.
- Orchestrator — environment labels union with node labels; a run bound to an
  absent environment queues with the naming event.
- Session compile — task mode produces a valid workflow (`validateWorkflow`).
- Session act — primitives serialize to the shape `desktop_runner.parse_actions`
  accepts, asserted against that vocabulary.
- Routes — open/act/close/capture over a fake daemon and exec runner.

## Not doing

- Auto re-auth (decision 3C). It is an automation authored on top of persist
  sessions, not a subsystem, and it needs the capture step this design lands.
- Merging environment and profile into one object (decision 2A).
- Multi-tenant isolation of sessions. Single operator, bearer tokens.
- A non-libvirt fleet backend. The `profileRef` seam is kept so it stays possible.
