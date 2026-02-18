---
title: feat: Tighten parity rewrite readiness and session recovery for Browser Debug + fix-app-bugs
type: feat
date: 2026-02-17
brainstorm: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-17-fix-app-bugs-plugin-feedback-parity-rewrite-brainstorm.md
feedback: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Select Icons/docs/feedback/2026-02-17-fix-app-bugs-plugin-feedback-parity-rewrite.md
---

# feat: Tighten parity rewrite readiness and session recovery for Browser Debug + fix-app-bugs

## Overview
Plan a focused reliability upgrade for parity-rewrite workflows so Browser Debug + `fix-app-bugs` can move from "capability appears healthy" to "scenario execution is actually runnable" with less manual recovery.

The target outcomes are:
1. explicit run-readiness signaling;
2. first-class session recovery for transient lifecycle failures;
3. repeatable headed evidence capture without manual glue.

## Problem Statement / Motivation
Feedback from 2026-02-17 reports a recurring ambiguous state: instrumentation looked available while runtime execution still failed due to session/CDP lifecycle issues. The reported evidence included:
- `canInstrumentFromBrowser=true` while `checks.tools.cdp.ok=false` and `session.state=error`;
- terminal-probe scenario run blocked with `CDP_UNAVAILABLE`;
- headed parity evidence requiring manual Playwright orchestration.

Current contracts are strong, but they do not yet provide a single reliable go/no-go verdict for scenario execution and do not consistently self-heal session state before scenario pipelines.

## Found Brainstorm Context (Step 0)
Found brainstorm from **2026-02-17**: **fix-app-bugs-plugin-feedback-parity-rewrite**. Using as context for planning.

Carried decisions:
- Start with readiness contract tightening before broader orchestration.
- Treat session/CDP instability as recoverable workflow state.
- Keep first iteration recovery behavior explicit and opt-in.
- Sequence headed-evidence ergonomics after readiness/lifecycle correctness.

## Auto-Routing Decision (Contract Trace)
- `triggerMatched`: true
- `triggerClass`: runtime-bug
- `ruleId`: R4-trigger-taxonomy-runtime-bug
- `autoInvoked`: false
- `modeSelected`: core
- `fallbackUsed`: false
- `killSwitchState`: enabled

Planning note: this document defines implementation work only. Runtime routing/fallback constraints are captured here and enforced during execution workflows.

## Repository & Learnings Research (Step 1)
### Repo Findings
- Bootstrap already captures CDP/session diagnostics, but instrumentation gate is currently based on only `appUrl`, `preflight`, `debugPost`, and `query` checks: `skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:1166`, `skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:1370`.
- Existing payload includes `checks.tools.cdp`, `checks.coreHealth`, and `session` summaries that can power a stricter readiness verdict without major architecture changes: `skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:1335`, `skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:1400`.
- Guarded wrapper normalizes `session` and bootstrap metadata but does not compute run-readiness: `skills/fix-app-bugs/scripts/bootstrap_guarded.py:100`, `skills/fix-app-bugs/scripts/bootstrap_guarded.py:109`.
- Core runtime already exposes the required primitives for recovery:
  - `/session/ensure` conflict behavior (`409 SESSION_ALREADY_RUNNING`): `src/agent/runtime.ts:657`;
  - `/session/stop` endpoint: `src/agent/runtime.ts:677`;
  - `/command` CDP-unavailable contract: `src/agent/runtime.ts:753`.
- Terminal-probe supports auto-session resolution and `--no-reuse-active`, but no first-class forced replacement flow: `skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:779`, `skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:806`.
- Terminal-probe command failures are recorded, but structured classification is still shallow for recovery decisions: `skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:223`, `skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:281`.
- Visual starter currently defaults to a minimal one-step navigate scenario, which does not remove headed parity orchestration overhead by itself: `skills/fix-app-bugs/scripts/visual_debug_start.py:97`.

### Institutional Learnings
- `docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`
  - Key insight: machine-readable diagnostics must align with reliable exit semantics.
