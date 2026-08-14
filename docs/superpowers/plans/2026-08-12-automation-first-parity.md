# Automation-First Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring archfleet to parity with `docs/2026-08-12-archfleet-ux-backend-strategy.md` — Automation as the first-class object, prepared environments, evidence, human takeover records, prompt-to-automation drafts, automation-first home, and state-dependent run UX.

**Architecture:** Extend the existing layered Next.js app (`src/lib/fleet` pure domain + `/api/*` routes + React client pages). New SQLite tables ride the existing idempotent-schema mechanism plus a new column-migration helper. The Automation object wraps the existing Workflow graph; the graph stays as the advanced editing surface. UI moves from a single `FleetManager` useState-mode component to real routes.

**Tech Stack:** Next.js 16.3 (async route params, `Response.json`), React 19 client components, Tailwind v4 CSS-var tokens (dark), `node:sqlite` DatabaseSync, vitest 4 + RTL, dependency-injected I/O (no module mocks).

**Spec:** `docs/2026-08-12-archfleet-ux-backend-strategy.md`

## Global Constraints

- All API routes: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, awaited `params: Promise<{...}>`.
- Repos: pure functions taking `db: Db` first arg; tests use `openDb(":memory:")`, colocated `*.test.ts`.
- Schema: every statement idempotent; new tables added to `CUF_TABLES` in `src/lib/fleet/db/schema.ts`; column additions via new `ensureColumns` helper (PRAGMA table_info check) since `CREATE TABLE IF NOT EXISTS` cannot alter existing DBs.
- No module-level `vi.mock` for domain code — inject fakes as parameters.
- Dark theme only; reuse tokens from `globals.css` (`--purple #8b5cf6`, `--green #4ade80`, `--red #f87171`, `--card-bg`, `--border-color`); status colors ONLY from `src/components/fleet/status-colors.ts`.
- UX vocabulary from spec: "Automation", "Prepared environment", "Evidence", "Needs human", "Success criteria". Backend may keep profile/VM terms.
- Fleet/VM detail visible only on operator surface (`/fleet`), not the home page.
- LLM calls only through existing `AgentExec` injection (`runCliAgent`) — never direct API calls.

## Decisions on spec open questions (locked for this plan)

1. Automation spec stored as **both** `spec_markdown` (plain-language steps) and structured JSON columns (success_criteria, policies).
2. Draft = **one** CLI-agent call returning automation fields + workflow graph + `clarifying_questions[]` (surfaced, non-blocking).
3. React Flow graph kept, demoted to an "Advanced" tab on automation detail.
4. Evidence v1: rows derived from run artifacts (screenshot/file/log) + human criteria-review verdicts. No automated checks yet.
5. Prepared environment = persisted row referencing `profile:<slug>` label; health synced from `checkProfileFleet` best-effort.
6. Archductor/GitHub/Archivum integrations: `trigger_source` supports `"api"`; PR commenting and Archivum promotion out of scope.

---

### Task 1: Types + schema + migration helper

**Files:**
- Modify: `src/lib/fleet/types.ts`
- Modify: `src/lib/fleet/db/schema.ts`
- Modify: `src/lib/fleet/db/db.ts`
- Test: `src/lib/fleet/db/db.test.ts`, `src/lib/fleet/db/init-db.test.ts`

**Interfaces (produces):**

```ts
// types.ts additions
export type AutomationStatus = "draft" | "active" | "disabled";
export type AutomationHealth = "healthy" | "failing" | "needs_attention" | "unknown";
export type TriggerSource = "manual" | "schedule" | "webhook" | "api";
export type EnvironmentHealth = "ready" | "degraded" | "recovering" | "unknown";
export type TakeoverStatus = "open" | "resolved";
export type EvidenceType = "screenshot" | "file" | "log" | "criteria_review";

export type Automation = {
  id: string; name: string; goal: string;
  category: string;              // e.g. "general" | "semantic_test" | "data_extraction" | ...
  target: string;                // site/app/system
  specMarkdown: string;
  workflowId: string;
  environmentId?: string;
  successCriteria: string[];
  requiredSecrets: string[];
  mfaExpectation?: string;
  artifactPolicy: string;        // plain language
  retryPolicy: string;
  takeoverPolicy: string;
  triggerSuggestion?: string;
  riskNotes: string[];
  status: AutomationStatus;
  createdAt: string; updatedAt: string;
};
export type PreparedEnvironment = {
  id: string; name: string; description: string; labels: string[];
  profileRef?: string; health: EnvironmentHealth; snapshotState?: string;
  lastUsedAt?: string; recoveryState?: string; setupNotes?: string;
  createdAt: string; updatedAt: string;
};
export type EvidenceItem = {
  id: string; runId: string; automationId?: string; type: EvidenceType;
  artifactRef?: string; stepId?: string; description: string;
  verdict?: "pass" | "fail"; createdAt: string;
};
export type HumanTakeover = {
  id: string; runId: string; environmentId?: string; vmId?: string;
  reason: string; requestedAction: string; status: TakeoverStatus;
  openedAt: string; resolvedAt?: string; operatorNotes?: string;
};
// WorkflowRun gains: automationId?, environmentId?, triggerSource?, currentStep?, pausedReason?, resultSummary?
```

