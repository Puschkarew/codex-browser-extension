# Reproduction Request Template

Use these prompts after instrumentation mode has been declared from guarded bootstrap output.

## Mode Declaration (send before repro request)

Share this first:

1. `mode`: `browser-fetch` or `terminal-probe`
2. `canInstrumentFromBrowser`: `true` or `false`
3. `bootstrap.status`: `ok` or `fallback`
4. If fallback: one-line reason from `bootstrap.reason`
5. `checks.appUrl.status` (`match`/`mismatch`/`not-provided`/`invalid-actual-url`)
6. `checks.appUrl.configAppUrl` and `checks.appUrl.actualAppUrl`

If `checks.appUrl.status = mismatch` or `checks.appUrl.status = not-provided`, include the first command from `checks.appUrl.recommendedCommands`.
Use auto-fix only with explicit `--apply-recommended`.

## Template A: First Reproduction

Please reproduce the issue with these exact steps:

1. [step 1]
2. [step 2]
3. [step 3]

Expected:
[expected result]

Observed now:
[current behavior]

When you run this, please reply with:

1. Whether reproduction happened (`yes` or `no`).
2. Timestamp window when you ran it (local time or ISO, with start and end).
3. Optional `traceId` if it was shown in logs/UI.
4. Any visible error text or screenshots.

## Template B: Verification After Fix

I applied a targeted fix for the confirmed root cause. Please rerun the same steps:

1. [step 1]
2. [step 2]
3. [step 3]

Please reply with:

1. Whether expected behavior is restored.
2. Anything still incorrect.
3. Timestamp window for this verification run (local time or ISO).
4. Optional `traceId` if available.

## Render Bug Addendum (WebGL/Fullscreen)

When relevant, include this explicit symptom check:

1. Whether diagonal split / half-black screen / invisible simulation still appears.
2. Whether symptom changed, moved, or only partially improved.
3. Screenshot of the same viewport used before the patch.
4. One headed browser-visible confirmation is required for final validation.
5. If screenshot is headless and black, confirm whether the same symptom is visible in a normal browser session.

## Reference Parity Addendum

When visual parity is required, include:
1. The exact scenario name used for both images.
2. Paths to `runtime.json`, `metrics.json`, and `summary.json` from `compare-reference`.
3. Whether the same scenario was used before and after patch.
