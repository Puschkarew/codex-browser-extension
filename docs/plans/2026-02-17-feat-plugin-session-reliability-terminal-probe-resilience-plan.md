---
title: feat: Improve plugin session reliability and terminal-probe resilience
type: feat
date: 2026-02-17
brainstorm: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-17-plugin-reliability-improvements-from-feedback-brainstorm.md
---

# feat: Improve plugin session reliability and terminal-probe resilience

## Overview
Define and ship a focused reliability pass for Browser Debug plugin + `fix-app-bugs` helper flows so repeated visual/debug runs require less manual session orchestration and produce better machine-readable failure evidence.

The plan targets the exact friction seen in feedback from 2026-02-17:
1. stale session conflicts (`409 SESSION_ALREADY_RUNNING`);
2. intermittent CDP/session instability between runs;
3. manual tab bootstrap for `navigate`-fragile scenarios;
4. limited diagnostic depth in `runtime.json` for `422` failures.

## Problem Statement / Motivation
Current primitives are strong (`/session/ensure`, `/session/stop`, terminal-probe artifacts, visual starter), but operators still do manual pre-steps (stop active session, open tab via CDP endpoint, rerun bootstrap) to keep runs deterministic. This slows iteration and weakens confidence in automation.

Primary motivation:
- reduce manual lifecycle steps around session reuse/new-session behavior;
- improve first-run success rate in terminal-probe scenarios;
- increase debugging speed by storing structured failure details instead of generic HTTP strings.

## Found Brainstorm Context (Step 0)
Found brainstorm from **2026-02-17**: **plugin-reliability-improvements-from-feedback**. Using as context for planning.

What carries forward:
- Recommendation selected: **Approach A (Session Lifecycle Autopilot)** as baseline.
- Secondary scope: smallest high-value subset of **Approach C (Deep Diagnostic Payloads)**.
- `--open-tab-if-missing` remains valuable but opt-in to avoid surprising browser side effects.

## Auto-Routing Decision (Contract Trace)
- `triggerMatched`: true
- `triggerClass`: runtime-bug
- `ruleId`: R4-trigger-taxonomy-runtime-bug
- `autoInvoked`: false
- `modeSelected`: core
- `fallbackUsed`: false
- `killSwitchState`: enabled

Planning note: no runtime execution is performed in this plan step; routing constraints are captured as implementation/validation requirements.

## Repository & Learnings Research (Step 1)
### Repo findings
- Terminal-probe auto-session currently calls `/session/ensure` with `reuseActive` and has `--no-reuse-active`, but no first-class forced replacement flow: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:255`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:780`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:818`.
- Script error storage currently emphasizes top-level error strings; command failures are collapsed into generic text in runtime entries: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:223`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:545`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:552`.
- Core API already supports session stop and explicit session-not-reusable responses:
  - `/session/ensure` emits `409 SESSION_ALREADY_RUNNING` when `reuseActive=false`: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:657`.
  - `/session/stop` exists and requires `sessionId`: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:677`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/shared/contracts.ts:101`.
  - Existing CLI stop pattern already resolves active session via `/health`: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/stop.ts:13`.
- CDP target attach path only lists existing page targets; there is no open-new-tab fallback in controller:
  `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/cdp-controller.ts:354`.
- `visual_debug_start.py` default minimal scenario is single `navigate`, which is aligned with reported fragility in some loops:
  `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:97`.

### Institutional learnings
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`
  - Key insight: automation contracts must preserve both machine-readable diagnostics and correct process exit semantics.
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/feedback-scope-and-safe-appurl-remediation-20260217.md`
  - Key insight: remediation commands must remain context-safe (`<project-root>` placeholder instead of implicit cwd), and machine-consumed contract fields should be regression-tested.
- Critical patterns file expected by the learnings workflow was not found in repo mirror:
  `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/patterns/critical-patterns.md`.

### Key insight summary
- Missing reliability behavior is mainly orchestration composition, not core capability absence.
- Small workflow flags and richer diagnostics can remove repeated manual recovery loops without re-architecting agent/runtime internals.
- Tests should enforce contract-level behavior (status codes, error fields, exit codes), not only happy-path output files.

## External Research Decision (Step 1.5)
Decision: **skip external research**.

Reason: this is an internal tooling reliability improvement with strong local code/docs coverage and no external API/security standard dependency that requires additional third-party guidance.

## Stakeholders
- Developers and agents running visual/debug sessions with terminal-probe.
- Maintainers of Browser Debug core API (`src/agent`) and CLI (`src/cli`).
- Maintainers of `fix-app-bugs` helper scripts and documentation mirrors.

## SpecFlow Analysis (Step 3)
### User Flow Overview
1. Operator runs terminal-probe pipeline with `--session-id auto`.
2. Pipeline resolves/creates session and executes scenario commands.
3. On command failure, runtime artifact must expose actionable error detail.
4. Operator reruns quickly without manual cleanup when desired behavior is “start fresh”.
5. Optional tab recovery path handles missing target before scenario steps.

