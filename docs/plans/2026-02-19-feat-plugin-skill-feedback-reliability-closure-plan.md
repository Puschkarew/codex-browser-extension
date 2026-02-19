---
title: feat: Close feedback-driven reliability gaps in Browser Debug plugin + fix-app-bugs
type: feat
date: 2026-02-19
brainstorm: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-19-plugin-skill-feedback-improvements-brainstorm.md
---

# feat: Close feedback-driven reliability gaps in Browser Debug plugin + fix-app-bugs

## Enhancement Summary
**Deepened on:** 2026-02-19  
**Sections enhanced:** 7  
**Research passes used:** `repo-research-analyst`, `learnings-researcher`, `spec-flow-analyzer`, `architecture-strategist`, `performance-oracle`, `security-sentinel`, `code-simplicity-reviewer`

### Key Improvements
1. Added explicit preflight/retry design constraints so runtime recovery is bounded and measurable.
2. Added security and performance guardrails for new recovery/error paths.
3. Added rollout gates that require artifact-backed closure before promoting backlog status.

### New Considerations Discovered
- Reconnect/rebind behavior must be limited to idempotent commands to avoid side effects.
- Error payload improvements should remain privacy-safe (`responseBodySnippet` and diagnostics redaction discipline).
- Reliability claims should include stress-style validation windows, not single-run passes.

## Overview
Define and execute a focused closure plan for feedback-reported reliability gaps in Browser Debug runtime and `fix-app-bugs` helper workflows. The plan follows the agreed sequencing (`P0 -> P1 -> P2`) and keeps scope limited to deterministic run reliability, recovery actionability, and diagnostics consistency.

Primary outcomes:
1. fewer early run interruptions (`navigate`, session ensure);
2. one deterministic recovery command for common failure categories;
3. one canonical diagnostics verdict path for black-screen triage.

## Problem Statement / Motivation
The feedback report from **2026-02-19** identifies confirmed failures that still degrade operator velocity:
- stale/closed WS command failures (`VALIDATION_ERROR`, readyState closed);
- fragile session attach requiring manual lifecycle flags;
- framebuffer/screenshot contradiction in black-screen checks;
- mode interpretation drift between bootstrap and execution outputs;
- non-prescriptive error payloads for first-line recovery.

These are reliability and workflow-clarity issues, not feature gaps. The plan targets closure with evidence-backed acceptance checks and artifact-based sign-off.

## Found Brainstorm Context (Step 0)
Found brainstorm from **2026-02-19**: **plugin-skill-feedback-improvements**. Using as context for planning.

Carried decisions:
- Keep scope tight: reliability + workflow clarity only.
- Execute in sequence: Runtime Reliability First -> minimal Recovery/Mode Clarity -> Canonical Diagnostics.
- Keep `Core mode` default and preserve fallback safety behavior.
- Require deterministic `nextAction` guidance for common failure classes.

## Auto-Routing Decision (Contract Trace)
Routing trace for this planning run:
- `triggerMatched`: true
- `triggerClass`: runtime-bug
- `ruleId`: R3-EXPLICIT-ROUTE
- `autoInvoked`: true
- `modeSelected`: core
- `fallbackUsed`: false
- `killSwitchState`: enabled

Planning constraints carried forward:
- Preserve `Core` as default planning mode; `Enhanced` remains optional for strict evidence execution.
- Preserve fallback invariant: if capability gate fails during execution, continue in `terminal-probe`.
- Do not introduce page-side `fetch(debugEndpoint)` calls in `terminal-probe` paths.

