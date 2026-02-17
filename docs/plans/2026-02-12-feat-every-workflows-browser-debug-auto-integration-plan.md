---
title: feat: Integrate Browser Debug + fix-app-bugs into Every workflows with auto invocation
type: feat
date: 2026-02-12
brainstorm: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-12-every-workflows-browser-debug-integration-brainstorm.md
---

# feat: Integrate Browser Debug + fix-app-bugs into Every workflows with auto invocation

## Enhancement Summary
**Deepened on:** 2026-02-12  
**Sections enhanced:** 8  
**Research agents/skills used:** `architecture-strategist`, `pattern-recognition-specialist`, `performance-oracle`, `security-sentinel`, `agent-native-architecture`, `agent-native-reviewer`, `create-agent-skills`, `learnings-researcher`, `spec-flow-analyzer`

### Key Improvements
1. Added an explicit shared capability contract model (`trigger taxonomy`, `capability map`, `routing precedence`, `fallback semantics`).
2. Added deterministic rollout gates tied to measurable KPI thresholds (`adoption`, `quality`, `coverage`) before broad expansion.
3. Added implementation-level guardrails from agent-native patterns (action/context parity, primitive-over-workflow design, explicit completion signaling).

### New Considerations Discovered
- Auto-invocation quality depends on trigger precision and conflict resolution at least as much as on tooling availability.
- Capability routing must stay source-of-truth aligned between local `$CODEX_HOME` skills and repo mirrors to avoid behavior drift.
- Reviewer/fix-oriented Phase 2 skills need conditional invocation rules to avoid over-triggering runtime workflows.

## Overview
Introduce an `Auto` capability-routing layer so Every commands and skills can detect when Browser Debug plugin plus `fix-app-bugs` should be invoked, without requiring explicit user naming each time. Rollout starts with `workflows-*` for immediate leverage, then expands to a broad second wave of fix-oriented and review-oriented skills.

The plan keeps existing mode semantics unchanged: `Core mode` remains default, `Enhanced mode (fix-app-bugs optional addon)` remains opt-in for strict reproducibility, and `terminal-probe` fallback remains mandatory when instrumentation capability fails.

## Problem Statement / Motivation
Current workflow relies on explicit user prompts to invoke Browser Debug and `fix-app-bugs`, which creates inconsistency:
- Some relevant sessions do not trigger reproducibility tooling early enough.
- Skills outside the debugging lane have no shared capability-awareness contract.
- Invocation behavior can diverge between local `$CODEX_HOME` skills and repo mirror documentation.

You requested:
- Auto invocation behavior as default.
- Two-layer integration: `workflows-*` first, then generalized skill-level adoption.
- Broad Phase 2 coverage including both fix-oriented and review-oriented skills.
- Success measured by adoption, quality, and coverage.

## Found Brainstorm Context (Step 0)
Found brainstorm from **2026-02-12**: **every-workflows-browser-debug-integration**. Using as context for planning.

What carries forward:
- Rollout model: `Hybrid` (workflows-first, then broad skills).
- Invocation mode: `Auto`.
- KPI set: `adoption + quality + coverage`.
- Preserve existing `Core`/`Enhanced` and capability-gate contracts from current Browser Debug + `fix-app-bugs` docs/skills.

## Repository & Learnings Research (Step 1)
### Repo findings
- Mode and instrumentation gate behavior are already explicit in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md:17`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md:55`, and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md:116`.
- Skill source-of-truth and sync discipline are already implemented via `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/scripts/sync-fix-app-bugs-skill.sh:7` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/scripts/check-fix-app-bugs-sync.sh:7`.
- Repo scripts already expose skill sync operations in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/package.json:16`.
- `fix-app-bugs` already defines strict auto-routable guardrails (mode gating, fallback, parity stop rule) in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/SKILL.md:21` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/SKILL.md:84`.
- Agent-facing prompt contract exists for this skill in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/agents/openai.yaml:4`.
- `workflows-*` skills currently do not reference `fix-app-bugs` or Browser Debug capability routing in `/Users/vladimirpuskarev/.codex/skills/workflows-plan/SKILL.md:71`, `/Users/vladimirpuskarev/.codex/skills/workflows-work/SKILL.md:134`, and `/Users/vladimirpuskarev/.codex/skills/workflows-review/SKILL.md:64`.
- Project-level CLAUDE guidance file was not found during scan (no `CLAUDE.md` in this repository).

