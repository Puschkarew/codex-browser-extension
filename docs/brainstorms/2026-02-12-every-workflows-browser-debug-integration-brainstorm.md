---
date: 2026-02-12
topic: every-workflows-browser-debug-integration
---

# Every Workflows + Browser Debug Integration

## What We're Building
We are defining an Auto integration model so Every workflows and selected skills can detect when Browser Debug plugin + `fix-app-bugs` are relevant and invoke them without explicit user prompting. The goal is that other commands become capability-aware: they know when reproducible runtime evidence is needed, which mode to choose (`Core` vs `Enhanced`), and which artifact contract must be produced.

Scope is staged. Phase 1 targets `workflows-*` as the primary lane (`workflows-brainstorm`, `workflows-plan`, `workflows-work`, `workflows-review`). Phase 2 extends to a broad wave of high-impact skills so coverage is ecosystem-wide, not isolated to planning flows. The initial Phase 2 wave includes fix-oriented skills (`bug-reproduction-validator`, `test-browser`, `playwright`) and review-oriented skills (`security-sentinel`, `performance-oracle`).

This is a workflow/capability design effort, not a rendering or debugging engine rewrite.

## Why This Approach
We considered: (1) workflows-only integration, (2) global integration-first, and (3) a hybrid rollout. We selected the hybrid because it provides near-term value and long-term consistency with lower rollout risk.

`workflows-*` gives immediate leverage because it is the main entry path where intent is clarified and execution decisions are made. Adding global capability behavior too early would increase complexity and blast radius before trigger quality is validated.

Hybrid sequencing follows YAGNI: first ship high-value routing in existing workflows, then generalize once rules and success metrics are stable.

## Key Decisions
- Default invocation mode is `Auto` (not suggest-only, not explicit-only).
- Integration priority is dual-layer: `workflows-*` first, then shared skill-level behavior.
- Chosen rollout model is `Hybrid`: quick workflow adoption + phased generalization.
- Phase 2 scope is `broad`: include both fix-oriented and review-oriented skill groups in the initial wave.
- Success criteria are combined: `adoption`, `quality`, and `coverage` (`adoption` = relevant auto-invocations happen, `quality` = fewer failed/repeat cycles via reproducible evidence, `coverage` = integration extends beyond `workflows-*`).
- Existing `Core mode` / `Enhanced mode (fix-app-bugs optional addon)` gate remains authoritative for runtime decisions.

## Open Questions
- Where should the canonical capability registry live for Every: global `$CODEX_HOME` contract, repo-local mirror, or both?
- What trigger taxonomy should be standardized first (runtime bug, visual parity issue, flaky repro, regression review)?
- How should skills resolve conflicts when multiple integrations could claim ownership of the same step?
- What minimum telemetry is required to validate adoption/quality/coverage without adding noisy overhead?
- What opt-out mechanism should exist for users who need manual control in specific sessions?

## Next Steps
→ Run `/prompts:workflows-plan` to convert this brainstorm into a concrete rollout plan (contracts, trigger matrix, phased implementation, and validation criteria).
