# Browser Debug Plugin Runbook

This is the advanced operational runbook for `Enhanced mode (fix-app-bugs optional addon)`.
For default standalone usage, start with [README.md](README.md) and follow `Core mode`.

## Mode Decision Helper (30 seconds)
1. Stay in `Core mode` for exploratory local debugging and fast manual loops.
2. Use `Enhanced mode` when reproducibility and strict final evidence are required.
3. If guarded bootstrap returns `canInstrumentFromBrowser = false` or `bootstrap.status = fallback`, run `terminal-probe` immediately.
4. For visual parity, generate one artifact bundle per checkpoint and keep at least one headed validation.
5. If parity stalls for 3 cycles or 90 minutes, stop tuning and move to rollback + retrospective planning.

## Components

1. `extensions/humans-debugger` (MV3 extension)
2. `src/agent` (local Node.js agent)
3. `logs/browser-debug` (JSONL logs + screenshots)

## Per-Project Config

Each target project should keep:
`<project-root>/.codex/browser-debug.json`

Example:
```json
{
  "version": 1,
  "projectId": "my-project",
  "appUrl": "http://localhost:5173",
  "agent": {
    "host": "127.0.0.1",
    "corePort": 4678,
    "debugPort": 7331
  },
  "browser": {
    "cdpPort": 9222
  },
  "capture": {
    "allowedDomains": ["localhost"],
    "networkAllowlist": []
  },
  "defaults": {
    "queryWindowMinutes": 30
  }
}
```

## Start

1. Install deps:
```bash
npm install
```
2. Start agent:
```bash
npm run agent:start
```
3. Start Chromium with CDP enabled (example):
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```
4. Load unpacked extension from:
`extensions/humans-debugger`

## Core APIs

1. `GET http://127.0.0.1:4678/health`
2. `GET http://127.0.0.1:4678/runtime/config`
3. `POST http://127.0.0.1:4678/runtime/config`
4. `POST http://127.0.0.1:4678/session/start`
5. `POST http://127.0.0.1:4678/session/ensure` (start or reuse active session)
6. `POST http://127.0.0.1:4678/session/stop`
7. `POST http://127.0.0.1:4678/events` (requires `X-Ingest-Token`)
8. `POST http://127.0.0.1:4678/command`
9. `GET http://127.0.0.1:4678/events/query`

`/health` includes readiness fields:
1. `readiness.debug`: debug API registered.
2. `readiness.query`: query API registered.
3. `readiness.cdp`: deep probe result for `http://127.0.0.1:<cdpPort>/json/version`.
4. `readiness.cdpReason`: probe error when unavailable.
5. `readiness.cdpPort`: active runtime CDP port.

## Enhanced Mode Compatibility (fix-app-bugs)

Use compatibility endpoint:
`POST http://127.0.0.1:7331/debug`

Preflight endpoint:
`OPTIONS http://127.0.0.1:7331/debug`

Supported payload:
```json
{
  "marker": "BUGFIX_TRACE",
  "tag": "checkout-submit",
  "event": "before-submit",
  "traceId": "9b2a...",
  "ts": "2026-02-06T13:00:00.000Z",
  "data": {
    "isValid": false,
    "missingFields": 2
  }
}
```

Rules:
1. `marker` must be `BUGFIX_TRACE`.
2. Missing `ts` is filled by the server.
3. Missing `sessionId` maps to active session or `manual-YYYY-MM-DD`.
4. Content types: `application/json` and `text/plain` (JSON string body).
5. Preflight responses are deterministic:
   - allowlisted origin -> `204` with `Access-Control-Allow-*`.
   - blocked origin -> `403` with `CORS_POLICY_BLOCKED_PATH`.

## Strict Evidence Mode Contract (`fix-app-bugs`)

Ensure `CODEX_HOME` is set:
```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
```

Always run guarded bootstrap first:

```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --json
```

Run again with actual app URL (required for browser-fetch mode):

```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --actual-app-url <url> --json
```

Optional visual starter helper:

```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/visual_debug_start.py" --project-root <project-root> --actual-app-url <url> --json
```

Exit code contract: returns non-zero when guarded bootstrap fails, or when terminal-probe capture is executed and fails.

If Enhanced prerequisites are unavailable, continue in `Core mode` from [README.md](README.md).

Branch from machine-readable verdict:
1. Browser instrumentation is allowed only when `browserInstrumentation.canInstrumentFromBrowser = true`.
2. If `false` or `bootstrap.status = fallback`, mode is `terminal-probe`.
3. In `terminal-probe`, do not add page-side `fetch(debugEndpoint)` instrumentation.

Use `checks.appUrl` diagnostics as a mini-checklist:
1. `checks.appUrl.checklist` for pass/fail steps.
2. `checks.appUrl.recommendedCommands` for re-run and optional auto-fix commands.
3. `checks.appUrl.canAutoFix` + `checks.appUrl.autoFixMode` to confirm that auto-fix is explicit-flag only.
4. `checks.appUrl.matchType` (`exact` / `loopback-equivalent`) and `checks.appUrl.nextAction` for deterministic next step selection.
5. Always print `checks.appUrl.configAppUrl` and `checks.appUrl.actualAppUrl` together in run status.
6. If `checks.appUrl.status` is `not-provided` or `mismatch`, run the first recommended command before continuing.

Fallback cause diagnostics are explicit:
1. `browserInstrumentation.failureCategory`
2. `browserInstrumentation.failedChecks`
3. `browserInstrumentation.reason`

Headless false-negative guard is explicit:
1. `checks.headedEvidence`
2. `checks.warnings`

Playwright compatibility diagnostics are also machine-readable:
1. `checks.tools.playwright.wrapperSmoke`
2. `checks.tools.playwright.npxSmoke`
3. `checks.tools.playwright.selectedCommand`
4. `checks.tools.playwright.selectedBinary`
5. `checks.tools.playwright.functionalSmoke` (can be `skipped=true` when `npx` is unavailable; this does not block a healthy wrapper probe)

## Query Logs by Reproduction Window

HTTP:
```bash
curl "http://127.0.0.1:4678/events/query?from=2026-02-06T12:00:00.000Z&to=2026-02-06T12:30:00.000Z&tag=checkout-submit&limit=500"
```

CLI:
```bash
npm run agent:query -- --from 2026-02-06T12:00:00.000Z --to 2026-02-06T12:30:00.000Z --tag checkout-submit
```

Correlation strategy:
1. Primary key: `traceId`
2. Secondary: `tag`
3. Final filter: reproduction time window (`from/to`)

## Switch Project Flow

1. In target project, update `.codex/browser-debug.json` with project URL and ports.
2. For local dev, keep both `localhost` and `127.0.0.1` in `capture.allowedDomains`.
3. Run guarded skill bootstrap:
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --json
```
4. Re-run with the real page URL:
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --actual-app-url <url> --json
```
If `checks.appUrl.status = not-provided` or `checks.appUrl.status = mismatch`, run:
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --actual-app-url <url> --apply-recommended --json
```
5. If guarded bootstrap reports `bootstrap.status = ok`, runtime config is managed through the underlying bootstrap.
6. If guarded bootstrap reports `bootstrap.status = fallback`, continue in terminal-probe mode.
7. Extension auto-discovers core port (`4678..4698`), fetches runtime config, and hot-updates capture rules when core API is reachable.

When running terminal-probe scenario capture/metrics:
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py" --project-root <project-root> --session-id auto --tab-url <url> --scenarios "$CODEX_HOME/skills/fix-app-bugs/references/terminal-probe-scenarios.example.json" --json
```
Customize the scenario file with real ON/OFF/paused selectors for your app.

Or resolve/reuse session directly from CLI:
```bash
npm run agent:session -- --tab-url <url>
```

## Commands