### Institutional learnings
Relevant documented learning found:
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`

Key carried insights:
- Required vs optional readiness checks must be explicit and machine-verifiable.
- Exit-code contract must align with JSON diagnostics for automation reliability.
- Degraded environments (missing binaries, partial toolchain) need explicit regression coverage.

Critical patterns file status:
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/patterns/critical-patterns.md` not present.

### Key insight summary
- Core technical capability exists; missing piece is shared invocation policy across skills.
- The highest-risk failure mode is inconsistent routing (false positive/false negative invocation), not missing tooling primitives.
- Sync drift between local `$CODEX_HOME` skills and repo mirror is a known operational risk and must be gated in rollout.

## External Research Decision (Step 1.5)
Decision: **skip external research**.

Reasoning:
- Scope is internal workflow orchestration, not external API compliance.
- Strong local context already exists (skills, runbooks, previous brainstorm/plan, and institutional learning).
- User intent is execution-focused on the existing Every + Browser Debug ecosystem.

## Stakeholders
- Every users running `/prompts:workflows-*` commands.
- Skill authors/maintainers for workflow, debugging, and reviewer skills.
- Reviewers/operators who consume reproducibility artifacts and mode decisions.
- Maintainers of Browser Debug plugin docs and `fix-app-bugs` local-to-repo mirror workflow.

## SpecFlow Analysis (Step 3)
### User Flow Overview
1. User invokes a workflow command (`workflows-brainstorm`, `workflows-plan`, `workflows-work`, `workflows-review`).
2. Command classifies task context using a shared trigger taxonomy (runtime bug, visual parity, reproducibility-needed, review requiring runtime evidence).
3. If trigger matches, command auto-invokes Browser Debug + `fix-app-bugs` capability contract.
4. Command declares mode path (`Core`, `Enhanced`, or `terminal-probe fallback`) using existing machine-readable gate semantics.
5. Command continues original workflow task with required evidence constraints and handoff format.
6. For non-matching contexts, workflow continues without debug capability injection.
7. Phase 2 skills follow the same contract and conflict-resolution policy.

### Flow Permutations Matrix
| Flow | Context | Expected behavior |
| --- | --- | --- |
| `workflows-*` happy path | Runtime/render bug with reproducibility need | Auto route to Browser Debug + `fix-app-bugs` contract before deeper execution |
| `workflows-*` non-debug | Planning/refactor/docs with no runtime evidence need | No auto routing; workflow remains unchanged |
| Enhanced unavailable | Trigger matched but bootstrap fails or fallback verdict | Auto switch to `terminal-probe`; avoid browser-side instrumentation calls |
| Ambiguous context | Weak trigger confidence | Apply deterministic tie-break rules (conservative default + explain decision) |
| Phase 2 skill route | `bug-reproduction-validator` / `test-browser` / `playwright` | Auto adopt same capability contract and evidence expectations |
| Review skill route | `security-sentinel` / `performance-oracle` | Only invoke runtime evidence path when review context requires behavioral verification |

### Missing Elements & Gaps
- **Category:** Trigger taxonomy
  - **Gap:** No shared trigger matrix currently exists across skills.
  - **Impact:** Inconsistent auto invocation and duplicated heuristics.
- **Category:** Capability registry
  - **Gap:** No canonical shared contract file for invocation rules and fallback behavior.
  - **Impact:** Skills can diverge in mode gating and evidence requirements.
- **Category:** Conflict resolution
  - **Gap:** No explicit policy when multiple skills compete to own routing.
  - **Impact:** Potential double-invocation or contradictory instructions.
- **Category:** Observability
  - **Gap:** No standardized telemetry fields for adoption/quality/coverage KPIs.
  - **Impact:** Success cannot be measured reliably.
- **Category:** Rollout governance
  - **Gap:** No staged acceptance gates for Phase 1 vs Phase 2.
  - **Impact:** Broad rollout can happen before routing quality is proven.

### Critical Questions Requiring Clarification
1. **Critical:** Where is the canonical capability registry hosted first (`$CODEX_HOME` only, repo mirror only, or dual)?
   - Why it matters: determines source-of-truth and sync strategy.
   - Default assumption if unanswered: `$CODEX_HOME` is source-of-truth, repo contains mirrored documentation/contracts.
2. **Critical:** What confidence threshold triggers auto invocation vs no-op?
   - Why it matters: controls false positives and false negatives.
   - Default assumption if unanswered: deterministic rule matrix with explicit required-signal sets per workflow command.
3. **Important:** What is the global opt-out switch for manual sessions?
   - Why it matters: advanced users need deterministic bypass.
   - Default assumption if unanswered: per-session opt-out flag in workflow command context.