## Repository & Learnings Research (Step 1)
### Repo findings
- Canonical readiness and next-action contract is already centralized in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:315`.
- Popup surfaces readiness summary and next-action hints through health patch mapping in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/extensions/humans-debugger/background.js:55` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/extensions/humans-debugger/popup.js:20`.
- Session recovery classification and fallback actions are present in pipeline logic (`target-not-found`, `session-already-running`, `cdp-unavailable`) at `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:701`.
- Pipeline already warns about framebuffer/screenshot mismatch and prioritizes screenshot metrics in warning text at `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:1476`.
- WebGL diagnostics confidence caveats are encoded in runtime (`preserveDrawingBuffer` and compositor caveat) at `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/cdp-controller.ts:333`.
- Starter already exposes mode selection, recovery lane, readiness verdict, and next actions at `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:915` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:1112`.
- Existing tests cover routing/readiness and pipeline recovery branches (`auto-routing`, `run-readiness`, `terminal_probe_pipeline`) at:
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/tests/auto-routing.test.ts:10`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/tests/run-readiness.test.ts:4`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/test_terminal_probe_pipeline.py:320`

### Institutional learnings
Relevant documents:
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/readiness-contract-drift-plugin-skill-collaboration-20260218.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/feedback-scope-and-safe-appurl-remediation-20260217.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`

Key insights applied:
- keep one machine-readable contract across runtime, popup, starter, and reports;
- prefer safe explicit commands (`--project-root <project-root>`) in guidance;
- test process exit semantics and degraded environment behavior, not only happy paths.

