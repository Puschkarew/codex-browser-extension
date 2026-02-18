---
date: 2026-02-17
topic: fix-app-bugs-plugin-feedback-parity-rewrite
source_feedback: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Select Icons/docs/feedback/2026-02-17-fix-app-bugs-plugin-feedback-parity-rewrite.md
routing:
  triggerMatched: false
  triggerClass: non-runtime
  ruleId: R5-default-no-route
  autoInvoked: false
  modeSelected: core
  fallbackUsed: false
  killSwitchState: enabled
---

# Browser Plugin Improvement Options from Parity-Rewrite Feedback

## What We're Building
We are defining a focused improvement direction for the Browser Debug plugin and `fix-app-bugs` workflow based on the parity-rewrite feedback dated 2026-02-17. The goal is to remove the ambiguity between "capability passed" and "scenario execution is actually runnable", especially when CDP/session lifecycle becomes unstable.

Scope is workflow reliability and operator experience for evidence-driven runs. This includes readiness signaling, session recovery behavior, and headed evidence ergonomics. It does not include app-specific bug logic or large architecture changes. Success means fewer manual recovery steps, clearer go/no-go status before scenario execution, and faster closure for visual parity tasks.

## Why This Approach
We considered three options:

### Approach A: Readiness Contract Tightening (Recommended)
Introduce a single run-readiness verdict (`readyForScenarioRun`) that combines transport/config checks with runtime/CDP/session checks, so capability success cannot mask execution risk.

Pros:
- Eliminates ambiguous "green but not runnable" states.
- Lowest scope and fastest path to better operator decisions.

Cons:
- Improves decision quality more than automatic recovery speed.
- Requires contract updates across bootstrap outputs.

Best when: the team needs deterministic pre-run truth before investing in deeper automation.

### Approach B: Session Self-Healing First
Make session recovery first-class in guarded flows (`auto-recover-session` and "force new session" behavior) to reduce manual stop/ensure loops.

Pros:
- Directly reduces failed reruns due to stale/error session state.
- Improves throughput for repeated parity cycles.

Cons:
- More lifecycle complexity and precedence decisions.
- Requires stronger safeguards to avoid surprising side effects.

Best when: current friction is dominated by session/CDP lifecycle instability.

### Approach C: Headed Evidence One-Command Mode
Add a first-class headed evidence run path so parity closure does not require manual glue scripts.

Pros:
- Removes manual orchestration for visual parity proof.
- Standardizes artifact output for handoff quality.

Cons:
- Higher UX/workflow scope than pure reliability contract changes.
- Can hide unresolved lifecycle issues unless paired with readiness checks.

Best when: visual parity validation is frequent and manual headed runs are the main bottleneck.

Recommendation: start with A (contract clarity), then the smallest high-value subset of B (session recovery). Add C once readiness and lifecycle behavior are stable.

## Key Decisions
- Prioritize explicit scenario-readiness verdicts before broader automation.
  Rationale: this addresses the core ambiguity reported in feedback with minimal scope.
- Treat session/CDP lifecycle failures as recoverable workflow states, not opaque terminal errors.
  Rationale: repeated manual stop/ensure loops are the highest friction point.
- Keep recovery behaviors explicit and opt-in in the first iteration.
  Rationale: avoids surprising behavior while contracts are still maturing.
- Keep headed evidence as first-class for parity tasks, but sequence it after readiness/lifecycle fixes.
  Rationale: manual glue should be removed, but not before run-state correctness is trusted.

## Open Questions
- Should `readyForScenarioRun=false` block scenario launch by default, or only warn?
- Which recovery level should be default first: soft retry, force-new session, or both?
- Should headed evidence mode always generate `runtime.json`, `metrics.json`, and `summary.json` even on partial failure?
- What confidence threshold should allow promoting lifecycle improvements from opt-in to default-on?

## Next Steps
1. Confirm preferred priority between contract clarity (A) and recovery speed (B) if only one ships first.
2. Move to `/prompts:workflows-plan` to convert the chosen sequence into scoped phases and acceptance criteria.