4. **Important:** Which telemetry fields are mandatory for KPI tracking?
   - Why it matters: KPI reporting must be comparable across skills.
   - Default assumption if unanswered: `triggerMatched`, `autoInvoked`, `modeSelected`, `fallbackUsed`, `artifactBundlePresent`, `handoffComplete`.

## Proposed Solution
Implement a two-layer integration architecture:
1. **Phase 1 (`workflows-*`)**: add shared trigger taxonomy and auto-routing hooks into `workflows-brainstorm`, `workflows-plan`, `workflows-work`, and `workflows-review`.
2. **Shared capability contract**: define one reusable invocation contract for Browser Debug + `fix-app-bugs` (mode declaration, fallback behavior, evidence minima, and stop rules).
3. **Phase 2 (broad skills)**: extend contract usage to fix-oriented (`bug-reproduction-validator`, `test-browser`, `playwright`) and review-oriented (`security-sentinel`, `performance-oracle`) skills.
4. **KPI instrumentation and rollout gates**: add lightweight observability and quality gates before expanding from Phase 1 to Phase 2.

### Research Insights
**Architecture and parity patterns:**
- Maintain a capability map (`user action -> agent capability`) for routing-relevant outcomes and keep it updated alongside skill edits.
- Prefer primitive contracts over workflow-encoded contracts so the same routing layer can compose across heterogeneous skills.
- Require context parity: routing decisions should consume the same runtime context users/operators see (`task type`, `evidence requirement`, `mode constraints`).

**Execution robustness patterns:**
- Add explicit completion signaling semantics for routing attempts (`success`, `partial`, `blocked`) so workflows stop deterministically.
- Separate tool success/failure from loop continuation decisions to avoid infinite retries in fallback scenarios.

**Skill design patterns:**
- Keep trigger language in skill descriptions concrete and discoverable so model-invocation behavior remains predictable.
- Avoid side-effectful auto-triggers without explicit contract boundaries and opt-out escape hatches.

## Technical Considerations
- Preserve existing behavior contracts in `fix-app-bugs` (mode decision, fallback, no `fetch(debugEndpoint)` in terminal-probe).
- Keep `Core mode` as default; do not make `fix-app-bugs` mandatory for all commands.
- Maintain local-first skill source-of-truth workflow and enforce mirror sync checks.
- Keep integration minimally invasive: add routing layer, not broad rewrites of skill workflows.
- Avoid introducing external dependencies for this phase; rely on existing scripts/docs and command contracts.
- Define deterministic routing precedence to prevent double-invocation (`workflow-local rule` > `shared contract default` > `no-route`).
- Add per-session manual override (`opt-out`) with clear observability so analysts can distinguish disabled vs non-matching routes.
- Treat trigger matching as bounded-cost logic (constant-time rule checks on known signals) to avoid latency creep in command startup.
- Keep security hygiene in routing metadata/logs: avoid leaking secrets, tokens, or sensitive request payloads in capability-telemetry fields.
- Avoid machine-specific paths in workflow tasks; use `$CODEX_HOME`-relative paths and explicit path-resolution checks.
- Add a global kill-switch (`EVERY_AUTO_ROUTING_ENABLED`) for emergency rollback of auto-invocation behavior.

## Acceptance Criteria
- [x] Canonical capability registry location is explicitly decided and documented before Phase 1 implementation begins.
- [x] A shared capability-routing contract exists and is referenced by all four `workflows-*` skills.
- [x] `workflows-brainstorm`, `workflows-plan`, `workflows-work`, and `workflows-review` include deterministic auto-invocation triggers for Browser Debug + `fix-app-bugs`.
- [x] Auto-routing preserves existing `Core`/`Enhanced` semantics and terminal-probe fallback rules.
- [x] Phase 2 broad wave skills (`bug-reproduction-validator`, `test-browser`, `playwright`, `security-sentinel`, `performance-oracle`) reference the same contract instead of duplicating divergent rules.
- [x] A per-session opt-out mechanism is documented and usable.
- [x] A global kill-switch is implemented, documented, and validated in dry-run scenarios.
- [ ] KPI fields for `adoption`, `quality`, and `coverage` are defined and captured in rollout validation notes.
- [x] Local and repo skill artifacts remain synchronized (`npm run skill:sync:from-local` and `npm run skill:sync:check` pass after changes).
- [x] A capability map artifact exists for routing-relevant actions and is reviewed in Phase 1 validation.
- [x] Routing conflict rules are documented and covered by at least one dry-run per conflict scenario.
- [ ] Fallback behavior is explicitly validated for mismatch-only and endpoint-unavailable cases.
- [ ] Automated routing regression tests (trigger matrix + fallback behaviors) are in place and pass in CI.
- [x] KPI gating uses a documented minimum sample protocol (positive + negative scenario counts and time window).