Critical patterns file status:
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/patterns/critical-patterns.md` is missing.

## External Research Decision (Step 1.5)
Decision: skip external research.

Reason:
- This is internal contract and reliability alignment with strong local evidence and existing patterns.
- No new external API, security/compliance, or standards dependency is being introduced in this scope.

## Stakeholders
- Operators (human + agent) running Browser Debug sessions and parity loops.
- Maintainers of Browser Debug runtime/session/CDP layers.
- Maintainers of `fix-app-bugs` scripts and report templates.
- Reviewers who consume `runtime.json`, `metrics.json`, `summary.json`, and final reports for closure decisions.

## SpecFlow Analysis (Step 3)
### User Flow Overview
1. Operator starts from feedback-backed issue and launches session/bootstrap flow.
2. Runtime/starter determines readiness and active execution mode.
3. Auto-session ensure resolves/attaches target tab.
4. Scenario commands execute; navigation failures either recover or fail with actionable output.
5. Diagnostics summarize parity/black-screen verdicts.
6. Report and backlog closure package is produced with artifacts and next actions.

### Flow Permutations Matrix
| Flow | Context | Expected behavior |
| --- | --- | --- |
| Stable launch | WS/session healthy, target tab exists | First ensure succeeds, scenario pipeline runs without manual flags |
| Target missing | `TARGET_NOT_FOUND` on ensure | Deterministic recovery path (`resolve-list -> open-tab-if-missing -> retry ensure`) |
| Stale session | existing non-running/conflicting session | Recovery path selects stop/restart and returns explicit next command |
| Navigate failure | command fails on compatibility/runtime transport error | One bounded recovery strategy, else failure with deterministic `nextAction` |
| Diagnostics conflict | framebuffer black but screenshot non-black | One canonical black-screen verdict with rationale and confidence |
| Routing fallback | instrumentation unavailable/fallback | Explicit mode and reason, continue via terminal-probe without browser fetch |

### Missing Elements & Gaps
- Category: command preflight reliability
  - Gap: no explicit WS/session liveness preflight before command dispatch in runtime path.
  - Impact: stale-channel failures can interrupt scenarios early.
- Category: deterministic branch visibility
  - Gap: session attach branch selection is captured, but closure criteria for "normal first-attempt success" are not uniformly enforced in reports.
  - Impact: reliability regressions can hide behind eventual recovery.
- Category: action-guiding errors
  - Gap: top failure categories still rely on operator interpretation in some payload paths.
  - Impact: slower onboarding and higher retry count.
- Category: diagnostics canonicalization
  - Gap: mismatch warnings exist, but canonical verdict schema is not yet first-class across all outputs.
  - Impact: ambiguous black-screen triage decisions.

### Critical Questions Requiring Clarification
1. Critical: should stale-WS reconnect/rebind be default behavior for idempotent commands?
   - Why it matters: directly affects P0 run interruption rate.
   - Default assumption if unanswered: enable by default for idempotent commands only, bounded to one retry.
2. Important: should `open-tab-if-missing` auto-trigger after first `TARGET_NOT_FOUND` in auto-session mode?
   - Why it matters: impacts first-attempt success vs side-effect tolerance.
   - Default assumption if unanswered: auto-trigger only for auto-session flows, keep explicit in manual flows.
3. Important: what threshold promotes `probable` issues into active backlog?
   - Why it matters: controls roadmap noise.
   - Default assumption if unanswered: require two independent sessions for P1/P2 promotion.
4. Nice-to-have: should feedback triage remain on-demand or become scheduled?
   - Why it matters: affects ops overhead and signal freshness.
   - Default assumption if unanswered: keep on-demand until one full stable week of signal quality.

### Recommended Next Steps
1. Lock P0 closure behavior and tests first.
2. Add deterministic `nextAction` mapping for top failure categories next.
3. Canonicalize diagnostics verdict output after stability baseline is achieved.

## Proposed Solution
### Phase A (P0): Runtime Command + Session Reliability
- Implement WS/session preflight + bounded reconnect/rebind before command dispatch.
- Tighten deterministic auto-session attach branch and first-attempt success criteria.
- Preserve explicit failure classification and artifact logging for each lifecycle step.

### Research Insights
**Best practices:**
- Gate reconnect/rebind to idempotent commands (`navigate`, `reload`, `evaluate`) and keep at most one automatic retry.
- Persist lifecycle branch selection in artifacts for every recovery attempt (attempt number, category, selected action, result).
- Keep failure category taxonomy stable to avoid downstream report/parser drift.

**Performance considerations:**
- Treat preflight checks as a strict latency budget item; track median and p95 preflight overhead.
- Prefer lightweight liveness checks over full session re-ensure on every command.

**Security considerations:**
- Ensure reconnect error paths do not leak sensitive endpoint payloads.
- Keep diagnostics sanitized when emitting `responseBodySnippet` and failure details.

**Edge cases:**
- Active session exists but is stale and non-running.
- Tab resolves ambiguously (`AMBIGUOUS_TARGET`) after recovery attempts.
- WS liveness flaps between checks and dispatch.

### Phase B (P1): Recovery and Mode Clarity
- Standardize top failure categories to deterministic `nextAction` command output.
- Enforce report block that states selected mode, reason, and why alternative mode was not chosen.
- Keep recovery precedence consistent with existing lane semantics.

### Research Insights
**Best practices:**
- Keep one primary next action per failure category, with secondary options only in expanded details.
- Preserve existing recovery precedence order to maintain operator muscle memory.
- Use consistent wording across popup, starter output, and report templates.

**Performance considerations:**
- Avoid generating long command suggestions in hot command paths; compute once and reuse.
- Keep mode explanation concise to reduce operator parsing overhead during iterative runs.

**Security considerations:**
- Commands shown in guidance must stay context-safe (`--project-root <project-root>`).
- Never propose auto-apply config actions without explicit flags.

**Edge cases:**
- Bootstrap says `browser-fetch` while execution is constrained to `terminal-probe`.
- Multiple simultaneous failure reasons where precedence is unclear to operators.

### Phase C (P1): Canonical Diagnostics Verdict
- Promote a single black-screen verdict object that combines framebuffer confidence, screenshot metrics, and runtime exceptions.
- Ensure summary/report outputs cannot present contradictory interpretations without final verdict context.

### Research Insights
**Best practices:**
- Define a deterministic precedence rule: screenshot metrics + runtime exceptions over framebuffer-only black indicators.
- Include confidence and reason fields in final verdict objects for auditability.
- Keep raw metrics available for debugging, but separate from final decision fields.

**Performance considerations:**
- Reuse already captured artifacts to avoid duplicate metric work in verdict computation.
- Bound diagnostics aggregation cost in multi-scenario runs.

**Security considerations:**
- Avoid embedding raw page contents in verdict messages; keep summaries abstracted.

**Edge cases:**
- `preserveDrawingBuffer=false` environments with frequent false black framebuffer reads.
- Scenarios with non-black screenshot but transient runtime render exceptions.

### Phase D (P2): Feedback Promotion Rules
- Define recurrence/confidence thresholds for promoting probable findings into backlog.
- Keep default cadence manual/on-demand until signal quality confirms automation readiness.

### Research Insights
**Best practices:**
- Require repeated evidence for promotion and preserve confidence labels on every signal.
- Separate promotion rules by severity so P0 can escalate faster than P1/P2.
- Keep manual review as default until false-positive rate is stable.

**Performance considerations:**
- Keep feedback aggregation lightweight and avoid broad rescans where scoped signals are sufficient.

**Security considerations:**
- Ensure promotion metadata contains references, not sensitive raw payloads.

**Edge cases:**
- High-volume low-confidence signals that can drown meaningful regressions.
- Single-session anomalies repeatedly reclassified as systemic issues.

## Technical Considerations
- Preserve existing mode contracts in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md:117`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md:132`, and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md:38`.
- Keep `terminal-probe` fallback behavior intact and prohibit page-side debug fetch in fallback paths.
- Maintain additive JSON contract changes to avoid breaking existing operators/automation.
- Keep remediation commands context-safe (`--project-root <project-root>` placeholder).

