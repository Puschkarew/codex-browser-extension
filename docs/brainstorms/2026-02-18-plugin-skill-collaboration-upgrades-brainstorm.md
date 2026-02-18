---
date: 2026-02-18
topic: plugin-skill-collaboration-upgrades
routing:
  triggerMatched: false
  triggerClass: non-runtime
  ruleId: R5-NO-ROUTE
  autoInvoked: false
  modeSelected: core
  fallbackUsed: false
  killSwitchState: enabled
  outcomeStatus: success
---

# Browser Plugin + Skill Collaboration Upgrades

## What We're Building
We are defining the next improvement wave for how the Browser Debug plugin and `fix-app-bugs` skill work together during real debugging runs. The target is a noticeably smoother operator loop with fewer manual corrections and fewer ambiguous states.

The current system already has strong building blocks: mode split (`Core` vs `Enhanced`), guarded bootstrap, terminal-probe fallback, sync checks, and a feedback CLI. The remaining friction is mostly cross-cutting: readiness signals are split across places, remediation is still partially manual, and retrospective insights are not yet turned into a fast default decision loop.

Success for this brainstorm means three concrete outcomes: (1) faster “can I run now?” decisions, (2) fewer retries caused by session/app-url drift, and (3) clearer prioritization of shared plugin+skill backlog items from real run evidence.

## Why This Approach
### Approach A: Unified Run-Readiness Contract (Recommended)
Create one canonical readiness verdict shared by plugin UI/health, bootstrap output, and workflow prompts (`runnable`, `fallback`, `blocked`) with one “next action” block.

Pros:
- Removes split-brain state between plugin health and skill bootstrap.
- Directly addresses repeated mismatch/session friction already seen in repo reports.

Cons:
- Requires disciplined contract updates across docs and mirrors.

Best when: reliability and operator speed are top priority.

### Approach B: Guided Session Recovery Lane
Define an explicit “recover and continue” lane for stale sessions/targets with predictable bounded recovery behavior and standardized user-facing wording.

Pros:
- Reduces manual stop/start rituals.
- Increases repeatability for parity loops.

Cons:
- Adds lifecycle behavior choices that need careful defaults.

Best when: session instability is the dominant pain.

### Approach C: Structured Feedback-to-Backlog Loop
Promote run outcomes into structured issue signals so `agent:feedback` can generate actionable backlog slices automatically (plugin vs skill vs shared).

Pros:
- Makes prioritization continuous instead of ad-hoc audits.
- Strengthens roadmap decisions with comparable signals.

Cons:
- Value appears after adoption period, not immediately.

Best when: planning accuracy is the main goal.

Recommendation: start with A, include the smallest high-value subset of B, then roll C.

## Key Decisions
- Prioritize collaboration reliability over net-new feature surface.
  Rationale: this gives immediate reduction in failed or delayed runs.
- Use one shared readiness vocabulary across plugin, bootstrap, and workflow prompts.
  Rationale: eliminates contradictory “healthy but not runnable” interpretations.
- Keep `Core mode` default and `Enhanced` optional for strict evidence only.
  Rationale: preserve speed for local iteration and avoid unnecessary workflow cost.
- Keep auto-fix actions explicit-flag only.
  Rationale: maintain safety in multi-project environments.
- Sequence work as A -> B (minimal) -> C.
  Rationale: YAGNI-first rollout with measurable impact at each stage.

## Open Questions
- Should plugin popup show only the final readiness verdict, or also the raw sub-checks by default?
- Which recovery action should be default first in guided lane: soft retry, force-new-session, or open-tab-if-missing?
- What is the minimum confidence threshold to auto-promote a feedback signal into backlog?
- Should shared backlog generation be daily by default or only on demand?

## Next Steps
→ Run `/prompts:workflows-plan` to convert this into scoped phases, acceptance criteria, and rollout checkpoints.
