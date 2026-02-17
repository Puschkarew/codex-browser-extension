# AGENTS.md

## Mission
Use this repository to collect reproducible browser runtime evidence, run controlled browser actions, and support deterministic bugfix workflows for human developers and AI agents.

## Repository Layout
- `extensions/humans-debugger`: MV3 extension (background, popup, content instrumentation).
- `src/agent`: local Node.js agent (Core API + Debug API).
- `src/cli`: command-line helpers for command execution, querying, and stopping sessions.
- `src/shared/contracts.ts`: request/response schemas and shared types.
- `config`: default allowlist and network capture rules.
- `logs/browser-debug`: JSONL logs and snapshot artifacts.
- `skills/fix-app-bugs`: repository mirror of local `fix-app-bugs` skill.
- `docs/contracts`: mirrored auto-routing contract and capability map used by workflow/reviewer skills.
- `scripts/sync-fix-app-bugs-skill.sh`: local<->repo skill sync helper.
- `scripts/check-fix-app-bugs-sync.sh`: mandatory mirror sync check.
- `scripts/sync-auto-routing-contract.sh`: local<->repo contract sync helper.
- `scripts/check-auto-routing-contract-sync.sh`: mandatory contract mirror sync check.

## Mode Declaration
Before execution, declare one mode for the current run:
- `Core mode`
- `Enhanced mode (fix-app-bugs optional addon)`

If no mode is explicitly selected, default to `Core mode`.

## Mode Decision Helper (30 seconds)
1. Use `Core mode` for local iteration, exploratory debugging, and quick command loops.
2. Use `Enhanced mode (fix-app-bugs optional addon)` when reproducibility and machine-verifiable evidence are required.
3. If uncertain, start in `Core mode` and switch only when strict report/cleanup rules become necessary.
4. Switch from `Core` to `Enhanced` when you need guarded bootstrap verdicts or audit-ready final reporting.
5. In `Enhanced`, if `browserInstrumentation.canInstrumentFromBrowser = false` (or `bootstrap.status = fallback`), continue in `terminal-probe` instead of retry loops.
6. For visual parity tasks, keep one artifact bundle (`runtime.json`, `metrics.json`, `summary.json`, images) per checkpoint.

## Workflow Auto-Routing Contract

Workflow/reviewer skills that support auto invocation of Browser Debug + `fix-app-bugs` must follow:
- Local source-of-truth: `$CODEX_HOME/skills/workflows-shared/references/auto-routing-contract.md`
- Local capability map: `$CODEX_HOME/skills/workflows-shared/references/auto-routing-capability-map.md`
- Repo mirrors:
  - `docs/contracts/auto-routing-contract.md`
  - `docs/contracts/auto-routing-capability-map.md`

Required rules:
1. Honor global kill-switch: `EVERY_AUTO_ROUTING_ENABLED=false` => force `no-route`.
2. Honor per-session opt-out tokens: `no-auto-routing`, `manual-only`, `skip-browser-debug`.
3. Keep `Core mode` as default; use `Enhanced` only for strict reproducibility needs.
4. If capability gate falls back, continue in `terminal-probe` and do not add browser-side `fetch(debugEndpoint)`.
5. Emit routing outcomes as `success`, `partial`, or `blocked`.

