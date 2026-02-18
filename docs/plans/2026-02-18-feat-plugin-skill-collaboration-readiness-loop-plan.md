---
title: feat: Unify run-readiness and collaboration loop between Browser Debug plugin and fix-app-bugs
type: feat
date: 2026-02-18
brainstorm: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-18-plugin-skill-collaboration-upgrades-brainstorm.md
---

# feat: Unify run-readiness and collaboration loop between Browser Debug plugin and fix-app-bugs

## Overview
Define and deliver a focused collaboration upgrade so the Browser Debug plugin and `fix-app-bugs` workflow present one consistent operational truth during debugging runs.

The plan targets three outcomes from the brainstorm:
1. faster "can I run now?" decisions;
2. fewer retries from session/app-url drift;
3. repeatable shared prioritization from real run feedback.

This is a reliability and workflow-clarity plan, not a rewrite of CDP/runtime internals.

## Problem Statement / Motivation
The repository already has strong primitives (guarded bootstrap, readiness reasons, terminal-probe fallback, sync checks, feedback CLI), but operator friction remains cross-cutting:
- plugin popup and background state expose connectivity/session basics, but not a canonical runnable/fallback/blocked verdict;
- `/health.appUrlDrift` and bootstrap diagnostics are useful yet still interpreted in separate mental models;
- feedback reporting exists but shared plugin+skill roadmap generation is still mostly manual.

Net effect: avoidable retries, slower triage handoffs, and inconsistent backlog decisions.

## Found Brainstorm Context (Step 0)
Found brainstorm from **2026-02-18**: **plugin-skill-collaboration-upgrades**. Using as context for planning.

Carried decisions:
- Recommended sequence: **Approach A -> Approach B (minimal) -> Approach C**.
- Keep `Core mode` as default; `Enhanced` remains optional for strict reproducibility workflows.
- Keep auto-fix explicit-flag only.
- Prioritize reliability and operator clarity over adding new feature surface.

## Auto-Routing Decision (Contract Trace)
Routing trace for this planning run:
- `triggerMatched`: false
- `triggerClass`: non-runtime
- `ruleId`: R5-NO-ROUTE
- `autoInvoked`: false
- `modeSelected`: core
- `fallbackUsed`: false
- `killSwitchState`: enabled

Planning constraints carried forward:
- Preserve current fallback semantics (`terminal-probe` when capability gate fails).
- Do not introduce browser-side `fetch(debugEndpoint)` in fallback paths.
- Treat this plan as workflow/product work, not a runtime bug execution request.

## Repository & Learnings Research (Step 1)
### Repo findings
- Core health and app-url drift contract is already present and stable in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:51` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:176`.
- Plugin UI/state currently centers on connectivity/session fields in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/extensions/humans-debugger/background.js:5` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/extensions/humans-debugger/popup.js:9`.
- Guarded starter already computes final readiness and recommended command context in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:170` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:280`.
- Recovery ergonomics exist as flags but are distributed across scripts and docs (`--auto-recover-session`, `--force-new-session`, `--open-tab-if-missing`) in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:723` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:1586`.
- Feedback aggregation and target scoping are in place in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/feedback.ts:288`, with regression coverage in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/tests/feedback.test.ts:41`.

### Institutional learnings
Relevant solutions:
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/feedback-scope-and-safe-appurl-remediation-20260217.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`

Key insights applied in this plan:
- Machine contracts must be consistent across output payloads and operator-facing guidance.
- Recovery/remediation commands must stay context-safe and explicit.
- Degraded-environment behavior needs dedicated regression tests (not just happy path checks).

Critical patterns file status:
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/patterns/critical-patterns.md` not found.

## External Research Decision (Step 1.5)
Decision: **skip external research**.

Reason:
- This scope is internal workflow alignment with strong local contracts, artifacts, and recent learnings.
- No high-risk external standards (payments/legal/compliance) are in scope for this planning pass.

## Stakeholders
- Operators (humans + agents) running Browser Debug + `fix-app-bugs` flows.
- Maintainers of plugin extension UX/state surfaces.
- Maintainers of core runtime/CLI contract behavior.
- Maintainers responsible for plugin/skill shared backlog prioritization.

