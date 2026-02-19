---
date: 2026-02-19
topic: plugin-skill-feedback-improvements
routing:
  triggerMatched: false
  triggerClass: non-runtime
  ruleId: R5-NO-ROUTE
  autoInvoked: false
  modeSelected: core
  fallbackUsed: false
  killSwitchState: enabled
  outcomeStatus: success
source_feedback: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Ice Cream Pattern/validation/reports/fix-app-bugs_browser-extension_feedback_2026-02-19.md
---

# Plugin + fix-app-bugs Improvements from 2026-02-19 Feedback

## What We're Building
We are defining the next improvement wave for the Browser Debug plugin runtime and the `fix-app-bugs` workflow using evidence from the 2026-02-19 feedback report. The target is a more deterministic run loop: fewer early command failures, fewer manual recovery steps, and clearer operator decisions when runs degrade.

This is not a feature expansion. It is a reliability and workflow-clarity pass focused on existing pain points already confirmed in artifacts: stale/closed WebSocket failures, fragile session attach, ambiguous black-screen signals, mode interpretation confusion, and weak actionability in error outputs.

Out of scope for this cycle: new UI surfaces beyond status clarity, changes to Core/Enhanced mode semantics, and speculative automation not tied to confirmed failure categories.

Success means operators can recover from common failure states with one clear next step, first-attempt session setup succeeds more often, and parity diagnostics provide one canonical verdict instead of conflicting indicators.

## Why This Approach
### Approach A: Runtime Reliability First (Recommended)
Prioritize plugin/runtime reliability on the confirmed failure path: stale connection handling, predictable session targeting behavior, and safe handling of navigation-path compatibility faults.

Pros:
- Directly addresses the two P0 issues with the highest run interruption cost.
- Produces immediate reduction in failed run starts and retry churn.

Cons:
- Touches critical command/session paths and needs careful regression coverage.

Best when: stability and first-attempt success are the top goals.

### Approach B: Recovery and Mode Clarity Lane
Standardize skill outputs around one explicit mode statement and one deterministic next-action command per top failure category.

Pros:
- Reduces cognitive load and manual interpretation.
- Speeds recovery even when runtime issues still occur.

Cons:
- Improves guidance but does not remove root runtime failures by itself.

Best when: operator workflow friction is the primary bottleneck.

### Approach C: Canonical Diagnostics Verdict
Unify black-screen verdict logic across framebuffer, screenshot metrics, and runtime errors with explicit confidence and precedence.

Pros:
- Eliminates contradictory diagnostics in parity investigations.
- Improves trust in final summaries and handoff quality.

Cons:
- Mostly improves diagnosis quality, not execution reliability.

Best when: triage ambiguity is causing delays after runs complete.

Recommendation: execute A first, add the smallest high-value subset of B in the same cycle, then complete C once runtime stability improves.

## Key Decisions
- Prioritize backlog order from feedback as `P0 -> P1 -> P2`, with initial closure focused on stale-WS command failures and session-attach fragility.
  Rationale: protect run continuity before optimizing diagnostics/UX.
- Keep `Core mode` as default and preserve fallback semantics.
  Rationale: no behavior regression in mode safety contracts.
- Add deterministic `nextAction` mapping for common failure classes.
  Rationale: reduce manual guesswork and shorten recovery loops.
- Require one explicit mode block in reports: selected mode, reason, and why alternate mode was not selected.
  Rationale: prevent mode confusion between bootstrap and execution.
- Use evidence-backed acceptance gates (consecutive-run reliability checks and canonical summary consistency checks).
  Rationale: close issues based on artifacts, not subjective confidence.

## Open Questions
- Should automatic reconnect/rebind be fully default for idempotent commands, or guarded behind a flag for first rollout?
- Should `open-tab-if-missing` remain explicit opt-in, or auto-trigger only after `TARGET_NOT_FOUND`?
- What minimum recurrence threshold should promote `probable` findings into active backlog items?
- Should shared feedback triage remain on-demand, or move to a recurring cadence after one more stable week?

## Next Steps
-> `/prompts:workflows-plan` with this brainstorm to define phased implementation scope, acceptance tests, and rollout checkpoints.