### Flow Permutations Matrix
| Flow | Context | Expected outcome |
| --- | --- | --- |
| Auto session reuse | Active session matches target and is healthy | Session reused, no stop/start churn |
| Forced fresh session | Active session exists but operator wants clean run | Active session stopped, new ensured session returned |
| Active session conflict | Active running + `reuseActive=false` | Deterministic fallback path (force-new or explicit actionable error) |
| Missing target tab | No page target matches `tabUrl` | Optional tab-open helper creates target, then session ensure succeeds |
| Scenario command error | `422`/`503` from `/command` | `runtime.json` records structured error code/message/body snippet |
| Transient CDP outage | `/session/ensure` or command sees `CDP_UNAVAILABLE` | Retry/backoff (bounded) or explicit lifecycle diagnostic output |

### Missing Elements & Gaps
- **Category:** Session lifecycle ergonomics
  - **Gap:** No single flag that means “replace active session and continue.”
  - **Impact:** Manual `/session/stop` plus rerun loop.
- **Category:** Target acquisition
  - **Gap:** No opt-in tab-open recovery in pipeline.
  - **Impact:** Manual CDP `/json/new` steps for `navigate`-fragile scenarios.
- **Category:** Diagnostic depth
  - **Gap:** Command failures are summarized too aggressively in runtime artifact errors.
  - **Impact:** Slower triage for `422` validation and `503` CDP failures.
- **Category:** Lifecycle observability
  - **Gap:** Insufficient run-level reasoning for “why core/CDP became unavailable mid-loop”.
  - **Impact:** Repeated bootstrap without clear root-cause classification.

### Critical Questions Requiring Clarification
1. **Critical:** Should `--force-new-session` be default for `--session-id auto`, or opt-in?
   - If unanswered, default assumption: **opt-in** to preserve current semantics and avoid surprise session churn.
2. **Important:** Should tab-open recovery happen only on `TARGET_NOT_FOUND`, or also on first `navigate` failure?
   - If unanswered, default assumption: only on `TARGET_NOT_FOUND` (narrow safety envelope).
3. **Important:** What level of response body detail is safe to persist in runtime artifacts?
   - If unanswered, default assumption: include sanitized `error.code`, `error.message`, and truncated text body only.
4. **Nice-to-have:** Where to expose lifecycle diagnostics first: artifacts only or `/health` summary too?
   - If unanswered, default assumption: artifacts first; evaluate `/health` extension after one release cycle.

### Recommended Next Steps
1. Lock defaults above for v1 scope.
2. Implement session lifecycle autopilot and structured error persistence first.
3. Add opt-in tab recovery and starter scenario improvements second.
4. Validate with deterministic regression tests for all new flags/contract fields.

## Proposed Solution
Ship a thin reliability layer in three increments:
1. **Lifecycle Autopilot (P0/P1):** add `--force-new-session` flow that safely stops active session and ensures a fresh session when using auto resolution.
2. **Diagnostic Depth (P1):** enrich `runtime.json` scenario command entries with structured failure metadata (`status`, `error.code`, `error.message`, `responseBodySnippet`).
3. **Target Resilience + Starter UX (P2):** add `--open-tab-if-missing` and provide a built-in visual starter scenario profile for drag/parity loops.

This keeps existing architecture intact and applies YAGNI: reduce the highest-frequency failures first, defer heavier orchestration.

## Default Decisions for This Cycle
- `--force-new-session` is opt-in for v1.
- `--open-tab-if-missing` is opt-in and only triggers on target-missing classification.
- Runtime artifact error detail is sanitized + truncated by default.
- Lifecycle diagnostics begin in artifact payloads and command output; `/health` extension is optional follow-up.

## Technical Considerations
- **Routing contract constraints:**
  - Keep `Core mode` as default.
  - Preserve Enhanced fallback rule: if capability gate fails, execution continues in terminal-probe.
  - Do not introduce browser-side `fetch(debugEndpoint)` in terminal-probe improvements.
- **Backward compatibility:**
  - Existing flags and scripts continue to work unchanged when new flags are not provided.
- **Safety:**
  - Do not persist raw sensitive error payloads; use bounded/sanitized body snippets.
- **Test strategy:**
  - Expand smoke/regression tests for pipeline flags and failure contracts.
  - Keep existing exit-code contract coverage for visual starter.
- **Skill mirror discipline:**
  - If local `fix-app-bugs` skill source-of-truth is changed, sync and verify mirrors before commit (`npm run skill:sync:check`).