## SpecFlow Analysis (Step 3)
### User Flow Overview
1. Operator opens plugin popup and expects immediate status of run readiness.
2. Operator starts/ensures a session and launches guarded starter.
3. System decides between `runnable`, `fallback`, or `blocked` with explicit next action.
4. If non-runnable, operator follows guided recovery lane.
5. Run outcome is captured and eligible for shared feedback classification.
6. Maintainers derive backlog priorities from repeated structured signals.

### Flow Permutations Matrix
| Flow | Context | Expected behavior |
| --- | --- | --- |
| Happy path | Session healthy + app URL aligned | `runnable` with no remediation steps |
| Drift path | App URL mismatch/not-provided | `blocked` or `fallback` with one clear remediation command |
| Session instability | Stale/error session | Guided recovery path with bounded retry behavior |
| Fallback execution | Instrumentation gate fails | Explicit `terminal-probe` path, no browser debug fetch |
| Feedback-only run | No runtime action, only analysis | Structured signal emitted for roadmap prioritization |
| Sparse evidence | Few signals in window | Low-confidence backlog output and defer promotion |

### Missing Elements & Gaps
- **Category:** Status vocabulary
  - **Gap:** no single readiness vocabulary is surfaced consistently across plugin, `/health`, and starter output.
  - **Impact:** conflicting interpretations of whether a run is truly runnable.
- **Category:** Recovery UX
  - **Gap:** recovery options are present but not unified into one operator-facing lane.
  - **Impact:** manual stop/start and retry rituals persist.
- **Category:** Shared prioritization
  - **Gap:** no first-class schema that converts run outcomes into shared backlog signals by default.
  - **Impact:** roadmap updates remain ad-hoc and slower.
- **Category:** Popup contract
  - **Gap:** popup shows state details but not decision-ready next action semantics.
  - **Impact:** additional CLI/doc lookup required before each run.

### Critical Questions Requiring Clarification
1. **Critical:** Should popup default to compact readiness summary only, or summary + raw sub-checks?
   - Default if unanswered: compact summary by default, raw details behind an expandable section.
2. **Important:** Which recovery action should be primary in guided lane?
   - Default if unanswered: recommend bounded soft recovery first, then force-new-session path.
3. **Important:** What threshold promotes a repeated signal into shared backlog?
   - Default if unanswered: require two independent sessions for `P0/P1`; single occurrence allowed for `P2`.
4. **Nice-to-have:** Should shared feedback review run daily by default?
   - Default if unanswered: on-demand for now, with optional daily automation proposed later.

### Recommended Next Steps
1. Freeze readiness vocabulary and next-action contract first.
2. Add guided recovery lane wording + precedence without changing core safety semantics.
3. Introduce structured feedback signal schema and validate with one full audit cycle.

## Proposed Solution
### Approach Sequence
1. **Phase A (P0/P1): Unified Run-Readiness Contract**
  - Introduce one canonical run verdict (`runnable`, `fallback`, `blocked`) and one normalized next-action block.
  - Align wording and field mapping across plugin status, `/health`, starter output, and docs.

2. **Phase B (P1): Guided Session Recovery Lane (Minimal Scope)**
  - Define deterministic recovery precedence and user-facing guidance for session/CDP drift scenarios.
  - Reuse existing flags and capabilities; focus on consistency and bounded behavior.

3. **Phase C (P2): Structured Feedback-to-Backlog Loop**
  - Add a lightweight structured signal schema so recurring plugin/skill/shared issues are easier to prioritize.
  - Keep first iteration manual-first for decision making, then automate only if value is proven.

## Default Decisions for This Cycle
- Keep `Core mode` default; no mandatory strict evidence escalation.
- Keep auto-fix explicit-flag only (`--apply-recommended`).
- Keep recovery behaviors explicit and bounded.
- Keep feedback prioritization conservative (`P0/P1` require repeated signal evidence).

