---
title: feat: Streamline visual parity workflow and evidence handoff
type: feat
date: 2026-02-12
brainstorm: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-12-visual-parity-workflow-improvements-brainstorm.md
---

# feat: Streamline visual parity workflow and evidence handoff

## Overview
Define and ship a lightweight workflow layer on top of existing Browser Debug + `fix-app-bugs` capabilities so visual-parity investigations converge faster with less manual coordination. The plan targets startup clarity (mode choice), deterministic evidence packaging, and lower reporting friction during iterative loops while preserving strict final validation requirements.

## Problem Statement / Motivation
Current tooling already has strong primitives (`compare-reference`, terminal-probe pipeline, guarded bootstrap), but operators still spend excessive time stitching steps manually. The largest friction points are: deciding mode quickly, collecting parity artifacts in one predictable bundle, and recording iterative progress without forcing final-report overhead on every cycle.

## Found Brainstorm Context (Step 0)
Found brainstorm from **2026-02-12**: **visual-parity-workflow-improvements**. Using as context for planning.

What carries forward:
- Prefer a thin, YAGNI workflow layer over full orchestration.
- Keep strict five-block reporting for final Enhanced closure.
- Add a deterministic evidence contract and an explicit stop-rule for non-converging tuning loops.

## Repository & Learnings Research (Step 1)
### Repo findings
- Mode declaration and split policy already exist in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md:17` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md:47`.
- Core command surface already supports `snapshot` and `compare-reference` in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/cmd.ts:11` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/cmd.ts:77`.
- `compare-reference` already writes `runtime.json`, `metrics.json`, `summary.json`, `actual.png`, `reference.png`, and optional `diff.png` via `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:680` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:742`.
- Artifact run directories are already deterministic per run-id in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/jsonl-store.ts:53`.
- Terminal-probe pipeline already emits bundle JSON outputs and scenario-level metrics in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:630`.
- Existing docs already describe parity artifact contents and default paths in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md:286`.

### Institutional learnings
- Primary relevant learning: `/Users/vladimirpuskarev/Documents/Humans Refresh/docs/solutions/developer-experience/2026-02-12-fix-app-bugs-browser-extension-feedback.md`.
- Supporting visual-parity learning: `/Users/vladimirpuskarev/Documents/Humans Refresh/docs/solutions/ui-bugs/contour-noise-not-visible-particle-pipeline-20260211.md`.
- `critical-patterns.md` was not found under `/Users/vladimirpuskarev/Documents/Humans Refresh/docs/solutions/`.

### Key insight summary
- The codebase has most technical primitives already; missing value is workflow composition and standardization.
- Documentation already states contracts, but agents still need a faster "happy path" and lower-friction intermediate reporting.

## External Research Decision (Step 1.5)
Decision: **skip external research**.

Reason: This feature is an internal workflow/productivity improvement with low domain risk and strong local evidence (repo docs, scripts, and institutional solutions). No security/payment/privacy unknowns require external best-practice lookup for initial planning.

## Stakeholders
- Developers and AI agents running visual-debug sessions.
- Maintainers of `fix-app-bugs` and Browser Debug docs/scripts.
- Reviewers receiving parity evidence bundles and handoff notes.

## SpecFlow Analysis (Step 3)
### User Flow Overview
1. Operator starts a visual-debug task and immediately chooses `Core` vs `Enhanced` from a short decision helper.
2. Operator runs a parity-bundle command to capture headed evidence and compare-reference artifacts into one output folder.
3. If Enhanced mode falls back, operator runs terminal-probe helper and still produces equivalent artifacts.
4. Operator records interim loop output (hypothesis delta, evidence delta, next step) until convergence.
5. Operator either closes with final five-block report or triggers stop-rule and opens rollback/retrospective follow-up.

