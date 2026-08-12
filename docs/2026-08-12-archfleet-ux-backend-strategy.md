---
title: "archfleet UX and Backend Strategy"
strategy_date: "2026-08-12"
last_reviewed: "2026-08-12"
status: "working strategy"
related_docs:
  - "docs/2026-08-12-perceo-suite-ux-strategy.md"
  - "docs/repo-summaries/2026-08-12-archfleet-summary.md"
---

# archfleet UX and Backend Strategy - 2026-08-12

## Purpose

This document defines the emerging archfleet product strategy after clarifying its role in the Perceo suite.

archfleet should be an open-source computer-use automation platform. Semantic testing remains one of the most important and differentiated use cases, but it should be framed as a flagship automation pattern rather than a separate product lane.

The product should help users describe browser/desktop work, turn that intent into repeatable automations, run those automations on prepared environments, handle real-world login/MFA/human-takeover problems, and preserve evidence from every run.

## Core Thesis

archfleet is a general computer-use automation platform.

The main user-facing object is an **Automation**:

**Automation = intent + workflow + trigger + prepared environment + success criteria + run history.**

Users should not have to start by drawing a workflow graph. They should be able to describe what they want in natural language, review a draft automation, run it once, and then save or schedule it.

Semantic testing fits naturally inside this model:

- Product flow test.
- Regression monitor.
- Release smoke.
- Screenshot assertion.
- Semantic QA check.

Testing should be strongly dogfooded and well-supported, but it should not force archfleet's whole UX into a test-management product.

## Product Role

archfleet owns:

- Automations.
- Prepared environments.
- Computer-use runs.
- Human takeover.
- Screenshots and artifacts.
- Run evidence.
- Workflow execution.
- Fleet operations.
- Retry/recovery.
- Semantic product-flow checks.

Archductor can trigger archfleet runs from development workspaces or PR context. Archivum can store important evidence, summaries, or learnings after review. But archfleet owns automation definitions, environments, run execution, and operational evidence.

## Non-Goals

Initial mature archfleet should avoid:

- Infrastructure-first fleet UI as the home experience.
- Graph-first workflow authoring for normal users.
- Cost/resource optimization dashboard.
- Generic enterprise RPA suite positioning.
- Hiding the messy reality of computer-use automation.
- Making Archductor own automation definitions.
- Treating semantic testing as the only product story.

Fleet, graph, and optimization surfaces exist, but they should support the automation experience rather than define it.

## First Wow Sequence

archfleet should sequence its early wow moments:

1. **Describe task -> watch it run.**
   The user describes a browser or desktop task and sees an agent execute it with live screenshots/status.

2. **Hit login/MFA -> human takeover works cleanly.**
   The system pauses, preserves the environment, asks the human to intervene, and resumes after takeover.

3. **Save it as repeatable automation.**
   The run becomes a reusable automation with environment, steps, trigger, success criteria, and history.

4. **Turn product flows into semantic tests.**
   As dogfooding matures, product flows become repeatable release checks with evidence.

The first experience should be visceral and understandable. The deeper value is repeatability.

## Home UX

Home should be automation-first.

It should surface:

- Recent automations.
- Running automations.
- Failed or blocked runs.
- Runs needing human input.
- Draft automations.
- Prepared environments needing attention.
- Recently changed/used automations.
- Semantic test/release-check automations as a visible category.

Fleet health should be visible as operational status, not the primary landing experience.

## Automation Object

An automation should include:

- Name.
- Goal.
- Category/purpose.
- Target site/app/system.
- Plain-language spec.
- Workflow steps.
- Prepared environment.
- Required secrets/MFA inputs.
- Trigger or schedule.
- Success criteria.
- Artifacts to capture.
- Retry policy.
- Human takeover points.
- Run history.
- Last result.
- Health/status.

The workflow graph can exist underneath, but the automation is the user's main conceptual object.

## Prompt-to-Automation Draft

Natural-language creation should produce a draft automation, not silently create a fragile workflow.

The user describes the goal. archfleet drafts:

- Goal.
- Workflow steps.
- Target app/site.
- Required prepared environment.
- Secrets needed.
- MFA/human takeover expectations.
- Success criteria.
- Trigger/schedule suggestions.
- Artifacts to capture.
- Retry behavior.
- Risk/fragility warnings.
- Estimated runtime/resources if readily available.
- Recommendation to run once before enabling.

The user confirms, edits, or asks follow-up questions. If the prompt is underspecified, archfleet should ask targeted questions rather than pretending it understands.

Templates can help common patterns later:

- Product flow test.
- Form fill.
- Data extraction.
- Account setup.
- Report download.
- Marketing workflow.
- Release smoke.

But natural-language draft creation should be the primary path.

## Editing UX

Normal automation editing should use a natural-language/spec editor.

Primary editable fields:

- Goal.
- Steps in plain language.
- Inputs and secrets.
- Prepared environment.
- Trigger.
- Success criteria.
- Artifacts.
- Human takeover points.
- Retry behavior.

