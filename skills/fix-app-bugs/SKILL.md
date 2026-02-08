---
name: fix-app-bugs
description: Diagnose and fix reproducible bugs and incorrect app behavior using strict runtime evidence. Bootstrap Browser Debug first, enforce instrumentation capability verdicts, and use terminal-probe fallback when browser instrumentation is unavailable.
---

# Fix App Bugs

## Overview

Diagnose and fix bugs with a strict evidence-first workflow:
1. Bootstrap Browser Debug through a guarded entrypoint.
2. Declare instrumentation mode from machine-readable output.
3. Form and test at least two hypotheses before patching.
4. Apply the smallest fix.
5. Verify with reproducible evidence.
6. Remove all temporary instrumentation.

Never claim browser instrumentation is active unless bootstrap output confirms:
`browserInstrumentation.canInstrumentFromBrowser = true`.

## Start Questions

Ask only what is needed to reproduce and validate:

1. Expected behavior vs actual behavior.
2. Exact reproduction steps and whether the issue is deterministic.
3. Environment details: branch/build, browser/device/OS, relevant flags.
4. When the issue started and last known good commit/build.
5. Actual page URL used during reproduction (for app URL mismatch checks).

## Workflow

0. Bootstrap Browser Debug with guardrails.
Set skill root once (works even when target project has no local `scripts/` folder):
`FIX_APP_BUGS_ROOT="${CODEX_HOME:-$HOME/.codex}/skills/fix-app-bugs"`

Run:
`python3 "$FIX_APP_BUGS_ROOT/scripts/bootstrap_guarded.py" --project-root <project-root> --json`

Always run again with the real page URL:
`python3 "$FIX_APP_BUGS_ROOT/scripts/bootstrap_guarded.py" --project-root <project-root> --actual-app-url <url> --json`

If user approved config auto-fix:
`python3 "$FIX_APP_BUGS_ROOT/scripts/bootstrap_guarded.py" --project-root <project-root> --actual-app-url <url> --apply-recommended --json`

Use output fields as source of truth:
1. `browserInstrumentation.canInstrumentFromBrowser`
2. `browserInstrumentation.mode`
3. `browserInstrumentation.reason`
4. `browserInstrumentation.failureCategory` and `browserInstrumentation.failedChecks`
5. `bootstrap.status`
6. `bootstrap.reason`
7. `debugEndpoint` (may be `null` in fallback)
8. `queryEndpoint` (may be `null` in fallback)
9. `checks` diagnostics from underlying bootstrap (if available)
10. `checks.appUrl.checklist`, `checks.appUrl.recommendedCommands`, `checks.appUrl.canAutoFix`, `checks.appUrl.nextAction`
11. `checks.appUrl.matchType` (`exact` or `loopback-equivalent`)
12. `checks.tools.playwright.wrapperSmoke` and `checks.tools.playwright.npxSmoke`
13. `checks.headedEvidence` and `checks.warnings` (headless false-negative guard)
14. `checks.appUrl.configAppUrl` and `checks.appUrl.actualAppUrl` (always print both in status updates)
15. `checks.appUrl.recommendedActualAppUrl` when available

If `checks.appUrl.status = not-provided` or `checks.appUrl.status = mismatch`, run the first `recommendedCommands` entry immediately and re-run bootstrap.
Do not continue to instrumentation or patching until `checks.appUrl.status = match`.
Apply config updates only with explicit `--apply-recommended`.
When `checks.appUrl.matchType = loopback-equivalent`, capability check passes, but optional sync via `--apply-recommended` is still recommended for deterministic future runs.

0.1 Mandatory capability verdict.
Declare mode before adding instrumentation:
1. If `canInstrumentFromBrowser = true`, mode is `browser-fetch`.
2. If `canInstrumentFromBrowser = false`, mode is `terminal-probe`.
3. If `bootstrap.status = fallback`, treat browser instrumentation as unavailable.

Hard rules:
1. Never insert page-side `fetch(debugEndpoint)` when mode is `terminal-probe`.
2. Never keep retrying browser-side debug fetch when fallback mode is active.
3. Continue bugfix workflow in `terminal-probe` mode instead of blocking.

1. Explore and define hypotheses before code changes.
Document at least two plausible causes in this format:
1. `Hypothesis`
2. `Evidence`
3. `Verdict` (`confirmed` or `rejected`)

For render bugs (diagonal split, half-screen black, invisible simulation), preferred first hypotheses:
1. Geometry/UV mismatch in fullscreen pass.
2. Canvas resize/viewport mismatch.