## Technical Considerations
- Preserve existing safety and fallback rules from `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md:38` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md:117`.
- Avoid contract drift across docs and mirrored skill artifacts; update triad docs together when workflow semantics change.
- Prefer additive contract fields and backward-compatible defaults.
- Keep structured signals privacy-safe (no raw sensitive payloads in shared analytics output).

## Acceptance Criteria
- [ ] Canonical readiness verdict vocabulary is documented and mapped across plugin, runtime `/health`, and starter output.
- [ ] Plugin popup/extension state exposes a decision-ready summary and clear next-action hint.
- [ ] Guided recovery precedence is documented and reflected consistently in starter/pipeline usage guidance.
- [ ] Fallback safety invariant is preserved (`terminal-probe` path never introduces browser-side `fetch(debugEndpoint)`).
- [ ] Shared feedback schema supports explicit classification into `plugin`, `skill`, and `shared` with confidence level.
- [ ] One trial feedback cycle can produce an actionable backlog slice using the new schema.
- [ ] Regression coverage exists for new contract surfaces and scoped feedback behavior.
- [ ] Documentation updates remain aligned across `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md`, and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md`.

## Success Metrics
- Reduce average retries before first successful scenario launch by >=30% over first 20 collaboration-focused runs.
- Reduce "ambiguous readiness" incidents (operators needing manual interpretation across multiple surfaces) by >=50% in same sample.
- Ensure 100% of promoted backlog items include structured signal metadata (area, confidence, evidence reference).
- Keep zero regressions on fallback safety and app-url remediation safety checks.

## Dependencies & Risks
- **Dependency:** consistent schema adoption across runtime, extension, starter, docs.
  - **Mitigation:** define one source-of-truth mapping table in plan execution.
- **Risk:** overloading popup with too much diagnostic detail.
  - **Mitigation:** compact summary first, optional expanded details.
- **Risk:** structured feedback introduces noise if thresholds are loose.
  - **Mitigation:** require repeated evidence for higher priorities and keep confidence tags mandatory.
- **Risk:** cross-artifact drift (local skill vs repo mirror).
  - **Mitigation:** keep sync checks in validation gates.

## Implementation Outline
### Phase 1: Readiness Contract Unification (P0)
- [ ] Define canonical verdict and next-action schema.
- [ ] Map existing runtime/starter fields to the canonical schema.
- [ ] Document contract table and backward compatibility behavior.

### Phase 2: Plugin and Workflow Surface Alignment (P1)
- [ ] Update plugin status presentation expectations and wording contract.
- [ ] Align starter/workflow guidance to the same readiness vocabulary.
- [ ] Validate no semantic conflicts across docs and operator commands.

### Phase 3: Guided Recovery Lane (P1)
- [ ] Define recovery precedence (soft recovery, force-new-session, open-tab-if-missing).
- [ ] Publish one deterministic recovery decision path for common failure classes.
- [ ] Add regression checks around recovery classification and expected next actions.

### Phase 4: Structured Feedback Loop (P2)
- [ ] Define minimal structured signal schema for shared prioritization.
- [ ] Run one full-cycle audit and evaluate signal quality.
- [ ] Decide whether to keep manual cadence or automate recurring collection.

## Validation Strategy
- [ ] Capture routing trace fields in rollout notes:
  - `triggerMatched=false`
  - `ruleId=R5-NO-ROUTE`
  - `modeSelected=core`
  - `fallbackUsed=false`
  - `killSwitchState=enabled`
- [ ] Verify fallback invariants with existing tests and contract checks.
- [ ] Verify feedback scope tests still pass with new schema fields.
- [ ] Verify docs and mirrors are synchronized where required.
- [ ] Run one end-to-end dry run of the new collaboration loop and record decision latency + retry count.

## AI-Era Notes
- Collaboration quality depends on explicit machine contracts and low-ambiguity operator messaging, not on adding more ad-hoc diagnostics.
- Prefer small, validated workflow upgrades that improve deterministic behavior incrementally.

## References & Research
### Internal references
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-18-plugin-skill-collaboration-upgrades-brainstorm.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:51`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:176`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/extensions/humans-debugger/background.js:5`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/extensions/humans-debugger/popup.js:9`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/extensions/humans-debugger/popup.html:80`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:170`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/visual_debug_start.py:723`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:1586`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/feedback.ts:288`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/tests/feedback.test.ts:41`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-17-agent-feedback-24h-plugin-fix-app-bugs.md`

### Institutional learnings
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/feedback-scope-and-safe-appurl-remediation-20260217.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`