### Research Insights
**Architecture integrity checks:**
- Keep run-readiness contract ownership centralized to avoid split-brain state across runtime and helpers.
- Avoid duplicating failure classification logic across scripts when shared taxonomy can be reused.

**YAGNI controls:**
- Do not add new mode classes or fallback branches in this cycle.
- Avoid speculative automation features until P0/P1 closure metrics are met.

## Acceptance Criteria
### Functional requirements
- [x] P0 stale-channel failures are mitigated by preflight/rebind behavior with bounded retry policy.
- [x] P0 session attach flow reaches first-attempt success in normal conditions and exposes deterministic fallback actions when needed.
- [x] P1 failure payloads for top categories include one explicit `nextAction` command and concise reason.
- [x] P1 reports include `selected mode`, `mode reason`, and `alternate mode rationale`.
- [x] P1 diagnostics include one canonical black-screen verdict with confidence and evidence precedence.
- [x] P2 backlog promotion rules for probable signals are documented and testable.

### Research Insights
**Measurability upgrades:**
- Attach each functional criterion to one observable artifact field.
- Prefer pass/fail thresholds over narrative-only closure claims.

**Anti-regression controls:**
- Require unchanged fallback safety behavior as an explicit acceptance item.
- Require no reduction in current error classification detail when improving guidance text.

### Non-functional requirements
- [x] No regression to fallback safety invariants.
- [x] Existing CLI/script interfaces remain backward-compatible or include explicit migration notes.
- [x] All closure claims are backed by runtime artifacts.
  - Validation artifacts:
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-result.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation.md`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-batch-result.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-batch.md`

### Quality gates
- [x] Updated regression tests cover new preflight/recovery/verdict behavior.
- [x] `npm test` passes.
- [x] `python3 skills/fix-app-bugs/scripts/test_terminal_probe_pipeline.py` passes.
- [x] `python3 skills/fix-app-bugs/scripts/test_visual_debug_start.py` passes.
- [x] Mirror consistency checks pass when skill/docs contracts change:
  - `npm run skill:sync:check`
  - `npm run routing:sync:check`
  - Current run status: both checks pass after syncing local skill source-of-truth.

## Success Metrics
- Zero `readyState 3 (CLOSED)` command failures in a 10-run reliability batch with identical scenarios.
- At least 90% first-attempt `session/ensure` success in normal attach conditions across the same batch.
- 100% of top failure categories emit deterministic `nextAction` guidance.
- Zero final-summary contradictions for black-screen verdicts in validation bundles.

Live validation evidence (2026-02-19):
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-live-summary.json`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-live-summary.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-fresh-agent-run/summary.json`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-fresh-agent-run-2/summary.json`

### Research Insights
**Metric quality checks:**
- Track both per-run and per-scenario failure rates to avoid masking localized regressions.
- Include an explicit "inconclusive" outcome bucket to avoid false success claims when artifacts are incomplete.

## Dependencies & Risks
- Dependency: runtime/session path changes may affect command dispatch behavior.
  - Mitigation: bounded retries, explicit classification, and regression tests.
- Risk: aggressive auto-recovery could hide deeper runtime defects.
  - Mitigation: preserve failure artifacts and avoid unbounded retry loops.
- Risk: diagnostics canonicalization may overfit to current renderer behavior.
  - Mitigation: keep confidence + rationale fields explicit and test against known mismatch cases.

## Implementation Outline
### Phase 1: P0 Runtime Reliability Closure
- [x] Define command preflight contract for WS/session liveness.
- [x] Implement bounded reconnect/rebind policy for idempotent commands.
- [x] Add first-attempt attach reliability assertions and reporting fields.
- [x] Validate with repeated scenario batch and artifact bundle capture.
  - Batch validation artifacts:
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-batch-run/runtime.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-batch-run/metrics.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-batch-run/summary.json`