Schema: `cuf_automations`, `cuf_environments`, `cuf_evidence` (index on run_id, automation_id), `cuf_takeovers` (index on run_id, status); `cuf_runs` new columns via `ensureColumns(db, "cuf_runs", {...})` helper exported from `schema.ts` and called in `openDb` after `SCHEMA_SQL`. Helper: `PRAGMA table_info(<t>)` → `ALTER TABLE ADD COLUMN` for missing.

**Steps:**
- [ ] Failing tests: `CUF_TABLES` includes 4 new tables; `ensureColumns` adds a column to an existing table and is idempotent; fresh `openDb(":memory:")` has `cuf_runs.current_step`.
- [ ] Implement types + schema + helper; run tests; commit.

### Task 2: Repos

**Files:**
- Modify: `src/lib/fleet/db/runs-repo.ts` (+test)
- Create: `src/lib/fleet/db/automations-repo.ts` (+test), `environments-repo.ts` (+test), `evidence-repo.ts` (+test), `takeovers-repo.ts` (+test)

**Interfaces (produces):**

```ts
// runs-repo: saveRun switches to INSERT ... ON CONFLICT(id) DO UPDATE SET (preserves params_json/attempts/next_attempt_at);
// persists + reads new fields; RunSummary gains automationId?, currentStep?, resultSummary?, triggerSource?
export function listRuns(db, limit = 50, filter?: { automationId?: string; statuses?: RunStatus[] }): RunSummary[]
export function setRunProgress(db, id: string, currentStep: string): void
export function setRunOutcome(db, id: string, fields: { pausedReason?: string | null; resultSummary?: string | null }): void

// automations-repo
export function saveAutomation(db, a: Automation): void
export function getAutomation(db, id): Automation | undefined
export function listAutomations(db, filter?: { status?: AutomationStatus; category?: string }): Automation[]
export function deleteAutomation(db, id): boolean
export function automationHealth(db, id): { health: AutomationHealth; lastRun?: RunSummary }  // from last 5 runs
export function getAutomationByWorkflowId(db, workflowId): Automation | undefined

// environments-repo: saveEnvironment/getEnvironment/listEnvironments/touchEnvironment(db,id,lastUsedAt)/setEnvironmentHealth
// evidence-repo: addEvidence/listEvidenceByRun/listEvidenceByAutomation (filter by type)
// takeovers-repo: openTakeover/resolveTakeover(db,id,{operatorNotes?})/getOpenTakeoverForRun/listTakeovers(db,{status?})
```

**Steps:**
- [ ] Failing tests per repo (round-trip, filters, health derivation: last run failed → "failing"; open takeover → run-level "needs human" derivable; upsert preserves params_json after second save).
- [ ] Implement; tests pass; commit.

### Task 3: Run lifecycle wiring

**Files:**
- Modify: `src/lib/fleet/orchestrator.ts` (+test), `src/lib/fleet/server-runtime.ts` (+test), `src/app/api/runs/[id]/action/route.ts`

**Interfaces:**
- `OrchestratorDeps` gains `onProgress?: (nodeId: string, nodeName: string) => void` (called before each node executes) — orchestrator also records `pausedReason` on the returned run when outcome is paused (human_takeover node name / needs_human reason).
- `executeRunById`: wires `onProgress` → `setRunProgress`; after `runWorkflow`: writes `resultSummary` (final status + last event message), creates evidence rows from artifacts (type screenshot for image ext else file), opens takeover row when paused (reason + requestedAction from node prompt), touches environment `lastUsedAt`.
- Run action `resume`/`retry`/`cancel` resolves any open takeover for the run.
- `enqueueManualRun(workflowId, opts)` gains `opts.automationId?/environmentId?/triggerSource?` persisted on the run; **unknown workflowId returns undefined-workflow error instead of silently falling back to seed when automationId given**.

