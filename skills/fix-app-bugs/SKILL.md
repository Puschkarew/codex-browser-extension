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

## Auto-Routing Compatibility

This skill can be invoked manually or by Every auto-routing rules.

When invoked by auto-routing:
1. Read shared contract from `$CODEX_HOME/skills/workflows-shared/references/auto-routing-contract.md`.
2. Respect kill-switch and session opt-out decisions made by the caller.
3. Return explicit route outcome status (`success`, `partial`, `blocked`) in status updates.
4. Keep fallback behavior unchanged: if capability gate fails, use `terminal-probe` and never use browser-side `fetch(debugEndpoint)`.

## Mode Decision Helper (30 seconds)

1. Use lightweight Browser Debug flow when fast local iteration is enough.
2. Use strict `fix-app-bugs` flow when reproducibility and machine-verifiable final evidence are required.
3. If strict flow reports fallback, switch to `terminal-probe` immediately (no browser-fetch retry loops).
4. For visual parity, keep one artifact bundle per checkpoint (`runtime.json`, `metrics.json`, `summary.json`, images, `notes.md`).
5. If parity stalls for 3 cycles or 90 minutes, stop tuning and switch to rollback + retrospective planning.

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

Optional quick-start helper for visual tasks:
`python3 "$FIX_APP_BUGS_ROOT/scripts/visual_debug_start.py" --project-root <project-root> --actual-app-url <url> --json`
This helper runs guarded bootstrap, validates app-url status, optionally runs minimal terminal-probe capture, and prints next actions.
Exit code contract: non-zero when guarded bootstrap fails, or when terminal-probe capture is executed and fails.

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
13. `checks.tools.playwright.functionalSmoke` (functional navigate/screenshot smoke; optional when `npx` is unavailable and non-blocking for healthy wrapper mode)
14. `checks.headedEvidence` and `checks.warnings` (headless false-negative guard)
15. `checks.appUrl.configAppUrl` and `checks.appUrl.actualAppUrl` (always print both in status updates)
16. `checks.appUrl.recommendedActualAppUrl` when available
17. `checks.coreHealth` and `checks.commandProbe` (core/API stability diagnostics)
18. `session` (`active`, `sessionId`, `tabUrl`, `state`)

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
`python3 "$FIX_APP_BUGS_ROOT/scripts/terminal_probe_pipeline.py" --project-root <project-root> --session-id auto --tab-url <url> --scenarios "$FIX_APP_BUGS_ROOT/references/terminal-probe-scenarios.example.json" --json`
Use a project-specific scenario file (ON/OFF/paused) derived from the example.
You can still pass explicit `--session-id <id>` when needed.

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
5. Keep `notes.md` in the same artifact folder for handoff context.

## Interim Visual Report (Iteration Loops)

Use `references/interim-visual-report-template.md` during exploratory parity loops.

Required blocks:
1. `Hypothesis delta`
2. `Evidence delta`
3. `Next step`

Keep the five-block final template for final closure only.

## Visual Parity Stop Rule

Stop iterative parity tuning when either threshold is met:
1. 3 consecutive failed parity cycles for the same scenario.
2. 90 minutes without meaningful metric improvement.

When stop-rule triggers:
1. Record the latest artifact bundle paths.
2. Propose rollback + retrospective planning instead of further tuning loops.

## Render Bug Guardrail (WebGL/Fullscreen)

For fullscreen/render regressions, validate both geometry and UV space before and after patching:

1. `gl_Position` covers full viewport in clip space.
2. `vUv` spans `[0..1]` for fragment texture sampling.
3. Canvas CSS size and drawing buffer size both match expected viewport.
4. Clear/blend/alpha state does not zero out final composite.
5. If `webgl-diagnostics.scene.nonBlackRatio` conflicts with screenshot non-black metrics, treat screenshot metrics + runtime exceptions as source of truth.

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
10. `references/interim-visual-report-template.md`: lightweight iteration report for parity tuning loops.
11. `scripts/visual_debug_start.py`: visual-debug bootstrap + starter helper.
