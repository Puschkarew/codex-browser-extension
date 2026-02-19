---
module: fix-app-bugs
date: 2026-02-19
problem_type: logic_error
component: readiness-and-evidence-validation
symptoms:
  - "`visual_debug_start.py` stayed in terminal-probe fallback with `app-url-gate:mismatch` and blocked scenario launch"
  - "Headed evidence run failed with `404 SESSION_NOT_FOUND` despite healthy bootstrap checks"
  - "WebGL diagnostics reported framebuffer black while screenshots were visibly non-black"
root_cause: logic_error
resolution_type: workflow_improvement
severity: medium
tags: [fix-app-bugs, readiness-gate, appurl, browser-fetch, terminal-probe, webgl, parity, evidence]
---

# Troubleshooting: Resolve Readiness Gate Drift and Disambiguate WebGL Black-Screen Evidence

## Problem
During a strict `fix-app-bugs` validation pass, the workflow produced conflicting signals:
1. Guarded startup initially blocked scenario execution due app URL drift.
2. After readiness became green, headed evidence still failed because no active debug session existed.
3. Runtime WebGL diagnostics showed black framebuffer values while screenshot metrics were fully non-black.

Without a deterministic sequence, this looked like a potential render regression when it was primarily workflow/readiness drift.

## Environment
- Module: `fix-app-bugs` workflow + Browser Debug runtime
- Project: `browser-debug-plugin`
- Date: 2026-02-19
- Key config file: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/.codex/browser-debug.json`

## Symptoms
- `visual_debug_start.py --actual-app-url http://127.0.0.1:5173/ --json` returned:
  - `mode=terminal-probe`
  - `checks.appUrl.status=mismatch`
  - `readiness.finalReady=false`
  - `readinessReasons=["app-url-gate:mismatch"]`
- Headed evidence run returned `SESSION_NOT_FOUND` from `agent:parity-bundle`.
- `webgl-diagnostics` showed `scene.nonBlackRatio=0` while terminal-probe screenshot metrics had `nonBlackRatio=1.0`.

## What Didn't Work

**Attempt 1:** Run visual starter without config alignment.
- **Why it failed:** readiness gate correctly blocked scenario execution until `config.appUrl` matched the real app origin.

**Attempt 2:** Run headed parity evidence before ensuring an active session.
- **Why it failed:** parity bundle requires a valid running session; no session meant `404 SESSION_NOT_FOUND`.

**Attempt 3:** Run terminal-probe using the unmodified example scenarios file.
- **Why it failed:** example selectors do not exist for this app; pipeline produced validation-driven next actions, not meaningful render evidence.

**Attempt 4:** Use strict parity compare against a 4x4 reference image.
- **Why it failed:** dimension mismatch (`IMAGE_DIMENSION_MISMATCH`) invalidated strict compare for closure use.

## Solution
Use a deterministic 4-step sequence.

### 1) Align app URL gate first (hard prerequisite)
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" \
  --project-root "/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension" \
  --actual-app-url "http://127.0.0.1:5173" \
  --apply-recommended --json
```

This synchronized:
- `appUrl: http://127.0.0.1:5173`
- `capture.allowedDomains += 127.0.0.1`

Then bootstrap reported:
- `checks.appUrl.status=match`
- `browserInstrumentation.canInstrumentFromBrowser=true`
- `readyForScenarioRun=true`

### 2) Ensure an active session before headed evidence
```bash
# open target tab if missing
curl -X PUT "http://127.0.0.1:9222/json/new?http://127.0.0.1:5173/"

npm run agent:session -- --tab-url http://127.0.0.1:5173/ --match-strategy origin-path
```

### 3) Use project-specific scenarios for terminal-probe evidence
Instead of template selectors, use app-specific `navigate + wait + webgl-diagnostics` scenarios.

```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py" \
  --project-root "/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension" \
  --session-id auto \
  --tab-url "http://127.0.0.1:5173/" \
  --tab-url-match-strategy origin-path \
  --scenarios /tmp/fix-app-bugs-webgl-20260219/scenarios-webgl.json --json
```

### 4) Treat screenshot+runtime verdict as source of truth for black-screen claims
Terminal-probe summary produced canonical verdict:
- `blackScreenVerdict.status=non-black-screenshot-with-framebuffer-black`
- `sourceOfTruth=screenshot-metrics-plus-runtime-errors`
- All scenarios passed with screenshot `nonBlackRatio=1.0`

For parity artifacts with a mismatched reference, use resize policy only for diagnostics:
```bash
npm run agent:parity-bundle -- \
  --session <session-id> \
  --reference <reference.png> \
  --label webgl-check \
  --dimension-policy resize-reference-to-actual
```

## Validation
- Bootstrap verification:
  - `checks.appUrl.status=match`
  - `checks.appUrl.configAppUrl=http://127.0.0.1:5173`
  - `checks.appUrl.actualAppUrl=http://127.0.0.1:5173`
- Terminal-probe artifacts:
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/logs/browser-debug/6619c0da-9f90-4ab3-8778-aa9881c1c6c9/terminal-probe/20260219T132504Z/runtime.json`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/logs/browser-debug/6619c0da-9f90-4ab3-8778-aa9881c1c6c9/terminal-probe/20260219T132504Z/metrics.json`
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/logs/browser-debug/6619c0da-9f90-4ab3-8778-aa9881c1c6c9/terminal-probe/20260219T132504Z/summary.json`
- Headed/parity artifact bundle:
  - `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/logs/browser-debug/6619c0da-9f90-4ab3-8778-aa9881c1c6c9/artifacts/2026-02-19T13-24-12-790Z-webgl-check-25414351/summary.json`
- Cleanup:
  - `cleanup_guarded.sh` returned no `BUGFIX_TRACE` markers.

## Why This Works
1. It enforces gating order: config alignment first, scenario execution second.
2. It separates session availability failures from rendering failures.
3. It avoids template-scenario false negatives by using app-specific commands.
4. It follows the workflow contract for WebGL ambiguity: screenshot metrics + runtime errors override raw framebuffer readings when they conflict.

## Prevention
- Always run guarded bootstrap with the real `--actual-app-url` before any scenario/evidence run.
- If `checks.appUrl.status != match`, apply recommended fix immediately and re-run bootstrap.
- Never run `agent:parity-bundle` without an active ensured session.
- Do not use `references/terminal-probe-scenarios.example.json` unchanged; create project-specific scenarios first.
- Keep reference images at matching dimensions for strict parity closure; use resize policy only as diagnostic fallback.

## Related Documentation
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/readiness-contract-drift-plugin-skill-collaboration-20260218.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/feedback-scope-and-safe-appurl-remediation-20260217.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-feedback-closure-matrix.md`
