---
status: complete
priority: p1
issue_id: "003"
tags: [workflow, skills, routing, browser-debug, fix-app-bugs]
dependencies: []
---

# Integrate Browser Debug Auto Routing Into Workflow and Phase-2 Skills

## Problem Statement

Every workflow and related skills currently rely on manual mention of Browser Debug and `fix-app-bugs`. That causes inconsistent behavior across commands and missed reproducibility flows.

## Findings

- `workflows-brainstorm`, `workflows-plan`, `workflows-work`, and `workflows-review` do not share a common auto-routing contract.
- Phase-2 skills (`bug-reproduction-validator`, `test-browser`, `playwright`, `security-sentinel`, `performance-oracle`) do not declare a shared trigger profile or routing precedence.
- Existing fix-app-bugs mode/fallback rules are documented but not reused as a contract by other skills.

## Proposed Solutions

### Option 1: Shared Contract + Cross-Skill References

**Approach:** Add one shared auto-routing contract document (local source-of-truth), mirror it in repo docs, and reference it from all target skills.

**Pros:**
- Deterministic behavior across skills.
- Low implementation complexity.
- Keeps existing mode semantics unchanged.

**Cons:**
- Requires mirror discipline between local and repo docs.

**Effort:** Medium

**Risk:** Low

---

### Option 2: Per-Skill Embedded Rules (No Shared Contract)

**Approach:** Duplicate routing rules in each skill file.

**Pros:**
- No shared artifact management.

**Cons:**
- High drift risk and inconsistent behavior.
- Harder to maintain.

**Effort:** Medium

**Risk:** High

## Recommended Action

Use **Option 1**. Implement Phase 0/1 first (contract + workflows), then integrate Phase-2 skills with conditional trigger profiles for reviewer-type skills.

## Technical Details

**Target files (local):**
- `$CODEX_HOME/skills/workflows-*/SKILL.md`
- `$CODEX_HOME/skills/{bug-reproduction-validator,test-browser,playwright,security-sentinel,performance-oracle}/SKILL.md`
- `$CODEX_HOME/skills/workflows-shared/references/auto-routing-contract.md`

**Target files (repo mirror):**
- `docs/contracts/auto-routing-contract.md`
- `docs/contracts/auto-routing-capability-map.md`

## Resources

- `docs/plans/2026-02-12-feat-every-workflows-browser-debug-auto-integration-plan.md`
- `skills/fix-app-bugs/SKILL.md`
- `AGENTS.md`

## Acceptance Criteria

- [x] Shared contract exists and is referenced by all target workflow skills.
- [x] Phase-2 skills include shared contract references and conditional trigger rules.
- [x] Global kill-switch behavior is documented.
- [x] Fallback semantics (`terminal-probe`) remain aligned with `fix-app-bugs`.
- [x] Plan checkbox progress is updated as tasks complete.

## Work Log

### 2026-02-12 - Initialization

**By:** Codex

**Actions:**
- Created execution todo for plan-driven rollout.
- Confirmed scope includes workflow + phase-2 skill integration with shared routing contract.

**Learnings:**
- Local skill updates should be source-of-truth for runtime behavior.
- Repo mirror is useful for reviewability and drift checks.

### 2026-02-12 - Implementation

**By:** Codex

**Actions:**
- Added shared auto-routing contract and capability map at local source-of-truth (`$CODEX_HOME/skills/workflows-shared/references`) and repo mirrors (`docs/contracts/*`).
- Integrated contract references and deterministic routing precedence into workflow skills: `workflows-brainstorm`, `workflows-plan`, `workflows-work`, and `workflows-review`.
- Integrated same contract into phase-2 skills: `bug-reproduction-validator`, `test-browser`, `playwright`, `security-sentinel`, and `performance-oracle`.
- Added formal routing decision module and regression tests (`src/shared/auto-routing.ts`, `tests/auto-routing.test.ts`).
- Added contract sync tooling and tests (`scripts/sync-auto-routing-contract.sh`, `scripts/check-auto-routing-contract-sync.sh`, `tests/routing-contract-sync.test.ts`) plus package scripts.
- Updated `fix-app-bugs` local skill + agent prompt metadata, synced to repo mirror, and verified sync checks.
- Updated `AGENTS.md`, `README.md`, and `README-debug.md` with auto-routing contract workflow and guardrails.
- Executed routing dry-run matrix and published rollout decision record:
  - `docs/contracts/2026-02-12-auto-routing-rollout-decision.md`
- Ran validation commands:
  - `npm run routing:sync:check`
  - `npm run skill:sync:check`
  - `npm test`

**Learnings:**
- A single routing contract plus per-skill trigger profiles provides predictable behavior without forcing debug paths into non-runtime contexts.
- Mirror check scripts prevent local/repo drift for both `fix-app-bugs` and routing-contract artifacts.
