---
status: complete
priority: p2
issue_id: "001"
tags: [code-review, reliability, tooling, fix-app-bugs]
dependencies: []
---

# Playwright Functional Smoke Incorrectly Depends on `npx`

The Playwright functional smoke check can fail even when the wrapper probe is healthy, because the functional smoke is always executed through `npx` and treated as mandatory for wrapper success.

## Problem Statement

`check_playwright_tool()` used to mark the tool as unavailable (`mode=wrapper-functional-failed`) when `npx` was missing, even if the wrapper itself was executable and passed smoke checks. This regressed wrapper-only environments and produced false negatives in bootstrap diagnostics.

## Findings

- In `skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:818`, `functional_smoke` is only sourced from `run_playwright_functional_smoke(npx_path)` when `npx` exists.
- In `skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:825`, missing `npx` now maps to `functionalSmoke.skipped=true` with explicit reason.
- In `skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:831`, wrapper success still depends on `functional_ok`, but skipped functional smoke now remains non-blocking for healthy wrapper mode.
- Repro proof (local): with an executable wrapper and `npx_check={ok:false}`, `check_playwright_tool()` returns:
  - `ok=true`
  - `mode=wrapper`
  - `functionalSmoke.skipped=true`
  - `functionalSmoke.reason="functional smoke skipped because npx command is unavailable"`

## Proposed Solutions

### Option 1: Decouple Wrapper Success from `npx` Functional Smoke

**Approach:** If wrapper smoke is successful, treat functional smoke as optional unless explicitly enforced by flag.

**Pros:**
- Removes false negatives in wrapper-only environments.
- Preserves current diagnostics as non-blocking signal.

**Cons:**
- Slightly weaker default strictness of Playwright readiness check.

**Effort:** Small

**Risk:** Low

---

### Option 2: Run Functional Smoke via Selected Tool Path

**Approach:** Use the selected wrapper command for functional validation instead of hard-coding `npx --package playwright`.

**Pros:**
- Aligns functional validation with actual runtime tool.
- Avoids mismatched probe paths.

**Cons:**
- Requires wrapper interface support for a functional smoke subcommand.

**Effort:** Medium

**Risk:** Medium

---

### Option 3: Keep Current Logic but Make Strict Mode Explicit

**Approach:** Default functional smoke to skipped unless `PLAYWRIGHT_FUNCTIONAL_SMOKE=required` is set.

**Pros:**
- Backward compatible for most users.
- Maintains strict path as opt-in.

**Cons:**
- Another behavioral mode to document.

**Effort:** Small

**Risk:** Low

## Recommended Action
Adopt **Option 1 (Decouple Wrapper Success from `npx` Functional Smoke)** now, with an explicit diagnostic field indicating functional smoke status.

Implementation order:
1. Keep wrapper-smoke pass as sufficient for wrapper availability.
2. Mark functional smoke as `skipped`/`degraded` when `npx` is unavailable (non-blocking).
3. Preserve strict mode only as explicit opt-in.
4. Add tests for wrapper-pass + npx-missing path and update docs.

Triage decision: **Approved for implementation after issue `002`**.


## Technical Details

**Affected files:**
- `skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:818`
- `skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:825`
- `skills/fix-app-bugs/scripts/bootstrap_browser_debug.py:831`
- `skills/fix-app-bugs/scripts/test_bootstrap_browser_debug.py:160`
- `skills/fix-app-bugs/SKILL.md:72`
- `README-debug.md:172`

**Related components:**
- Guarded bootstrap tool checks
- Playwright wrapper/npx diagnostics

## Resources

- Local repro run output from `check_playwright_tool()` with wrapper-only + no npx

## Acceptance Criteria

- [x] Wrapper smoke success is not downgraded solely due to missing `npx` functional smoke.
- [x] Functional smoke behavior is explicitly documented as optional or required.
- [x] Existing smoke tests are updated to cover wrapper-success + npx-missing scenario.
- [x] Bootstrap output still includes actionable diagnostics for functional smoke state.

## Work Log

### 2026-02-12 - Code Review Finding

**By:** Codex

**Actions:**
- Reviewed bootstrap Playwright probe logic.
- Reproduced false-negative behavior with executable wrapper and no `npx`.
- Captured affected lines and mitigation options.

**Learnings:**
- The functional smoke check currently introduces an unintended hard dependency on `npx` for wrapper mode.

### 2026-02-12 - Triage

**By:** Codex

**Actions:**
- Promoted status from `pending` to `ready`.
- Selected Option 1 as primary fix direction.
- Sequenced after issue `002` since this is a diagnostics reliability regression, not a hard failure contract bug.

**Learnings:**
- Diagnostics should stay actionable without blocking healthy wrapper-only environments.

### 2026-02-12 - Implementation

**By:** Codex

**Actions:**
- Updated `check_playwright_tool()` so missing `npx` marks `functionalSmoke` as `skipped=true` instead of failing wrapper-mode readiness.
- Added regression coverage in `skills/fix-app-bugs/scripts/test_bootstrap_browser_debug.py` for `wrapper ok + npx missing`.
- Updated docs in `skills/fix-app-bugs/SKILL.md` and `README-debug.md` to clarify optional/non-blocking functional smoke behavior when `npx` is unavailable.
- Ran:
  - `python3 skills/fix-app-bugs/scripts/test_bootstrap_browser_debug.py`
  - `npm test`

**Learnings:**
- Wrapper readiness and functional smoke diagnostics should be decoupled so tooling remains reliable in constrained environments.

## Notes

- This is a diagnostics reliability regression, not a direct security issue.
