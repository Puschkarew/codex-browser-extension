---
module: fix-app-bugs
date: 2026-02-12
problem_type: logic_error
component: tooling
symptoms:
  - "Bootstrap diagnostics reported wrapper failure when Playwright wrapper was healthy but npx was unavailable"
  - "visual_debug_start.py returned exit code 0 even when guarded bootstrap or terminal-probe failed"
  - "Automation/CI could not reliably gate on startup health and smoke verification"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [fix-app-bugs, bootstrap, diagnostics, playwright, npx, exit-codes, ci]
---

# Troubleshooting: Fix False-Negative Bootstrap Diagnostics and Exit-Code Contract Regressions

## Problem
Two regressions in the `fix-app-bugs` helper scripts made tooling behavior unreliable for automation. One regression caused a false-negative Playwright readiness verdict; the other masked hard failures behind a success exit code.

## Environment
- Module: fix-app-bugs
- Affected Component: tooling scripts (`bootstrap_browser_debug.py`, `visual_debug_start.py`)
- Date: 2026-02-12

## Symptoms
- `check_playwright_tool()` could report unavailable/failed behavior when wrapper smoke passed but `npx` was missing.
- `visual_debug_start.py` emitted diagnostics about failed bootstrap/probe but still exited with `0`.
- CI/shell workflows could not trust process exit status as a failure signal.

## What Didn't Work

**Attempted Solution 1:** Treat functional smoke as always required for wrapper mode.
- **Why it failed:** Functional smoke was executed through `npx`; in wrapper-only environments this forced a false failure path.

**Attempted Solution 2:** Rely only on JSON payload diagnostics from `visual_debug_start.py`.
- **Why it failed:** Machine consumers typically gate on process exit codes; payload-only error reporting did not stop failing pipelines.

## Solution
Applied two coordinated fixes plus regression coverage.

### 1. Decouple wrapper readiness from `npx` availability

**Code changes**:
```python
# skills/fix-app-bugs/scripts/bootstrap_browser_debug.py
if npx_check.get("ok") and npx_path:
    functional_smoke = run_playwright_functional_smoke(npx_path)
else:
    functional_smoke = {
        "ok": False,
        "skipped": True,
        "reason": "functional smoke skipped because npx command is unavailable",
        "command": None,
        "exitCode": None,
    }
functional_ok = bool(functional_smoke.get("ok")) or bool(functional_smoke.get("skipped"))
```

Result: healthy wrapper mode remains `ok=true`; `functionalSmoke` stays actionable but non-blocking when `npx` is unavailable.

### 2. Enforce hard-failure exit semantics in visual starter

**Code changes**:
```python
# skills/fix-app-bugs/scripts/visual_debug_start.py
def compute_exit_code(bootstrap, terminal_probe_result):
    if isinstance(bootstrap.get("exitCode"), int) and bootstrap["exitCode"] != 0:
        return 1
    if isinstance(terminal_probe_result, dict):
        probe_exit = terminal_probe_result.get("exitCode")
        if isinstance(probe_exit, int) and probe_exit != 0:
            return 1
    return 0

exit_code = compute_exit_code(bootstrap=bootstrap, terminal_probe_result=terminal_probe_result)
output["exitCode"] = exit_code
return exit_code
```

Result: failures in guarded bootstrap or executed terminal-probe now propagate via non-zero process exit.

### 3. Add/extend regression tests

**Commands run**:
```bash
python3 skills/fix-app-bugs/scripts/test_bootstrap_browser_debug.py
python3 skills/fix-app-bugs/scripts/test_visual_debug_start.py
npm test
```

All commands passed after the fixes.

## Why This Works
1. The wrapper probe validates the actual selected wrapper path; it should not be invalidated by an unrelated `npx` absence.
2. Functional smoke remains visible in diagnostics (`functionalSmoke`) but is correctly classified as optional when prerequisites are unavailable.
3. `visual_debug_start.py` now honors shell/CI contracts by returning non-zero on hard failures while preserving detailed JSON diagnostics.

## Prevention
- Keep probe semantics explicit: required checks must block, optional checks must be marked `skipped` and non-blocking.
- For every tooling contract, test both payload content and process exit code behavior.
- Add regression tests for degraded environments (missing binaries, partial toolchain availability).
- Update docs whenever behavior changes for machine-consumed fields (`functionalSmoke`, `exitCode`).

## Related Issues
No related issues documented yet.

Related implementation context:
- `docs/plans/2026-02-12-feat-visual-parity-workflow-improvements-plan.md`
- `docs/brainstorms/2026-02-12-visual-parity-workflow-improvements-brainstorm.md`
- `todos/001-complete-p2-playwright-functional-smoke-npx-hard-dependency.md`
- `todos/002-complete-p2-visual-debug-start-success-exit-on-failures.md`
