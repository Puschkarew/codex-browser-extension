---
title: feat: Build 24-hour cross-project agent feedback backlog and roadmap for Browser Debug plugin and fix-app-bugs
type: feat
date: 2026-02-17
brainstorm: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-17-agent-feedback-plugin-fix-app-bugs-brainstorm.md
---

# feat: Build 24-hour cross-project agent feedback backlog and roadmap for Browser Debug plugin and fix-app-bugs

## Overview
Create a repeatable planning workflow that converts the last 24 hours of cross-project Codex agent chats into actionable product improvements for two targets:
1. Browser Debug plugin.
2. `fix-app-bugs` skill.

The deliverable is a hybrid output:
- Prioritized backlog (`P0/P1/P2`) of concrete improvement items.
- Short roadmap (2-4 weeks) to implement the highest-value changes.

This plan focuses on WHAT to extract and decide; implementation details of automation can stay lightweight and manual-first for this first iteration.

## Problem Statement / Motivation
Current agent feedback is distributed across many sessions and projects. Without a structured review, repeated friction points are easy to miss and improvement priorities become opinion-driven.

We need one disciplined retro-audit flow that answers:
- What problems did agents actually hit in the last 24 hours?
- Which issues are plugin-specific vs `fix-app-bugs`-specific vs cross-cutting?
- What should be fixed first for maximum reliability and speed?

## Found Brainstorm Context (Step 0)
Found brainstorm from **2026-02-17**: **agent-feedback-plugin-fix-app-bugs**. Using as planning input.

Carried decisions:
- Scope: last 24 hours across all locally available Codex sessions.
- Primary approach: quick retro-audit (manual-heavy, fast).
- Output contract: `P0/P1/P2` backlog + short roadmap.
- Analysis dimensions: frequency, impact, workaround cost, confidence.
- Roadmap default: 2 committed weeks, with optional week 3-4 spillover.

## Auto-Routing Decision (Contract Trace)
Routing trace for this planning run:
- `triggerMatched`: false
- `triggerClass`: non-runtime
- `ruleId`: R5-default-no-route
- `autoInvoked`: false
- `modeSelected`: core
- `fallbackUsed`: false
- `killSwitchState`: enabled

Planning constraints carried forward:
- Keep `Core mode` as default for this analysis workflow.
- If any downstream execution path needs runtime reproducibility checks, preserve existing fallback semantics (`terminal-probe` when capability gate fails).
- Do not add browser-side `fetch(debugEndpoint)` in fallback paths.
- Treat mentions of `fix-app-bugs` in this document as analysis subject, not runtime invocation request.

## Repository & Learnings Research (Step 1)
### Repo findings
- Browser Debug evidence/query surfaces are already documented and stable:
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md:27`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md:141`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md:75`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:563`
- Local Codex session storage supports cross-project analysis (workspace-aware):
  - `/Users/vladimirpuskarev/.codex/skills/wrapped/scripts/get_codex_stats.py:24`
  - `/Users/vladimirpuskarev/.codex/skills/wrapped/scripts/get_codex_stats.py:316`
  - `/Users/vladimirpuskarev/.codex/skills/wrapped/scripts/get_codex_stats.py:324`
  - `/Users/vladimirpuskarev/.codex/skills/wrapped/scripts/get_codex_stats.py:334`
- Existing project brainstorm/plan conventions already support this output style:
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-17-agent-feedback-plugin-fix-app-bugs-brainstorm.md`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/plans/2026-02-12-feat-visual-parity-workflow-improvements-plan.md`

### Institutional learnings
Relevant learning found:
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`

Key insights to preserve:
- Machine-verifiable behavior must include both payload quality and exit-code correctness.
- Optional readiness checks must be explicitly marked non-blocking.
- Degraded-environment test coverage is required for tooling reliability.

Critical patterns file status:
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/patterns/critical-patterns.md` not found.

## External Research Decision (Step 1.5)
Decision: **skip external research**.

Reason:
- This is an internal workflow/planning problem with strong local sources and recent institutional learning.
- No high-risk external domain (payments/security compliance/legal standard) requires external best-practice lookup at this stage.

## Stakeholders
- Agents using Browser Debug plugin and `fix-app-bugs`.
- Maintainers of plugin, skill, and related workflow docs.
- Team members triaging bugfix friction and prioritizing platform improvements.

## SpecFlow Analysis (Step 3)
### User Flow Overview
1. Collect all local Codex sessions in the last 24 hours across projects.
2. Filter conversations relevant to Browser Debug plugin and `fix-app-bugs`.
3. Extract explicit feedback signals and inferred friction signals.
4. Classify each signal into taxonomy buckets (`setup`, `instrumentation`, `fallback`, `evidence`, `reporting`, `docs/UX`).
5. Aggregate frequency + impact + workaround cost + confidence.
6. Produce prioritized backlog items with evidence references.
7. Build a short implementation roadmap from dependencies and priority.
8. Review and approve roadmap for execution.