### Phase 2: P1 Recovery + Mode Guidance
- [x] Map top failure categories to deterministic next-action outputs.
- [x] Enforce explicit mode explanation block in final report template and starter output contract.
- [x] Validate mode/next-action consistency across runtime, starter, and popup surfaces.
- [x] Harden navigate/reload compatibility for historical `client.Page.once is not a function` failure path.
  - Implemented in:
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/cdp-controller.ts`
  - Regression coverage:
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/tests/cdp-controller.test.ts`

### Phase 3: P1 Canonical Diagnostics Verdict
- [x] Define canonical black-screen verdict object and precedence rules.
- [x] Emit verdict consistently in summary/report outputs.
- [x] Validate against known framebuffer/screenshot mismatch scenarios.

### Phase 4: P2 Promotion Rules for Probable Findings
- [x] Define recurrence and confidence thresholds for promotion.
- [x] Add documentation/examples in feedback triage flow.
- [x] Run one trial cycle and confirm signal quality before any scheduling decision.
  - Trial artifacts:
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-agent-feedback-24h-structured-signals-trial.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-agent-feedback-24h-structured-signals-trial.md`

## Validation Strategy
- [x] Reproduce baseline and verify closure against scenarios that include `navigate`, session ensure auto mode, and webgl diagnostics.
  - Baseline validation report:
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-result.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation.md`
  - Live CDP stress validation report:
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-live-summary.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-live-summary.md`
- [x] Require artifact bundle per closure checkpoint:
  - `runtime.json`
  - `metrics.json`
  - `summary.json`
  - Baseline bundle:
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-run/runtime.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-run/metrics.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-run/summary.json`
  - Repeated batch bundle:
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-batch-run/runtime.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-batch-run/metrics.json`
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation-batch-run/summary.json`
- [x] Track and report routing decision fields for this workstream:
  - `triggerMatched=true`
  - `ruleId=R3-EXPLICIT-ROUTE`
  - `modeSelected=core`
  - `fallbackUsed=false`
  - `killSwitchState=enabled`
  - Reported in:
    - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-terminal-probe-validation.md`
- [x] If execution path falls back, explicitly report fallback status and continue with terminal-probe evidence path.
  - Current validation execution did not enter fallback (`fallbackUsed=false`) and this status is explicitly reported.

### Research Insights
**Validation depth:**
- Add one stress window with repeated session ensure + navigate loops to confirm closed-channel mitigation.
- Validate both successful recovery and intentional failure paths (for deterministic next-action quality).
- Include one headed verification checkpoint when diagnosing render/black-screen conclusions.

**Reporting consistency checks:**
- Ensure mode fields agree across starter output, summary payload, and final report text.
- Reject closure if canonical verdict is missing while raw diagnostics disagree.

## Documentation Plan
- [x] Update guidance where behavior contracts change:
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/SKILL.md`
- [x] Keep skill mirror and routing contract mirror synchronized when modified.
  - Current run status: routing mirror is in sync; skill mirror is synchronized with local source-of-truth and `npm run skill:sync:check` passes.
- [x] Capture final closure matrix against feedback issue registry.
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-feedback-closure-matrix.md`

## References & Research
### Internal references
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Ice Cream Pattern/validation/reports/fix-app-bugs_browser-extension_feedback_2026-02-19.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:315`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:706`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/cdp-controller.ts:333`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:701`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:1476`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:258`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:1112`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/extensions/humans-debugger/background.js:55`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/extensions/humans-debugger/popup.js:20`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/tests/auto-routing.test.ts:38`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/tests/run-readiness.test.ts:25`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/test_terminal_probe_pipeline.py:375`

### Institutional learnings
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/readiness-contract-drift-plugin-skill-collaboration-20260218.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/feedback-scope-and-safe-appurl-remediation-20260217.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`