1. Reload:
```bash
npm run agent:cmd -- --do reload
```
2. Wait:
```bash
npm run agent:cmd -- --do wait --ms 1200
```
3. Navigate:
```bash
npm run agent:cmd -- --do navigate --url "http://127.0.0.1:5173/"
```
4. Evaluate JS on page:
```bash
npm run agent:cmd -- --do evaluate --expr "window.location.href"
```
5. Click:
```bash
npm run agent:cmd -- --session <id> --do click --selector "button[data-test=save]"
```
6. Type:
```bash
npm run agent:cmd -- --session <id> --do type --selector "input[name=email]" --text "user@example.com" --clear
```
7. Snapshot:
```bash
npm run agent:cmd -- --session <id> --do snapshot --fullPage
```
8. Compare reference images:
```bash
npm run agent:cmd -- --session <id> --do compare-reference --actual /path/app.png --reference /path/ref.png --label baseline
```
9. Parity bundle helper:
```bash
npm run agent:parity-bundle -- --session <id> --reference /path/ref.png --label baseline
```
10. WebGL diagnostics:
```bash
npm run agent:cmd -- --session <id> --do webgl-diagnostics
```

Notes:
1. `--session <id>` is optional for `/command`; when omitted, runtime uses active session if available.
2. For `compare-reference`, command can run without active CDP session and without explicit `sessionId`.

## Retention

1. Logs and screenshot artifacts are stored under `logs/browser-debug`.
2. Hourly cleanup removes entries older than 7 days.

## Instrumentation Cleanup Check

After bugfix work, run guarded cleanup:

```bash
bash "$CODEX_HOME/skills/fix-app-bugs/scripts/cleanup_guarded.sh" .
```

Strict mode:

```bash
bash "$CODEX_HOME/skills/fix-app-bugs/scripts/cleanup_guarded.sh" . --strict
```

Strict mode scans runtime code paths only (for example `src`, `app`, `server`, `test`, `tests`, `packages/*/src`) and ignores documentation-only markers in markdown feedback files.

If `check_instrumentation_cleanup.sh` is missing, guarded cleanup automatically falls back to:

```bash
rg -n "BUGFIX_TRACE|debugEndpoint|traceId|issue tag" src test
```

Fallback scan uses the same runtime target selection when available.

## WebGL Evidence Note

For WebGL/render bugs, do not treat a black headless screenshot as the only evidence of regression or fix success.
Confirm with browser-visible behavior or concrete runtime errors.
At least one headed validation run is required for final success claims.

## Reference Parity Artifacts

For parity-sensitive work, keep one artifact folder containing:
1. `runtime.json`
2. `metrics.json`
3. `summary.json`
4. `actual.png`
5. `reference.png`
6. `diff.png` (when enabled)
7. `notes.md`

Default artifact path:
`logs/browser-debug/<sessionId>/artifacts/<runId>/...`

Terminal-probe pipeline artifact path (default):
`logs/browser-debug/<sessionId>/terminal-probe/<timestamp>/...`

## Interim Visual Report (Iteration Loops)

Use a lightweight report for iterative tuning loops:
1. `Hypothesis delta`
2. `Evidence delta`
3. `Next step`

Template path:
`skills/fix-app-bugs/references/interim-visual-report-template.md`

Keep the five-block report as final-closure-only in Enhanced mode.

## Parity Stop Rule

If the same scenario fails parity for 3 consecutive cycles or 90 minutes with no meaningful metrics improvement:
1. Stop tuning.
2. Record interim evidence bundle paths.
3. Convert the effort into rollback + retrospective planning.

## Skill Sync Workflow

Local skill source of truth:
`$CODEX_HOME/skills/fix-app-bugs` (fallback: `$HOME/.codex/skills/fix-app-bugs`)

Mirror location in this repo:
`skills/fix-app-bugs`

Workflow:
1. `npm run skill:sync:from-local`
2. `npm run skill:sync:check`
3. Commit/push

## Required Final Report Blocks

Every `fix-app-bugs` run should end with these five blocks:
1. `Root Cause`
2. `Patch`
3. `Validation`
4. `Instrumentation Status`
5. `Residual Risk`

If Browser Debug bootstrap was unavailable, state it explicitly in `Validation`.