### Flow Permutations Matrix
| Flow | Context | Expected outcome |
| --- | --- | --- |
| Mode selection | Routine local debugging | `Core mode` chosen in under 30s |
| Mode selection | Reproducibility required | `Enhanced mode` chosen; guarded bootstrap run |
| Bundle capture | Active CDP session | One folder with parity artifacts and compact summary |
| Bundle capture fallback | `terminal-probe` mode | Equivalent `runtime/metrics/summary` evidence emitted |
| Iteration reporting | Mid-tuning cycle | Interim report used; no forced final template |
| Non-convergence | Repeated failed parity cycles | Stop-rule triggers rollback/retrospective path |

### Missing Elements & Gaps
- **Category:** Workflow entrypoint
  - **Gap:** No concise mode decision tree in primary entry docs.
  - **Impact:** Startup ambiguity and coordination delay.
- **Category:** Evidence packaging
  - **Gap:** No one-command parity bundle wrapper despite existing primitives.
  - **Impact:** Manual stitching and inconsistent handoffs.
- **Category:** Iterative reporting
  - **Gap:** Missing interim report template separate from final closure template.
  - **Impact:** Either unstructured notes or heavyweight reports every cycle.
- **Category:** Convergence governance
  - **Gap:** No explicit stop-rule for parity tuning loops.
  - **Impact:** Potential endless tuning with no decision gate.

### Critical Questions Requiring Clarification
1. **Important:** Should the canonical artifact contract stay under `logs/browser-debug/...` or move to `output/parity/...`?
   - Default assumption if unanswered: keep `logs/browser-debug/...` canonical for v1 compatibility, document optional alias path later.
2. **Important:** What threshold should trigger stop-rule?
   - Default assumption if unanswered: trigger after 3 consecutive failed parity cycles or 90 minutes without meaningful metrics improvement.
3. **Nice-to-have:** Should interim reports be required for every cycle or only when handing off?
   - Default assumption if unanswered: mandatory only for handoff and final non-convergence decisions.

## Proposed Solution
Implement a thin workflow layer in four increments:
1. Add `agent:parity-bundle` CLI entrypoint that composes existing commands and outputs a deterministic bundle path plus compact markdown summary.
2. Add a short mode decision helper and a visual-debug starter helper that prints the correct next command from bootstrap verdict.
3. Add interim visual report template and explicit evidence folder contract to docs/references.
4. Add parity stop-rule guidance and escalation path to prevent non-converging loops.

## Technical Considerations
- Keep compatibility with existing command contracts and artifact generation behavior.
- Preserve source-of-truth workflow for skill edits (`$CODEX_HOME/skills/fix-app-bugs` first, then mirror sync in repo).
- Avoid forcing headless evidence as a success gate for WebGL/render tasks; headed validation remains mandatory.
- Keep implementation modular so each increment can land independently.

## Acceptance Criteria
- [x] `package.json` includes `agent:parity-bundle` script (`/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/package.json`).
- [x] Parity bundle command produces one deterministic output folder and prints that path (`/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/`).
- [x] Output bundle includes `runtime.json`, `metrics.json`, `summary.json`, `actual.png`, `reference.png`, optional `diff.png`, and `notes.md`.
- [x] Mode decision helper (5-7 lines) is present in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md`, and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md`.
- [x] Visual-debug starter helper exists in `fix-app-bugs` scripts and prints mode-specific next actions (`browser-fetch` vs `terminal-probe`).
- [x] Interim template exists at `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/references/interim-visual-report-template.md`.
- [x] Final five-block report requirement remains unchanged in Enhanced mode docs/skill.
- [x] Stop-rule is documented with threshold and required fallback action (rollback + retrospective plan).
- [x] Skill mirror sync check passes after local skill updates (`npm run skill:sync:check`).

## Success Metrics
- Median time to explicit mode decision: under 30 seconds in dry-run walkthroughs.
- Median time to first valid parity artifact bundle: under 5 minutes from session start.
- Handoff completeness: 100% of visual parity handoffs include required bundle files.
- Process quality: reduced ad-hoc screenshot exchange versus baseline runs.