The graph editor should be advanced/debugging UI. It is useful for power users and complex workflows, but it should not be the primary authoring surface for normal automation creation.

## Prepared Environments

The user-facing abstraction should be **Prepared Environment**, not primarily VM profile.

A prepared environment can include:

- Browser state.
- Logged-in account state.
- Device trust.
- Extensions.
- Desktop apps.
- Downloaded files.
- Secrets references.
- MFA expectations.
- Warm snapshot.
- Clone/recovery metadata.

Backend can continue using profile/fleet profile terminology if useful, but the UX should explain what the user gets: a reusable environment that is ready to run this kind of automation.

UX language:

- Prepared environment.
- Logged-in environment.
- Browser state.
- Environment health.
- Environment recovery.
- Clone environment.

This makes the login/MFA/device-trust model more understandable.

## Secrets and MFA UX

Secrets and MFA should appear contextually during automation setup.

The automation draft should say things like:

- "This needs a portal username/password."
- "This may need MFA."
- "Enter it now, use a saved secret, or pause for human takeover."
- "This step will type the secret into the remote desktop; it will not appear in logs."
- "Use a prepared environment if this site has device trust or repeated MFA."

A reusable vault can exist underneath, but the first UX should be the setup wizard. Users should not need to understand templating such as `{{secret.x}}` to create a useful automation.

## Success Criteria

Success criteria should be A-first, evidence-backed over time.

Near-term:

- User writes plain-language success criteria.
- archfleet stores and displays them with run screenshots/logs.
- Humans can review evidence against the criteria.

Over time:

- archfleet suggests explicit evidence checks when it can infer them.
- Power users can add checks.
- Semantic tests increasingly use evidence checks for reliability.

The product should avoid pretending that plain-language pass/fail is always enough. It is a good authoring interface, but reliable automation needs evidence.

Possible evidence checks later:

- Text found.
- URL reached.
- File downloaded.
- Screenshot captured.
- Element visible.
- API response.
- Form submitted.
- Email received.
- Visual state changed.

## Run UX

Run view should be state-dependent.

### Running

Optimize for live watch and trust.

Show:

- Live screenshot or stream.
- Current step.
- Current action summary.
- Elapsed time.
- Prepared environment.
- Logs/events.
- Artifacts as they appear.
- Cancel, pause, or take over.

### Paused

Optimize for human takeover.

Show:

- Why human input is needed.
- Exact requested action.
- Open desktop/takeover button.
- Timer/notification state.
- Resume, retry, or cancel.
- Operator notes.

The environment must remain held so the human lands on the same desktop state.

### Completed

Optimize for evidence and reuse.

Show:

- Success/failure.
- Success criteria.
- Evidence.
- Screenshots.
- Artifacts.
- Extracted outputs.
- Runtime.
- Rerun.
- Save/update automation.

### Failed

Optimize for recovery.

Show:

- Failure point.
- Screenshot at failure.
- Logs/events.
- Suggested cause if available.
- Retry from checkpoint if supported.
- Edit automation.
- Add takeover point.
- Recover environment.

## Fleet Visibility

The fleet layer should be operationally visible but not primary.

Normal users should see:

- Automation goal.
- Current step.
- Live screenshot/stream.
- Prepared environment.
- Status.
- Artifacts.
- Whether human input is needed.
- Retry/resume/cancel.
- Evidence of success/failure.

Operator surfaces should expose:

- Fleet health.
- Prepared environments.
- Warm snapshots.
- Capacity.
- Stuck environments.
- Recovery.
- Resource status.

Avoid making users stare at VM ports, libvirt details, or snapshot names unless they are in operator/debug mode.

## Cost and Resource Optimization

Do not foreground cost/resource optimization in the initial mature UX.

The product should collect enough backend telemetry to support optimization later, but early UX should not become an infrastructure dashboard.

Show only basic operational state when needed:

- Queued.
- Running.
- Paused.
- Failed.
- Prepared environment used.
- Duration.

Later optimization surfaces can cover:

- Boot time.
- Warm pools.
- Storage cleanup.
- Environment density.
- Queue tuning.
- Compute/cost controls.

## Organization and Lenses

Automations should be first-class objects with multiple lenses, not folders.

Useful lenses:

- All automations.
- Project/product.
- Environment.
- Category/purpose.
- Trigger/schedule.
- Status/health.
- Recently failed.
- Needs human.
- Semantic tests/release checks.
- Personal/business/general.

This keeps archfleet flexible. Automations may be personal, business, product, repo/release-related, or general operational workflows.

## Semantic Testing Pattern

Semantic testing should be a flagship automation pattern.

A semantic test automation includes:

- Product flow goal.
- Target environment.
- Starting URL/app.
- Steps.
- Plain-language success criteria.
- Evidence artifacts.
- Optional explicit checks.
- Release/branch/PR association.
- Run history.
- Failure evidence.

Examples:

- Sign up and verify onboarding completes.
- Create a project and invite a teammate.
- Upgrade billing plan and verify dashboard state.
- Download a generated report.
- Submit a form and confirm status.

This use case connects naturally to Archductor. A branch/PR can trigger archfleet semantic test automations, and evidence can attach back to review.

## Archductor Integration

Archductor can trigger archfleet runs. archfleet can provide evidence back to Archductor or GitHub.

Boundary:

- archfleet owns automations, environments, runs, evidence, and fleet ops.
- Archductor can trigger relevant archfleet automations from a workspace, branch, task, or PR.
- archfleet can comment on PRs or pull PR metadata as part of an automation step.
- Evidence can attach back to Archductor review or GitHub.

Do not make Archductor the automation manager. It is a development workspace system. archfleet remains the automation execution system.

## Archivum Integration

Archivum can ingest important archfleet evidence after review.

Candidate material:

- Run summaries.
- Semantic test results.
- Product behavior evidence.
- Repeated failure patterns.
- Environment setup learnings.
- Automation design notes.

Do not automatically dump every screenshot/log into Archivum's durable memory. archfleet can produce lots of operational noise. Archivum should receive reviewed or explicitly promoted knowledge.

## Backend Architecture

The current repo already points toward the right layered model:

- Automation/workflow definitions.
- Runs and events.
- Secrets.
- Triggers.
- VM/prepared environment management.
- Artifacts.
- Human takeover actions.
- MCP tools.

The mature backend should keep these layers explicit.

### Automation Store

Stores user-facing automation definitions:

- Goal/spec.
- Workflow.
- Prepared environment.
- Trigger.
- Success criteria.
- Required inputs.
- Artifact policy.
- Retry/takeover policy.
- Health/status.

### Workflow Engine

Executes typed nodes:

- Computer-use task.
- Browser/script task.
- API call.
- CLI/shell task where allowed.
- OTP/MFA helper.
- Human takeover.
- Condition/retry/wait.

The graph exists here, but normal users should not need to author directly in graph form.

### Run Store

Stores run lifecycle:

- Queued.
- Running.
- Paused.
- Completed.
- Failed.
- Cancelled.

Includes events, current step, environment lease, artifacts, screenshots, and operator actions.

### Prepared Environment Store

Stores environment/profile metadata:

- Name.
- Purpose.
- Labels.
- Source/golden state.
- Clone state.
- Health.
- Snapshot state.
- Login/MFA notes.
- Recovery state.
- Last used.

### Evidence Store

Stores screenshots, logs, files, outputs, success criteria evaluation, and extracted results.

Evidence should be retrievable by run, automation, PR/branch association, and artifact type.

### Trigger Store

Stores manual, schedule, webhook, API, and Archductor-triggered runs.

### Integration Layer

Supports:

- MCP server.
- API.
- Webhooks.
- Archductor trigger/evidence integration.
- GitHub PR comments or metadata pulls where useful.

## Data Model Sketch

### Automation

Fields:

- `id`
- `name`
- `goal`
- `category`
- `spec_markdown`
- `workflow_id`
- `environment_id`
- `success_criteria`
- `artifact_policy`
- `retry_policy`
- `takeover_policy`
- `trigger_ids`
- `status`
- `created_at`
- `updated_at`

### Prepared Environment

Fields:

- `id`
- `name`
- `description`
- `labels`
- `profile_ref`
- `health`
- `snapshot_state`
- `last_used_at`
- `recovery_state`
- `setup_notes`

### Run

Fields:

- `id`
- `automation_id`
- `workflow_id`
- `environment_id`
- `trigger_source`
- `status`
- `current_step`
- `started_at`
- `ended_at`
- `paused_reason`
- `result_summary`

### Evidence

Fields:

- `id`
- `run_id`
- `type`
- `artifact_ref`
- `step_id`
- `description`
- `created_at`

### Human Takeover

Fields:

- `id`
- `run_id`
- `environment_id`
- `reason`
- `requested_action`
- `status`
- `opened_at`
- `resolved_at`
- `operator_notes`

## Open Questions

- What is the minimum useful prompt-to-automation draft schema?
- Should the automation spec be stored as markdown, structured JSON, or both?
- How much of the existing React Flow graph should remain visible in default UX?
- What is the earliest evidence-check type worth implementing beyond screenshots/logs?
- How should prepared environments be named and grouped for non-technical users?
- How should archfleet authenticate when commenting on PRs?
- What run artifacts should be candidates for Archivum ingestion?
- What is the first dogfood semantic test for Perceo itself?

## Working Recommendation

Build archfleet around automations, not raw workflow graphs or VM fleets.

The user should start with natural language:

1. Describe the task.
2. Review a draft automation.
3. Provide needed secrets/MFA/environment setup.
4. Run once and watch.
5. Handle human takeover if needed.
6. Save, schedule, or refine.

Keep semantic testing as a flagship automation category. Make prepared environments understandable. Keep fleet operations visible but secondary. Hide cost/resource optimization until the core automation UX is strong.