## Success Metrics
- **Adoption:** relevant sessions auto-route correctly in at least 80% of sampled `workflows-*` runs.
- **Quality:** median cycles-to-reproducible-evidence for targeted runtime tasks improves by at least 25% versus baseline.
- **Coverage:** all four `workflows-*` skills plus the five Phase 2 skills consume the shared contract.
- **Regression safety:** zero critical regressions in mode selection (`Core`/`Enhanced`/`terminal-probe`) across rollout dry runs.
- **Routing precision:** false-positive auto-invocations stay below 10% on sampled non-debug scenarios.
- **Routing recall:** false-negative misses stay below 10% on sampled debug/repro scenarios.
- **Metric validity gate:** evaluate KPIs only when sample size is at least 40 classified runs (`>=20` expected-route and `>=20` expected-no-route) collected over at least 14 calendar days.

## Dependencies & Risks
- **Dependency:** write access and governance for `$CODEX_HOME/skills/*` workflow skills.
  - **Mitigation:** perform changes in local skills first; mirror required artifacts into repo where applicable.
- **Risk:** false-positive auto invocation (over-triggering debug flow).
  - **Mitigation:** conservative trigger matrix, staged rollout, and opt-out control.
- **Risk:** false-negative auto invocation (missed reproducibility workflows).
  - **Mitigation:** explicit trigger coverage tests for known runtime/render scenarios.
- **Risk:** local vs repo drift for `fix-app-bugs` artifacts.
  - **Mitigation:** enforce sync/check scripts in rollout checklist and post-change validation.
- **Risk:** metric noise from inconsistent session logging.
  - **Mitigation:** define minimal mandatory telemetry fields and shared logging format before KPI evaluation.
- **Risk:** auto-invocation fatigue for review-oriented skills.
  - **Mitigation:** apply stricter trigger sets and conditional gating in Phase 2 for non-debug-first skills.
- **Risk:** inability to quickly disable routing after bad rollout.
  - **Mitigation:** enforce one global kill-switch and test rollback path before enabling by default.

## Implementation Outline
### Phase 0: Registry Decision + Contract Freeze (P0)
- [x] Decide canonical registry model (`$CODEX_HOME` source-of-truth, repo mirror role, sync expectations) and document it as a hard prerequisite.
- [x] Add path-resolution rules (`CODEX_HOME` required/defaulted) and prohibit user-specific absolute paths in implementation tasks.
- [x] Define kill-switch contract (`EVERY_AUTO_ROUTING_ENABLED=true|false`) and expected behavior in each workflow/skill.
- [x] Freeze trigger taxonomy schema and routing precedence before Phase 1 edits.

### Phase 1: Contract Definition + Workflow Hooks (P1)
- [x] Define shared capability-routing contract document and trigger taxonomy.
- [x] Update `$CODEX_HOME/skills/workflows-brainstorm/SKILL.md` to auto-detect runtime/repro contexts and call the shared contract.
- [x] Update `$CODEX_HOME/skills/workflows-plan/SKILL.md` to include auto-routing decision rules before planning path finalization.
- [x] Update `$CODEX_HOME/skills/workflows-work/SKILL.md` to enforce pre-execution routing checks from plan context.
- [x] Update `$CODEX_HOME/skills/workflows-review/SKILL.md` to gate runtime-evidence invocation by review context and avoid unconditional routing.
- [x] Add capability map table for routing outcomes and keep it versioned with workflow skill changes.
- [x] Define routing precedence and explicit completion statuses (`success`, `partial`, `blocked`) for routing attempts.

### Phase 2: Broad Skill Wave (P2)
- [x] Integrate shared contract into `$CODEX_HOME/skills/bug-reproduction-validator/SKILL.md`.
- [x] Integrate shared contract into `$CODEX_HOME/skills/test-browser/SKILL.md`.
- [x] Integrate shared contract into `$CODEX_HOME/skills/playwright/SKILL.md`.
- [x] Integrate shared contract into `$CODEX_HOME/skills/security-sentinel/SKILL.md` with conditional invocation only when runtime evidence is needed.
- [x] Integrate shared contract into `$CODEX_HOME/skills/performance-oracle/SKILL.md` with conditional invocation tied to runtime/perf evidence scenarios.
- [x] Add per-skill trigger profiles to limit over-routing in reviewer skills.

