---
status: complete
priority: p2
issue_id: "002"
tags: [code-review, reliability, tooling, automation]
dependencies: []
---

# `visual_debug_start.py` Returns Success on Bootstrap/Capture Failure

`visual_debug_start.py` exits with status code `0` even when bootstrap invocation fails or terminal-probe capture fails, which can cause automation to treat failed setup as successful.

## Problem Statement

The script used to unconditionally return `0` at the end, which meant it could report a failed bootstrap command or terminal-probe execution in payload fields while still signaling success to the shell/CI.

## Findings

- `skills/fix-app-bugs/scripts/visual_debug_start.py:190` executes bootstrap and stores exit code/result in payload.
- `skills/fix-app-bugs/scripts/visual_debug_start.py:223` may execute terminal-probe and capture failure details.
- `skills/fix-app-bugs/scripts/visual_debug_start.py:245` computes process result from bootstrap + probe exit states.
- `skills/fix-app-bugs/scripts/visual_debug_start.py:278` now returns computed exit code.
- Repro 1: invalid bootstrap path + `--skip-terminal-probe` returned `exit:0`.
- Repro 2: invalid bootstrap path + terminal probe attempt returned `exit:0` with `terminalProbe.exitCode=1` in JSON.

## Proposed Solutions

### Option 1: Return Non-Zero for Hard Failures

**Approach:** Return `1` when bootstrap command exits non-zero or when terminal-probe runs and exits non-zero.

**Pros:**
- Correct shell semantics for scripts and CI.
- Easy integration with automation guardrails.

**Cons:**
- Existing users relying on always-0 behavior may need adjustment.

**Effort:** Small

**Risk:** Low

---

### Option 2: Add Explicit `--strict-exit-codes` Flag

**Approach:** Keep current default behavior, but add strict mode that propagates failures via process exit code.

**Pros:**
- Backward compatibility preserved.
- Lets automation opt in incrementally.

**Cons:**
- Dual behavior can increase confusion if not documented clearly.

**Effort:** Small

**Risk:** Low

---

### Option 3: Split into Advisory and Enforcement Commands

**Approach:** Keep current starter script advisory-only and introduce a separate enforcing wrapper for CI/automation.

**Pros:**
- Clear intent separation.
- No ambiguity between human guidance and machine gating.

**Cons:**
- Additional maintenance surface.

**Effort:** Medium

**Risk:** Medium

## Recommended Action
Adopt **Option 1 (Return Non-Zero for Hard Failures)** now, because this script is consumed by automation and exit-code correctness is part of its contract.

Implementation order:
1. Return `1` when bootstrap command fails.
2. Return `1` when terminal-probe was executed and failed.
3. Keep payload diagnostics unchanged.
4. Update tests for both failure paths and docs for exit-code semantics.

Triage decision: **Approved for immediate implementation** (first in queue).


## Technical Details

**Affected files:**
- `skills/fix-app-bugs/scripts/visual_debug_start.py:134`
- `skills/fix-app-bugs/scripts/visual_debug_start.py:245`
- `skills/fix-app-bugs/scripts/visual_debug_start.py:278`
- `skills/fix-app-bugs/scripts/test_visual_debug_start.py:20`
- `skills/fix-app-bugs/SKILL.md:48`
- `README-debug.md:136`

**Related components:**
- Bootstrap orchestration helper
- Terminal-probe starter workflow

## Resources

- Local repro command logs showing `exit:0` with failing bootstrap/capture steps

## Acceptance Criteria

- [x] Script returns non-zero when configured critical steps fail (or strict mode enabled).
- [x] JSON payload still reports detailed failure diagnostics.
- [x] Smoke tests cover failing bootstrap and failing terminal-probe exit semantics.
- [x] README/SKILL docs clarify exit-code behavior.

## Work Log

### 2026-02-12 - Code Review Finding

**By:** Codex

**Actions:**
- Reviewed starter helper control flow and exit behavior.
- Reproduced failure scenarios with invalid bootstrap path.
- Captured line references and implementation options.

**Learnings:**
- Current helper is robust in diagnostics but weak in machine-consumable success/failure signaling.

### 2026-02-12 - Triage

**By:** Codex

**Actions:**
- Promoted status from `pending` to `ready`.
- Selected Option 1 as default path.
- Prioritized this todo above issue `001` due to automation contract impact.

**Learnings:**
- Correct exit codes are required for deterministic CI and scripted workflows.

### 2026-02-12 - Implementation

**By:** Codex

**Actions:**
- Added `compute_exit_code()` and wired `main()` to return non-zero on bootstrap/probe hard failures in `skills/fix-app-bugs/scripts/visual_debug_start.py`.
- Added JSON payload field `exitCode` for machine-readable status.
- Extended `skills/fix-app-bugs/scripts/test_visual_debug_start.py` with two regressions:
  - bootstrap non-zero with `--skip-terminal-probe` -> process exit `1`
  - terminal-probe non-zero -> process exit `1`
- Updated docs in `skills/fix-app-bugs/SKILL.md` and `README-debug.md` with explicit exit-code contract.
- Ran:
  - `python3 skills/fix-app-bugs/scripts/test_visual_debug_start.py`
  - `npm test`

**Learnings:**
- Keeping payload diagnostics unchanged while returning correct shell status preserves both human readability and automation reliability.

## Notes

- This affects reliability of scripted workflows and CI pipelines that rely on exit code contracts.