### Flow Permutations Matrix
| Flow | Context | Expected behavior |
| --- | --- | --- |
| High signal density | Many relevant sessions in 24h | Produce detailed backlog with clear pattern clusters |
| Low signal density | Few relevant sessions | Produce reduced backlog and mark confidence constraints |
| Explicit complaints | Agents directly report issues | Classify as high-confidence feedback |
| Inferred friction | No direct complaint but repeated retries/fallbacks | Classify separately as inferred, lower-confidence |
| Mixed ownership | Same symptom from plugin and skill interactions | Create cross-cutting item with shared ownership |
| Missing logs | Some sessions unavailable locally | Report coverage gap explicitly in validation |

### Missing Elements & Gaps
- **Category:** Taxonomy consistency
  - **Gap:** No fixed schema yet for labeling friction types.
  - **Impact:** Hard to compare runs or prioritize fairly.
- **Category:** Evidence standard
  - **Gap:** No single rule for linking backlog items to session evidence.
  - **Impact:** Priority debates become subjective.
- **Category:** Confidence modeling
  - **Gap:** No explicit split between explicit and inferred feedback.
  - **Impact:** Risk of over-weighting noisy signals.
- **Category:** Ownership mapping
  - **Gap:** No standard for plugin vs skill vs shared ownership.
  - **Impact:** Backlog items can stall without clear owner.
- **Category:** Cadence alignment
  - **Gap:** Default horizon is defined, but owner confirmation is still required before execution kickoff.
  - **Impact:** Timeline can drift if default is not explicitly accepted.

### Critical Questions Requiring Clarification
1. **Critical:** What is the minimum evidence threshold for a backlog item?
   - Why it matters: controls backlog quality and noise.
   - Default assumption if unanswered: allow single-instance `P2`, require repeated pattern for `P0/P1`.
2. **Critical:** Should inferred friction (retries/fallback loops) be included with explicit complaints?
   - Why it matters: inferred signals may capture hidden pain but can be noisy.
   - Default assumption if unanswered: include inferred signals with separate confidence tagging.
3. **Important:** How should shared root causes across projects be represented?
   - Why it matters: avoids duplicate work and fragmented fixes.
   - Default assumption if unanswered: merge into one canonical item with multi-project evidence references.

### Recommended Next Steps
1. Lock taxonomy and evidence schema before scoring.
2. Confirm default horizon/threshold policies with maintainers.
3. Run the 24-hour audit once end-to-end and publish first backlog+roadmap draft.
4. Review with maintainers and freeze P0/P1 for execution.

## Proposed Solution
Deliver a fast, manual-first retro-audit package in one cycle:
1. **Evidence pass:** gather relevant 24-hour cross-project sessions and extract issue signals.
2. **Synthesis pass:** normalize and score findings by frequency, impact, workaround cost, confidence.
3. **Decision pass:** create `P0/P1/P2` backlog and a short roadmap with owners and dependencies.

This keeps effort YAGNI-compliant while producing an actionable plan immediately.

## Default Decisions for This Cycle
Unless maintainers override, this first cycle uses these defaults:
- Evidence threshold: `P0/P1` require either `>=2` independent sessions with the same symptom or one severe blocker with reproducible evidence; `P2` may use single-instance evidence.
- Inferred friction policy: inferred-only signals can populate backlog but cannot be promoted above `P1` without a second confirming session.
- Roadmap horizon: commit week 1-2 items; week 3-4 is optional spillover for deferred `P2` work.
- Shared root causes: merge duplicates into one canonical backlog item with multi-project evidence references.

## Prioritization Model
Use a 4-factor score per finding:
- **Frequency:** how many sessions/projects show the same issue.
- **Impact:** how much it blocks or slows task completion.
- **Workaround cost:** effort required to continue without a fix.
- **Confidence:** evidence quality (explicit complaint > inferred pattern).

Priority rubric:
- **P0:** high impact + high frequency or severe blocker, confidence medium/high.
- **P1:** meaningful friction with clear value, confidence medium/high.
- **P2:** minor or exploratory improvements, or low-confidence signals.

## Backlog Shape (Output Contract)
Each backlog item must include:
- Title (`plugin` / `fix-app-bugs` / `shared`).
- Problem statement.
- Evidence references (session IDs or log paths).
- Priority (`P0/P1/P2`) and rationale.
- Proposed change (what to improve, not implementation detail).
- Expected effect.
- Owner (`plugin`, `skill`, or `shared`).