2. Add temporary instrumentation for evidence.
1. In `browser-fetch` mode, instrumentation may send events to `debugEndpoint`.
2. In `terminal-probe` mode, use terminal probes, deterministic code-path checks, Playwright screenshots, and reproducible visual evidence.
3. Wrap temporary instrumentation with markers:
`// BUGFIX_TRACE begin(<tag>)` and `// BUGFIX_TRACE end(<tag>)`.
4. For WebGL/render bugs, run at least one headed validation step. Headless black screenshots are non-final evidence.
5. For parity checks, use `compare-reference` output artifacts (`runtime.json`, `metrics.json`, `summary.json`) when available.
6. For scenario capture in fallback mode, run:
`python3 "$FIX_APP_BUGS_ROOT/scripts/terminal_probe_pipeline.py" --project-root <project-root> --session-id <id> --scenarios "$FIX_APP_BUGS_ROOT/references/terminal-probe-scenarios.example.json" --json`
Use a project-specific scenario file (ON/OFF/paused) derived from the example.

3. Ask user to reproduce.
Use the template in `references/repro-request-template.md` and request a timestamp window.

4. Analyze evidence.
1. If `queryEndpoint` is available, correlate by `traceId`, `tag`, and time window.
2. If in `terminal-probe` fallback, correlate terminal/visual evidence and deterministic state checks.
3. Confirm or reject each hypothesis explicitly.

5. Apply the smallest targeted patch.
Fix only the confirmed root cause. Avoid unrelated refactors.

6. Validate the same user-visible symptom.
Re-run the same reproduction flow and confirm expected behavior is restored.
For WebGL/render tasks, include at least one headed check in validation evidence.

7. Clean up instrumentation.
Run guarded cleanup:
`bash "$FIX_APP_BUGS_ROOT/scripts/cleanup_guarded.sh" <project-root>`

Use strict mode when needed:
`bash "$FIX_APP_BUGS_ROOT/scripts/cleanup_guarded.sh" <project-root> --strict`

`cleanup_guarded.sh` delegates to `check_instrumentation_cleanup.sh` when available and falls back to deterministic scan when missing.
In strict mode, marker scanning is runtime-only and ignores documentation-only mentions (for example `.md` feedback files).

8. Return final report using the required five blocks.
Always include:
1. `Root Cause`
2. `Patch`
3. `Validation`
4. `Instrumentation Status`
5. `Residual Risk`

If bootstrap fell back, state it as a hard fact in `Validation`.
Use `references/final-report-template.md`.

## Reference Parity Checks

When bugfix quality depends on visual parity, add a dedicated parity block:

1. Capture or prepare two images for the same scenario (`actual` and `reference`).
2. Run `compare-reference` and keep one artifact folder.
3. Include `runtime.json`, `metrics.json`, and `summary.json` paths in the final report.
4. Treat parity as unresolved if metrics are missing or from a different scenario.

## Render Bug Guardrail (WebGL/Fullscreen)

For fullscreen/render regressions, validate both geometry and UV space before and after patching:

1. `gl_Position` covers full viewport in clip space.
2. `vUv` spans `[0..1]` for fragment texture sampling.
3. Canvas CSS size and drawing buffer size both match expected viewport.
4. Clear/blend/alpha state does not zero out final composite.

If one axis is fixed without the other, expect regression.
Do not report success until the exact user-visible symptom is re-checked.
Headless black screenshots alone are insufficient to declare a render regression fixed or confirmed.
A headed browser-visible confirmation is mandatory for final validation.

## Instrumentation Rules

1. Prefer existing project logging/debug utilities.
2. Log enough context: event name, key inputs, derived state, branch taken.
3. Use correlation IDs where async overlap exists.
4. Redact secrets and personal data.
5. Keep temporary traces easy to remove.
6. Never add browser `fetch(debugEndpoint)` calls when `canInstrumentFromBrowser = false`.

## Reproduction Handoff Template

Use this structure for user reproduction requests:

1. `Steps`
2. `Expected`
3. `Observed`
4. `Window`
5. `Confirmation`

See `references/repro-request-template.md`.

## Log Analysis Checklist

1. Build a timeline for one reproduction.
2. Map timeline events to each hypothesis.
3. Identify first divergence from expected behavior.
4. Convert divergence to one concrete code-level cause.
5. Fix only that cause, then re-test.

See `references/debug-log-spec.md`.

## Resources

1. `scripts/bootstrap_guarded.py`: guarded bootstrap entrypoint with terminal-probe fallback.
2. `scripts/bootstrap_browser_debug.py`: underlying bootstrap implementation.
3. `scripts/cleanup_guarded.sh`: guarded cleanup entrypoint with fallback scan.
4. `scripts/check_instrumentation_cleanup.sh`: marker cleanup validator.
5. `scripts/terminal_probe_pipeline.py`: scenario capture + metrics helper for terminal-probe fallback.
6. `references/terminal-probe-scenarios.example.json`: ON/OFF/paused scenario template.
7. `references/debug-log-spec.md`: event schema and mode-specific instrumentation rules.
8. `references/repro-request-template.md`: copy-ready reproduction prompts.
9. `references/final-report-template.md`: required five-block final report format.