- `docs/solutions/logic-errors/feedback-scope-and-safe-appurl-remediation-20260217.md`
  - Key insight: remediation commands should remain context-safe and explicit.
- `docs/solutions/patterns/critical-patterns.md`
  - Status: missing in this repository mirror.

## External Research Decision (Step 1.5)
Decision: **skip external research**.

Reason: this is an internal workflow reliability scope with strong local contracts, implementation artifacts, and recent institutional learnings. No external compliance or third-party API changes are required for this planning pass.

## Stakeholders
- Agents and developers running parity/debug workflows.
- Maintainers of `skills/fix-app-bugs` scripts.
- Maintainers of Browser Debug Core API/CLI contracts.
- Reviewers relying on reproducible runtime evidence bundles.

## SpecFlow Analysis (Step 3)
### User Flow Overview
1. Operator runs guarded bootstrap for a parity task.
2. System determines whether scenario execution is genuinely runnable.
3. If not runnable, recovery path is selected (or explicit block/warn is returned).
4. Scenario pipeline runs with deterministic session behavior.
5. Headed evidence bundle is captured for parity proof and handoff.

### Flow Permutations Matrix
| Flow | Context | Expected Behavior |
| --- | --- | --- |
| Capability pass + healthy session | CDP/session normal | `readyForScenarioRun=true`, scenario execution proceeds |
| Capability pass + unhealthy session | CDP unavailable or `session.state=error` | `readyForScenarioRun=false`, explicit recovery guidance |
| Auto-session with active stale session | Existing session conflicts | optional force-new path replaces session deterministically |
| Transient CDP outage | intermittent transport/runtime failure | bounded self-heal attempt, then classified failure |
| Headed parity run | visual evidence required | one command emits runtime/metrics/summary + headed artifact |
| Fallback path | instrumentation gate fails | terminal-probe remains valid, no browser-side debug fetch |

### Missing Elements & Gaps
- **Readiness model gap:** no explicit final run-readiness contract.
- **Recovery orchestration gap:** no built-in stop+ensure flow in terminal-probe auto mode.
- **Failure clarity gap:** recovery-relevant classification is not first-class in scenario outputs.
- **Headed parity UX gap:** headed evidence closure still needs manual orchestration.

### Critical Questions Requiring Clarification
1. Should `readyForScenarioRun=false` block by default, or only warn?
   Default if unanswered: warn by default, add explicit strict/require flag for blocking behavior.
2. What precedence should apply between `--force-new-session` and `--no-reuse-active`?
   Default if unanswered: `--force-new-session` wins and implies no reuse.
3. How many auto-recovery attempts are acceptable before fail-fast?
   Default if unanswered: one bounded retry cycle.

### Recommended Next Steps
1. Lock contract fields and default semantics first.
2. Implement session recovery flow with explicit flags.
3. Add headed-evidence command path once readiness/recovery is stable.

## Proposed Solution
Deliver three scoped increments:
1. **Readiness Contract Tightening (P0):**
  - Add `readyForScenarioRun` verdict and `readinessReasons` in bootstrap output.
  - Fold CDP/session health into the final scenario readiness decision.
2. **Session Recovery Autopilot (P1):**
  - Add `--force-new-session` behavior to terminal-probe auto session flow.
  - Add optional bootstrap/session self-heal behavior for `session.state=error` and CDP-unavailable states.
3. **Headed Evidence First-Class Run (P2):**
  - Add a single headed-evidence run mode that emits required bundle artifacts with consistent schema.

## Default Decisions for This Cycle
- `Core mode` remains the default execution path.
- New recovery features ship opt-in in v1.
- `readyForScenarioRun` ships first as advisory with explicit strict option for fail-fast behavior.
- Headed evidence mode must always emit artifact metadata even on partial/failed outcomes.

## Technical Considerations
- Preserve auto-routing contract and fallback semantics in all flows.
- Do not add browser-side `fetch(debugEndpoint)` in terminal-probe fallback paths.
- Keep backward compatibility when new flags are not provided.
- Keep remediation commands explicit and context-safe (`<project-root>` placeholder where needed).
- Ensure payload changes remain machine-consumable and covered by script tests.