## Roadmap Shape (Output Contract)
Roadmap format (2-4 weeks):
- **Week 1:** P0 fixes and unblockers.
- **Week 2:** P1 reliability and usability improvements.
- **Week 3-4 (optional):** P2 polish and instrumentation refinements.

Each roadmap item includes:
- Linked backlog item(s).
- Exit criterion (observable outcome).
- Dependency notes.

## Technical Considerations
- Preserve existing Browser Debug + `fix-app-bugs` mode/fallback semantics in all proposed improvements.
- Keep cross-project analysis local-first (no cloud dependency assumption).
- Avoid exposing sensitive prompt content; aggregate at issue-pattern level unless exact snippets are required for evidence.
- Keep first iteration lightweight and reproducible with existing tooling (`rg`, JSONL session files, existing docs/contracts).
- Keep scope bounded to plugin/skill feedback; exclude unrelated generic Codex quality issues from this backlog.

## Acceptance Criteria
- [x] Analysis covers all locally available Codex sessions from the last 24 hours across projects.
- [x] Findings are classified into plugin, `fix-app-bugs`, and shared categories.
- [x] Each backlog item contains evidence reference(s) and explicit priority rationale.
- [x] Final output contains `P0/P1/P2` backlog plus a 2-4 week roadmap.
- [x] Report explicitly documents data coverage limits (missing/unavailable logs).
- [x] At least one actionable improvement item is produced for each target area (plugin and skill), or a justified "no findings" statement is recorded.
- [x] Routing validation notes include required trace fields (`triggerMatched`, `ruleId`, `modeSelected`, `fallbackUsed`, `killSwitchState`).
- [x] `P0/P1` promotion follows the evidence threshold policy defined in this plan.
- [x] Each backlog item includes confidence level (`high`, `medium`, `low`) and signal type (`explicit` or `inferred`).

## Success Metrics
- Decision latency: backlog + roadmap produced within one working session.
- Actionability: each `P0/P1` item has clear owner and exit criterion.
- Evidence quality: 100% of backlog items contain source references.
- Execution readiness: maintainers can start implementation directly from roadmap without additional discovery pass.

## Dependencies & Risks
- **Dependency:** local availability of Codex session files.
  - **Mitigation:** include coverage report with counts of scanned/available sessions.
- **Risk:** noisy or ambiguous inferred feedback.
  - **Mitigation:** separate explicit vs inferred signals and use confidence tags.
- **Risk:** overfitting to one-day anomalies.
  - **Mitigation:** mark items requiring multi-day validation before promotion to P0.
- **Risk:** unclear ownership for cross-cutting issues.
  - **Mitigation:** assign `shared` owner with designated decision driver.

## Implementation Outline
### Phase 1: Audit Setup (P0)
- [x] Freeze taxonomy labels and scoring rubric.
- [x] Freeze inclusion criteria for relevant conversations.
- [x] Define evidence-reference format for backlog entries.

### Phase 2: Data Collection and Tagging (P1)
- [x] Enumerate all 24-hour session files.
- [x] Extract plugin/skill-related signals.
- [x] Tag each signal by category and confidence.

### Phase 3: Synthesis and Prioritization (P1)
- [x] Group duplicate symptoms into canonical issues.
- [x] Score each issue using the 4-factor model.
- [x] Produce `P0/P1/P2` backlog draft.

### Phase 4: Roadmap and Handoff (P2)
- [x] Build 2-4 week roadmap from priority and dependency order.
- [x] Add owners and exit criteria.
- [ ] Publish final report and review with maintainers.
  - Report published at `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-17-agent-feedback-24h-plugin-fix-app-bugs.md`; maintainer review pending.

## Validation Strategy
Validation checklist for the first run:
1. Confirm scanned file count and 24-hour boundary used.
2. Spot-check 5 random findings against source session evidence.
3. Verify each backlog item has one unique ID, one owner, and one priority.
4. Verify roadmap items map directly to backlog IDs.
5. Capture routing trace fields for auditability.

## AI-Era Notes
- Agent output volume makes manual triage expensive; this plan keeps iteration speed by enforcing a compact taxonomy and evidence schema first.
- Confidence tagging is critical to avoid treating uncertain inferred behavior as confirmed product defects.

## References & Research
### Internal References
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-17-agent-feedback-plugin-fix-app-bugs-brainstorm.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md:27`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md:141`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md:75`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:563`
- `/Users/vladimirpuskarev/.codex/skills/wrapped/scripts/get_codex_stats.py:24`
- `/Users/vladimirpuskarev/.codex/skills/wrapped/scripts/get_codex_stats.py:316`
- `/Users/vladimirpuskarev/.codex/skills/wrapped/scripts/get_codex_stats.py:324`
- `/Users/vladimirpuskarev/.codex/skills/wrapped/scripts/get_codex_stats.py:334`

### Institutional Learnings
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`