## Dependencies & Risks
- **Dependency:** local `fix-app-bugs` skill remains source-of-truth outside this repo.
  - **Mitigation:** enforce `skill:sync:from-local` and `skill:sync:check` in rollout checklist.
- **Risk:** new wrapper command duplicates existing logic and drifts.
  - **Mitigation:** compose existing `/command` operations rather than reimplementing image comparison.
- **Risk:** stop-rule threshold may be too strict or too lenient.
  - **Mitigation:** launch with explicit default and revisit after first 5 real runs.
- **Risk:** interim reporting under-used without clear trigger.
  - **Mitigation:** require interim report on handoff or after each failed parity cycle.

## Implementation Outline
### Phase 1: Parity Bundle Command (P1)
- [x] Add CLI wrapper entrypoint in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/` that composes `snapshot` + `compare-reference` and writes compact `notes.md`.
- [x] Add script wiring in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/package.json`.
- [x] Add tests for command argument validation and output shape in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/tests/`.

### Phase 2: Mode Decision + Starter Helper (P1)
- [x] Add concise decision helper to `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md`, `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md`.
- [x] Add visual-debug starter script in local `fix-app-bugs` skill and sync mirror into `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/`.
- [x] Validate starter helper behavior for both `browser-fetch` and `terminal-probe` verdicts.

### Phase 3: Interim Reporting + Evidence Contract (P2)
- [x] Add interim template file in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/references/interim-visual-report-template.md`.
- [x] Document canonical evidence contract paths and required files in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md` and skill docs.
- [x] Ensure final-report template remains unchanged and clearly marked as final-closure-only.

### Phase 4: Stop Rule + Rollout Validation (P3)
- [x] Add stop-rule policy and escalation steps to workflow docs.
- [x] Run at least one `Core` and one `Enhanced` dry-run to validate end-to-end clarity.
- [x] Record before/after workflow timing and artifact completeness metrics.

Rollout validation notes (2026-02-12):
- Core dry-run command: `npm run agent:parity-bundle -- --actual <fixture-actual> --reference <fixture-reference> --label core-dryrun`
- Core dry-run duration: `0.325s`
- Core artifact completeness: `runtime.json`, `metrics.json`, `summary.json`, `actual.png`, `reference.png`, `diff.png`, `notes.md` created under `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/logs/browser-debug/67ec91d2-6da1-4782-bc69-025c171c0f2a/artifacts/2026-02-12T11-13-03-268Z-core-dryrun-8720bff9/`.
- Enhanced dry-run command: `python3 skills/fix-app-bugs/scripts/visual_debug_start.py --project-root . --actual-app-url http://127.0.0.1:4173/index.html --json`
- Enhanced dry-run duration: `2.318s`
- Enhanced decision output: `mode=terminal-probe`, `checks.appUrl.status=mismatch`, next action clearly points to app-url mismatch resolution before instrumentation/capture.

## AI-Era Notes
- Fast agent iteration increases risk of partial evidence and mode confusion; this plan intentionally adds explicit decision gates and standard artifact contracts.
- The goal is not more automation for its own sake; it is faster convergence with reproducible, handoff-ready evidence.

## References & Research
### Internal References
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/brainstorms/2026-02-12-visual-parity-workflow-improvements-brainstorm.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md:17`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/AGENTS.md:147`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md:107`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md:286`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/cmd.ts:11`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:680`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/jsonl-store.ts:53`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/SKILL.md:68`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:630`

### Institutional Learnings
- `/Users/vladimirpuskarev/Documents/Humans Refresh/docs/solutions/developer-experience/2026-02-12-fix-app-bugs-browser-extension-feedback.md`
- `/Users/vladimirpuskarev/Documents/Humans Refresh/docs/solutions/ui-bugs/contour-noise-not-visible-particle-pipeline-20260211.md`