### Phase 3: Contract Alignment with fix-app-bugs + Mirror Discipline (P2)
- [x] Ensure contract language aligns with `$CODEX_HOME/skills/fix-app-bugs/SKILL.md` and mirror `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/SKILL.md`.
- [x] Update agent prompt metadata contract in local and mirrored `agents/openai.yaml` where needed.
- [x] Run mirror sync:
  - [x] `npm run skill:sync:from-local`
  - [x] `npm run skill:sync:check`
- [x] Validate no semantic drift between local skill wording and mirror wording for invocation-critical statements.

### Phase 4: Validation, KPIs, and Rollout Gate (P3)
- [x] Prepare a dry-run scenario matrix (workflow commands x trigger types x expected mode path).
- [x] Execute dry runs and log per-run routing outcomes and fallback decisions.
- [ ] Record KPI baseline and post-change comparison for adoption/quality/coverage.
- [ ] Approve Phase 2 expansion only if Phase 1 passes routing quality thresholds.
- [x] Include explicit false-positive/false-negative sampling in dry runs.
- [x] Add automated routing regression suite covering trigger matrix, fallback branches, and kill-switch behavior.
- [ ] Require routing regression suite in CI as a merge gate for routing-contract changes.
- [x] Publish a short rollout decision record with go/no-go outcome for Phase 2.

## Validation Strategy
### Dry-run Matrix (minimum set)
- `workflows-plan` + runtime bug narrative -> expected auto-route.
- `workflows-plan` + non-runtime refactor narrative -> expected no-route.
- `workflows-work` on runtime-focused plan -> expected route with mode declaration.
- `workflows-review` on docs-only change -> expected no-route.
- `workflows-review` on runtime-regression review -> expected conditional route.

### Evidence requirements per dry run
- Route decision trace (`matched`, `reason`, `ruleId`).
- Mode decision trace (`Core`, `Enhanced`, fallback flags).
- Outcome trace (`success`, `partial`, `blocked`).
- Contract compliance trace (fallback/no-fetch constraints respected when required).
- Kill-switch trace (`EVERY_AUTO_ROUTING_ENABLED` observed and effective behavior).

### Automated regression requirements
- Trigger matrix tests assert expected route/no-route behavior for representative positive and negative contexts.
- Fallback tests assert terminal-probe path on capability failure and forbid browser-side instrumentation in fallback.
- Kill-switch tests assert that global disable forces no auto-invocation across integrated skills.
- CI must fail on any routing regression test failure.

### Rollout gates
- Phase 1 -> Phase 2 only if:
  - canonical registry decision is finalized and documented
  - automated routing regression suite passes in CI
  - sample protocol is satisfied (`>=40` classified runs over `>=14` days)
  - adoption >= 80%
  - routing precision >= 90%
  - routing recall >= 90%
  - zero critical mode-selection regressions.

## AI-Era Notes
- This feature targets orchestration quality in an AI-assisted workflow environment where routing decisions happen quickly and repeatedly.
- The objective is deterministic behavior and reproducibility, not maximal automation depth.

## References & Research
### Internal references
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-12-every-workflows-browser-debug-integration-brainstorm.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md:17`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md:55`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md:107`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md:116`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/SKILL.md:21`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/SKILL.md:84`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/agents/openai.yaml:4`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/scripts/sync-fix-app-bugs-skill.sh:7`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/scripts/check-fix-app-bugs-sync.sh:7`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/package.json:16`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/contracts/auto-routing-contract.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/contracts/auto-routing-capability-map.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/contracts/2026-02-12-auto-routing-rollout-decision.md`
- `/Users/vladimirpuskarev/.codex/skills/workflows-plan/SKILL.md:71`
- `/Users/vladimirpuskarev/.codex/skills/workflows-work/SKILL.md:134`
- `/Users/vladimirpuskarev/.codex/skills/workflows-review/SKILL.md:64`
- `/Users/vladimirpuskarev/.codex/skills/agent-native-architecture/SKILL.md:21`
- `/Users/vladimirpuskarev/.codex/skills/agent-native-architecture/references/action-parity-discipline.md`
- `/Users/vladimirpuskarev/.codex/skills/agent-native-architecture/references/system-prompt-design.md`
- `/Users/vladimirpuskarev/.codex/skills/agent-native-architecture/references/agent-execution-patterns.md`
- `/Users/vladimirpuskarev/.codex/skills/agent-native-reviewer/SKILL.md:27`
- `/Users/vladimirpuskarev/.codex/skills/create-agent-skills/SKILL.md:68`

### Institutional learnings
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`

### External references
- None (intentionally skipped for this internal workflow orchestration scope).
