---
date: 2026-02-12
topic: visual-parity-workflow-improvements
---

# Visual Parity Workflow Improvements

## What We're Building
We are defining a clearer, faster workflow for visual-parity bug investigations that use the Browser Extension plus `fix-app-bugs`. The target outcome is lower coordination overhead for agents and humans: fewer manual screenshot handoffs, faster mode selection (`Core mode` vs `Enhanced mode`), and more predictable evidence bundles for handoff/review.

The scope is workflow and product experience, not rendering logic changes. Specifically, we want a repeatable “first 10 minutes” path for visual issues, a standard evidence package for parity runs, and a lightweight reporting loop for iterative tuning before final closure. The workflow should still preserve strict evidence guarantees when required, especially headed validation and final five-block reporting in Enhanced runs.

Success means a new agent can begin from zero context, choose mode confidently, run one guided visual cycle, and produce artifacts another agent can consume without additional explanation.

## Why This Approach
We considered three approaches:

1. Documentation-only refresh: fastest to ship, but it leaves manual command stitching and evidence packaging pain mostly unresolved.
2. Thin workflow layer on top of existing commands (recommended): add a mode decision helper, a parity-bundle entrypoint, an interim visual report template, and one evidence folder contract. This keeps current architecture intact while removing the highest-friction steps.
3. Full orchestration flow: one “do everything” command with deep automation. Powerful, but high complexity and higher failure/debug surface too early.

We recommend approach 2 (thin workflow layer). It applies YAGNI: solve today’s repeated friction without introducing a heavy orchestrator. Existing primitives (`agent:cmd`, `compare-reference`, terminal-probe pipeline, bootstrap diagnostics) already cover most technical needs; the gap is packaging, defaults, and consistency.

## Key Decisions
- Standardize one visual parity bundle output shape across Core and Enhanced flows so handoffs are deterministic.
- Add an explicit, short mode decision guide at workflow entry points to reduce startup ambiguity.
- Introduce a lightweight interim report format for iterative cycles; keep strict five-block report for final Enhanced closure.
- Define a “stop rule” for non-converging parity tuning to prevent endless loops and force explicit re-plan/rollback.
- Keep improvements incremental and backwards-compatible with current commands and docs.

## Open Questions
- What exact acceptance threshold should trigger the parity “stop rule” (fixed iteration count, timebox, or metric delta)?
- Should parity bundles always include both headed and headless captures, or headed-only by default with optional headless?
- Where should the canonical evidence folder live long-term: current `logs/browser-debug/...` paths or a higher-level `output/parity/...` convention with links back to raw logs?
- Should interim reports be mandatory per iteration or only when handing off between agents?
- Which KPI should be primary for workflow success: time-to-first-decision, time-to-first-valid-bundle, or handoff acceptance rate?

## Next Steps
→ `/prompts:workflows-plan` to convert this into concrete implementation steps and sequencing.