## Baseline Workflow (All Modes)
1. Install dependencies:
```bash
npm install
```
2. Start the agent:
```bash
npm run agent:start
```
3. Start Chrome with CDP enabled:
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```
4. Load unpacked extension from:
```text
extensions/humans-debugger
```

## Core Mode Policy
- No guarded bootstrap is required.
- Use standard APIs and CLI commands (`/health`, `/events/query`, `/command`, `npm run agent:*`).
- Use evidence and reporting format appropriate for the task; strict 5-block report format is not mandatory unless explicitly requested.

## Enhanced Mode Policy (fix-app-bugs optional addon)
Use this mode when strict reproducibility and machine-verifiable bugfix flows are required.

### Instrumentation Gate (Enhanced mode only)
1. Ensure `CODEX_HOME` is set:
```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
```
2. Run guarded bootstrap first:
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --json
```
3. Re-run with the real app URL:
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --actual-app-url <url> --json
```
4. Browser instrumentation is allowed only when `browserInstrumentation.canInstrumentFromBrowser = true`.
5. If `false` or `bootstrap.status = fallback`, switch to `terminal-probe` mode.
6. In `terminal-probe` mode, do not add page-side `fetch(debugEndpoint)` calls.
7. If `checks.appUrl.status = not-provided` or `checks.appUrl.status = mismatch`, use `checks.appUrl.checklist` and `checks.appUrl.recommendedCommands`, then re-run bootstrap before continuing.
8. `checks.appUrl.autoFixMode` must stay explicit-flag only (`--apply-recommended`).
9. If `checks.appUrl.matchType = loopback-equivalent`, capability gate can pass, but optional config sync is still recommended for deterministic reruns.
10. Read Playwright diagnostics from `checks.tools.playwright.wrapperSmoke` and `checks.tools.playwright.npxSmoke`.
11. Use `browserInstrumentation.failureCategory` and `browserInstrumentation.failedChecks` to distinguish mismatch-only vs endpoint-unavailable fallback causes.
12. Always report `checks.appUrl.configAppUrl` and `checks.appUrl.actualAppUrl` together.
13. Respect `checks.headedEvidence` / `checks.warnings` and include at least one headed validation step for render bugs.

### Cleanup and Evidence Rules (Enhanced mode only)
Run guarded cleanup after bugfix work:

```bash
bash "$CODEX_HOME/skills/fix-app-bugs/scripts/cleanup_guarded.sh" .
```

Strict mode:

```bash
bash "$CODEX_HOME/skills/fix-app-bugs/scripts/cleanup_guarded.sh" . --strict
```

Notes:
- Strict mode scans runtime code paths and should ignore markdown-only feedback mentions.
- If cleanup tooling is unavailable, use fallback scan:
```bash
rg -n "BUGFIX_TRACE|debugEndpoint|traceId|issue tag" src test
```

### Required Final Report Format (Enhanced mode only)
Every Enhanced `fix-app-bugs` run must end with these blocks, in this order:
1. `Root Cause`
2. `Patch`
3. `Validation`
4. `Instrumentation Status`
5. `Residual Risk`

If guarded bootstrap fell back, state it explicitly in `Validation`.

### WebGL Evidence Guardrail (Enhanced mode only)
For WebGL/render bugs, do not treat black headless screenshots as sole proof.
Declare success only with browser-visible confirmation or concrete runtime errors.
At least one headed validation run is mandatory for final success claims.

### Visual Parity Stop Rule (All modes)
If the same scenario fails parity for 3 consecutive cycles or 90 minutes without meaningful metric improvement, stop tuning.
Convert the run into rollback + retrospective planning before continuing.

## Approved Commands
### Commands valid in both modes
- Start agent: `npm run agent:start`
- Stop current session: `npm run agent:stop`
- Query events by window:
```bash
npm run agent:query -- --from <ISO> --to <ISO> --tag <tag>
```
- Aggregate recent agent feedback:
```bash
npm run agent:feedback -- --window 24h --targets browser-debug,fix-app-bugs
```
- Execute browser command:
```bash
npm run agent:cmd -- --session <id> --do reload
npm run agent:cmd -- --session <id> --do click --selector "button[data-test=save]"
npm run agent:cmd -- --session <id> --do type --selector "input[name=email]" --text "user@example.com" --clear
npm run agent:cmd -- --session <id> --do snapshot --fullPage
npm run agent:cmd -- --session <id> --do compare-reference --actual /path/app.png --reference /path/ref.png --label baseline
npm run agent:parity-bundle -- --session <id> --reference /path/ref.png --label baseline
npm run agent:cmd -- --session <id> --do webgl-diagnostics
```
- Run tests: `npm test`
- Skill sync check before commit/push: `npm run skill:sync:check`
- Routing contract sync check before commit/push: `npm run routing:sync:check`

### Enhanced-only helper commands
- Guarded bootstrap:
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --json
```
- Guarded cleanup:
```bash
bash "$CODEX_HOME/skills/fix-app-bugs/scripts/cleanup_guarded.sh" .
```
- Terminal-probe scenario pipeline (capture + metrics bundle):
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py" --project-root <project-root> --session-id <id> --scenarios "$CODEX_HOME/skills/fix-app-bugs/references/terminal-probe-scenarios.example.json" --json
```

## Notes for Contributors
- Keep commands aligned with `package.json` scripts and current API contracts.
- Keep mode language explicit: `Core mode` vs `Enhanced mode (fix-app-bugs optional addon)`.
- Do not claim `fix-app-bugs` is mandatory for plugin operation.
- When changing workflows, update `README.md`, `README-debug.md`, and `AGENTS.md` together.
- Skill workflow: edit local skill first, then run `npm run skill:sync:from-local`, then `npm run skill:sync:check`, then commit/push.
- Auto-routing contract workflow: edit local contract docs first, then run `npm run routing:sync:from-local`, then `npm run routing:sync:check`.