## Acceptance Criteria
- [x] Guarded/bootstrap outputs include `readyForScenarioRun` and explicit `readinessReasons`.
- [x] Readiness verdict considers `checks.tools.cdp`, `checks.coreHealth.activeSession.state`, and existing instrumentation checks.
- [x] `terminal_probe_pipeline.py` supports `--force-new-session` for `--session-id auto`.
- [x] Force-new session flow performs deterministic stop+ensure with clear `resolvedSession` metadata.
- [x] Failure output includes structured lifecycle classification for recovery decisions.
- [ ] A headed evidence run path produces `runtime.json`, `metrics.json`, and `summary.json` in one standardized flow.
- [x] Documentation updates are aligned across `README.md`, `README-debug.md`, and `AGENTS.md`.
- [x] Regression checks cover new contract fields, flag precedence, and failure-mode exits.

## Success Metrics
- >=50% reduction in manual stop/ensure pre-steps during parity reruns (sample: first 20 parity-focused runs).
- >=50% reduction in scenario launches that fail immediately after a nominal capability pass.
- >=80% of failed runs include actionable readiness/recovery classification without extra debugging reruns.
- Headed evidence closure time reduced (baseline-to-close median) versus manual orchestration flow.

## Dependencies & Risks
- **Dependency:** session lifecycle contracts in Core API remain stable.
  - **Mitigation:** compose existing `/session/ensure` and `/session/stop` semantics.
- **Risk:** stricter readiness could over-block flows in noisy environments.
  - **Mitigation:** advisory default + explicit strict mode.
- **Risk:** recovery automation may hide root-cause signals.
  - **Mitigation:** preserve detailed reason fields and lifecycle traces in outputs.
- **Risk:** docs/contract drift across mirrored skill/repo guidance.
  - **Mitigation:** update mirrored docs and run sync checks in the implementation phase.

## Implementation Outline
### Phase 1: Readiness Contract (P0)
- [x] Define new readiness fields and reason taxonomy.
- [x] Integrate CDP/session signals into final scenario-readiness verdict.
- [x] Add/update tests for readiness field behavior and compatibility.

### Phase 2: Session Recovery (P1)
- [x] Add `--force-new-session` to terminal-probe CLI and JSON outputs.
- [x] Implement stop+ensure flow with conflict-aware error handling.
- [x] Add bounded self-heal path for CDP/session error states.
- [x] Add tests for precedence and failure scenarios.

### Phase 3: Headed Evidence Run (P2)
- [ ] Add headed evidence command mode for parity tasks.
- [ ] Standardize bundle schema and partial-failure behavior.
- [ ] Add smoke/regression coverage for headed run outputs.

### Phase 4: Docs and Rollout Validation (P2)
- [x] Update docs and operator guidance.
- [ ] Run reliability validation matrix (healthy, stale session, CDP unavailable, fallback).
- [ ] Record before/after metrics against success criteria.

## Validation Strategy
- [x] Route trace captured with required fields:
  - `triggerMatched=true`
  - `ruleId=R4-trigger-taxonomy-runtime-bug`
  - `modeSelected=core`
  - `fallbackUsed=false` (planning stage)
  - `killSwitchState=enabled`
- [x] Script-level tests cover readiness fields and session-recovery flags.
- [x] Existing behavior remains unchanged when new flags are not used.
- [ ] Enhanced/fallback constraints remain intact for execution workflows.
- [ ] Validate headed evidence outputs in at least one headed run before claiming parity workflow success.

## References & Research
### Internal References
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-17-fix-app-bugs-plugin-feedback-parity-rewrite-brainstorm.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Select Icons/docs/feedback/2026-02-17-fix-app-bugs-plugin-feedback-parity-rewrite.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:1166`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:1370`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/bootstrap_guarded.py:100`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:779`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:657`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:677`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:753`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:97`

### Institutional Learnings
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/feedback-scope-and-safe-appurl-remediation-20260217.md`