**Steps:**
- [ ] Failing orchestrator test: onProgress called per node in order; paused run has pausedReason.
- [ ] Failing server-runtime test: evidence rows created from artifacts; takeover opened on paused; resolved on cancel.
- [ ] Implement; tests pass; commit.

### Task 4: Automation draft module

**Files:**
- Create: `src/lib/fleet/automation-draft.ts` (+test)

**Interfaces:**

```ts
export type AutomationDraft = {
  automation: Automation;         // status "draft", ids generated (auto_*, wf_ shared id)
  workflow: Workflow;             // enabled: false
  clarifyingQuestions: string[];
  warnings: string[];             // risk/fragility + "run once before enabling"
  errors: string[];               // graph validation errors
};
export async function draftAutomation(prompt: string, agentExec: AgentExec, opts?: { id?: string; provider?: AgentProvider }): Promise<AutomationDraft>
```

One CLI call. System prompt asks for JSON `{name, goal, category, target, spec_markdown, steps:[…nodes…], edges, required_secrets, mfa_expectation, success_criteria, trigger_suggestion, artifact_policy, retry_policy, takeover_policy, risk_notes, clarifying_questions}`. Reuse `extractGraph`-style widest-JSON parsing and `normalizeWorkflow`-style node normalization (export/reuse from `planner.ts`). Defaults for every missing field; category heuristic default `"general"`.

**Steps:**
- [ ] Failing tests (fake agentExec returning canned JSON; malformed output → defaults + errors; underspecified → questions surfaced).
- [ ] Implement; tests pass; commit.

### Task 5: API routes + seed

**Files:**
- Create: `src/app/api/automations/route.ts` (GET list w/ health, POST upsert), `src/app/api/automations/draft/route.ts` (POST `{prompt, save?}`, maxDuration 300), `src/app/api/automations/[id]/route.ts` (GET incl. workflow+runs+health, PATCH partial, DELETE), `src/app/api/automations/[id]/run/route.ts` (POST → 202 run), `src/app/api/environments/route.ts` (GET w/ live profile health best-effort, POST, PATCH), `src/app/api/takeovers/route.ts` (GET `?status=`), `src/app/api/takeovers/[id]/resolve/route.ts` (POST `{operatorNotes?, action?: "resume"|"cancel"}`), `src/app/api/evidence/route.ts` (GET `?runId=|automationId=`)
- Modify: `src/lib/fleet/db/init-db.ts` + `src/lib/fleet/seed.ts` (seed default automation wrapping seed workflow + default prepared environment)

**Steps:**
- [ ] Implement routes following existing conventions; seed idempotent (only when `cuf_automations` empty); extend `init-db.test.ts`; commit.

### Task 6: MCP tools

**Files:** Modify `src/mcp/tools.ts` (+test)

Add: `list_automations`, `get_automation`, `upsert_automation`, `draft_automation`, `run_automation`, `list_environments`, `list_evidence`, `list_takeovers`, `resolve_takeover`. Same `{name, description, shape, run(db,args)}` pattern.

**Steps:**
- [ ] Failing tests driving handlers with in-memory DB; implement; commit.

### Task 7: UI shell + shared helpers

**Files:**
- Create: `src/components/shell/AppNav.tsx`, `src/lib/ui/api.ts` (typed fetch helpers), `src/components/ui/Badge.tsx`/`Card.tsx` (small atoms)
- Modify: `src/app/layout.tsx` (metadata "Perceo Archfleet", nav mount), `src/components/fleet/status-colors.ts` (add vm/op/env/takeover tone maps — single source), remove duplicated maps from consumers as they're touched.

Nav: Home `/`, Automations `/automations`, Environments `/environments`, Fleet `/fleet`, Users `/users`. Active-route highlight; "pe" badge wordmark kept.

**Steps:**
- [ ] Implement + RTL test for AppNav; commit.

### Task 8: Home page