## Acceptance Criteria
- [ ] `terminal_probe_pipeline.py` supports `--force-new-session` for `--session-id auto` and can replace an active session without manual pre-stop.
- [ ] Forced-new-session behavior returns deterministic session metadata (`resolvedSessionId`, `reused=false`) in JSON output.
- [ ] Pipeline supports `--open-tab-if-missing` with guarded behavior on target-missing classification.
- [ ] `runtime.json` stores structured command failure details for non-2xx responses (status, code/message when present, sanitized body snippet).
- [ ] `visual_debug_start.py` offers at least one built-in scenario profile for drag/parity baseline flow (without requiring custom JSON file each run).
- [ ] Lifecycle failure classification is surfaced in terminal-probe output for CDP/session failures (at minimum in runtime/summary payload fields).
- [ ] Documentation updates land in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md`, and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md` where relevant.
- [ ] Regression checks pass for updated scripts/tests (`python3 skills/fix-app-bugs/scripts/test_terminal_probe_pipeline.py`, `python3 skills/fix-app-bugs/scripts/test_visual_debug_start.py`, `npm test`).

## Success Metrics
- At least 50% reduction in runs requiring manual `/session/stop` before pipeline rerun (sample: first 20 reliability-focused runs).
- At least 50% reduction in stale-session `409 SESSION_ALREADY_RUNNING` incidents in auto-session flows.
- At least 80% of `422` failures include actionable code/message detail in artifacts without re-running in debug mode.
- Faster diagnosis time for failed runs (target: under 2 minutes from failure to next concrete action).

## Dependencies & Risks
- **Dependency:** Core API session semantics (`/session/ensure`, `/session/stop`) must remain stable.
  - **Mitigation:** do not change endpoint contracts in this phase; compose existing behavior.
- **Risk:** new session flags may create confusion with `--no-reuse-active`.
  - **Mitigation:** define precedence explicitly in CLI help + docs and add conflict tests.
- **Risk:** tab-open fallback may open unintended tabs.
  - **Mitigation:** trigger only on explicit target-missing path and require exact/validated URL.
- **Risk:** richer error payloads may leak sensitive info.
  - **Mitigation:** strict truncation + redaction and contract tests around error serialization.
- **Risk:** improvements overlap with prior parity workflow docs and drift.
  - **Mitigation:** update docs in one PR and reference this plan in follow-up changes.

## Implementation Outline
### Phase 1: Session Lifecycle Autopilot (P0)
- [ ] Add `--force-new-session` to terminal-probe pipeline CLI.
- [ ] Implement flow: health -> active session lookup -> `/session/stop` -> `/session/ensure`.
- [ ] Define and test precedence with `--no-reuse-active` and `--session-id auto`.
- [ ] Extend JSON output with explicit lifecycle action trace (reused/stopped/new).

### Phase 2: Structured Error Diagnostics (P1)
- [ ] Extend `run_core_command()` failure mapping to preserve structured details.
- [ ] Add runtime artifact schema fields for command failure diagnostics.
- [ ] Add sanitization/truncation utility for body snippets.
- [ ] Cover `422`, `503`, and non-JSON error body cases in script tests.

### Phase 3: Target Recovery + Starter Scenarios (P2)
- [ ] Add optional `--open-tab-if-missing` handling path.
- [ ] Add built-in starter scenario profile(s) in `visual_debug_start.py` for drag/parity.
- [ ] Ensure behavior remains opt-in and does not break existing custom scenario files.
- [ ] Update operator docs with example commands for each mode.

### Phase 4: Observability and Rollout Validation (P2)
- [ ] Add lifecycle failure category fields to runtime/summary outputs.
- [ ] Run dry-run matrix across:
  - active stale session;
  - missing target tab;
  - transient CDP outage simulation;
  - command validation failure (`422`).
- [ ] Record before/after reliability metrics and confirm success criteria.

## Validation Strategy
Validation checklist for first rollout:
- [ ] Routing trace recorded in validation notes with required fields:
  - `triggerMatched=true`
  - `ruleId=R4-trigger-taxonomy-runtime-bug`
  - `modeSelected=core`
  - `fallbackUsed=false` (planning stage)
  - `killSwitchState=enabled`
- [ ] Contract checks for new flags/fields are added to script-level tests.
- [ ] Existing behavior remains unchanged without new flags (backward compatibility).
- [ ] Enhanced-mode documentation still enforces terminal-probe fallback when capability gate fails.
- [ ] No browser-side debug endpoint fetch calls are introduced into terminal-probe flow.

## AI-Era Notes
- Reliability automation should optimize for deterministic reruns and explicit machine contracts, not maximal command surface.
- Small, composable workflow primitives are preferred over a single monolithic orchestrator.

## References & Research
### Internal references
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-17-plugin-reliability-improvements-from-feedback-brainstorm.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Select Icons/docs/feedback/2026-02-17-fix-app-bugs-feedback.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:255`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:780`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:818`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:223`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:545`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:657`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:677`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:547`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/shared/contracts.ts:101`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/stop.ts:13`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/cdp-controller.ts:354`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:97`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-17-agent-feedback-24h-plugin-fix-app-bugs.md`

### Institutional learnings
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/feedback-scope-and-safe-appurl-remediation-20260217.md`