**Files:** Create `src/components/home/HomeDashboard.tsx` (+test), rewrite `src/app/page.tsx`; create `src/app/automations/page.tsx` (all-automations list with lenses).

Home sections (spec "Home UX"): Needs human (open takeovers → run links), Running now, Failed/blocked recent runs, Drafts, Recent automations (health badges), Semantic tests category rail, Environments needing attention, compact fleet-status strip (counts only, link to /fleet). Primary CTA "New automation" → `/automations/new`. Lenses on /automations: category, status, needs-human, recently-failed filter chips.

**Steps:**
- [ ] RTL failing test (sections render from stubbed fetch); implement; commit.

### Task 9: New-automation page

**Files:** Create `src/app/automations/new/page.tsx` + `src/components/automations/DraftComposer.tsx` (+test).

Prompt textarea → POST `/api/automations/draft` → review card: editable name/goal/category/target/spec/success criteria/secrets (contextual copy per spec "Secrets and MFA UX"), clarifying questions block, risk warnings, trigger suggestion, "Save draft" and "Save + run once" CTAs.

**Steps:**
- [ ] RTL failing test; implement; commit.

### Task 10: Automation detail page

**Files:** Create `src/app/automations/[id]/page.tsx` + `src/components/automations/AutomationDetail.tsx` (+test).

Tabs: **Spec** (primary plain-language editor: goal, steps markdown, inputs/secrets, environment select, trigger management incl. cron/webhook via `/api/triggers`, success criteria list editor, artifacts, takeover points, retry), **Runs** (history w/ status/duration links), **Advanced** (WorkflowCanvas graph editor + enable/disable toggle). Header: health badge, Run now, status.

**Steps:**
- [ ] RTL failing test; implement; commit.

### Task 11: Run page

**Files:** Create `src/app/runs/[id]/page.tsx` + `src/components/runs/RunView.tsx` (+test).

State-dependent per spec "Run UX": running (desktop iframe via takeover API, current step, elapsed, events autoscroll, cancel/take over), paused (reason, requested action, open desktop CTA, resume/retry/cancel, operator notes → resolve takeover), completed (success criteria checklist + human pass/fail verdict → evidence `criteria_review`, evidence/screenshot grid from `/api/evidence`, artifacts, rerun, link to automation), failed (failure point = currentStep, last screenshot, events, retry, edit automation, recover environment link). Poll 2000ms while queued/running/paused.

**Steps:**
- [ ] RTL failing test per state (stubbed fetch); implement; commit.

### Task 12: Environments + fleet pages

**Files:** Create `src/app/environments/page.tsx` + `src/components/environments/EnvironmentsPanel.tsx` (+test); `src/app/fleet/page.tsx` + `src/components/fleet/FleetOps.tsx` (reuse/absorb ProfileSetupPanel + VM list, dark tokens).

Environments: card per prepared environment (health, last used, snapshot/recovery state, labels, notes), actions Prepare/Update/Recover wired to `/api/profile-ops`, create/edit environment metadata. Fleet (operator): VM table w/ live status, capacity counts, profile-status readiness, active profile ops w/ logs/capture/takeover.

**Steps:**
- [ ] RTL failing tests; implement; commit.

### Task 13: Cleanup + parity verification

**Files:** Delete `src/components/fleet/RunPanel.tsx`, `FleetSidebar.tsx`, `FleetManager.tsx` (+tests) once replaced; update `ARCHITECTURE.md` frontend section + `README` pointers; metadata/branding.

**Steps:**
- [ ] Remove dead code; `npm test`, `npx eslint`, `npm run build` all green.
- [ ] Re-read strategy doc section by section; write parity checklist into commit/PR body; fix gaps found.
- [ ] Commit.

## Self-review notes

- Spec coverage: Home UX→T8, Automation Object→T1/2/5, Draft→T4/9, Editing→T10, Prepared Envs→T2/5/12, Secrets/MFA UX→T9 copy + existing secrets API, Success criteria→T1/2/11 (human review v1), Run UX→T3/11, Fleet visibility→T12, Cost optimization→intentionally omitted (non-goal), Lenses→T8, Semantic testing→category + lens (T8/T10), Archductor/Archivum→trigger_source "api" + webhook (existing), rest out of scope per decisions.
- Types used consistently: `Automation.workflowId` ↔ runs `automationId`; `EvidenceItem.type` includes `criteria_review` used by T11.
